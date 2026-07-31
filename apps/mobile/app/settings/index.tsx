import React, { useState } from 'react';
import { Alert, Platform, ScrollView, Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Locale, Me } from '@sahay/shared';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useLocale, useT } from '../../src/locale';
import { spacing, useTheme } from '../../src/theme';
import {
  Body,
  BodyBold,
  Button,
  Card,
  Chip,
  Field,
  Gap,
  Heading,
  ListRow,
  MutedCaption,
  Row,
} from '../../src/components/ui';

export default function SettingsScreen() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const { locale, setLocale } = useLocale();
  const { token, me, setMe, signOut } = useAuth();

  const [busy, setBusy] = useState<string | null>(null);
  const [deleteText, setDeleteText] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  const changeLocale = async (l: Locale) => {
    setLocale(l);
    try {
      const updated = await api<Me>('/me', { method: 'PATCH', token, body: { locale: l } });
      setMe(updated);
    } catch {
      /* local change still applies */
    }
  };

  const regenPseudonym = () => {
    Alert.alert(t('settings.newPseudonym'), t('settings.pseudonymNote'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        onPress: () => {
          void (async () => {
            setBusy('pseudonym');
            try {
              const updated = await api<Me>('/me', {
                method: 'PATCH',
                token,
                body: { regeneratePseudonym: true },
              });
              setMe(updated);
              Alert.alert(t('auth.welcome', { pseudonym: updated.pseudonym }));
            } catch (err) {
              Alert.alert((err as Error).message || t('errors.rate_limited'));
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  };

  const exportData = async () => {
    setBusy('export');
    try {
      let res = await api<{ status: string; downloadUrl: string | null }>('/me/export', {
        method: 'POST',
        token,
      });
      // Poll briefly until ready.
      for (let i = 0; i < 10 && res.status !== 'ready'; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        res = await api<{ status: string; downloadUrl: string | null }>('/me/export', { token });
      }
      if (res.status === 'ready' && res.downloadUrl) {
        const fileRes = await fetch(res.downloadUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await fileRes.text();
        if (Platform.OS !== 'web') await Share.share({ message: json });
        else Alert.alert(t('settings.exportReady'));
      } else {
        Alert.alert(t('settings.exportPending'));
      }
    } catch (err) {
      Alert.alert((err as Error).message || t('common.error'));
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    if (!me || deleteText.trim() !== me.pseudonym) return;
    setBusy('delete');
    try {
      await api('/me/delete', {
        method: 'POST',
        token,
        body: { confirmPseudonym: deleteText.trim() },
      });
      await signOut({ revokeServerSession: false });
      router.replace('/');
    } catch (err) {
      Alert.alert((err as Error).message || t('common.error'));
      setBusy(null);
    }
  };

  const logout = async () => {
    await signOut();
    router.replace('/');
  };

  const link = (label: string, path: string) => (
    <ListRow title={label} accessibilityLabel={label} onPress={() => router.push(path as never)} />
  );

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      {/* Language */}
      <Card>
        <BodyBold>{t('settings.language')}</BodyBold>
        <Row gap={spacing.sm}>
          <Chip label="English" selected={locale === 'en'} onPress={() => void changeLocale('en')} />
          <Chip label="हिन्दी" selected={locale === 'hi'} onPress={() => void changeLocale('hi')} />
        </Row>
      </Card>

      {link(t('settings.notificationPrefs'), '/settings/notifications')}
      {link(t('settings.privacy'), '/settings/privacy')}
      {link(t('settings.blocked'), '/settings/blocked')}
      {link(t('settings.devices'), '/settings/sessions')}
      {link(t('safety.guidance'), '/settings/safety')}
      {link(t('settings.legal'), '/settings/legal')}

      {/* Pseudonym */}
      <Card>
        <BodyBold>{me?.pseudonym}</BodyBold>
        <MutedCaption>{t('settings.pseudonymNote')}</MutedCaption>
        <Button
          title={t('settings.newPseudonym')}
          variant="secondary"
          loading={busy === 'pseudonym'}
          onPress={regenPseudonym}
        />
      </Card>

      {/* Data export */}
      <Card>
        <BodyBold>{t('settings.exportData')}</BodyBold>
        <Button
          title={t('settings.exportStart')}
          variant="secondary"
          loading={busy === 'export'}
          onPress={() => void exportData()}
        />
        {busy === 'export' ? <MutedCaption>{t('settings.exportPending')}</MutedCaption> : null}
      </Card>

      <Button title={t('auth.logout')} variant="dangerSoft" onPress={() => void logout()} />

      {/* Delete account */}
      <Card tone="danger">
        <Heading>{t('settings.deleteAccount')}</Heading>
        <Body>{t('settings.deleteWarning')}</Body>
        {!showDelete ? (
          <Button title={t('settings.deleteAccount')} variant="danger" onPress={() => setShowDelete(true)} />
        ) : (
          <View style={{ gap: spacing.md }}>
            <Field
              label={t('settings.deleteConfirm', { pseudonym: me?.pseudonym ?? '' })}
              value={deleteText}
              onChangeText={setDeleteText}
              autoCapitalize="none"
            />
            {deleteText.trim().length > 0 && me && deleteText.trim() !== me.pseudonym ? (
              <Body color={th.colors.danger}>{t('settings.deleteMismatch')}</Body>
            ) : null}
            <Row gap={spacing.sm}>
              <Button
                title={t('common.confirm')}
                variant="danger"
                loading={busy === 'delete'}
                disabled={!me || deleteText.trim() !== me.pseudonym}
                onPress={() => void deleteAccount()}
                style={{ flex: 1 }}
              />
              <Button title={t('common.cancel')} variant="ghost" onPress={() => setShowDelete(false)} />
            </Row>
          </View>
        )}
      </Card>
      <Gap />
      <MutedCaption center color={th.colors.muted}>
        Sahay · {t('common.tagline')}
      </MutedCaption>
    </ScrollView>
  );
}
