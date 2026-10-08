// Times a full repaint of the visible chunks (variant 0) at the current view.
//   URL=http://localhost:5242/ npx tsx scripts/page-paintcost.ts "level=0&mode=2d" [x,y,z]
import { chromium } from 'playwright-core';

const query = process.argv[2] ?? 'level=0&mode=2d';
const stop = process.argv[3]?.split(',').map(Number);
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
await page.goto(`${process.env.URL ?? 'http://localhost:5242/'}?${query}`);
await page.waitForTimeout(1200);
if (stop) {
  await page.evaluate(`window.__opus.teleport(${stop[0]}, ${stop[1]}, ${stop[2]})`);
  await page.waitForTimeout(800);
}
const r = await page.evaluate(`(() => {
  const pg = window.__opus.page;
  const c = pg.chunks;
  const out = [];
  for (let rep = 0; rep < 3; rep++) {
    let n = 0;
    const t0 = performance.now();
    for (let j = c.j0; j <= c.j1; j++)
      for (let i = c.i0; i <= c.i1; i++) {
        if (!pg.probeChunk(i, j)) continue;
        const cv = document.createElement('canvas');
        cv.width = c.S; cv.height = c.S;
        pg.paintChunk(cv.getContext('2d'), i, j, rep);
        n++;
      }
    out.push({ chunks: n, ms: performance.now() - t0 });
  }
  return out;
})()`);
console.log(JSON.stringify(r));
await browser.close();
