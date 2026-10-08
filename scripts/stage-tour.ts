// Screenshots of the stage in every palette from the three-quarter view, the side view and mid-swing.
//   npx tsx scripts/stage-tour.ts [outDir] [level] [x] [y] [z]
// Env: URL (dev server), PALETTES (comma list), VIEWS (comma list of 34,side,mid,close), QUALITY (high|medium|low)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '/tmp/stage-shots/tour';
const level = process.argv[3] ?? 'gallery';
const px = process.argv[4];
const py = process.argv[5];
const pz = process.argv[6];
const base = process.env.URL ?? 'http://localhost:5241/';
const palettes = (process.env.PALETTES ?? 'dawn,lake,autumn,night,clock,finale,title').split(',');
const views = (process.env.VIEWS ?? '34,side,mid').split(',');
const quality = process.env.QUALITY ?? 'high';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.CHANNEL ?? 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page]', m.text());
});

for (const pal of palettes) {
  const pos = px ? `&x=${px}&y=${py ?? 5}&z=${pz ?? 3}` : '';
  await page.goto(`${base}?level=${level}&mode=3d&palette=${pal}${pos}`);
  await page.waitForTimeout(1300);
  await page.evaluate((q) => {
    const a = (window as any).__opus;
    a.quality = q;
  }, quality);
  await page.waitForTimeout(300);
  for (const v of views) {
    await page.evaluate((v) => {
      const a = (window as any).__opus;
      const ui = document.getElementById('ui');
      if (ui) ui.style.visibility = 'hidden';
      if (v === '34') {
        a.paused = false;
        a.view.orbit = { yaw: 0, pitch: 0, dist: 0 };
        return;
      }
      a.paused = true;
      a.page.canvas.style.display = 'none';
      if (v === 'side') {
        a.view.blend = 0.2;
        a.view.wipe = 1;
        a.view.swing = 0;
      } else if (v === 'mid') {
        a.view.blend = 0.7;
        a.view.wipe = 1;
        a.view.swing = 0.5;
      } else if (v === 'close') {
        a.paused = false;
        a.page.canvas.style.display = '';
        a.view.orbit = { yaw: 0.35, pitch: -0.12, dist: -9 };
      }
    }, v);
    await page.waitForTimeout(500);
    const file = join(out, `${pal}-${v}.png`);
    await page.screenshot({ path: file });
    console.log('shot', file);
    await page.evaluate(() => {
      const a = (window as any).__opus;
      a.paused = false;
      a.page.canvas.style.display = '';
      a.view.orbit = { yaw: 0, pitch: 0, dist: 0 };
    });
  }
}
await browser.close();
