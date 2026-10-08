import { hash, hs, TAU } from './rand';

/**
 * Ink primitives. Everything here works in whatever space the caller draws in
 * (device pixels for the world, local units for characters); sizes are given in
 * that space. Wobble is smooth noise along the stroke, seeded per stroke, and the
 * `boil` index nudges the phases so a line redrawn on the next boil frame shifts
 * a little without ever jumping.
 */

/** Scratch buffers reused by every stroke to avoid allocation. */
const A: number[] = [];
const B: number[] = [];

export interface LineOpts {
  /** Wobble amplitude. */
  amp: number;
  seed: number;
  boil: number;
  /** Distance between samples. */
  step?: number;
  /** How far the stroke may overshoot (positive) or stop short of (negative) its ends. */
  over?: number;
  /** A gentle bow across the whole stroke, as a fraction of amp. */
  bow?: number;
  /** Wavelength scale for the wobble (use the stroke scale so lines look alike at any dpr). */
  wl?: number;
}

/** Samples a wobbly straight stroke into `out` as [x, y, x, y, ...]. */
export function linePts(out: number[], x0: number, y0: number, x1: number, y1: number, o: LineOpts): number[] {
  out.length = 0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const s = o.seed;
  const b = o.boil;
  const amp = o.amp;
  const over = o.over ?? 0;
  const s0 = -over * (0.25 + 0.75 * hash(s, 11)) + hs(s, b, 12) * amp * 0.5;
  const s1 = len + over * (0.25 + 0.75 * hash(s, 13)) + hs(s, b, 14) * amp * 0.5;
  const step = o.step ?? 7;
  const n = Math.max(2, Math.min(400, Math.ceil((s1 - s0) / step) + 1));
  const p1 = hash(s, 1) * TAU + hs(s, b, 2) * 0.9;
  const p2 = hash(s, 3) * TAU + hs(s, b, 4) * 1.3;
  const wl = o.wl ?? 1;
  const f1 = 1 / ((34 + hash(s, 5) * 40) * wl);
  const f2 = 1 / ((9 + hash(s, 6) * 9) * wl);
  const bow = (o.bow ?? 0.6) * hs(s, 7) * amp;
  const j0 = hs(s, b, 15) * amp * 0.35;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const d = s0 + (s1 - s0) * t;
    const off = amp * (0.7 * Math.sin(d * f1 + p1) + 0.3 * Math.sin(d * f2 + p2)) + bow * Math.sin(Math.PI * t) + j0;
    out.push(x0 + ux * d + nx * off, y0 + uy * d + ny * off);
  }
  return out;
}

/** Samples a wobbly closed ellipse (optionally rotated) into `out`. */
export function ellipsePts(
  out: number[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
  amp: number,
  seed: number,
  boil: number,
  n = 0,
): number[] {
  out.length = 0;
  const count = n || Math.max(12, Math.min(96, Math.round((Math.max(rx, ry) * 6.3) / 5)));
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const p1 = hash(seed, 1) * TAU + hs(seed, boil, 2) * 0.8;
  const p2 = hash(seed, 3) * TAU + hs(seed, boil, 4) * 1.2;
  const k1 = 2 + Math.floor(hash(seed, 5) * 2);
  const k2 = 5 + Math.floor(hash(seed, 6) * 3);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    const w = amp * (0.65 * Math.sin(a * k1 + p1) + 0.35 * Math.sin(a * k2 + p2));
    const ex = Math.cos(a) * (rx + w);
    const ey = Math.sin(a) * (ry + w);
    out.push(cx + ex * c - ey * s, cy + ex * s + ey * c);
  }
  return out;
}

/** Samples a smooth Catmull-Rom curve through control points into `out`, with wobble. */
export function curvePts(out: number[], ctrl: number[], amp: number, seed: number, boil: number, step = 6, closed = false): number[] {
  out.length = 0;
  const m = ctrl.length / 2;
  if (m < 2) return out;
  const segs = closed ? m : m - 1;
  const p1 = hash(seed, 1) * TAU + hs(seed, boil, 2) * 0.9;
  const p2 = hash(seed, 3) * TAU + hs(seed, boil, 4) * 1.2;
  const get = (i: number, k: 0 | 1): number => {
    if (closed) i = ((i % m) + m) % m;
    else i = i < 0 ? 0 : i >= m ? m - 1 : i;
    return ctrl[i * 2 + k];
  };
  for (let sgi = 0; sgi < segs; sgi++) {
    const x0 = get(sgi - 1, 0), y0 = get(sgi - 1, 1);
    const x1 = get(sgi, 0), y1 = get(sgi, 1);
    const x2 = get(sgi + 1, 0), y2 = get(sgi + 1, 1);
    const x3 = get(sgi + 2, 0), y3 = get(sgi + 2, 1);
    const segLen = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(2, Math.ceil(segLen / step));
    for (let i = sgi === 0 ? 0 : 1; i <= n; i++) {
      if (closed && sgi === segs - 1 && i === n) break;
      const t = i / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3);
      const y = 0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
      out.push(x, y);
    }
  }
  if (amp > 0) {
    // Offset along the normal by smooth noise of arc length.
    const n = out.length / 2;
    B.length = 0;
    let d = 0;
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      let tx = out[i1 * 2] - out[i0 * 2];
      let ty = out[i1 * 2 + 1] - out[i0 * 2 + 1];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      if (i > 0) d += Math.hypot(out[i * 2] - out[i * 2 - 2], out[i * 2 + 1] - out[i * 2 - 1]);
      const off = amp * (0.7 * Math.sin(d / 31 + p1) + 0.3 * Math.sin(d / 11 + p2));
      B.push(out[i * 2] - ty * off, out[i * 2 + 1] + tx * off);
    }
    out.length = 0;
    for (let i = 0; i < B.length; i++) out.push(B[i]);
  }
  return out;
}

