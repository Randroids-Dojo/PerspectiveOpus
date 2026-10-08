// Renders each pitched instrument at several pitches (in Node, no browser) and
// measures the fundamental, loudness, brightness and loop seams of the samples.
//   npx tsx scripts/audio-tuning.ts
import { INSTRUMENTS, type InstId } from '../src/audio/instruments';
import { runJob } from '../src/audio/dsp/render';

/** Fundamental by normalised autocorrelation with parabolic interpolation. */
function f0(x: Float32Array, sr: number, from: number, expect: number): number {
  const n = Math.min(x.length - from, Math.round(sr * 0.25));
  const seg = x.subarray(from, from + n);
  const lagLo = Math.max(2, Math.floor(sr / (expect * 1.5)));
  const lagHi = Math.min(n - 2, Math.ceil(sr / (expect / 1.5)));
  let best = lagLo;
  let bestV = -Infinity;
  const r = new Float64Array(lagHi + 2);
  for (let lag = lagLo - 1; lag <= lagHi + 1; lag++) {
    let s = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i + lag < n; i++) {
      s += seg[i] * seg[i + lag];
      e1 += seg[i] * seg[i];
      e2 += seg[i + lag] * seg[i + lag];
    }
    r[lag] = s / Math.sqrt(e1 * e2 + 1e-12);
  }
  for (let lag = lagLo; lag <= lagHi; lag++)
    if (r[lag] > bestV && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
      bestV = r[lag];
      best = lag;
    }
  const a = r[best - 1];
  const b = r[best];
  const c = r[best + 1];
  const d = (a - c) / (2 * (a - 2 * b + c) || 1);
  return sr / (best + d);
}

/** The strongest spectral peak within 80 cents of `expect` (Hann-windowed DFT, 1 cent steps). */
function peakNear(x: Float32Array, sr: number, from: number, expect: number): number {
  const n = Math.min(x.length - from, Math.round(sr * 0.6));
  let best = expect;
  let bestP = -1;
  for (let c = -80; c <= 80; c++) {
    const f = expect * Math.pow(2, c / 1200);
    const w = (2 * Math.PI * f) / sr;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      re += x[from + i] * h * Math.cos(w * i);
      im -= x[from + i] * h * Math.sin(w * i);
    }
    const p = re * re + im * im;
    if (p > bestP) {
      bestP = p;
      best = f;
    }
  }
  return best;
}

const INHARMONIC = new Set(['glock', 'bell', 'timpani', 'celesta', 'musicbox']);

/** Spectral centroid via zero-crossing proxy (cheap brightness hint). */
function zcr(x: Float32Array, sr: number, from: number): number {
  let z = 0;
  const n = Math.min(x.length - from, Math.round(sr * 0.2));
  for (let i = from + 1; i < from + n; i++) if (x[i - 1] < 0 !== x[i] < 0) z++;
  return (z / 2) * (sr / n);
}

const pitched: InstId[] = ['feltPiano', 'grand', 'musicbox', 'celesta', 'glock', 'pizz', 'harp', 'harpsichord', 'strings', 'bass', 'choir', 'choirAh', 'horn', 'clarinet', 'flute', 'organ', 'timpani', 'bell'];
let worst = 0;
let failures = 0;
for (const id of pitched) {
  const m = INSTRUMENTS[id];
  const picks = [m.lo + 4, Math.round((m.lo + m.hi) / 2), m.hi - 6].map((p) => m.step * Math.round(p / m.step));
  const row: string[] = [];
  for (const midi of picks) {
    const r = runJob({ kind: 'inst', id, midi });
    const expect = 440 * Math.pow(2, (midi - 69) / 12);
    // Timpani and bells are judged on their principal (prime) partial.
    const from = Math.round(r.sr * (r.loopStart ?? 0.12));
    const got = INHARMONIC.has(id) ? peakNear(r.data, r.sr, from, expect) : f0(r.data, r.sr, from, expect);
    const cents = 1200 * Math.log2(got / expect);
    // Octave errors from autocorrelation on bells and tines are not tuning errors.
    const oct = Math.round(cents / 1200);
    const off = cents - oct * 1200;
    worst = Math.max(worst, Math.abs(off));
    const bad = Math.abs(off) > 12;
    if (bad) failures++;
    let pk = 0;
    for (const v of r.data) pk = Math.max(pk, Math.abs(v));
    let seam = '';
    if (r.loopStart !== undefined && r.loopEnd !== undefined) {
      const ls = Math.round(r.loopStart * r.sr);
      const le = r.data.length;
      const jump = Math.abs(r.data[le - 1] - r.data[ls]);
      let typ = 0;
      for (let i = ls + 1; i < le; i++) typ = Math.max(typ, Math.abs(r.data[i] - r.data[i - 1]));
      seam = ` seam ${(jump / typ).toFixed(2)}`;
    }
    row.push(`${midi}: ${off >= 0 ? '+' : ''}${off.toFixed(1)}c${oct ? ` (${oct > 0 ? '+' : ''}${oct} oct)` : ''} pk ${pk.toFixed(2)} zc ${Math.round(zcr(r.data, r.sr, from))}${seam} ${r.ms.toFixed(0)}ms${bad ? ' MISTUNED' : ''}`);
  }
  console.log(`${id.padEnd(12)} ${row.join(' | ')}`);
}
console.log(`worst deviation ${worst.toFixed(1)} cents, ${failures} mistuned`);
process.exit(failures ? 1 : 0);
