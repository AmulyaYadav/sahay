import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Locale } from '@sahay/shared';
import { BodyBold, PressableRow, Title } from '../../src/components/ui';
import { useLocale, useT } from '../../src/locale';
import { spacing, useTheme } from '../../src/theme';
import { K } from '../../src/storage';

export default function LanguageSelect() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { locale, setLocale } = useLocale();

  // Language names are shown in their own language by convention (endonyms).
  const options: { code: Locale; label: string }[] = [
    { code: 'en', label: 'English' },
    { code: 'hi', label: 'हिन्दी' },
  ];

  const choose = async (code: Locale) => {
    setLocale(code);
    await AsyncStorage.setItem(K.onboarded, '1').catch(() => {});
    router.replace('/auth');
  };

  return (
    <View style={{ flex: 1, padding: spacing.xl, paddingTop: insets.top + spacing.xxl, gap: spacing.lg }}>
      <Title>{t('onboarding.chooseLanguage')}</Title>
      {options.map((o) => (
        <PressableRow
          key={o.code}
          accessibilityLabel={o.label}
          accessibilityState={{ selected: locale === o.code }}
          onPress={() => void choose(o.code)}
          style={{
            borderColor: locale === o.code ? th.colors.accent : th.colors.border,
            borderWidth: locale === o.code ? 2 : 1,
          }}
        >
          <BodyBold>{o.label}</BodyBold>
        </PressableRow>
      ))}
    </View>
  );
}
