// One-shot sound effects, rendered offline. Page versions are paper, pen and ink:
// dry, close and small. Stage versions are wood, stone, cloth and air, and get
// the hall at playback.

import {
  Biquad,
  LN1000,
  OnePole,
  Pink,
  TAU,
  addMode,
  bakeLoop,
  clamp,
  dcBlock,
  fadeIn,
  fadeOut,
  lerp,
  noiseBurst,
  peak,
  scale,
  type Rng,
} from './util';

export const STEP_MATS = ['stone', 'brick', 'wood', 'brass', 'dark', 'crystal', 'leaf', 'marble'] as const;
export type StepMat = (typeof STEP_MATS)[number];

const sec = (s: number, sr: number): number => Math.round(s * sr);
const buf = (s: number, sr: number): Float32Array => new Float32Array(sec(s, sr));
const jit = (rnd: Rng, x: number, amt: number): number => x * (1 + (rnd() * 2 - 1) * amt);

/** Short crackles: many tiny noise grains, for grit, leaves and paper. */
function crackle(
  out: Float32Array,
  sr: number,
  rnd: Rng,
  start: number,
  span: number,
  count: number,
  lo: number,
  hi: number,
  amp: number,
): void {
  for (let k = 0; k < count; k++) {
    const at = start + sec(rnd() * span, sr);
    const bp = new Biquad().bandpass(lerp(lo, hi, rnd()), 1.5, sr);
    const a = amp * (0.4 + rnd() * 0.6) * (1 - (at - start) / Math.max(1, sec(span, sr)) * 0.6);
    noiseBurst(out, sr, rnd, at, sec(0.001 + rnd() * 0.002, sr), (t) => Math.exp(-t / 0.0006), [bp], a);
  }
}

/** A sine whose pitch glides exponentially from f1 to f2. */
function chirp(out: Float32Array, sr: number, start: number, dur: number, f1: number, f2: number, amp: number, decay: number): void {
  const n = sec(dur, sr);
  let ph = 0;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / sr;
    const f = f1 * Math.pow(f2 / f1, Math.min(1, t / dur));
    ph += f / sr;
    const env = Math.min(1, t / 0.0015) * Math.exp(-t / decay);
    out[start + i] += Math.sin(TAU * ph) * amp * env;
  }
}

/** Noise through a band pass whose centre glides; env is a function of 0..1 progress. */
function sweep(
  out: Float32Array,
  sr: number,
  rnd: Rng,
  start: number,
  dur: number,
  f1: number,
  f2: number,
  q: number,
  env: (u: number) => number,
  amp: number,
  grain = 0,
): void {
  const n = sec(dur, sr);
  const bp = new Biquad();
  let g = 1;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const u = i / n;
    if ((i & 15) === 0) bp.bandpass(f1 * Math.pow(f2 / f1, u), q, sr);
    if (grain > 0 && (i & 63) === 0) g = 1 - grain + grain * rnd() * 2;
    out[start + i] += bp.process(rnd() * 2 - 1) * env(u) * amp * g;
  }
}

// ------------------------------------------------------------------ footsteps

