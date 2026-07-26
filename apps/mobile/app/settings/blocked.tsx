import React from 'react';
import { ScrollView } from 'react-native';
import { useBlocks } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { formatDateTime } from '../../src/format';
import { spacing } from '../../src/theme';
import { Avatar, BodyBold, Card, EmptyState, LoadingView, MutedCaption, Row } from '../../src/components/ui';

export default function BlockedScreen() {
  const t = useT();
  const { locale } = useLocale();
  const blocks = useBlocks();

  if (blocks.isLoading) return <LoadingView />;
  const items = blocks.data?.blocks ?? [];

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      {items.length === 0 ? <EmptyState message={t('settings.noBlocked')} /> : null}
      {items.map((b, i) => (
        <Card key={`${b.alias}-${i}`}>
          <Row gap={spacing.md}>
            <Avatar seed={b.alias} size={36} />
            <BodyBold style={{ flex: 1 }}>{b.alias}</BodyBold>
          </Row>
          <MutedCaption>{formatDateTime(b.createdAt, locale)}</MutedCaption>
        </Card>
      ))}
      <MutedCaption>{t('reports.blocked')}</MutedCaption>
    </ScrollView>
  );
}
