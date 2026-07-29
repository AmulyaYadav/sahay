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

/**
 * Flat-vector hero scene: sky, riverside with an arched stone bridge, trees, a
 * relief tent and volunteers at a supply table. A geometric interpretation of
 * the brief's illustration — deliberately flat (no gradients on figures, no
 * texture) so it stays consistent with this app's outline-icon language.
 * Purely decorative.
 */
export function HeroScene() {
  return (
    <svg
      aria-hidden="true"
      className="hero-scene"
      viewBox="0 0 720 470"
      preserveAspectRatio="xMidYMax slice"
    >
      {/* Left edge fades into the hero's own gradient so the panel has no seam. */}
      <defs>
        <linearGradient id="heroFade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.11" stopColor="#ffffff" stopOpacity="1" />
        </linearGradient>
        <mask id="heroMask">
          <rect width="720" height="470" fill="url(#heroFade)" />
        </mask>
      </defs>
      <g mask="url(#heroMask)">
        {/* sky + water */}
        <rect width="720" height="470" fill="#e8f1fb" />
        <circle cx="120" cy="70" r="46" fill="#ffffff" opacity="0.55" />
        <circle cx="170" cy="80" r="34" fill="#ffffff" opacity="0.45" />
        <circle cx="470" cy="52" r="30" fill="#ffffff" opacity="0.4" />
        <rect y="300" width="720" height="170" fill="#cfe6f7" />
        <rect y="356" width="720" height="114" fill="#eef3ea" />

      {/* distant hills */}
      <path d="M0 300 q110 -70 230 -12 T430 298 L430 300 H0Z" fill="#d7e8d4" />

      {/* arched stone bridge — sits left of the phone */}
      <g fill="#e7ded2" stroke="#cfc2b0" strokeWidth="2">
        <rect x="-10" y="262" width="215" height="20" rx="4" />
        <path d="M18 282 h58 v40 a29 29 0 0 0 -58 0 z" fill="#cfe6f7" stroke="none" />
        <path d="M18 322 a29 29 0 0 1 58 0" fill="none" />
        <path d="M120 282 h58 v40 a29 29 0 0 0 -58 0 z" fill="#cfe6f7" stroke="none" />
        <path d="M120 322 a29 29 0 0 1 58 0" fill="none" />
        <rect x="-10" y="282" width="28" height="46" />
        <rect x="76" y="282" width="44" height="46" />
        <rect x="178" y="282" width="27" height="46" />
      </g>

      {/* trees */}
      <g>
        <rect x="252" y="278" width="9" height="50" fill="#a87f5c" />
        <circle cx="256" cy="258" r="36" fill="#8cc08a" />
        <circle cx="232" cy="278" r="23" fill="#7cb37b" />
        <rect x="596" y="242" width="12" height="80" fill="#a87f5c" />
        <circle cx="602" cy="212" r="54" fill="#7cb37b" />
        <circle cx="654" cy="240" r="38" fill="#8cc08a" />
        <rect x="694" y="266" width="10" height="58" fill="#a87f5c" />
        <circle cx="699" cy="242" r="36" fill="#8cc08a" />
      </g>

      {/* relief tent */}
      <g>
        <path d="M452 300 L520 208 L588 300 Z" fill="#8fc0ea" />
        <path d="M520 208 L588 300 L554 300 Z" fill="#6ea9dd" />
        <rect x="516" y="208" width="8" height="92" fill="#5b93c4" />
      </g>

      {/* supply table with water bottles */}
      <g>
        <rect x="452" y="338" width="164" height="11" rx="3" fill="#c99f6f" />
        <rect x="460" y="349" width="9" height="46" fill="#b28755" />
        <rect x="600" y="349" width="9" height="46" fill="#b28755" />
        {[466, 488, 510, 532, 554, 576].map((x) => (
          <g key={x}>
            <rect x={x} y="316" width="12" height="22" rx="3" fill="#dff0fb" stroke="#a9cfe8" strokeWidth="1.5" />
            <rect x={x + 3} y="310" width="6" height="7" fill="#7cb1d6" />
          </g>
        ))}
        {/* crates */}
        <rect x="438" y="358" width="56" height="42" rx="4" fill="#d9b184" stroke="#bd8f5f" strokeWidth="2" />
        <rect x="504" y="370" width="48" height="30" rx="4" fill="#e2be93" stroke="#bd8f5f" strokeWidth="2" />
      </g>

      {/* volunteers: flat figures, no faces */}
      <g>
        <circle cx="654" cy="282" r="16" fill="#e8b98f" />
        <path d="M639 299 h30 l8 66 h-46 z" fill="#3d6fd0" />
        <rect x="643" y="365" width="10" height="36" fill="#33405c" />
        <rect x="659" y="365" width="10" height="36" fill="#33405c" />
        <circle cx="592" cy="290" r="14" fill="#d9a877" />
        <path d="M579 305 h26 l7 54 h-40 z" fill="#f0c674" />
        <circle cx="556" cy="292" r="14" fill="#e8b98f" />
        <path d="M543 307 h26 l7 52 h-40 z" fill="#7cb37b" />
        <circle cx="520" cy="290" r="14" fill="#c79261" />
        <path d="M507 305 h26 l7 54 h-40 z" fill="#5b93c4" />
      </g>

        {/* paving line */}
        <path d="M0 404 H720" stroke="#dfe4d8" strokeWidth="3" />
      </g>
    </svg>
  );
}

