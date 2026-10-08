// End-to-end flow with real input: title, programme, settings, begin, play,
// switch both ways, pause, resume, back to the metronome, finish a movement
// (by teleporting to the arch), the completion card and the next movement.
//   npx tsx scripts/flowtest.ts [outDir] [url]
// Env: PHONE=1 for touch at 844x390, PAD=1 for an injected gamepad.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';

const out = process.argv[2] ?? '/tmp/opus-flow';
const url = process.argv[3] ?? 'http://localhost:5233/';
const phone = process.env.PHONE === '1';
const pad = process.env.PAD === '1';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext(
  phone
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 } },
);
const page = await ctx.newPage();
const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.clear());
if (pad)
  await page.addInitScript(() => {
    // A virtual standard-mapping controller the page polls like a real one.
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const fake = { id: 'Virtual pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
    (window as any).__pad = fake;
    navigator.getGamepads = () => [fake as unknown as Gamepad];
  });
await page.goto(url);
await page.waitForTimeout(1500);

let n = 0;
const shot = async (name: string) => {
  const p = join(out, `${String(++n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: p });
  console.log('shot', p);
};
const state = (p: Page) => p.evaluate(() => (window as any).__director.state as string);
const PADMAP: Record<string, number> = { Enter: 0, Space: 0, Escape: 1, ShiftLeft: 3, ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15 };
const key = async (k: string, wait = 250) => {
  if (pad && k in PADMAP) {
    const b = PADMAP[k];
    await page.evaluate((i) => ((window as any).__pad.buttons[i].pressed = true), b);
    await page.waitForTimeout(80);
    await page.evaluate((i) => ((window as any).__pad.buttons[i].pressed = false), b);
    await page.waitForTimeout(wait);
    return;
  }
  await page.keyboard.press(k);
  await page.waitForTimeout(wait);
};
const tap = async (selector: string, wait = 300) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no ${selector}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(wait);
};
const check = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log('ok', msg);
};

await shot('title');
check((await state(page)) === 'title', 'starts on the title');
if (phone) {
  await tap('.menu-item:has-text("Programme")');
} else {
  await key('ArrowDown');
  await key('Enter', 600);
}
await shot('programme');
if (phone) await tap('.menu-item:has-text("Back")');
else await key('Escape', 500);
check((await page.locator('.title-menu').count()) === 1, 'back to the title menu');
if (phone) await tap('.menu-item:has-text("Settings")', 600);
else {
  await key('ArrowDown');
  await key('Enter', 600);
}
await shot('settings');
if (phone) await tap('.menu-item:has-text("Back")');
else await key('Escape', 500);
if (phone) await tap('.menu-item:has-text("Begin")', 1600);
else {
  await key('ArrowUp');
  await key('ArrowUp');
  await key('Enter', 1600);
}
check((await state(page)) === 'play', 'Begin starts a movement');
await shot('intro-card');
await page.waitForTimeout(2500);

// Play a little: run right, jump.
if (phone) {
  const vp = page.viewportSize()!;
  await page.touchscreen.tap(vp.width * 0.2, vp.height * 0.7);
} else if (pad) {
  await page.evaluate(() => ((window as any).__pad.axes[0] = 1));
  await page.waitForTimeout(700);
  await key('Space', 500);
  await page.evaluate(() => ((window as any).__pad.axes[0] = 0));
} else {
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(700);
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
}
await shot('playing-stage');
const x0 = await page.evaluate(() => (window as any).__opus.game.player.pos.x);
check(phone || x0 > 5, `Quaver moved (x ${x0.toFixed(2)})`);

// Switch to the score and back.
if (phone) await tap('.tswitch', 1000);
else await key('ShiftLeft', 1000);
check((await page.evaluate(() => (window as any).__opus.game.mode)) === '2d', 'switched to the Score');
await shot('playing-score');
if (phone) await tap('.tswitch', 1000);
else await key('ShiftLeft', 1000);
check((await page.evaluate(() => (window as any).__opus.game.mode)) === '3d', 'switched back to the Stage');

// Pause, back to the metronome.
if (phone) await tap('.hud-pause', 500);
else if (pad) {
  await page.evaluate(() => ((window as any).__pad.buttons[9].pressed = true));
  await page.waitForTimeout(80);
  await page.evaluate(() => ((window as any).__pad.buttons[9].pressed = false));
  await page.waitForTimeout(500);
} else await key('Escape', 500);
check((await state(page)) === 'pause', 'paused');
await shot('pause');
if (phone) await tap('.menu-item:has-text("metronome")', 600);
else {
  await key('ArrowDown');
  await key('Enter', 600);
}
check((await state(page)) === 'play', 'resumed from the metronome');

// Finish by placing Quaver at the arch.
await page.evaluate(() => {
  const app = (window as any).__opus;
  const ex = app.game.level.exit.pos;
  app.teleport(ex.x - 1.5, ex.y, ex.z);
});
if (!phone && !pad) {
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
} else {
  await page.evaluate(() => {
    const app = (window as any).__opus;
    app.input.touch.x = 1;
    setTimeout(() => (app.input.touch.x = 0), 500);
  });
}
await page.waitForTimeout(2600);
check((await state(page)) === 'complete', 'movement complete');
await shot('complete');
if (phone) await tap('.menu-item:has-text("Next movement")', 1800);
else await key('Enter', 1800);
check((await page.evaluate(() => (window as any).__opus.levelIndex)) === 1, 'next movement started');
await page.waitForTimeout(1000);
await shot('movement-2');
const saved = await page.evaluate(() => localStorage.getItem('opus:v1:save'));
check(!!saved && JSON.parse(saved).movements.overture.done === true, 'progress saved');

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
if (errors.length) process.exit(1);
