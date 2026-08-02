const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Sign release builds with a real upload key instead of Expo's debug keystore.
 *
 * The generated template signs `release` with `signingConfigs.debug` — a
 * keystore that ships inside Expo itself, password `android`, identical for
 * every project on earth. Play rejects it, and it offers no assurance that a
 * later build came from the same author.
 *
 * This has to be a plugin rather than an edit to build.gradle because
 * `android/` is generated and git-ignored: any hand-edit is silently discarded
 * the next time anyone runs prebuild, and the build would go back to being
 * debug-signed without anyone noticing.
 *
 * The key itself and its passwords stay out of the repository. Gradle reads
 * them from ~/.gradle/gradle.properties. When those properties are absent —
 * a fresh clone, CI, another machine — the build falls back to debug signing
 * so it still runs; it simply cannot produce something publishable.
 */
const SIGNING_CONFIG = `
        release {
            // Populated from ~/.gradle/gradle.properties; see plugins/withReleaseSigning.js.
            if (project.hasProperty('SAHAY_UPLOAD_STORE_FILE')) {
                storeFile file(SAHAY_UPLOAD_STORE_FILE)
                storePassword SAHAY_UPLOAD_STORE_PASSWORD
                keyAlias SAHAY_UPLOAD_KEY_ALIAS
                keyPassword SAHAY_UPLOAD_KEY_PASSWORD
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;

    if (!gradle.includes('SAHAY_UPLOAD_STORE_FILE')) {
      // Add a `release` entry alongside the template's `debug` one.
      gradle = gradle.replace(
        /(signingConfigs\s*\{)/,
        `$1${SIGNING_CONFIG}`,
      );
    }

    // Point the release build type at it, but only when the key is present, so
    // a machine without the key still builds (unsigned-for-Play, debug-signed).
    gradle = gradle.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{\s*\n)(\s*)(\/\/ Caution![\s\S]*?\n\s*)?signingConfig signingConfigs\.debug/m,
      `$1$2signingConfig project.hasProperty('SAHAY_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
