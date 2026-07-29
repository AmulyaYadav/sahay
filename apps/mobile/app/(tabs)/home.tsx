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
  useMyRequests,
} from '../../src/hooks';
import { ensureLocationPermission, useLocationPings } from '../../src/locationPings';
import { useLocale, useT } from '../../src/locale';
import { categoryBySlug, categoryGlyph, categoryName } from '../../src/catalogue';
import { formatDateTime, minutesUntil } from '../../src/format';
import { spacing, TOUCH, useTheme } from '../../src/theme';
import { Icon } from '../../src/components/icons';
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

  const greeting = (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <View style={{ flex: 1 }}>
        <Heading>{t(`greeting.${timeOfDayKey()}`)},</Heading>
        <Heading style={{ fontWeight: '700' }}>{me?.pseudonym ?? '…'} 👋</Heading>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('notifications.title')}
        onPress={() => router.push('/settings/notifications')}
        style={({ pressed }) => ({
          width: TOUCH,
          height: TOUCH,
          borderRadius: TOUCH / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? th.colors.cardAlt : th.colors.surface,
          borderWidth: 1,
          borderColor: th.colors.border,
        })}
      >
        <Icon name="bell" size={20} color={th.colors.text} />
      </Pressable>
    </Row>
  );

  if (!activeEventId) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: spacing.xl,
          paddingTop: insets.top + spacing.lg,
          gap: spacing.md,
        }}
      >
        {greeting}
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
        paddingTop: insets.top + spacing.lg,
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
      {greeting}

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

      {/* Active event card (§4.2) */}
      <View
        style={{
          backgroundColor: th.colors.surface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: th.colors.border,
          padding: spacing.lg,
          gap: spacing.sm,
        }}
      >
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <H3 style={{ flex: 1 }}>
            {ev?.title ?? joined.find((j) => j.id === activeEventId)?.title ?? '…'}
          </H3>
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
          <View style={{ gap: spacing.xs }}>
            <Row gap={spacing.sm}>
              <Icon name="calendar" size={16} color={th.colors.textSecondary} />
              <MutedCaption style={{ flex: 1 }}>
                {formatDateTime(ev.startsAt, locale)} – {formatDateTime(ev.endsAt, locale)}
              </MutedCaption>
            </Row>
            <Row gap={spacing.sm}>
              <Icon name="map-pin" size={16} color={th.colors.textSecondary} />
              <MutedCaption style={{ flex: 1 }}>{ev.areaLabel}</MutedCaption>
            </Row>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.viewEvent')}
          onPress={() => router.push(`/event/${activeEventId}`)}
          style={({ pressed }) => ({
            minHeight: TOUCH,
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Body color={th.colors.primary} style={{ fontWeight: '500' }}>
            {t('home.viewEvent')} →
          </Body>
        </Pressable>
      </View>

      {/* Event notices (§4.3) */}
      {(ev?.notices ?? []).map((n) => (
        <View
          key={n.id}
          style={{
            backgroundColor: th.colors.warningTint,
            borderRadius: 16,
            padding: spacing.lg,
            flexDirection: 'row',
            gap: spacing.md,
          }}
        >
          <Icon name="alert" size={20} color={th.colors.warning} />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Body>{n.body}</Body>
            <MutedCaption>{formatDateTime(n.createdAt, locale)}</MutedCaption>
          </View>
        </View>
      ))}

      {/* Helping now (§4.4) */}
      <View
        style={{
          backgroundColor: helpingOn ? th.colors.primaryTint : th.colors.surface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: helpingOn ? 'transparent' : th.colors.border,
          padding: spacing.lg,
          gap: spacing.sm,
        }}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <H3>{t('availability.helpingNow')}</H3>
          <Switch
            accessibilityLabel={t('availability.helpingNow')}
            accessibilityRole="switch"
            value={helpingOn}
            disabled={toggling || !ev || ev.status !== 'active'}
            onValueChange={(v) => void setAvailability(v)}
            trackColor={{ true: th.colors.primary, false: th.colors.border }}
            thumbColor={th.colors.surface}
          />
        </Row>
        <Muted>{helpingOn ? t('availability.on') : t('availability.off')}</Muted>
        {helpingOn ? <MutedCaption>{t('home.locationSharing')}</MutedCaption> : null}
        {helpingOn && availability.data?.until ? (
          <MutedCaption>
            {`${formatDateTime(availability.data.until, locale)} · ${t('misc.minutes', {
              count: minutesUntil(availability.data.until),
            })}`}
          </MutedCaption>
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
      </View>

      {/* Quick actions (§4.5) */}
      <H3>{t('home.quickActions')}</H3>
      <Row gap={spacing.md} style={{ alignItems: 'stretch' }}>
        <QuickActionTile
          icon="hand-heart"
          iconBg={th.colors.primaryTint}
          iconColor={th.colors.primary}
          title={t('home.requestHelp')}
          subtitle={t('home.requestHelpHint')}
          onPress={() => router.push('/request/new')}
          accessibilityLabel={t('home.requestHelp')}
        />
        <QuickActionTile
          icon="backpack"
          iconBg={th.colors.successTint}
          iconColor={th.colors.success}
          title={t('home.addSupplies')}
          subtitle={t('home.addSuppliesHint')}
          onPress={() => router.push('/(tabs)/supplies')}
          accessibilityLabel={t('home.addSupplies')}
        />
      </Row>
      <Button
        title={t('bring.title')}
        variant="secondary"
        onPress={() => router.push(`/event/${activeEventId}?focus=bring`)}
      />

      {/* Active request(s) */}
      {activeRequests.length > 0 ? <H3>{t('home.myRequest')}</H3> : null}
      {activeRequests.map((r) => (
        <RequestCard key={r.id} request={r} onPress={() => router.push(`/request/${r.id}`)} />
      ))}

      {/* Active matches */}
      {activeMatches.length > 0 ? <H3>{t('home.myMatches')}</H3> : null}
      {activeMatches.map((m) => (
        <MatchRow key={m.id} match={m} onPress={() => router.push(`/match/${m.id}`)} />
      ))}

      {/* Top shortages */}
      {topNeeds.length > 0 ? (
        <>
          <H3>{t('home.topNeeds')}</H3>
          {topNeeds.map((n) => {
            const cat = categoryBySlug(catalogue.data?.categories, n.categorySlug);
            return (
              <ListRow
                key={n.categoryId}
                leading={<CategoryChip glyph={categoryGlyph(cat)} group={cat?.group} />}
                title={categoryName(cat, locale)}
                trailing={<NeedPill level={n.level} label={t(`shortage.${n.level}`)} />}
                chevron={false}
              />
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
