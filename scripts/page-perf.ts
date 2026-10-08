// Measures the page renderer while running through a level: rAF frame times and the
// page's own CPU cost per frame (window.__opus.page.stats).
//   URL=http://localhost:5242/ npx tsx scripts/page-perf.ts "level=0&mode=2d"
// Env: W, H, DPR, THROTTLE (CPU slowdown factor, e.g. 4 for a mid-range phone), SECONDS.
import { chromium } from 'playwright-core';

const query = process.argv[2] ?? 'level=0&mode=2d';
const width = Number(process.env.W ?? 1280);
const height = Number(process.env.H ?? 720);
const seconds = Number(process.env.SECONDS ?? 6);
const browser = await chromium.launch({
  channel: process.env.CHANNEL ?? 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${process.env.URL ?? 'http://localhost:5242/'}?${query}`);
await page.waitForTimeout(1500);
const throttle = Number(process.env.THROTTLE ?? 1);
if (throttle > 1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
}
// Plain strings: tsx would otherwise inject helpers the page does not have.
await page.evaluate(`(() => {
  const w = window;
  w.__perf = { frames: [], page: [], paint: [], last: performance.now() };
  function tick(now) {
    const p = w.__perf;
    p.frames.push(now - p.last);
    p.last = now;
    p.page.push(w.__opus.page.stats.ms);
    p.paint.push(w.__opus.page.stats.paint);
    p.raf = requestAnimationFrame(tick);
  }
  w.__perf.raf = requestAnimationFrame(tick);
})()`);
// Run right, hopping now and then, so new chunks keep scrolling in.
await page.keyboard.down('ArrowRight');
const t0 = Date.now();
while (Date.now() - t0 < seconds * 1000) {
  await page.waitForTimeout(700);
  await page.keyboard.press('Space');
}
await page.keyboard.up('ArrowRight');
const r = await page.evaluate(`(() => {
  const p = window.__perf;
  cancelAnimationFrame(p.raf);
  const f = p.frames.slice(5).sort((a, b) => a - b);
  const g = p.page.slice(5).sort((a, b) => a - b);
  const q = (arr, k) => arr[Math.min(arr.length - 1, Math.floor(arr.length * k))];
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  return {
    frames: f.length,
    fps: 1000 / avg(f),
    frameP50: q(f, 0.5),
    frameP95: q(f, 0.95),
    frameMax: f[f.length - 1],
    pageAvg: avg(g),
    pageP95: q(g, 0.95),
    pageMax: g[g.length - 1],
    stats: window.__opus.page.stats,
    worst: p.page.map((v, i) => [Math.round(v * 10) / 10, Math.round(p.paint[i] * 10) / 10, i]).sort((a, b) => b[0] - a[0]).slice(0, 6),
  };
})()`);
console.log(JSON.stringify(r, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 1));
await browser.close();
