// Small DSP toolkit for offline sample rendering. Pure functions over Float32Array,
// no Web Audio and no DOM, so it runs in a worker, on the main thread or in Node.

export type Rng = () => number;

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const TAU = Math.PI * 2;
/** ln(1000): the decay constant for a 60 dB fall. */
export const LN1000 = 6.907755278982137;

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** Transposed direct form II biquad with RBJ cookbook designs. */
export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  z1 = 0;
  z2 = 0;

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset(): this {
    this.z1 = this.z2 = 0;
    return this;
  }

  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): this {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  lowpass(f: number, q: number, sr: number): this {
    const w = TAU * clamp(f, 10, sr * 0.49) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
  }

  highpass(f: number, q: number, sr: number): this {
    const w = TAU * clamp(f, 10, sr * 0.49) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }

  /** Band pass with 0 dB peak gain. */
  bandpass(f: number, q: number, sr: number): this {
    const w = TAU * clamp(f, 10, sr * 0.49) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return this.set(al, 0, -al, 1 + al, -2 * c, 1 - al);
  }

  peaking(f: number, q: number, db: number, sr: number): this {
    const A = Math.pow(10, db / 40);
    const w = TAU * clamp(f, 10, sr * 0.49) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return this.set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
  }

  lowshelf(f: number, db: number, sr: number): this {
    const A = Math.pow(10, db / 40);
    const w = TAU * clamp(f, 10, sr * 0.49) / sr;
    const c = Math.cos(w);
    const al = (Math.sin(w) / 2) * Math.SQRT2;
    const sq = 2 * Math.sqrt(A) * al;
    return this.set(
      A * (A + 1 - (A - 1) * c + sq),
      2 * A * (A - 1 - (A + 1) * c),
      A * (A + 1 - (A - 1) * c - sq),
      A + 1 + (A - 1) * c + sq,
      -2 * (A - 1 + (A + 1) * c),
      A + 1 + (A - 1) * c - sq,
    );
  }

  highshelf(f: number, db: number, sr: number): this {
    const A = Math.pow(10, db / 40);
    const w = TAU * clamp(f, 10, sr * 0.49) / sr;
    const c = Math.cos(w);
    const al = (Math.sin(w) / 2) * Math.SQRT2;
    const sq = 2 * Math.sqrt(A) * al;
    return this.set(
      A * (A + 1 + (A - 1) * c + sq),
      -2 * A * (A - 1 + (A + 1) * c),
      A * (A + 1 + (A - 1) * c - sq),
      A + 1 - (A - 1) * c + sq,
      2 * (A - 1 - (A + 1) * c),
      A + 1 - (A - 1) * c - sq,
    );
  }
}

/** One-pole low pass. */
export class OnePole {
  a = 0;
  b = 1;
  y = 0;
  constructor(f?: number, sr?: number) {
    if (f && sr) this.cutoff(f, sr);
  }
  cutoff(f: number, sr: number): this {
    const x = Math.exp((-TAU * clamp(f, 1, sr * 0.49)) / sr);
    this.a = x;
    this.b = 1 - x;
    return this;
  }
  process(x: number): number {
    this.y = this.b * x + this.a * this.y;
    return this.y;
  }
}

/** Runs a buffer through a filter in place. */
export function filterInPlace(buf: Float32Array, f: { process(x: number): number }, from = 0, to = buf.length): void {
  for (let i = from; i < to; i++) buf[i] = f.process(buf[i]);
}

export function polyblep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** Band-limited sawtooth (PolyBLEP). Call `next` with the phase increment (cycles per sample). */
export class Saw {
  constructor(public phase = 0) {}
  next(dt: number): number {
    let p = this.phase + dt;
    if (p >= 1) p -= 1;
    this.phase = p;
    return 2 * p - 1 - polyblep(p, dt);
  }
}

/** Adds a damped sinusoid A r^n sin(w n + phase) starting at `start`. Cheap recursive form. */
export function addMode(
  out: Float32Array,
  freq: number,
  amp: number,
  t60: number,
  sr: number,
  start = 0,
  phase = 0,
): void {
  if (freq <= 0 || freq >= sr * 0.48 || amp === 0) return;
  const w = (TAU * freq) / sr;
  const r = Math.exp(-LN1000 / (Math.max(t60, 0.001) * sr));
  const c = 2 * r * Math.cos(w);
  const r2 = r * r;
  // Run until the mode has fallen 100 dB below its start (or the buffer ends).
  const life = Math.ceil(Math.log(1e-5) / Math.log(r));
  const end = Math.min(out.length, start + Math.max(2, life));
  let y2 = amp * Math.sin(phase);
  let y1 = amp * r * Math.sin(w + phase);
  if (start < end) out[start] += y2;
  if (start + 1 < end) out[start + 1] += y1;
  for (let i = start + 2; i < end; i++) {
    const y = c * y1 - r2 * y2;
    out[i] += y;
    y2 = y1;
    y1 = y;
  }
}

