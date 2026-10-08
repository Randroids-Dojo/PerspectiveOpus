// Offline renders of every song through the real engine code (OfflineAudioContext
// in headless Chrome), with measurements, and WAVs for listening.
//
//   npx vite --port 5243 --strictPort        (in another terminal)
//   npx tsx scripts/audio-render.ts [song ...] [--no-wav] [--quick] [--tour]
//
// For each song: the score and stage arrangements fully restored (60 s each), a
// "journey" (notes restored one by one while the perspective switches back and
// forth), 20 s loudness checks at 0, 3 and 7 notes in both arrangements, and the
// loop seam in both arrangements. Writes WAVs and report.json to /tmp/opus-audio.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const SONGS = ['title', 'overture', 'adagio', 'scherzo', 'nocturne', 'toccata', 'finale', 'ending'];
const args = process.argv.slice(2);
const wav = !args.includes('--no-wav');
const quick = args.includes('--quick');
const tour = args.includes('--tour') || args.length === 0;
const levelsOnly = args.includes('--levels');
const seamsOnly = args.includes('--seams');
const pick = args.filter((a) => !a.startsWith('--'));
const songs = pick.length ? pick : SONGS;
const URL = process.env.URL ?? 'http://localhost:5243/';
const OUT = process.env.OUT ?? '/tmp/opus-audio';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.CHANNEL ?? 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(`${URL}src/audio/dev/index.html`);
await page.waitForFunction(() => !!window.__audioHarness, null, { timeout: 30000 });

type Res = Awaited<ReturnType<Window['__audioHarness']['renderSong']>>;
const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const report: Record<string, unknown> = {};

async function render(name: string, o: Parameters<Window['__audioHarness']['renderSong']>[0]): Promise<Res> {
  const r = await page.evaluate((opts) => window.__audioHarness.renderSong(opts), o);
  if (r.wav) {
    writeFileSync(join(OUT, `${name}.wav`), Buffer.from(r.wav, 'base64'));
    r.wav = undefined;
  }
  const a = r.analysis;
  const maxNodes = Math.max(...r.timeline.map((x) => x.nodes));
  console.log(
    `  ${name.padEnd(30)} LUFS ${fmt(a.lufs).padStart(6)}  RMS ${fmt(a.rmsDb).padStart(6)}  peak ${fmt(a.peakDb).padStart(5)}  TP ${fmt(a.truePeakDb).padStart(5)}  clip ${a.clipped}` +
      `  ST ${fmt(a.shortTermMin)}..${fmt(a.shortTermMax)}  gap ${fmt(a.longestGap)}s  voices ${r.peakVoices} (stolen ${r.stolen})  nodes<=${maxNodes}` +
      `  missing ${r.missing}  ${fmt(r.renderSeconds)}s` +
      (name.endsWith('-score') || name.endsWith('-stage') ? `  bands ${a.bands.join('/')} corr ${fmt(a.correlation, 2)}` : '') +
      (r.seam ? `  seam ${fmt(r.seam.jumpDb, 2)} dB, step at seam ${fmt(r.seam.seamStep, 3)} vs largest at other bar lines ${fmt(r.seam.barStep, 3)}` : ''),
  );
  return r;
}

for (const id of songs) {
  console.log(`\n${id}`);
  const seamT = await page.evaluate((s) => window.__audioHarness.seamOf(s as never), id);
  const long = quick ? 20 : 60;
  const rep: Record<string, Res> = {};
  if (levelsOnly) {
    for (const level of id === 'title' || id === 'ending' ? [7] : [0, 7])
      for (const blend of [0, 1])
        rep[`L${level}-${blend ? 'stage' : 'score'}`] = await render(`${id}-L${level}-${blend ? 'stage' : 'score'}`, { song: id as never, seconds: 24, blend, restored: level });
    report[id] = rep;
    continue;
  }
  if (!seamsOnly) rep.score = await render(`${id}-score`, { song: id as never, seconds: long, blend: 0, restored: 7, wav });
  if (!seamsOnly) rep.stage = await render(`${id}-stage`, { song: id as never, seconds: long, blend: 1, restored: 7, wav });
  if (id !== 'title' && id !== 'ending' && !seamsOnly) {
    rep.journey = await render(`${id}-journey`, {
      song: id as never,
      seconds: long,
      blend: 1,
      restored: 0,
      restore: [1, 2, 3, 4, 5, 6, 7].map((k) => ({ t: 3 + (k - 1) * ((long - 8) / 7), level: k })),
      switches: Array.from({ length: Math.floor((long - 6) / 9) }, (_, k) => ({ t: 6 + k * 9, to: k % 2 === 0 ? 0 : 1 })),
      wav,
    });
    if (!quick)
      for (const level of [0, 3, 7])
        for (const blend of [0, 1])
          rep[`L${level}-${blend ? 'stage' : 'score'}`] = await render(`${id}-L${level}-${blend ? 'stage' : 'score'}`, {
            song: id as never,
            seconds: 20,
            blend,
            restored: level,
          });
  }
  if (id !== 'ending')
    for (const blend of [0, 1])
      rep[`seam-${blend ? 'stage' : 'score'}`] = await render(`${id}-seam-${blend ? 'stage' : 'score'}`, {
        song: id as never,
        seconds: 16,
        blend,
        restored: 7,
        from: seamT - 8,
        seamAt: 8.05,
        wav: wav && blend === 1,
      });
  report[id] = rep;
}

if (tour) {
  console.log('\neffects tour');
  const solo = await page.evaluate(() => window.__audioHarness.renderSfxTour(false, 0, 4));
  for (const c of solo.cues) console.log(`  ${c.what.padEnd(26)} peak ${fmt(c.peakDb).padStart(6)}  rms ${fmt(c.rmsDb).padStart(6)}`);
  const t = await page.evaluate(() => window.__audioHarness.renderSfxTour(true));
  if (t.wav) writeFileSync(join(OUT, 'sfx-tour.wav'), Buffer.from(t.wav, 'base64'));
  writeFileSync(join(OUT, 'sfx-tour-cues.txt'), t.cues.map((c) => `${c.t.toFixed(2)}\t${c.what}`).join('\n'));
  const a = t.analysis;
  console.log(`  sfx-tour  LUFS ${fmt(a.lufs)}  peak ${fmt(a.peakDb)}  TP ${fmt(a.truePeakDb)}  clip ${a.clipped}  (${t.cues.length} cues)`);
  report.tour = { analysis: a, cues: t.cues };
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(`\nwrote ${OUT}`);
if (errors.length) {
  console.log(`\n${errors.length} console messages:`);
  for (const e of [...new Set(errors)].slice(0, 30)) console.log('  ' + e);
}
await browser.close();
