// Photographs the Stage's gates, keys and thorns at the spots that read worst in playtests.
//   npx tsx scripts/stage-shots.ts [outDir] [filter]
// Env: URL (default http://localhost:5244/), DPR, CLIP="x,y,w,h" for a close crop. A spot's `on` list switches key groups on
// through the debug handle so raised bridges and stairs can be seen without walking there.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '/tmp/stage-shots';
const filter = process.argv[3];
const base = process.env.URL ?? 'http://localhost:5244/';
mkdirSync(out, { recursive: true });

type Spot = { name: string; q: string; on?: number[]; off?: number[]; keys?: string[]; t?: number; page?: boolean; flip?: number[]; flipAfter?: number };
const SPOTS: Spot[] = [
  { name: 'n-garden-gate', q: 'level=3&x=10&y=5&z=3' },
  { name: 'n-garden-gate-open', q: 'level=3&x=10&y=5&z=3', on: [1] },
  { name: 'n-garden-press', q: 'level=3&x=8.5&y=5&z=3.5' },
  { name: 'n-bridge-ghost', q: 'level=3&x=22&y=5&z=1.5' },
  { name: 'n-bridge', q: 'level=3&x=22&y=5&z=1.5', on: [2] },
  { name: 'n-stairs', q: 'level=3&x=92&y=9&z=7.5', on: [6] },
  { name: 'n-stairs-ghost', q: 'level=3&x=92&y=9&z=7.5', off: [6] },
  { name: 'n-stairs-low', q: 'level=3&x=91&y=5&z=3', on: [6] },
  { name: 'n-bridge-mid', q: 'level=3&x=16&y=5&z=1.5', flip: [2], flipAfter: 0.12 },
  { name: 'n-garden-mid', q: 'level=3&x=10&y=5&z=3', flip: [1], flipAfter: 0.1 },
  { name: 'n-chord', q: 'level=3&x=110&y=15&z=1.5' },
  { name: 'n-moon-bridge', q: 'level=3&x=118&y=15&z=0.5', on: [7, 8, 9] },
  { name: 't-key', q: 'level=4&x=8&y=5&z=2.5' },
  { name: 't-cogs', q: 'level=4&x=78&y=29&z=7.5' },
  { name: 'f-stairs', q: 'level=5&x=70&y=13&z=1', on: [1] },
  { name: 's-thorns', q: 'level=2&x=23&y=10&z=1.5' },
  { name: 'f-thorns', q: 'level=5&x=44.5&y=13&z=0.5' },
  { name: 't-pit', q: 'level=4&x=58&y=21&z=0.5' },
  { name: 'n-garden-page', q: 'level=3&x=10&y=5&z=3', page: true },
];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
const clip = process.env.CLIP ? (([x, y, width, height]) => ({ x, y, width, height }))(process.env.CLIP.split(',').map(Number)) : undefined;
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
for (const s of SPOTS) {
  if (filter && !s.name.includes(filter)) continue;
  await page.goto(`${base}?${s.q}`);
  if (s.on || s.off) {
    // Switch the groups as soon as the level exists, then put Quaver back where the spot says.
    const p = new URLSearchParams(s.q);
    await page.waitForFunction(() => !!(window as unknown as { __opus?: { game?: unknown } }).__opus?.game);
    await page.evaluate(
      ([on, off, x, y, z]) => {
        const app = (window as unknown as { __opus: { game: { groups: boolean[] }; teleport(x: number, y: number, z: number): void } }).__opus;
        for (const i of on as number[]) app.game.groups[i] = true;
        for (const i of off as number[]) app.game.groups[i] = false;
        app.teleport(x as number, y as number, z as number);
      },
      [s.on ?? [], s.off ?? [], Number(p.get('x')), Number(p.get('y')), Number(p.get('z'))] as const,
    );
    await page.waitForTimeout(300);
    await page.evaluate(
      ([x, y, z]) => (window as unknown as { __opus: { teleport(x: number, y: number, z: number): void } }).__opus.teleport(x, y, z),
      [Number(p.get('x')), Number(p.get('y')), Number(p.get('z'))] as const,
    );
  }
  await page.waitForTimeout(1400);
  if (s.flip) {
    // Toggle groups and catch the gates halfway through their change.
    await page.evaluate((f) => {
      const g = (window as unknown as { __opus: { game: { groups: boolean[] } } }).__opus.game.groups;
      for (const i of f) g[i] = !g[i];
    }, s.flip);
    await page.waitForTimeout((s.flipAfter ?? 0.1) * 1000);
  }
  if (s.keys) {
    for (const k of s.keys) await page.keyboard.down(k);
    await page.waitForTimeout((s.t ?? 0.5) * 1000);
    for (const k of s.keys) await page.keyboard.up(k);
    await page.waitForTimeout(500);
  }
  if (s.page) {
    await page.keyboard.press('ShiftLeft');
    await page.waitForTimeout(1300);
  }
  await page.screenshot({ path: join(out, `${s.name}.png`), clip });
  console.log('shot', s.name);
}
await browser.close();
