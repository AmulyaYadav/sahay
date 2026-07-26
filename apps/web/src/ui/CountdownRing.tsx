/** Countdown ring to a deadline. Announces politely; degrades to plain text under reduced motion. */
import { useEffect, useState } from 'react';
import { useT } from '../i18n/LocaleContext';

function secondsLeft(deadline: string): number {
  return Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000));
}

export function useCountdown(deadline: string): number {
  const [left, setLeft] = useState(() => secondsLeft(deadline));
  useEffect(() => {
    setLeft(secondsLeft(deadline));
    const id = window.setInterval(() => setLeft(secondsLeft(deadline)), 500);
    return () => window.clearInterval(id);
  }, [deadline]);
  return left;
}

export function CountdownRing({
  deadline,
  totalSeconds,
  size = 88,
  onExpire,
}: {
  deadline: string;
  totalSeconds: number;
  size?: number;
  onExpire?: () => void;
}) {
  const t = useT();
  const left = useCountdown(deadline);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (left === 0 && onExpire) onExpire();
  }, [left, onExpire]);

  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const frac = totalSeconds > 0 ? Math.min(1, left / totalSeconds) : 0;

  return (
    <div className="countdown-ring" style={{ width: size, height: size }}>
      {!reduced ? (
        <svg width={size} height={size} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--c-border)" strokeWidth={6} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={left <= 10 ? 'var(--c-danger)' : 'var(--c-accent)'}
            strokeWidth={6}
            fill="none"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - frac)}
            strokeLinecap="round"
          />
        </svg>
      ) : null}
      <span className="countdown-ring-label">
        {left}
        <span className="visually-hidden"> {t('misc.secondsRemaining', { seconds: left })}</span>
      </span>
    </div>
  );
}
