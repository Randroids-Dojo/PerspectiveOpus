// Physical and spectral models of the orchestra, rendered offline into note samples.
// Each model returns a mono buffer; sustained instruments also return a seamless loop.

import type { InstId } from '../instruments';
import {
  Attack,
  Biquad,
  LN1000,
  OnePole,
  Rotor,
  Saw,
  TAU,
  addMode,
  attackCurve,
  bakeLoop,
  clamp,
  dcBlock,
  fadeIn,
  fadeOut,
  filterInPlace,
  lerp,
  mtof,
  noiseBurst,
  polyblep,
  rms,
  scale,
  wobble,
  type Rng,
} from './util';

export interface Rendered {
  data: Float32Array;
  sr: number;
  /** Sustain loop in samples. */
  loopStart?: number;
  loopEnd?: number;
}

const sec = (s: number, sr: number): number => Math.round(s * sr);
/** Cents to frequency ratio for small offsets (cheap and accurate to a tenth of a cent). */
const cents = (c: number): number => 1 + c * 0.0005776227 + c * c * 1.668e-7;

// ------------------------------------------------------------------ keyboards

function piano(midi: number, sr: number, rnd: Rng, felt: boolean): Rendered {
  const f0 = mtof(midi);
  const dur = clamp(4.3 - (midi - 36) * 0.04, 1.7, 4.3) * (felt ? 0.85 : 1);
  const out = new Float32Array(sec(dur, sr));
  const B = clamp(0.00016 * Math.pow(2, (midi - 48) / 12.5), 0.00006, 0.02);
  const strings = midi < 33 ? 1 : midi < 45 ? 2 : 3;
  const x0 = 0.118 + rnd() * 0.012;
  // The hammer: felt is soft (few upper partials), the grand brighter.
  const fc = felt ? 480 + f0 * 1.5 : 1000 + f0 * 3.1;
  const top = Math.min(sr * 0.45, felt ? 6500 : 10500);
  const t60base = clamp(11 * Math.pow(2, -(midi - 36) / 16), 0.9, 14) * (felt ? 0.55 : 1);
  const det: number[] = [];
  for (let s = 0; s < strings; s++) det.push((s - (strings - 1) / 2) * (0.5 + rnd() * 0.9));
  for (let k = 1; k <= 80; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > top) break;
    const strike = Math.abs(Math.sin(Math.PI * k * x0));
    const amp = (strike * Math.pow(k, -0.45) * Math.exp(-Math.pow(fk / fc, 1.35))) / strings;
    if (amp < 2e-4) continue;
    const t60 = t60base / (1 + Math.pow(fk / 900, 1.2) * 1.2);
    for (let s = 0; s < strings; s++) {
      const f = fk * cents(det[s]);
      const ph = rnd() * 0.3;
      if (k <= 10) {
        // Two-stage decay: a prompt sound and a long aftersound.
        addMode(out, f, amp * 0.74, t60 * 0.5, sr, 0, ph);
        addMode(out, f, amp * 0.26, t60 * 1.7, sr, 0, ph);
      } else addMode(out, f, amp, t60 * 0.7, sr, 0, ph);
    }
  }
  // Hammer felt and key bed.
  const lp = new Biquad().lowpass(felt ? 850 : 2600, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.014, sr), (t) => Math.exp(-t / 0.0035), [lp], felt ? 0.09 : 0.04);
  addMode(out, felt ? 105 + rnd() * 15 : 140, felt ? 0.07 : 0.03, 0.06, sr);
  if (felt) {
    // The felt piano's soft mechanical breath above the note.
    const bp = new Biquad().bandpass(1800, 0.8, sr);
    noiseBurst(out, sr, rnd, 0, sec(0.05, sr), (t) => Math.exp(-t / 0.012), [bp], 0.012);
    filterInPlace(out, new Biquad().lowshelf(220, 2.5, sr));
  } else {
    filterInPlace(out, new Biquad().peaking(2600, 1.2, 1.5, sr));
  }
  fadeIn(out, sec(0.0012, sr));
  fadeOut(out, sec(0.35, sr));
  dcBlock(out, sr, 25);
  return { data: out, sr };
}

function musicbox(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const out = new Float32Array(sec(2.6, sr));
  const base = clamp(3.4 * Math.pow(523 / f0, 0.35), 1.1, 5);
  addMode(out, f0, 1, base, sr);
  addMode(out, f0 * (1.0014 + rnd() * 0.001), 0.16, base * 0.8, sr, 0, 0.4);
  const r2 = 5.9 + rnd() * 0.4;
  addMode(out, f0 * r2, 0.3, base * 0.17, sr);
  addMode(out, f0 * 15.4, 0.07, base * 0.05, sr);
  // The pin leaving the tooth, and the little wooden box.
  const hp = new Biquad().highpass(3500, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.003, sr), (t) => Math.exp(-t / 0.0006), [hp], 0.35);
  addMode(out, 420 + rnd() * 40, 0.05, 0.07, sr);
  addMode(out, 1180 + rnd() * 60, 0.03, 0.04, sr);
  fadeIn(out, sec(0.0005, sr));
  fadeOut(out, sec(0.3, sr));
  return { data: out, sr };
}

