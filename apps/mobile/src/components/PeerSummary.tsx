import React from 'react';
import { View } from 'react-native';
import type { Locale, MatchView } from '@sahay/shared';
import { useCatalogue } from '../hooks';
import { categoryBySlug, categoryGlyph, categoryName } from '../catalogue';
import { useLocale, useT } from '../locale';
import { spacing, useTheme } from '../theme';
import { Avatar, Badge, Body, H3, MutedCaption, Row } from './ui';

/**
 * What one participant may honestly be told about the other.
 *
 * Shared by the match-found moment and the working match screen so the two
 * cannot drift: the same three claims, worded the same way, with the same
 * caveat under them. Everything here comes from `MatchView.peer`, which is the
 * server's deliberate projection — no field reaches this component that a
 * participant is not allowed to see.
 *
 * The caveat is not decoration. "Email verified" is the strongest claim Sahay
 * can make and it is a weak one, so it is stated next to the badge rather than
 * buried in a help page.
 */
export function PeerSummary({
  match,
  onDark = false,
}: {
  match: MatchView;
  /** Rendered over the match-found scrim rather than the app canvas. */
  onDark?: boolean;
}) {
  const t = useT();
  const th = useTheme();
  const { locale } = useLocale();
  const catalogue = useCatalogue();

  const cat = categoryBySlug(catalogue.data?.categories, match.categorySlug);
  const qty = Math.round(Number(match.qtyReserved));

  const surface = onDark ? '#FFFFFF14' : th.colors.surface;
  const border = onDark ? '#FFFFFF29' : th.colors.border;
  const primaryText = onDark ? '#FFFFFF' : th.colors.text;
  const secondaryText = onDark ? '#FFFFFFB3' : th.colors.textSecondary;

  return (
    <View
      style={{
        backgroundColor: surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: spacing.lg,
        gap: spacing.md,
      }}
    >
      <Row gap={spacing.md}>
        <Avatar seed={match.peer.avatarSeed} size={44} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <H3 color={primaryText}>{match.peer.alias}</H3>
          <Row gap={spacing.xs} style={{ flexWrap: 'wrap' }}>
            <Badge label={t(`reliability.${match.peer.reliabilityLabel}`)} tone="accent" />
            <Badge
              label={t('reliability.completedAssists', { count: match.peer.completedAssists })}
            />
            {match.peer.emailVerifiedLabel ? (
              <Badge label={t('reliability.emailVerified')} tone="success" />
            ) : (
              <Badge label={t('reliability.notVerified')} tone="warn" />
            )}
          </Row>
        </View>
      </Row>

      {/* What is actually being exchanged, and how far away it is. */}
      <Body color={primaryText}>
        {[
          `${categoryGlyph(cat)} ${categoryName(cat, locale)}`.trim(),
          `${qty} ${t(`units.${match.unit}`)}`,
          t(`proximity.${match.proximity}`),
        ].join(' · ')}
      </Body>

      <View style={{ height: 1, backgroundColor: border }} />

      <MutedCaption color={secondaryText}>{t('reliability.verifiedMeaning')}</MutedCaption>
    </View>
  );
}
