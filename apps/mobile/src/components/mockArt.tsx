/**
 * Flat-vector illustrations for the mockup screens.
 *
 * Drawn to match the mockups' style — solid fills, soft rounded forms, no
 * gradients inside the artwork itself since the page behind it already carries
 * one. Each is sized by a single `size` prop so the screens control scale.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';

/** Scattered confetti behind the hero art (mockups 2, 7, 9). */
export function Confetti({ size = 280, tint = ['#F2C14E', '#5A8DEE', '#43C08A', '#E4685D', '#9B7BEA'] }) {
  const bits = [
    { x: 14, y: 22, r: 3.5, i: 0 },
    { x: 52, y: 8, r: 2.5, i: 1 },
    { x: 92, y: 30, r: 3, i: 2 },
    { x: 140, y: 12, r: 2.5, i: 3 },
    { x: 186, y: 26, r: 3.5, i: 4 },
    { x: 232, y: 10, r: 2.5, i: 0 },
    { x: 262, y: 40, r: 3, i: 1 },
    { x: 30, y: 96, r: 2.5, i: 2 },
    { x: 246, y: 104, r: 3.5, i: 3 },
    { x: 8, y: 150, r: 3, i: 4 },
    { x: 270, y: 160, r: 2.5, i: 0 },
  ];
  return (
    <Svg width={size} height={size * 0.7} viewBox="0 0 280 196">
      {bits.map((b, k) => (
        <Circle key={k} cx={b.x} cy={b.y} r={b.r} fill={tint[b.i]} opacity={0.9} />
      ))}
      {[
        { x: 66, y: 58, i: 1 },
        { x: 210, y: 70, i: 3 },
        { x: 118, y: 168, i: 2 },
      ].map((b, k) => (
        <Rect key={`r${k}`} x={b.x} y={b.y} width={7} height={7} rx={1.5} fill={tint[b.i]} opacity={0.85} transform={`rotate(24 ${b.x} ${b.y})`} />
      ))}
    </Svg>
  );
}

/** Mockup 2 — wall calendar with rings and a ticked day. */
export function CalendarArt({ size = 160 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160">
      {/* rings */}
      {[46, 80, 114].map((x) => (
        <Rect key={x} x={x - 3} y={16} width={6} height={18} rx={3} fill="#8A93A8" />
      ))}
      {/* body */}
      <Rect x={24} y={30} width={112} height={104} rx={10} fill="#FFFFFF" />
      {/* header band */}
      <Path d="M24 40a10 10 0 0110-10h92a10 10 0 0110 10v14H24V40z" fill="#3B6FE0" />
      {/* day grid */}
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3, 4].map((c) => (
          <Rect
            key={`${r}-${c}`}
            x={36 + c * 18}
            y={64 + r * 16}
            width={13}
            height={10}
            rx={2.5}
            fill="#DCE5F7"
          />
        )),
      )}
      {/* the ticked day */}
      <Rect x={90} y={80} width={13} height={10} rx={2.5} fill="#3B6FE0" opacity={0.35} />
      <Path d="M92.5 85l2.6 2.6 5-5" stroke="#2B4E9E" strokeWidth={2} strokeLinecap="round" fill="none" />
      {/* right-edge shadow so it reads as a card, as in the mockup */}
      <Path d="M136 40v88a6 6 0 01-6 6h-4V30h4a6 6 0 016 6z" fill="#C9D6F0" />
    </Svg>
  );
}