function celesta(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const n = sec(2.4, sr);
  const out = new Float32Array(n);
  const base = clamp(2.6 * Math.pow(523 / f0, 0.4), 0.9, 4);
  addMode(out, f0, 1, base, sr);
  addMode(out, f0 * 1.0009, 0.08, base * 0.9, sr, 0, 1);
  addMode(out, f0 * 2, 0.06, base * 0.4, sr);
  addMode(out, f0 * 2.76, 0.12, base * 0.2, sr);
  addMode(out, f0 * 5.4, 0.04, 0.07, sr);
  // FM sparkle on the strike.
  const m = sec(0.14, sr);
  for (let i = 0; i < m; i++) {
    const t = i / sr;
    const idx = 1.6 * Math.exp(-t / 0.02);
    out[i] += 0.1 * Math.exp(-t / 0.035) * Math.sin(TAU * f0 * 3 * t + idx * Math.sin(TAU * f0 * 4.2 * t));
  }
  const lp = new Biquad().lowpass(1200, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.006, sr), (t) => Math.exp(-t / 0.0015), [lp], 0.06);
  fadeIn(out, sec(0.0008, sr));
  fadeOut(out, sec(0.3, sr));
  return { data: out, sr };
}

function glock(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const out = new Float32Array(sec(2.6, sr));
  const base = clamp(3.2 * Math.pow(1047 / f0, 0.3), 1.5, 5);
  const ratios = [1, 2.756, 5.404, 8.933];
  const amps = [1, 0.38, 0.16, 0.07];
  const t60s = [1, 0.4, 0.18, 0.08];
  for (let k = 0; k < 4; k++) addMode(out, f0 * ratios[k] * (1 + (rnd() - 0.5) * 0.004), amps[k], base * t60s[k], sr);
  const hp = new Biquad().highpass(4000, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.002, sr), (t) => Math.exp(-t / 0.0005), [hp], 0.25);
  fadeIn(out, sec(0.0004, sr));
  fadeOut(out, sec(0.3, sr));
  return { data: out, sr };
}

function bell(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const out = new Float32Array(sec(4.6, sr));
  const ks = clamp(Math.pow(262 / f0, 0.3), 0.5, 1.6);
  const parts: [number, number, number][] = [
    [0.5, 0.3, 8],
    [1, 0.55, 5],
    [1.19, 0.42, 4.2],
    [1.5, 0.2, 2.4],
    [2.0, 0.72, 3.2],
    [2.52, 0.24, 1.9],
    [2.67, 0.2, 1.6],
    [3.01, 0.24, 1.3],
    [4.06, 0.11, 0.9],
    [5.2, 0.06, 0.6],
  ];
  for (const [r, a, t] of parts) {
    const f = f0 * r * (1 + (rnd() - 0.5) * 0.003);
    addMode(out, f, a, t * ks, sr);
    if (r === 1 || r === 2) addMode(out, f * 1.0013, a * 0.3, t * ks, sr, 0, 1.3);
  }
  const bp = new Biquad().bandpass(2500, 0.8, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.004, sr), (t) => Math.exp(-t / 0.001), [bp], 0.25);
  fadeIn(out, sec(0.0006, sr));
  fadeOut(out, sec(0.5, sr));
  return { data: out, sr };
}

// ------------------------------------------------------------------ plucked strings

interface KsOpts {
  /** Seconds for the fundamental to fall 60 dB. */
  t60: number;
  /** Loss filter pole, 0 (bright) to about 0.7 (dull). */
  pole: number;
  excite: Float32Array;
  start?: number;
  gain?: number;
}

/** Phase delay (samples) of a first-order all-pass with coefficient a at w. */
function apDelay(a: number, w: number): number {
  const num = Math.atan2(-Math.sin(w), a + Math.cos(w));
  const den = Math.atan2(-a * Math.sin(w), 1 + a * Math.cos(w));
  return -(num - den) / w;
}

