/**
 * Presentation components taken directly from the supplied mockups.
 *
 * These exist so the nine attendee screens share one implementation of each
 * repeated element rather than each screen re-deriving it. Values come from
 * `gradients`, `needLevel`, `activePill`, `swipeChoice`, `mockRadius` and the
 * two shadow helpers in ../theme — nothing here invents a colour or a radius.
 */
import React, { useRef } from 'react';
import { Animated, PanResponder, Pressable, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  activePill,
  gradients,
  mockCardShadow,
  mockRadius,
  needLevel,
  primaryButtonShadow,
  spacing,
  swipeChoice,
  TOUCH,
  useTheme,
} from '../theme';
import { Body, BodyBold, Caption, MutedCaption, Row, Title } from './ui';
import { Icon, type IconName } from './icons';

/* ------------------------------------------------------------------ chrome */

/** Full-bleed gradient page (mockups 2, 3, 5, 7). */
export function GradientScreen({
  variant,
  children,
  style,
}: {
  variant: keyof typeof gradients;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={[...gradients[variant]] as [string, string, ...string[]]}
      style={[{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }, style]}
    >
      {children}
    </LinearGradient>
  );
}

/** Back chevron / Skip pair pinned to the top of the gradient screens. */
export function TopBar({
  onBack,
  onSkip,
  skipLabel,
  tint = '#FFFFFF',
}: {
  onBack?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  tint?: string;
}) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingHorizontal: spacing.lg, minHeight: TOUCH }}>
      {onBack ? (
        <Pressable accessibilityRole="button" onPress={onBack} hitSlop={10} style={{ padding: spacing.xs }}>
          <Icon name="arrow-left" size={24} color={tint} />
        </Pressable>
      ) : (
        <View style={{ width: 24 }} />
      )}
      {onSkip && skipLabel ? (
        <Pressable accessibilityRole="button" onPress={onSkip} hitSlop={10} style={{ padding: spacing.xs }}>
          <Body color={tint}>{skipLabel}</Body>
        </Pressable>
      ) : (
        <View style={{ width: 24 }} />
      )}
    </Row>
  );
}

/* -------------------------------------------------------------------- bits */

/** Green "Active" pill on an event card (mockup 1). */
export function ActiveBadge({ label }: { label: string }) {
  return (
    <View
      style={{
        backgroundColor: activePill.bg,
        borderRadius: mockRadius.pill,
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
      }}
    >
      <Caption color={activePill.fg} style={{ fontWeight: '600' }}>
        {label}
      </Caption>
    </View>
  );
}

/** "High need" / "Moderate need" chip (mockup 4). */
export function NeedBadge({ level, label }: { level: keyof typeof needLevel; label: string }) {
  const c = needLevel[level];
  return (
    <View
      style={{
        backgroundColor: c.bg,
        borderRadius: mockRadius.pill,
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
      }}
    >
      <Caption color={c.fg} style={{ fontWeight: '600' }}>
        {label}
      </Caption>
    </View>
  );
}

/** White card with the mockups' softer, wider elevation. */
export function MockCard({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const th = useTheme();
  const body = (
    <View
      style={[
        {
          backgroundColor: th.colors.surface,
          borderRadius: mockRadius.card,
          padding: spacing.lg,
          gap: spacing.sm,
        },
        mockCardShadow(),
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}>
      {body}
    </Pressable>
  );
}

/** A line of metadata with a leading icon (area, dates, attendee count). */
export function MetaRow({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  const th = useTheme();
  return (
    <Row gap={spacing.sm} style={{ alignItems: 'center' }}>
      <Icon name={icon} size={16} color={th.colors.textSecondary} />
      <Body color={th.colors.textSecondary} style={{ flex: 1 }}>
        {children}
      </Body>
    </Row>
  );
}

/** Full-width blue CTA with the mockups' coloured shadow. */
export function PrimaryCta({
  title,
  onPress,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 52,
          borderRadius: mockRadius.input,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: disabled ? th.colors.border : th.colors.primary,
          opacity: pressed ? 0.92 : 1,
        },
        disabled ? undefined : primaryButtonShadow(),
        style,
      ]}
    >
      <BodyBold color="#FFFFFF" style={{ fontSize: 16 }}>
        {title}
      </BodyBold>
    </Pressable>
  );
}

