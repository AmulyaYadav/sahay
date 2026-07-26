import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { avatarFromSeed } from '@sahay/shared';
import { radius, spacing, TOUCH, type as typeScale, useTheme, type Theme } from '../theme';
import { useT } from '../locale';

/* ------------------------------------------------------------------- text */

interface TxtProps {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  color?: string;
  center?: boolean;
  numberOfLines?: number;
  accessibilityLabel?: string;
}

function makeText(size: number, weight: TextStyle['fontWeight'] = '400') {
  return function Txt({ children, style, color, center, numberOfLines, accessibilityLabel }: TxtProps) {
    const th = useTheme();
    return (
      <Text
        allowFontScaling
        numberOfLines={numberOfLines}
        accessibilityLabel={accessibilityLabel}
        style={[
          {
            fontSize: size,
            fontWeight: weight,
            color: color ?? th.colors.text,
            textAlign: center ? 'center' : undefined,
            lineHeight: size * 1.4,
          },
          style,
        ]}
      >
        {children}
      </Text>
    );
  };
}

export const Title = makeText(typeScale.title, '700');
export const Heading = makeText(typeScale.heading, '600');
export const Body = makeText(typeScale.body);
export const BodyBold = makeText(typeScale.body, '600');
export const Label = makeText(typeScale.label);
export const Caption = makeText(typeScale.caption);

export function Muted(props: TxtProps) {
  const th = useTheme();
  return <Label {...props} color={props.color ?? th.colors.muted} />;
}

export function MutedCaption(props: TxtProps) {
  const th = useTheme();
  return <Caption {...props} color={props.color ?? th.colors.muted} />;
}

/* ----------------------------------------------------------------- layout */

export function Card({
  children,
  style,
  tone,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'accent' | 'danger' | 'warn';
}) {
  const th = useTheme();
  const bg =
    tone === 'accent'
      ? th.colors.accentSoft
      : tone === 'danger'
        ? th.colors.dangerSoft
        : tone === 'warn'
          ? th.colors.warnSoft
          : th.colors.card;
  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: th.colors.border,
          padding: spacing.lg,
          gap: spacing.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Row({
  children,
  style,
  gap = spacing.sm,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: number;
}) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>
  );
}

export function Gap({ size = spacing.md }: { size?: number }) {
  return <View style={{ height: size }} />;
}