/** Karplus-Strong string with an exact-pitch all-pass tuner and a one-pole loss filter. */
function ks(out: Float32Array, sr: number, f0: number, o: KsOpts): void {
  const N = sr / f0;
  const p = o.pole;
  const w0 = (TAU * f0) / sr;
  const lpDelay = Math.atan2(p * Math.sin(w0), 1 - p * Math.cos(w0)) / w0;
  const lpMag = (1 - p) / Math.sqrt(1 - 2 * p * Math.cos(w0) + p * p);
  const target = N - lpDelay;
  let L = Math.floor(target);
  let frac = target - L;
  if (frac < 0.3) {
    L -= 1;
    frac += 1;
  }
  // Solve for the all-pass coefficient whose phase delay at w0 is `frac`.
  let lo = -0.95;
  let hi = 0.99;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (apDelay(mid, w0) > frac) lo = mid;
    else hi = mid;
  }
  const a = (lo + hi) / 2;
  const g = Math.min(0.99995, Math.pow(10, -3 / (o.t60 * f0)) / lpMag);
  const line = new Float32Array(L);
  let idx = 0;
  let lp = 0;
  let apx = 0;
  let apy = 0;
  const start = o.start ?? 0;
  const gain = o.gain ?? 1;
  const ex = o.excite;
  for (let i = start; i < out.length; i++) {
    const x = line[idx];
    lp = (1 - p) * x + p * lp;
    const ap = a * lp + apx - a * apy;
    apx = lp;
    apy = ap;
    const k = i - start;
    const y = g * ap + (k < ex.length ? ex[k] : 0);
    line[idx] = y;
    idx++;
    if (idx === L) idx = 0;
    out[i] += y * gain;
  }
}

/** A pluck: smoothed noise one period long, comb-filtered for the pluck position. */
function pluck(N: number, rnd: Rng, sr: number, brightHz: number, pos: number, smooth = 0.5): Float32Array {
  const len = Math.max(4, Math.round(N));
  const P = Math.max(1, Math.round(pos * N));
  const e = new Float32Array(len + P);
  const lp = new OnePole(brightHz, sr);
  for (let i = 0; i < len; i++) {
    const w = Math.sin((Math.PI * i) / len);
    // Mix a smooth finger shape with noise.
    const shape = Math.sin((Math.PI * i) / len) * (i < len / 2 ? 1 : 0.6);
    e[i] = lp.process(rnd() * 2 - 1) * w * (1 - smooth) + shape * smooth * 0.6;
  }
  for (let i = e.length - 1; i >= P; i--) e[i] -= e[i - P];
  let m = 0;
  for (let i = 0; i < e.length; i++) m = Math.max(m, Math.abs(e[i]));
  if (m > 0) for (let i = 0; i < e.length; i++) e[i] /= m;
  return e;
}

function pizz(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const dur = midi < 48 ? 2.4 : 1.5;
  const out = new Float32Array(sec(dur, sr));
  const t60 = clamp(1.0 * Math.pow(220 / f0, 0.55), 0.3, 2.6);
  const players: [number, number, number][] = [
    [0, 0, 1],
    [0.008, 4, 0.75],
    [0.016, -5, 0.6],
  ];
  for (const [off, ct, g] of players) {
    const f = f0 * cents(ct + (rnd() - 0.5) * 2);
    ks(out, sr, f, {
      t60: t60 * (0.9 + rnd() * 0.2),
      pole: clamp(0.42 + (60 - midi) * 0.004, 0.25, 0.6),
      excite: pluck(sr / f, rnd, sr, 2400, 0.17 + rnd() * 0.04, 0.55),
      start: sec(off, sr),
      gain: g,
    });
  }
  // Wooden body: air and wood resonances, and the bridge hill.
  const body = new Float32Array(out.length);
  const b1 = new Biquad().bandpass(280, 3.5, sr);
  const b2 = new Biquad().bandpass(470, 4.5, sr);
  const b3 = new Biquad().bandpass(2700, 1.8, sr);
  for (let i = 0; i < out.length; i++) {
    const x = out[i];
    body[i] = 0.6 * x + 1.1 * b1.process(x) + 0.8 * b2.process(x) + 0.5 * b3.process(x);
  }
  filterInPlace(body, new Biquad().lowpass(5200, 0.7, sr));
  fadeIn(body, sec(0.001, sr));
  fadeOut(body, sec(0.25, sr));
  dcBlock(body, sr, 30);
  return { data: body, sr };
}

function harp(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const dur = midi < 50 ? 4 : midi < 70 ? 3.2 : 2.4;
  const out = new Float32Array(sec(dur, sr));
  ks(out, sr, f0, {
    t60: clamp(5.5 * Math.pow(110 / f0, 0.55), 0.9, 7),
    pole: clamp(0.1 + (66 - midi) * 0.006, 0.05, 0.4),
    excite: pluck(sr / f0, rnd, sr, 4200, 0.27, 0.45),
  });
  filterInPlace(out, new Biquad().peaking(230, 1.2, 4, sr));
  filterInPlace(out, new Biquad().peaking(950, 1.4, 1.5, sr));
  filterInPlace(out, new Biquad().lowpass(7500, 0.7, sr));
  fadeIn(out, sec(0.0008, sr));
  fadeOut(out, sec(0.35, sr));
  dcBlock(out, sr, 30);
  return { data: out, sr };
}

