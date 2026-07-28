import React from 'react';
import { ScrollView } from 'react-native';
import { useT } from '../../src/locale';
import { spacing } from '../../src/theme';
import { Body, BodyBold, Card, MutedCaption } from '../../src/components/ui';

/**
 * Summarized legal content — mirrors the web /privacy and /guidelines pages
 * using the shared string catalog (single source of truth for the promises).
 */
export default function LegalScreen() {
  const t = useT();
  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      <Card>
        <BodyBold>{t('settings.privacy')}</BodyBold>
        <Body>{t('auth.emailWhy')}</Body>
        <Body>{t('request.locationWhy')}</Body>
        <Body>{t('onboarding.intro2')}</Body>
        <Body>{t('chat.expiresNote')}</Body>
        <Body>{t('settings.deleteWarning')}</Body>
      </Card>

      <Card>
        <BodyBold>{t('safety.guidance')}</BodyBold>
        <Body>{t('onboarding.intro3')}</Body>
        <Body>{t('safety.notVerifiedPlatform')}</Body>
        <Body>{t('safety.notEmergency')}</Body>
        <Body>{t('request.safetyAck')}</Body>
      </Card>

      <Card>
        <BodyBold>{t('common.approximate')}</BodyBold>
        <Body>{t('bring.subtitle')}</Body>
      </Card>

      <MutedCaption center>{t('common.tagline')}</MutedCaption>
    </ScrollView>
  );
}
