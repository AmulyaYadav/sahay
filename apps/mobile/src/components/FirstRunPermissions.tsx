import React, { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../locale';
import { ensureLocationPermission } from '../locationPings';
import { requestPushPermission } from '../push';
import { mockRadius, spacing, useTheme } from '../theme';
import { Body, BodyBold, Row, Title } from './ui';
import { GhostLink, PrimaryCta } from './mock';
import { Icon, type IconName } from './icons';

/**
 * First-run permissions, shown once at first launch.
 *
 * Notifications and coarse location are both asked for here, with the reasons on
 * screen BEFORE the OS dialogs. That ordering matters: the system
 * prompt can only be shown once per install, so firing it cold wastes the single
 * chance and a decline is then only recoverable through device settings.
 *
 * Runs at first launch, before sign-in. The OS permissions do not need a session,
 * so they are requested here; the device is registered for push separately and
 * silently once an account exists and permission is already granted, which adds
 * no second prompt.
 *
 * Location is asked for here too, by explicit product decision. Worth knowing
 * what that costs: at first launch there is no event and no context, so the
 * reason on screen is the only justification the person gets, and a decline is
 * only recoverable through device settings. Coarse location is still requested
 * again at the point availability is switched on, so declining here does not
 * break that flow.
 */
const SEEN_KEY = 'sahay.permissionsPrompted.v1';

export function FirstRunPermissions() {
  const t = useT();
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(SEEN_KEY)
      .then((v) => {
        if (alive && !v) setVisible(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Recorded on either answer: this is a one-time ask, not a recurring nag.
  const dismiss = async () => {
    await AsyncStorage.setItem(SEEN_KEY, '1').catch(() => {});
    setVisible(false);
  };

  const allow = async () => {
    setBusy(true);
    try {
      // Sequential, not parallel: two system dialogs racing each other is
      // confusing, and on Android the second can be dropped entirely.
      await requestPushPermission();
      await ensureLocationPermission();
    } finally {
      setBusy(false);
      void dismiss();
    }
  };

  if (!visible) return null;

  const reason = (icon: IconName, text: string) => (
    <Row key={icon} gap={spacing.md} style={{ alignItems: 'flex-start' }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: mockRadius.input,
          backgroundColor: th.colors.primaryTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={18} color={th.colors.primary} />
      </View>
      <Body style={{ flex: 1 }} color={th.colors.textSecondary}>
        {text}
      </Body>
    </Row>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => void dismiss()}>
      <View style={{ flex: 1, backgroundColor: '#0B1220A6', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: th.colors.surface,
            borderTopLeftRadius: mockRadius.sheet,
            borderTopRightRadius: mockRadius.sheet,
            padding: spacing.xl,
            paddingBottom: insets.bottom + spacing.xl,
            gap: spacing.lg,
          }}
        >
          <View style={{ gap: spacing.sm }}>
            <Title>{t('permissions.title')}</Title>
            <Body color={th.colors.textSecondary}>{t('permissions.body')}</Body>
          </View>

          <View style={{ gap: spacing.md }}>
            {reason('clock', t('permissions.reasonAttendance'))}
            {reason('hand-heart', t('permissions.reasonOffers'))}
            {reason('bell', t('permissions.reasonMessages'))}
            {reason('map-pin', t('permissions.reasonLocation'))}
          </View>

          <BodyBold color={th.colors.textSecondary} style={{ fontSize: 12 }}>
            {t('permissions.changeLater')}
          </BodyBold>

          <View style={{ gap: spacing.xs }}>
            <PrimaryCta title={t('permissions.allow')} onPress={() => void allow()} disabled={busy} />
            <GhostLink title={t('permissions.notNow')} onPress={() => void dismiss()} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
