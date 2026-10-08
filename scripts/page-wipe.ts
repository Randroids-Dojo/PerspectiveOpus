// Freezes the switch at chosen wipe amounts and saves a shot of each, so the ink-blot
// edge can be inspected frame by frame. The app keeps rendering while paused.
//   URL=http://localhost:5242/ npx tsx scripts/page-wipe.ts "level=0&mode=2d" /tmp/page-shots/wipe 0.05 0.2 0.45 0.8
// Env: DPR, W, H, X/Y/Z (teleport first), ORIGIN=x,y (CSS px; defaults to the player).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const query = process.argv[2] ?? 'level=0&mode=2d';
const out = process.argv[3] ?? '/tmp/page-shots/wipe';
const amounts = process.argv.slice(4).map(Number);
const width = Number(process.env.W ?? 1280);
const height = Number(process.env.H ?? 720);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.CHANNEL ?? 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${process.env.URL ?? 'http://localhost:5242/'}?${query}`);
await page.waitForTimeout(1200);
if (process.env.X) {
  await page.evaluate(([x, y, z]) => (window as any).__opus.teleport(x, y, z), [Number(process.env.X), Number(process.env.Y ?? 5), Number(process.env.Z ?? 3)]);
  await page.waitForTimeout(600);
}
const origin = process.env.ORIGIN?.split(',').map(Number);
for (const [i, w] of (amounts.length ? amounts : [0.05, 0.15, 0.3, 0.5, 0.75, 0.95]).entries()) {
  await page.evaluate(
    ([w, ox, oy]) => {
      const app = (window as any).__opus;
      app.paused = true;
      const v = app.view;
      v.wipe = w;
      v.blend = w * 0.4;
      v.swing = 0;
      if (Number.isFinite(ox)) v.wipeOrigin = { x: ox, y: oy };
    },
    [w, origin?.[0] ?? NaN, origin?.[1] ?? NaN],
  );
  await page.waitForTimeout(250);
  const name = `${String(i).padStart(2, '0')}_wipe_${w}.png`;
  await page.screenshot({ path: join(out, name) });
  console.log('shot', join(out, name));
}
await browser.close();
