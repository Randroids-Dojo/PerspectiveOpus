import { NO_DEPTH } from '../game/level';
import { MAT, MAT_NAMES, type MatName } from '../game/types';
import { css, mix, type RGB } from './color';
import { anchorAll, type Env, type Proj } from './env';
import { blobPath, curvePts, linePts, markLine, ribbonPath } from './ink';
import { drawDecor } from './decor';
import { hash, hs, noise1 } from './rand';
import type { LayerTone } from './tones';
import { Side, type EdgeRun } from './world';

/**
 * Paints everything static in a world rectangle, back layer to front layer, the
 * way an illustrator would build up a page: wash, marks, shade, top edging, the
 * ink outline along each layer's silhouette, then thorns and decor at that depth.
 * Used for the cached chunks and for live occlusion fix-ups.
 */

const PTS: number[] = [];
const PTS2: number[] = [];
/** Boil drawing being painted (marks wobble their middles with it; their ends stay pinned). */
let VAR = 0;

/** Materials that take the palette's top edging (grass, moss, leaves, snow, carpet). */
const CAPPED = new Set<number>([MAT.stone, MAT.brick, MAT.wood, MAT.marble, MAT.leaf, MAT.dark]);

export function paintStatic(
  ctx: CanvasRenderingContext2D,
  env: Env,
  p: Proj,
  wx0: number,
  wy0: number,
  wx1: number,
  wy1: number,
  variant: number,
): void {
  const W = env.world;
  const cx0 = Math.max(0, Math.floor(wx0) - 1);
  const cx1 = Math.min(W.w - 1, Math.ceil(wx1));
  const cy0 = Math.max(0, Math.floor(wy0) - 1);
  const cy1 = Math.min(W.h - 1, Math.ceil(wy1));
  const buckets: number[][] = [];
  for (let z = 0; z < W.d; z++) buckets.push([]);
  for (let y = cy0; y <= cy1; y++)
    for (let x = cx0; x <= cx1; x++) {
      const f = W.front[x + W.w * y];
      if (f !== NO_DEPTH) buckets[f].push(x, y);
    }
  anchorAll(env.pats, p);
  VAR = variant;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const m = 0.6;
  const rx0 = wx0 - m;
  const rx1 = wx1 + m;
  const ry0 = wy0 - m;
  const ry1 = wy1 + m;
  const pen: Pen = { ctx, env, p, variant, L: env.tones.layers[0], z: 0 };
  for (let z = W.d - 1; z >= 0; z--) {
    pen.L = env.tones.layers[z];
    pen.z = z;
    const cells = buckets[z];
    const runs = W.edges[z].filter((r) => r.x1 >= rx0 && r.x0 <= rx1 && r.y1 >= ry0 && r.y0 <= ry1);
    if (cells.length) {
      if (z < W.d - 1) castShadow(pen, cells);
      fillCells(pen, cells);
      marks(pen, cells);
      volume(pen, runs);
    }
    seams(pen, rx0, ry0, rx1, ry1);
    topCaps(pen, runs);
    outlines(pen, runs);
    for (const t of W.thorns[z]) {
      if (t.x + 1 < rx0 || t.x > rx1 || t.y + 1 < ry0 || t.y > ry1) continue;
      drawThorn(pen, t.x, t.y);
    }
    for (const di of W.decorByLayer[z]) {
      if (di.x1 < wx0 || di.x0 > wx1 || di.y1 < wy0 || di.y0 > wy1) continue;
      drawDecor(ctx, env, p, di, variant, 'static');
    }
  }
}