function stepStage(mat: StepMat, sr: number, rnd: Rng): Float32Array {
  const out = buf(0.4, sr);
  const thump = (f: number, a: number, t: number) => addMode(out, jit(rnd, f, 0.08), a, t, sr);
  const hit = (cut: number, a: number, tau: number) => {
    const lp = new Biquad().lowpass(jit(rnd, cut, 0.1), 0.7, sr);
    noiseBurst(out, sr, rnd, 0, sec(tau * 8, sr), (t) => Math.exp(-t / tau), [lp], a);
  };
  const click = (f: number, a: number) => {
    const hp = new Biquad().highpass(f, 0.7, sr);
    noiseBurst(out, sr, rnd, 0, sec(0.003, sr), (t) => Math.exp(-t / 0.0006), [hp], a);
  };
  switch (mat) {
    case 'stone': {
      hit(2200, 0.6, 0.006);
      const bp = new Biquad().bandpass(jit(rnd, 900, 0.1), 1.5, sr);
      noiseBurst(out, sr, rnd, 0, sec(0.06, sr), (t) => Math.exp(-t / 0.012), [bp], 0.4);
      thump(110, 0.35, 0.05);
      crackle(out, sr, rnd, 0, 0.04, 5, 3000, 6000, 0.1);
      break;
    }
    case 'brick': {
      hit(1800, 0.55, 0.007);
      const bp = new Biquad().bandpass(jit(rnd, 700, 0.1), 1.3, sr);
      noiseBurst(out, sr, rnd, 0, sec(0.07, sr), (t) => Math.exp(-t / 0.014), [bp], 0.4);
      thump(95, 0.35, 0.05);
      crackle(out, sr, rnd, 0, 0.05, 11, 2000, 5000, 0.13);
      break;
    }
    case 'marble': {
      click(2500, 0.5);
      hit(3000, 0.3, 0.004);
      addMode(out, jit(rnd, 1850, 0.05), 0.08, 0.12, sr);
      addMode(out, jit(rnd, 3100, 0.05), 0.05, 0.08, sr);
      thump(120, 0.25, 0.04);
      break;
    }
    case 'wood': {
      hit(3000, 0.35, 0.002);
      thump(210, 0.35, 0.09);
      thump(470, 0.25, 0.07);
      thump(880, 0.12, 0.05);
      thump(1450, 0.06, 0.03);
      break;
    }
    case 'brass': {
      thump(140, 0.3, 0.06);
      click(3000, 0.2);
      for (const [f, a, t] of [
        [620, 0.08, 0.35],
        [1590, 0.07, 0.3],
        [2730, 0.05, 0.25],
        [4120, 0.035, 0.2],
      ])
        addMode(out, jit(rnd, f, 0.04), a, t, sr, 0, rnd() * TAU);
      break;
    }
    case 'crystal': {
      thump(130, 0.25, 0.05);
      click(5000, 0.15);
      for (const [f, a, t] of [
        [2300, 0.07, 0.35],
        [3870, 0.05, 0.28],
        [6150, 0.03, 0.2],
      ])
        addMode(out, jit(rnd, f, 0.06), a, t, sr, 0, rnd() * TAU);
      break;
    }
    case 'leaf': {
      thump(90, 0.2, 0.05);
      crackle(out, sr, rnd, 0, 0.09, 14 + Math.floor(rnd() * 10), 2500, 6500, 0.35);
      const bp = new Biquad().bandpass(3500, 0.8, sr);
      noiseBurst(out, sr, rnd, 0, sec(0.1, sr), (t) => Math.min(1, t / 0.005) * Math.exp(-t / 0.03), [bp], 0.12);
      break;
    }
    case 'dark': {
      hit(500, 0.5, 0.015);
      thump(80, 0.3, 0.06);
      break;
    }
  }
  return out;
}

function stepPage(mat: StepMat, sr: number, rnd: Rng): Float32Array {
  const out = buf(0.16, sr);
  // The nib touching the paper, the paper giving under it, a little scratch as it lifts.
  const hp = new Biquad().highpass(4000, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.003, sr), (t) => Math.exp(-t / 0.0008), [hp], 0.25);
  const patCut: Record<StepMat, number> = {
    wood: 900,
    stone: 1400,
    brick: 1200,
    marble: 2000,
    brass: 1600,
    crystal: 2400,
    leaf: 1800,
    dark: 700,
  };
  const lp = new Biquad().lowpass(jit(rnd, patCut[mat], 0.1), 0.8, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.05, sr), (t) => Math.exp(-t / 0.008), [lp], 0.4);
  sweep(out, sr, rnd, sec(0.006, sr), 0.025, 3000, jit(rnd, 4800, 0.1), 2, (u) => Math.sin(Math.PI * u), 0.06, 0.6);
  switch (mat) {
    case 'wood':
      addMode(out, jit(rnd, 380, 0.08), 0.06, 0.04, sr);
      break;
    case 'brass':
      addMode(out, jit(rnd, 2200, 0.05), 0.03, 0.12, sr);
      break;
    case 'crystal':
      addMode(out, jit(rnd, 3300, 0.05), 0.03, 0.15, sr);
      break;
    case 'marble':
      addMode(out, jit(rnd, 1800, 0.05), 0.03, 0.05, sr);
      break;
    case 'leaf':
      crackle(out, sr, rnd, 0, 0.04, 5, 3000, 6000, 0.15);
      break;
    case 'brick':
      crackle(out, sr, rnd, 0, 0.02, 3, 2500, 5000, 0.08);
      break;
    default:
      break;
  }
  return out;
}

// ------------------------------------------------------------------ movement

