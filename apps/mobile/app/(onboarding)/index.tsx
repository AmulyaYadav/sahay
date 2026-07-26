import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Gap, Title } from '../../src/components/ui';
import { useT } from '../../src/locale';
import { spacing, useTheme } from '../../src/theme';

/**
 * Intro carousel: what Sahay is, the pseudonymity promise, and honest limits.
 * Three short screens, no marketing fluff.
 */
export default function OnboardingIntro() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);

  const pages = [
    { title: t('common.appName'), body: t('onboarding.intro1') },
    { title: t('common.tagline'), body: t('onboarding.intro2') },
    { title: t('onboarding.safetyTitle'), body: t('onboarding.intro3') },
  ];
  const current = pages[page] ?? pages[0]!;
  const last = page === pages.length - 1;

  return (
    <View
      style={{
        flex: 1,
        padding: spacing.xl,
        paddingTop: insets.top + spacing.xxl,
        paddingBottom: insets.bottom + spacing.xl,
        justifyContent: 'space-between',
      }}
    >
      <View style={{ gap: spacing.lg, flex: 1, justifyContent: 'center' }}>
        <Title center>{current.title}</Title>
        <Body center color={th.colors.muted}>
          {current.body}
        </Body>
      </View>

      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm }}>
          {pages.map((_, i) => (
            <View
              key={i}
              accessibilityLabel={`${i + 1}/${pages.length}`}
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === page ? th.colors.accent : th.colors.border,
              }}
            />
          ))}
        </View>
        <Gap size={spacing.sm} />
        <Button
          title={last ? t('onboarding.safetyAck') : t('common.next')}
          onPress={() => {
            if (last) router.push('/(onboarding)/language');
            else setPage(page + 1);
          }}
        />
        {page > 0 ? (
          <Button title={t('common.back')} variant="ghost" onPress={() => setPage(page - 1)} />
        ) : null}
      </View>
    </View>
  );
}
