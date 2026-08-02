import React, { useState } from 'react';
import { Alert, Platform, Pressable, RefreshControl, ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MatchView, RequestView } from '@sahay/shared';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useActiveEvent } from '../../src/activeEvent';
import {
  qk,
  useActiveMatches,
  useAvailability,
  useCatalogue,
  useDashboard,
  useEvent,
  useInventory,
  useMyRequests,
  usePendingOffers,
} from '../../src/hooks';
import { ensureLocationPermission, useLocationPings } from '../../src/locationPings';
import { useLocale, useT } from '../../src/locale';
import { categoryBySlug, categoryGlyph, categoryName } from '../../src/catalogue';
import { formatDateTime, minutesUntil } from '../../src/format';
import { spacing, TOUCH, useTheme } from '../../src/theme';
import { Icon } from '../../src/components/icons';
import { AppHeader } from '../../src/components/AppHeader';
import { shouldAskAttendance } from '../../src/attendancePrompt';
import { GhostLink, MockCard } from '../../src/components/mock';
import { CategoryEmoji } from '../../src/components/categoryEmoji';
import {
  Badge,
  Body,
  Button,
  CategoryChip,
  Chip,
  Gap,
  H3,
  Heading,
  ListRow,
  Muted,
  MutedCaption,
  NeedPill,
  QuickActionTile,
  Row,
  StalenessNote,
} from '../../src/components/ui';
import { LanguageToggle } from '../../src/components/LanguageToggle';

type Duration = 30 | 60 | 120 | 'event_end';

