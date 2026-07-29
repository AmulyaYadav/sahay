/**
 * Countdown card (§4.10): caption ("Respond within"), a big 700 tabular
 * number, and a thin progress bar. Announces politely via visually-hidden
 * text; the bar simply tracks the remaining fraction (no decorative motion).
 */
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
  label,
  onExpire,
}: {
  deadline: string;
  totalSeconds: number;
  /** Caption above the number, e.g. "Respond within". */
  label?: string;
  onExpire?: () => void;
}) {
  const t = useT();
  const left = useCountdown(deadline);

  useEffect(() => {
    if (left === 0 && onExpire) onExpire();
  }, [left, onExpire]);

  const frac = totalSeconds > 0 ? Math.min(1, left / totalSeconds) : 0;
  const low = left <= 10;

  return (
    <div className="countdown-card">
      {label ? <span className="caption">{label}</span> : null}
      <span className={low ? 'countdown-num countdown-num-low' : 'countdown-num'}>
        {left}
        <span className="visually-hidden"> {t('misc.secondsRemaining', { seconds: left })}</span>
      </span>
      <div className="countdown-bar" aria-hidden="true">
        <div
          className={low ? 'countdown-bar-fill countdown-bar-fill-low' : 'countdown-bar-fill'}
          style={{ width: `${frac * 100}%` }}
        />
      </div>
    </div>
  );
}