/** Appends sampled points as a polyline subpath. */
export function polyPath(ctx: CanvasPath, pts: number[], closed = false): void {
  if (pts.length < 4) return;
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (closed) ctx.closePath();
}

/**
 * Appends a tapered nib ribbon along `pts` to the current path (fill it afterwards).
 * Width swells and thins like a pen under changing pressure.
 */
export function ribbonPath(ctx: CanvasPath, pts: number[], w: number, seed: number, taper = 0.5): void {
  const n = pts.length / 2;
  if (n < 2) return;
  A.length = 0;
  B.length = 0;
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  const tl = Math.max(1e-3, Math.min(total * 0.35, w * 5)) * taper;
  const ph = hash(seed, 21) * TAU;
  const fr = 1 / ((7 + hash(seed, 22) * 12) * Math.max(1, w));
  let d = 0;
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    let tx = pts[i1 * 2] - pts[i0 * 2];
    let ty = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    if (i > 0) d += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    let k = 0.78 + 0.3 * Math.sin(d * fr + ph);
    if (tl > 0) {
      const e = Math.min(d, total - d);
      if (e < tl) k *= 0.3 + 0.7 * (e / tl);
    }
    const hw = w * 0.5 * k;
    A.push(pts[i * 2] - ty * hw, pts[i * 2 + 1] + tx * hw);
    B.push(pts[i * 2] + ty * hw, pts[i * 2 + 1] - tx * hw);
  }
  ctx.moveTo(A[0], A[1]);
  for (let i = 2; i < A.length; i += 2) ctx.lineTo(A[i], A[i + 1]);
  for (let i = B.length - 2; i >= 0; i -= 2) ctx.lineTo(B[i], B[i + 1]);
  ctx.closePath();
}

/** Appends a closed ribbon (a ring) around a closed point loop. */
export function ringPath(ctx: CanvasPath, pts: number[], w: number, seed: number): void {
  const n = pts.length / 2;
  if (n < 3) return;
  A.length = 0;
  B.length = 0;
  const ph = hash(seed, 31) * TAU;
  const k1 = 2 + Math.floor(hash(seed, 32) * 3);
  for (let i = 0; i < n; i++) {
    const i0 = (i - 1 + n) % n;
    const i1 = (i + 1) % n;
    let tx = pts[i1 * 2] - pts[i0 * 2];
    let ty = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    const k = 0.72 + 0.38 * (0.5 + 0.5 * Math.sin((i / n) * TAU * k1 + ph));
    const hw = w * 0.5 * k;
    A.push(pts[i * 2] - ty * hw, pts[i * 2 + 1] + tx * hw);
    B.push(pts[i * 2] + ty * hw, pts[i * 2 + 1] - tx * hw);
  }
  ctx.moveTo(A[0], A[1]);
  for (let i = 2; i < A.length; i += 2) ctx.lineTo(A[i], A[i + 1]);
  ctx.closePath();
  ctx.moveTo(B[B.length - 2], B[B.length - 1]);
  for (let i = B.length - 4; i >= 0; i -= 2) ctx.lineTo(B[i], B[i + 1]);
  ctx.closePath();
}

const P: number[] = [];

/** Convenience: a wobbly nib line appended to the path. */
export function inkLine(
  ctx: CanvasPath,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  amp: number,
  seed: number,
  boil: number,
  over = 0,
  wl = 1,
): void {
  linePts(P, x0, y0, x1, y1, { amp, seed, boil, over, step: Math.max(4, w * 2.5), wl });
  ribbonPath(ctx, P, w, seed);
}

/** Convenience: a thin wobbly polyline appended to the path (for marks and hatching). */
export function markLine(
  ctx: CanvasPath,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  amp: number,
  seed: number,
  boil: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const nx = -dy / len;
  const ny = dx / len;
  const segs = len > 40 ? 4 : len > 14 ? 2 : 1;
  ctx.moveTo(x0 + nx * hs(seed, boil, 1) * amp * 0.5, y0 + ny * hs(seed, boil, 1) * amp * 0.5);
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const o = i === segs ? hs(seed, boil, 2) * amp * 0.5 : hs(seed, i, 3 + boil) * amp;
    ctx.lineTo(x0 + dx * t + nx * o, y0 + dy * t + ny * o);
  }
}

