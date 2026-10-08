// Times Page.load() and the first frame after it (backdrop build plus the first chunks).
//   URL=http://localhost:5242/ npx tsx scripts/page-loadcost.ts "level=0&mode=2d"
import { chromium } from 'playwright-core';

const query = process.argv[2] ?? 'level=0&mode=2d';
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
await page.goto(`${process.env.URL ?? 'http://localhost:5242/'}?${query}`);
await page.waitForTimeout(1500);
const r = await page.evaluate(`(async () => {
  const app = window.__opus;
  const pg = app.page;
  const out = [];
  const pals = ['dawn', 'night', 'lake', 'dawn'];
  for (const id of pals) {
    const pal = { ...pg.palette, id };
    const t0 = performance.now();
    app.startLevel(app.levelIndex >= 0 ? app.levelIndex : 'gallery', '2d', id);
    const t1 = performance.now();
    const tl = performance.now();
    pg.load(app.game, pg.palette);
    const pageLoadMs = performance.now() - tl;
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    out.push({ palette: id, startLevelMs: Math.round((t1 - t0) * 10) / 10, pageLoadMs: Math.round(pageLoadMs * 10) / 10, firstFrameMs: Math.round(pg.stats.max * 10) / 10 });
    pg.stats.max = 0;
  }
  return out;
})()`);
console.log(JSON.stringify(r));
await browser.close();
