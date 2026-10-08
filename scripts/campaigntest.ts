// Replay all six proven solutions through the live app, HUD, save and ending.
// npx tsx scripts/campaigntest.ts [url] [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { getLevel } from '../src/game/levels';
import type { InputFrame } from '../src/game/sim';
import { Bot } from '../tests/bot';
import { SOLUTIONS } from '../tests/solutions';

const tapes: InputFrame[][] = SOLUTIONS.map((s) => {
  const frames: InputFrame[] = [];
  const bot = new Bot(getLevel(s.level));
  bot.onStep = (input) => frames.push(input);
  s.run(bot);
  return frames;
});
const url = process.argv[2] ?? 'http://localhost:5233/';
const out = process.argv[3] ?? '/tmp/opus-campaign';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
const results: unknown[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).__director);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__director);
  await page.evaluate((recordings) => {
    const app = (window as any).__opus;
    let tape: InputFrame[] = [];
    let cursor = 0;
    const start = app.startLevel.bind(app);
    app.startLevel = (...args: any[]) => {
      const game = start(...args);
      tape = recordings[app.levelIndex] ?? [];
      cursor = 0;
      return game;
    };
    app.input.frame = () => tape[cursor++] ?? { moveX: 0, moveZ: 0, jumpHeld: false, jumpPressed: false, switchPressed: false };
    app.onFrame(() => { app.view.timeScale = 6; });
  }, tapes);
  await page.keyboard.press('Enter');
  for (let i = 0; i < SOLUTIONS.length; i++) {
    await page.waitForFunction((index) => (window as any).__director.state === 'play' && (window as any).__opus.levelIndex === index, i, { timeout: 10000 });
    await page.waitForFunction(() => (window as any).__director.state === 'complete', null, { timeout: 90000 });
    const result = await page.evaluate(() => {
      const app = (window as any).__opus;
      const game = app.game;
      const save = JSON.parse(localStorage.getItem('opus:v1:save')!);
      return { level: game.level.info.id, finished: game.finished, notes: game.notesTaken.filter(Boolean).length, deaths: game.deaths, switches: game.switches, hud: document.querySelector('.hud-count')?.textContent, saved: save.movements[game.level.info.id] };
    });
    if (!result.finished || result.notes !== 7 || result.deaths !== 0 || result.hud !== '7 / 7' || !result.saved.done || result.saved.notes.filter(Boolean).length !== 7) throw new Error(`Campaign failed: ${JSON.stringify(result)}`);
    console.log('ok', JSON.stringify(result));
    results.push(result);
    await page.screenshot({ path: `${out}/${i + 1}-${result.level}-complete.png` });
    await page.waitForTimeout(700);
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(() => (window as any).__director.state === 'ending', null, { timeout: 10000 });
  await page.waitForFunction(() => (window as any).__director.endingTimer > 3.1);
  await page.screenshot({ path: `${out}/ending.png` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__director.state === 'title');
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('opus:v1:save')!));
  const count = Object.values(save.movements).reduce<number>((sum, record: any) => sum + record.notes.filter(Boolean).length, 0);
  if (count !== 42 || !save.seenEnding || errors.length) throw new Error(`Ending failed: ${JSON.stringify({ count, seenEnding: save.seenEnding, errors })}`);
  console.log('ok campaign ending, 42 saved notes and no runtime errors');
  writeFileSync(`${out}/report.json`, JSON.stringify({ url, results, count, seenEnding: save.seenEnding, errors }, null, 2));
} finally {
  await browser.close();
}