function jumpPage(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.14, sr);
  sweep(out, sr, rnd, 0, 0.08, jit(rnd, 1800, 0.1), jit(rnd, 5200, 0.1), 2.2, (u) => Math.min(1, u * 12) * Math.exp(-u * 3), 0.5, 0.5);
  const hp = new Biquad().highpass(3500, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.002, sr), (t) => Math.exp(-t / 0.0005), [hp], 0.2);
  return out;
}

function jumpStage(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.24, sr);
  const n = sec(0.2, sr);
  const bp = new Biquad();
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if ((i & 15) === 0) bp.bandpass(380 * Math.pow(1300 / 380, u), 1.0, sr);
    const flutter = 1 - 0.3 * (0.5 + 0.5 * Math.sin(TAU * 35 * (i / sr)));
    out[i] += bp.process(rnd() * 2 - 1) * Math.sin(Math.PI * u) * flutter * 0.8;
  }
  return out;
}

function landPage(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.2, sr);
  const lp = new Biquad().lowpass(600, 0.8, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.12, sr), (t) => Math.exp(-t / 0.02), [lp], 0.6);
  const bp = new Biquad().bandpass(jit(rnd, 300, 0.1), 4, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.12, sr), (t) => Math.exp(-t / 0.03), [bp], 0.5);
  const sq = new Biquad().bandpass(1800, 3, sr);
  noiseBurst(out, sr, rnd, sec(0.004, sr), sec(0.06, sr), (t) => Math.min(1, t / 0.01) * Math.exp(-t / 0.025), [sq], 0.12);
  return out;
}

function landStage(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.3, sr);
  chirp(out, sr, 0, 0.2, jit(rnd, 85, 0.1), 48, 0.7, 0.06);
  const lp = new Biquad().lowpass(900, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.06, sr), (t) => Math.exp(-t / 0.012), [lp], 0.4);
  const bp = new Biquad().bandpass(2000, 0.7, sr);
  noiseBurst(out, sr, rnd, sec(0.01, sr), sec(0.1, sr), (t) => Math.sin(Math.PI * Math.min(1, t / 0.1)), [bp], 0.08);
  return out;
}

function bonk(page: boolean, sr: number, rnd: Rng): Float32Array {
  const out = buf(0.25, sr);
  const modes = page
    ? [
        [820, 0.4, 0.05],
        [1730, 0.2, 0.03],
      ]
    : [
        [390, 0.5, 0.12],
        [930, 0.3, 0.08],
        [1620, 0.12, 0.05],
      ];
  for (const [f, a, t] of modes) addMode(out, jit(rnd, f, 0.04), a, t, sr);
  const hp = new Biquad().highpass(3000, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.002, sr), (t) => Math.exp(-t / 0.0005), [hp], 0.3);
  chirp(out, sr, 0, 0.09, page ? 700 : 520, page ? 480 : 360, 0.15, 0.04);
  return out;
}

// ------------------------------------------------------------------ death and return

function splat(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.5, sr);
  // The drop of ink hitting the page: a wet burst that darkens fast.
  const n = sec(0.12, sr);
  const lp = new Biquad();
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 15) === 0) lp.lowpass(5000 * Math.pow(300 / 5000, Math.min(1, t / 0.06)), 0.9, sr);
    out[i] += lp.process(rnd() * 2 - 1) * Math.exp(-t / 0.03) * 0.8;
  }
  chirp(out, sr, 0, 0.06, 180, 70, 0.5, 0.03);
  // Droplets landing round it.
  const drops = 6 + Math.floor(rnd() * 4);
  for (let k = 0; k < drops; k++) {
    const at = sec(0.04 + rnd() * 0.32, sr);
    const f1 = 1300 + rnd() * 700;
    chirp(out, sr, at, 0.02, f1, f1 * 0.5, 0.18 * (1 - k / drops) + 0.05, 0.008);
  }
  fadeOut(out, sec(0.05, sr));
  return out;
}

function poof(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.6, sr);
  const n = sec(0.3, sr);
  const lp = new Biquad();
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 15) === 0) lp.lowpass(3000 * Math.pow(200 / 3000, t / 0.3), 0.7, sr);
    out[i] += lp.process(rnd() * 2 - 1) * Math.exp(-t / 0.06) * 0.6;
  }
  chirp(out, sr, 0, 0.2, 120, 60, 0.6, 0.06);
  sweep(out, sr, rnd, sec(0.03, sr), 0.45, 1500, 400, 1.1, (u) => Math.sin(Math.PI * u) * (1 - u), 0.25);
  return out;
}

