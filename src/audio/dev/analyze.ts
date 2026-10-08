// Measurements on rendered audio: peaks, true peak, loudness (BS.1770 style),
// gaps, clicks and DC. Used by the offline harness.

export interface Analysis {
  seconds: number;
  peakDb: number;
  truePeakDb: number;
  clipped: number;
  rmsDb: number;
  lufs: number;
  shortTermMax: number;
  shortTermMin: number;
  /** Longest run (s) of 100 ms windows quieter than -55 dBFS, after the first second. */
  longestGap: number;
  gapCount: number;
  dc: number;
  /** Largest sample-to-sample step anywhere, and the 99.99th percentile, for click spotting. */
  maxStep: number;
  step9999: number;
  /** Share of energy (dB) in bands: <150, 150-500, 500-2k, 2k-6k, >6k Hz. */
  bands: number[];
  /** Left/right correlation (1 mono, 0 wide, below 0 phasey). */
  correlation: number;
}

/** Energy per band, via cascaded RBJ filters. */
function bandShares(chans: Float32Array[], sr: number): number[] {
  const edges = [150, 500, 2000, 6000];
  const biq = (type: 'lp' | 'hp', f: number) => {
    const w = (2 * Math.PI * f) / sr;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * 0.7071);
    const a0 = 1 + al;
    const b = type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    return [b.map((x) => x / a0), [1, (-2 * c) / a0, (1 - al) / a0]] as [number[], number[]];
  };
  const energy = (x: Float32Array, fs: [number[], number[]][]) => {
    let y = x;
    for (const f of fs) y = filter(y, f);
    let e = 0;
    for (let i = 0; i < y.length; i += 2) e += y[i] * y[i];
    return e;
  };
  const out = [0, 0, 0, 0, 0];
  for (const x of chans) {
    out[0] += energy(x, [biq('lp', edges[0]), biq('lp', edges[0])]);
    for (let k = 1; k < 4; k++) out[k] += energy(x, [biq('hp', edges[k - 1]), biq('hp', edges[k - 1]), biq('lp', edges[k]), biq('lp', edges[k])]);
    out[4] += energy(x, [biq('hp', edges[3]), biq('hp', edges[3])]);
  }
  const total = out.reduce((s, v) => s + v, 0) || 1;
  return out.map((v) => +(10 * Math.log10(Math.max(v / total, 1e-9))).toFixed(1));
}

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -200);

