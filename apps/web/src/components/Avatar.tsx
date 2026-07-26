import { avatarFromSeed } from '@sahay/shared';

/** Colored-circle avatar with initials — no photos, ever. */
export function Avatar({ seed, name, size = 40 }: { seed: string; name?: string; size?: number }) {
  const { color, initials } = avatarFromSeed(name ?? seed);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
