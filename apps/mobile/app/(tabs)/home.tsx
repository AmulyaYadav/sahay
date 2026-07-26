import React, { useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
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
  useMyRequests,
} from '../../src/hooks';
import { ensureLocationPermission, useLocationPings } from '../../src/locationPings';
import { useLocale, useT } from '../../src/locale';
import { categoryBySlug, categoryName } from '../../src/catalogue';
import { formatDateTime } from '../../src/format';
import { spacing, useTheme } from '../../src/theme';
import {
  Badge,
  Body,
  BodyBold,
  Button,
  Card,
  Chip,
  EmptyState,
  Gap,
  Heading,
  Muted,
  MutedCaption,
  PressableRow,
  Row,
  StalenessNote,
} from '../../src/components/ui';

type Duration = 30 | 60 | 120 | 'event_end';

export default function HomeScreen() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { locale } = useLocale();
  const { token } = useAuth();
  const { joined, activeEventId, setActiveEventId } = useActiveEvent();

  const event = useEvent(activeEventId);
  const dashboard = useDashboard(activeEventId);
  const catalogue = useCatalogue();
  const availability = useAvailability(activeEventId);
  const requests = useMyRequests(activeEventId ?? undefined);
  const matches = useActiveMatches();

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

  // Throttled coarse pings while helping; auto-off after long background.
  useLocationPings(activeEventId, helpingOn, () => void setAvailability(false));

  if (!activeEventId) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md }}>
        <Heading center>{t('home.noEventTitle')}</Heading>
        <Muted center>{t('home.noEventBody')}</Muted>
        <Button title={t('events.discover')} onPress={() => router.push('/(tabs)/events')} />
      </View>
    );
  }

  const ev = event.data;
  const activeRequests = (requests.data?.items ?? []).filter((r) =>
    ['searching', 'offering', 'matched', 'partially_fulfilled', 'no_match', 'expired'].includes(
      r.status,
    ),
  );
  const activeMatches = (matches.data?.items ?? []).filter(
    (m) => m.status === 'active' && m.eventId === activeEventId,
  );
  const topNeeds = (dashboard.data?.needs ?? [])
    .filter((n) => n.level === 'critical_shortage' || n.level === 'high_need' || n.level === 'moderate_need')
    .slice(0, 3);

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
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

      {/* Active event card */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Heading>{ev?.title ?? joined.find((j) => j.id === activeEventId)?.title ?? '…'}</Heading>
          {ev ? (
            <Badge
              label={
                ev.status === 'active'
                  ? t('events.active')
                  : ev.status === 'paused'
                    ? t('events.paused')
                    : ev.status === 'completed' || ev.status === 'archived'
                      ? t('events.ended')
                      : ev.status
              }
              tone={ev.status === 'active' ? 'success' : ev.status === 'paused' ? 'warn' : 'default'}
            />
          ) : null}
        </Row>
        {ev ? (
          <>
            <Muted>{ev.areaLabel}</Muted>
            <MutedCaption>
              {formatDateTime(ev.startsAt, locale)} – {formatDateTime(ev.endsAt, locale)}
            </MutedCaption>
          </>
        ) : null}
        <PressableRow
          accessibilityLabel={t('home.viewEvent')}
          onPress={() => router.push(`/event/${activeEventId}`)}
          style={{ padding: spacing.sm, borderWidth: 0, backgroundColor: 'transparent', minHeight: 44 }}
        >
          <Body color={th.colors.accent}>{t('home.viewEvent')} →</Body>
        </PressableRow>
      </Card>

      {/* Event notices */}
      {(ev?.notices ?? []).map((n) => (
        <Card key={n.id} tone="warn">
          <Body>{n.body}</Body>
          <MutedCaption>{formatDateTime(n.createdAt, locale)}</MutedCaption>
        </Card>
      ))}

      {/* Helping Now */}
      <Card tone={helpingOn ? 'accent' : 'default'}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Heading>{t('availability.helpingNow')}</Heading>
          <Switch
            accessibilityLabel={t('availability.helpingNow')}
            accessibilityRole="switch"
            value={helpingOn}
            disabled={toggling || !ev || ev.status !== 'active'}
            onValueChange={(v) => void setAvailability(v)}
            trackColor={{ true: th.colors.accent, false: th.colors.border }}
            thumbColor={th.colors.card}
          />
        </Row>
        <Muted>{helpingOn ? t('availability.on') : t('availability.off')}</Muted>
        {helpingOn ? <MutedCaption>{t('home.locationSharing')}</MutedCaption> : null}
        {helpingOn && availability.data?.until ? (
          <MutedCaption>{formatDateTime(availability.data.until, locale)}</MutedCaption>
        ) : null}
        {!helpingOn ? (
          <Row style={{ flexWrap: 'wrap' }} gap={spacing.sm}>
            <Chip label={t('availability.for30')} selected={duration === 30} onPress={() => setDuration(30)} />
            <Chip label={t('availability.for60')} selected={duration === 60} onPress={() => setDuration(60)} />
            <Chip label={t('availability.for120')} selected={duration === 120} onPress={() => setDuration(120)} />
            <Chip
              label={t('availability.untilEventEnd')}
              selected={duration === 'event_end'}
              onPress={() => setDuration('event_end')}
            />
          </Row>
        ) : (
          <Button
            title={t('availability.stopNow')}
            variant="secondary"
            onPress={() => void setAvailability(false)}
            loading={toggling}
          />
        )}
      </Card>

      {/* Quick actions */}
      <Row gap={spacing.sm}>
        <Button
          title={t('home.requestHelp')}
          onPress={() => router.push('/request/new')}
          style={{ flex: 1 }}
        />
        <Button
          title={t('home.addSupplies')}
          variant="secondary"
          onPress={() => router.push('/(tabs)/supplies')}
          style={{ flex: 1 }}
        />
      </Row>
      <Button
        title={t('bring.title')}
        variant="secondary"
        onPress={() => router.push(`/event/${activeEventId}?focus=bring`)}
      />

      {/* Active request(s) */}
      {activeRequests.length > 0 ? <Heading>{t('home.myRequest')}</Heading> : null}
      {activeRequests.map((r) => (
        <RequestCard key={r.id} request={r} onPress={() => router.push(`/request/${r.id}`)} />
      ))}

      {/* Active matches */}
      {activeMatches.length > 0 ? <Heading>{t('home.myMatches')}</Heading> : null}
      {activeMatches.map((m) => (
        <MatchRow key={m.id} match={m} onPress={() => router.push(`/match/${m.id}`)} />
      ))}

      {/* Top shortages */}
      {topNeeds.length > 0 ? (
        <>
          <Heading>{t('home.topNeeds')}</Heading>
          {topNeeds.map((n) => {
            const cat = categoryBySlug(catalogue.data?.categories, n.categorySlug);
            return (
              <Card key={n.categoryId}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <BodyBold>{categoryName(cat, locale)}</BodyBold>
                  <Badge
                    label={t(`shortage.${n.level}`)}
                    tone={n.level === 'critical_shortage' ? 'danger' : n.level === 'high_need' ? 'warn' : 'default'}
                  />
                </Row>
              </Card>
            );
          })}
          <StalenessNote updatedAt={dashboard.data?.generatedAt ?? dashboard.dataUpdatedAt} />
        </>
      ) : null}
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
    <PressableRow accessibilityLabel={statusLabel} onPress={onPress}>
      <Row style={{ justifyContent: 'space-between' }}>
        <BodyBold>
          {categoryName(cat, locale)} · {request.qty} {t(`units.${request.unit}`)}
        </BodyBold>
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
      </Row>
      {request.status === 'searching' || request.status === 'offering' ? (
        <Muted>{t('request.attempt', { count: request.attemptCount })}</Muted>
      ) : null}
    </PressableRow>
  );
}

function MatchRow({ match, onPress }: { match: MatchView; onPress: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const catalogue = useCatalogue();
  const cat = categoryBySlug(catalogue.data?.categories, match.categorySlug);
  return (
    <PressableRow accessibilityLabel={`${match.peer.alias} · ${categoryName(cat, locale)}`} onPress={onPress}>
      <Row style={{ justifyContent: 'space-between' }}>
        <BodyBold>
          {match.peer.alias} · {categoryName(cat, locale)}
        </BodyBold>
        <Badge label={t(`proximity.${match.proximity}`)} tone="accent" />
      </Row>
      <Muted>
        {match.qtyReserved} {t(`units.${match.unit}`)} · {t(`match.${match.myMeetingState}`)}
      </Muted>
    </PressableRow>
  );
}