/** Mockup 3 — shield with a heart, on radiating light. */
export function ShieldHeartArt({ size = 170 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 170 170">
      {/* rays */}
      {Array.from({ length: 16 }).map((_, i) => {
        const a = (i * Math.PI * 2) / 16;
        const x1 = 85 + Math.cos(a) * 52;
        const y1 = 85 + Math.sin(a) * 52;
        const x2 = 85 + Math.cos(a) * 80;
        const y2 = 85 + Math.sin(a) * 80;
        return (
          <Path key={i} d={`M${x1} ${y1}L${x2} ${y2}`} stroke="#8FE3C4" strokeWidth={5} strokeLinecap="round" opacity={0.35} />
        );
      })}
      <Circle cx={85} cy={85} r={54} fill="#39BE95" opacity={0.35} />
      {/* shield */}
      <Path
        d="M85 30l34 12v30c0 23-14 40-34 50-20-10-34-27-34-50V42l34-12z"
        fill="#1E8F72"
      />
      <Path d="M85 38l26 9v25c0 18-11 31-26 39V38z" fill="#17795F" opacity={0.55} />
      {/* heart */}
      <Path
        d="M85 100c-9-6-16-11-16-19a8 8 0 0116-3 8 8 0 0116 3c0 8-7 13-16 19z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}

/** Mockup 5 — backpack with two floating hearts. */
export function BackpackArt({ size = 170 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 170 170">
      <Path d="M34 22c-6 0-9 5-7 9" stroke="#B9A9F0" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.7} />
      {/* floating hearts */}
      <Path d="M40 44c-4-3-7-5-7-8a3.5 3.5 0 017-1.4A3.5 3.5 0 0147 36c0 3-3 5-7 8z" fill="#C9B9F7" />
      <Path d="M133 52c-4-3-7-5-7-8a3.5 3.5 0 017-1.4A3.5 3.5 0 01140 44c0 3-3 5-7 8z" fill="#C9B9F7" />
      {/* straps */}
      <Path d="M62 44c0-13 10-22 23-22s23 9 23 22" stroke="#8B72D8" strokeWidth={9} strokeLinecap="round" fill="none" />
      {/* body */}
      <Rect x={40} y={44} width={90} height={92} rx={26} fill="#9E86E8" />
      {/* front pocket */}
      <Rect x={56} y={92} width={58} height={38} rx={14} fill="#8B72D8" />
      {/* lid */}
      <Path d="M40 70c0-14 11-26 26-26h38c15 0 26 12 26 26v6H40v-6z" fill="#B29CF0" />
      {/* heart badge */}
      <Path d="M85 84c-7-5-12-8-12-14a6 6 0 0112-2.5A6 6 0 0197 70c0 6-5 9-12 14z" fill="#FFFFFF" />
    </Svg>
  );
}

/** Mockup 7 — green circle with a white tick. */
export function SuccessCheckArt({ size = 96 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96">
      <Circle cx={48} cy={48} r={40} fill="#1E9E5A" />
      <Path d="M32 49l11 11 22-23" stroke="#FFFFFF" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/**
 * Mockup 9 — two people facing out of circular frames, the Sahay mark between
 * them where the mockup drew a heart.
 *
 * Each avatar is composed inside a clip of its own circle, so the shoulders can
 * run off the bottom edge the way a cropped portrait does instead of being
 * drawn as a dome sitting on top of the face. Everything is positioned from the
 * head centre, which keeps the two figures consistent while their hair, skin
 * and clothing differ.
 */
const FACES = [
  { cx: 36, skin: '#F3C9A8', shade: '#E3B491', hair: '#2F5FCB', shirt: '#4C7DF0', bg: '#E8F0FE' },
  { cx: 184, skin: '#F6D2B4', shade: '#E7BE9C', hair: '#3B3A55', shirt: '#E8A33D', bg: '#FDF0E2' },
] as const;

export function MatchAvatarsArt({ size = 220 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.45} viewBox="0 0 220 100">
      <Defs>
        {FACES.map((f) => (
          <ClipPath key={f.cx} id={`avatar-${f.cx}`}>
            <Circle cx={f.cx} cy={50} r={30} />
          </ClipPath>
        ))}
      </Defs>

      {FACES.map((f, i) => {
        const hy = 44; // head centre
        return (
          <React.Fragment key={f.cx}>
            {/* White ring, as the mockup frames each portrait. */}
            <Circle cx={f.cx} cy={50} r={34} fill="#FFFFFF" />
            <G clipPath={`url(#avatar-${f.cx})`}>
              <Circle cx={f.cx} cy={50} r={30} fill={f.bg} />
              {/* Shoulders first, then neck, then head — back to front. */}
              <Ellipse cx={f.cx} cy={88} rx={27} ry={22} fill={f.shirt} />
              <Rect x={f.cx - 5} y={54} width={10} height={12} fill={f.shade} />
              <Circle cx={f.cx} cy={hy} r={16} fill={f.skin} />
              {/* Hair sits over the top half of the head; the cap gets a brim. */}
              <Path d={`M${f.cx - 16} ${hy} A16 16 0 0 1 ${f.cx + 16} ${hy} Z`} fill={f.hair} />
              {i === 0 ? (
                <Rect x={f.cx - 19} y={hy - 2} width={38} height={4} rx={2} fill={f.hair} />
              ) : (
                <>
                  <Rect x={f.cx - 16} y={hy - 2} width={4} height={9} rx={2} fill={f.hair} />
                  <Rect x={f.cx + 12} y={hy - 2} width={4} height={9} rx={2} fill={f.hair} />
                </>
              )}
              <Circle cx={f.cx - 6} cy={hy + 3} r={1.9} fill="#3A3A46" />
              <Circle cx={f.cx + 6} cy={hy + 3} r={1.9} fill="#3A3A46" />
              <Path
                d={`M${f.cx - 5} ${hy + 9}q5 4.5 10 0`}
                stroke="#3A3A46"
                strokeWidth={1.8}
                strokeLinecap="round"
                fill="none"
              />
            </G>
          </React.Fragment>
        );
      })}

      {/*
        The Sahay mark, where the mockup drew a heart. A white disc keeps the
        brand blue legible on the dark scrim behind this screen and reads as the
        logo rather than as decoration; the path is the same 24x24 'hand-heart'
        the wordmark uses, scaled to fit.
      */}
      <Circle cx={110} cy={50} r={25} fill="#FFFFFF" />
      <G
        transform="translate(88 28) scale(1.833)"
        fill="none"
        stroke="#2F6BE4"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Path d="M12 8.8s-2.6-3-4.6-1.4c-2 1.6-.4 4 1.4 5.5L12 15.5l3.2-2.6c1.8-1.5 3.4-3.9 1.4-5.5C14.6 5.8 12 8.8 12 8.8Z" />
        <Path d="M3 18.5h4l3.5 2h6" />
      </G>
    </Svg>
  );
}

/** A water-drop, used beside the requests heading in mockup 4. */
export function DropArt({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path d="M32 6c9 12 17 20 17 29a17 17 0 11-34 0c0-9 8-17 17-29z" fill="#5AA9F0" />
      <Path d="M32 14c6 9 11 15 11 21a11 11 0 01-11 11V14z" fill="#3E90DE" opacity={0.6} />
      <Ellipse cx={25} cy={38} rx={4} ry={6} fill="#FFFFFF" opacity={0.45} />
    </Svg>
  );
}

/** Centres artwork with breathing room, so screens do not repeat the wrapper. */
export function ArtFrame({ children }: { children: React.ReactNode }) {
  return <View style={{ alignItems: 'center', justifyContent: 'center' }}>{children}</View>;
}
