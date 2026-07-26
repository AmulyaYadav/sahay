import type { Category, Locale } from '@sahay/shared';

/** Localized category name with a graceful fallback chain. */
export function categoryName(cat: Category | undefined, locale: Locale): string {
  if (!cat) return '—';
  return cat.name[locale] ?? cat.name.en ?? cat.slug;
}

export function categoryById(cats: Category[] | undefined, id: string): Category | undefined {
  return cats?.find((c) => c.id === id);
}

export function categoryBySlug(cats: Category[] | undefined, slug: string): Category | undefined {
  return cats?.find((c) => c.slug === slug);
}

/**
 * Simple emoji glyphs for catalogue icon keys — neutral, language-free, and
 * render everywhere without an icon font dependency.
 */
const ICON_GLYPHS: Record<string, string> = {
  droplet: '💧',
  droplets: '💧',
  utensils: '🍱',
  cookie: '🍪',
  apple: '🍎',
  baby: '🍼',
  bed: '🛏️',
  tent: '⛺',
  towel: '🧻',
  shield: '🛡️',
  'cloud-rain': '🌧️',
  umbrella: '☂️',
  heart: '🩷',
  box: '📦',
  trash: '🗑️',
  flashlight: '🔦',
  battery: '🔋',
  'battery-charging': '🔋',
  cable: '🔌',
  plug: '🔌',
  shirt: '👕',
  footprints: '🧦',
  hand: '🧤',
  bandage: '🩹',
  snowflake: '❄️',
  pencil: '✏️',
  notebook: '📓',
};

export function categoryGlyph(cat: Category | undefined): string {
  return (cat && ICON_GLYPHS[cat.icon]) || '📦';
}

/** Group ordering for the picker (mirrors CATEGORY_GROUPS). */
export function groupCategories(cats: Category[]): Map<string, Category[]> {
  const map = new Map<string, Category[]>();
  const sorted = [...cats].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const c of sorted) {
    if (!c.active) continue;
    const list = map.get(c.group) ?? [];
    list.push(c);
    map.set(c.group, list);
  }
  return map;
}