function timeOfDayKey(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

export default function HomeScreen() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { locale } = useLocale();
  const { token, me } = useAuth();
  const { joined, activeEventId, setActiveEventId } = useActiveEvent();

  const event = useEvent(activeEventId);
  const dashboard = useDashboard(activeEventId);
  const catalogue = useCatalogue();
  const availability = useAvailability(activeEventId);
  const requests = useMyRequests(activeEventId ?? undefined);
  const matches = useActiveMatches();
  const inventory = useInventory(activeEventId);
  // Polled: an offer is a ~45s window, so home must not miss one (option 2 —
  // the mockup's four cards, with this appearing above them only when live).
  const offers = usePendingOffers({ poll: true });

  // Mockup 8 shows one "Active request" card; the newest open request is the one
  // a person is waiting on.
  const supplyItems = (inventory.data?.items ?? []).filter((i) => i.active);

  const [duration, setDuration] = useState<Duration>(60);
  const [toggling, setToggling] = useState(false);

  const helpingOn = availability.data?.on === true;

  const setAvailability = async (on: boolean) => {
    if (!token || !activeEventId) return;
    setToggling(true);
    try {
      if (on) {
        // One-time honest explanation, then foreground permission.
        const proceed = await new Promise<boolean>((resolve) => {
          if (Platform.OS === 'web') return resolve(true);
          Alert.alert(t('home.locationConsentTitle'), t('request.locationWhy'), [
            { text: t('home.locationDeny'), style: 'cancel', onPress: () => resolve(false) },
            { text: t('home.locationAllow'), onPress: () => resolve(true) },
          ]);
        });
        if (!proceed) return;
        await ensureLocationPermission(); // pings degrade gracefully if denied
        await api(`/events/${activeEventId}/availability`, {
          method: 'PUT',
          token,
          body:
            duration === 'event_end'
              ? { on: true, untilEventEnd: true }
              : { on: true, durationMinutes: duration },
        });
      } else {
        await api(`/events/${activeEventId}/availability`, {
          method: 'PUT',
          token,
          body: { on: false },
        });
        await api(`/events/${activeEventId}/location`, { method: 'DELETE', token }).catch(
          () => {},
        );
      }
      void qc.invalidateQueries({ queryKey: qk.availability(activeEventId) });
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setToggling(false);
    }
  };

  // Second trigger for the attendance flow: opening the app on the day of an
  // event you already joined. Runs once per event per day (the flow records the
  // answer), so it prompts rather than nags.
  const asked = React.useRef<string | null>(null);
  React.useEffect(() => {
    const ev = event.data;
    if (!ev || asked.current === ev.id) return;
    void shouldAskAttendance(ev).then((ask) => {
      if (!ask) return;
      asked.current = ev.id;
      router.push(`/attend/${ev.id}`);
    });
  }, [event.data, router]);

  // Throttled coarse pings while helping; auto-off after long background.
  useLocationPings(activeEventId, helpingOn, () => void setAvailability(false));

  // The header is shared by every tab now — it owns the safe-area inset, the
  // menu, the wordmark and the bell, so no screen invents its own top edge.
  const header = (
    <View>
      <AppHeader />
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <Body color={th.colors.textSecondary}>{t(`greeting.${timeOfDayKey()}`)},</Body>
        <Heading style={{ fontWeight: '700' }}>{me?.pseudonym ?? '…'} 👋</Heading>
      </View>
    </View>
  );

  if (!activeEventId) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: spacing.xl,
          paddingTop: 0,
          gap: spacing.md,
        }}
      >
        {header}
        <View style={{ flex: 1, justifyContent: 'center', gap: spacing.md }}>
          <Heading center>{t('home.noEventTitle')}</Heading>
          <Muted center>{t('home.noEventBody')}</Muted>
          <Button title={t('events.discover')} onPress={() => router.push('/(tabs)/events')} />
        </View>
      </View>
    );
  }

  const ev = event.data;
  const activeRequests = (requests.data?.items ?? []).filter((r) =>
    ['searching', 'offering', 'matched', 'partially_fulfilled', 'no_match', 'expired'].includes(
      r.status,
    ),
  );
  const activeRequest = activeRequests[0];
  const requestMatch = activeRequest
    ? (matches.data?.items ?? []).find((m) => m.requestId === activeRequest.id)
    : undefined;
  const activeMatches = (matches.data?.items ?? []).filter(
    (m) => m.status === 'active' && m.eventId === activeEventId,
  );
  const topNeeds = (dashboard.data?.needs ?? [])
    .filter((n) => n.level === 'critical_shortage' || n.level === 'high_need' || n.level === 'moderate_need')
    .slice(0, 3);

  return (
    <ScrollView
      contentContainerStyle={{
        padding: spacing.lg,
        paddingTop: 0,
        gap: spacing.md,
        paddingBottom: spacing.xxl,
      }}
      refreshControl={
        <RefreshControl
          refreshing={event.isRefetching}
          onRefresh={() => {
            void event.refetch();
            void dashboard.refetch();
            void requests.refetch();
            void matches.refetch();
          }}
        />
      }
    >
      {header}

      {joined.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {joined.map((j) => (
            <Chip
              key={j.id}
              label={j.title}
              selected={j.id === activeEventId}
              onPress={() => setActiveEventId(j.id)}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* Live offer, above the mockup's cards and only while one exists. An offer
          expires in seconds, so it cannot wait behind a tab. */}
      {(offers.data?.items ?? []).map((offer) => (
        <MockCard
          key={offer.id}
          onPress={() => router.push(`/offer/${offer.id}`)}
          accessibilityLabel={t('offer.title')}
          style={{ borderWidth: 1, borderColor: th.colors.warning }}
        >
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <H3 style={{ flex: 1 }}>{t('offer.title')}</H3>
            <Badge label={t('offer.respondNow')} tone="warn" />
          </Row>
          <MutedCaption>{categoryName(categoryBySlug(catalogue.data?.categories, offer.categorySlug), locale)}</MutedCaption>
        </MockCard>
      ))}

      {/*
        Asking for help is the whole point of the app for the person in need,
        and until now it had no entry point anywhere in the mobile UI — the
        screen existed but nothing routed to it. It sits above "Helping now"
        because someone who is short of something is in more of a hurry than
        someone deciding whether to offer.
      */}
      <MockCard
        onPress={() => router.push('/request/new')}
        accessibilityLabel={t('home.requestHelp')}
        style={{ backgroundColor: th.colors.primary, paddingVertical: spacing.md }}
      >
        <Row gap={spacing.md} style={{ alignItems: 'center' }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: '#FFFFFF26',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="hand-heart" size={22} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <H3 color="#FFFFFF">{t('home.requestHelp')}</H3>
            <Body color="#FFFFFFCC">{t('home.requestHelpHint')}</Body>
          </View>
          <Icon name="chevron-right" size={20} color="#FFFFFFCC" />
        </Row>
      </MockCard>

      {/* "Helping now" — green when on, per the mockup. */}
      <MockCard
        style={{
          backgroundColor: helpingOn ? th.colors.successTint : th.colors.surface,
          borderWidth: helpingOn ? 0 : 1,
          borderColor: th.colors.border,
        }}
      >
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
          <Row gap={spacing.sm} style={{ flex: 1, alignItems: 'center' }}>
            {helpingOn ? <Icon name="check" size={18} color={th.colors.success} /> : null}
            <View style={{ flex: 1 }}>
              <H3 color={helpingOn ? th.colors.success : th.colors.text}>
                {t('activeEvent.helpingNow')}
              </H3>
              <MutedCaption>{t('activeEvent.helpingBody')}</MutedCaption>
            </View>
          </Row>
          <Switch
            value={helpingOn}
            onValueChange={(v) => void setAvailability(v)}
            disabled={toggling}
            accessibilityLabel={t('activeEvent.helpingNow')}
            trackColor={{ true: th.colors.success, false: th.colors.border }}
            thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
          />
        </Row>
      </MockCard>

      {/* Active request, with the match hint the mockup shows in green. */}
      {activeRequest ? (
        <MockCard
          onPress={() => router.push(`/request/${activeRequest.id}`)}
          accessibilityLabel={t('activeEvent.activeRequest')}
        >
          <MutedCaption>{t('activeEvent.activeRequest')}</MutedCaption>
          <Row gap={spacing.md} style={{ alignItems: 'center' }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: th.colors.warningTint,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CategoryEmoji slug={activeRequest.categorySlug} size={20} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <H3>{categoryName(categoryBySlug(catalogue.data?.categories, activeRequest.categorySlug), locale)}</H3>
              <MutedCaption>
                {t('needs.qtyNeeded', {
                  qty: Math.round(Number(activeRequest.qty)),
                  unit: activeRequest.unit,
                })}
              </MutedCaption>
              {requestMatch ? (
                <Body color={th.colors.success}>{t('activeEvent.newMatchFound')}</Body>
              ) : null}
            </View>
            <Icon name="chevron-right" size={20} color={th.colors.textSecondary} />
          </Row>
        </MockCard>
      ) : null}

      {/* Your supplies: a count and a row of glyphs, as drawn. */}
      <MockCard onPress={() => router.push('/(tabs)/supplies')} accessibilityLabel={t('activeEvent.yourSupplies')}>
        <MutedCaption>{t('activeEvent.yourSupplies')}</MutedCaption>
        <Row gap={spacing.md} style={{ alignItems: 'center' }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: th.colors.primaryTint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CategoryEmoji slug={supplyItems[0]?.categorySlug ?? 'container'} size={20} />
          </View>
          <H3 style={{ flex: 1 }}>
            {t('activeEvent.itemsAvailable', { count: supplyItems.length })}
          </H3>
          <Row gap={spacing.xs}>
            {supplyItems.slice(0, 4).map((i) => (
              <CategoryEmoji key={i.id} slug={i.categorySlug} size={18} />
            ))}
          </Row>
          <Icon name="chevron-right" size={20} color={th.colors.textSecondary} />
        </Row>
      </MockCard>

      {/* Active matches stay reachable: the mockup routes them through the
          match-found moment, but an in-progress match must not become
          unreachable if that screen was dismissed. */}
      {(matches.data?.items ?? []).map((m) => (
        <MockCard key={m.id} onPress={() => router.push(`/match/${m.id}`)} accessibilityLabel={t('match.matched')}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <H3 style={{ flex: 1 }}>{t('match.matched')}</H3>
            <Icon name="chevron-right" size={20} color={th.colors.textSecondary} />
          </Row>
          <MutedCaption>{categoryName(categoryBySlug(catalogue.data?.categories, m.categorySlug), locale)}</MutedCaption>
        </MockCard>
      ))}

      <Gap />
    </ScrollView>
  );
}

function RequestCard({ request, onPress }: { request: RequestView; onPress: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const catalogue = useCatalogue();
  const cat = categoryBySlug(catalogue.data?.categories, request.categorySlug);
  const statusLabel =
    request.status === 'searching' || request.status === 'offering'
      ? t('request.searching')
      : request.status === 'matched'
        ? t('match.matched')
        : request.status === 'partially_fulfilled'
          ? t('request.partial', { remaining: String(Math.max(0, request.qty - request.qtyFulfilled)) })
          : request.status === 'no_match'
            ? t('request.noMatch')
            : request.status === 'expired'
              ? t('request.expired')
              : t(`sync.${request.status === 'fulfilled' ? 'accepted' : 'submitted'}`);
  return (
    <ListRow
      accessibilityLabel={statusLabel}
      onPress={onPress}
      leading={<CategoryChip glyph={categoryGlyph(cat)} group={cat?.group} />}
      title={`${categoryName(cat, locale)} · ${request.qty} ${t(`units.${request.unit}`)}`}
      subtitle={
        request.status === 'searching' || request.status === 'offering'
          ? t('request.attempt', { count: request.attemptCount })
          : undefined
      }
      trailing={
        <Badge
          label={statusLabel}
          tone={
            request.status === 'matched'
              ? 'success'
              : request.status === 'searching' || request.status === 'offering'
                ? 'accent'
                : 'warn'
          }
        />
      }
    />
  );
}

function MatchRow({ match, onPress }: { match: MatchView; onPress: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const catalogue = useCatalogue();
  const cat = categoryBySlug(catalogue.data?.categories, match.categorySlug);
  return (
    <ListRow
      accessibilityLabel={`${match.peer.alias} · ${categoryName(cat, locale)}`}
      onPress={onPress}
      leading={<CategoryChip glyph={categoryGlyph(cat)} group={cat?.group} />}
      title={`${match.peer.alias} · ${categoryName(cat, locale)}`}
      subtitle={`${match.qtyReserved} ${t(`units.${match.unit}`)} · ${t(`match.${match.myMeetingState}`)}`}
      trailing={<Badge label={t(`proximity.${match.proximity}`)} tone="accent" />}
    />
  );
}
