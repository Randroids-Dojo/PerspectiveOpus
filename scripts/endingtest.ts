// Finishes the Finale and watches the ending and credits.  npx tsx scripts/endingtest.ts [outDir]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '/tmp/opus-ending';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  const ids = ['overture', 'adagio', 'scherzo', 'nocturne', 'toccata'];
  const movements: Record<string, unknown> = {};
  for (const id of ids) movements[id] = { done: true, notes: [true, true, true, true, true, true, true], bestTime: 300, fewestDeaths: 0 };
  localStorage.setItem('opus:v1:save', JSON.stringify({ v: 1, movements, settings: {}, seenEnding: false, last: 5 }));
});
await page.goto('http://localhost:5233/');
await page.waitForTimeout(1500);
await page.mouse.click(640, 360);
await page.screenshot({ path: join(out, '00-title.png') });
await page.evaluate(() => (window as any).__director.play(5));
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const app = (window as any).__opus;
  app.game.notesTaken = app.game.notesTaken.map(() => true);
  const ex = app.game.level.exit.pos;
  app.teleport(ex.x - 1.5, ex.y, ex.z);
  app.input.touch.x = 1;
  setTimeout(() => (app.input.touch.x = 0), 600);
});
await page.waitForTimeout(2800);
await page.screenshot({ path: join(out, '01-complete.png') });
console.log('state', await page.evaluate(() => (window as any).__director.state));
await page.keyboard.press('Enter');
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(out, `${String(i + 2).padStart(2, '0')}-ending-${(i + 1) * 4}s.png`) });
}
console.log('state', await page.evaluate(() => (window as any).__director.state));
console.log('audio', await page.evaluate(() => JSON.stringify((window as any).__opus.audio.stats?.())));
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
console.log('after credits', await page.evaluate(() => (window as any).__director.state));
const save = await page.evaluate(() => JSON.parse(localStorage.getItem('opus:v1:save')!));
console.log('seenEnding', save.seenEnding, 'finale done', save.movements.finale?.done);
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
