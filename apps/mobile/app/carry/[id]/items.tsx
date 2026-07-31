import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Locale } from '@sahay/shared';
import { api } from '../../../src/api';
import { useAuth } from '../../../src/auth';
import { useBring, useCatalogue } from '../../../src/hooks';
import { useLocale, useT } from '../../../src/locale';
import { mockRadius, spacing, useTheme } from '../../../src/theme';
import { Body, BodyBold, Heading, LoadingView, Row, Stepper } from '../../../src/components/ui';
import { GhostLink, MockCard, PrimaryCta } from '../../../src/components/mock';
import { CategoryEmoji } from '../../../src/components/categoryEmoji';

/**
 * Mockup 6 — "Add What You're Carrying".
 *
 * Pre-populates from the event's "bring" suggestions so the list is not empty on
 * arrival, which is what the mockup shows. Each row writes one inventory item.
 */
export default function CarryItems() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { locale } = useLocale();
  const { token } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const catalogue = useCatalogue();
  const bring = useBring(id);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const categories = catalogue.data?.categories ?? [];
  const bySlug = useMemo(() => new Map(categories.map((c) => [c.slug, c])), [categories]);

  // Suggested items first, then anything the person added by hand.
  const slugs = useMemo(() => {
    const suggested = (bring.data?.suggestions ?? []).map((s) => s.categorySlug);
    return [...new Set([...suggested.slice(0, 4), ...extra])];
  }, [bring.data, extra]);

  if (catalogue.isLoading) return <LoadingView />;

  const name = (slug: string) => {
    const c = bySlug.get(slug);
    return c?.name[locale as Locale] ?? c?.name.en ?? slug;
  };

  const save = async () => {
    const chosen = slugs.filter((s) => (qty[s] ?? 0) > 0);
    if (chosen.length === 0) return router.replace(`/carry/${id}/done`);
    setBusy(true);
    try {
      for (const slug of chosen) {
        const cat = bySlug.get(slug);
        if (!cat) continue;
        await api(`/events/${id}/inventory`, {
          method: 'POST',
          token,
          body: {
            categoryId: cat.id,
            qty: qty[slug],
            unit: cat.unit,
            details: {},
            idempotencyKey: `carry-${id}-${slug}-${qty[slug]}`,
          },
        });
      }
      router.replace(`/carry/${id}/done`);
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const addAnother = () => {
    const next = categories.find((c) => !slugs.includes(c.slug));
    if (next) {
      setExtra((e) => [...e, next.slug]);
      setQty((q) => ({ ...q, [next.slug]: 1 }));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: th.colors.bg, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ gap: spacing.xs }}>
          <Heading>{t('carry.listTitle')}</Heading>
          <Body color={th.colors.textSecondary}>{t('carry.listBody')}</Body>
        </View>

        <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
          {slugs.map((slug) => (
            <MockCard key={slug} style={{ padding: spacing.md }}>
              <Row gap={spacing.md} style={{ alignItems: 'center' }}>
                <CategoryEmoji slug={slug} size={22} />
                <BodyBold style={{ flex: 1 }}>{name(slug)}</BodyBold>
                <Stepper
                  value={qty[slug] ?? 0}
                  min={0}
                  onChange={(v) => setQty((q) => ({ ...q, [slug]: v }))}
                />
              </Row>
            </MockCard>
          ))}
        </View>

        <Pressable accessibilityRole="button" onPress={addAnother} style={{ paddingVertical: spacing.sm }}>
          <BodyBold color={th.colors.primary}>{t('carry.addAnother')}</BodyBold>
        </Pressable>
      </ScrollView>

      <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.md, gap: spacing.xs }}>
        <PrimaryCta title={t('carry.save')} onPress={() => void save()} disabled={busy} />
        <GhostLink title={t('carry.later')} onPress={() => router.replace('/(tabs)/home')} />
      </View>
    </View>
  );
}
