import React from 'react';
import { Pressable } from 'react-native';
import type { Locale } from '@sahay/shared';
import { BodyBold } from './ui';
import { useLocale, useT } from '../locale';
import { TOUCH, radius, spacing, useTheme } from '../theme';

/**
 * One-tap language switch for the app chrome.
 *
 * Shows the name of the language you would switch TO, in that language — the
 * convention for language pickers, and the only label a reader of the other
 * language is guaranteed to recognise. Two languages means a toggle is enough;
 * this replaces the dedicated onboarding language step, so choosing a language
 * is available everywhere instead of being a one-time question at install.
 */
export function LanguageToggle() {
  const t = useT();
  const th = useTheme();
  const { locale, setLocale } = useLocale();

  const next: Locale = locale === 'en' ? 'hi' : 'en';
  const label = next === 'hi' ? 'हिन्दी' : 'English';

  return (
    <Pressable
      accessibilityRole="button"
      // Names the destination language, since the visible label is the endonym
      // and a screen reader in the current language may not announce it well.
      accessibilityLabel={`${t('settings.language')}: ${label}`}
      onPress={() => setLocale(next)}
      hitSlop={8}
      style={({ pressed }) => ({
        minHeight: TOUCH,
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
        borderRadius: radius.pill,
        backgroundColor: pressed ? th.colors.cardAlt : th.colors.surface,
        borderWidth: 1,
        borderColor: th.colors.border,
      })}
    >
      <BodyBold color={th.colors.primary}>{label}</BodyBold>
    </Pressable>
  );
}
