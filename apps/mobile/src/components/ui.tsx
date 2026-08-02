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
import {
  cardShadow,
  categoryTint,
  isLargeFontScale,
  radius,
  shortagePill,
  spacing,
  tabularNums,
  TOUCH,
  type as typeScale,
  lineHeights,
  useTheme,
  type Theme,
} from '../theme';
import { Icon, type IconName } from './icons';
import { EmptyCircleVignette } from './vignettes';
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
            lineHeight: lineHeights[size] ?? Math.round(size * 1.45),
          },
          style,
        ]}
      >
        {children}
      </Text>
    );
  };
}

/** Warm Relief type scale: H1 28/36·700, H2 20/28·600, H3 16/24·600, Body 14/20, Caption 12/16·500. */
export const Title = makeText(typeScale.h1, '700');
export const Heading = makeText(typeScale.heading, '600');
export const H3 = makeText(typeScale.h3, '600');
export const Body = makeText(typeScale.body);
export const BodyBold = makeText(typeScale.body, '600');
export const Label = makeText(typeScale.label);
export const Caption = makeText(typeScale.caption, '500');

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
  tone?: 'default' | 'accent' | 'danger' | 'warn' | 'success';
}) {
  const th = useTheme();
  const bg =
    tone === 'accent'
      ? th.colors.primaryTint
      : tone === 'danger'
        ? th.colors.errorTint
        : tone === 'warn'
          ? th.colors.warningTint
          : tone === 'success'
            ? th.colors.successTint
            : th.colors.surface;
  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: tone && tone !== 'default' ? 'transparent' : th.colors.border,
          padding: spacing.lg,
          gap: spacing.sm,
        },
        tone === undefined || tone === 'default' ? cardShadow(th) : null,
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

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerSoft' | 'ghost' | 'success';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  accessibilityLabel,
  style,
  small,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  icon?: IconName;
}) {
  const th = useTheme();
  const palette = paletteFor(variant, th);
  const tall = !small && (variant === 'primary' || variant === 'danger' || variant === 'success');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!disabled || !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: tall ? 48 : TOUCH,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          paddingHorizontal: small ? spacing.md : spacing.lg,
          paddingVertical: small ? spacing.sm : spacing.md,
          backgroundColor: pressed && palette.bgPressed ? palette.bgPressed : palette.bg,
          borderWidth: palette.borderWidth,
          borderColor: palette.border,
          opacity: disabled ? 0.4 : pressed && !palette.bgPressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : null}
      {icon && !loading ? <Icon name={icon} size={18} color={palette.fg} /> : null}
      <Text
        allowFontScaling
        style={{ color: palette.fg, fontSize: typeScale.body, lineHeight: 20, fontWeight: '500' }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function paletteFor(variant: ButtonVariant, th: Theme) {
  const c = th.colors;
  switch (variant) {
    case 'primary':
      return { bg: c.primary, bgPressed: c.primaryStrong, fg: c.textOnColor, border: 'transparent', borderWidth: 0 };
    case 'danger':
      return { bg: c.error, bgPressed: undefined, fg: c.textOnColor, border: 'transparent', borderWidth: 0 };
    case 'dangerSoft':
      return { bg: c.errorTint, bgPressed: undefined, fg: c.error, border: 'transparent', borderWidth: 0 };
    case 'success':
      return { bg: c.success, bgPressed: undefined, fg: c.textOnColor, border: 'transparent', borderWidth: 0 };
    case 'secondary':
      return { bg: c.surface, bgPressed: undefined, fg: c.primary, border: c.primaryBorder, borderWidth: 1 };
    case 'ghost':
      return { bg: 'transparent', bgPressed: undefined, fg: c.primary, border: 'transparent', borderWidth: 0 };
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
          backgroundColor: pressed ? th.colors.cardAlt : th.colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: th.colors.border,
          padding: spacing.lg,
        },
        cardShadow(th),
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ chips */

/**
 * Segmented chip (urgency, durations, units…): rounded-12; selected =
 * tinted bg + colored 1px border + colored text; unselected = surface + border.
 */
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
  const c = th.colors;
  const { fg, tint } =
    tone === 'danger'
      ? { fg: c.error, tint: c.errorTint }
      : tone === 'warn'
        ? { fg: c.warning, tint: c.warningTint }
        : tone === 'success'
          ? { fg: c.success, tint: c.successTint }
          : { fg: c.primary, tint: c.primaryTint };
  const content = (
    <Text
      allowFontScaling
      style={{
        color: selected ? fg : c.text,
        fontSize: typeScale.label,
        lineHeight: 20,
        fontWeight: '500',
      }}
    >
      {label}
    </Text>
  );
  const chipStyle: ViewStyle = {
    minHeight: onPress ? TOUCH : undefined,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: onPress ? spacing.sm : spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: selected ? fg : c.border,
    backgroundColor: selected ? tint : c.surface,
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

/** Fully-rounded quick-reply chip: surface + border. */
export function QuickReplyChip({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH,
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: th.colors.border,
        backgroundColor: pressed ? th.colors.cardAlt : th.colors.surface,
      })}
    >
      <Text
        allowFontScaling
        style={{ color: th.colors.text, fontSize: typeScale.label, lineHeight: 20, fontWeight: '500' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ pills */

/** Pill badge: 12/16 medium, 2×10 padding, tint bg + colored text, no border. */
export function Badge({
  label,
  tone = 'default',
}: {
  label: string;
  tone?: 'default' | 'accent' | 'danger' | 'warn' | 'success';
}) {
  const th = useTheme();
  const c = th.colors;
  const map = {
    default: { bg: c.cardAlt, fg: c.textSecondary },
    accent: { bg: c.primaryTint, fg: c.primary },
    danger: { bg: c.errorTint, fg: c.error },
    warn: { bg: c.warningTint, fg: c.warning },
    success: { bg: c.successTint, fg: c.success },
  }[tone];
  return (
    <View
      style={{
        backgroundColor: map.bg,
        borderRadius: radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 2,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        allowFontScaling
        style={{ color: map.fg, fontSize: typeScale.caption, lineHeight: 16, fontWeight: '500' }}
      >
        {label}
      </Text>
    </View>
  );
}

/** Shortage-level pill mapped per the design system (§1). */
export function NeedPill({ level, label }: { level: string; label: string }) {
  const th = useTheme();
  const { bg, fg } = shortagePill(level, th);
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 2,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        allowFontScaling
        style={{ color: fg, fontSize: typeScale.caption, lineHeight: 16, fontWeight: '500' }}
      >
        {label}
      </Text>
    </View>
  );
}

/** Success-tint "{n} available" pill for supply rows (§4.7). */
export function AvailabilityBadge({ count }: { count: number }) {
  const t = useT();
  return <Badge label={t('inventory.available', { count })} tone="success" />;
}

/* ------------------------------------------------------- category visuals */

/** 40–44pt rounded-12 tinted icon square with the category glyph (§4.6). */
export function CategoryChip({
  glyph,
  group,
  size = 40,
}: {
  glyph: string;
  group?: string;
  size?: number;
}) {
  const th = useTheme();
  const tint = categoryTint(group, th);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        backgroundColor: tint.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text allowFontScaling={false} style={{ fontSize: size * 0.5 }}>
        {glyph}
      </Text>
    </View>
  );
}

/** Rounded-12 tinted square holding a stroke icon (quick actions, menus). */
export function IconSquare({
  name,
  bg,
  color,
  size = 40,
}: {
  name: IconName;
  bg: string;
  color: string;
  size?: number;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={name} size={size * 0.55} color={color} />
    </View>
  );
}

/* -------------------------------------------------------------- list rows */

/** Category/menu list row: leading chip, title (+caption), trailing, chevron (§4.6). */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  chevron = true,
  onPress,
  accessibilityLabel,
  style,
}: {
  leading?: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const th = useTheme();
  /*
    A trailing badge cannot shrink — its width is whatever its own text needs.
    On a large system font it grew until the title beside it was truncated and
    the caption below wrapped one character per line. Past 1.3x the badge moves
    under the text, which then has the full row to itself, and the two-line cap
    on the title comes off so a long name wraps instead of being cut.
  */
  const stacked = isLargeFontScale();
  const inner = (
    <Row gap={spacing.md}>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <BodyBold numberOfLines={stacked ? undefined : 2}>{title}</BodyBold>
        {typeof subtitle === 'string' ? <MutedCaption>{subtitle}</MutedCaption> : subtitle}
        {stacked && trailing ? (
          <Row gap={spacing.xs} style={{ flexWrap: 'wrap', marginTop: spacing.xs }}>
            {trailing}
          </Row>
        ) : null}
      </View>
      {stacked ? null : trailing}
      {chevron && onPress ? (
        <Icon name="chevron-right" size={18} color={th.colors.textSecondary} />
      ) : null}
    </Row>
  );
  if (!onPress) {
    return (
      <View
        style={[
          {
            backgroundColor: th.colors.surface,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: th.colors.border,
            padding: spacing.md,
            minHeight: TOUCH,
            justifyContent: 'center',
          },
          cardShadow(th),
          style,
        ]}
      >
        {inner}
      </View>
    );
  }
  return (
    <PressableRow
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={[{ padding: spacing.md, justifyContent: 'center' }, style]}
    >
      {inner}
    </PressableRow>
  );
}

/** Two side-by-side tappable tiles with tinted icon squares (§4.5). */
export function QuickActionTile({
  icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  iconBg: string;
  iconColor: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flex: 1,
          minHeight: TOUCH,
          backgroundColor: pressed ? th.colors.cardAlt : th.colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: th.colors.border,
          padding: spacing.lg,
          gap: spacing.md,
        },
        cardShadow(th),
      ]}
    >
      <IconSquare name={icon} bg={iconBg} color={iconColor} />
      <View style={{ gap: 2 }}>
        <BodyBold>{title}</BodyBold>
        {subtitle ? <MutedCaption>{subtitle}</MutedCaption> : null}
      </View>
    </Pressable>
  );
}