function gather(page: boolean, sr: number, rnd: Rng): Float32Array {
  const out = buf(0.62, sr);
  const dur = 0.5;
  if (page) {
    sweep(out, sr, rnd, 0, dur, 400, 3000, 1.8, (u) => u * u * u, 0.6, 0.4);
    chirp(out, sr, sec(dur - 0.01, sr), 0.025, 600, 1400, 0.2, 0.02);
  } else {
    sweep(out, sr, rnd, 0, dur, 300, 2500, 1.0, (u) => Math.pow(u, 2.5), 0.7);
  }
  // Stop sharply but without a click.
  const s = sec(dur, sr);
  for (let i = s; i < Math.min(out.length, s + sec(0.015, sr)); i++) out[i] *= 1 - (i - s) / sec(0.015, sr);
  for (let i = s + sec(0.015, sr); i < out.length; i++) out[i] *= page ? 1 : 0;
  return out;
}

// ------------------------------------------------------------------ switching

function pageturn(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.55, sr);
  // Flaps slowing down as the page settles, then the page landing.
  const bp = new Biquad().bandpass(jit(rnd, 2500, 0.15), 0.8, sr);
  const n = sec(0.42, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const rate = lerp(32, 11, t / 0.42);
    ph += rate / sr;
    const flap = Math.pow(Math.max(0, Math.sin(TAU * ph)), 6);
    const env = Math.min(1, t / 0.03) * (1 - t / 0.42) ** 0.5;
    out[i] += bp.process(rnd() * 2 - 1) * (0.25 + flap) * env * 0.5;
  }
  const lp = new Biquad().lowpass(450, 0.7, sr);
  noiseBurst(out, sr, rnd, sec(0.4, sr), sec(0.1, sr), (t) => Math.exp(-t / 0.02), [lp], 0.5);
  return out;
}

function penstroke(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.22, sr);
  const hp = new Biquad().highpass(3500, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.002, sr), (t) => Math.exp(-t / 0.0005), [hp], 0.3);
  sweep(out, sr, rnd, sec(0.004, sr), 0.17, jit(rnd, 1800, 0.1), jit(rnd, 4500, 0.1), 2.5, (u) => Math.min(1, u * 8) * Math.min(1, (1 - u) * 5), 0.5, 0.7);
  return out;
}

function airswell(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.75, sr);
  sweep(out, sr, rnd, 0, 0.6, 250, 2800, 1.2, (u) => u * u, 0.8);
  const s = sec(0.6, sr);
  const lp = new Biquad().lowpass(3000, 0.6, sr);
  const n = sec(0.15, sr);
  for (let i = 0; i < n; i++) out[s + i] += lp.process(rnd() * 2 - 1) * 0.35 * (1 - i / n) ** 2;
  return out;
}

function cymswell(sr: number, rnd: Rng): Float32Array {
  const out = buf(1.05, sr);
  const hp = new Biquad().highpass(2500, 0.6, sr);
  const lp = new Biquad().lowpass(10000, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(1.0, sr), (t) => Math.pow(t / 1.0, 3), [hp, lp], 0.6);
  for (let k = 0; k < 10; k++) {
    const f = 500 * Math.pow(16, rnd());
    const n = sec(1.0, sr);
    let ph = rnd();
    for (let i = 0; i < n; i++) {
      ph += f / sr;
      out[i] += Math.sin(TAU * ph) * Math.pow(i / n, 3) * 0.03;
    }
  }
  const s = sec(1.0, sr);
  for (let i = s; i < out.length; i++) out[i] *= Math.max(0, 1 - (i - s) / sec(0.04, sr));
  return out;
}

// ------------------------------------------------------------------ things in the world

function penline(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.09, sr);
  sweep(out, sr, rnd, 0, 0.06, jit(rnd, 3300, 0.1), jit(rnd, 3800, 0.1), 3, (u) => Math.min(1, u * 10) * Math.min(1, (1 - u) * 6), 0.5, 0.8);
  return out;
}

