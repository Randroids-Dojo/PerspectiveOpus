// Runs the real audio engine inside the game page (headless Chrome), plays through
// a level with the keyboard while changing songs, perspective, restored notes and
// menus, and reports first-sound latency, beat timing, voices and nodes over time,
// long main-thread tasks, and any console errors.
//
//   npx vite --port 5243 --strictPort        (in another terminal)
//   npx tsx scripts/audio-live.ts [seconds]

import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5243/';
const seconds = Number(process.argv[2] ?? 70);

const browser = await chromium.launch({
  channel: process.env.CHANNEL ?? 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(`${URL}?level=0&mode=3d`);
await page.waitForFunction(() => !!(window as unknown as { __opus?: unknown }).__opus, null, { timeout: 30000 });
await page.waitForTimeout(800);

type W = Window & {
  __opus: { audio: unknown };
  __live: import('../src/audio/audio').AudioEngine;
  __long: number[];
  __t0: number;
};

const boot = await page.evaluate(async () => {
  const w = window as unknown as W;
  w.__long = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__long.push(e.duration);
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    // Not supported.
  }
  const t0 = performance.now();
  const mod = await import('/src/audio/engine.ts' as string);
  const a = mod.createAudio() as W['__live'];
  w.__live = a;
  w.__opus.audio = a;
  await a.unlock();
  a.setRestored(0, 7);
  a.playSong('overture');
  w.__t0 = t0;
  return { unlocked: a.unlocked, importMs: performance.now() - t0 };
});
console.log('boot', boot);

const stats: { t: number; s: ReturnType<NonNullable<W['__live']['stats']>>; beat: number }[] = [];
const sample = async (t: number) => {
  const r = await page.evaluate(() => {
    const w = window as unknown as W;
    return { s: w.__live.stats!(), beat: w.__live.beat() };
  });
  stats.push({ t, ...r });
};

const press = async (key: string, ms = 60) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};
const call = (code: string) => page.evaluate(`(() => { const a = window.__live; ${code} })()`);

const start = Date.now();
const elapsed = () => (Date.now() - start) / 1000;
let step = 0;
const script: [number, () => Promise<unknown>][] = [
  [2, () => page.keyboard.down('ArrowRight')],
  [3, () => press('Space', 200)],
  [5, () => press('ShiftLeft')],
  [6, () => press('Space', 120)],
  [7, () => call('a.setRestored(1, 7); a.handle([{ t: "note", id: 0, count: 1, total: 7 }], { mode: "2d", x: 0, y: 0, z: 0 })')],
  [9, () => press('ShiftLeft')],
  [10, () => press('Space', 300)],
  [12, () => call('a.setRestored(3, 7); a.handle([{ t: "note", id: 1, count: 3, total: 7 }], { mode: "3d", x: 0, y: 0, z: 0 })')],
  [14, () => call('a.setPaused(true); a.ui("pause")')],
  [15, () => call('a.ui("hover"); a.ui("hover"); a.ui("confirm")')],
  [17, () => call('a.setPaused(false); a.ui("resume")')],
  [18, () => press('ShiftLeft')],
  [19, () => press('ShiftLeft')],
  [20, () => press('Space', 200)],
  [22, () => call('a.setRestored(7, 7); a.handle([{ t: "note", id: 6, count: 7, total: 7 }], { mode: "3d", x: 0, y: 0, z: 0 })')],
  [24, () => call('a.handle([{ t: "checkpoint", id: 0 }, { t: "bounce", id: 0 }], { mode: "3d", x: 0, y: 0, z: 0 })')],
  [26, () => call('a.handle([{ t: "death", cause: "thorn", pos: { x: 0, y: 0, z: 0 } }], { mode: "3d", x: 0, y: 0, z: 0 })')],
  [27.2, () => call('a.handle([{ t: "respawn" }], { mode: "3d", x: 0, y: 0, z: 0 })')],
  [29, () => call('a.handle([{ t: "exit" }], { mode: "3d", x: 0, y: 0, z: 0 }); a.ui("complete")')],
  [32, () => call('a.setRestored(0, 7); a.playSong("adagio")')],
  [40, () => press('ShiftLeft')],
  [44, () => call('a.playSong("title")')],
  [50, () => call('a.playSong("toccata"); a.setRestored(5, 7)')],
  [56, () => call('a.playSong("finale")')],
  [62, () => call('a.stopSong(1.5)')],
  [64, () => call('a.playSong("overture")')],
];
let nextSample = 0;
while (elapsed() < seconds) {
  const t = elapsed();
  while (step < script.length && script[step][0] <= t) {
    await script[step][1]();
    step++;
  }
  if (t >= nextSample) {
    await sample(t);
    nextSample += 0.5;
  }
  await page.waitForTimeout(40);
}
await page.keyboard.up('ArrowRight');
const long = await page.evaluate(() => (window as unknown as W).__long);
await browser.close();

console.log('\n   t   state    song      r  voices peak stolen nodes samples   MB   queued render  missing first  beat');
for (const x of stats.filter((_, i) => i % 2 === 0)) {
  const s = x.s;
  console.log(
    `${x.t.toFixed(1).padStart(5)}  ${s.state.padEnd(8)} ${String(s.song).padEnd(9)} ${s.restored}  ${String(s.voices).padStart(5)} ${String(s.peakVoices).padStart(4)} ${String(s.stolen).padStart(5)} ${String(s.nodes).padStart(5)} ${String(s.samples).padStart(6)} ${s.sampleMB.toFixed(1).padStart(5)} ${String(s.queued).padStart(6)} ${(s.renderMs / 1000).toFixed(1).padStart(6)}s ${String(s.missingNotes).padStart(5)} ${s.firstSoundMs.toFixed(0).padStart(5)}  ${x.beat.toFixed(2)}`,
  );
}
// Beat clock check: within one song the beat should advance at the tempo.
const ov = stats.filter((x) => x.s.song === 'overture' && x.beat >= 0 && x.t < 31);
if (ov.length > 4) {
  const a = ov[1];
  const b = ov[ov.length - 1];
  console.log(`\noverture beat rate ${(((b.beat - a.beat) / (b.t - a.t)) * 60).toFixed(1)} bpm (written 116)`);
  let back = 0;
  for (let i = 1; i < ov.length; i++) if (ov[i].beat < ov[i - 1].beat) back++;
  console.log(`beat went backwards ${back} times`);
}
console.log(`long tasks: ${long.length}, max ${long.length ? Math.max(...long).toFixed(0) : 0} ms`);
const uniq = [...new Set(errors)];
console.log(uniq.length ? `\n${uniq.length} console messages:\n  ${uniq.slice(0, 40).join('\n  ')}` : '\nno console errors or warnings');