/**
 * Decorative, static preview of the mobile app's real "Helping now" home
 * screen — used only as marketing illustration next to a download CTA, never
 * fed with live data (the web app has no such screen; this is what mobile
 * users see). Content is illustrative, not a live event.
 */
export function PhoneMockup({
  eventTitle,
  areaLabel,
  schedule,
  activeLabel,
  helpingNowLabel,
  helpingNowHint,
  locationHint,
  expiryHint,
  stopLabel,
  quickActionsLabel,
  requestLabel,
  requestHint,
  supplyLabel,
  supplyHint,
}: {
  eventTitle: string;
  areaLabel: string;
  schedule: string;
  activeLabel: string;
  helpingNowLabel: string;
  helpingNowHint: string;
  locationHint: string;
  expiryHint: string;
  stopLabel: string;
  quickActionsLabel: string;
  requestLabel: string;
  requestHint: string;
  supplyLabel: string;
  supplyHint: string;
}) {
  return (
    <div className="phone-mock" aria-hidden="true">
      <div className="phone-mock-screen">
        <div className="phone-mock-statusbar">
          <Icon name="menu" size={16} />
          <Icon name="bell" size={16} />
        </div>
        <div className="phone-mock-header">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{eventTitle}</strong>
              <div className="phone-mock-meta">{areaLabel}</div>
              <div className="phone-mock-meta">
                <Icon name="clock" size={11} /> {schedule}
              </div>
            </div>
            <span className="tier-pill tier-low" style={{ fontSize: 10 }}>
              {activeLabel}
            </span>
          </div>
        </div>
        <div className="phone-mock-card">
          <div className="phone-mock-card-title">
            {helpingNowLabel}
            <span className="phone-mock-toggle" />
          </div>
          <span style={{ fontSize: 11, color: 'var(--c-text-soft)' }}>{helpingNowHint}</span>
          <div className="phone-mock-meta">
            <Icon name="location" size={11} /> {locationHint}
          </div>
          <div className="phone-mock-meta">
            <Icon name="clock" size={11} /> {expiryHint}
          </div>
          <div className="phone-mock-ghostbtn">{stopLabel}</div>
        </div>
        <div className="phone-mock-sectiontitle">{quickActionsLabel}</div>
        <div className="phone-mock-actions">
          <div className="phone-mock-action">
            <span
              className="phone-mock-action-icon"
              style={{ background: 'var(--c-primary-tint)', color: 'var(--c-primary)' }}
            >
              <Icon name="hand" size={12} />
            </span>
            <div style={{ minWidth: 0 }}>
              <strong>{requestLabel}</strong>
              <span>{requestHint}</span>
            </div>
          </div>
          <div className="phone-mock-action">
            <span
              className="phone-mock-action-icon"
              style={{ background: 'var(--c-success-tint)', color: 'var(--c-success-text)' }}
            >
              <Icon name="box" size={12} />
            </span>
            <div style={{ minWidth: 0 }}>
              <strong>{supplyLabel}</strong>
              <span>{supplyHint}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
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
