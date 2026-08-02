import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

/**
 * Launcher icons, drawn from the same hand-heart path the in-app wordmark uses
 * so the home screen and the header agree.
 *
 * Two files, because Android composites its own: `icon.png` is the flat square
 * (also what iOS uses), `adaptive-icon.png` is the foreground layer that gets
 * masked into whatever shape the launcher wants — so its content stays inside
 * the inner ~66% safe zone, and the blue comes from adaptiveIcon.backgroundColor.
 */
const HEART =
  'M12 8.8s-2.6-3-4.6-1.4c-2 1.6-.4 4 1.4 5.5L12 15.5l3.2-2.6c1.8-1.5 3.4-3.9 1.4-5.5C14.6 5.8 12 8.8 12 8.8Z';
const HAND = 'M3 18.5h4l3.5 2h6';
const BLUE = '#2F6BE4';

const page = (bg, markPx) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0}
  .c{width:1024px;height:1024px;display:flex;align-items:center;justify-content:center;
     background:${bg};}
</style>
<div class="c">
  <!-- Centred on the drawing, not on the 24x24 box: the hand reaches further
       left than the heart, so the default framing sits the mark low and left. -->
  <svg width="${markPx}" height="${markPx}" viewBox="1.25 3.65 19 19" fill="none"
       stroke="#FFFFFF" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path d="${HEART}"/>
    <path d="${HAND}"/>
  </svg>
</div>`;

mkdirSync('apps/mobile/assets', { recursive: true });
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1024, height: 1024 } });

// Flat icon: the mark on brand blue, filling most of the square.
await p.setContent(page(BLUE, 760));
await p.screenshot({ path: 'apps/mobile/assets/icon.png' });

// Adaptive foreground: transparent, and smaller so a circular or squircle mask
// cannot clip the mark.
await p.setContent(page('transparent', 600));
await p.screenshot({ path: 'apps/mobile/assets/adaptive-icon.png', omitBackground: true });

await browser.close();
console.log('wrote icon.png and adaptive-icon.png');