/** Stat strip card: columns of number (20/700 tabular) + caption label (§4.12). */
export function StatStrip({
  stats,
}: {
  stats: { value: string | number; label: string }[];
}) {
  const th = useTheme();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          backgroundColor: th.colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: th.colors.border,
          paddingVertical: spacing.lg,
        },
        cardShadow(th),
      ]}
    >
      {stats.map((s, i) => (
        <View
          key={`${s.label}-${i}`}
          accessibilityLabel={`${s.value} ${s.label}`}
          style={{
            flex: 1,
            alignItems: 'center',
            gap: 2,
            borderLeftWidth: i === 0 ? 0 : 1,
            borderLeftColor: th.colors.border,
            paddingHorizontal: spacing.sm,
          }}
        >
          <Text
            allowFontScaling
            style={[
              { fontSize: 20, lineHeight: 28, fontWeight: '700', color: th.colors.text },
              tabularNums,
            ]}
          >
            {s.value}
          </Text>
          <MutedCaption center>{s.label}</MutedCaption>
        </View>
      ))}
    </View>
  );
}

/** Countdown card: caption + big tabular timer + thin progress bar (§4.10). */
export function CountdownCard({
  caption,
  timeLabel,
  progress,
  urgent,
  accessibilityLabel,
}: {
  caption: string;
  timeLabel: string;
  /** 0..1 fraction of time remaining. */
  progress: number;
  urgent?: boolean;
  accessibilityLabel?: string;
}) {
  const th = useTheme();
  const fill = urgent ? th.colors.error : th.colors.primary;
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          backgroundColor: th.colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: th.colors.border,
          padding: spacing.lg,
          alignItems: 'center',
          gap: spacing.sm,
        },
        cardShadow(th),
      ]}
    >
      <MutedCaption>{caption}</MutedCaption>
      <Text
        allowFontScaling
        style={[
          { fontSize: 30, lineHeight: 38, fontWeight: '700', color: urgent ? th.colors.error : th.colors.text },
          tabularNums,
        ]}
      >
        {timeLabel}
      </Text>
      <View
        style={{
          alignSelf: 'stretch',
          height: 4,
          borderRadius: radius.pill,
          backgroundColor: th.colors.cardAlt,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${clamped * 100}%`,
            height: 4,
            borderRadius: radius.pill,
            backgroundColor: fill,
          }}
        />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ input */

export function Field(props: TextInputProps & { label?: string; hint?: string }) {
  const th = useTheme();
  const { label, hint, style, ...rest } = props;
  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <MutedCaption>{label}</MutedCaption> : null}
      <TextInput
        allowFontScaling
        placeholderTextColor={th.colors.textSecondary}
        accessibilityLabel={label ?? props.placeholder ?? undefined}
        {...rest}
        style={[
          {
            minHeight: 48,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: th.colors.border,
            backgroundColor: th.colors.surface,
            color: th.colors.text,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: typeScale.h3,
          },
          style,
        ]}
      />
      {hint ? <MutedCaption>{hint}</MutedCaption> : null}
    </View>
  );
}

/**
 * Quantity stepper with large +/- targets.
 *
 * `compact` exists for steppers that share a row with a label. At full size the
 * control is a fixed ~200pt wide, which on a 360pt phone left a supply name
 * about 58pt to wrap in — one or two characters per line. Compact keeps the
 * 44pt touch target (the button is square instead of over-wide, and the value
 * column is sized to the digits) while giving the label back roughly 70pt.
 */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 9999,
  unitLabel,
  step = 1,
  compact = false,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  unitLabel?: string;
  step?: number;
  compact?: boolean;
}) {
  const th = useTheme();
  const t = useT();
  const btn = (label: string, delta: number, a11y: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => onChange(Math.min(max, Math.max(min, value + delta)))}
      style={({ pressed }) => ({
        width: compact ? TOUCH : TOUCH + 8,
        height: TOUCH,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: pressed ? th.colors.primaryBorder : th.colors.border,
        backgroundColor: pressed ? th.colors.primaryTint : th.colors.surface,
      })}
    >
      {/* Capped: the button is a fixed 44pt box, so past about 1.5x the glyph
          clips instead of growing. The control stays a 44pt target either way. */}
      <Text
        allowFontScaling
        maxFontSizeMultiplier={1.5}
        style={{ fontSize: 22, color: th.colors.primary, fontWeight: '700' }}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    <Row gap={compact ? spacing.xs : spacing.md}>
      {btn('−', -step, t('misc.decrease'))}
      <View style={{ minWidth: compact ? 28 : 72, alignItems: 'center', justifyContent: 'center' }}>
        <Text
          allowFontScaling
          accessibilityLabel={`${value} ${unitLabel ?? ''}`}
          style={[
            { fontSize: 20, lineHeight: 28, fontWeight: '700', color: th.colors.text },
            tabularNums,
          ]}
        >
          {value}
          {unitLabel ? (
            <Text allowFontScaling style={{ fontSize: typeScale.body, fontWeight: '500' }}>
              {' '}
              {unitLabel}
            </Text>
          ) : null}
        </Text>
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
      <ActivityIndicator size="large" color={th.colors.primary} />
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

export function EmptyState({
  message,
  variant = 'package',
}: {
  message: string;
  variant?: 'package' | 'search';
}) {
  return (
    <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.lg }}>
      <EmptyCircleVignette variant={variant} />
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