function harpsichord(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const out = new Float32Array(sec(2.2, sr));
  const t60 = clamp(3.4 * Math.pow(200 / f0, 0.45), 0.8, 6);
  for (const [ct, g] of [
    [0, 1],
    [1.3, 0.8],
  ] as const) {
    const f = f0 * cents(ct);
    ks(out, sr, f, {
      t60,
      pole: clamp(0.06 + (60 - midi) * 0.003, 0.03, 0.2),
      excite: pluck(sr / f, rnd, sr, 9000, 0.085, 0.15),
      gain: g,
    });
  }
  const hp = new Biquad().highpass(3000, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.002, sr), (t) => Math.exp(-t / 0.0005), [hp], 0.06);
  filterInPlace(out, new Biquad().peaking(1900, 1.0, 3, sr));
  filterInPlace(out, new Biquad().peaking(320, 1.0, 2, sr));
  fadeIn(out, sec(0.0005, sr));
  fadeOut(out, sec(0.3, sr));
  dcBlock(out, sr, 50);
  return { data: out, sr };
}

// ------------------------------------------------------------------ sustained (looped)

interface Loop {
  len: number;
  start: number;
  end: number;
  xf: number;
}

function loopSpec(sr: number, total = 2.9, start = 1.05, end = 2.75, xf = 0.35): Loop {
  return { len: sec(total, sr), start: sec(start, sr), end: sec(end, sr), xf: sec(xf, sr) };
}

function finishLoop(out: Float32Array, sr: number, lp: Loop): Rendered {
  bakeLoop(out, lp.start, lp.end, lp.xf);
  fadeIn(out, sec(0.002, sr));
  return { data: out.slice(0, lp.end), sr, loopStart: lp.start, loopEnd: lp.end };
}

function bowed(midi: number, sr: number, rnd: Rng, bass: boolean): Rendered {
  const f0 = mtof(midi);
  const lp = loopSpec(sr);
  const out = new Float32Array(lp.len);
  const V = bass ? 4 : 7;
  const spread = bass ? 5 : 10;
  const att = bass ? 0.16 : 0.36;
  for (let v = 0; v < V; v++) {
    const det = (v / (V - 1) - 0.5) * 2 * spread + (rnd() - 0.5) * 2.5;
    const vibRate = 4.7 + rnd() * 1.3;
    const vibDepth = bass ? 3 : 6 + rnd() * 5;
    const vibDelay = 0.2 + rnd() * 0.35;
    const vibPh = rnd() * TAU;
    const drift = wobble(rnd, 0.15, 0.5);
    const delay = rnd() * 0.035;
    const a = att * (0.8 + rnd() * 0.4);
    const amp = 0.85 + rnd() * 0.3;
    const saw = new Saw(rnd());
    const base = f0 / sr;
    const env = new Attack(a, sr);
    const s0 = sec(delay, sr);
    let inc = base;
    for (let i = s0; i < lp.len; i++) {
      // Pitch moves at control rate (every 16 samples): smooth, and far cheaper.
      if (((i - s0) & 15) === 0) {
        const t = i / sr;
        const tt = t - delay;
        const vib = vibDepth * clamp((tt - vibDelay) / 0.5, 0, 1) * Math.sin(TAU * vibRate * t + vibPh);
        inc = base * cents(det + vib + 2.5 * drift(t));
      }
      out[i] += saw.next(inc) * env.next() * amp;
    }
  }
  const env = new Attack(att, sr);
  if (bass) {
    const rot = new Rotor(f0, sr);
    for (let i = 0; i < lp.len; i++) out[i] += 1.2 * rot.next() * env.next();
  } else {
    // Bow hair on the string.
    const bp = new Biquad().bandpass(3200, 0.8, sr);
    for (let i = 0; i < lp.len; i++) out[i] += bp.process(rnd() * 2 - 1) * 0.5 * env.next();
  }
  const cut = bass ? clamp(f0 * 5 + 300, 400, 2200) : clamp(f0 * 8 + 1800, 2600, sr * 0.42);
  filterInPlace(out, new Biquad().lowpass(cut, 0.6, sr));
  filterInPlace(out, new Biquad().lowpass(Math.min(cut * 1.3, sr * 0.45), 0.7, sr));
  if (!bass) {
    filterInPlace(out, new Biquad().peaking(280, 1.0, 2.5, sr));
    filterInPlace(out, new Biquad().peaking(1300, 1.4, -3, sr));
    filterInPlace(out, new Biquad().peaking(2900, 1.6, 2, sr));
    filterInPlace(out, new Biquad().highshelf(5500, -3, sr));
  } else {
    for (let i = 0; i < lp.len; i++) out[i] = Math.tanh(out[i] * 0.35) / 0.35;
  }
  dcBlock(out, sr, 30);
  return finishLoop(out, sr, lp);
}

