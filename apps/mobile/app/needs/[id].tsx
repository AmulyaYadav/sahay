import React from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { CategoryNeed, Locale } from '@sahay/shared';
import { useCatalogue, useDashboard } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { mockRadius, spacing, useTheme } from '../../src/theme';
import { Body, BodyBold, Heading, LoadingView, MutedCaption, Row } from '../../src/components/ui';
import { GhostLink, MockCard, NeedBadge, PrimaryCta } from '../../src/components/mock';
import { CategoryEmoji } from '../../src/components/categoryEmoji';
import { DropArt } from '../../src/components/mockArt';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Mockup 4 — "See Event Requests".
 *
 * Reads the event dashboard, which is already k-anonymised: a need whose
 * quantity is below the disclosure threshold comes back null, and the row then
 * shows only the level rather than inventing a number.
 */
const LEVEL: Record<string, { badge: 'high' | 'moderate' | 'low'; key: string } | undefined> = {
  critical_shortage: { badge: 'high', key: 'needs.highNeed' },
  high_need: { badge: 'high', key: 'needs.highNeed' },
  moderate_need: { badge: 'moderate', key: 'needs.moderateNeed' },
  adequate: { badge: 'low', key: 'needs.lowNeed' },
};

export default function EventNeeds() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { locale } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const dashboard = useDashboard(id);
  const catalogue = useCatalogue();

  if (dashboard.isLoading || catalogue.isLoading) return <LoadingView />;

  const bySlug = new Map((catalogue.data?.categories ?? []).map((c) => [c.slug, c]));
  // Most-needed first, which is what the mockup's ordering implies.
  const order = ['critical_shortage', 'high_need', 'moderate_need', 'adequate'];
  const needs = (dashboard.data?.needs ?? [])
    .filter((n) => LEVEL[n.level])
    .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));

  const label = (n: CategoryNeed) => {
    const cat = bySlug.get(n.categorySlug);
    return cat?.name[locale as Locale] ?? cat?.name.en ?? n.categorySlug;
  };

  return (
    <View style={{ flex: 1, backgroundColor: th.colors.bg, paddingTop: insets.top }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl }}
      >
        <Row style={{ alignItems: 'flex-start', gap: spacing.md }}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Heading>{t('needs.title')}</Heading>
            <Body color={th.colors.textSecondary}>{t('needs.body')}</Body>
          </View>
          <DropArt size={62} />
        </Row>

        <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
          {needs.length === 0 ? <MutedCaption>{t('needs.none')}</MutedCaption> : null}
          {needs.map((n) => {
            const lvl = LEVEL[n.level]!;
            return (
              <MockCard key={n.categoryId} style={{ padding: spacing.md }}>
                <Row gap={spacing.md} style={{ alignItems: 'center' }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: mockRadius.input,
                      backgroundColor: th.colors.primaryTint,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CategoryEmoji slug={n.categorySlug} size={20} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <BodyBold>{label(n)}</BodyBold>
                    {n.requestedQty ? (
                      <MutedCaption>
                        {t('needs.qtyNeeded', { qty: Math.round(n.requestedQty), unit: n.unit })}
                      </MutedCaption>
                    ) : null}
                  </View>
                  <NeedBadge level={lvl.badge} label={t(lvl.key)} />
                </Row>
              </MockCard>
            );
          })}
        </View>
      </ScrollView>

      <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.md, gap: spacing.xs }}>
        <PrimaryCta title={t('needs.canCarry')} onPress={() => router.push(`/carry/${id}`)} />
        <GhostLink title={t('needs.maybeLater')} onPress={() => router.replace('/(tabs)/home')} />
      </View>
    </View>
  );
}