function clank(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.8, sr);
  for (const [f, a, t] of [
    [310, 0.4, 0.4],
    [820, 0.25, 0.35],
    [1460, 0.18, 0.3],
    [2390, 0.1, 0.2],
    [3700, 0.05, 0.15],
  ])
    addMode(out, jit(rnd, f, 0.03), a, t, sr, 0, rnd() * TAU);
  const lp = new Biquad().lowpass(2000, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.01, sr), (t) => Math.exp(-t / 0.002), [lp], 0.4);
  return out;
}

function metronome(tock: boolean, sr: number, rnd: Rng): Float32Array {
  const out = buf(0.15, sr);
  const k = tock ? 0.78 : 1;
  for (const [f, a, t] of [
    [1850, 0.5, 0.04],
    [3100, 0.3, 0.03],
    [5200, 0.12, 0.02],
    [620, 0.35, 0.05],
  ])
    addMode(out, f * k, a, t, sr, 0, rnd() * 0.2);
  const hp = new Biquad().highpass(3000, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.002, sr), (t) => Math.exp(-t / 0.0004), [hp], 0.8);
  return out;
}

function keythock(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.15, sr);
  const lp = new Biquad().lowpass(1200, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.03, sr), (t) => Math.exp(-t / 0.005), [lp], 0.6);
  addMode(out, jit(rnd, 170, 0.05), 0.3, 0.05, sr);
  const bp = new Biquad().bandpass(600, 2, sr);
  noiseBurst(out, sr, rnd, sec(0.002, sr), sec(0.04, sr), (t) => Math.exp(-t / 0.01), [bp], 0.15);
  return out;
}

/** Timpani with the pedal pressed as it is struck: the pitch leaps up. Rendered on A2. */
function timpgliss(sr: number, rnd: Rng): Float32Array {
  const out = buf(2.2, sr);
  const f0 = 110;
  const modes: [number, number, number][] = [
    [1, 1, 2.2],
    [1.504, 0.5, 1.6],
    [1.98, 0.32, 1.2],
    [2.44, 0.18, 0.8],
    [0.82, 0.4, 0.3],
  ];
  for (const [r, a, t60] of modes) {
    let ph = rnd();
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const bend = Math.pow(2, (4 * (1 - Math.exp(-t / 0.13))) / 12);
      ph += (f0 * r * bend) / sr;
      out[i] += Math.sin(TAU * ph) * a * Math.exp((-LN1000 * t) / t60);
    }
  }
  const lp = new Biquad().lowpass(1500, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.02, sr), (t) => Math.exp(-t / 0.004), [lp], 0.6);
  fadeIn(out, sec(0.001, sr));
  fadeOut(out, sec(0.3, sr));
  dcBlock(out, sr, 25);
  return out;
}

/** A small hand drum for the page, rendered with its root on F#3. */
function handdrum(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.8, sr);
  const f0 = 185;
  const modes: [number, number, number][] = [
    [1, 1, 0.4],
    [1.59, 0.5, 0.22],
    [2.14, 0.3, 0.15],
    [2.65, 0.15, 0.1],
  ];
  for (const [r, a, t60] of modes) {
    let ph = rnd();
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const bend = Math.pow(2, (2 * (1 - Math.exp(-t / 0.06))) / 12);
      ph += (f0 * r * bend) / sr;
      out[i] += Math.sin(TAU * ph) * a * Math.exp((-LN1000 * t) / t60);
    }
  }
  const bp = new Biquad().bandpass(1500, 1, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.015, sr), (t) => Math.exp(-t / 0.003), [bp], 0.5);
  fadeIn(out, sec(0.0005, sr));
  fadeOut(out, sec(0.1, sr));
  return out;
}

function tap(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.09, sr);
  const hp = new Biquad().highpass(3000, 0.7, sr);
  noiseBurst(out, sr, rnd, 0, sec(0.003, sr), (t) => Math.exp(-t / 0.0007), [hp], 0.5);
  addMode(out, 1100 + rnd() * 300, 0.15, 0.03, sr);
  addMode(out, 2600 + rnd() * 200, 0.05, 0.02, sr);
  return out;
}

// ------------------------------------------------------------------ ambience

