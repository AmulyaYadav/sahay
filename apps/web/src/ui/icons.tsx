/**
 * Small inline SVG icon set. Keys match the catalogue icon keys plus UI needs.
 * All icons are decorative by default (aria-hidden); pass `label` for meaningful ones.
 */
import type { JSX } from 'react';

const PATHS: Record<string, JSX.Element> = {
  droplet: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  droplets: (
    <>
      <path d="M9 4s4 4.5 4 7.6A4 4 0 0 1 5 11.6C5 8.5 9 4 9 4z" />
      <path d="M17 11s3 3.4 3 5.7a3 3 0 0 1-6 0c0-2.3 3-5.7 3-5.7z" />
    </>
  ),
  utensils: (
    <>
      <path d="M7 3v7M4.5 3v4a2.5 2.5 0 0 0 5 0V3M7 12v9" />
      <path d="M17 3c-1.7 0-3 2-3 5s1.3 4 3 4v9M17 3v18" />
    </>
  ),
  cookie: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="9" cy="10" r="0.5" />
      <circle cx="14" cy="14" r="0.5" />
      <circle cx="13" cy="9" r="0.5" />
    </>
  ),
  apple: (
    <>
      <path d="M12 7c-4 -2.5-8 0-8 5 0 4 3 9 6 9 1 0 1.5-.5 2-.5s1 .5 2 .5c3 0 6-5 6-9 0-5-4-7.5-8-5z" />
      <path d="M12 7c0-2 1-4 3-4" />
    </>
  ),
  baby: (
    <>
      <circle cx="12" cy="9" r="5" />
      <path d="M12 2v2M5 20c1.5-3 4-4 7-4s5.5 1 7 4" />
    </>
  ),
  bed: (
    <>
      <path d="M3 7v13M3 16h18v4M3 12h18v-2a3 3 0 0 0-3-3H9" />
      <circle cx="6.5" cy="9.5" r="1.5" />
    </>
  ),
  tent: <path d="M12 4 2 20h7l3-6 3 6h7L12 4z" />,
  towel: <path d="M6 3h9a3 3 0 0 1 3 3v15H9V8H6a2 2 0 0 1 0-5zM9 8h9" />,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />,
  'cloud-rain': (
    <>
      <path d="M7 15a5 5 0 1 1 1-9.9A6 6 0 0 1 19 8a4 4 0 0 1-1 7.9" />
      <path d="M8 18v2M12 17v3M16 18v2" />
    </>
  ),
  umbrella: <path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 12v6a2 2 0 0 0 4 0" />,
  heart: <path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.7A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z" />,
  box: <path d="M3 8l9-5 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" />,
  flashlight: <path d="M8 3h8v4l-2 3v11h-4V10L8 7V3zM8 6h8" />,
  battery: (
    <>
      <rect x="2" y="8" width="17" height="8" rx="2" />
      <path d="M22 11v2M5 11v2M8.5 11v2" />
    </>
  ),
  'battery-charging': (
    <>
      <rect x="2" y="8" width="17" height="8" rx="2" />
      <path d="M22 11v2M11 9l-2.5 3H12l-2.5 3" />
    </>
  ),
  cable: <path d="M4 20c0-5 4-4 8-8s3-8 8-8M7 17l-3 3M20 4l-3 3" />,
  plug: <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-6 6v4M6 8v3" />,
  shirt: <path d="M8 4l4 2 4-2 5 4-2.5 3L17 9v11H7V9l-1.5 2L3 8l5-4z" />,
  footprints: (
    <>
      <path d="M6 4c2 0 3 2 3 5s-1 4-2.5 4S4 11 4 8s.5-4 2-4zM7 15v2a2 2 0 0 0 4 0" />
      <path d="M18 8c-2 0-3 2-3 5s1 4 2.5 4 2.5-2 2.5-5-.5-4-2-4zM17 19v1" />
    </>
  ),
  hand: <path d="M8 12V5a1.5 1.5 0 0 1 3 0v6V4a1.5 1.5 0 0 1 3 0v7V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6c-3 0-4.5-1.5-6-4l-2-4a1.5 1.5 0 0 1 2.6-1.4L8 13" />,
  bandage: (
    <>
      <rect x="2" y="8.5" width="20" height="7" rx="3.5" transform="rotate(-30 12 12)" />
      <circle cx="11" cy="11.5" r="0.5" />
      <circle cx="13" cy="12.5" r="0.5" />
    </>
  ),
  snowflake: <path d="M12 2v20M4 6l16 12M20 6L4 18M8 3.5 12 6l4-2.5M8 20.5 12 18l4 2.5" />,
  pencil: <path d="M4 20l1-5L16.5 3.5a2 2 0 0 1 3 3L8 18l-4 2zM13 6l4 4" />,
  notebook: <path d="M6 3h13v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v18M13 8h3M13 12h3" />,
  /* ui icons */
  search: <path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 21 21" />,
  home: <path d="M4 11l8-7 8 7v9h-6v-6h-4v6H4v-9z" />,
  calendar: <path d="M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-5.5 8-5.5s6.5 1.5 8 5.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2l1.2 3 3.2-.8 1.4 2.4 2.6 2-1.2 3 1.2 3-2.6 2-1.4 2.4-3.2-.8L12 22l-1.2-3-3.2.8-1.4-2.4-2.6-2 1.2-3-1.2-3 2.6-2 1.4-2.4 3.2.8L12 2z" />
    </>
  ),
  send: <path d="M3 11l18-8-8 18-2.5-7.5L3 11z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M4 12.5 9.5 18 20 6" />,
  checks: <path d="M2 12.5 7.5 18 13 11M9 15l3.5 3L23 6" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  chevronDown: <path d="M5 9l7 7 7-7" />,
  warning: <path d="M12 3 2 20h20L12 3zM12 9v5M12 17.5v.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5v.5" />
    </>
  ),
  location: (
    <>
      <path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18-3-3-3-15 0-18z" />
    </>
  ),
  logout: <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 8l4 4-4 4M9 12h10" />,
  chat: <path d="M4 5h16v11H9l-5 4V5z" />,
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  block: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.5 5.5l13 13" />
    </>
  ),
  flag: <path d="M6 3v18M6 4h11l-2 4 2 4H6" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  label,
  className,
}: {
  name: string;
  size?: number;
  label?: string;
  className?: string;
}): JSX.Element {
  const shape = PATHS[name] ?? PATHS['box'];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      className={className}
      focusable="false"
    >
      {shape}
    </svg>
  );
}
