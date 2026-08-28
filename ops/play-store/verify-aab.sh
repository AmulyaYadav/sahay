#!/usr/bin/env bash
# Verify a release AAB against what Google Play actually rejects on upload.
#
# A build that compiles is not a build Play accepts. Every check here
# corresponds to a specific rejection: target API level, 16 KB page size,
# debug signing, and an API origin left pointing at localhost.
#
# Usage: ops/play-store/verify-aab.sh [path-to-aab]
set -uo pipefail

AAB="${1:-apps/mobile/android/app/build/outputs/bundle/release/app-release.aab}"
JAVA_HOME="${JAVA_HOME:-/usr/local/opt/openjdk@17}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
EXPECTED_ORIGIN="${EXPECTED_ORIGIN:-api.sahay.online}"
FALLBACK_ORIGIN="${FALLBACK_ORIGIN:-localhost:4000}"   # DEFAULT_BASE in apps/mobile/src/api.ts
MIN_TARGET_SDK=36   # Play requirement for new submissions from 2026-08-31

fail=0
ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }

[ -f "$AAB" ] || { echo "no AAB at $AAB"; exit 1; }
echo "verifying $AAB ($(du -h "$AAB" | cut -f1))"

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
unzip -q -o "$AAB" -d "$work"

# --- target API level ------------------------------------------------------
# The AAB manifest is protobuf, so read the merged manifest Gradle produced.
manifest=$(find apps/mobile/android/app/build/intermediates -name AndroidManifest.xml \
  -path '*bundle_manifest*release*' 2>/dev/null | head -1)
if [ -n "$manifest" ]; then
  [ "$manifest" -nt "$AAB" ] || [ "$AAB" -nt "$manifest" ] && \
    printf '  note  targetSdk read from build intermediates, not the AAB\n'
  target=$(grep -oE 'targetSdkVersion="[0-9]+"' "$manifest" | grep -oE '[0-9]+')
  if [ "${target:-0}" -ge "$MIN_TARGET_SDK" ]; then ok "targetSdk $target"
  else bad "targetSdk ${target:-unknown} — Play requires >= $MIN_TARGET_SDK"; fi
else
  bad "no merged manifest found; run the build first"
fi

# --- 16 KB page alignment --------------------------------------------------
# Required for anything targeting Android 15+ since 2025-11-01. Only the 64-bit
# ABIs matter: 16 KB pages do not exist on 32-bit devices.
readelf=$(ls "$ANDROID_HOME"/ndk/*/toolchains/llvm/prebuilt/*/bin/llvm-readelf 2>/dev/null | tail -1)
if [ -z "$readelf" ]; then
  bad "llvm-readelf not found (install an NDK) — cannot check 16 KB alignment"
else
  for abi in arm64-v8a x86_64; do
    n=0; misaligned=0
    for so in "$work"/base/lib/$abi/*.so; do
      [ -e "$so" ] || continue
      n=$((n+1))
      align=$("$readelf" -l "$so" 2>/dev/null | awk '$1=="LOAD"{print $NF}' | sort -u | tr '\n' ' ')
      case "$align" in *0x4000*|*0x10000*) ;; *) misaligned=$((misaligned+1));
        printf '        %s -> %s\n' "$(basename "$so")" "$align" ;; esac
    done
    if [ "$n" -eq 0 ]; then bad "$abi: no native libs found"
    elif [ "$misaligned" -eq 0 ]; then ok "$abi: $n/$n libs 16 KB aligned"
    else bad "$abi: $misaligned of $n libs not 16 KB aligned"; fi
  done
fi

# --- signing ---------------------------------------------------------------
# Expo's template signs release with a debug keystore that ships inside Expo
# itself; Play rejects it. See apps/mobile/plugins/withReleaseSigning.js.
cert=$("$JAVA_HOME/bin/keytool" -printcert -jarfile "$AAB" 2>/dev/null)
if grep -q "CN=Android Debug" <<<"$cert"; then
  bad "debug-signed — the upload key properties were missing from ~/.gradle/gradle.properties"
elif owner=$(grep -m1 'Owner:' <<<"$cert"); then
  ok "signed: ${owner#*Owner: }"
else
  bad "unsigned or unreadable signature"
fi

# --- compiled-in API origin ------------------------------------------------
# EXPO_PUBLIC_* is inlined at bundle time. Forgetting it ships a store build
# that talks to localhost, which cannot be fixed without a new release.
bundle="$work/base/assets/index.android.bundle"
if [ ! -f "$bundle" ]; then
  bad "no JS bundle in the AAB"
else
  # grep -a rather than `strings | grep -q`: the latter makes strings take a
  # SIGPIPE, which pipefail reports as a failed pipeline.
  if grep -aqF -- "$EXPECTED_ORIGIN" "$bundle"; then ok "origin $EXPECTED_ORIGIN present"
  else bad "origin $EXPECTED_ORIGIN missing — was EXPO_PUBLIC_API_ORIGIN set?"; fi
  # Only api.ts's own fallback matters. React Native leaves its dev-server
  # default (http://localhost:8081) in the Hermes string table either way.
  if grep -aqF "$FALLBACK_ORIGIN" "$bundle"; then
    bad "$FALLBACK_ORIGIN is compiled in — EXPO_PUBLIC_API_ORIGIN was not set"
  else ok "no $FALLBACK_ORIGIN fallback"; fi
fi

# --- permissions -----------------------------------------------------------
aabmanifest="$work/base/manifest/AndroidManifest.xml"
if [ -f "$aabmanifest" ]; then
  unwanted=0
  for p in ACCESS_FINE_LOCATION SYSTEM_ALERT_WINDOW READ_EXTERNAL_STORAGE WRITE_EXTERNAL_STORAGE; do
    if grep -aqF "android.permission.$p" "$aabmanifest"; then
      bad "$p is requested — add it to android.blockedPermissions in app.json"
      unwanted=$((unwanted+1))
    fi
  done
  [ "$unwanted" -eq 0 ] && ok "no unwanted permissions"
else
  bad "no manifest inside the AAB"
fi

echo
[ "$fail" -eq 0 ] && echo "PASS" || echo "FAIL — see above"
exit "$fail"
