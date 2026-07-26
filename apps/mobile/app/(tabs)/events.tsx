import React, { useState } from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { EventSummary } from '@sahay/shared';
import { api, ApiRequestError, isOfflineError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useEventSearch } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { formatDateTime } from '../../src/format';
import { spacing, useTheme } from '../../src/theme';
import {
  Badge,
  Body,
  BodyBold,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingView,
  Muted,
  MutedCaption,
  PressableRow,
  Row,
} from '../../src/components/ui';

export default function EventsScreen() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const { locale } = useLocale();
  const { token } = useAuth();

  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
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
      else if (err instanceof ApiRequestError && err.status === 404)
        setCodeError(t('errors.not_found'));
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
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      ListHeaderComponent={
        <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
          <Field
            label={t('events.discover')}
            placeholder={t('events.searchPlaceholder')}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
          />
          <Card>
            <BodyBold>{t('events.joinByCode')}</BodyBold>
            <Row gap={spacing.sm}>
              <View style={{ flex: 1 }}>
                <Field
                  placeholder="MELA-7K2F"
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </View>
              <Button
                title={t('common.search')}
                small
                onPress={() => void openByCode()}
                loading={codeBusy}
                disabled={!code.trim()}
              />
            </Row>
            {codeError ? <Body color={th.colors.danger}>{codeError}</Body> : null}
          </Card>
          <MutedCaption>{t('events.participantsHidden')}</MutedCaption>
        </View>
      }
      ListEmptyComponent={
        search.isLoading ? <LoadingView /> : <EmptyState message={t('events.noResults')} />
      }
      renderItem={({ item }) => (
        <PressableRow
          accessibilityLabel={item.title}
          onPress={() => router.push(`/event/${item.id}`)}
        >
          <Row style={{ justifyContent: 'space-between' }}>
            <BodyBold numberOfLines={1} style={{ flex: 1 }}>
              {item.title}
            </BodyBold>
            {item.joined ? <Badge label={t('events.joined')} tone="success" /> : null}
          </Row>
          <Muted>{item.areaLabel}</Muted>
          <MutedCaption>
            {t(`eventTypes.${item.type}`)} · {formatDateTime(item.startsAt, locale)} –{' '}
            {formatDateTime(item.endsAt, locale)}
          </MutedCaption>
        </PressableRow>
      )}
    />
  );
}
