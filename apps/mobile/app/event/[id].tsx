import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { EventDetail } from '@sahay/shared';
import { api, ApiRequestError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useActiveEvent } from '../../src/activeEvent';
import { qk, useBring, useCatalogue, useDashboard, useEvent } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { categoryBySlug, categoryGlyph, categoryName } from '../../src/catalogue';
import { formatDateTime } from '../../src/format';
import { getJson, setJson, K } from '../../src/storage';
import { spacing, useTheme } from '../../src/theme';
import {
  Badge,
  Body,
  BodyBold,
  Button,
  Card,
  CategoryChip,
  ErrorView,
  Field,
  Gap,
  Heading,
  ListRow,
  LoadingView,
  Muted,
  MutedCaption,
  NeedPill,
  Row,
  StalenessNote,
} from '../../src/components/ui';

type HiddenMap = Record<string, number | 'hidden'>; // categoryId → hidden / remind-after ts

export default function EventDetailScreen() {
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { locale } = useLocale();
  const { token } = useAuth();
  const { addJoined, removeJoined } = useActiveEvent();

  const event = useEvent(id);
  const dashboard = useDashboard(id);
  const catalogue = useCatalogue();
  const isMember = !!event.data?.membership;
  const bring = useBring(isMember ? id : null);

  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<HiddenMap>({});

  useEffect(() => {
    if (!id) return;
    void getJson<HiddenMap>(K.bringHidden(id)).then((m) => setHidden(m ?? {}));
  }, [id]);

  if (event.isLoading) return <LoadingView />;
  if (event.isError || !event.data)
    return <ErrorView onRetry={() => void event.refetch()} />;
  const ev: EventDetail = event.data;

  const join = async () => {
    if (!token) {
      router.push('/auth');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const joined = await api<EventDetail>(`/events/${ev.id}/join`, {
        method: 'POST',
        token,
        body: inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {},
      });
      await addJoined({ id: joined.id, code: joined.code, title: joined.title });
      void qc.invalidateQueries({ queryKey: qk.event(ev.id) });
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.message ? err.message : t('common.error'),
      );
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    Alert.alert(t('events.leave'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await api(`/events/${ev.id}/leave`, { method: 'POST', token });
            } catch {
              /* leaving is best-effort */
            }
            await removeJoined(ev.id);
            void qc.invalidateQueries({ queryKey: qk.event(ev.id) });
          })();
        },
      },
    ]);
  };

  const toggleMute = async () => {
    if (!ev.membership) return;
    try {
      await api(`/events/${ev.id}/mute`, {
        method: 'POST',
        token,
        body: { muted: !ev.membership.muted },
      });
      void qc.invalidateQueries({ queryKey: qk.event(ev.id) });
    } catch {
      Alert.alert(t('common.error'));
    }
  };

  const setHiddenFor = async (categoryId: string, value: number | 'hidden') => {
    const next = { ...hidden, [categoryId]: value };
    setHidden(next);
    await setJson(K.bringHidden(ev.id), next);
  };

  const visibleSuggestions = (bring.data?.suggestions ?? []).filter((s) => {
    const h = hidden[s.categoryId];
    if (h === 'hidden') return false;
    if (typeof h === 'number' && Date.now() < h) return false;
    return true;
  });

  return (
    <>
      <Stack.Screen options={{ title: ev.title }} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      >
        {/* Overview */}
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Heading style={{ flex: 1 }}>{ev.title}</Heading>
            <Badge
              label={
                ev.status === 'active'
                  ? t('events.active')
                  : ev.status === 'paused'
                    ? t('events.paused')
                    : t('events.ended')
              }
              tone={ev.status === 'active' ? 'success' : ev.status === 'paused' ? 'warn' : 'default'}
            />
          </Row>
          <Muted>
            {t(`eventTypes.${ev.type}`)} · {ev.areaLabel}
          </Muted>
          <MutedCaption>
            {t('eventPage.starts')}: {formatDateTime(ev.startsAt, locale)} · {t('eventPage.ends')}:{' '}
            {formatDateTime(ev.endsAt, locale)} · {ev.code}
          </MutedCaption>
          {ev.description ? <Body>{ev.description}</Body> : null}
          {ev.matchingPaused ? <Badge label={t('errors.event_paused')} tone="warn" /> : null}
        </Card>

        {/* Membership actions */}
        {!isMember ? (
          <Card>
            {ev.requiresInvite ? (
              <Field
                label={t('events.inviteCode')}
                value={inviteCode}
                onChangeText={setInviteCode}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            ) : null}
            {error ? <Body color={th.colors.danger}>{error}</Body> : null}
            <Button title={t('events.join')} onPress={() => void join()} loading={busy} />
          </Card>
        ) : (
          <Row gap={spacing.sm}>
            <Button
              title={ev.membership?.muted ? t('notifications.title') : t('events.mute')}
              variant="secondary"
              small
              onPress={() => void toggleMute()}
              style={{ flex: 1 }}
            />
            <Button title={t('events.leave')} variant="danger" small onPress={leave} style={{ flex: 1 }} />
          </Row>
        )}

        {/* Notices */}
        {ev.notices.map((n) => (
          <Card key={n.id} tone="warn">
            <Body>{n.body}</Body>
            <MutedCaption>{formatDateTime(n.createdAt, locale)}</MutedCaption>
          </Card>
        ))}

        {/* Safety */}
        {ev.safetyInfo ? (
          <Card>
            <BodyBold>{t('eventPage.safetyTitle')}</BodyBold>
            <Body>{ev.safetyInfo}</Body>
          </Card>
        ) : null}
        {ev.medicalInfo ? (
          <Card tone="danger">
            <BodyBold>{t('eventPage.medicalTitle')}</BodyBold>
            <Body>{ev.medicalInfo}</Body>
          </Card>
        ) : null}

        {/* Dashboard aggregates */}
        <Heading>{t('events.needsTitle')}</Heading>
        <MutedCaption>{t('common.approximate')}</MutedCaption>
        {dashboard.data && dashboard.data.needs.length === 0 ? (
          <Muted>{t('eventPage.dashboardEmpty')}</Muted>
        ) : null}
        {typeof dashboard.data?.recentFulfilments === 'number' &&
        dashboard.data.recentFulfilments > 0 ? (
          <Muted>
            {t('eventPage.recentFulfilments', { count: dashboard.data.recentFulfilments })}
          </Muted>
        ) : null}
        {(dashboard.data?.needs ?? []).map((n) => {
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

        {/* What should I bring */}
        {isMember ? (
          <View style={{ gap: spacing.md }}>
            <Heading>{t('bring.title')}</Heading>
            <MutedCaption>{t('bring.subtitle')}</MutedCaption>
            {visibleSuggestions.length === 0 && !bring.isLoading ? (
              <Muted>{t('shortage.unknown')}</Muted>
            ) : null}
            {visibleSuggestions.map((s) => {
              const cat = categoryBySlug(catalogue.data?.categories, s.categorySlug);
              return (
                <Card key={s.categoryId} tone={focus === 'bring' ? 'accent' : 'default'}>
                  <Row gap={spacing.md}>
                    <CategoryChip glyph={categoryGlyph(cat)} group={cat?.group} />
                    <BodyBold style={{ flex: 1 }}>{categoryName(cat, locale)}</BodyBold>
                    <NeedPill level={s.level} label={t(`shortage.${s.level}`)} />
                  </Row>
                  <MutedCaption>
                    {t('bring.needed', { count: `${s.suggestedQty} ${t(`units.${s.unit}`)}` })}
                  </MutedCaption>
                  <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
                    <Button
                      title={t('bring.canBring')}
                      small
                      onPress={() =>
                        router.push(
                          `/(tabs)/supplies?prefillCategoryId=${s.categoryId}&prefillQty=${s.suggestedQty}&eventId=${ev.id}`,
                        )
                      }
                    />
                    <Button
                      title={t('bring.later')}
                      variant="ghost"
                      small
                      onPress={() => void setHiddenFor(s.categoryId, Date.now() + 2 * 60 * 60 * 1000)}
                    />
                    <Button
                      title={t('bring.hide')}
                      variant="ghost"
                      small
                      onPress={() => void setHiddenFor(s.categoryId, 'hidden')}
                    />
                  </Row>
                </Card>
              );
            })}
          </View>
        ) : null}
        <Gap />
        <MutedCaption>{t('events.participantsHidden')}</MutedCaption>
      </ScrollView>
    </>
  );
}
