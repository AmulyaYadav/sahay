import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme';

/**
 * Flat inline-SVG vignettes (Warm Relief §5). Palette colors only, simple
 * shapes, no faces, each < 60 nodes. Purely decorative — hidden from
 * assistive technology.
 */

function Frame({ children, size = 160 }: { children: React.ReactNode; size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ alignItems: 'center' }}
    >
      <Svg width={size} height={size} viewBox="0 0 160 160">
        {children}
      </Svg>
    </View>
  );
}

/** Onboarding: two stylized hands passing a parcel. */
export function ParcelHandsVignette({ size = 160 }: { size?: number }) {
  const th = useTheme();
  return (
    <Frame size={size}>
      <Circle cx={80} cy={80} r={64} fill={th.dark ? '#2563EB26' : '#EFF4FF'} />
      {/* parcel: orange box + lid, pale-yellow ribbon */}
      <Rect x={58} y={66} width={44} height={30} rx={4} fill="#D97706" />
      <Rect x={76} y={66} width={8} height={30} fill="#FEF9C3" />
      <Rect x={54} y={54} width={52} height={10} rx={4} fill="#D97706" />
      <Rect x={76} y={54} width={8} height={10} fill="#FEF9C3" />
      {/* left hand (simple mitt shapes) */}
      <Path d="M20 96c0-10 8-16 18-16h20v20H36c-9 0-16-1-16-4Z" fill="#2563EB" />
      <Circle cx={58} cy={90} r={10} fill="#2563EB" />
      {/* right hand */}
      <Path d="M140 80c0 10-8 16-18 16h-20V76h22c9 0 16 1 16 4Z" fill="#16A34A" />
      <Circle cx={102} cy={86} r={10} fill="#16A34A" />
      {/* small accents */}
      <Circle cx={44} cy={40} r={4} fill="#16A34A" />
      <Circle cx={120} cy={118} r={4} fill="#2563EB" />
      <Circle cx={130} cy={44} r={3} fill="#D97706" />
    </Frame>
  );
}

/** Join event: balloons rising from a soft circle. */
export function BalloonsVignette({ size = 160 }: { size?: number }) {
  const th = useTheme();
  return (
    <Frame size={size}>
      <Circle cx={80} cy={84} r={62} fill={th.dark ? '#16A34A26' : '#E8F7EE'} />
      {/* balloons */}
      <Ellipse cx={58} cy={62} rx={17} ry={21} fill="#2563EB" />
      <Path d="M58 83l-4 7h8l-4-7Z" fill="#2563EB" />
      <Path d="M58 90c0 16-6 22-12 30" stroke="#667085" strokeWidth={2} fill="none" strokeLinecap="round" />
      <Ellipse cx={96} cy={50} rx={15} ry={19} fill="#D97706" />
      <Path d="M96 69l-3.5 6h7L96 69Z" fill="#D97706" />
      <Path d="M96 75c0 18-4 26-8 36" stroke="#667085" strokeWidth={2} fill="none" strokeLinecap="round" />
      <Ellipse cx={116} cy={82} rx={12} ry={15} fill="#16A34A" />
      <Path d="M116 97l-3 5h6l-3-5Z" fill="#16A34A" />
      <Path d="M116 102c0 12-4 18-8 24" stroke="#667085" strokeWidth={2} fill="none" strokeLinecap="round" />
      {/* confetti */}
      <Circle cx={36} cy={44} r={3} fill="#DB2777" />
      <Circle cx={128} cy={38} r={3} fill="#2563EB" />
      <Rect x={40} y={104} width={6} height={6} rx={1.5} fill="#CA8A04" />
      <Rect x={124} y={116} width={6} height={6} rx={1.5} fill="#7C5CE0" />
    </Frame>
  );
}

/** Match found: lantern in a soft green circle with confetti dots. */
export function LanternVignette({ size = 160 }: { size?: number }) {
  const th = useTheme();
  return (
    <Frame size={size}>
      <Circle cx={80} cy={80} r={62} fill={th.dark ? '#16A34A26' : '#E8F7EE'} />
      {/* lantern */}
      <Path d="M80 34v8" stroke="#667085" strokeWidth={2.5} strokeLinecap="round" fill="none" />
      <Rect x={68} y={42} width={24} height={7} rx={3} fill="#1D4ED8" />
      <Path d="M64 49h32l-4 44H68l-4-44Z" fill="#2563EB" />
      <Rect x={72} y={56} width={16} height={26} rx={7} fill="#FEF9C3" />
      <Circle cx={80} cy={69} r={5} fill="#D97706" />
      <Rect x={66} y={93} width={28} height={7} rx={3} fill="#1D4ED8" />
      <Path d="M80 100v10" stroke="#667085" strokeWidth={2.5} strokeLinecap="round" fill="none" />
      <Circle cx={80} cy={114} r={4} fill="#16A34A" />
      {/* confetti dots in palette colors */}
      <Circle cx={40} cy={52} r={4} fill="#D97706" />
      <Circle cx={122} cy={46} r={4} fill="#DB2777" />
      <Circle cx={30} cy={92} r={3} fill="#7C5CE0" />
      <Circle cx={130} cy={90} r={3} fill="#CA8A04" />
      <Circle cx={48} cy={124} r={3} fill="#2563EB" />
      <Circle cx={112} cy={124} r={4} fill="#16A34A" />
    </Frame>
  );
}

/** Empty state: a single flat object inside a soft tinted circle. */
export function EmptyCircleVignette({
  size = 112,
  variant = 'package',
}: {
  size?: number;
  variant?: 'package' | 'search';
}) {
  const th = useTheme();
  return (
    <Frame size={size}>
      <Circle cx={80} cy={80} r={56} fill={th.dark ? '#2563EB26' : '#EFF4FF'} />
      {variant === 'package' ? (
        <>
          <Path d="M80 48 50 63v34l30 15 30-15V63L80 48Z" fill="#2563EB" />
          <Path d="M50 63l30 15 30-15" stroke="#EFF4FF" strokeWidth={3} fill="none" />
          <Path d="M80 78v34" stroke="#EFF4FF" strokeWidth={3} fill="none" />
        </>
      ) : (
        <>
          <Circle cx={74} cy={74} r={20} stroke="#2563EB" strokeWidth={5} fill="none" />
          <Path d="m90 90 16 16" stroke="#2563EB" strokeWidth={5} strokeLinecap="round" fill="none" />
        </>
      )}
    </Frame>
  );
}