function bird(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.9, sr);
  const syll = 2 + Math.floor(rnd() * 5);
  let at = 0;
  const kind = Math.floor(rnd() * 3);
  for (let s = 0; s < syll; s++) {
    const d = 0.03 + rnd() * 0.06;
    const f1 = 2800 + rnd() * 2200;
    const f2 = kind === 0 ? f1 * (0.6 + rnd() * 0.2) : kind === 1 ? f1 * (1.15 + rnd() * 0.3) : f1;
    const trill = kind === 2 ? 30 + rnd() * 30 : 0;
    const depth = 200 + rnd() * 300;
    const n = sec(d, sr);
    let ph = 0;
    const st = sec(at, sr);
    for (let i = 0; i < n && st + i < out.length; i++) {
      const u = i / n;
      const f = lerp(f1, f2, u) + (trill ? depth * Math.sin(TAU * trill * (i / sr)) : 0);
      ph += f / sr;
      const e = Math.sin(Math.PI * u) ** 2;
      out[st + i] += (Math.sin(TAU * ph) + 0.1 * Math.sin(2 * TAU * ph)) * e * 0.5;
    }
    at += d + 0.02 + rnd() * 0.05;
    if (at > 0.8) break;
  }
  return out;
}

function cricket(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.14, sr);
  const f = 4400 + rnd() * 800;
  const pulses = 3 + Math.floor(rnd() * 2);
  for (let p = 0; p < pulses; p++) {
    const st = sec(p * 0.026, sr);
    const n = sec(0.014, sr);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      out[st + i] += Math.sin((TAU * f * (st + i)) / sr) * Math.sin(Math.PI * u) ** 2 * 0.5;
    }
  }
  return out;
}

function plip(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.15, sr);
  const f1 = 600 + rnd() * 400;
  chirp(out, sr, 0, 0.025, f1, f1 * (2 + rnd() * 0.6), 0.5, 0.03);
  addMode(out, f1 * 2.4, 0.05, 0.05, sr);
  return out;
}

function rustle(sr: number, rnd: Rng): Float32Array {
  const len = 0.35 + rnd() * 0.35;
  const out = buf(len + 0.05, sr);
  crackle(out, sr, rnd, 0, len, 40 + Math.floor(rnd() * 40), 2000, 7000, 0.25);
  const bp = new Biquad().bandpass(4000, 0.6, sr);
  noiseBurst(out, sr, rnd, 0, sec(len, sr), (t) => Math.sin((Math.PI * t) / len), [bp], 0.06);
  return out;
}

function creak(sr: number, rnd: Rng): Float32Array {
  const out = buf(0.6, sr);
  const n = sec(0.5, sr);
  const r1 = new Biquad().bandpass(jit(rnd, 700, 0.15), 8, sr);
  const r2 = new Biquad().bandpass(jit(rnd, 1500, 0.15), 6, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const rate = lerp(25, 45, u) * (1 + 0.1 * Math.sin(TAU * 3 * u));
    ph += rate / sr;
    let x = 0;
    if (ph >= 1) {
      ph -= 1;
      x = 1;
    }
    const e = Math.sin(Math.PI * u);
    out[i] = (r1.process(x) + 0.6 * r2.process(x)) * e;
  }
  return out;
}

function clankFar(sr: number, rnd: Rng): Float32Array {
  const out = buf(1.3, sr);
  const base = 180 + rnd() * 160;
  for (const [r, a, t] of [
    [1, 0.4, 1.0],
    [2.76, 0.25, 0.8],
    [4.1, 0.15, 0.6],
    [5.9, 0.08, 0.4],
  ])
    addMode(out, base * r, a, t, sr, 0, rnd() * TAU);
  const lp = new Biquad().lowpass(1200, 0.7, sr);
  for (let i = 0; i < out.length; i++) out[i] = lp.process(out[i]);
  return out;
}

/** A seamless noise loop for beds (wind, water, room tone). */
function noiseLoop(brown: boolean, sr: number, rnd: Rng): Float32Array {
  const n = sec(4, sr);
  const xf = sec(0.25, sr);
  const out = new Float32Array(n);
  const pink = new Pink(rnd);
  const lp = new OnePole(120, sr);
  for (let i = 0; i < n; i++) out[i] = brown ? lp.process(rnd() * 2 - 1) * 8 : pink.next();
  bakeLoop(out, xf, n, xf);
  return out;
}

// ------------------------------------------------------------------ registry

export interface SfxDef {
  variants: number;
  sr: number;
  render: (v: number, sr: number, rnd: Rng) => Float32Array;
  /** Seconds where the loop starts (beds only); the loop runs to the end. */
  loop?: number;
  /** Peak to normalise to. */
  peak?: number;
}

const SR = 44100;