type Formant = [number, number, number];
const VOWELS: Record<'oo' | 'ah', { male: Formant[]; female: Formant[] }> = {
  ah: {
    male: [
      [700, 80, 1],
      [1220, 90, 0.5],
      [2600, 120, 0.25],
      [3300, 150, 0.12],
    ],
    female: [
      [850, 90, 1],
      [1350, 100, 0.45],
      [2900, 130, 0.22],
      [3800, 150, 0.1],
    ],
  },
  oo: {
    male: [
      [330, 55, 1],
      [700, 65, 0.35],
      [2500, 100, 0.07],
      [3400, 120, 0.03],
    ],
    female: [
      [410, 60, 1],
      [820, 80, 0.32],
      [2800, 120, 0.07],
      [3800, 150, 0.03],
    ],
  },
};

function choir(midi: number, sr: number, rnd: Rng, vowel: 'oo' | 'ah'): Rendered {
  const f0 = mtof(midi);
  const lp = loopSpec(sr);
  const src = new Float32Array(lp.len);
  const V = 6;
  const att = vowel === 'oo' ? 0.4 : 0.36;
  for (let v = 0; v < V; v++) {
    const det = (v / (V - 1) - 0.5) * 24 + (rnd() - 0.5) * 3;
    const vibRate = 5.0 + rnd() * 0.8;
    const vibDepth = 10 + rnd() * 8;
    const vibDelay = 0.25 + rnd() * 0.25;
    const vibPh = rnd() * TAU;
    const drift = wobble(rnd, 0.2, 0.7);
    const delay = rnd() * 0.05;
    const saw = new Saw(rnd());
    const base = f0 / sr;
    const env = new Attack(att, sr);
    const s0 = sec(delay, sr);
    let inc = base;
    for (let i = s0; i < lp.len; i++) {
      if (((i - s0) & 15) === 0) {
        const t = i / sr;
        const tt = t - delay;
        const vib = vibDepth * clamp((tt - vibDelay) / 0.6, 0, 1) * Math.sin(TAU * vibRate * t + vibPh);
        inc = base * cents(det + vib + 3 * drift(t));
      }
      // Breath rides on each voice.
      src[i] += (saw.next(inc) + (rnd() * 2 - 1) * 0.12) * env.next();
    }
  }
  const w = clamp((f0 - 180) / 220, 0, 1);
  const table = VOWELS[vowel];
  const out = new Float32Array(lp.len);
  for (let k = 0; k < 4; k++) {
    const fm = table.male[k];
    const ff = table.female[k];
    const fr = lerp(fm[0], ff[0], w);
    const bw = lerp(fm[1], ff[1], w);
    const g = lerp(fm[2], ff[2], w);
    const bp = new Biquad().bandpass(fr, fr / bw, sr);
    for (let i = 0; i < lp.len; i++) out[i] += bp.process(src[i]) * g;
  }
  // A little of the raw source keeps the fundamental present.
  const tilt = new OnePole(f0 * 1.5, sr);
  for (let i = 0; i < lp.len; i++) out[i] += tilt.process(src[i]) * 0.25;
  filterInPlace(out, new Biquad().lowpass(5000, 0.7, sr));
  dcBlock(out, sr, 80);
  return finishLoop(out, sr, lp);
}

