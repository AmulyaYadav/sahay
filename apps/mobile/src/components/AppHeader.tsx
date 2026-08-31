import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, TOUCH, useTheme } from '../theme';
import { Body, Row, Title } from './ui';
import { Icon } from './icons';
import { LanguageToggle } from './LanguageToggle';
import { useT } from '../locale';
import { useDrawer } from '../drawer';

/**
 * The app's one header, used by every tab.
 *
 * Previously the menu lived only on Home and the wordmark only on Events, so
 * each screen invented its own top edge — and two of them collided with the
 * status bar and camera cut-out on a real phone. Everything now goes through
 * here, which owns the safe-area inset in one place.
 *
 * `insets.top` alone is not enough: on devices with a camera hole the inset ends
 * flush with the cut-out, so content sits directly beneath it and reads as
 * clipped. The extra gap below is deliberate breathing room.
 */
export function AppHeader({
  showWordmark = true,
  showBell = true,
}: {
  showWordmark?: boolean;
  showBell?: boolean;
}) {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { open } = useDrawer();

  // The icon sits centered inside the larger TOUCH-sized tap target, so its
  // visual edge lands this far inside the box's edge. The menu button needs
  // to cancel that out so its icon lines up with the greeting text below,
  // which has no such inset; the touch target itself stays full-size.
  const ICON_SIZE = 22;
  const iconInset = (TOUCH - ICON_SIZE) / 2;

  const circle = (
    label: string,
    icon: 'menu' | 'bell',
    onPress: () => void,
    alignStart = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: TOUCH,
        height: TOUCH,
        marginLeft: alignStart ? -iconInset : 0,
        borderRadius: TOUCH / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? th.colors.cardAlt : 'transparent',
      })}
    >
      <Icon name={icon} size={ICON_SIZE} color={th.colors.text} />
    </Pressable>
  );

  return (
    <View
      style={{
        paddingTop: insets.top + spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.sm,
        backgroundColor: th.colors.bg,
      }}
    >
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        {circle(t('nav.menu'), 'menu', open, true)}

        {showWordmark ? (
          <Row gap={spacing.xs} style={{ alignItems: 'center' }}>
            <Icon name="hand-heart" size={20} color={th.colors.primary} />
            <Title style={{ fontSize: 20 }}>{t('common.appName')}</Title>
          </Row>
        ) : (
          <View />
        )}

        <Row gap={spacing.xs} style={{ alignItems: 'center' }}>
          <LanguageToggle />
          {showBell
            ? circle(t('notifications.title'), 'bell', () => router.push('/settings/notifications'))
            : null}
        </Row>
      </Row>
    </View>
  );
}

/** The wordmark's tagline, shown only where the design calls for it. */
export function HeaderTagline() {
  const t = useT();
  const th = useTheme();
  return (
    <Body color={th.colors.textSecondary} style={{ textAlign: 'center' }}>
      {t('events.tagline')}
    </Body>
  );
}
