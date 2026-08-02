import { PixelRatio, useColorScheme, type TextStyle, type ViewStyle } from 'react-native';
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

/**
 * Line height for a given font size.
 *
 * 1.6x, not the tighter Latin ratios the type scale originally used (28/36,
 * 14/20, 12/16). React Native on Android does not treat lineHeight as a
 * minimum: CustomLineHeightSpan.chooseHeight clamps the line box to exactly
 * this value, and when the font needs more it raises the ascent — cutting the
 * tops off the glyphs rather than spacing the lines further apart.
 *
 * The ratio that has to be cleared is the font's own (ascent + descent) / em.
 * For Latin that is about 1.25, which every old value cleared. Noto Sans
 * Devanagari is about 1.54, which none of them did, so the tops of हिन्दी were
 * cut off. 1.6 clears it with a little to spare. Hindi is a first-class locale
 * here, so the scale has to fit both scripts.
 */
export function lineHeightFor(size: number): number {
  return Math.round(size * 1.6);
}

/** Minimum touch target (pt). */
export const TOUCH = 44;

/**
 * Whether the device is running a noticeably enlarged system font.
 *
 * Text scales with this setting; the controls beside it do not, because their
 * dimensions are in points. Past roughly 1.3x, a row that pairs a fixed-width
 * control with a label has too little left for the label — it degrades to a
 * character or two per line, or truncates. Layouts that would break check this
 * and give the text a line of its own instead.
 *
 * Read at render, so a change to the setting applies on the next mount. That is
 * the same moment the OS itself restarts the activity for, so in practice the
 * app is already remounting.
 */
export function isLargeFontScale(): boolean {
  return PixelRatio.getFontScale() >= 1.3;
}

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

/* ==========================================================================
 * Mockup design tokens
 *
 * Values read off the supplied mockups, which are the source of truth for the
 * attendee-facing screens. Kept separate from the palettes above so the two
 * cannot drift silently: anything here is quoting a design, not deriving from
 * the older Warm Relief scale.
 * ======================================================================== */

/** Full-bleed background gradients, top → bottom, one per mockup screen. */
export const gradients = {
  /** 2. Confirm attendance — deep navy night. */
  night: ['#141B34', '#1B2545', '#223056'] as const,
  /** 3. Be a Sahay Warrior — teal-green with a lighter core behind the shield. */
  warrior: ['#1F8A70', '#25A67F', '#1E7F68'] as const,
  /** 5. Can you carry something — pale lavender. */
  carry: ['#EAE6FB', '#E2DCF9', '#EDE9FC'] as const,
  /** 7. You're all set — green wash fading into the page. */
  allSet: ['#C9EBD5', '#E4F5EA', '#F5F7FA'] as const,
  /** 9. Match found — dark scrim over the map. */
  matchScrim: ['#101728EE', '#0D1322F5'] as const,
} as const;

/** Need-level chips on the requests list (mockup 4). */
export const needLevel = {
  high: { bg: '#FEE7E7', fg: '#D3382F' },
  moderate: { bg: '#FEF2D9', fg: '#B7791F' },
  low: { bg: '#E7F0FE', fg: '#2563EB' },
} as const;

/** "Active" pill on event cards (mockup 1). */
export const activePill = { bg: '#DCF5E5', fg: '#177A47' } as const;

/** Circular Yes/No affordances on the swipe cards (mockups 2, 3, 5). */
export const swipeChoice = {
  no: { bg: '#FDE7EC', fg: '#E0335B', ring: '#F8CBD6' },
  yes: { bg: '#DFF3E6', fg: '#1E9E5A', ring: '#BFE6CE' },
  size: 56,
} as const;

/**
 * Card elevation on the mockups is softer and wider than the old whisper: a
 * broad low-opacity drop that lifts white cards off the grey page.
 */
export function mockCardShadow(): ViewStyle {
  return {
    shadowColor: '#0B1220',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  };
}

/** The primary CTA carries a coloured shadow in the mockups, not a grey one. */
export function primaryButtonShadow(): ViewStyle {
  return {
    shadowColor: '#2563EB',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  };
}

/** Radii read off the mockups: inputs 12, cards 16, sheets/hero 24, pills 999. */
export const mockRadius = { input: 12, card: 16, sheet: 24, pill: 999 } as const;
