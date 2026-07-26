/** Hand-rolled design-system primitives. All strings arrive via props (i18n happens above). */
import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon } from './icons';

/* ------------------------------------------------------------------ button */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost';
  loading?: boolean;
  block?: boolean;
  large?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading = false, block = false, large = false, className, children, disabled, ...rest },
  ref,
) {
  const cls = [
    'btn',
    `btn-${variant}`,
    block ? 'btn-block' : '',
    large ? 'btn-lg' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type="button" className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ fields */

interface FieldWrapProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id: string;
  children: ReactNode;
}

function FieldWrap({ label, hint, error, id, children }: FieldWrapProps) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field-hint text-danger" role="alert" id={`${id}-err`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id: idProp, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldWrap label={label} hint={hint} error={error} id={id}>
      <input
        ref={ref}
        id={id}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...rest}
      />
    </FieldWrap>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, id: idProp, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldWrap label={label} hint={hint} error={error} id={id}>
      <textarea ref={ref} id={id} className="textarea" aria-invalid={error ? true : undefined} {...rest} />
    </FieldWrap>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  hint?: ReactNode;
}

export function Select({ label, hint, id: idProp, children, ...rest }: SelectProps) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldWrap label={label} hint={hint} id={id}>
      <select id={id} className="select" {...rest}>
        {children}
      </select>
    </FieldWrap>
  );
}

/* ----------------------------------------------------------------- stepper */

export function Stepper({
  value,
  min = 1,
  max = 9999,
  step = 1,
  onChange,
  unitLabel,
  decreaseLabel,
  increaseLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  unitLabel?: string;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  return (
    <div className="stepper">
      <button type="button" aria-label={decreaseLabel} onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min}>
        <Icon name="minus" />
      </button>
      <span className="stepper-value" role="status" aria-live="polite">
        {value}
        {unitLabel ? <span className="text-sm text-soft"> {unitLabel}</span> : null}
      </span>
      <button type="button" aria-label={increaseLabel} onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ toggle */

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

/* -------------------------------------------------------------------- chip */

export function Chip({
  selected,
  onClick,
  children,
  role = 'button',
  disabled,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  role?: 'button' | 'radio';
  disabled?: boolean;
}) {
  if (role === 'radio') {
    return (
      <button type="button" role="radio" aria-checked={selected ?? false} className="chip" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={onClick ? 'chip' : 'chip chip-static'}
      aria-pressed={onClick ? (selected ?? false) : undefined}
      onClick={onClick}
      disabled={disabled || !onClick}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------- card / badges */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={className ? `card ${className}` : 'card'}>{children}</section>;
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';
  children: ReactNode;
}) {
  return <span className={tone === 'neutral' ? 'badge' : `badge badge-${tone}`}>{children}</span>;
}

export function Banner({
  tone = 'neutral',
  icon,
  children,
  role,
}: {
  tone?: 'neutral' | 'info' | 'warn' | 'danger' | 'ok';
  icon?: string;
  children: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div className={tone === 'neutral' ? 'banner' : `banner banner-${tone}`} role={role}>
      {icon ? <Icon name={icon} /> : null}
      <div>{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- skeleton */

export function Skeleton({ height = 20, width = '100%' }: { height?: number | string; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card" aria-hidden="true">
      <div className="stack-sm">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} height={16} width={`${90 - i * 15}%`} />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------- tabs */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  labelledBy,
}: {
  tabs: { key: T; label: ReactNode }[];
  active: T;
  onChange: (t: T) => void;
  labelledBy?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-labelledby={labelledBy}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab.key === active}
          tabIndex={tab.key === active ? 0 : -1}
          onClick={() => onChange(tab.key)}
          onKeyDown={(e) => {
            const idx = tabs.findIndex((x) => x.key === active);
            if (e.key === 'ArrowRight') {
              const next = tabs[(idx + 1) % tabs.length];
              if (next) onChange(next.key);
            } else if (e.key === 'ArrowLeft') {
              const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
              if (prev) onChange(prev.key);
            }
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
