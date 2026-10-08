// Restarts levels many times and reports GPU resource counts, to catch leaks in Stage.load().
//   npx tsx scripts/stage-leak.ts [cycles]
import { chromium } from 'playwright-core';

const cycles = Number(process.argv[2] ?? 12);
const base = process.env.URL ?? 'http://localhost:5241/';
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}?level=0&mode=3d`);
await page.waitForTimeout(1200);
const out = await page.evaluate(`(async () => {
  const a = window.__opus;
  const r = a.stage.renderer;
  const pals = ['dawn', 'lake', 'autumn', 'night', 'clock', 'finale', 'title'];
  const rows = [];
  for (let i = 0; i < ${cycles}; i++) {
    a.startLevel(i % 2 ? 'gallery' : 0, '3d', pals[i % pals.length]);
    await new Promise((res) => setTimeout(res, 120));
    rows.push([i, window.__stageLoadMs.toFixed(1), r.info.memory.geometries, r.info.memory.textures, r.info.programs.length]);
  }
  return rows;
})()`);
for (const row of out as unknown[][]) console.log(row.join('\t'));
await browser.close();
