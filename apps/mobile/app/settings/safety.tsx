import React from 'react';
import { ScrollView } from 'react-native';
import { useT } from '../../src/locale';
import { spacing } from '../../src/theme';
import { Body, BodyBold, Card } from '../../src/components/ui';

const SAFETY_KEYS = [
  'safety.meetPublic',
  'safety.noContactShare',
  'safety.inspectSealed',
  'safety.noOpened',
  'safety.canCancel',
  'safety.notVerifiedPlatform',
  'safety.reportSuspicious',
  'safety.notEmergency',
] as const;

export default function SafetyScreen() {
  const t = useT();
  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      <Card>
        {SAFETY_KEYS.map((k) => (
          <Body key={k}>• {t(k)}</Body>
        ))}
      </Card>
      <Card tone="danger">
        <BodyBold>{t('request.medicalTitle')}</BodyBold>
        <Body>{t('request.medicalBody')}</Body>
      </Card>
    </ScrollView>
  );
}
