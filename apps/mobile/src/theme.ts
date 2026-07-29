import { useColorScheme, type TextStyle, type ViewStyle } from 'react-native';
import type { CategoryGroup, ShortageLevel } from '@sahay/shared';

/**
 * "Warm Relief" design tokens — transcribed from docs/design-system.md.
 * Friendly, calm, humanitarian: rounded cards on a soft gray canvas,
 * pastel category chips, pill badges, one confident blue.
 *
 * Legacy token names (bg/card/accent/…) are kept as aliases so every
 * screen resolves to the new palette without behavioural changes.
 */
export interface Theme {
  dark: boolean;
  colors: {
    /* Warm Relief tokens */
    primary: string;
    primaryStrong: string;
    primaryTint: string;
    success: string;
    successTint: string;
    warning: string;
    warningTint: string;
    error: string;
    errorTint: string;
    canvas: string;
    surface: string;
    border: string;
    text: string;
    textSecondary: string;
    textOnColor: string;
    /** Secondary-button border (primary-tinted). */
    primaryBorder: string;
    /* Legacy aliases (same palette, old names) */
    bg: string;
    card: string;
    cardAlt: string;
    muted: string;
    accent: string;
    accentSoft: string;
    onAccent: string;
    danger: string;
    dangerSoft: string;
    successSoft: string;
    warn: string;
    warnSoft: string;
  };
}

function build(dark: boolean): Theme {
  // Dark theme derives by swapping canvas/surface/text and using 15%-alpha tints.
  const c = dark
    ? {
        primary: '#2563EB',
        primaryStrong: '#1D4ED8',
        primaryTint: '#2563EB26',
        success: '#16A34A',
        successTint: '#16A34A26',
        warning: '#D97706',
        warningTint: '#D9770626',
        error: '#DC2626',
        errorTint: '#DC262626',
        canvas: '#101828',
        surface: '#1B2432',
        border: '#2A3446',
        text: '#F2F4F7',
        textSecondary: '#98A2B3',
        textOnColor: '#FFFFFF',
        primaryBorder: '#2563EB59',
        neutralTint: '#FFFFFF14',
      }
    : {
        primary: '#2563EB',
        primaryStrong: '#1D4ED8',
        primaryTint: '#EFF4FF',
        success: '#16A34A',
        successTint: '#E8F7EE',
        warning: '#D97706',
        warningTint: '#FEF3E2',
        error: '#DC2626',
        errorTint: '#FDECEC',
        canvas: '#F6F7F9',
        surface: '#FFFFFF',
        border: '#E5E9F0',
        text: '#101828',
        textSecondary: '#667085',
        textOnColor: '#FFFFFF',
        primaryBorder: '#BFD3F8',
        neutralTint: '#EEF1F5',
      };
  return {
    dark,
    colors: {
      ...c,
      /* legacy aliases */
      bg: c.canvas,
      card: c.surface,
      cardAlt: c.neutralTint,
      muted: c.textSecondary,
      accent: c.primary,
      accentSoft: c.primaryTint,
      onAccent: c.textOnColor,
      danger: c.error,
      dangerSoft: c.errorTint,
      successSoft: c.successTint,
      warn: c.warning,
      warnSoft: c.warningTint,
    },
  };
}

const light = build(false);
const dark = build(true);

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

/* ------------------------------------------------------- category tints */

export interface CategoryTint {
  bg: string;
  icon: string;
}

const CATEGORY_TINTS_LIGHT: Record<CategoryGroup, CategoryTint> = {
  hydration: { bg: '#E3F1FD', icon: '#1D9BF0' },
  food: { bg: '#FEF3E2', icon: '#D97706' },
  shelter: { bg: '#EFE9FE', icon: '#7C5CE0' },
  hygiene: { bg: '#FDE8F0', icon: '#DB2777' },
  power: { bg: '#FEF9C3', icon: '#CA8A04' },
  clothing: { bg: '#E8F7EE', icon: '#16A34A' },
  first_aid: { bg: '#FDECEC', icon: '#DC2626' },
  misc: { bg: '#EEF1F5', icon: '#667085' },
};

/** Dark mode keeps the icon hue, tint drops to 15% alpha. */
const CATEGORY_TINTS_DARK: Record<CategoryGroup, CategoryTint> = {
  hydration: { bg: '#1D9BF026', icon: '#1D9BF0' },
  food: { bg: '#D9770626', icon: '#D97706' },
  shelter: { bg: '#7C5CE026', icon: '#9F87E8' },
  hygiene: { bg: '#DB277726', icon: '#DB2777' },
  power: { bg: '#CA8A0426', icon: '#EAB308' },
  clothing: { bg: '#16A34A26', icon: '#16A34A' },
  first_aid: { bg: '#DC262626', icon: '#EF4444' },
  misc: { bg: '#FFFFFF14', icon: '#98A2B3' },
};

export function categoryTint(group: string | undefined, theme: Theme): CategoryTint {
  const map = theme.dark ? CATEGORY_TINTS_DARK : CATEGORY_TINTS_LIGHT;
  return map[(group ?? 'misc') as CategoryGroup] ?? map.misc;
}

/* --------------------------------------------------- shortage-level pills */

export function shortagePill(level: ShortageLevel | string, theme: Theme): { bg: string; fg: string } {
  const c = theme.colors;
  switch (level) {
    case 'critical_shortage':
      return { bg: c.errorTint, fg: c.error };
    case 'high_need':
      return { bg: c.errorTint, fg: theme.dark ? '#F97316' : '#C2410C' };
    case 'moderate_need':
      return { bg: c.warningTint, fg: c.warning };
    case 'adequate':
      return { bg: c.successTint, fg: c.success };
    case 'possible_surplus':
      return { bg: c.primaryTint, fg: c.primary };
    default:
      return { bg: c.cardAlt, fg: c.textSecondary };
  }
}

/* ------------------------------------------------------- shape and space */

/** 4-pt spacing grid. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Radius scale: 12 inputs/buttons/chips · 16 cards/rows · 20 large cards · 24 hero/modals. */
export const radius = { sm: 12, md: 12, lg: 16, xl: 20, xxl: 24, pill: 999 } as const;

/** Type scale (system font — weights matter more than the family). */
export const type = {
  h1: 28,
  title: 28,
  heading: 20,
  h3: 16,
  body: 14,
  label: 14,
  caption: 12,
} as const;

export const lineHeights: Record<number, number> = { 28: 36, 20: 28, 16: 24, 14: 20, 12: 16 };

/** Minimum touch target (pt). */
export const TOUCH = 44;

/** Card elevation: surface + 1px border + a whisper of shadow. Nothing floats aggressively. */
export function cardShadow(theme: Theme): ViewStyle {
  return {
    shadowColor: '#101828',
    shadowOpacity: theme.dark ? 0 : 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: theme.dark ? 0 : 1,
  };
}

/** Numbers that matter (countdowns, stats): 700 + tabular-nums. */
export const tabularNums: TextStyle = { fontVariant: ['tabular-nums'] };
