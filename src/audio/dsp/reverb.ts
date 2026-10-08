// Generated impulse responses: a small wooden room for the page, a large hall for the stage.

import { LN1000, OnePole, clamp, makeRng } from './util';

export interface ImpulseSpec {
  /** Seconds for the mid band to fall 60 dB. */
  rt60: number;
  /** Seconds before the late tail. */
  predelay: number;
  length: number;
  /** Early reflections: [seconds, gain, pan -1..1]. */
  early: [number, number, number][];
  /** Tail colour: cutoff at the start of the tail, and where it settles. */
  bright: number;
  dark: number;
  /** Seconds for the colour to go from bright to dark. */
  darken: number;
  /** Extra low end that lingers (gain, rt60 multiplier). */
  lowGain: number;
  lowRt: number;
  /** Seconds the tail takes to build up density. */
  build: number;
  seed: number;
}

export const ROOM: ImpulseSpec = {
  rt60: 0.55,
  predelay: 0.004,
  length: 0.95,
  early: [
    [0.0021, 0.5, -0.6],
    [0.0034, 0.42, 0.7],
    [0.0052, 0.36, -0.2],
    [0.0069, 0.3, 0.4],
    [0.0091, 0.26, -0.8],
    [0.0117, 0.22, 0.9],
    [0.0144, 0.18, -0.5],
    [0.0182, 0.15, 0.3],
  ],
  bright: 5200,
  dark: 1700,
  darken: 0.18,
  lowGain: 0.25,
  lowRt: 1.1,
  build: 0.012,
  seed: 7,
};

export const HALL: ImpulseSpec = {
  rt60: 2.5,
  predelay: 0.024,
  length: 3.4,
  early: [
    [0.0142, 0.42, -0.7],
    [0.0196, 0.38, 0.75],
    [0.0273, 0.34, -0.3],
    [0.0338, 0.3, 0.5],
    [0.0412, 0.27, -0.9],
    [0.0487, 0.25, 0.9],
    [0.0561, 0.22, -0.1],
    [0.0659, 0.19, 0.35],
    [0.0743, 0.17, -0.6],
    [0.0861, 0.14, 0.65],
  ],
  bright: 6500,
  dark: 1300,
  darken: 0.9,
  lowGain: 0.3,
  lowRt: 1.2,
  build: 0.06,
  seed: 11,
};

/** Builds a stereo impulse response, normalised to unit energy per channel. */
export function makeImpulse(spec: ImpulseSpec, sr: number): [Float32Array, Float32Array] {
  const n = Math.round(spec.length * sr);
  const chans: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const pre = Math.round(spec.predelay * sr);
  for (let c = 0; c < 2; c++) {
    const out = chans[c];
    const rnd = makeRng(spec.seed * 31 + c * 977);
    const lp = new OnePole();
    const low = new OnePole(260, sr);
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      if (((i - pre) & 63) === 0) lp.cutoff(spec.dark + (spec.bright - spec.dark) * Math.exp(-t / spec.darken), sr);
      const w = rnd() * 2 - 1;
      const build = clamp(t / spec.build, 0, 1);
      const env = Math.exp((-LN1000 * t) / spec.rt60) * build;
      const envLow = Math.exp((-LN1000 * t) / (spec.rt60 * spec.lowRt)) * build;
      out[i] = lp.process(w) * env + low.process(w) * envLow * spec.lowGain * 3;
    }
    // Early reflections: small smeared impulses, panned.
    for (const [time, g, pan] of spec.early) {
      const at = Math.round(time * sr);
      const gain = g * (c === 0 ? Math.sqrt((1 - pan) / 2) : Math.sqrt((1 + pan) / 2)) * 1.4;
      for (let k = 0; k < 6 && at + k < n; k++) out[at + k] += gain * Math.exp(-k / 1.5) * (rnd() * 0.4 + 0.8);
    }
    // Fade the very end to silence.
    const f = Math.round(0.08 * sr);
    for (let i = 0; i < f; i++) out[n - f + i] *= 1 - i / f;
  }
  // Unit energy, so the send level is the reverb level.
  for (const out of chans) {
    let e = 0;
    for (let i = 0; i < n; i++) e += out[i] * out[i];
    const g = 1 / Math.sqrt(Math.max(e, 1e-12));
    for (let i = 0; i < n; i++) out[i] *= g;
  }
  return chans;
}
