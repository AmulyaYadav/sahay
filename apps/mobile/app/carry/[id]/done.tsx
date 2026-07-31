import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Locale } from '@sahay/shared';
import { useCatalogue, useInventory } from '../../../src/hooks';
import { useLocale, useT } from '../../../src/locale';
import { spacing, useTheme } from '../../../src/theme';
import { Body, BodyBold, Row, Title } from '../../../src/components/ui';
import { GradientScreen, MockCard, PrimaryCta } from '../../../src/components/mock';
import { ArtFrame, Confetti, SuccessCheckArt } from '../../../src/components/mockArt';

/** Mockup 7 — "You're All Set", listing what was just added. */
export default function CarryDone() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const { locale } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const inventory = useInventory(id);
  const catalogue = useCatalogue();

  const bySlug = new Map((catalogue.data?.categories ?? []).map((c) => [c.id, c]));
  const items = (inventory.data?.items ?? []).filter((i) => i.active);
  // The mockup bullets are colour-cycled, not semantic.
  const bulletTints = [th.colors.primary, '#D97706', th.colors.primary, th.colors.success];

  return (
    <GradientScreen variant="allSet">
      <View style={{ flex: 1, justifyContent: 'center', gap: spacing.xl, padding: spacing.lg }}>
        <ArtFrame>
          <View style={{ position: 'absolute' }}>
            <Confetti size={300} />
          </View>
          <SuccessCheckArt size={104} />
        </ArtFrame>

        <View style={{ gap: spacing.sm }}>
          <Title center>{t('carry.allSet')}</Title>
          <Body color={th.colors.textSecondary} style={{ textAlign: 'center' }}>
            {t('carry.thanks')}
          </Body>
        </View>

        {items.length > 0 ? (
          <MockCard>
            <BodyBold>{t('carry.yourContribution')}</BodyBold>
            <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
              {items.map((item, i) => {
                const cat = bySlug.get(item.categoryId);
                const label = cat?.name[locale as Locale] ?? cat?.name.en ?? '';
                return (
                  <Row key={item.id} gap={spacing.sm} style={{ alignItems: 'center' }}>
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: bulletTints[i % bulletTints.length],
                      }}
                    />
                    <Body style={{ flex: 1 }}>
                      <BodyBold>{Math.round(Number(item.qtyTotal))}</BodyBold> {label}
                    </Body>
                  </Row>
                );
              })}
            </View>
          </MockCard>
        ) : null}

        <PrimaryCta title={t('carry.goHome')} onPress={() => router.replace('/(tabs)/home')} />
      </View>
    </GradientScreen>
  );
}
