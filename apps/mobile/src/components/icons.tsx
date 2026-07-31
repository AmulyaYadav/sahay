import React from 'react';
import Svg, { Circle, Path, Polyline, Rect } from 'react-native-svg';

/**
 * Consistent 1.75px-stroke outline icon set (Warm Relief §5), colored by
 * context. 24px viewBox; render size defaults to 20.
 */
export type IconName =
  | 'home'
  | 'map-pin'
  | 'backpack'
  | 'user'
  | 'bell'
  | 'calendar'
  | 'chevron-right'
  | 'send'
  | 'alert'
  | 'clock'
  | 'shield'
  | 'info'
  | 'search'
  | 'log-out'
  | 'users'
  | 'help'
  | 'settings'
  | 'hand-heart'
  | 'package'
  | 'eye-off'
  | 'arrow-left'
  | 'close'
  | 'check'
  | 'menu';

interface IconProps {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, color, strokeWidth = 1.75 }: IconProps) {
  const common = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {name === 'home' ? (
        <>
          <Path d="M3 10.5 12 3l9 7.5" {...common} />
          <Path d="M5 9.5V21h14V9.5" {...common} />
          <Path d="M9.5 21v-6h5v6" {...common} />
        </>
      ) : null}
      {name === 'map-pin' ? (
        <>
          <Path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11Z" {...common} />
          <Circle cx={12} cy={10} r={2.6} {...common} />
        </>
      ) : null}
      {name === 'backpack' ? (
        <>
          <Path d="M7 8a5 5 0 0 1 10 0v13H7V8Z" {...common} />
          <Path d="M9.5 5.5V4a2.5 2.5 0 0 1 5 0v1.5" {...common} />
          <Path d="M7 13h10" {...common} />
          <Path d="M10 17h4" {...common} />
        </>
      ) : null}
      {name === 'user' ? (
        <>
          <Circle cx={12} cy={8} r={4} {...common} />
          <Path d="M4.5 21a7.5 7.5 0 0 1 15 0" {...common} />
        </>
      ) : null}
      {name === 'bell' ? (
        <>
          <Path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9Z" {...common} />
          <Path d="M10 19a2.2 2.2 0 0 0 4 0" {...common} />
        </>
      ) : null}
      {name === 'calendar' ? (
        <>
          <Rect x={4} y={5.5} width={16} height={15} rx={2.5} {...common} />
          <Path d="M8 3v4M16 3v4M4 10.5h16" {...common} />
        </>
      ) : null}
      {name === 'chevron-right' ? <Polyline points="9,5 16,12 9,19" {...common} /> : null}
      {name === 'send' ? (
        <>
          <Path d="M21 3 10.5 13.5" {...common} />
          <Path d="M21 3 14 21l-3.5-7.5L3 10l18-7Z" {...common} />
        </>
      ) : null}
      {name === 'alert' ? (
        <>
          <Path d="M12 3.5 22 20H2L12 3.5Z" {...common} />
          <Path d="M12 10v4.5" {...common} />
          <Circle cx={12} cy={17.2} r={0.5} {...common} fill={color} />
        </>
      ) : null}
      {name === 'clock' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...common} />
          <Path d="M12 7v5l3.5 2" {...common} />
        </>
      ) : null}
      {name === 'shield' ? (
        <>
          <Path d="M12 3 5 6v5.5c0 4.5 3 8 7 9.5 4-1.5 7-5 7-9.5V6l-7-3Z" {...common} />
          <Polyline points="9,12 11.2,14.2 15,10" {...common} />
        </>
      ) : null}
      {name === 'info' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...common} />
          <Path d="M12 11v5" {...common} />
          <Circle cx={12} cy={8} r={0.5} {...common} fill={color} />
        </>
      ) : null}
      {name === 'search' ? (
        <>
          <Circle cx={11} cy={11} r={6.5} {...common} />
          <Path d="m20 20-4.4-4.4" {...common} />
        </>
      ) : null}
      {name === 'log-out' ? (
        <>
          <Path d="M9 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3H9" {...common} />
          <Path d="M15 16.5 19.5 12 15 7.5" {...common} />
          <Path d="M19.5 12H9.5" {...common} />
        </>
      ) : null}
      {name === 'users' ? (
        <>
          <Circle cx={9} cy={8.5} r={3.5} {...common} />
          <Path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" {...common} />
          <Path d="M16 5.5a3.5 3.5 0 0 1 0 6.5" {...common} />
          <Path d="M17.6 15.2A6.2 6.2 0 0 1 21.2 20" {...common} />
        </>
      ) : null}
      {name === 'help' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...common} />
          <Path d="M9.5 9.2a2.5 2.5 0 1 1 3.6 2.6c-.8.5-1.1 1-1.1 1.9" {...common} />
          <Circle cx={12} cy={17} r={0.5} {...common} fill={color} />
        </>
      ) : null}
      {name === 'settings' ? (
        <>
          <Circle cx={12} cy={12} r={3} {...common} />
          <Path
            d="M19 12a7 7 0 0 0-.1-1.1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.9-1.1L14.3 3h-4l-.4 2.4a7 7 0 0 0-1.9 1.1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.9 1.1l.4 2.4h4l.4-2.4a7 7 0 0 0 1.9-1.1l2.3 1 2-3.4-2-1.5c.06-.36.1-.73.1-1.1Z"
            {...common}
          />
        </>
      ) : null}
      {name === 'hand-heart' ? (
        <>
          <Path d="M12 8.8s-2.6-3-4.6-1.4c-2 1.6-.4 4 1.4 5.5L12 15.5l3.2-2.6c1.8-1.5 3.4-3.9 1.4-5.5C14.6 5.8 12 8.8 12 8.8Z" {...common} />
          <Path d="M3 18.5h4l3.5 2h6" {...common} />
        </>
      ) : null}
      {name === 'package' ? (
        <>
          <Path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" {...common} />
          <Path d="M4 7l8 4 8-4" {...common} />
          <Path d="M12 11v9" {...common} />
        </>
      ) : null}
      {name === 'arrow-left' ? (
        <>
          <Path d="M19 12H5" {...common} />
          <Path d="M12 19l-7-7 7-7" {...common} />
        </>
      ) : null}
      {name === 'close' ? (
        <>
          <Path d="M18 6L6 18" {...common} />
          <Path d="M6 6l12 12" {...common} />
        </>
      ) : null}
      {name === 'check' ? <Path d="M20 6L9 17l-5-5" {...common} /> : null}
      {name === 'menu' ? (
        <>
          <Path d="M3 6h18" {...common} />
          <Path d="M3 12h18" {...common} />
          <Path d="M3 18h18" {...common} />
        </>
      ) : null}
      {name === 'eye-off' ? (
        <>
          <Path d="M4 4l16 16" {...common} />
          <Path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c5.5 0 9 5.5 9 7 0 .8-1 2.6-2.7 4.1M6.1 6.8C4 8.3 3 10.2 3 12c0 1.5 3.5 7 9 7 1.3 0 2.5-.3 3.5-.8" {...common} />
          <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" {...common} />
        </>
      ) : null}
    </Svg>
  );
}
