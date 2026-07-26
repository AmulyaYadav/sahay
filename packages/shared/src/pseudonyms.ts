/**
 * Pseudonym generation. Two tiers:
 *  - account pseudonym: stable, regenerable (rate-limited server-side)
 *  - match alias: fresh per match, so behavior across exchanges cannot be correlated
 * Words are deliberately neutral (colors/nature) — no political, religious or gendered terms.
 */

export const PSEUDONYM_ADJECTIVES = [
  'Blue', 'Green', 'Silver', 'Quiet', 'Amber', 'Coral', 'Golden', 'Misty',
  'Violet', 'Crimson', 'Gentle', 'Bright', 'Calm', 'Swift', 'Mellow', 'Sunny',
  'Teal', 'Ivory', 'Copper', 'Dusty', 'Emerald', 'Hazel', 'Indigo', 'Jade',
  'Lively', 'Maroon', 'Noble', 'Olive', 'Pearl', 'Rosy', 'Sandy', 'Tranquil',
] as const;

export const PSEUDONYM_NOUNS = [
  'Sparrow', 'Mango', 'River', 'Lantern', 'Cedar', 'Lotus', 'Falcon', 'Meadow',
  'Pebble', 'Cloud', 'Harbor', 'Willow', 'Comet', 'Fern', 'Heron', 'Island',
  'Jasmine', 'Kite', 'Lake', 'Maple', 'Nutmeg', 'Orchid', 'Pine', 'Quill',
  'Reed', 'Saffron', 'Tamarind', 'Umbrella', 'Valley', 'Wren', 'Yak', 'Zephyr',
] as const;

/** Deterministic pseudonym from two indexes (server picks random indexes). */
export function pseudonymFromIndexes(adjIdx: number, nounIdx: number): string {
  const adj = PSEUDONYM_ADJECTIVES[Math.abs(adjIdx) % PSEUDONYM_ADJECTIVES.length]!;
  const noun = PSEUDONYM_NOUNS[Math.abs(nounIdx) % PSEUDONYM_NOUNS.length]!;
  return `${adj} ${noun}`;
}

export const AVATAR_PALETTE = [
  '#4A6FA5', '#5E8C61', '#8C6A5E', '#6B5E8C', '#A5804A', '#4A9DA5',
  '#A54A6F', '#7A8C5E', '#5E7A8C', '#8C5E7A',
] as const;

/**
 * Simple deterministic avatar descriptor from a seed string.
 * Clients render a colored circle with the pseudonym's initials — no photos, ever.
 */
export function avatarFromSeed(seed: string): { color: string; initials: string } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const color = AVATAR_PALETTE[h % AVATAR_PALETTE.length]!;
  const initials = seed
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return { color, initials };
}
