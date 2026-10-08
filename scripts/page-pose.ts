// Close-ups of Quaver on the page while driving keys, clipped around the player.
//   URL=http://localhost:5242/ npx tsx scripts/page-pose.ts "level=0&mode=2d" /tmp/page-shots/pose
// Env: DPR (default 3), STEPS as in shot.ts ({keys,t,jump,wait,shot}), SIZE=w,h of the clip in CSS px.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const query = process.argv[2] ?? 'level=0&mode=2d';
const out = process.argv[3] ?? '/tmp/page-shots/pose';
mkdirSync(out, { recursive: true });
const [cw, ch] = (process.env.SIZE ?? '150,120').split(',').map(Number);

const browser = await chromium.launch({
  channel: process.env.CHANNEL ?? 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DPR ?? 3) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${process.env.URL ?? 'http://localhost:5242/'}?${query}`);
await page.waitForTimeout(1200);

type Step = { keys?: string[]; t?: number; jump?: boolean; wait?: number; shot?: string; down?: string[]; up?: string[] };
const steps: Step[] = JSON.parse(process.env.STEPS ?? '[{"shot":"idle"}]');
for (const s of steps) {
  if (s.down) for (const k of s.down) await page.keyboard.down(k);
  if (s.up) for (const k of s.up) await page.keyboard.up(k);
  if (s.jump) await page.keyboard.press('Space');
  if (s.keys) {
    for (const k of s.keys) await page.keyboard.down(k);
    await page.waitForTimeout((s.t ?? 0.5) * 1000);
    for (const k of s.keys) await page.keyboard.up(k);
  }
  if (s.wait) await page.waitForTimeout(s.wait * 1000);
  if (s.shot) {
    const pos = await page.evaluate(() => {
      const app = (window as any).__opus;
      const v = app.view;
      const p = app.game.player.pos;
      return { x: (p.x - v.c2.x) * v.ppu + v.w / 2, y: v.h / 2 - (p.y + 0.5 - v.c2.y) * v.ppu };
    });
    const clip = { x: Math.max(0, pos.x - cw / 2), y: Math.max(0, pos.y - ch / 2), width: cw, height: ch };
    await page.screenshot({ path: join(out, `${s.shot}.png`), clip });
    console.log('shot', join(out, `${s.shot}.png`));
  }
}
await browser.close();
