import React, { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { qk, useSessions } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { formatDateTime } from '../../src/format';
import { spacing } from '../../src/theme';
import {
  Badge,
  BodyBold,
  Button,
  Card,
  EmptyState,
  LoadingView,
  MutedCaption,
  Row,
} from '../../src/components/ui';

export default function SessionsScreen() {
  const t = useT();
  const { locale } = useLocale();
  const { token } = useAuth();
  const qc = useQueryClient();
  const sessions = useSessions();
  const [busy, setBusy] = useState<string | null>(null);

  if (sessions.isLoading) return <LoadingView />;
  const items = sessions.data ?? [];

  const revoke = async (id: string) => {
    setBusy(id);
    try {
      await api(`/auth/sessions/${id}`, { method: 'DELETE', token });
      void qc.invalidateQueries({ queryKey: qk.sessions });
    } catch (err) {
      Alert.alert((err as Error).message || t('common.error'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      {items.length === 0 ? <EmptyState message={t('errors.not_found')} /> : null}
      {items.map((s) => (
        <Card key={s.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <BodyBold>
              {s.deviceName ?? s.platform}
            </BodyBold>
            {s.current ? <Badge label={t('settings.thisDevice')} tone="success" /> : null}
          </Row>
          <MutedCaption>
            {s.platform} · {formatDateTime(s.lastSeenAt, locale)}
          </MutedCaption>
          {!s.current ? (
            <Button
              title={t('settings.revoke')}
              variant="danger"
              small
              loading={busy === s.id}
              onPress={() => void revoke(s.id)}
            />
          ) : null}
        </Card>
      ))}
    </ScrollView>
  );
}
