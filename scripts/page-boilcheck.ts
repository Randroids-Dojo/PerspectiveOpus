// Checks that the static page boils: compares a still region of the page canvas across boil frames.
//   URL=http://localhost:5242/ npx tsx scripts/page-boilcheck.ts "level=0&mode=2d"
import { chromium } from 'playwright-core';

const query = process.argv[2] ?? 'level=0&mode=2d';
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${process.env.URL ?? 'http://localhost:5242/'}?${query}`);
await page.waitForTimeout(3000);
const r = await page.evaluate(`(async () => {
  const pg = window.__opus.page;
  const c = pg.canvas;
  const g = c.getContext('2d');
  const grab = () => g.getImageData(700, 470, 400, 200).data;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const a = grab();
  await wait(130);
  const b = grab();
  await wait(130);
  const d = grab();
  const diff = (x, y) => { let n = 0; for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i] - y[i]) > 6) n++; return n; };
  return { boilReady: pg.chunks.boilReady, changedAB: diff(a, b), changedBD: diff(b, d), pixels: a.length / 4 };
})()`);
console.log(JSON.stringify(r));
await browser.close();