/** K-weighting (BS.1770) biquads for a given rate. */
function kWeight(sr: number): [number[], number[]][] {
  // Pre-filter (high shelf) and RLB high pass, designed by the standard's analog prototypes.
  const shelf = (() => {
    const f0 = 1681.974450955533;
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / sr);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    return [
      [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
      [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
    ] as [number[], number[]];
  })();
  const hp = (() => {
    const f0 = 38.13547087602444;
    const Q = 0.5003270373238773;
    const K = Math.tan((Math.PI * f0) / sr);
    const a0 = 1 + K / Q + K * K;
    return [
      [1, -2, 1],
      [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
    ] as [number[], number[]];
  })();
  return [shelf, hp];
}

function filter(x: Float32Array, [b, a]: [number[], number[]]): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

export function analyze(buf: AudioBuffer, skipStart = 1): Analysis {
  const sr = buf.sampleRate;
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const n = buf.length;
  let peak = 0;
  let tp = 0;
  let clipped = 0;
  let sum = 0;
  let dcSum = 0;
  let maxStep = 0;
  const steps: number[] = [];
  for (const x of chans) {
    for (let i = 0; i < n; i++) {
      const v = x[i];
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      sum += v * v;
      dcSum += v;
      if (i > 0) {
        const s = Math.abs(v - x[i - 1]);
        if (s > maxStep) maxStep = s;
        if ((i & 7) === 0) steps.push(s);
      }
      // True peak: 4x Catmull-Rom between samples.
      if (i > 0 && i + 2 < n) {
        const p0 = x[i - 1],
          p1 = v,
          p2 = x[i + 1],
          p3 = x[i + 2];
        for (const t of [0.25, 0.5, 0.75]) {
          const y =
            0.5 *
            (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
          const ay = Math.abs(y);
          if (ay > tp) tp = ay;
        }
      }
    }
  }
  tp = Math.max(tp, peak);
  steps.sort((a, b) => a - b);
  // Loudness.
  const kw: Float32Array[] = chans.map((x) => {
    let y: Float32Array = x;
    for (const f of kWeight(sr)) y = filter(y, f);
    return y;
  });
  const block = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  const blocks: number[] = [];
  for (let s = 0; s + block <= n; s += hop) {
    let e = 0;
    for (const y of kw) for (let i = s; i < s + block; i++) e += y[i] * y[i];
    blocks.push(e / block);
  }
  const lk = (e: number) => -0.691 + 10 * Math.log10(Math.max(e, 1e-12));
  const abs = blocks.filter((e) => lk(e) > -70);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const rel = lk(mean(abs)) - 10;
  const gated = abs.filter((e) => lk(e) > rel);
  const lufs = lk(mean(gated));
  // Short-term (3 s) loudness range.
  let stMax = -200;
  let stMin = 200;
  const per = Math.round(3 / 0.1);
  for (let i = 0; i + per <= blocks.length; i += 5) {
    const v = lk(mean(blocks.slice(i, i + per)));
    stMax = Math.max(stMax, v);
    stMin = Math.min(stMin, v);
  }
  // Gaps.
  const win = Math.round(0.1 * sr);
  let run = 0;
  let longest = 0;
  let gaps = 0;
  for (let s = Math.round(skipStart * sr); s + win <= n; s += win) {
    let e = 0;
    for (const x of chans) for (let i = s; i < s + win; i++) e += x[i] * x[i];
    const r = Math.sqrt(e / (win * chans.length));
    if (db(r) < -55) {
      run++;
      if (run === 1) gaps++;
      longest = Math.max(longest, run * 0.1);
    } else run = 0;
  }
  let lr = 0;
  let ll = 0;
  let rr = 0;
  if (chans.length > 1)
    for (let i = 0; i < n; i++) {
      lr += chans[0][i] * chans[1][i];
      ll += chans[0][i] * chans[0][i];
      rr += chans[1][i] * chans[1][i];
    }
  return {
    bands: bandShares(chans, sr),
    correlation: chans.length > 1 ? lr / Math.sqrt(ll * rr + 1e-12) : 1,
    seconds: n / sr,
    peakDb: db(peak),
    truePeakDb: db(tp),
    clipped,
    rmsDb: db(Math.sqrt(sum / (n * chans.length))),
    lufs,
    shortTermMax: stMax,
    shortTermMin: stMin,
    longestGap: longest,
    gapCount: gaps,
    dc: dcSum / (n * chans.length),
    maxStep,
    step9999: steps[Math.floor(steps.length * 0.9999)] ?? 0,
  };
}

/** Loudness and click measures either side of a seam at `at` seconds. */
export function seam(
  buf: AudioBuffer,
  at: number,
  barLen = 0,
): { beforeDb: number; afterDb: number; jumpDb: number; seamStep: number; typicalStep: number; barStep: number } {
  const sr = buf.sampleRate;
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const rmsOf = (a: number, b: number) => {
    let e = 0;
    let k = 0;
    for (const x of chans)
      for (let i = Math.max(0, Math.round(a * sr)); i < Math.min(x.length, Math.round(b * sr)); i++) {
        e += x[i] * x[i];
        k++;
      }
    return db(Math.sqrt(e / Math.max(1, k)));
  };
  const before = rmsOf(at - 2, at);
  const after = rmsOf(at, at + 2);
  // Largest step within 30 ms of the seam, against the median of 30 ms windows elsewhere.
  const w = Math.round(0.03 * sr);
  const maxIn = (s: number) => {
    let m = 0;
    for (const x of chans) for (let i = Math.max(1, s); i < Math.min(x.length, s + w); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
    return m;
  };
  const c = Math.round(at * sr);
  const seamStep = Math.max(maxIn(c - w), maxIn(c));
  const others: number[] = [];
  for (let s = w; s + w < buf.length; s += w * 3) if (Math.abs(s - c) > 4 * w) others.push(maxIn(s));
  others.sort((a, b) => a - b);
  // The same measure at the other bar lines in the render: onsets there are the fair comparison.
  const bars: number[] = [];
  if (barLen > 0)
    for (let t = at - barLen; t > 1; t -= barLen) bars.push(Math.max(maxIn(Math.round(t * sr) - w), maxIn(Math.round(t * sr))));
  for (let t = at + barLen; barLen > 0 && t < buf.length / sr - 0.1; t += barLen) bars.push(Math.max(maxIn(Math.round(t * sr) - w), maxIn(Math.round(t * sr))));
  bars.sort((a, b) => a - b);
  return {
    beforeDb: before,
    afterDb: after,
    jumpDb: after - before,
    seamStep,
    typicalStep: others[Math.floor(others.length / 2)] ?? 0,
    barStep: bars.length ? bars[bars.length - 1] : 0,
  };
}

/** 16-bit PCM WAV (TPDF dither), as base64. */
export function wavBase64(buf: AudioBuffer): string {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  data.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buf.sampleRate, true);
  data.setUint32(28, buf.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const d = (Math.random() - Math.random()) / 32768;
      const v = Math.max(-1, Math.min(1, chans[c][i] + d));
      data.setInt16(o, Math.round(v * 32767), true);
      o += 2;
    }
  const bytes = new Uint8Array(data.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
