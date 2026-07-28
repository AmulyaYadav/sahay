import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth';
import { useCatalogue, useMyRequests, useNotifications } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { categoryBySlug, categoryName } from '../../src/catalogue';
import { formatDateTime, formatMonthYear } from '../../src/format';
import { spacing, useTheme } from '../../src/theme';
import {
  Avatar,
  Badge,
  Body,
  BodyBold,
  Button,
  Card,
  EmptyState,
  Gap,
  Heading,
  Muted,
  MutedCaption,
  PressableRow,
  Row,
} from '../../src/components/ui';

export default function ProfileScreen() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const { locale } = useLocale();
  const { me } = useAuth();
  const requests = useMyRequests();
  const notifications = useNotifications();
  const catalogue = useCatalogue();

  const history = requests.data?.items ?? [];
  const unread = (notifications.data?.items ?? []).filter((n) => !n.readAt);

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      {/* Identity */}
      <Card>
        <Row gap={spacing.md}>
          {me ? <Avatar seed={me.pseudonym} size={56} /> : null}
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Heading>{me?.pseudonym ?? '…'}</Heading>
            <Row gap={spacing.xs} style={{ flexWrap: 'wrap' }}>
              {me?.emailVerified ? (
                <Badge label={t('reliability.emailVerified')} tone="success" />
              ) : null}
              {me ? (
                <Badge
                  label={t('reliability.memberSince', { month: formatMonthYear(me.createdAt, locale) })}
                />
              ) : null}
            </Row>
          </View>
        </Row>
        <MutedCaption>{t('reliability.verifiedMeaning')}</MutedCaption>
        <MutedCaption>{t('settings.pseudonymNote')}</MutedCaption>
      </Card>

      {/* Plain-language reliability explanation */}
      <Card>
        <BodyBold>{t('profilePage.howTitle')}</BodyBold>
        <Muted>{t('profilePage.howBody')}</Muted>
      </Card>

      <Button title={t('settings.title')} variant="secondary" onPress={() => router.push('/settings')} />

      {/* Notifications inbox */}
      {unread.length > 0 ? (
        <Card tone="accent">
          <BodyBold>{t('notifications.title')}</BodyBold>
          {unread.slice(0, 5).map((n) => (
            <PressableRow
              key={n.id}
              accessibilityLabel={t(n.titleKey, n.params)}
              onPress={() => {
                if (n.deepLink) {
                  const normalized = n.deepLink
                    .replace(/^\/offers\//, '/offer/')
                    .replace(/^\/matches\//, '/match/')
                    .replace(/^\/requests\//, '/request/');
                  router.push(normalized as never);
                }
              }}
              style={{ padding: spacing.md, backgroundColor: 'transparent', borderWidth: 0 }}
            >
              <Body>{t(n.titleKey, n.params)}</Body>
              <MutedCaption>{formatDateTime(n.createdAt, locale)}</MutedCaption>
            </PressableRow>
          ))}
        </Card>
      ) : null}

      {/* Request history */}
      <Heading>{t('profilePage.historyTitle')}</Heading>
      {history.length === 0 && !requests.isLoading ? (
        <EmptyState message={t('profilePage.historyEmpty')} />
      ) : null}
      {history.map((r) => {
        const cat = categoryBySlug(catalogue.data?.categories, r.categorySlug);
        return (
          <PressableRow
            key={r.id}
            accessibilityLabel={categoryName(cat, locale)}
            onPress={() => router.push(`/request/${r.id}`)}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <BodyBold style={{ flex: 1 }}>
                {categoryName(cat, locale)} · {r.qty} {t(`units.${r.unit}`)}
              </BodyBold>
              <Badge
                label={
                  r.status === 'fulfilled'
                    ? t('request.fulfilled')
                    : r.status === 'expired'
                      ? t('sync.expired')
                      : r.status === 'cancelled'
                        ? t('common.cancel')
                        : r.status === 'matched'
                          ? t('match.matched')
                          : t('sync.submitted')
                }
                tone={r.status === 'fulfilled' ? 'success' : 'default'}
              />
            </Row>
            <MutedCaption>{formatDateTime(r.createdAt, locale)}</MutedCaption>
          </PressableRow>
        );
      })}
      <Gap />
      <Muted center color={th.colors.muted}>
        {t('common.tagline')}
      </Muted>
    </ScrollView>
  );
}