function horn(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const lp = loopSpec(sr, 2.5, 0.75, 2.35, 0.3);
  const src = new Float32Array(lp.len);
  const env = new Float32Array(lp.len);
  for (let v = 0; v < 3; v++) {
    const det = (v - 1) * 6 + (rnd() - 0.5) * 2;
    const drift = wobble(rnd, 0.2, 0.6);
    const vibPh = rnd() * TAU;
    const delay = rnd() * 0.02;
    const saw = new Saw(rnd());
    const base = f0 / sr;
    const att = new Attack(0.1, sr);
    const over = Math.exp(-1 / (0.12 * sr));
    let bump = 0.1;
    const s0 = sec(delay, sr);
    let inc = base;
    for (let i = s0; i < lp.len; i++) {
      if (((i - s0) & 15) === 0) {
        const t = i / sr;
        const tt = t - delay;
        const scoop = -30 * Math.exp(-tt / 0.045);
        const vib = 4 * clamp((tt - 0.45) / 0.4, 0, 1) * Math.sin(TAU * 5.1 * t + vibPh);
        inc = base * cents(det + scoop + vib + 1.5 * drift(t));
      }
      const e = att.next() * (1 + bump);
      bump *= over;
      src[i] += saw.next(inc) * e;
      if (v === 0) env[i] = e;
    }
  }
  // Brassy bloom: the filter opens with the breath and settles.
  const cSus = clamp(f0 * 3.2 + 450, 500, 3600);
  const cPeak = cSus * 1.6;
  const cStart = cSus * 0.45;
  const f1 = new Biquad();
  const f2 = new Biquad();
  const out = new Float32Array(lp.len);
  for (let i = 0; i < lp.len; i++) {
    if ((i & 31) === 0) {
      const t = i / sr;
      const c = t < 0.08 ? lerp(cStart, cPeak, t / 0.08) : cSus + (cPeak - cSus) * Math.exp(-(t - 0.08) / 0.15);
      f1.lowpass(c, 0.75, sr);
      f2.lowpass(c * 1.2, 0.6, sr);
    }
    out[i] = f2.process(f1.process(src[i]));
  }
  const bp = new Biquad().bandpass(1200, 1, sr);
  for (let i = 0; i < sec(0.25, sr); i++) out[i] += bp.process(rnd() * 2 - 1) * 0.12 * Math.exp(-i / sr / 0.06);
  filterInPlace(out, new Biquad().peaking(500, 0.9, 3, sr));
  filterInPlace(out, new Biquad().highshelf(3500, -6, sr));
  dcBlock(out, sr, 40);
  return finishLoop(out, sr, lp);
}

function clarinet(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const lp = loopSpec(sr, 2.4, 0.7, 2.25, 0.3);
  const out = new Float32Array(lp.len);
  const drift = wobble(rnd, 0.2, 0.5);
  const vibPh = rnd() * TAU;
  let p = rnd();
  const base = f0 / sr;
  const bp = new Biquad().bandpass(2200, 0.9, sr);
  for (let i = 0; i < lp.len; i++) {
    const t = i / sr;
    const vib = 3 * clamp((t - 0.5) / 0.5, 0, 1) * Math.sin(TAU * 4.8 * t + vibPh);
    const dt = base * cents(vib + 1.5 * drift(t) - 8 * Math.exp(-t / 0.03));
    p += dt;
    if (p >= 1) p -= 1;
    let p2 = p + 0.5;
    if (p2 >= 1) p2 -= 1;
    const s1 = 2 * p - 1 - polyblep(p, dt);
    const s2 = 2 * p2 - 1 - polyblep(p2, dt);
    const e = attackCurve(t, 0.07);
    out[i] = ((s1 - s2) * 0.5 + s1 * 0.12 + bp.process(rnd() * 2 - 1) * 0.06) * e;
  }
  const cut = clamp(f0 * 4 + 900, 1200, 5000);
  filterInPlace(out, new Biquad().lowpass(cut, 0.7, sr));
  filterInPlace(out, new Biquad().lowpass(cut * 1.4, 0.6, sr));
  filterInPlace(out, new Biquad().peaking(1500, 1.2, 2, sr));
  dcBlock(out, sr, 40);
  return finishLoop(out, sr, lp);
}

function flute(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const lp = loopSpec(sr, 2.4, 0.75, 2.25, 0.3);
  const out = new Float32Array(lp.len);
  const hi = clamp((midi - 72) / 24, 0, 1);
  const a2 = lerp(0.24, 0.1, hi);
  const a3 = lerp(0.09, 0.03, hi);
  const vibPh = rnd() * TAU;
  const drift = wobble(rnd, 0.2, 0.5);
  const chiff = new Biquad().bandpass(Math.min(f0 * 2, sr * 0.4), 4, sr);
  const breath = new Biquad().bandpass(f0, 3, sr);
  const air = new Biquad().highpass(4000, 0.7, sr);
  let ph = 0;
  for (let i = 0; i < lp.len; i++) {
    const t = i / sr;
    const ramp = clamp((t - 0.35) / 0.4, 0, 1);
    const vs = Math.sin(TAU * 5.2 * t + vibPh);
    const c = 10 * ramp * vs + 1.5 * drift(t) - 18 * Math.exp(-t / 0.03);
    ph += (f0 * cents(c)) / sr;
    if (ph >= 1) ph -= 1;
    const e = attackCurve(t, 0.09) * (1 + 0.05 * ramp * vs);
    const x = TAU * ph;
    const tone = Math.sin(x) + a2 * Math.sin(2 * x) + a3 * Math.sin(3 * x) + 0.035 * Math.sin(4 * x);
    const n = rnd() * 2 - 1;
    out[i] = tone * e + breath.process(n) * 0.25 * e + air.process(n) * 0.012 * e + chiff.process(n) * 0.5 * Math.exp(-t / 0.025);
  }
  dcBlock(out, sr, 40);
  return finishLoop(out, sr, lp);
}