/* ---------------------------------------------------------------- buttons */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  accessibilityLabel,
  style,
  small,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const th = useTheme();
  const palette = paletteFor(variant, th);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!disabled || !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: TOUCH,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          paddingHorizontal: small ? spacing.md : spacing.lg,
          paddingVertical: small ? spacing.sm : spacing.md,
          backgroundColor: palette.bg,
          borderWidth: palette.borderWidth,
          borderColor: palette.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : null}
      <Text
        allowFontScaling
        style={{ color: palette.fg, fontSize: typeScale.body, fontWeight: '600' }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function paletteFor(variant: ButtonVariant, th: Theme) {
  switch (variant) {
    case 'primary':
      return { bg: th.colors.accent, fg: th.colors.onAccent, border: th.colors.accent, borderWidth: 0 };
    case 'danger':
      return { bg: th.colors.danger, fg: th.colors.onAccent, border: th.colors.danger, borderWidth: 0 };
    case 'success':
      return { bg: th.colors.success, fg: th.colors.onAccent, border: th.colors.success, borderWidth: 0 };
    case 'secondary':
      return { bg: th.colors.card, fg: th.colors.accent, border: th.colors.accent, borderWidth: 1 };
    case 'ghost':
      return { bg: 'transparent', fg: th.colors.muted, border: 'transparent', borderWidth: 0 };
  }
}

/** A large tappable row (list item), min 44pt tall. */
export function PressableRow({
  children,
  style,
  ...rest
}: PressableProps & { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      style={({ pressed }) => [
        {
          minHeight: TOUCH,
          backgroundColor: pressed ? th.colors.cardAlt : th.colors.card,
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: th.colors.border,
          padding: spacing.lg,
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ chips */

export function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  tone,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  tone?: 'default' | 'danger' | 'warn' | 'success';
}) {
  const th = useTheme();
  const toneColor =
    tone === 'danger'
      ? th.colors.danger
      : tone === 'warn'
        ? th.colors.warn
        : tone === 'success'
          ? th.colors.success
          : th.colors.accent;
  const content = (
    <Text
      allowFontScaling
      style={{
        color: selected ? th.colors.onAccent : toneColor,
        fontSize: typeScale.label,
        fontWeight: '600',
      }}
    >
      {label}
    </Text>
  );
  const chipStyle: ViewStyle = {
    minHeight: onPress ? TOUCH : undefined,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: onPress ? spacing.sm : spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: toneColor,
    backgroundColor: selected ? toneColor : 'transparent',
  };
  if (!onPress) return <View style={chipStyle}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [chipStyle, { opacity: pressed ? 0.8 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

export function Badge({
  label,
  tone = 'default',
}: {
  label: string;
  tone?: 'default' | 'accent' | 'danger' | 'warn' | 'success';
}) {
  const th = useTheme();
  const map = {
    default: { bg: th.colors.cardAlt, fg: th.colors.muted },
    accent: { bg: th.colors.accentSoft, fg: th.colors.accent },
    danger: { bg: th.colors.dangerSoft, fg: th.colors.danger },
    warn: { bg: th.colors.warnSoft, fg: th.colors.warn },
    success: { bg: th.colors.successSoft, fg: th.colors.success },
  }[tone];
  return (
    <View
      style={{
        backgroundColor: map.bg,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        alignSelf: 'flex-start',
      }}
    >
      <Text allowFontScaling style={{ color: map.fg, fontSize: typeScale.caption, fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ input */

export function Field(props: TextInputProps & { label?: string }) {
  const th = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <Muted>{label}</Muted> : null}
      <TextInput
        allowFontScaling
        placeholderTextColor={th.colors.muted}
        accessibilityLabel={label ?? props.placeholder ?? undefined}
        {...rest}
        style={[
          {
            minHeight: TOUCH,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: th.colors.border,
            backgroundColor: th.colors.card,
            color: th.colors.text,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: typeScale.body,
          },
          style,
        ]}
      />
    </View>
  );
}

/** Quantity stepper with large +/- targets. */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 9999,
  unitLabel,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  unitLabel?: string;
  step?: number;
}) {
  const th = useTheme();
  const t = useT();
  const btn = (label: string, delta: number, a11y: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => onChange(Math.min(max, Math.max(min, value + delta)))}
      style={({ pressed }) => ({
        width: TOUCH + 8,
        height: TOUCH,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? th.colors.accentSoft : th.colors.cardAlt,
      })}
    >
      <Text allowFontScaling style={{ fontSize: 24, color: th.colors.accent, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <Row gap={spacing.md}>
      {btn('−', -step, t('misc.decrease'))}
      <View style={{ minWidth: 72, alignItems: 'center' }}>
        <BodyBold accessibilityLabel={`${value} ${unitLabel ?? ''}`}>
          {value}
          {unitLabel ? ` ${unitLabel}` : ''}
        </BodyBold>
      </View>
      {btn('+', step, t('misc.increase'))}
    </Row>
  );
}

/* ------------------------------------------------------------------ avatar */

export function Avatar({ seed, size = 48 }: { seed: string; size?: number }) {
  const { color, initials } = avatarFromSeed(seed);
  return (
    <View
      accessibilityLabel={seed}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text allowFontScaling={false} style={{ color: '#FFFFFF', fontSize: size * 0.4, fontWeight: '700' }}>
        {initials}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ states */

export function LoadingView() {
  const th = useTheme();
  const t = useT();
  return (
    <View style={styles.centerFill} accessibilityLabel={t('common.loading')}>
      <ActivityIndicator size="large" color={th.colors.accent} />
      <Gap size={spacing.sm} />
      <Muted>{t('common.loading')}</Muted>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <View style={styles.centerFill}>
      <Body center>{message ?? t('common.error')}</Body>
      <Gap />
      {onRetry ? <Button title={t('common.retry')} onPress={onRetry} variant="secondary" /> : null}
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={{ padding: spacing.xl, alignItems: 'center' }}>
      <Muted center>{message}</Muted>
    </View>
  );
}

/** Honest staleness label for cached/offline data. */
export function StalenessNote({ updatedAt }: { updatedAt?: number | string | null }) {
  const t = useT();
  if (!updatedAt) return null;
  const date = typeof updatedAt === 'string' ? new Date(updatedAt) : new Date(updatedAt);
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  const label =
    mins <= 1 ? t('common.justNow') : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <MutedCaption>
      {`${t('common.approximate')} · ${t('eventPage.updated', { time: label })}`}
    </MutedCaption>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
});