/** Centred blue text link used under the primary CTA. */
export function GhostLink({ title, onPress }: { title: string; onPress: () => void }) {
  const th = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
      <BodyBold color={th.colors.primary} style={{ textAlign: 'center' }}>
        {title}
      </BodyBold>
    </Pressable>
  );
}

/* ------------------------------------------------------------ swipe sheet */

/**
 * The white sheet at the bottom of mockups 2, 3 and 5: a prompt, a red X, a
 * green tick, and drifting arrows between them.
 *
 * Swiping the sheet horizontally is the advertised gesture, so it is
 * implemented — but both buttons do the same thing, because a gesture-only
 * control is unusable with a screen reader or one hand full of supplies.
 */
export function SwipeChoiceSheet({
  promptTop,
  promptBottom,
  noLabel,
  yesLabel,
  onNo,
  onYes,
}: {
  promptTop: string;
  promptBottom: string;
  noLabel: string;
  yesLabel: string;
  onNo: () => void;
  onYes: () => void;
}) {
  const th = useTheme();
  const dx = useRef(new Animated.Value(0)).current;
  const decided = useRef(false);

  const settle = (toValue: number, then: () => void) => {
    decided.current = true;
    Animated.timing(dx, { toValue, duration: 160, useNativeDriver: true }).start(then);
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => {
        if (!decided.current) dx.setValue(g.dx);
      },
      onPanResponderRelease: (_e, g) => {
        if (decided.current) return;
        // A deliberate flick, not a stray scroll: ~1/4 of a phone width.
        if (g.dx > 90) settle(400, onYes);
        else if (g.dx < -90) settle(-400, onNo);
        else Animated.spring(dx, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
      },
    }),
  ).current;

  return (
    <Animated.View
      {...pan.panHandlers}
      style={[
        {
          backgroundColor: th.colors.surface,
          borderRadius: mockRadius.sheet,
          padding: spacing.lg,
          gap: spacing.md,
        },
        mockCardShadow(),
        { transform: [{ translateX: dx }] },
      ]}
    >
      <View style={{ gap: 2 }}>
        <Body color={th.colors.primary} style={{ textAlign: 'center' }}>
          {promptTop}
        </Body>
        <Body color={th.colors.primary} style={{ textAlign: 'center' }}>
          {promptBottom}
        </Body>
      </View>

      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <ChoiceButton kind="no" label={noLabel} onPress={() => settle(-400, onNo)} />
        <DriftingArrows />
        <ChoiceButton kind="yes" label={yesLabel} onPress={() => settle(400, onYes)} />
      </Row>
    </Animated.View>
  );
}

function ChoiceButton({ kind, label, onPress }: { kind: 'no' | 'yes'; label: string; onPress: () => void }) {
  const c = swipeChoice[kind];
  return (
    <View style={{ alignItems: 'center', gap: spacing.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => ({
          width: swipeChoice.size,
          height: swipeChoice.size,
          borderRadius: swipeChoice.size / 2,
          backgroundColor: c.bg,
          borderWidth: 1,
          borderColor: c.ring,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Icon name={kind === 'yes' ? 'check' : 'close'} size={26} color={c.fg} />
      </Pressable>
      <Caption color={c.fg} style={{ fontWeight: '600' }}>
        {label}
      </Caption>
    </View>
  );
}

/** The three chevrons between the buttons, drifting rightward to hint the gesture. */
function DriftingArrows() {
  const th = useTheme();
  const drift = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
    >
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={{
            opacity: drift.interpolate({
              inputRange: [0, 0.33 * (i + 1), Math.min(1, 0.33 * (i + 2))],
              outputRange: [0.25, 1, 0.25],
              extrapolate: 'clamp',
            }),
          }}
        >
          <Icon name="chevron-right" size={16} color={th.colors.textSecondary} />
        </Animated.View>
      ))}
    </View>
  );
}

/** Heading + supporting line, centred, as used on the gradient screens. */
export function GradientHeading({
  title,
  body,
  tint = '#FFFFFF',
  bodyTint = '#FFFFFFCC',
}: {
  title: string;
  body?: string;
  tint?: string;
  bodyTint?: string;
}) {
  return (
    <View style={{ gap: spacing.sm, paddingHorizontal: spacing.xl }}>
      <Title center color={tint}>
        {title}
      </Title>
      {body ? (
        <Body color={bodyTint} style={{ textAlign: 'center' }}>
          {body}
        </Body>
      ) : null}
    </View>
  );
}

export { MutedCaption };
