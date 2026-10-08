// Screenshots of the running dev server.
//   npx tsx scripts/shot.ts [query] [outDir] [width] [height]
//   query example: "level=0&mode=2d"
// Env: STEPS='[{"t":1.2,"keys":["ArrowRight"]},{"switch":true},{"wait":0.5},{"shot":"name"}]'
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const query = process.argv[2] ?? '';
const out = process.argv[3] ?? '/tmp/opus-shots';
const width = Number(process.argv[4] ?? 1280);
const height = Number(process.argv[5] ?? 720);
const url = `${process.env.URL ?? 'http://localhost:5233/'}?${query}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.CHANNEL ?? 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForTimeout(Number(process.env.WAIT ?? 1500));

type Step = { keys?: string[]; t?: number; switch?: boolean; jump?: boolean; wait?: number; shot?: string; eval?: string };
const steps: Step[] = JSON.parse(process.env.STEPS ?? '[{"shot":"frame"}]');
for (const s of steps) {
  if (s.eval) console.log(await page.evaluate(s.eval));
  if (s.switch) await page.keyboard.press('ShiftLeft');
  if (s.jump) await page.keyboard.press('Space');
  if (s.keys) {
    for (const k of s.keys) await page.keyboard.down(k);
    await page.waitForTimeout((s.t ?? 0.5) * 1000);
    for (const k of s.keys) await page.keyboard.up(k);
  }
  if (s.wait) await page.waitForTimeout(s.wait * 1000);
  if (s.shot) {
    await page.screenshot({ path: join(out, `${s.shot}.png`) });
    console.log('shot', join(out, `${s.shot}.png`));
  }
}
await browser.close();
