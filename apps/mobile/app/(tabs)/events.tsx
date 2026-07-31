import React, { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { EventSummary } from '@sahay/shared';
import { api, ApiRequestError, isOfflineError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useEventSearch } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { shortDateRange } from '../../src/format';
import { mockRadius, spacing, useTheme } from '../../src/theme';
import { ActiveBadge, MetaRow, MockCard } from '../../src/components/mock';
import { Icon } from '../../src/components/icons';
import {
  Body,
  BodyBold,
  Button,
  Caption,
  EmptyState,
  Field,
  Heading,
  LoadingView,
  MutedCaption,
  Row,
  Title,
} from '../../src/components/ui';

/**
 * Mockup 1 — "Find an Event".
 *
 * Wordmark + tagline, a single search field, then the event list. The mockup
 * replaces the old visible "enter event code" field with a hint to ask an
 * organiser, so that field now lives behind the hint card: tapping it reveals
 * the input. Joining by code is existing functionality and had to be kept.
 */
export default function EventsScreen() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const { locale } = useLocale();
  const { token } = useAuth();

  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const search = useEventSearch(q);

  const openByCode = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setCodeBusy(true);
    setCodeError(null);
    try {
      const ev = await api<EventSummary>(`/events/${encodeURIComponent(trimmed)}`, { token });
      router.push(`/event/${ev.id}`);
      setCode('');
    } catch (err) {
      if (isOfflineError(err)) setCodeError(t('common.offline'));
      else if (err instanceof ApiRequestError && err.status === 404) setCodeError(t('errors.not_found'));
      else setCodeError(t('common.error'));
    } finally {
      setCodeBusy(false);
    }
  };

  const items = search.data?.items ?? [];

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{
        padding: spacing.lg,
        gap: spacing.md,
        paddingBottom: spacing.xxl,
        backgroundColor: th.colors.bg,
      }}
      ListHeaderComponent={
        <View style={{ gap: spacing.lg, marginBottom: spacing.xs }}>
          {/* Wordmark: mark + "Sahay सहारा", both scripts, exactly as drawn. */}
          <View style={{ gap: spacing.xs, alignItems: 'center', paddingTop: spacing.sm }}>
            <Row gap={spacing.sm} style={{ alignItems: 'center' }}>
              <Icon name="hand-heart" size={28} color={th.colors.primary} />
              <Title>{t('common.appName')}</Title>
            </Row>
            <Body color={th.colors.textSecondary}>{t('events.tagline')}</Body>
          </View>

          <Heading>{t('events.findNearYou')}</Heading>

          {/* Search field with the magnifier inside, right-aligned. */}
          <View style={{ position: 'relative', justifyContent: 'center' }}>
            <Field
              value={q}
              onChangeText={setQ}
              placeholder={t('events.searchPlaceholder')}
              autoCapitalize="none"
              accessibilityLabel={t('events.searchPlaceholder')}
              style={{ paddingRight: spacing.xxl + spacing.sm, borderRadius: mockRadius.input }}
            />
            <View style={{ position: 'absolute', right: spacing.md }} pointerEvents="none">
              <Icon name="search" size={20} color={th.colors.textSecondary} />
            </View>
          </View>

          {items.length > 0 ? <BodyBold>{t('events.popularNearYou')}</BodyBold> : null}
        </View>
      }
      renderItem={({ item }) => (
        <MockCard onPress={() => router.push(`/event/${item.id}`)} accessibilityLabel={item.title}>
          <Row style={{ alignItems: 'flex-start', gap: spacing.sm }}>
            <BodyBold style={{ flex: 1, fontSize: 17, lineHeight: 24 }}>{item.title}</BodyBold>
            {item.status === 'active' ? <ActiveBadge label={t('events.activeNow')} /> : null}
          </Row>
          <View style={{ gap: spacing.xs }}>
            <MetaRow icon="map-pin">{item.areaLabel}</MetaRow>
            <MetaRow icon="calendar">{shortDateRange(item.startsAt, item.endsAt, locale)}</MetaRow>
          </View>
        </MockCard>
      )}
      ListEmptyComponent={
        search.isLoading ? (
          <LoadingView />
        ) : (
          <EmptyState message={t('events.noResults')} variant="search" />
        )
      }
      ListFooterComponent={
        <View style={{ marginTop: spacing.md, gap: spacing.md }}>
          {/* The mockup's hint card. Tapping it opens the code field, so joining
              by code is still reachable without putting a second input on the
              screen the way the old layout did. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('events.cantFind')} ${t('events.askOrganizer')}`}
            onPress={() => setCodeOpen((v) => !v)}
            style={{
              backgroundColor: th.colors.primaryTint,
              borderRadius: mockRadius.card,
              padding: spacing.lg,
              gap: 2,
            }}
          >
            <Body color={th.colors.textSecondary}>{t('events.cantFind')}</Body>
            <Body color={th.colors.textSecondary}>{t('events.askOrganizer')}</Body>
          </Pressable>

          {codeOpen ? (
            <View style={{ gap: spacing.sm }}>
              <Field
                label={t('events.joinByCode')}
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                placeholder="MELA-7K2F"
                style={{ borderRadius: mockRadius.input }}
              />
              {codeError ? <Caption color={th.colors.danger}>{codeError}</Caption> : null}
              <Button title={t('common.search')} onPress={() => void openByCode()} loading={codeBusy} />
            </View>
          ) : null}

          <MutedCaption center>{t('events.participantsHidden')}</MutedCaption>
        </View>
      }
    />
  );
}
