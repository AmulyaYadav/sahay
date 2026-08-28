import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

/**
 * Google Play listing graphics, drawn from the same hand-heart path as the
 * launcher icon (make-icons.mjs) so the store page and the installed app agree.
 *
 * Play's constraints, which the sizes below are not arbitrary about:
 *   - icon: exactly 512x512, 32-bit PNG. Play applies its own rounded mask, so
 *     the background is full-bleed and the mark stays well inside the corners.
 *   - feature graphic: exactly 1024x500, no alpha. Play crops and overlays UI
 *     on this in some placements, so nothing important goes near the edges.
 */
const HEART =
  'M12 8.8s-2.6-3-4.6-1.4c-2 1.6-.4 4 1.4 5.5L12 15.5l3.2-2.6c1.8-1.5 3.4-3.9 1.4-5.5C14.6 5.8 12 8.8 12 8.8Z';
const HAND = 'M3 18.5h4l3.5 2h6';
const ICON_BLUE = '#2F6BE4'; // matches the existing launcher icon background
const PRIMARY = '#2563EB';   // matches theme.ts colors.primary
const PRIMARY_STRONG = '#1D4ED8';

const FONT =
  "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif";

const mark = (px, stroke = 1.9) => `
  <svg width="${px}" height="${px}" viewBox="1.25 3.65 19 19" fill="none"
       stroke="#FFFFFF" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
    <path d="${HEART}"/>
    <path d="${HAND}"/>
  </svg>`;

const iconPage = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0}
  .c{width:512px;height:512px;display:flex;align-items:center;justify-content:center;
     background:${ICON_BLUE};}
</style>
<div class="c">${mark(380)}</div>`;

// Left: the mark. Right: wordmark over tagline. Generous margins because Play
// crops this graphic differently across surfaces.
const featurePage = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0}
  .c{width:1024px;height:500px;box-sizing:border-box;padding:0 88px;
     display:flex;align-items:center;gap:56px;
     background:linear-gradient(135deg,${PRIMARY} 0%,${PRIMARY_STRONG} 100%);
     font-family:${FONT};color:#FFFFFF;}
  .text{display:flex;flex-direction:column;gap:14px}
  .name{font-size:96px;font-weight:700;letter-spacing:-2px;line-height:1}
  .tag{font-size:31px;font-weight:400;line-height:1.3;color:#DCE8FF;max-width:19ch}
</style>
<div class="c">
  ${mark(240, 1.7)}
  <div class="text">
    <div class="name">Sahay</div>
    <div class="tag">Neighbors helping neighbors, one item at a time.</div>
  </div>
</div>`;

mkdirSync('ops/play-store', { recursive: true });
const browser = await chromium.launch();

const icon = await browser.newPage({ viewport: { width: 512, height: 512 } });
await icon.setContent(iconPage);
await icon.screenshot({ path: 'ops/play-store/icon-512.png' });

const feature = await browser.newPage({ viewport: { width: 1024, height: 500 } });
await feature.setContent(featurePage);
await feature.screenshot({ path: 'ops/play-store/feature-graphic-1024x500.png' });

await browser.close();
console.log('wrote ops/play-store/icon-512.png and feature-graphic-1024x500.png');
