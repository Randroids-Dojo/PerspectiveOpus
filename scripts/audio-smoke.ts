// Plays the real game with sound in headless Chrome and reports the engine's stats.
//   npx tsx scripts/audio-smoke.ts [url]   (PHONE=1 for touch)
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5233/';
const phone = process.env.PHONE === '1';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=user-gesture-required'] });
const ctx = await browser.newContext(phone ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto(url);
await page.waitForTimeout(1500);
const stats = () => page.evaluate(() => (window as any).__opus.audio.stats?.());
console.log('before gesture', JSON.stringify(await stats()));
if (phone) await page.touchscreen.tap(600, 200);
else await page.mouse.click(600, 200);
await page.waitForTimeout(3000);
console.log('title', JSON.stringify(await stats()));
await page.evaluate(() => (window as any).__director.play(0));
await page.waitForTimeout(4000);
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(800);
await page.keyboard.press('Space');
await page.keyboard.press('ShiftLeft');
await page.waitForTimeout(1500);
await page.keyboard.up('ArrowRight');
console.log('playing', JSON.stringify(await stats()));
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no errors');
await browser.close();
