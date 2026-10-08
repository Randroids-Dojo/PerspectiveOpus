// The Stage half of tour.ts (every movement's key spots) against any dev server (URL env, default :5244).
//   npx tsx scripts/stage-movements.ts [outDir] [only-level]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { getLevel } from '../src/game/levels';
import { isSolidMat } from '../src/game/types';

const out = process.argv[2] ?? '/tmp/stage-tour';
const only = process.argv[3];
mkdirSync(out, { recursive: true });

const SPOTS: [number, number, number, string][] = [
  [0, 17, 4, 'meadow-note'],
  [0, 29.5, 7.5, 'behind-wall'],
  [0, 45, 0.5, 'first-bridge'],
  [0, 80.5, 7.5, 'staircase'],
  [0, 130, 7.5, 'tower-arch'],
  [1, 16, 1.5, 'stand'],
  [1, 50, 0.5, 'midair'],
  [1, 73, 0.5, 'lift'],
  [1, 107, 1, 'two-stands'],
  [2, 11, 3.5, 'drum'],
  [2, 23, 1.5, 'thorns'],
  [2, 38, 0.5, 'balcony'],
  [2, 60, 6.5, 'depth-discord'],
  [2, 85, 7.5, 'bell-tower'],
  [2, 100, 0.5, 'rooftop-bridge'],
  [3, 10, 3.5, 'garden-gate'],
  [3, 22, 1.5, 'gate-bridge'],
  [3, 47, 0.5, 'half-bridges'],
  [3, 66, 0.5, 'maze'],
  [3, 92, 7.5, 'golden-stairs'],
  [3, 110, 1.5, 'chord'],
  [4, 8, 2.5, 'workshop'],
  [4, 29, 7.5, 'wall-ride'],
  [4, 44, 7.5, 'pendulum'],
  [4, 62, 0.5, 'paternoster'],
  [4, 78, 7.5, 'gauntlet'],
  [5, 12, 0.5, 'grand-staircase'],
  [5, 27, 7.5, 'curtain'],
  [5, 41, 0.5, 'timpani-pit'],
  [5, 76, 0.5, 'piano'],
  [5, 104, 1, 'organ-pipe'],
  [5, 143, 3, 'last-bridge'],
];

function groundAt(level: number, x: number, z: number): number {
  const lv = getLevel(level);
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let y = lv.h - 2; y >= 0; y--) if (isSolidMat(lv.cells[cx + lv.w * (y + lv.h * cz)])) return y + 1;
  return 12;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
for (const [lv, x, z, name] of SPOTS) {
  if (only !== undefined && String(lv) !== only) continue;
  const y = groundAt(lv, x, z);
  await page.goto(`${process.env.URL ?? 'http://localhost:5244/'}?level=${lv}&x=${x}&y=${y}&z=${z}`);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(out, `${lv}-${name}-stage.png`) });
  console.log('shot', lv, name);
}
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
