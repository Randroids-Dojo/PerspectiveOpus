// Page screenshots of named spots across levels in one browser.
//   URL=http://localhost:5245/ npx tsx scripts/page-spots.ts /tmp/page-spots "3,10,5,3,garden" "4,78,29,7.5,gauntlet" ...
// A spot may add a sixth field: frames of walking right (positive) or left (negative) before the shot.
// Env: W, H, DPR, SETTLE (ms after load), CLIP=x,y,w,h (CSS px).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '/tmp/page-spots';
const spots = process.argv.slice(3).map((s) => s.split(','));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.CHANNEL ?? 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) },
  deviceScaleFactor: Number(process.env.DPR ?? 1),
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
for (const [lv, x, y, z, name, walk] of spots) {
  await page.goto(`${process.env.URL ?? 'http://localhost:5245/'}?level=${lv}&x=${x}&y=${y}&z=${z}&mode=2d`);
  await page.waitForTimeout(Number(process.env.SETTLE ?? 1400));
  const w = Number(walk ?? 0);
  if (w) {
    const key = w > 0 ? 'ArrowRight' : 'ArrowLeft';
    await page.keyboard.down(key);
    await page.waitForTimeout(Math.abs(w) * 16.7);
    await page.keyboard.up(key);
    await page.waitForTimeout(900);
  }
  const clip = process.env.CLIP?.split(',').map(Number);
  const file = join(out, `${lv}-${name}.png`);
  await page.screenshot({ path: file, clip: clip ? { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } : undefined });
  console.log('shot', file);
}
await browser.close();
