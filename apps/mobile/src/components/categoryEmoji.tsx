import React from 'react';
import { Text } from 'react-native';

/**
 * Emoji glyphs for supply categories, as the mockups draw them (a droplet for
 * water, a basket for food, and so on).
 *
 * Emoji rather than icons because that is what the designs show, and because the
 * platform already renders them in colour at any size. Unmapped categories fall
 * back to a parcel rather than showing nothing — new catalogue entries are added
 * by admins at runtime and must not render blank.
 */
const EMOJI: Record<string, string> = {
  'water-bottle': '💧',
  'water-pack': '🚰',
  ors: '🧴',
  'packaged-food': '🧺',
  meal: '🍱',
  biscuits: '🍪',
  fruit: '🍎',
  'baby-food': '🍼',
  blanket: '🧣',
  'sleeping-mat': '🛏️',
  tarpaulin: '⛺',
  towel: '🧻',
  'mosquito-net': '🦟',
  'mosquito-repellent': '🧴',
  raincoat: '🧥',
  umbrella: '☂️',
  'sanitary-pads': '🩹',
  diapers: '🧷',
  tissues: '🧻',
  'wet-wipes': '🧻',
  soap: '🧼',
  masks: '😷',
  sanitizer: '🧴',
  'waste-bags': '🗑️',
  torch: '🔦',
  batteries: '🔋',
  'power-bank': '🔌',
  'charging-cable': '🔗',
  'charging-adapter': '🔌',
  shirt: '👕',
  jacket: '🧥',
  socks: '🧦',
  gloves: '🧤',
  'warm-clothing': '🧥',
  bandages: '🩹',
  gauze: '🩹',
  'medical-tape': '🩹',
  'disposable-gloves': '🧤',
  'cold-pack': '🧊',
  stationery: '✏️',
  notebook: '📒',
  rope: '🪢',
  container: '🥡',
};

export function CategoryEmoji({ slug, size = 20 }: { slug: string; size?: number }) {
  return (
    <Text allowFontScaling={false} style={{ fontSize: size, lineHeight: size * 1.25 }}>
      {EMOJI[slug] ?? '📦'}
    </Text>
  );
}