function organ(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const lp = loopSpec(sr, 2.3, 0.6, 2.15, 0.3);
  const out = new Float32Array(lp.len);
  const ranks: [number, number][] = [
    [1, 1],
    [2, 0.5],
    [3, 0.22],
    [4, 0.3],
    [6, 0.18],
    [8, 0.18],
    [12, 0.1],
  ];
  if (midi < 52) ranks.push([0.5, 0.5]);
  const harm = [1, 0.55, 0.35, 0.2, 0.12];
  const rank = new Float32Array(lp.len);
  for (const [mul, ra] of ranks) {
    const d = cents((rnd() - 0.5) * 3);
    const speak = rnd() * 0.008 + (mul < 4 ? 0.006 : 0) + (mul < 1 ? 0.02 : 0);
    const att = mul < 1 ? 0.05 : 0.02;
    const s0 = sec(speak, sr);
    rank.fill(0);
    for (let h = 1; h <= 5; h++) {
      const f = f0 * mul * h * d;
      if (f > sr * 0.42) break;
      const rot = new Rotor(f, sr, rnd() * TAU);
      const amp = ra * harm[h - 1];
      for (let i = s0; i < lp.len; i++) rank[i] += rot.next() * amp;
    }
    const env = new Attack(att, sr);
    for (let i = s0; i < lp.len; i++) out[i] += rank[i] * env.next();
  }
  // Chiff as the pipe speaks, and a breath of wind.
  const chiff = new Biquad().bandpass(Math.min(f0 * 3, sr * 0.4), 5, sr);
  const wind = new Biquad().lowpass(700, 0.7, sr);
  for (let i = 0; i < lp.len; i++) {
    const n = rnd() * 2 - 1;
    out[i] += chiff.process(n) * 0.5 * Math.exp(-i / sr / 0.03) + wind.process(n) * 0.02;
  }
  dcBlock(out, sr, 25);
  return finishLoop(out, sr, lp);
}

// ------------------------------------------------------------------ percussion

function timpani(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const out = new Float32Array(sec(3.6, sr));
  const modes: [number, number, number][] = [
    [0.82, 0.45, 0.35],
    [1, 1, 3.4],
    [1.504, 0.55, 2.4],
    [1.98, 0.36, 1.8],
    [2.44, 0.22, 1.2],
    [2.9, 0.12, 0.9],
    [3.36, 0.07, 0.6],
  ];
  for (const [r, a, t60] of modes) {
    const f = f0 * r * (1 + (rnd() - 0.5) * 0.004);
    const life = Math.min(out.length, sec(t60 * 1.7, sr));
    let ph = rnd() * 0.2;
    for (let i = 0; i < life; i++) {
      const t = i / sr;
      ph += (f * (1 + 0.012 * Math.exp(-t / 0.05))) / sr;
      out[i] += Math.sin(TAU * ph) * a * Math.exp((-LN1000 * t) / t60);
    }
  }
  const lp = new Biquad().lowpass(1600, 0.7, sr);
  const lp2 = new Biquad().lowpass(1600, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.02, sr), (t) => Math.exp(-t / 0.004), [lp, lp2], 0.6);
  addMode(out, f0 * 0.5, 0.15, 0.12, sr);
  fadeIn(out, sec(0.001, sr));
  fadeOut(out, sec(0.4, sr));
  dcBlock(out, sr, 25);
  return { data: out, sr };
}

function triangle(_midi: number, sr: number, rnd: Rng): Rendered {
  const out = new Float32Array(sec(2.8, sr));
  const fs = [1150, 2420, 3480, 4530, 5640, 6990, 8250, 9300, 10700, 12100];
  for (let k = 0; k < fs.length; k++) {
    const f = fs[k] * (1 + (rnd() - 0.5) * 0.02);
    if (f > sr * 0.46) break;
    addMode(out, f, 0.5 / (1 + k * 0.3), 3 - k * 0.2, sr, 0, rnd() * TAU);
  }
  const hp = new Biquad().highpass(5000, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.002, sr), (t) => Math.exp(-t / 0.0005), [hp], 0.4);
  fadeIn(out, sec(0.0004, sr));
  fadeOut(out, sec(0.4, sr));
  return { data: out, sr };
}

function woodblock(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const out = new Float32Array(sec(0.35, sr));
  addMode(out, f0, 1, 0.09, sr);
  addMode(out, f0 * 2.3, 0.5, 0.05, sr);
  addMode(out, f0 * 3.9, 0.2, 0.03, sr);
  const hp = new Biquad().highpass(2500, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.002, sr), (t) => Math.exp(-t / 0.0005), [hp], 0.5);
  fadeIn(out, sec(0.0003, sr));
  fadeOut(out, sec(0.05, sr));
  return { data: out, sr };
}

