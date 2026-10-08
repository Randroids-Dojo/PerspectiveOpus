// Regression scenarios for input recovery, saved pickups, menu audio and HUD readability.
// npm exec tsx scripts/polishtest.ts [url]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';

const out = '/tmp/opus-polish-regressions';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'] });
const checks: string[] = [];
const errors: string[] = [];
const check = (ok: boolean, name: string) => {
  if (!ok) throw new Error(`FAILED: ${name}`);
  checks.push(name);
  console.log('ok', name);
};
const observe = (page: Page) => {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
};
const url = process.argv[2] ?? 'http://localhost:5233/';

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  observe(page);
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).__opus);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__director);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as any).__director.state === 'play');
  await page.waitForTimeout(3200);
  check(await page.locator('.hud-hint.show').isVisible(), 'opening hint appears after the title fades');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(300);
  await page.keyboard.down('Space');
  await page.waitForTimeout(180);
  check(await page.evaluate(() => (window as any).__opus.stage.quaver.landing.visible), 'airborne Stage shows the actual landing surface');
  await page.screenshot({ path: `${out}/stage-jump.png` });
  await page.keyboard.press('ShiftLeft');
  await page.waitForTimeout(90);
  await page.keyboard.press('ShiftLeft');
  await page.waitForTimeout(1000);
  await page.keyboard.up('Space');
  await page.keyboard.up('ArrowRight');
  check(await page.evaluate(() => (window as any).__opus.game.mode === '3d' && (window as any).__opus.game.deaths === 0), 'rapid midair reversal leaves Quaver alive and in the Stage');

  await page.keyboard.press('Escape');
  await page.locator('.pause-screen .menu-item:has-text("Settings")').click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(await page.evaluate(() => (window as any).__director.state === 'pause'), 'Escape leaves settings with the game still paused');
  check(await page.locator('.settings-screen').count() === 0, 'one Escape closes exactly one menu');
  await page.locator('.pause-screen .menu-item:has-text("Restart")').click();
  await page.waitForFunction(() => (window as any).__director.state === 'play');
  check(await page.evaluate(() => !(window as any).__opus.audio.mixer.state.paused), 'restarting from pause restores the music mix');

  await page.evaluate(() => {
    const app = (window as any).__opus;
    const note = app.game.level.notes[0].pos;
    app.teleport(note.x, note.y - 0.43, note.z);
  });
  await page.waitForFunction(() => (window as any).__opus.game.notesTaken[0]);
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('opus:v1:save')!).movements.overture.notes[0]), 'a pickup is saved before the movement is finished');
  check(await page.locator('.hud-count').innerText() === '1 / 7', 'HUD count follows the actual pickup');
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__director);
  check(await page.locator('.title-menu .menu-item:has-text("Continue")').count() === 1, 'reload keeps partial progress and exposes Continue');

  await page.evaluate(() => (window as any).__director.playNow(3, '2d'));
  await page.waitForTimeout(700);
  const night = await page.evaluate(() => ({ dark: document.documentElement.dataset.darkPage, fg: getComputedStyle(document.documentElement).getPropertyValue('--fg').trim(), world: document.documentElement.dataset.world }));
  check(night.dark === 'true' && night.world === '2d' && night.fg === '#f0ead8', 'Nocturne HUD uses light ink on the dark page');
  await page.screenshot({ path: `${out}/nocturne-score.png` });
  await page.evaluate(() => {
    const d = (window as any).__director;
    d.save.settings.reduceMotion = true;
    d.applySettings();
    const app = (window as any).__opus;
    const note = app.game.level.notes[0].pos;
    app.teleport(note.x, note.y - 0.43, note.z);
  });
  await page.waitForFunction(() => (window as any).__opus.game.notesTaken[0]);
  check(await page.locator('.hud-fly .flying').count() === 0, 'reduced motion records pickups without a flying animation');
  await page.close();

  const phone = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  observe(phone);
  await phone.goto(url);
  await phone.waitForFunction(() => !!(window as any).__director);
  await phone.evaluate(() => (window as any).__director.playNow(0, '3d'));
  await phone.touchscreen.tap(150, 260);
  await phone.waitForTimeout(300);
  const cdp = await phone.context().newCDPSession(phone);
  const stick = { id: 1, x: 150, y: 270, radiusX: 5, radiusY: 5, force: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick] });
  stick.x += 52;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [stick] });
  await phone.waitForTimeout(180);
  const box = (await phone.locator('.tjump').boundingBox())!;
  const jump = { id: 2, x: box.x + box.width / 2, y: box.y + box.height / 2, radiusX: 5, radiusY: 5, force: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick, jump] });
  await phone.waitForTimeout(100);
  check(await phone.evaluate(() => (window as any).__opus.game.player.sinceJump < 0.3), 'touch stick and jump work at the same time');
  // CDP ends the listed contact, leaving the other finger held.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [stick] });
  check(await phone.evaluate(() => (window as any).__opus.input.touch.jump && (window as any).__opus.input.touch.x === 0), 'releasing the stick preserves a held jump');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  check(await phone.evaluate(() => !(window as any).__opus.input.touch.jump && (window as any).__opus.input.touch.x === 0), 'touch cancellation releases every held action');
  check(await phone.locator('.touch-world-label').innerText() === 'Score', 'Stage touch button names the Score as its destination');
  await phone.locator('.tswitch').tap();
  await phone.waitForTimeout(1000);
  check(await phone.locator('.touch-world-label').innerText() === 'Stage', 'Score touch button names the Stage as its destination');
  await phone.screenshot({ path: `${out}/phone-score.png` });

  await phone.setViewportSize({ width: 320, height: 640 });
  await phone.waitForTimeout(500);
  const left = (await phone.locator('.hud-left').boundingBox())!;
  const right = (await phone.locator('.hud-right').boundingBox())!;
  check(left.x + left.width <= right.x, 'HUD controls remain separate on a 320-pixel portrait screen');
  await phone.screenshot({ path: `${out}/portrait-score.png` });
  check(errors.length === 0, 'no runtime or renderer errors');
  writeFileSync(`${out}/report.json`, JSON.stringify({ url, checks, errors }, null, 2));
} finally {
  await browser.close();
}
