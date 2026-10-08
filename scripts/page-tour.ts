// Screenshot tour of the page renderer: teleports along a level and saves a shot at each stop.
//   URL=http://localhost:5242/ npx tsx scripts/page-tour.ts "level=gallery&mode=2d" /tmp/page-shots/tour 12,4,3 30,4,3 ...
// Env: DPR, W, H (viewport), WAIT (ms before the first shot), SETTLE (ms after each teleport), CLIP=x,y,w,h (CSS px).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const query = process.argv[2] ?? 'level=gallery&mode=2d';
const out = process.argv[3] ?? '/tmp/page-shots/tour';
const stops = process.argv.slice(4).map((s) => s.split(',').map(Number));
const width = Number(process.env.W ?? 1280);
const height = Number(process.env.H ?? 720);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.CHANNEL ?? 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${process.env.URL ?? 'http://localhost:5242/'}?${query}`);
await page.waitForTimeout(Number(process.env.WAIT ?? 1200));
const settle = Number(process.env.SETTLE ?? 700);
let n = 0;
for (const [x, y, z] of stops.length ? stops : [[NaN, NaN, NaN]]) {
  if (Number.isFinite(x)) await page.evaluate(([a, b, c]) => (window as any).__opus.teleport(a, b, c), [x, y, z]);
  await page.waitForTimeout(settle);
  const name = `${String(n++).padStart(2, '0')}_${Number.isFinite(x) ? `${x}_${y}_${z}` : 'frame'}.png`;
  const clip = process.env.CLIP?.split(',').map(Number);
  await page.screenshot({ path: join(out, name), clip: clip ? { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } : undefined });
  const stats = await page.evaluate(() => (window as any).__opus.page.stats);
  console.log(name, JSON.stringify(stats));
}
await browser.close();