/** Static oscillator by complex rotation (no sin per sample). */
export class Rotor {
  private re: number;
  private im: number;
  private cr: number;
  private ci: number;
  private n = 0;
  constructor(freq: number, sr: number, phase = 0) {
    const w = (TAU * freq) / sr;
    this.cr = Math.cos(w);
    this.ci = Math.sin(w);
    this.re = Math.cos(phase);
    this.im = Math.sin(phase);
  }
  next(): number {
    const v = this.im;
    const re = this.re * this.cr - this.im * this.ci;
    const im = this.re * this.ci + this.im * this.cr;
    // Renormalise now and then so rounding never lets the amplitude drift.
    if (++this.n === 4096) {
      this.n = 0;
      const m = 1 / Math.hypot(re, im);
      this.re = re * m;
      this.im = im * m;
    } else {
      this.re = re;
      this.im = im;
    }
    return v;
  }
}

/** Pink noise (Paul Kellet's economy filter). */
export class Pink {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  constructor(private rnd: Rng) {}
  next(): number {
    const w = this.rnd() * 2 - 1;
    this.b0 = 0.99765 * this.b0 + w * 0.099046;
    this.b1 = 0.963 * this.b1 + w * 0.2965164;
    this.b2 = 0.57 * this.b2 + w * 1.0526913;
    return (this.b0 + this.b1 + this.b2 + w * 0.1848) * 0.2;
  }
}

/** Smooth random wobble in [-1, 1]: a sum of slow sines with random rates and phases. */
export function wobble(rnd: Rng, rateLo: number, rateHi: number): (t: number) => number {
  const r1 = lerp(rateLo, rateHi, rnd());
  const r2 = lerp(rateLo, rateHi, rnd()) * 1.37;
  const p1 = rnd() * TAU;
  const p2 = rnd() * TAU;
  return (t: number) => 0.6 * Math.sin(TAU * r1 * t + p1) + 0.4 * Math.sin(TAU * r2 * t + p2);
}

export function fadeIn(buf: Float32Array, n: number, at = 0): void {
  n = Math.min(n, buf.length - at);
  for (let i = 0; i < n; i++) buf[at + i] *= i / n;
}

export function fadeOut(buf: Float32Array, n: number): void {
  n = Math.min(n, buf.length);
  const s = buf.length - n;
  for (let i = 0; i < n; i++) {
    const x = 1 - i / n;
    buf[s + i] *= x * x;
  }
}

export function rms(buf: Float32Array, from = 0, to = buf.length): number {
  from = Math.max(0, from | 0);
  to = Math.min(buf.length, to | 0);
  let s = 0;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

export function peak(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p;
}

export function scale(buf: Float32Array, g: number): void {
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
}

/** Removes DC with a gentle high pass. */
export function dcBlock(buf: Float32Array, sr: number, f = 20): void {
  const hp = new Biquad().highpass(f, 0.707, sr);
  filterInPlace(buf, hp);
}

/**
 * Makes a sustain loop seamless: the end of the loop is crossfaded (equal power)
 * into the audio that precedes the loop start, so jumping from loopEnd back to
 * loopStart continues the waveform.
 */
export function bakeLoop(buf: Float32Array, loopStart: number, loopEnd: number, xfade: number): void {
  const n = Math.min(xfade, loopStart, loopEnd - loopStart);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const a = Math.cos(t * Math.PI * 0.5);
    const b = Math.sin(t * Math.PI * 0.5);
    const e = loopEnd - n + i;
    const s = loopStart - n + i;
    buf[e] = buf[e] * a + buf[s] * b;
  }
}

/** The attack curve below, computed incrementally (one multiply per sample). */
export class Attack {
  private e = 1;
  private k: number;
  constructor(time: number, sr: number) {
    this.k = Math.exp(-3 / (Math.max(time, 1e-4) * sr));
  }
  next(): number {
    const v = 1 - this.e;
    this.e *= this.k;
    return v;
  }
}

/** Exponential-ish attack curve: 0 at t=0, about 0.95 at t=time. */
export function attackCurve(t: number, time: number): number {
  if (t <= 0) return 0;
  return 1 - Math.exp((-3 * t) / Math.max(time, 1e-4));
}

/** Writes a noise burst shaped by an envelope function of time (seconds). */
export function noiseBurst(
  out: Float32Array,
  sr: number,
  rnd: Rng,
  start: number,
  len: number,
  env: (t: number) => number,
  filters: { process(x: number): number }[] = [],
  gain = 1,
): void {
  const end = Math.min(out.length, start + len);
  for (let i = Math.max(0, start); i < end; i++) {
    let x = rnd() * 2 - 1;
    for (const f of filters) x = f.process(x);
    out[i] += x * env((i - start) / sr) * gain;
  }
}

/** Soft saturation. */
export const softClip = (x: number): number => Math.tanh(x);
