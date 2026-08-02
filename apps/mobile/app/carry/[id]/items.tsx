import React, { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Locale } from '@sahay/shared';
import { api, isOfflineError } from '../../../src/api';
import { useAuth } from '../../../src/auth';
import { useBring, useCatalogue } from '../../../src/hooks';
import { useLocale, useT } from '../../../src/locale';
import { isLargeFontScale, mockRadius, spacing, useTheme } from '../../../src/theme';
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
  // A ref, not the state: the retry handler below is created inside a call to
  // `save` and would otherwise capture a stale `busy`.
  const inFlight = useRef(false);

  const categories = catalogue.data?.categories ?? [];
  const bySlug = useMemo(() => new Map(categories.map((c) => [c.slug, c])), [categories]);

  // The stepper's width is fixed in points, so a large system font leaves the
  // name too little to wrap in. Past the threshold it gets a line of its own.
  const stackRows = isLargeFontScale();

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
    if (inFlight.current) return;
    const chosen = slugs.filter((s) => (qty[s] ?? 0) > 0);
    if (chosen.length === 0) return router.replace(`/carry/${id}/done`);
    inFlight.current = true;
    setBusy(true);
    try {
      // Concurrent, not sequential: each item was a separate round trip, so a
      // four-item list took four times as long to release the button.
      await Promise.all(
        chosen.map((slug) => {
          const cat = bySlug.get(slug);
          if (!cat) return Promise.resolve();
          return api(`/events/${id}/inventory`, {
            method: 'POST',
            token,
            body: {
              categoryId: cat.id,
              qty: qty[slug],
              unit: cat.unit,
              details: {},
              // Deterministic so a retry cannot double-add, but bounded: keys
              // are capped at 64 characters, and a full uuid plus a long
              // catalogue slug plus a three-digit quantity overruns that and
              // fails validation. The uuid's last 12 characters distinguish a
              // person's events without spending 36.
              idempotencyKey: `carry-${id.slice(-12)}-${slug}-${qty[slug]}`,
            },
          });
        }),
      );
      router.replace(`/carry/${id}/done`);
    } catch (err) {
      // Say what went wrong. A bare "Something went wrong" over a button that
      // has re-enabled itself leaves no idea whether to retry or to skip.
      Alert.alert(
        t('common.error'),
        isOfflineError(err) ? t('common.offline') : ((err as Error).message ?? undefined),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.retry'), onPress: () => void save() },
        ],
      );
    } finally {
      inFlight.current = false;
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
          {slugs.map((slug) => {
            const stepper = (
              <Stepper
                compact
                value={qty[slug] ?? 0}
                min={0}
                onChange={(v) => setQty((q) => ({ ...q, [slug]: v }))}
              />
            );
            return (
              <MockCard key={slug} style={{ padding: spacing.md }}>
                {stackRows ? (
                  // Large system font: the name gets the full card width and the
                  // stepper sits beneath it. Sharing a line cannot work here —
                  // the control's width is fixed in points while the text grows,
                  // so the name is left wrapping one or two characters per line.
                  <View style={{ gap: spacing.sm }}>
                    <Row gap={spacing.sm} style={{ alignItems: 'center' }}>
                      <CategoryEmoji slug={slug} size={22} />
                      <BodyBold style={{ flex: 1 }}>{name(slug)}</BodyBold>
                    </Row>
                    <Row style={{ justifyContent: 'flex-end' }}>{stepper}</Row>
                  </View>
                ) : (
                  // Default: one row, as the mockup draws it. `gap: sm` and the
                  // compact stepper keep a long name off a narrow phone's edge.
                  <Row gap={spacing.sm} style={{ alignItems: 'center' }}>
                    <CategoryEmoji slug={slug} size={22} />
                    <BodyBold style={{ flex: 1 }}>{name(slug)}</BodyBold>
                    {stepper}
                  </Row>
                )}
              </MockCard>
            );
          })}
        </View>

        <Pressable accessibilityRole="button" onPress={addAnother} style={{ paddingVertical: spacing.sm }}>
          <BodyBold color={th.colors.primary}>{t('carry.addAnother')}</BodyBold>
        </Pressable>
      </ScrollView>

      <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.md, gap: spacing.xs }}>
        <PrimaryCta
          title={busy ? t('common.saving') : t('carry.save')}
          onPress={() => void save()}
          disabled={busy}
        />
        <GhostLink title={t('carry.later')} onPress={() => router.replace('/(tabs)/home')} />
      </View>
    </View>
  );
}
