/** Minimal category/illustration primitives for the public landing page and event detail.
 * This is a deliberately small, self-contained stand-in — it does not depend on any
 * separate in-flight design-system work. Built only from tokens/icons already in this repo.
 */
import { Icon } from './icons';

const GROUP_COLOR: Record<string, string> = {
  hydration: 'var(--c-accent)',
  food: 'var(--c-warn)',
  shelter: 'var(--c-ok)',
  hygiene: 'var(--c-accent)',
  power: 'var(--c-warn)',
  clothing: 'var(--c-accent)',
  first_aid: 'var(--c-danger)',
  misc: 'var(--c-text-soft)',
};

export function CategoryChip({ group, icon, size = 'md' }: { group?: string; icon: string; size?: 'md' | 'sm' }) {
  const color = GROUP_COLOR[group ?? 'misc'] ?? GROUP_COLOR.misc;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size === 'sm' ? 28 : 36,
        height: size === 'sm' ? 28 : 36,
        borderRadius: 'var(--radius-md)',
        background: 'var(--c-surface-2)',
        color,
        flexShrink: 0,
      }}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : 20} />
    </span>
  );
}

export function IllustrationVignette({ name, size = 140 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 'var(--radius-full)',
        background: 'var(--c-accent-soft)',
        color: 'var(--c-accent-strong)',
        flexShrink: 0,
      }}
    >
      <Icon name={name} size={Math.round(size * 0.4)} />
    </span>
  );
}
