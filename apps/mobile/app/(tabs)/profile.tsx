import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth';
import { useCatalogue, useMyRequests, useNotifications } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { categoryBySlug, categoryGlyph, categoryName } from '../../src/catalogue';
import { formatDateTime, formatMonthYear } from '../../src/format';
import { spacing, useTheme } from '../../src/theme';
import {
  Avatar,
  Badge,
  Body,
  BodyBold,
  Button,
  Card,
  CategoryChip,
  EmptyState,
  Gap,
  H3,
  Heading,
  IconSquare,
  ListRow,
  Muted,
  MutedCaption,
  PressableRow,
  Row,
  StatStrip,
} from '../../src/components/ui';
import { AppHeader } from '../../src/components/AppHeader';

export default function ProfileScreen() {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const { locale } = useLocale();
  const { me, signOut } = useAuth();
  const requests = useMyRequests();
  const notifications = useNotifications();
  const catalogue = useCatalogue();

  const history = requests.data?.items ?? [];
  const unread = (notifications.data?.items ?? []).filter((n) => !n.readAt);
  const fulfilled = history.filter((r) => r.status === 'fulfilled').length;
  const activeNow = history.filter((r) =>
    ['searching', 'offering', 'matched', 'partially_fulfilled'].includes(r.status),
  ).length;

  const logout = async () => {
    await signOut();
    router.replace('/auth');
  };

  return (
    <View style={{ flex: 1, backgroundColor: th.colors.bg }}>
    <AppHeader />
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      {/* Identity (§4.12): 64pt avatar, H2 pseudonym, badge row */}
      <Card style={{ alignItems: 'center', gap: spacing.sm }}>
        {me ? <Avatar seed={me.pseudonym} size={64} /> : null}
        <Heading center>{me?.pseudonym ?? '…'}</Heading>
        <Row gap={spacing.xs} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          {me?.emailVerified ? (
            <Badge label={t('reliability.emailVerified')} tone="success" />
          ) : null}
          {me ? (
            <Badge
              label={t('reliability.memberSince', { month: formatMonthYear(me.createdAt, locale) })}
            />
          ) : null}
        </Row>
        <MutedCaption center>{t('settings.pseudonymNote')}</MutedCaption>
      </Card>

      {/* Stat strip — real request data only */}
      <StatStrip
        stats={[
          { value: history.length, label: t('profilePage.statRequests') },
          { value: fulfilled, label: t('profilePage.statFulfilled') },
          { value: activeNow, label: t('profilePage.statActive') },
        ]}
      />

      {/* Plain-language reliability explanation */}
      <Card>
        <BodyBold>{t('profilePage.howTitle')}</BodyBold>
        <Muted>{t('profilePage.howBody')}</Muted>
        <MutedCaption>{t('reliability.verifiedMeaning')}</MutedCaption>
      </Card>

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
              style={{ padding: spacing.md, backgroundColor: 'transparent', borderWidth: 0, elevation: 0, shadowOpacity: 0 }}
            >
              <Body>{t(n.titleKey, n.params)}</Body>
              <MutedCaption>{formatDateTime(n.createdAt, locale)}</MutedCaption>
            </PressableRow>
          ))}
        </Card>
      ) : null}

      {/* Menu */}
      <ListRow
        leading={<IconSquare name="settings" bg={th.colors.primaryTint} color={th.colors.primary} />}
        title={t('settings.title')}
        onPress={() => router.push('/settings')}
      />
      <ListRow
        leading={<IconSquare name="users" bg={th.colors.cardAlt} color={th.colors.textSecondary} />}
        title={t('settings.blocked')}
        onPress={() => router.push('/settings/blocked')}
      />
      <ListRow
        leading={<IconSquare name="shield" bg={th.colors.successTint} color={th.colors.success} />}
        title={t('safety.guidance')}
        onPress={() => router.push('/settings/safety')}
      />
      <ListRow
        leading={<IconSquare name="help" bg={th.colors.warningTint} color={th.colors.warning} />}
        title={t('settings.legal')}
        onPress={() => router.push('/settings/legal')}
      />

      {/* Request history */}
      <H3>{t('profilePage.historyTitle')}</H3>
      {history.length === 0 && !requests.isLoading ? (
        <EmptyState message={t('profilePage.historyEmpty')} />
      ) : null}
      {history.map((r) => {
        const cat = categoryBySlug(catalogue.data?.categories, r.categorySlug);
        return (
          <ListRow
            key={r.id}
            accessibilityLabel={categoryName(cat, locale)}
            onPress={() => router.push(`/request/${r.id}`)}
            leading={<CategoryChip glyph={categoryGlyph(cat)} group={cat?.group} />}
            title={`${categoryName(cat, locale)} · ${r.qty} ${t(`units.${r.unit}`)}`}
            subtitle={formatDateTime(r.createdAt, locale)}
            trailing={
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
            }
          />
        );
      })}

      {/* Log out — destructive-soft */}
      <Button
        title={t('auth.logout')}
        variant="dangerSoft"
        icon="log-out"
        onPress={() => void logout()}
      />
      <Gap />
      <Muted center color={th.colors.textSecondary}>
        {t('common.tagline')}
      </Muted>
    </ScrollView>
    </View>
  );
}