/** Appends a closed noisy blob (blot, berry, splat) to the path. */
export function blobPath(ctx: CanvasPath, cx: number, cy: number, r: number, rough: number, seed: number, boil = 0, n = 0): void {
  const count = n || Math.max(8, Math.min(40, Math.round(r * 1.2)));
  const p1 = hash(seed, 1) * TAU + hs(seed, boil, 2) * 0.4;
  const p2 = hash(seed, 3) * TAU + hs(seed, boil, 4) * 0.6;
  const p3 = hash(seed, 5) * TAU;
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * TAU;
    const rr = r * (1 + rough * (0.5 * Math.sin(a * 3 + p1) + 0.3 * Math.sin(a * 5 + p2) + 0.2 * Math.sin(a * 9 + p3)));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** A four-pointed glint drawn as two crossing tapered strokes. */
export function glintPath(ctx: CanvasPath, x: number, y: number, r: number, rot = 0): void {
  const w = r * 0.16;
  for (let k = 0; k < 2; k++) {
    const a = rot + k * (Math.PI / 2);
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(x + c * r, y + s * r);
    ctx.lineTo(x - s * w, y + c * w);
    ctx.lineTo(x - c * r, y - s * r);
    ctx.lineTo(x + s * w, y - c * w);
    ctx.closePath();
  }
}

// ---------------------------------------------------------------- textures

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/**
 * A seamless tile of hand-ruled hatching. `angle` in radians; lines are wobbly and
 * vary a little in weight. `cross` adds the perpendicular set.
 */
export function hatchTile(size: number, color: string, alpha: number, spacing: number, width: number, cross: boolean, seed: number): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d')!;
  g.strokeStyle = color;
  g.lineCap = 'round';
  const sets = cross ? 2 : 1;
  for (let set = 0; set < sets; set++) {
    // Diagonals at 45 degrees tile when spacing divides the size.
    const count = Math.max(1, Math.round(size / spacing));
    const sp = size / count;
    for (let i = -count; i < count * 2; i++) {
      const a = alpha * (0.65 + 0.35 * hash(seed, i, set));
      g.globalAlpha = a;
      g.lineWidth = width * (0.75 + 0.5 * hash(seed, i, set + 7));
      g.beginPath();
      const o = i * sp;
      // Line from (o, 0) to (o + size, size) or its mirror, drawn wrapped.
      for (let wrap = -1; wrap <= 1; wrap++) {
        const ox = o + wrap * size;
        const jit = hs(seed, i, set + 3) * sp * 0.08;
        if (set === 0) {
          g.moveTo(ox + jit, 0);
          g.lineTo(ox + size * 0.5 + hs(seed, i, 9) * sp * 0.06, size * 0.5);
          g.lineTo(ox + size + jit, size);
        } else {
          g.moveTo(ox + size - jit, 0);
          g.lineTo(ox + size * 0.5 - hs(seed, i, 10) * sp * 0.06, size * 0.5);
          g.lineTo(ox - jit, size);
        }
      }
      g.stroke();
    }
  }
  return c;
}

/** Fills a seamless tile with blotchy watercolour variation and fine granulation. */
export function washTile(size: number, color: [number, number, number], alpha: number, seed: number): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const d = img.data;
  // Periodic value noise from a small lattice, smoothly interpolated.
  const L = 16;
  const lat: number[] = [];
  for (let i = 0; i < L * L; i++) lat.push(hash(seed, i));
  const L2 = 41;
  const lat2: number[] = [];
  for (let i = 0; i < L2 * L2; i++) lat2.push(hash(seed + 1, i));
  const sample = (lt: number[], n: number, x: number, y: number): number => {
    const fx = (x / size) * n;
    const fy = (y / size) * n;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const ux = tx * tx * (3 - 2 * tx);
    const uy = ty * ty * (3 - 2 * ty);
    const a = lt[(iy % n) * n + (ix % n)];
    const b = lt[(iy % n) * n + ((ix + 1) % n)];
    const c2 = lt[((iy + 1) % n) * n + (ix % n)];
    const e = lt[((iy + 1) % n) * n + ((ix + 1) % n)];
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c2 * (1 - ux) + e * ux) * uy;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n1 = sample(lat, L, x, y);
      const n2 = sample(lat2, L2, x, y);
      const grain = hash(x, y, seed);
      // Pigment pools in the low spots and granulates in fine specks.
      let v = Math.max(0, n1 * 0.6 + n2 * 0.55 - 0.45) * 1.4;
      if (grain > 0.9) v += 0.55 * (grain - 0.9) / 0.1;
      const i = (y * size + x) * 4;
      d[i] = color[0];
      d[i + 1] = color[1];
      d[i + 2] = color[2];
      d[i + 3] = Math.min(255, v * alpha * 255);
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** Sets a pattern's transform so it stays anchored to a world-bitmap origin. */
export function anchorPattern(p: CanvasPattern, ox: number, oy: number): void {
  if (typeof p.setTransform === 'function') p.setTransform(new DOMMatrix([1, 0, 0, 1, ox, oy]));
}
