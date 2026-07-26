import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Switch } from 'react-native';
import { NOTIFICATION_TYPES, type NotificationType } from '@sahay/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { qk, useNotificationPrefs, type NotificationPrefs } from '../../src/hooks';
import { useT } from '../../src/locale';
import { spacing, useTheme } from '../../src/theme';
import { Body, BodyBold, Card, LoadingView, MutedCaption, Row } from '../../src/components/ui';

export default function NotificationPrefsScreen() {
  const t = useT();
  const th = useTheme();
  const qc = useQueryClient();
  const { token } = useAuth();
  const prefsQuery = useNotificationPrefs();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  useEffect(() => {
    if (prefsQuery.data && !prefs) setPrefs(prefsQuery.data);
  }, [prefsQuery.data, prefs]);

  if (!prefs) return <LoadingView />;

  const save = async (next: NotificationPrefs) => {
    setPrefs(next);
    try {
      await api('/me/notification-prefs', { method: 'PUT', token, body: next });
      void qc.invalidateQueries({ queryKey: qk.notificationPrefs });
    } catch {
      Alert.alert(t('common.error'));
    }
  };

  const typeEnabled = (type: NotificationType) => prefs.perType[type] !== false;

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Body style={{ flex: 1 }}>{t('notifications.detailedPreviews')}</Body>
          <Switch
            accessibilityLabel={t('notifications.detailedPreviews')}
            value={prefs.detailedPreviews}
            onValueChange={(v) => void save({ ...prefs, detailedPreviews: v })}
            trackColor={{ true: th.colors.accent, false: th.colors.border }}
          />
        </Row>
        {/* Vague-by-default explanation */}
        <MutedCaption>{t('notifications.detailExplain')}</MutedCaption>
      </Card>

      <Card>
        <BodyBold>{t('notifications.title')}</BodyBold>
        {NOTIFICATION_TYPES.map((type) => (
          <Row key={type} style={{ justifyContent: 'space-between', minHeight: 44 }}>
            <Body style={{ flex: 1 }}>{t(`notifications.${type}`)}</Body>
            <Switch
              accessibilityLabel={t(`notifications.${type}`)}
              value={typeEnabled(type)}
              onValueChange={(v) =>
                void save({ ...prefs, perType: { ...prefs.perType, [type]: v } })
              }
              trackColor={{ true: th.colors.accent, false: th.colors.border }}
            />
          </Row>
        ))}
      </Card>
    </ScrollView>
  );
}
