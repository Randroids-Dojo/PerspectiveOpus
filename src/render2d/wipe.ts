import { css, mix } from './color';
import { hash, hs, TAU } from './rand';
import type { Tones } from './tones';

/**
 * The switch: the page dissolves from the player outwards like a drop of ink
 * eating through paper. The hole's edge is an organic blot with a dark wet rim,
 * fingers of ink running along the fibres, satellite droplets ahead of the front
 * and torn paper hairs poking into the opening. The shape is a pure function of
 * the wipe amount, the origin and a slow time term, so the switch can reverse at
 * any instant without a jump.
 */

const N = 256;
const XS = new Float32Array(N);
const YS = new Float32Array(N);
const RS = new Float32Array(N);

const LO = [
  { f: 3, a: 0.42, p: 0.7, w: 0.35 },
  { f: 5, a: 0.3, p: 2.1, w: -0.25 },
  { f: 8, a: 0.18, p: 4.4, w: 0.5 },
  { f: 2, a: 0.1, p: 1.3, w: 0.15 },
];
const HI = [
  { f: 17, a: 0.45, p: 0.3 },
  { f: 29, a: 0.3, p: 5.1 },
  { f: 47, a: 0.17, p: 2.6 },
  { f: 71, a: 0.08, p: 1.9 },
];
const FINGERS = Array.from({ length: 9 }, (_, i) => ({
  a: hash(i, 1) * TAU,
  w: 0.04 + hash(i, 2) * 0.07,
  s: 0.45 + hash(i, 3) * 0.8,
}));
const SATS = Array.from({ length: 34 }, (_, i) => ({
  a: hash(i, 11) * TAU,
  d: 0.12 + Math.pow(hash(i, 12), 0.8) * 1.15,
  s: hash(i, 13),
  hole: hash(i, 14) < 0.55,
}));
const HAIRS = Array.from({ length: 34 }, (_, i) => ({
  a: hash(i, 21) * TAU,
  len: 0.4 + hash(i, 22) * 0.6,
  bend: hs(i, 23),
  tilt: hs(i, 24) * 0.6,
}));
const TENDRILS = Array.from({ length: 26 }, (_, i) => ({
  a: hash(i, 31) * TAU,
  len: 0.3 + hash(i, 32) * 0.7,
  wig: hs(i, 33),
}));

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Radius of the blot edge at angle `a`. */
function edgeR(a: number, R0: number, lo: number, hi: number, fing: number, scal: number, time: number): number {
  let l = 0;
  for (const o of LO) l += o.a * Math.sin(o.f * a + o.p + o.w * time);
  let h = 0;
  for (const o of HI) h += o.a * Math.sin(o.f * a + o.p + time * 0.4);
  // Crenellated lobes, the way a drying blot scallops at its edge.
  const sc = Math.pow(Math.abs(Math.sin(a * 19 + 0.6 + time * 0.15)), 0.6) * 0.6 + Math.pow(Math.abs(Math.sin(a * 31 + 2.2)), 0.6) * 0.4;
  let f = 0;
  for (const g of FINGERS) {
    let d = a - g.a;
    d -= Math.round(d / TAU) * TAU;
    const x = d / g.w;
    if (x > -3 && x < 3) f += g.s * Math.exp(-x * x);
  }
  return R0 * (1 + lo * l) + hi * h + fing * f + scal * (sc - 0.6);
}

function contour(ctx: CanvasRenderingContext2D, ox: number, oy: number, add: number, addVar: number): void {
  ctx.moveTo(ox + Math.cos(0) * (RS[0] + add), oy + Math.sin(0) * (RS[0] + add));
  for (let i = 1; i < N; i++) {
    const a = (i / N) * TAU;
    const extra = add * (1 + addVar * Math.sin(a * 7 + 1.3) * 0.5 + addVar * Math.sin(a * 13 + 0.4) * 0.3);
    const r = Math.max(0, RS[i] + extra);
    ctx.lineTo(ox + Math.cos(a) * r, oy + Math.sin(a) * r);
  }
  ctx.closePath();
}

