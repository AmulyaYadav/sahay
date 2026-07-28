import React from 'react';
import { ScrollView } from 'react-native';
import { useConsents } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { formatDateTime } from '../../src/format';
import { spacing } from '../../src/theme';
import { Badge, Body, BodyBold, Card, MutedCaption, Row } from '../../src/components/ui';

export default function PrivacyScreen() {
  const t = useT();
  const { locale } = useLocale();
  const consents = useConsents();

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      {/* Location: what is collected and why */}
      <Card>
        <BodyBold>{t('settings.location')}</BodyBold>
        <Body>{t('settings.locationExplain')}</Body>
      </Card>

      {/* Email */}
      <Card>
        <BodyBold>{t('auth.emailLabel')}</BodyBold>
        <Body>{t('auth.emailWhy')}</Body>
      </Card>

      {/* Pseudonymity */}
      <Card>
        <BodyBold>{t('common.appName')}</BodyBold>
        <Body>{t('onboarding.intro2')}</Body>
        <Body>{t('events.participantsHidden')}</Body>
        <Body>{t('chat.expiresNote')}</Body>
      </Card>

      {/* Consents on record */}
      <Card>
        <BodyBold>{t('settings.consentsTitle')}</BodyBold>
        {consents.data && consents.data.items.length === 0 ? (
          <MutedCaption>{t('settings.noConsents')}</MutedCaption>
        ) : null}
        {(consents.data?.items ?? []).map((c, i) => (
          <Row key={`${c.kind}-${i}`} style={{ justifyContent: 'space-between' }}>
            <Body style={{ flex: 1 }}>{c.kind}</Body>
            <Badge
              label={c.granted ? t('common.ok') : t('common.cancel')}
              tone={c.granted ? 'success' : 'default'}
            />
            <MutedCaption>{formatDateTime(c.createdAt, locale)}</MutedCaption>
          </Row>
        ))}
      </Card>
    </ScrollView>
  );
}
