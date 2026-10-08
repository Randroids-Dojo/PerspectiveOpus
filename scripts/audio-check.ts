// Compiles every song and reports notation errors, ranges, lengths and voice counts.
//   npx tsx scripts/audio-check.ts [--verbose]
import { INSTRUMENTS, zoneOf } from '../src/audio/instruments';
import { compileSong } from '../src/audio/music/arranger';
import { SONGS } from '../src/audio/music/songs';

const verbose = process.argv.includes('--verbose');
// --dump <song> <track[,track]> [bars]: print a track's notes bar by bar as note names.
const di = process.argv.indexOf('--dump');
if (di > 0) {
  const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const nm = (m: number) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
  const def = SONGS[process.argv[di + 1] as keyof typeof SONGS];
  const ids = process.argv[di + 2].split(',');
  const bars = Number(process.argv[di + 3] ?? 8);
  const c = compileSong(def);
  const spb = 60 / def.bpm;
  const barLen = def.meter * spb;
  for (const id of ids) {
    const ti = def.tracks.findIndex((t) => t.id === id);
    console.log(`${def.id}/${id}`);
    for (let b = 0; b < bars; b++) {
      const chord = c.body.chords.filter((x) => x.t >= b * barLen - 1e-6 && x.t < (b + 1) * barLen - 1e-6).map((x) => x.chord.symbol).join(' ');
      const evs = c.body.events.filter((e) => e.track === ti && e.t >= b * barLen - 0.02 && e.t < (b + 1) * barLen - 0.02);
      const groups = new Map<number, number[]>();
      for (const e of evs) {
        const k = Math.round((e.t - b * barLen) / spb * 4) / 4;
        groups.set(k, [...(groups.get(k) ?? []), e.midi]);
      }
      const txt = [...groups].map(([k, ms]) => `${k}:${ms.sort((x, y) => x - y).map(nm).join('+')}`).join(' ');
      console.log(`  ${String(b + 1).padStart(2)} [${chord}] ${txt}`);
    }
  }
  process.exit(0);
}
let problems = 0;

for (const def of Object.values(SONGS)) {
  const c = compileSong(def);
  const tl = c.body;
  const zones = [...c.needs].reduce((n, [id, set]) => n + new Set([...set].map((m) => zoneOf(id, m))).size, 0);
  console.log(
    `${def.id.padEnd(9)} ${def.bpm} bpm, ${def.form.length} sections, body ${tl.beats} beats = ${tl.duration.toFixed(1)} s` +
      (c.intro ? `, intro ${c.intro.duration.toFixed(1)} s` : '') +
      `, ${tl.events.length} notes, ${zones} zones`,
  );
  for (const w of c.warnings) {
    console.log('  WARN', w);
    problems++;
  }
  // Range checks per instrument.
  for (const [id, set] of c.needs) {
    const m = INSTRUMENTS[id];
    const lo = Math.min(...set);
    const hi = Math.max(...set);
    if (m.lo !== m.hi && (lo < m.lo - 2 || hi > m.hi + 2)) {
      console.log(`  RANGE ${id}: ${lo}..${hi} outside ${m.lo}..${m.hi}`);
      problems++;
    }
    if (verbose) console.log(`    ${id.padEnd(11)} ${lo}..${hi} (${set.size} pitches)`);
  }
  // Peak simultaneous notes per arrangement at full restoration (written lengths).
  for (const arr of ['score', 'stage'] as const) {
    const evs = tl.events.filter((e) => def.tracks[e.track].arr === arr);
    let peak = 0;
    for (const e of evs) {
      const n = evs.filter((o) => o.t <= e.t && o.t + o.dur > e.t).length;
      peak = Math.max(peak, n);
    }
    if (verbose) console.log(`    ${arr} peak written polyphony ${peak}`);
  }
  // Every track should produce notes somewhere.
  def.tracks.forEach((t, i) => {
    const n = tl.events.filter((e) => e.track === i).length + (c.intro?.events.filter((e) => e.track === i).length ?? 0);
    if (n === 0) {
      console.log(`  SILENT track ${t.id}`);
      problems++;
    }
  });
}
console.log(problems ? `${problems} problems` : 'all songs clean');
process.exit(problems ? 1 : 0);