export function drawWipe(ctx: CanvasRenderingContext2D, W: number, H: number, ox: number, oy: number, wipe: number, time: number, t: Tones, dpr: number): void {
  if (wipe <= 0) return;
  const far = Math.max(Math.hypot(ox, oy), Math.hypot(W - ox, oy), Math.hypot(ox, H - oy), Math.hypot(W - ox, H - oy));
  const halo = 30 * dpr;
  const rimW = 9 * dpr;
  const hiMax = 9 * dpr;
  const fingMax = 26 * dpr;
  const scalMax = 9 * dpr;
  const loEnd = 0.035;
  const R0max = (far + halo + rimW * 1.8 + hiMax + scalMax + 4 * dpr) / (1 - loEnd);
  const e = Math.pow(wipe, 1.45);
  const R0 = R0max * e;
  const k = smooth(R0 / far);
  const lo = 0.17 + (loEnd - 0.17) * k;
  const hi = Math.min(R0 * 0.09, hiMax);
  // Fingers reach out early and fold back in as the hole covers the page.
  const fing = Math.min(R0 * 0.28, fingMax) * (1 - 0.85 * smooth((wipe - 0.35) / 0.45));
  const scal = Math.min(R0 * 0.05, scalMax);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const r = edgeR(a, R0, lo, hi, fing, scal, time);
    RS[i] = r;
    XS[i] = ox + Math.cos(a) * r;
    YS[i] = oy + Math.sin(a) * r;
  }
  const ink = t.ink;
  const wet = t.inv ? mix(t.paper, t.ink, 0.25) : mix(t.shade, t.paper, 0.15);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Wet paper just beyond the rim, then the rim itself: ink bleeding outwards from a
  // dark wet edge, built up in thin layers so the bleed has no bands.
  ctx.globalCompositeOperation = 'source-atop';
  ctx.beginPath();
  contour(ctx, ox, oy, halo, 0.6);
  ctx.fillStyle = css(wet, t.inv ? 0.08 : 0.05);
  ctx.fill();
  const LAYERS = 12;
  for (let i = 0; i < LAYERS; i++) {
    const u = i / (LAYERS - 1);
    const off = 2.3 - 2.0 * u;
    const al = u < 0.85 ? 0.035 + 0.11 * u * u : u < 0.95 ? 0.45 : 0.92;
    ctx.beginPath();
    contour(ctx, ox, oy, rimW * off, 0.3);
    ctx.fillStyle = css(u > 0.9 ? mix(ink, [0, 0, 0], t.inv ? 0 : 0.45) : ink, al);
    ctx.fill();
  }

  // Ink running out along the fibres from the rim.
  ctx.beginPath();
  for (const td of TENDRILS) {
    const i = Math.floor(((td.a / TAU) * N) % N);
    const a = (i / N) * TAU;
    const r0 = RS[i] + rimW * 0.4;
    const len = (6 + td.len * 22) * dpr * (0.4 + 0.6 * (1 - k * 0.5));
    const c = Math.cos(a);
    const s = Math.sin(a);
    const midR = r0 + len * 0.5;
    const wig = td.wig * len * 0.25;
    ctx.moveTo(ox + c * r0, oy + s * r0);
    ctx.quadraticCurveTo(ox + c * midR - s * wig, oy + s * midR + c * wig, ox + c * (r0 + len), oy + s * (r0 + len));
  }
  ctx.strokeStyle = css(ink, 0.55);
  ctx.lineWidth = Math.max(0.7, 0.9 * dpr);
  ctx.lineCap = 'round';
  ctx.stroke();

  // Satellite droplets ahead of the front: dark specks that open into tiny holes.
  const holes: [number, number, number][] = [];
  ctx.beginPath();
  for (const sat of SATS) {
    const D = sat.d * far;
    const lead = 0.22 * D + 36 * dpr;
    const g = smooth((R0 - (D - lead)) / (lead * 0.6));
    if (g <= 0) continue;
    const ia = Math.floor(((sat.a / TAU) * N) % N);
    if (RS[ia] > D + 12 * dpr) continue;
    const size = (1.5 + sat.s * 7.5) * dpr * (0.6 + 0.4 * Math.min(1, D / (far * 0.5))) * g;
    const x = ox + Math.cos(sat.a) * D;
    const y = oy + Math.sin(sat.a) * D;
    const n = 10;
    for (let j = 0; j <= n; j++) {
      const a = (j / n) * TAU;
      const rr = size * (1 + 0.28 * Math.sin(a * 3 + sat.s * 9) + 0.12 * Math.sin(a * 5 + sat.s * 4));
      if (j === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    if (sat.hole && size > 3.5 * dpr) holes.push([x, y, size * 0.55]);
  }
  ctx.fillStyle = css(ink, 0.9);
  ctx.fill();

  // Cut the hole and the satellites' little holes.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(XS[0], YS[0]);
  for (let i = 1; i < N; i++) ctx.lineTo(XS[i], YS[i]);
  ctx.closePath();
  for (const [x, y, r] of holes) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
  ctx.fillStyle = '#000';
  ctx.fill();

  // The inside of the blot keeps a thin film of ink that pools at the edge (a coffee ring),
  // laid over the stage and fading inwards.
  ctx.globalCompositeOperation = 'source-over';
  const film = Math.min(16 * dpr, R0 * 0.12) * (1 - 0.6 * smooth((wipe - 0.7) / 0.3));
  if (film > 1) {
    for (let pass = 0; pass < 3; pass++) {
      const inner = film * (1 - pass * 0.33);
      ctx.beginPath();
      ctx.moveTo(XS[0], YS[0]);
      for (let i = 1; i < N; i++) ctx.lineTo(XS[i], YS[i]);
      ctx.closePath();
      ctx.moveTo(ox + Math.max(0, RS[0] - inner), oy);
      for (let i = N - 1; i >= 0; i--) {
        const a = (i / N) * TAU;
        const r = Math.max(0, RS[i] - inner * (1 + 0.35 * Math.sin(a * 9 + 0.7)));
        ctx.lineTo(ox + Math.cos(a) * r, oy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fillStyle = css(ink, pass === 2 ? 0.55 : 0.2);
      ctx.fill();
    }
  }

  // Paper hairs left standing across the edge, over the stage.
  ctx.beginPath();
  for (const hr of HAIRS) {
    const i = Math.floor(((hr.a / TAU) * N) % N);
    const a = (i / N) * TAU;
    const r = RS[i];
    if (r < 6 * dpr) continue;
    const len = (2.5 + hr.len * 6) * dpr;
    const c = Math.cos(a + hr.tilt * 0.08);
    const s = Math.sin(a + hr.tilt * 0.08);
    const r0 = r + 2 * dpr;
    const r1 = r - len;
    ctx.moveTo(ox + c * r0, oy + s * r0);
    ctx.quadraticCurveTo(ox + c * (r0 + r1) * 0.5 - s * hr.bend * len * 0.4, oy + s * (r0 + r1) * 0.5 + c * hr.bend * len * 0.4, ox + c * r1, oy + s * r1);
  }
  ctx.strokeStyle = css(mix(t.paper, t.paperShade, 0.35), 0.55);
  ctx.lineWidth = Math.max(0.5, 0.6 * dpr);
  ctx.stroke();

  // A fine spray of ink thrown just inside the opening.
  if (wipe < 0.85) {
    const fade = 1 - wipe / 0.85;
    ctx.beginPath();
    for (let j = 0; j < 40; j++) {
      const a = hash(j, 41) * TAU;
      const i = Math.floor(((a / TAU) * N) % N);
      const r = RS[i] - (4 + hash(j, 42) * 26) * dpr;
      if (r < 4 * dpr) continue;
      const s = (0.6 + hash(j, 43) * 1.6) * dpr;
      const x = ox + Math.cos(a) * r;
      const y = oy + Math.sin(a) * r;
      ctx.moveTo(x + s, y);
      ctx.arc(x, y, s, 0, TAU);
    }
    ctx.fillStyle = css(ink, 0.75 * fade);
    ctx.fill();
  }
  ctx.restore();
}