export const SFX_DEFS: Record<string, SfxDef> = {
  'jump.page': { variants: 3, sr: SR, render: (_v, sr, r) => jumpPage(sr, r) },
  'jump.stage': { variants: 3, sr: SR, render: (_v, sr, r) => jumpStage(sr, r) },
  'land.page': { variants: 3, sr: SR, render: (_v, sr, r) => landPage(sr, r) },
  'land.stage': { variants: 3, sr: SR, render: (_v, sr, r) => landStage(sr, r) },
  'bonk.page': { variants: 2, sr: SR, render: (_v, sr, r) => bonk(true, sr, r) },
  'bonk.stage': { variants: 2, sr: SR, render: (_v, sr, r) => bonk(false, sr, r) },
  splat: { variants: 3, sr: SR, render: (_v, sr, r) => splat(sr, r) },
  poof: { variants: 2, sr: SR, render: (_v, sr, r) => poof(sr, r) },
  'gather.page': { variants: 2, sr: SR, render: (_v, sr, r) => gather(true, sr, r) },
  'gather.stage': { variants: 2, sr: SR, render: (_v, sr, r) => gather(false, sr, r) },
  pageturn: { variants: 3, sr: SR, render: (_v, sr, r) => pageturn(sr, r) },
  penstroke: { variants: 3, sr: SR, render: (_v, sr, r) => penstroke(sr, r) },
  airswell: { variants: 2, sr: SR, render: (_v, sr, r) => airswell(sr, r) },
  cymswell: { variants: 1, sr: SR, render: (_v, sr, r) => cymswell(sr, r) },
  penline: { variants: 4, sr: SR, render: (_v, sr, r) => penline(sr, r) },
  clank: { variants: 2, sr: SR, render: (_v, sr, r) => clank(sr, r) },
  metronome: { variants: 2, sr: SR, render: (v, sr, r) => metronome(v === 1, sr, r) },
  keythock: { variants: 3, sr: SR, render: (_v, sr, r) => keythock(sr, r) },
  timpgliss: { variants: 1, sr: 32000, render: (_v, sr, r) => timpgliss(sr, r) },
  handdrum: { variants: 2, sr: SR, render: (_v, sr, r) => handdrum(sr, r) },
  tap: { variants: 4, sr: SR, render: (_v, sr, r) => tap(sr, r) },
  bird: { variants: 8, sr: SR, render: (_v, sr, r) => bird(sr, r) },
  cricket: { variants: 3, sr: SR, render: (_v, sr, r) => cricket(sr, r) },
  plip: { variants: 4, sr: SR, render: (_v, sr, r) => plip(sr, r) },
  rustle: { variants: 4, sr: SR, render: (_v, sr, r) => rustle(sr, r) },
  creak: { variants: 3, sr: SR, render: (_v, sr, r) => creak(sr, r) },
  'clank.far': { variants: 3, sr: 32000, render: (_v, sr, r) => clankFar(sr, r) },
  'noise.pink': { variants: 1, sr: 32000, render: (_v, sr, r) => noiseLoop(false, sr, r), loop: 0.25, peak: 0.5 },
  'noise.brown': { variants: 1, sr: 22050, render: (_v, sr, r) => noiseLoop(true, sr, r), loop: 0.25, peak: 0.5 },
};
for (const m of STEP_MATS) {
  SFX_DEFS[`step.page.${m}`] = { variants: 4, sr: SR, render: (_v, sr, r) => stepPage(m, sr, r) };
  SFX_DEFS[`step.stage.${m}`] = { variants: 4, sr: SR, render: (_v, sr, r) => stepStage(m, sr, r) };
}

export function renderSfx(id: string, variant: number, rnd: Rng): { data: Float32Array; sr: number; loopStart?: number } {
  const def = SFX_DEFS[id];
  if (!def) throw new Error(`unknown sfx ${id}`);
  const data = def.render(variant, def.sr, rnd);
  if (!def.loop) {
    dcBlock(data, def.sr, 20);
    fadeIn(data, Math.round(def.sr * 0.0003));
  }
  const p = peak(data);
  if (p > 1e-6) scale(data, (def.peak ?? 0.8) / p);
  return { data, sr: def.sr, loopStart: def.loop };
}

export const clampVariant = (id: string, v: number): number => clamp(v, 0, (SFX_DEFS[id]?.variants ?? 1) - 1);
