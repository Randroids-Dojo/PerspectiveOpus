// Main-thread costs of the audio engine's setup in Chrome: impulse responses, the
// mixing desk, compiling each song, and first renders of a few instruments.
//   npx tsx scripts/audio-probe.ts        (server from scripts/audio-vite.config.ts running)
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5243/';
const b = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.goto(`${URL}src/audio/dev/index.html`);
await p.waitForFunction(() => !!window.__audioHarness);
// Passed as a string: esbuild's name helpers do not exist inside the page.
const r = (await p.evaluate(`(async () => {
  const { Mixer } = await import('/src/audio/mixer.ts');
  const { makeImpulse, HALL, ROOM } = await import('/src/audio/dsp/reverb.ts');
  const { compileSong } = await import('/src/audio/music/arranger.ts');
  const { SONGS } = await import('/src/audio/music/songs/index.ts');
  const { runJob } = await import('/src/audio/dsp/render.ts');
  const ctx = new AudioContext();
  const time = (fn) => { const t = performance.now(); fn(); return +(performance.now() - t).toFixed(1); };
  const out = { sampleRate: ctx.sampleRate };
  out.hallIR = time(() => makeImpulse(HALL, ctx.sampleRate));
  out.roomIR = time(() => makeImpulse(ROOM, ctx.sampleRate));
  out.mixer = time(() => new Mixer(ctx));
  for (const id of Object.keys(SONGS)) out['compile ' + id] = time(() => compileSong(SONGS[id]));
  for (const [id, midi] of [['feltPiano', 40], ['feltPiano', 72], ['strings', 60], ['choir', 60], ['organ', 48], ['harp', 60], ['timpani', 45], ['horn', 55], ['pizz', 50]])
    out['render ' + id + ' ' + midi] = time(() => runJob({ kind: 'inst', id, midi }));
  ctx.close();
  return out;
})()`)) as Record<string, number>;
for (const [k, v] of Object.entries(r)) console.log(`${k.padEnd(22)} ${v}`);
await b.close();
