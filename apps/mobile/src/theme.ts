import { useColorScheme } from 'react-native';

/**
 * Design tokens. Calm, humane, non-partisan: soft neutrals + a single
 * steady blue accent (#4A6FA5). No photography, no gradients, no noise.
 */
export interface Theme {
  dark: boolean;
  colors: {
    bg: string;
    card: string;
    cardAlt: string;
    text: string;
    muted: string;
    border: string;
    accent: string;
    accentSoft: string;
    onAccent: string;
    danger: string;
    dangerSoft: string;
    success: string;
    successSoft: string;
    warn: string;
    warnSoft: string;
  };
}

const light: Theme = {
  dark: false,
  colors: {
    bg: '#F6F5F2',
    card: '#FFFFFF',
    cardAlt: '#EFEDE8',
    text: '#26292E',
    muted: '#6B7078',
    border: '#E2E0DA',
    accent: '#4A6FA5',
    accentSoft: '#E7EDF5',
    onAccent: '#FFFFFF',
    danger: '#A5504A',
    dangerSoft: '#F5E9E7',
    success: '#5E8C61',
    successSoft: '#E9F0E9',
    warn: '#A5804A',
    warnSoft: '#F5EFE4',
  },
};

const dark: Theme = {
  dark: true,
  colors: {
    bg: '#16181C',
    card: '#20242A',
    cardAlt: '#2A2F37',
    text: '#ECEAE5',
    muted: '#9AA0A8',
    border: '#343941',
    accent: '#7C9CC9',
    accentSoft: '#2A3A50',
    onAccent: '#10151C',
    danger: '#C98A85',
    dangerSoft: '#3E2C2A',
    success: '#93B996',
    successSoft: '#28352A',
    warn: '#C9AC85',
    warnSoft: '#3A3226',
  },
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const type = {
  title: 26,
  heading: 20,
  body: 16,
  label: 14,
  caption: 12,
} as const;
/** Minimum touch target (pt). */
export const TOUCH = 44;