/** Washes the whole chunk with granulation so the ink sits in the paper. */
export function granulate(ctx: CanvasRenderingContext2D, env: Env, w: number, h: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = env.pats.wash;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

export interface Pen {
  ctx: CanvasRenderingContext2D;
  env: Env;
  p: Proj;
  variant: number;
  L: LayerTone;
  z: number;
}

// ---------------------------------------------------------------- shadow and fill

function cellRects(path: Path2D, p: Proj, cells: number[], grow = 0): void {
  const k = p.k;
  for (let i = 0; i < cells.length; i += 2) {
    const x = p.ox + cells[i] * k;
    const y = p.oy - (cells[i + 1] + 1) * k;
    path.rect(x - grow, y - grow, k + grow * 2, k + grow * 2);
  }
}

/** The nearer layer throws a hatched shadow down and to the right onto whatever is behind. */
function castShadow(pen: Pen, cells: number[]): void {
  const { ctx, p, env } = pen;
  const path = new Path2D();
  cellRects(path, p, cells);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = env.pats.cross;
  const o1 = p.k * 0.07;
  const o2 = p.k * 0.17;
  ctx.globalAlpha = 0.55;
  ctx.translate(o1, o1 * 0.9);
  ctx.fill(path);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = env.pats.hatch;
  ctx.globalAlpha = 0.5;
  ctx.translate(o2, o2 * 0.85);
  ctx.fill(path);
  ctx.restore();
}

function fillCells(pen: Pen, cells: number[]): void {
  const { ctx, p, L } = pen;
  const byMat = new Map<number, Path2D>();
  const W = pen.env.world;
  const tintD = new Path2D();
  const tintL = new Path2D();
  for (let i = 0; i < cells.length; i += 2) {
    const x = cells[i];
    const y = cells[i + 1];
    const mt = W.mat(x, y, pen.z);
    let path = byMat.get(mt);
    if (!path) byMat.set(mt, (path = new Path2D()));
    const X = p.ox + x * p.k;
    const Y = p.oy - (y + 1) * p.k;
    path.rect(X, Y, p.k, p.k);
    // A few cells take a little more or less pigment, as a hand-laid wash does.
    const h = hash(x, y, pen.z, 77);
    const inset = p.k * 0.08;
    if (h < 0.14) tintD.rect(X + inset, Y + inset, p.k - inset * 2, p.k - inset * 2);
    else if (h > 0.9) tintL.rect(X + inset, Y + inset, p.k - inset * 2, p.k - inset * 2);
  }
  ctx.globalAlpha = 0.97;
  for (const [mt, path] of byMat) {
    const n = MAT_NAMES[mt];
    ctx.fillStyle = L.fill[!n || n === 'empty' ? 'stone' : (n as MatName)];
    ctx.fill(path);
  }
  ctx.globalAlpha = 0.04 * (0.5 + L.density);
  ctx.fillStyle = L.dark;
  ctx.fill(tintD);
  ctx.globalAlpha = 0.05 * (0.5 + L.density);
  ctx.fillStyle = L.light;
  ctx.fill(tintL);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- material marks

interface MarkSet {
  light: Path2D;
  dark: Path2D;
  fine: Path2D;
  gold: Path2D;
  hatch: Path2D;
  dense: Path2D;
  white: Path2D;
  tintD: Path2D;
  tintL: Path2D;
}

function marks(pen: Pen, cells: number[]): void {
  const { ctx, p, L, env } = pen;
  const W = env.world;
  const q = p.k / p.dpr;
  const lod = q >= 46 ? 2 : q >= 28 ? 1 : 0;
  const ms: MarkSet = {
    light: new Path2D(),
    dark: new Path2D(),
    fine: new Path2D(),
    gold: new Path2D(),
    hatch: new Path2D(),
    dense: new Path2D(),
    white: new Path2D(),
    tintD: new Path2D(),
    tintL: new Path2D(),
  };
  const z = pen.z;
  for (let i = 0; i < cells.length; i += 2) {
    const x = cells[i];
    const y = cells[i + 1];
    const mt = W.mat(x, y, z);
    const below = W.frontAt(x, y - 1) === z && W.mat(x, y - 1, z) === mt;
    const left = W.frontAt(x - 1, y) === z && W.mat(x - 1, y, z) === mt;
    switch (mt) {
      case MAT.stone:
        stoneMarks(ms, p, x, y, z, below, lod, pen.variant);
        break;
      case MAT.brick:
        brickMarks(ms, p, x, y, z, below, lod);
        break;
      case MAT.wood:
        woodMarks(ms, p, x, y, z, below, lod);
        break;
      case MAT.brass:
        brassMarks(ms, p, x, y, z, below, left, lod);
        break;
      case MAT.dark:
        darkMarks(ms, p, x, y, z, lod, pen.variant);
        break;
      case MAT.crystal:
        crystalMarks(ms, p, x, y, z, lod);
        break;
      case MAT.leaf:
        leafMarks(ms, p, x, y, z, lod);
        break;
      case MAT.marble:
        marbleMarks(ms, p, x, y, z, below, left, lod);
        break;
    }
  }
  const d = L.density;
  const T = env.tones;
  ctx.globalAlpha = 0.07 * d + 0.03;
  ctx.fillStyle = L.dark;
  ctx.fill(ms.tintD);
  ctx.globalAlpha = 0.08 * d + 0.03;
  ctx.fillStyle = L.light;
  ctx.fill(ms.tintL);
  ctx.fillStyle = env.pats.dense;
  ctx.globalAlpha = 0.8;
  ctx.fill(ms.dense);
  ctx.fillStyle = env.pats.hatch;
  ctx.globalAlpha = 0.45 * d + 0.1;
  ctx.fill(ms.hatch);
  ctx.lineWidth = Math.max(0.8, 1.15 * p.px);
  ctx.strokeStyle = L.light;
  ctx.globalAlpha = 0.55 * d + 0.25;
  ctx.stroke(ms.light);
  ctx.strokeStyle = L.dark;
  ctx.globalAlpha = 0.5 * d + 0.2;
  ctx.stroke(ms.dark);
  ctx.lineWidth = Math.max(0.6, 0.8 * p.px);
  ctx.globalAlpha = 0.35 * d + 0.15;
  ctx.stroke(ms.fine);
  ctx.fillStyle = css(mix(T.goldLight, L.tone, 0.3 * L.k));
  ctx.globalAlpha = 0.85;
  ctx.fill(ms.gold);
  ctx.fillStyle = T.inv ? 'rgba(255,255,255,1)' : css(mix(T.paper, [255, 255, 255], 0.5));
  ctx.globalAlpha = 0.5 * d + 0.2;
  ctx.fill(ms.white);
  ctx.globalAlpha = 1;
}

/** A horizontal mark across a cell whose ends meet the neighbour's marks exactly. */
function hmark(path: Path2D, p: Proj, x0: number, x1: number, y: number, amp: number, salt: number): void {
  const Y = p.oy - y * p.k;
  const yk = Math.round(y * 64);
  const j0 = hs(Math.round(x0 * 64), yk, salt) * amp;
  const j1 = hs(Math.round(x1 * 64), yk, salt) * amp;
  const X0 = p.ox + x0 * p.k;
  const X1 = p.ox + x1 * p.k;
  path.moveTo(X0, Y + j0);
  path.lineTo(X0 + (X1 - X0) * 0.5, Y + (j0 + j1) * 0.5 + hs(Math.round(x0 * 64), yk, salt + 1 + VAR * 7) * amp * 1.2);
  path.lineTo(X1, Y + j1);
}

function vmark(path: Path2D, p: Proj, x: number, y0: number, y1: number, amp: number, seed: number): void {
  const X = p.ox + x * p.k;
  path.moveTo(X + hs(seed, 1, VAR) * amp, p.oy - y0 * p.k);
  path.lineTo(X + hs(seed, 2, VAR) * amp, p.oy - y1 * p.k);
}

function rectW(path: Path2D, p: Proj, x0: number, y0: number, x1: number, y1: number): void {
  path.rect(p.ox + x0 * p.k, p.oy - y1 * p.k, (x1 - x0) * p.k, (y1 - y0) * p.k);
}

function stoneMarks(ms: MarkSet, p: Proj, x: number, y: number, z: number, below: boolean, lod: number, v: number): void {
  const a = 0.7 * p.px;
  // One course of dressed stone per cell, with bevelled edges and irregular joints.
  if (below) hmark(ms.light, p, x, x + 1, y, a, 3);
  const hasJoint = hash(x, y, z, 6) > 0.28;
  const jx = x + 0.3 + hash(x, y, z, 5) * 0.4;
  if (hasJoint) vmark(ms.light, p, jx, y, y + 1, a * 0.6, x * 31 + y);
  if (lod === 0) return;
  // Bevels: a lit line under the top joint, a shaded one over the bottom joint.
  hmark(ms.white, p, x, x + 1, y + 0.93, a * 0.4, 21);
  hmark(ms.dark, p, x, x + 1, y + 0.07, a * 0.4, 22);
  rectW(ms.hatch, p, x, y, x + 1, y + 0.16);
  const split = hash(x, y, z, 9);
  if (split < 0.22) {
    // A course split into two thinner stones on one side of the joint.
    const left = hash(x, y, z, 10) < 0.5;
    const x0 = left ? x : hasJoint ? jx : x;
    const x1 = left ? (hasJoint ? jx : x + 1) : x + 1;
    hmark(ms.light, p, x0, x1, y + 0.5, a * 0.6, 23);
    hmark(ms.dark, p, x0 + 0.02, x1 - 0.02, y + 0.56, a * 0.3, 24);
  }
  if (hasJoint) {
    // Shade on the left face of the joint so blocks read as carved.
    markLine(ms.dark, p.ox + (jx - 0.03) * p.k, p.oy - (y + 0.1) * p.k, p.ox + (jx - 0.03) * p.k, p.oy - (y + 0.88) * p.k, a * 0.3, x * 3 + y * 7, v);
  }
  if (lod >= 1 && hash(x, y, z, 7) < 0.3) {
    // Chisel marks in a corner.
    const bx = (hasJoint ? jx : x + 1) - 0.1;
    const by = y + 0.12;
    for (let i = 0; i < 3; i++) {
      const o = i * 0.07;
      markLine(ms.fine, p.ox + (bx - 0.22 + o) * p.k, p.oy - by * p.k, p.ox + (bx - 0.1 + o) * p.k, p.oy - (by + 0.15) * p.k, a * 0.4, x * 7 + y * 3 + i, v);
    }
  }
  const h = hash(x, y, z, 8);
  if (h < 0.08) {
    // A hairline crack.
    let cx = x + 0.2 + hash(x, y, 9) * 0.6;
    let cy = y + 0.95;
    ms.dark.moveTo(p.ox + cx * p.k, p.oy - cy * p.k);
    for (let i = 0; i < 4; i++) {
      cx += hs(x, y, i, 10) * 0.12;
      cy -= 0.12 + hash(x, y, i, 11) * 0.08;
      ms.dark.lineTo(p.ox + cx * p.k, p.oy - cy * p.k);
    }
  } else if (h > 0.85) ms.tintD.rect(p.ox + (x + 0.06) * p.k, p.oy - (y + 0.9) * p.k, p.k * 0.88, p.k * 0.8);
  else if (h > 0.76) ms.tintL.rect(p.ox + (x + 0.06) * p.k, p.oy - (y + 0.9) * p.k, p.k * 0.88, p.k * 0.8);
  if (lod === 2) {
    for (let i = 0; i < 4; i++) {
      const sx = p.ox + (x + hash(x, y, i, 12)) * p.k;
      const sy = p.oy - (y + 0.15 + hash(x, y, i, 13) * 0.75) * p.k;
      ms.fine.moveTo(sx, sy);
      ms.fine.lineTo(sx + 0.7 * p.px, sy + 0.5 * p.px);
    }
  }
}

function brickMarks(ms: MarkSet, p: Proj, x: number, y: number, z: number, below: boolean, lod: number): void {
  const a = 0.5 * p.px;
  const courses = lod === 0 ? 2 : 4;
  const bw = lod === 0 ? 1 : 0.5;
  for (let c = 0; c < courses; c++) {
    const v0 = c / courses;
    const v1 = (c + 1) / courses;
    if (c > 0 || below) hmark(ms.light, p, x, x + 1, y + v0, a, 4);
    const row = y * courses + c;
    const off = (row & 1) * bw * 0.5;
    for (let u = off; u < 1 - 1e-6; u += bw) {
      if (u > 1e-6) vmark(ms.light, p, x + u, y + v0, y + v1, a * 0.5, x * 97 + row * 13 + Math.round(u * 8));
      // Individual bricks take a little more or less colour.
      const h = hash(Math.round((x + u) * 4), row, z, 15);
      const u1 = Math.min(1, u + bw);
      if (h < 0.22) rectW(ms.tintD, p, x + u + 0.02, y + v0 + 0.02, x + u1 - 0.02, y + v1 - 0.02);
      else if (h > 0.85) rectW(ms.tintL, p, x + u + 0.02, y + v0 + 0.02, x + u1 - 0.02, y + v1 - 0.02);
    }
    if (off > 0) {
      const h = hash(Math.round(x * 4), row, z, 15);
      if (h < 0.22) rectW(ms.tintD, p, x + 0.02, y + v0 + 0.02, x + off - 0.02, y + v1 - 0.02);
    }
  }
  if (lod >= 1 && hash(x, y, z, 16) < 0.35) {
    // A shaded brick lower edge here and there.
    const c = Math.floor(hash(x, y, 17) * courses);
    hmark(ms.dark, p, x + 0.05, x + 0.45, y + c / courses + 0.03, a * 0.4, 18);
  }
}

function woodMarks(ms: MarkSet, p: Proj, x: number, y: number, z: number, below: boolean, lod: number): void {
  const a = 0.5 * p.px;
  const planks = lod === 0 ? 2 : 3;
  for (let c = 0; c < planks; c++) {
    const v0 = c / planks;
    if (c > 0 || below) {
      hmark(ms.dark, p, x, x + 1, y + v0, a, 5);
      hmark(ms.light, p, x, x + 1, y + v0 - 0.035, a * 0.6, 6);
    }
    if (lod >= 1) {
      // Grain follows a slow world-anchored wave so it runs on across planks.
      const row = y * planks + c;
      for (let g = 0; g < (lod === 2 ? 2 : 1); g++) {
        const base = y + v0 + (0.3 + 0.4 * g) / planks;
        const amp = 0.05 / planks;
        const f = 2.1 + hash(row, g, 19);
        const ph = hash(row, g, 20) * 6.28;
        const X0 = p.ox + x * p.k;
        ms.fine.moveTo(X0, p.oy - (base + Math.sin(x * f + ph) * amp) * p.k);
        for (let s = 1; s <= 4; s++) {
          const wx = x + s / 4;
          ms.fine.lineTo(p.ox + wx * p.k, p.oy - (base + Math.sin(wx * f + ph) * amp) * p.k);
        }
      }
    }
    if (hash(x, y * planks + c, z, 21) < 0.5) {
      // Nail heads where a plank meets the next board.
      const nx = p.ox + (x + 0.06) * p.k;
      const ny = p.oy - (y + v0 + 0.5 / planks) * p.k;
      ms.dark.moveTo(nx + 1.1 * p.px, ny);
      ms.dark.arc(nx, ny, 1.1 * p.px, 0, Math.PI * 2);
    }
  }
  if (lod >= 1 && hash(x, y, z, 22) < 0.12) {
    // A knot.
    const kx = p.ox + (x + 0.3 + hash(x, y, 23) * 0.4) * p.k;
    const ky = p.oy - (y + 0.2 + hash(x, y, 24) * 0.6) * p.k;
    ms.dark.moveTo(kx + p.k * 0.08, ky);
    ms.dark.ellipse(kx, ky, p.k * 0.08, p.k * 0.035, 0, 0, Math.PI * 2);
    ms.fine.moveTo(kx + p.k * 0.14, ky);
    ms.fine.ellipse(kx, ky, p.k * 0.14, p.k * 0.06, 0, 0, Math.PI * 2);
  }
}

function brassMarks(ms: MarkSet, p: Proj, x: number, y: number, z: number, below: boolean, left: boolean, lod: number): void {
  const a = 0.35 * p.px;
  if (below) hmark(ms.dark, p, x, x + 1, y, a, 7);
  if (left) vmark(ms.dark, p, x, y, y + 1, a, x * 13 + y);
  // Polished bands catch the light.
  hmark(ms.light, p, x + 0.02, x + 0.98, y + 0.78, a, 8);
  if (lod >= 1) hmark(ms.light, p, x + 0.1, x + 0.9, y + 0.7, a, 9);
  hmark(ms.dark, p, x + 0.04, x + 0.96, y + 0.22, a, 10);
  // Rivets.
  if (lod >= 1) {
    const r = Math.max(1, p.k * 0.035);
    for (const [u, w] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) {
      const cx = p.ox + (x + u) * p.k;
      const cy = p.oy - (y + w) * p.k;
      ms.dark.moveTo(cx + r, cy);
      ms.dark.arc(cx, cy, r, 0, Math.PI * 2);
      ms.white.moveTo(cx - r * 0.2 + r * 0.45, cy - r * 0.3);
      ms.white.arc(cx - r * 0.2, cy - r * 0.3, r * 0.45, 0, Math.PI * 2);
    }
  }
  // Gold leaf flecks.
  const n = lod === 2 ? 3 : 1;
  for (let i = 0; i < n; i++) {
    if (hash(x, y, z, 30 + i) > 0.6) continue;
    const fx = p.ox + (x + 0.15 + hash(x, y, 31 + i) * 0.7) * p.k;
    const fy = p.oy - (y + 0.3 + hash(x, y, 32 + i) * 0.4) * p.k;
    blobPath(ms.gold, fx, fy, Math.max(1.2, p.k * (0.03 + hash(x, y, 33 + i) * 0.04)), 0.5, x * 5 + y * 3 + i, 0, 7);
  }
}

function darkMarks(ms: MarkSet, p: Proj, x: number, y: number, z: number, lod: number, v: number): void {
  rectW(ms.dense, p, x, y, x + 1, y + 1);
  if (lod >= 1 && hash(x, y, z, 40) < 0.4) {
    const sx = x + 0.2 + hash(x, y, 41) * 0.5;
    const sy = y + 0.2 + hash(x, y, 42) * 0.6;
    markLine(ms.light, p.ox + sx * p.k, p.oy - sy * p.k, p.ox + (sx + 0.25) * p.k, p.oy - (sy - 0.05) * p.k, 0.4 * p.px, x * 3 + y, v);
  }
}

function crystalMarks(ms: MarkSet, p: Proj, x: number, y: number, z: number, lod: number): void {
  const X = (u: number) => p.ox + (x + u) * p.k;
  const Y = (w: number) => p.oy - (y + w) * p.k;
  const ax = 0.3 + hash(x, y, z, 50) * 0.4;
  const ay = 0.35 + hash(x, y, z, 51) * 0.3;
  const bx = ax + hs(x, y, 52) * 0.2;
  const by = ay + 0.25;
  // Facets fan out from two points inside the cell.
  ms.dark.moveTo(X(0), Y(0));
  ms.dark.lineTo(X(ax), Y(ay));
  ms.dark.lineTo(X(1), Y(0));
  ms.dark.moveTo(X(ax), Y(ay));
  ms.dark.lineTo(X(bx), Y(Math.min(0.95, by)));
  ms.dark.moveTo(X(0), Y(1));
  ms.dark.lineTo(X(bx), Y(Math.min(0.95, by)));
  ms.dark.lineTo(X(1), Y(1));
  ms.tintL.moveTo(X(0), Y(1));
  ms.tintL.lineTo(X(bx), Y(Math.min(0.95, by)));
  ms.tintL.lineTo(X(ax), Y(ay));
  ms.tintL.lineTo(X(0), Y(0.1));
  ms.tintL.closePath();
  ms.light.moveTo(X(0.08), Y(0.82));
  ms.light.lineTo(X(0.3), Y(0.92));
  if (lod >= 1 && hash(x, y, z, 53) < 0.5) {
    const gx = X(0.2 + hash(x, y, 54) * 0.6);
    const gy = Y(0.2 + hash(x, y, 55) * 0.6);
    const r = p.k * 0.09;
    ms.white.moveTo(gx + r, gy);
    ms.white.lineTo(gx + r * 0.15, gy + r * 0.15);
    ms.white.lineTo(gx, gy + r);
    ms.white.lineTo(gx - r * 0.15, gy + r * 0.15);
    ms.white.lineTo(gx - r, gy);
    ms.white.lineTo(gx - r * 0.15, gy - r * 0.15);
    ms.white.lineTo(gx, gy - r);
    ms.white.lineTo(gx + r * 0.15, gy - r * 0.15);
    ms.white.closePath();
  }
}

function leafMarks(ms: MarkSet, p: Proj, x: number, y: number, z: number, lod: number): void {
  const rows = lod === 0 ? 2 : 3;
  const per = lod === 0 ? 2 : 3;
  const r = 0.5 / per + 0.03;
  for (let rI = 0; rI < rows; rI++) {
    const w = (rI + 0.75) / rows;
    const off = ((y * rows + rI) & 1) * (0.5 / per);
    for (let i = -1; i < per; i++) {
      const u = (i + 0.5) / per + off;
      if (u < -0.1 || u > 1.1) continue;
      const cx = p.ox + (x + u) * p.k;
      const cy = p.oy - (y + w) * p.k;
      const rr = r * p.k * (0.9 + 0.2 * hash(x, y, rI * 7 + i, 60));
      // Scalloped leaves: a cup line under each, a highlight on top.
      const a0 = 0.15 + hs(x, y, rI, i) * 0.1;
      ms.dark.moveTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr);
      ms.dark.arc(cx, cy, rr, a0, Math.PI - a0);
      if (lod >= 1) {
        ms.light.moveTo(cx - rr * 0.5, cy - rr * 0.35);
        ms.light.quadraticCurveTo(cx, cy - rr * 0.75, cx + rr * 0.45, cy - rr * 0.4);
      }
      if (hash(x, y, rI * 5 + i, z) < 0.2) ms.tintD.arc(cx, cy, rr * 0.8, 0, Math.PI * 2);
    }
  }
}

function marbleMarks(ms: MarkSet, p: Proj, x: number, y: number, z: number, below: boolean, left: boolean, lod: number): void {
  const a = 0.35 * p.px;
  if (below && hash(x, y, z, 69) < 0.6) hmark(ms.light, p, x, x + 1, y, a, 11);
  if (left && hash(x, y, z, 70) < 0.35) vmark(ms.light, p, x, y, y + 1, a, x * 3 + y * 7);
  if (lod === 0) return;
  // Veins run on long diagonals anchored in the world, wandering as they go, so they
  // continue from cell to cell and chunk to chunk.
  const fams = [
    { s: 0.62, d: 2.7, ph: 0.4, path: ms.dark },
    { s: -1.35, d: 3.9, ph: 1.7, path: ms.fine },
  ];
  for (let f = 0; f < fams.length; f++) {
    const F = fams[f];
    const seed = 900 + f * 31;
    const lo = Math.floor((x - 1 - F.s * (y + 1) - F.ph) / F.d) - 1;
    const hi = Math.ceil((x + 2 - F.s * y - F.ph) / F.d) + 1;
    for (let n = Math.min(lo, hi); n <= Math.max(lo, hi); n++) {
      if (hash(n, f, 71) > 0.7) continue;
      let started = false;
      for (let st = 0; st <= 6; st++) {
        const wy = y + st / 6;
        const wx = n * F.d + F.ph + F.s * wy + 0.32 * noise1(wy * 1.6 + n * 3.3, seed) + 0.1 * noise1(wy * 5.1 + n, seed + 1);
        if (wx < x - 0.02 || wx > x + 1.02) {
          started = false;
          continue;
        }
        const X = p.ox + wx * p.k;
        const Y = p.oy - wy * p.k;
        if (!started) F.path.moveTo(X, Y);
        else F.path.lineTo(X, Y);
        started = true;
      }
    }
  }
  if (lod === 2 && hash(x, y, z, 72) < 0.25) {
    const bx = x + 0.2 + hash(x, y, 73) * 0.5;
    const by = y + 0.2 + hash(x, y, 74) * 0.5;
    ms.fine.moveTo(p.ox + bx * p.k, p.oy - by * p.k);
    ms.fine.lineTo(p.ox + (bx + 0.25) * p.k, p.oy - (by + hs(x, y, 75) * 0.2) * p.k);
  }
}

// ---------------------------------------------------------------- volume, seams, outlines

/** Inner shade along the underside and right of each silhouette, a lit edge along the top. */
function volume(pen: Pen, runs: EdgeRun[]): void {
  const { ctx, p, L, env } = pen;
  const shade = new Path2D();
  const side = new Path2D();
  const hi = new Path2D();
  const capped = env.tones.pal.top !== 'none';
  for (const r of runs) {
    if (r.side === Side.Bottom) rectW(shade, p, r.x0, r.y0, r.x1, r.y0 + 0.24);
    else if (r.side === Side.Right) rectW(side, p, r.x0 - 0.13, r.y0, r.x0, r.y1);
    else if (r.side === Side.Top && !capped) hmark(hi, p, r.x0 + 0.04, r.x1 - 0.04, r.y0 - 0.07, 0.4 * p.px, 12);
    else if (r.side === Side.Top) {
      // Even under grass the edge catches light where the cap is thin.
      hmark(hi, p, r.x0 + 0.04, r.x1 - 0.04, r.y0 - 0.16, 0.4 * p.px, 13);
    }
  }
  ctx.fillStyle = env.pats.cross;
  ctx.globalAlpha = 0.45 * L.density + 0.1;
  ctx.fill(shade);
  ctx.fillStyle = env.pats.hatch;
  ctx.globalAlpha = 0.4 * L.density + 0.1;
  ctx.fill(side);
  ctx.strokeStyle = L.light;
  ctx.lineWidth = Math.max(1, 1.6 * p.px);
  ctx.globalAlpha = 0.45 * L.density + 0.1;
  ctx.stroke(hi);
  ctx.globalAlpha = 1;
}

function seams(pen: Pen, rx0: number, ry0: number, rx1: number, ry1: number): void {
  const { ctx, p, L, env } = pen;
  const list = env.world.seams[pen.z];
  if (!list.length) return;
  const path = new Path2D();
  for (const s of list) {
    if (s.x1 < rx0 || s.x0 > rx1 || s.y1 < ry0 || s.y0 > ry1) continue;
    linePts(PTS, p.ox + s.x0 * p.k, p.oy - s.y0 * p.k, p.ox + s.x1 * p.k, p.oy - s.y1 * p.k, {
      amp: 0.6 * p.px,
      seed: s.x0 * 131 + s.y0 * 71 + pen.z,
      boil: pen.variant,
      step: 6 * p.px,
      wl: p.px,
    });
    ribbonPath(path, PTS, L.outlineW * 0.55 * p.px, s.x0 * 17 + s.y0);
  }
  ctx.fillStyle = L.ink;
  ctx.globalAlpha = 0.7;
  ctx.fill(path);
  ctx.globalAlpha = 1;
}

function outlines(pen: Pen, runs: EdgeRun[]): void {
  const { ctx, p, L } = pen;
  if (!runs.length) return;
  const path = new Path2D();
  const w = L.outlineW * p.px;
  const amp = (0.75 + 0.5 * (1 - L.k)) * p.px;
  for (const r of runs) {
    const len = Math.max(r.x1 - r.x0, r.y1 - r.y0) * p.k;
    linePts(PTS, p.ox + r.x0 * p.k, p.oy - r.y0 * p.k, p.ox + r.x1 * p.k, p.oy - r.y1 * p.k, {
      amp: amp * (len > 300 ? 1.25 : 1),
      seed: r.seed,
      boil: pen.variant,
      step: 6 * p.px,
      over: 2.4 * p.px,
      wl: p.px,
    });
    ribbonPath(path, PTS, w, r.seed);
  }
  ctx.fillStyle = L.ink;
  ctx.globalAlpha = 0.93;
  ctx.fill(path);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- top edging

function topCaps(pen: Pen, runs: EdgeRun[]): void {
  const { ctx, p, L, env } = pen;
  const top = env.tones.pal.top;
  const W = env.world;
  const band = new Path2D();
  const blades = new Path2D();
  const bladesLight = new Path2D();
  const accent = new Path2D();
  const accent2 = new Path2D();
  const trim = new Path2D();
  const q = p.k / p.dpr;
  const z = pen.z;
  let any = false;
  for (const r of runs) {
    if (r.side !== Side.Top) continue;
    const y = r.y0;
    for (let x = r.x0; x < r.x1; x++) {
      const mt = W.mat(x, y - 1, z);
      if (!CAPPED.has(mt)) {
        if (top !== 'none' && mt === MAT.brass) hmark(trim, p, x, x + 1, y - 0.04, 0.3 * p.px, 14);
        continue;
      }
      any = true;
      const startCap = x === r.x0 || !CAPPED.has(W.mat(x - 1, y - 1, z));
      const endCap = x === r.x1 - 1 || !CAPPED.has(W.mat(x + 1, y - 1, z));
      switch (top) {
        case 'grass':
          grassCap(band, blades, bladesLight, accent, p, x, y, z, q, L.density, pen.variant);
          break;
        case 'moss':
          mossCap(band, blades, accent, p, x, y, z, q, startCap);
          break;
        case 'leaves':
          leavesCap(band, blades, accent, accent2, p, x, y, q);
          break;
        case 'snow':
          snowCap(band, blades, p, x, y, z, endCap);
          break;
        case 'carpet':
          carpetCap(band, trim, accent, p, x, y, startCap, endCap, q);
          break;
        case 'none':
          hmark(trim, p, x, x + 1, y - 0.05, 0.3 * p.px, 15);
          break;
      }
    }
  }
  if (!any && top !== 'none') {
    if (top !== 'carpet') {
      ctx.strokeStyle = css(mix(env.tones.goldLight, L.tone, 0.4));
      ctx.lineWidth = Math.max(1, 1.4 * p.px);
      ctx.globalAlpha = 0.6 * L.density + 0.2;
      ctx.stroke(trim);
      ctx.globalAlpha = 1;
    }
    return;
  }
  const T = env.tones;
  const topC = L.top;
  const ink = L.inkRGB;
  switch (top) {
    case 'grass': {
      ctx.fillStyle = css(topC);
      ctx.globalAlpha = 0.9;
      ctx.fill(band);
      ctx.strokeStyle = css(mix(topC, ink, 0.45));
      ctx.lineWidth = Math.max(0.8, 1.15 * p.px);
      ctx.globalAlpha = 0.85;
      ctx.stroke(blades);
      ctx.strokeStyle = css(mix(topC, T.paper, 0.35));
      ctx.globalAlpha = 0.7;
      ctx.stroke(bladesLight);
      ctx.fillStyle = css(mix(T.rubric, L.tone, 0.25 * L.k));
      ctx.globalAlpha = 0.9;
      ctx.fill(accent);
      break;
    }
    case 'moss': {
      ctx.fillStyle = css(topC);
      ctx.globalAlpha = 0.88;
      ctx.fill(band);
      ctx.strokeStyle = css(mix(topC, ink, 0.5));
      ctx.lineWidth = Math.max(0.8, 1.1 * p.px);
      ctx.globalAlpha = 0.8;
      ctx.stroke(blades);
      ctx.fillStyle = css(mix(topC, ink, 0.4));
      ctx.globalAlpha = 0.7;
      ctx.fill(accent);
      break;
    }
    case 'leaves': {
      ctx.fillStyle = css(topC);
      ctx.globalAlpha = 0.9;
      ctx.fill(band);
      ctx.fillStyle = css(mix(mix(T.rubric, topC, 0.3), L.tone, 0.3 * L.k));
      ctx.fill(accent);
      ctx.fillStyle = css(mix(mix(T.gold, topC, 0.3), L.tone, 0.3 * L.k));
      ctx.fill(accent2);
      ctx.strokeStyle = css(mix(topC, ink, 0.6));
      ctx.lineWidth = Math.max(0.7, 0.9 * p.px);
      ctx.globalAlpha = 0.75;
      ctx.stroke(blades);
      break;
    }
    case 'snow': {
      ctx.fillStyle = T.inv ? 'rgb(235,238,250)' : 'rgb(252,250,246)';
      ctx.globalAlpha = 0.95;
      ctx.fill(band);
      ctx.strokeStyle = css(mix(ink, [120, 140, 170], 0.5));
      ctx.lineWidth = Math.max(0.8, 1 * p.px);
      ctx.globalAlpha = 0.7;
      ctx.stroke(blades);
      break;
    }
    case 'carpet': {
      ctx.fillStyle = css(mix(topC, L.tone, 0.15 + 0.2 * L.k));
      ctx.globalAlpha = 0.95;
      ctx.fill(band);
      ctx.strokeStyle = css(mix(T.gold, L.tone, 0.3 * L.k));
      ctx.lineWidth = Math.max(1, 1.3 * p.px);
      ctx.globalAlpha = 0.9;
      ctx.stroke(trim);
      ctx.strokeStyle = css(mix(topC, ink, 0.55));
      ctx.lineWidth = Math.max(0.6, 0.8 * p.px);
      ctx.globalAlpha = 0.6;
      ctx.stroke(accent);
      break;
    }
    case 'none': {
      ctx.strokeStyle = css(mix(T.goldLight, L.tone, 0.4));
      ctx.lineWidth = Math.max(1, 1.4 * p.px);
      ctx.globalAlpha = 0.6 * L.density + 0.2;
      ctx.stroke(trim);
      break;
    }
  }
  if (top !== 'none' && top !== 'carpet') {
    ctx.strokeStyle = css(mix(T.goldLight, L.tone, 0.4));
    ctx.lineWidth = Math.max(1, 1.4 * p.px);
    ctx.globalAlpha = 0.6 * L.density + 0.2;
    ctx.stroke(trim);
  }
  ctx.globalAlpha = 1;
}

function grassCap(band: Path2D, blades: Path2D, light: Path2D, flowers: Path2D, p: Proj, x: number, y: number, z: number, q: number, density: number, v: number): void {
  const X = (u: number) => p.ox + (x + u) * p.k;
  const Y = (w: number) => p.oy - w * p.k;
  // A ragged band of green over the lip of the block.
  band.moveTo(X(0), Y(y - 0.12 - hash(x, y, 1) * 0.04));
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    band.lineTo(X(u), Y(y + 0.035 + hash(Math.round((x + u) * 6), y, 2) * 0.05));
  }
  band.lineTo(X(1), Y(y - 0.12 - hash(x + 1, y, 1) * 0.04));
  for (let i = 5; i >= 1; i--) {
    const u = i / 6;
    band.lineTo(X(u), Y(y - 0.1 - hash(Math.round((x + u) * 6), y, 3) * 0.1));
  }
  band.closePath();
  const n = Math.max(4, Math.round((q / 4.2) * (0.45 + 0.55 * density)));
  for (let i = 0; i < n; i++) {
    const u = (i + hash(x, y, i, 4)) / n;
    const hgt = (0.07 + hash(x, y, i, 5) * 0.16) * (hash(x, y, i, 6) < 0.12 ? 1.7 : 1);
    const lean = hs(x, y, i, 7) * 0.08 + hs(x, y, i, v + 30) * 0.012;
    const bx = X(u);
    const by = Y(y + 0.01);
    const tx = X(u + lean);
    const ty = Y(y + hgt);
    const path = hash(x, y, i, 8) < 0.25 ? light : blades;
    path.moveTo(bx, by);
    path.quadraticCurveTo(bx + (tx - bx) * 0.2, by + (ty - by) * 0.6, tx, ty);
  }
  if (z <= 2 && hash(x, y, z, 9) < 0.12 && q > 26) {
    const fx = X(0.2 + hash(x, y, 10) * 0.6);
    const fy = Y(y + 0.13 + hash(x, y, 11) * 0.08);
    const r = Math.max(1.2, p.k * 0.035);
    blades.moveTo(fx, Y(y));
    blades.lineTo(fx, fy);
    flowers.moveTo(fx + r, fy);
    flowers.arc(fx, fy, r, 0, Math.PI * 2);
  }
}

function mossCap(band: Path2D, lines: Path2D, drips: Path2D, p: Proj, x: number, y: number, z: number, q: number, startCap: boolean): void {
  const X = (u: number) => p.ox + (x + u) * p.k;
  const Y = (w: number) => p.oy - w * p.k;
  const bumps = Math.max(2, Math.round(q / 18));
  const base = y - 0.1;
  band.moveTo(X(0), Y(base - (startCap ? 0 : 0.02)));
  for (let i = 0; i < bumps; i++) {
    const u0 = i / bumps;
    const u1 = (i + 1) / bumps;
    const hgt = 0.08 + hash(x * 8 + i, y, z, 20) * 0.07;
    band.quadraticCurveTo(X((u0 + u1) / 2), Y(y + hgt * 1.6), X(u1), Y(y + 0.01));
  }
  band.lineTo(X(1), Y(base));
  band.lineTo(X(0), Y(base));
  band.closePath();
  for (let i = 0; i < bumps; i++) {
    const u = (i + 0.5) / bumps;
    lines.moveTo(X(u - 0.12 / bumps), Y(y + 0.03));
    lines.quadraticCurveTo(X(u), Y(y + 0.09), X(u + 0.12 / bumps), Y(y + 0.04));
  }
  // Drips of moss hanging over the lip.
  const nd = hash(x, y, z, 21) < 0.5 ? 1 : 2;
  for (let i = 0; i < nd; i++) {
    const u = 0.15 + hash(x, y, i, 22) * 0.7;
    const len = 0.1 + hash(x, y, i, 23) * 0.22;
    const w = 0.035;
    drips.moveTo(X(u - w), Y(base + 0.02));
    drips.quadraticCurveTo(X(u - w * 0.6), Y(base - len), X(u), Y(base - len - 0.03));
    drips.quadraticCurveTo(X(u + w * 0.6), Y(base - len), X(u + w), Y(base + 0.02));
    drips.closePath();
  }
}

function leavesCap(band: Path2D, veins: Path2D, red: Path2D, yellow: Path2D, p: Proj, x: number, y: number, q: number): void {
  const X = (u: number) => p.ox + (x + u) * p.k;
  const Y = (w: number) => p.oy - w * p.k;
  band.moveTo(X(0), Y(y - 0.07));
  for (let i = 0; i <= 5; i++) band.lineTo(X(i / 5), Y(y + 0.02 + hash(x * 5 + i, y, 30) * 0.035));
  band.lineTo(X(1), Y(y - 0.07));
  band.closePath();
  const n = Math.max(2, Math.round(q / 14));
  for (let i = 0; i < n; i++) {
    const u = (i + hash(x, y, i, 31)) / n;
    const cx = X(u);
    const cy = Y(y + 0.04 + hash(x, y, i, 32) * 0.05);
    const len = p.k * (0.09 + hash(x, y, i, 33) * 0.06);
    const ang = hs(x, y, i, 34) * 0.9;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const target = hash(x, y, i, 35) < 0.45 ? red : yellow;
    // An almond leaf with a midrib.
    target.moveTo(cx - ca * len, cy - sa * len);
    target.quadraticCurveTo(cx - sa * len * 0.45, cy + ca * len * 0.45, cx + ca * len, cy + sa * len);
    target.quadraticCurveTo(cx + sa * len * 0.45, cy - ca * len * 0.45, cx - ca * len, cy - sa * len);
    target.closePath();
    veins.moveTo(cx - ca * len * 0.8, cy - sa * len * 0.8);
    veins.lineTo(cx + ca * len * 0.8, cy + sa * len * 0.8);
  }
}

function snowCap(band: Path2D, lines: Path2D, p: Proj, x: number, y: number, z: number, endCap: boolean): void {
  const X = (u: number) => p.ox + (x + u) * p.k;
  const Y = (w: number) => p.oy - w * p.k;
  band.moveTo(X(0), Y(y - 0.12));
  band.quadraticCurveTo(X(0.25), Y(y + 0.1 + hash(x, y, z, 40) * 0.05), X(0.5), Y(y + 0.09));
  band.quadraticCurveTo(X(0.75), Y(y + 0.1 + hash(x + 1, y, z, 40) * 0.05), X(1), Y(y + (endCap ? 0 : 0.08)));
  band.lineTo(X(1), Y(y - 0.1));
  band.lineTo(X(0.5), Y(y - 0.16 - hash(x, y, 41) * 0.08));
  band.closePath();
  lines.moveTo(X(0.05), Y(y + 0.08));
  lines.quadraticCurveTo(X(0.5), Y(y + 0.13), X(0.95), Y(y + 0.08));
}

function carpetCap(band: Path2D, trim: Path2D, pile: Path2D, p: Proj, x: number, y: number, startCap: boolean, endCap: boolean, q: number): void {
  const x0 = startCap ? x + 0.06 : x;
  const x1 = endCap ? x + 0.94 : x + 1;
  rectW(band, p, x0, y - 0.13, x1, y + 0.03);
  hmark(trim, p, x0, x1, y + 0.02, 0.2 * p.px, 16);
  hmark(trim, p, x0, x1, y - 0.11, 0.2 * p.px, 17);
  const n = Math.max(3, Math.round(q / 9));
  for (let i = 0; i < n; i++) {
    const u = x0 + ((i + 0.5) / n) * (x1 - x0);
    pile.moveTo(p.ox + u * p.k, p.oy - (y - 0.09) * p.k);
    pile.lineTo(p.ox + (u + 0.02) * p.k, p.oy - (y - 0.02) * p.k);
  }
  for (const [cap, ex] of [[startCap, x0], [endCap, x1]] as const) {
    if (!cap) continue;
    // Gold fringe at the end of the runner.
    for (let i = 0; i < 4; i++) {
      const fy = y - 0.11 + i * 0.035;
      trim.moveTo(p.ox + ex * p.k, p.oy - fy * p.k);
      trim.lineTo(p.ox + (ex + (ex === x0 ? -0.05 : 0.05)) * p.k, p.oy - (fy - 0.02) * p.k);
    }
  }
}

// ---------------------------------------------------------------- thorns

/** A bramble of thorny stems with vermilion tips, filling one cell. */
export function drawThorn(pen: Pen, x: number, y: number): void {
  const { ctx, p, L, env } = pen;
  const T = env.tones;
  const stems = new Path2D();
  const spikes = new Path2D();
  const tips = new Path2D();
  const seed = x * 7919 + y * 104729 + pen.z * 31;
  const X = (u: number) => p.ox + (x + u) * p.k;
  const Y = (w: number) => p.oy - (y + w) * p.k;
  const count = 3 + Math.floor(hash(seed, 1) * 2);
  for (let s = 0; s < count; s++) {
    const u0 = 0.1 + hash(seed, s, 2) * 0.8;
    const u1 = u0 + hs(seed, s, 3) * 0.45;
    const top = 0.55 + hash(seed, s, 4) * 0.4;
    const ctrl = [X(u0), Y(0), X(u0 + hs(seed, s, 5) * 0.3), Y(top * 0.45), X((u0 + u1) / 2 + hs(seed, s, 6) * 0.2), Y(top * 0.8), X(u1), Y(top)];
    curvePts(PTS2, ctrl, 0.5 * p.px, seed + s, pen.variant, 5 * p.px);
    ribbonPath(stems, PTS2, Math.max(1.2, p.k * 0.05 * (0.8 + 0.4 * (1 - L.k))), seed + s, 0.9);
    // Spikes along the stem, alternating sides.
    const n = PTS2.length / 2;
    const every = Math.max(2, Math.round(n / 5));
    for (let i = every; i < n - 1; i += every) {
      const ax = PTS2[i * 2];
      const ay = PTS2[i * 2 + 1];
      let tx = PTS2[i * 2 + 2] - PTS2[i * 2 - 2];
      let ty = PTS2[i * 2 + 3] - PTS2[i * 2 - 1];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      const sd = (i / every) % 2 === 0 ? 1 : -1;
      const len = p.k * (0.1 + hash(seed, s, i) * 0.06);
      const nx = -ty * sd;
      const ny = tx * sd;
      const bw = p.k * 0.035;
      const tipX = ax + nx * len + tx * len * 0.5;
      const tipY = ay + ny * len + ty * len * 0.5;
      spikes.moveTo(ax - tx * bw, ay - ty * bw);
      spikes.lineTo(tipX, tipY);
      spikes.lineTo(ax + tx * bw, ay + ty * bw);
      spikes.closePath();
      if (hash(seed, s, i, 9) < 0.6) {
        const r = Math.max(0.9, p.k * 0.022);
        tips.moveTo(tipX + r, tipY);
        tips.arc(tipX, tipY, r, 0, Math.PI * 2);
      }
    }
    // A berry at the end of some stems.
    if (hash(seed, s, 10) < 0.7) {
      const ex = PTS2[PTS2.length - 2];
      const ey = PTS2[PTS2.length - 1];
      blobPath(tips, ex, ey, Math.max(1.6, p.k * 0.055), 0.25, seed + s * 3, pen.variant, 8);
    }
  }
  const ink: RGB = mix(T.ink, L.inkRGB, 0.6);
  ctx.fillStyle = css(T.inv ? mix(ink, T.paper, 0.15) : mix(ink, [20, 8, 12], 0.3));
  ctx.globalAlpha = 0.95;
  ctx.fill(stems);
  ctx.fill(spikes);
  ctx.fillStyle = css(mix(T.rubric, L.tone, 0.35 * L.k));
  ctx.fill(tips);
  ctx.globalAlpha = 1;
}
