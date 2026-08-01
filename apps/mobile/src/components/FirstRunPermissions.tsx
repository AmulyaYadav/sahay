import React, { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth';
import { useT } from '../locale';
import { registerForPush } from '../push';
import { mockRadius, spacing, useTheme } from '../theme';
import { Body, BodyBold, Row, Title } from './ui';
import { GhostLink, PrimaryCta } from './mock';
import { Icon } from './icons';

/**
 * First-run permissions, shown once after sign-in.
 *
 * Notifications are the only permission asked for here, and it is asked with a
 * reason on screen BEFORE the OS dialog. That ordering matters: the system
 * prompt can only be shown once per install, so firing it cold wastes the single
 * chance and a decline is then only recoverable through device settings.
 *
 * It runs after sign-in rather than at literal first launch because registering
 * a device needs a session — there is nothing to attach a push token to before
 * an account exists.
 *
 * Location is deliberately NOT asked for here. It is requested when availability
 * is switched on, where the reason is visible and immediate; asking for someone's
 * location on first run, before they have joined anything, is exactly the kind of
 * ask this app should not make.
 */
const SEEN_KEY = 'sahay.permissionsPrompted.v1';

export function FirstRunPermissions() {
  const t = useT();
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    AsyncStorage.getItem(SEEN_KEY)
      .then((v) => {
        if (alive && !v) setVisible(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

  // Recorded on either answer: this is a one-time ask, not a recurring nag.
  const dismiss = async () => {
    await AsyncStorage.setItem(SEEN_KEY, '1').catch(() => {});
    setVisible(false);
  };

  const allow = async () => {
    setBusy(true);
    try {
      if (token) await registerForPush(token);
    } finally {
      setBusy(false);
      void dismiss();
    }
  };

  if (!visible) return null;

  const reason = (icon: 'bell' | 'hand-heart' | 'clock', text: string) => (
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