function tick(midi: number, sr: number, rnd: Rng): Rendered {
  const f0 = mtof(midi);
  const out = new Float32Array(sec(0.2, sr));
  addMode(out, f0, 1, 0.035, sr);
  addMode(out, f0 * 1.71, 0.6, 0.025, sr);
  addMode(out, f0 * 2.93, 0.3, 0.015, sr);
  addMode(out, f0 * 0.42, 0.4, 0.04, sr);
  const hp = new Biquad().highpass(4000, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.0015, sr), (t) => Math.exp(-t / 0.0004), [hp], 1);
  fadeIn(out, sec(0.0002, sr));
  fadeOut(out, sec(0.03, sr));
  return { data: out, sr };
}

function cymbal(_midi: number, sr: number, rnd: Rng): Rendered {
  const out = new Float32Array(sec(3.6, sr));
  const hp = new Biquad().highpass(2600, 0.6, sr);
  const lp = new Biquad().lowpass(11000, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, out.length, (t) => attackCurve(t, 0.012) * Math.exp((-LN1000 * t) / 2.6), [hp, lp], 0.5);
  for (let k = 0; k < 18; k++) {
    const f = 400 * Math.pow(22, rnd());
    if (f > sr * 0.45) continue;
    addMode(out, f, 0.04 + rnd() * 0.05, 1.2 + rnd() * 1.8, sr, sec(rnd() * 0.004, sr), rnd() * TAU);
  }
  fadeOut(out, sec(0.5, sr));
  return { data: out, sr };
}

function bassdrum(_midi: number, sr: number, rnd: Rng): Rendered {
  const out = new Float32Array(sec(2.6, sr));
  const f0 = 52;
  const modes: [number, number, number][] = [
    [1, 1, 1.6],
    [1.6, 0.4, 0.9],
    [2.2, 0.25, 0.6],
    [2.75, 0.12, 0.4],
  ];
  for (const [r, a, t] of modes) addMode(out, f0 * r, a, t, sr, 0, rnd() * 0.3);
  const lp = new Biquad().lowpass(400, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.03, sr), (t) => Math.exp(-t / 0.008), [lp], 0.6);
  fadeIn(out, sec(0.002, sr));
  fadeOut(out, sec(0.4, sr));
  dcBlock(out, sr, 20);
  return { data: out, sr };
}

function tambourine(_midi: number, sr: number, rnd: Rng): Rendered {
  const out = new Float32Array(sec(0.7, sr));
  addMode(out, 220, 0.2, 0.08, sr);
  for (const at of [0, 0.004, 0.011, 0.02]) {
    for (let k = 0; k < 6; k++) {
      const f = 5000 + rnd() * 6000;
      if (f > sr * 0.46) continue;
      addMode(out, f, 0.05 + rnd() * 0.06, 0.12 + rnd() * 0.15, sr, sec(at, sr), rnd() * TAU);
    }
  }
  const hp = new Biquad().highpass(7000, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.04, sr), (t) => Math.exp(-t / 0.01), [hp], 0.3);
  fadeIn(out, sec(0.0004, sr));
  fadeOut(out, sec(0.1, sr));
  return { data: out, sr };
}

// ------------------------------------------------------------------ registry

type RenderFn = (midi: number, sr: number, rnd: Rng) => Rendered;

const RENDER: Record<InstId, RenderFn> = {
  feltPiano: (m, sr, r) => piano(m, sr, r, true),
  grand: (m, sr, r) => piano(m, sr, r, false),
  musicbox,
  celesta,
  glock,
  pizz,
  harp,
  harpsichord,
  strings: (m, sr, r) => bowed(m, sr, r, false),
  bass: (m, sr, r) => bowed(m, sr, r, true),
  choir: (m, sr, r) => choir(m, sr, r, 'oo'),
  choirAh: (m, sr, r) => choir(m, sr, r, 'ah'),
  horn,
  clarinet,
  flute,
  organ,
  timpani,
  bell,
  triangle,
  woodblock,
  tick,
  cymbal,
  bassdrum,
  tambourine,
};

/**
 * Renders one note and normalises it: sustained notes by the loudness of their
 * loop, struck and plucked notes by their first 300 ms. Mix levels are applied
 * at playback, so every zone of an instrument is even.
 */
export function renderInstrument(id: InstId, midi: number, sr: number, rnd: Rng): Rendered {
  const r = RENDER[id](midi, sr, rnd);
  const d = r.data;
  const level = r.loopStart !== undefined ? rms(d, r.loopStart, r.loopEnd) : rms(d, 0, sec(0.3, sr));
  if (level > 1e-6) scale(d, 0.2 / level);
  // Keep peaks sane (the attack of a pluck can be tall).
  let p = 0;
  for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
  if (p > 0.98) scale(d, 0.98 / p);
  return r;
}
