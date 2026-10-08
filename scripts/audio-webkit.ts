// Smoke test of the audio engine in WebKit (Safari's engine): unlock, play songs,
// fire every event in both worlds, switch, pause, and a short offline render.
//   npx tsx scripts/audio-webkit.ts        (server from scripts/audio-vite.config.ts running)
import { webkit } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5243/';
// WEBKIT_PATH points at another installed Playwright WebKit build if the matching one is absent.
const browser = await webkit.launch({ headless: true, executablePath: process.env.WEBKIT_PATH });
const page = await browser.newPage();
const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(`${URL}src/audio/dev/index.html`);
await page.waitForFunction(() => !!window.__audioHarness, null, { timeout: 30000 });
// A real click, so the unlock happens inside a user gesture as on iOS.
await page.evaluate(() => {
  const b = document.createElement('button');
  b.id = 'go';
  b.textContent = 'go';
  b.onclick = () => {
    const a = window.__audioHarness.engine;
    void a.unlock().then(() => {
      a.setRestored(3, 7);
      a.playSong('overture');
    });
  };
  document.body.prepend(b);
});
await page.click('#go');
await page.waitForTimeout(3000);
const r1 = await page.evaluate(`(async () => {
  const a = window.__audioHarness.engine;
  const s = a.stats();
  const b1 = a.beat();
  const ev = (e, mode) => a.handle([e], { mode, x: 0, y: 0, z: 0 });
  for (const mode of ['2d', '3d']) {
    ev({ t: 'step', mode, surface: 3 }, mode);
    ev({ t: 'jump', mode }, mode);
    ev({ t: 'land', mode, impact: 15, surface: 1 }, mode);
    ev({ t: 'note', id: 0, count: 4, total: 7 }, mode);
    ev({ t: 'checkpoint', id: 0 }, mode);
    ev({ t: 'bounce', id: 0 }, mode);
    ev({ t: 'key', id: 0, group: 1, on: true }, mode);
    ev({ t: 'gate', group: 1, on: true }, mode);
    ev({ t: 'death', cause: 'fall', pos: { x: 0, y: 0, z: 0 } }, mode);
    ev({ t: 'respawn' }, mode);
    ev({ t: 'switch', mode, embedded: mode === '2d' }, mode);
    ev({ t: 'exit' }, mode);
  }
  for (const u of ['hover', 'confirm', 'back', 'pause', 'resume', 'start', 'complete', 'unlock', 'page']) a.ui(u);
  a.setPerspective(0.5); a.setTimeScale(0.34); a.setPaused(true);
  await new Promise((r) => setTimeout(r, 600));
  a.setPerspective(0); a.setTimeScale(1); a.setPaused(false);
  a.playSong('nocturne');
  await new Promise((r) => setTimeout(r, 2500));
  return { first: s, beat1: b1, beat2: a.beat(), after: a.stats() };
})()`);
console.log(JSON.stringify(r1, null, 1));
const off = await page.evaluate(`(async () => {
  try {
    const r = await window.__audioHarness.renderSong({ song: 'adagio', seconds: 8, blend: 1, restored: 7, switches: [{ t: 3, to: 0 }] });
    return { lufs: r.analysis.lufs, peak: r.analysis.peakDb, clipped: r.analysis.clipped, missing: r.missing };
  } catch (e) { return { error: String(e) }; }
})()`);
console.log('offline', off);
await browser.close();
const uniq = [...new Set(errors)];
console.log(uniq.length ? `${uniq.length} console messages:\n  ${uniq.join('\n  ')}` : 'no console errors or warnings');
