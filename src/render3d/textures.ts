import * as THREE from 'three';
import { rng, type Rng } from './util';

/**
 * Procedural surface textures, generated at runtime (no image files).
 *
 * Block faces sample a texture array whose layers hold palette-independent
 * detail, not colour: R mixes between a material's two palette colours, G is
 * luminance (0.5 neutral), B nudges roughness (0.5 neutral) and A is grout or
 * accent (mortar, plank gaps, crystal glow). Colour comes from per-palette
 * uniforms, so the same layers serve every movement and are built once.
 */

export const TILE = 128;
export const VARIANTS = 4;
/** Order of materials in the texture array and in the world shader's uniform arrays. */
export const MAT_ORDER = ['stone', 'brick', 'wood', 'brass', 'dark', 'crystal', 'leaf', 'marble'] as const;
export type MatKey = (typeof MAT_ORDER)[number];
export const CAP_ORDER = ['grass', 'moss', 'leaves', 'snow', 'carpet'] as const;
export type CapKey = (typeof CAP_ORDER)[number];
export const CAP_BASE = MAT_ORDER.length * VARIANTS;
export const LAYERS = CAP_BASE + CAP_ORDER.length;

const T = TILE;
const N = T * T;

// ---------------------------------------------------------------- noise

function hash2(i: number, j: number, seed: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable value noise over the tile with `px` x `py` lattice cells. */
function valueField(px: number, py: number, seed: number): Float32Array {
  const out = new Float32Array(N);
  const lat = new Float32Array(px * py);
  for (let j = 0; j < py; j++) for (let i = 0; i < px; i++) lat[i + j * px] = hash2(i, j, seed);
  for (let y = 0; y < T; y++) {
    const fy = ((y + 0.5) / T) * py;
    const j0 = Math.floor(fy);
    let ty = fy - j0;
    ty = ty * ty * (3 - 2 * ty);
    const ja = (j0 % py) * px;
    const jb = ((j0 + 1) % py) * px;
    for (let x = 0; x < T; x++) {
      const fx = ((x + 0.5) / T) * px;
      const i0 = Math.floor(fx);
      let tx = fx - i0;
      tx = tx * tx * (3 - 2 * tx);
      const ia = i0 % px;
      const ib = (i0 + 1) % px;
      const a = lat[ia + ja] + (lat[ib + ja] - lat[ia + ja]) * tx;
      const b = lat[ia + jb] + (lat[ib + jb] - lat[ia + jb]) * tx;
      out[x + y * T] = a + (b - a) * ty;
    }
  }
  return out;
}

/** Fractal noise, 0..1, tileable. */
function fbm(px: number, py: number, oct: number, seed: number, gain = 0.5): Float32Array {
  const out = new Float32Array(N);
  let amp = 1;
  let sum = 0;
  for (let o = 0; o < oct; o++) {
    const f = valueField(px << o, py << o, seed + o * 101);
    for (let i = 0; i < N; i++) out[i] += f[i] * amp;
    sum += amp;
    amp *= gain;
  }
  for (let i = 0; i < N; i++) out[i] /= sum;
  return out;
}

/** Tileable Worley noise: distances to the nearest and second nearest feature, plus the nearest id. */
function worley(count: number, r: Rng): { d1: Float32Array; d2: Float32Array; id: Float32Array } {
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) pts.push([r() * T, r() * T]);
  const d1 = new Float32Array(N);
  const d2 = new Float32Array(N);
  const id = new Float32Array(N);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      let a = 1e9;
      let b = 1e9;
      let best = 0;
      for (let k = 0; k < count; k++) {
        let dx = Math.abs(x - pts[k][0]);
        let dy = Math.abs(y - pts[k][1]);
        if (dx > T / 2) dx = T - dx;
        if (dy > T / 2) dy = T - dy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < a) {
          b = a;
          a = d;
          best = k;
        } else if (d < b) b = d;
      }
      d1[x + y * T] = a;
      d2[x + y * T] = b;
      id[x + y * T] = best / count;
    }
  return { d1, d2, id };
}

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- tile canvas

/** One layer under construction: detail channels plus a height field for the normal map. */
class Tile {
  r = new Float32Array(N).fill(0);
  g = new Float32Array(N).fill(0.5);
  b = new Float32Array(N).fill(0.5);
  a = new Float32Array(N).fill(0);
  h = new Float32Array(N).fill(0.5);
  /** Normal map strength. */
  bump = 3;

  /** Stamps a soft ellipse, wrapping across tile edges. `fn` receives the 0..1 falloff and the local coords. */
  stamp(cx: number, cy: number, rx: number, ry: number, rot: number, fn: (k: number, lx: number, ly: number, i: number) => void): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const ext = Math.ceil(Math.max(rx, ry)) + 1;
    for (let oy = -ext; oy <= ext; oy++)
      for (let ox = -ext; ox <= ext; ox++) {
        const lx = (ox * c + oy * s) / rx;
        const ly = (-ox * s + oy * c) / ry;
        const d = lx * lx + ly * ly;
        if (d >= 1) continue;
        const x = (((Math.round(cx) + ox) % T) + T) % T;
        const y = (((Math.round(cy) + oy) % T) + T) % T;
        fn(1 - d, lx, ly, x + y * T);
      }
  }

  /** Draws a soft line, wrapping across tile edges. */
  line(x0: number, y0: number, x1: number, y1: number, w: number, fn: (k: number, t: number, i: number) => void): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len * 1.5));
    const seen = new Set<number>();
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      const ext = Math.ceil(w) + 1;
      for (let oy = -ext; oy <= ext; oy++)
        for (let ox = -ext; ox <= ext; ox++) {
          const px = Math.round(cx) + ox;
          const py = Math.round(cy) + oy;
          const d = Math.hypot(px - cx, py - cy);
          if (d > w) continue;
          const x = ((px % T) + T) % T;
          const y = ((py % T) + T) % T;
          const i = x + y * T;
          if (seen.has(i)) continue;
          seen.add(i);
          fn(1 - d / w, t, i);
        }
    }
  }

  /** Distance in pixels to the nearest tile edge. */
  static edge(x: number, y: number): number {
    return Math.min(x + 0.5, T - x - 0.5, y + 0.5, T - y - 0.5);
  }
}

// ---------------------------------------------------------------- materials

function stone(t: Tile, v: number, seed: number): void {
  // Coursed limestone: two courses per cell with staggered vertical joints, so
  // walls read as masonry rather than a grid. The base noise is shared by every
  // variant (same seed) so neighbouring cells meet without a seam.
  const r = rng(seed);
  const patches = fbm(3, 3, 3, 1000);
  const fine = fbm(8, 8, 4, 1007);
  const grain = valueField(48, 48, 1009);
  const pits = valueField(32, 32, 1013);
  const ch = T / 2;
  const joints: number[][] = [];
  for (let c = 0; c < 2; c++) {
    const list: number[] = [];
    const n = r() < 0.25 ? 0 : r() < 0.75 ? 1 : 2;
    for (let k = 0; k < n; k++) list.push(T * (0.18 + r() * 0.64));
    if (c === 1 && joints[0].length && list.length && Math.abs(list[0] - joints[0][0]) < T * 0.2) list[0] = (list[0] + T * 0.4) % T;
    joints.push(list);
  }
  for (let y = 0; y < T; y++) {
    const c = Math.floor(y / ch);
    for (let x = 0; x < T; x++) {
      const i = x + y * T;
      const wob = (fine[i] - 0.5) * 4;
      const ly = y - c * ch;
      let e = Math.min(ly + 0.5, ch - ly - 0.5);
      for (const jx of joints[c]) e = Math.min(e, Math.abs(x - jx));
      e += wob;
      const joint = 1 - sstep(0.8, 3.2, e);
      const round = 1 - sstep(0, 7, e);
      const pit = sstep(0.74, 0.86, pits[i]) * (0.5 + grain[i]);
      t.r[i] = sstep(0.38, 0.72, patches[i]) * 0.7 + grain[i] * 0.15;
      t.g[i] = 0.5 + (fine[i] - 0.5) * 0.4 + (grain[i] - 0.5) * 0.12 - pit * 0.22 - joint * 0.08 + round * 0.03;
      t.b[i] = 0.5 + (fine[i] - 0.5) * 0.5 + pit * 0.2;
      t.a[i] = joint * 0.7;
      t.h[i] = 0.55 + (fine[i] - 0.5) * 0.35 + (grain[i] - 0.5) * 0.05 - pit * 0.25 - joint * 0.35 - round * round * 0.12;
    }
  }
  if (v === 1 || v === 3) {
    // A crack wandering across one block.
    let x = T * (0.25 + r() * 0.5);
    let y = T * (0.25 + r() * 0.5);
    let ang = r() * Math.PI * 2;
    for (let s = 0; s < 9; s++) {
      const nx = x + Math.cos(ang) * 5;
      const ny = y + Math.sin(ang) * 5;
      t.line(x, y, nx, ny, 1.3 - s * 0.08, (k, _t, i) => {
        t.h[i] -= k * 0.3;
        t.g[i] -= k * 0.14;
      });
      x = nx;
      y = ny;
      ang += (r() - 0.5) * 1.1;
    }
  }
  if (v === 2) {
    // A chipped block edge along a joint.
    const c = Math.floor(r() * 2);
    const cx = T * (0.3 + r() * 0.4);
    t.stamp(cx, c * ch + (r() < 0.5 ? 2 : ch - 2), 14, 7, 0, (k, _lx, _ly, i) => {
      t.h[i] -= sstep(0, 0.3, k) * 0.22;
      t.g[i] += sstep(0, 0.4, k) * 0.07;
    });
  }
  if (v === 3) {
    // Lichen.
    for (let n = 0; n < 5; n++)
      t.stamp(T * (0.15 + r() * 0.7), T * (0.15 + r() * 0.7), 3 + r() * 6, 3 + r() * 5, r() * 3, (k, _lx, _ly, i) => {
        t.r[i] = Math.max(t.r[i], sstep(0.1, 0.5, k) * 0.95);
        t.g[i] += k * 0.05;
      });
  }
  t.bump = 3.2;
}

function brick(t: Tile, v: number, seed: number): void {
  // Tones come from a shared seed so bricks that straddle cells match.
  const r = rng(2000);
  const rv = rng(seed);
  const fine = fbm(8, 8, 4, 2001);
  const grain = valueField(40, 40, 2005);
  const courses = 4;
  const ch = T / courses;
  const bw = T / 2;
  const mortar = 2.6;
  const bricks: { r: number; g: number; b: number; soot: number }[] = [];
  for (let k = 0; k < courses * 3; k++)
    bricks.push({ r: r() * 0.85, g: 0.42 + r() * 0.18, b: 0.42 + r() * 0.2, soot: r() < 0.18 ? r() * 0.2 : 0 });
  for (let y = 0; y < T; y++) {
    const c = Math.floor(y / ch);
    const off = c % 2 ? bw / 2 : 0;
    for (let x = 0; x < T; x++) {
      const i = x + y * T;
      const xx = (x + off) % T;
      const bi = Math.floor(xx / bw);
      const lx = xx - bi * bw;
      const ly = y - c * ch;
      const n = (fine[i] - 0.5) * 3;
      const d = Math.min(lx, bw - lx, ly, ch - ly) + n;
      const m = 1 - sstep(mortar - 0.8, mortar + 0.8, d);
      const br = bricks[(c * 3 + bi) % bricks.length];
      t.r[i] = br.r + (grain[i] - 0.5) * 0.25;
      t.g[i] = br.g + (fine[i] - 0.5) * 0.3 - br.soot - (v === 3 ? (y / T) * 0.08 : 0);
      t.b[i] = br.b + (grain[i] - 0.5) * 0.2;
      t.a[i] = m;
      t.h[i] = (1 - m) * (0.62 + (fine[i] - 0.5) * 0.2 + sstep(0, 4, d) * 0.1) + m * 0.2;
    }
  }
  if (v === 2) {
    // One brick worn and lighter.
    const c = Math.floor(rv() * courses);
    const cx = (c % 2 ? -bw / 2 : 0) + Math.floor(rv() * 2) * bw + bw / 2;
    t.stamp(cx, c * ch + ch / 2, bw / 2 - 3, ch / 2 - 3, 0, (k, _lx, _ly, i) => {
      t.g[i] += sstep(0, 0.4, k) * 0.1;
      t.h[i] -= sstep(0, 0.5, k) * 0.1;
    });
  }
  t.bump = 4;
}

function wood(t: Tile, v: number, seed: number): void {
  const r = rng(3000);
  const rv = rng(seed);
  const planks = 4;
  const ph = T / planks;
  const streak = fbm(2, 28, 3, 3001);
  const fine = fbm(4, 16, 3, 3003);
  const ends: number[] = [];
  const tones: number[] = [];
  for (let p = 0; p < planks; p++) {
    ends.push(Math.floor(r() * T));
    tones.push(r() * 0.6);
  }
  for (let y = 0; y < T; y++) {
    const p = Math.floor(y / ph);
    const ly = y - p * ph;
    for (let x = 0; x < T; x++) {
      const i = x + y * T;
      const gap = 1 - sstep(0.6, 1.8, Math.min(ly, ph - ly));
      let dx = Math.abs(x - ends[p]);
      if (dx > T / 2) dx = T - dx;
      const butt = 1 - sstep(0.4, 1.4, dx);
      const g = Math.sin((y + streak[i] * 14) * 1.3) * 0.5 + 0.5;
      t.r[i] = tones[p] + g * 0.35 + (fine[i] - 0.5) * 0.2;
      t.g[i] = 0.5 + (streak[i] - 0.5) * 0.35 + g * 0.06;
      t.b[i] = 0.5 + (fine[i] - 0.5) * 0.4;
      t.a[i] = Math.max(gap, butt);
      t.h[i] = 0.6 - g * 0.05 - Math.max(gap, butt) * 0.5 + (fine[i] - 0.5) * 0.06;
    }
  }
  const knots = v === 0 ? 1 : v === 1 ? 2 : v === 2 ? 0 : 1;
  for (let k = 0; k < knots; k++) {
    const cx = T * (0.2 + rv() * 0.6);
    const cy = Math.floor(rv() * planks) * ph + ph / 2;
    t.stamp(cx, cy, 9, 5, 0, (kk, lx, ly, i) => {
      const d = Math.sqrt(lx * lx + ly * ly);
      t.r[i] = Math.min(1, t.r[i] + kk * 0.6 + Math.sin(d * 18) * 0.15 * kk);
      t.g[i] -= kk * 0.12;
      t.h[i] -= kk * 0.08;
    });
  }
  // Nails at plank ends.
  for (let p = 0; p < planks; p++)
    for (const s of [-4, 4]) {
      const nx = (ends[p] + s + T) % T;
      t.stamp(nx, p * ph + ph / 2, 1.6, 1.6, 0, (kk, _lx, _ly, i) => {
        t.g[i] = 0.25;
        t.h[i] += kk * 0.2;
      });
    }
  t.bump = 2.4;
}

function brass(t: Tile, v: number, seed: number): void {
  const brush = fbm(2, 64, 2, seed);
  const blot = fbm(4, 4, 3, seed + 3);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const i = x + y * T;
      const e = Tile.edge(x, y);
      const groove = 1 - sstep(0.6, 1.6, Math.abs(e - 9));
      t.r[i] = sstep(0.55, 0.8, blot[i] + (1 - sstep(0, 20, e)) * 0.25) * 0.8;
      t.g[i] = 0.5 + (brush[i] - 0.5) * 0.25 - groove * 0.25;
      t.b[i] = 0.5 + (brush[i] - 0.5) * 0.6 + t.r[i] * 0.4;
      t.a[i] = groove * 0.6;
      t.h[i] = 0.6 + (e < 9 ? 0.06 : 0) - groove * 0.3 + (brush[i] - 0.5) * 0.02;
    }
  const rivet = (cx: number, cy: number) =>
    t.stamp(cx, cy, 4.2, 4.2, 0, (k, lx, ly, i) => {
      t.h[i] = 0.6 + Math.sqrt(k) * 0.4;
      t.g[i] = 0.5 + (0.25 - (lx + ly) * 0.2) * Math.sqrt(k);
      t.b[i] = 0.3;
      t.a[i] = 0;
      t.r[i] *= 0.3;
    });
  if (v === 0 || v === 1) for (const cx of [4.5, T - 4.5]) for (const cy of [4.5, T - 4.5]) rivet(cx, cy);
  if (v === 1) for (const c of [[T / 2, 4.5], [T / 2, T - 4.5], [4.5, T / 2], [T - 4.5, T / 2]]) rivet(c[0], c[1]);
  if (v === 2) {
    // Five engraved staff lines.
    for (let l = 0; l < 5; l++) {
      const y = 34 + l * 15;
      t.line(14, y, T - 14, y, 1.2, (k, _t, i) => {
        t.h[i] -= k * 0.25;
        t.g[i] -= k * 0.18;
      });
    }
  }
  if (v === 3) {
    // A round boss in the middle.
    t.stamp(T / 2, T / 2, 26, 26, 0, (k, _lx, _ly, i) => {
      const ring = 1 - sstep(0.02, 0.1, Math.abs(k - 0.25));
      t.h[i] += ring * 0.3 + sstep(0.6, 1, k) * 0.2;
      t.g[i] += ring * 0.08;
    });
  }
  t.bump = 2.2;
}

function dark(t: Tile, _v: number, _seed: number): void {
  const r = rng(4000);
  const strata = fbm(3, 10, 3, 4001);
  const fine = fbm(8, 8, 3, 4005);
  const w = worley(7, r);
  for (let i = 0; i < N; i++) {
    const crack = 1 - sstep(0.6, 2.2, w.d2[i] - w.d1[i]);
    t.r[i] = sstep(0.4, 0.65, strata[i]) * 0.8 + w.id[i] * 0.15;
    t.g[i] = 0.47 + (fine[i] - 0.5) * 0.3 + w.id[i] * 0.08 - crack * 0.2;
    t.b[i] = 0.5 + (fine[i] - 0.5) * 0.4 - w.id[i] * 0.1;
    t.a[i] = crack * 0.4;
    t.h[i] = 0.55 + w.id[i] * 0.08 + (fine[i] - 0.5) * 0.12 - crack * 0.4;
  }
  t.bump = 3.4;
}

function crystal(t: Tile, _v: number, seed: number): void {
  const r = rng(seed);
  const w = worley(6 + Math.floor(r() * 4), r);
  const fine = fbm(6, 6, 3, seed);
  for (let i = 0; i < N; i++) {
    const edge = 1 - sstep(0.5, 2.5, w.d2[i] - w.d1[i]);
    const facet = 1 - Math.min(1, w.d1[i] / 30);
    t.r[i] = w.id[i] * 0.9;
    t.g[i] = 0.4 + facet * 0.25 + edge * 0.35 + (fine[i] - 0.5) * 0.1;
    t.b[i] = 0.25 + edge * 0.2;
    t.a[i] = Math.min(1, 0.15 + facet * 0.85 * (0.6 + w.id[i] * 0.4));
    t.h[i] = 0.3 + facet * 0.5 + edge * 0.25;
  }
  t.bump = 4.5;
}

function leaf(t: Tile, _v: number, seed: number): void {
  const r = rng(seed);
  const base = fbm(4, 4, 3, seed);
  for (let i = 0; i < N; i++) {
    t.r[i] = base[i] * 0.6;
    t.g[i] = 0.2 + base[i] * 0.1;
    t.b[i] = 0.7;
    t.a[i] = 0.7;
    t.h[i] = 0.2;
  }
  const count = 120;
  for (let n = 0; n < count; n++) {
    const tone = r();
    const lum = 0.42 + r() * 0.3;
    const layer = n / count;
    t.stamp(r() * T, r() * T, 7 + r() * 4, 3.5 + r() * 1.5, r() * Math.PI * 2, (k, lx, ly, i) => {
      const rib = 1 - sstep(0.03, 0.12, Math.abs(ly));
      t.r[i] = tone;
      t.g[i] = lum + lx * 0.08 - rib * 0.06 + k * 0.08;
      t.b[i] = 0.5;
      t.a[i] = 0;
      t.h[i] = 0.35 + layer * 0.4 + Math.sqrt(k) * 0.2;
    });
  }
  t.bump = 3;
}

function marble(t: Tile, v: number, _seed: number): void {
  const warp = fbm(3, 3, 5, 5000);
  const fine = fbm(8, 8, 3, 5004);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const i = x + y * T;
      const u = x / T;
      const w = y / T;
      // Periodic projection keeps the veins tileable.
      const p = 2 * u + 1 * w;
      const s = Math.abs(Math.sin((p + warp[i] * 1.6) * Math.PI * 2));
      const vein = 1 - sstep(0.0, 0.07 + fine[i] * 0.05, s);
      const ey = Math.min(y + 0.5, T - y - 0.5);
      const groove = 1 - sstep(0.4, 1.4, ey);
      t.r[i] = Math.min(1, vein * 0.85 + warp[i] * 0.25);
      t.g[i] = 0.55 + (fine[i] - 0.5) * 0.08 - vein * 0.1 - groove * 0.06;
      t.b[i] = 0.42 + vein * 0.15;
      t.a[i] = groove * 0.45;
      t.h[i] = 0.6 - groove * 0.3 - vein * 0.02;
    }
  if (v === 3) {
    // A lozenge inlay.
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const i = x + y * T;
        const d = Math.abs(x - T / 2) + Math.abs(y - T / 2);
        const line = 1 - sstep(0.8, 1.8, Math.abs(d - 38));
        t.a[i] = Math.max(t.a[i], line * 0.9);
        t.h[i] -= line * 0.1;
      }
  }
  t.bump = 1.4;
}

// ---------------------------------------------------------------- caps (world-space, two cells per repeat)

function grass(t: Tile, seed: number): void {
  const r = rng(seed);
  const clump = fbm(4, 4, 3, seed);
  const fine = fbm(16, 16, 2, seed + 1);
  for (let i = 0; i < N; i++) {
    t.r[i] = sstep(0.35, 0.75, clump[i]) * 0.7;
    t.g[i] = 0.32 + fine[i] * 0.12;
    t.b[i] = clump[i];
    t.h[i] = 0.3 + fine[i] * 0.1;
  }
  for (let n = 0; n < 1700; n++) {
    const x = r() * T;
    const y = r() * T;
    const a = r() * Math.PI * 2;
    const len = 2 + r() * 4;
    const tone = Math.min(1, clump[Math.floor(x) + Math.floor(y) * T] * 0.8 + r() * 0.4);
    const lum = 0.45 + r() * 0.35;
    t.line(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 0.9, (k, tt, i) => {
      t.r[i] = tone;
      t.g[i] = lum * (0.75 + tt * 0.35);
      t.h[i] = 0.5 + tt * 0.3 * k;
    });
  }
  t.bump = 2.5;
}

function moss(t: Tile, seed: number): void {
  const r = rng(seed);
  const a = fbm(6, 6, 4, seed);
  const b = fbm(3, 3, 3, seed + 2);
  for (let i = 0; i < N; i++) {
    const blob = sstep(0.4, 0.6, a[i]);
    t.r[i] = b[i] * 0.8;
    t.g[i] = 0.35 + blob * 0.3 + (a[i] - 0.5) * 0.2;
    t.b[i] = b[i];
    t.h[i] = 0.3 + blob * 0.4;
  }
  for (let n = 0; n < 500; n++)
    t.stamp(r() * T, r() * T, 1.2, 1.2, 0, (k, _lx, _ly, i) => {
      t.g[i] += k * 0.25;
      t.h[i] += k * 0.1;
    });
  t.bump = 2.5;
}

function leaves(t: Tile, seed: number): void {
  const r = rng(seed);
  const ground = fbm(5, 5, 3, seed);
  for (let i = 0; i < N; i++) {
    t.r[i] = 1;
    t.g[i] = 0.22 + ground[i] * 0.1;
    t.a[i] = 0.8;
    t.b[i] = ground[i];
    t.h[i] = 0.2;
  }
  for (let n = 0; n < 150; n++) {
    const tone = r();
    const lum = 0.45 + r() * 0.35;
    const layer = n / 150;
    t.stamp(r() * T, r() * T, 8 + r() * 4, 4 + r() * 2, r() * Math.PI * 2, (k, lx, ly, i) => {
      const pointed = Math.abs(ly) < (1 - Math.abs(lx)) * 1.1;
      if (!pointed) return;
      const rib = 1 - sstep(0.02, 0.1, Math.abs(ly));
      t.r[i] = tone;
      t.g[i] = lum - rib * 0.1;
      t.a[i] = 0;
      t.h[i] = 0.4 + layer * 0.3 + k * 0.15;
    });
  }
  t.bump = 2.8;
}

function snow(t: Tile, seed: number): void {
  const r = rng(seed);
  const drift = fbm(3, 3, 4, seed);
  for (let i = 0; i < N; i++) {
    t.r[i] = drift[i] * 0.4;
    t.g[i] = 0.8 + (drift[i] - 0.5) * 0.12;
    t.b[i] = drift[i];
    t.h[i] = 0.4 + drift[i] * 0.3;
  }
  for (let n = 0; n < 220; n++) {
    const i = Math.floor(r() * N);
    t.g[i] = 1;
  }
  t.bump = 1.6;
}

function carpet(t: Tile, seed: number): void {
  // Crimson velvet with a quiet damask: fine pile, soft tone shifts, thin gold thread.
  const pile = fbm(48, 48, 2, seed);
  const soft = fbm(4, 4, 3, seed + 1);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const i = x + y * T;
      const u = ((x / T) * 4) % 1;
      const v = ((y / T) * 4) % 1;
      const dx = Math.abs(u - 0.5);
      const dy = Math.abs(v - 0.5);
      const loz = Math.abs(dx + dy - 0.5);
      const dot = Math.hypot(dx, dy);
      const motif = Math.max(1 - sstep(0.015, 0.04, loz), 1 - sstep(0.04, 0.08, dot));
      t.r[i] = soft[i] * 0.6 + motif * 0.35;
      t.g[i] = 0.46 + (pile[i] - 0.5) * 0.16 + (soft[i] - 0.5) * 0.12 - motif * 0.05;
      t.b[i] = soft[i];
      t.a[i] = motif * 0.28;
      t.h[i] = 0.5 + motif * 0.12 + (pile[i] - 0.5) * 0.1;
    }
  t.bump = 1.6;
}

// ---------------------------------------------------------------- assembly

export interface SurfaceTextures {
  detail: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
}

let cached: SurfaceTextures | null = null;

/** The block texture arrays. Built on first use and kept for the whole session. */
export function surfaceTextures(): SurfaceTextures {
  if (cached) return cached;
  const det = new Uint8Array(N * 4 * LAYERS);
  const nor = new Uint8Array(N * 4 * LAYERS);
  const gens = [stone, brick, wood, brass, dark, crystal, leaf, marble];
  const caps = [grass, moss, leaves, snow, carpet];
  for (let layer = 0; layer < LAYERS; layer++) {
    const t = new Tile();
    if (layer < CAP_BASE) {
      const m = Math.floor(layer / VARIANTS);
      const v = layer % VARIANTS;
      gens[m](t, v, 1000 + layer * 37);
    } else caps[layer - CAP_BASE](t, 5000 + layer * 41);
    writeLayer(t, det, nor, layer);
  }
  const mk = (data: Uint8Array) => {
    const tex = new THREE.DataArrayTexture(data, T, T, LAYERS);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  };
  cached = { detail: mk(det), normal: mk(nor) };
  return cached;
}

function writeLayer(t: Tile, det: Uint8Array, nor: Uint8Array, layer: number): void {
  const off = layer * N * 4;
  const q = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  for (let i = 0; i < N; i++) {
    det[off + i * 4] = q(t.r[i]);
    det[off + i * 4 + 1] = q(t.g[i]);
    det[off + i * 4 + 2] = q(t.b[i]);
    det[off + i * 4 + 3] = q(t.a[i]);
  }
  const s = t.bump;
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const i = x + y * T;
      const hl = t.h[((x + T - 1) % T) + y * T];
      const hr = t.h[((x + 1) % T) + y * T];
      const hd = t.h[x + ((y + T - 1) % T) * T];
      const hu = t.h[x + ((y + 1) % T) * T];
      let nx = (hl - hr) * s;
      let ny = (hd - hu) * s;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      nor[off + i * 4] = q(nx * 0.5 + 0.5);
      nor[off + i * 4 + 1] = q(ny * 0.5 + 0.5);
      nor[off + i * 4 + 2] = q(nz * 0.5 + 0.5);
      nor[off + i * 4 + 3] = 255;
    }
}

// ---------------------------------------------------------------- sprites (canvas)

/** Sprite atlas cells (4 x 4 grid). */
export const SPRITE = {
  dot: 0,
  star: 1,
  drop: 2,
  leaf: 3,
  petal: 4,
  puff: 5,
  ring: 6,
  streak: 7,
  note: 8,
  sparkle: 9,
  halo: 10,
  mist: 11,
  fly: 12,
} as const;

let spriteTex: THREE.CanvasTexture | null = null;

/** White sprites on transparent, tinted per particle. */
export function spriteAtlas(): THREE.CanvasTexture {
  if (spriteTex) return spriteTex;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S * 4;
  c.height = S * 4;
  const g = c.getContext('2d')!;
  const cell = (k: number) => ({ x: (k % 4) * S, y: Math.floor(k / 4) * S });
  const radial = (k: number, inner: number, outer: number, stops: [number, number][]) => {
    const { x, y } = cell(k);
    const gr = g.createRadialGradient(x + S / 2, y + S / 2, inner, x + S / 2, y + S / 2, outer);
    for (const [o, a] of stops) gr.addColorStop(o, `rgba(255,255,255,${a})`);
    g.fillStyle = gr;
    g.fillRect(x, y, S, S);
  };
  radial(SPRITE.dot, 0, S / 2, [[0, 1], [0.35, 0.8], [1, 0]]);
  radial(SPRITE.halo, 0, S / 2, [[0, 0.9], [0.15, 0.5], [0.45, 0.15], [1, 0]]);
  radial(SPRITE.mist, 0, S / 2, [[0, 0.5], [0.5, 0.25], [1, 0]]);
  radial(SPRITE.fly, 0, S / 2, [[0, 1], [0.12, 1], [0.3, 0.35], [1, 0]]);
  {
    // Four-point star.
    const { x, y } = cell(SPRITE.star);
    g.save();
    g.translate(x + S / 2, y + S / 2);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rad = i % 2 ? S * 0.09 : S * 0.48;
      g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    g.fill();
    g.restore();
  }
  {
    // Ink droplet: a round drop with a highlight.
    const { x, y } = cell(SPRITE.drop);
    g.save();
    g.translate(x + S / 2, y + S / 2);
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath();
    g.arc(0, 4, S * 0.3, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(-S * 0.2, -2);
    g.quadraticCurveTo(0, -S * 0.5, S * 0.2, -2);
    g.fill();
    g.restore();
  }
  {
    // Leaf with a midrib.
    const { x, y } = cell(SPRITE.leaf);
    g.save();
    g.translate(x + S / 2, y + S / 2);
    g.rotate(0.6);
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath();
    g.moveTo(0, -S * 0.42);
    g.quadraticCurveTo(S * 0.32, 0, 0, S * 0.42);
    g.quadraticCurveTo(-S * 0.32, 0, 0, -S * 0.42);
    g.fill();
    g.strokeStyle = 'rgba(160,160,160,1)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -S * 0.38);
    g.lineTo(0, S * 0.38);
    g.stroke();
    g.restore();
  }
  {
    const { x, y } = cell(SPRITE.petal);
    g.save();
    g.translate(x + S / 2, y + S / 2);
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath();
    g.ellipse(0, 0, S * 0.22, S * 0.36, 0.4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  {
    // Dust puff: overlapping soft blobs.
    const { x, y } = cell(SPRITE.puff);
    const r = rng(77);
    for (let i = 0; i < 9; i++) {
      const px = x + S / 2 + (r() - 0.5) * S * 0.35;
      const py = y + S / 2 + (r() - 0.5) * S * 0.35;
      const rad = S * (0.16 + r() * 0.14);
      const gr = g.createRadialGradient(px, py, 0, px, py, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x, y, S, S);
    }
  }
  {
    const { x, y } = cell(SPRITE.ring);
    g.save();
    g.translate(x + S / 2, y + S / 2);
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.15 + (i === 3 ? 0.85 : 0.1)})`;
      g.lineWidth = 6 - Math.abs(i - 3) * 1.5;
      g.beginPath();
      g.arc(0, 0, S * 0.38, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }
  {
    const { x, y } = cell(SPRITE.streak);
    const gr = g.createLinearGradient(x, y + S / 2, x + S, y + S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.7, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x + S / 2, y + S / 2, S * 0.48, S * 0.08, 0, 0, Math.PI * 2);
    g.fill();
  }
  {
    // A tiny eighth note.
    const { x, y } = cell(SPRITE.note);
    g.save();
    g.translate(x + S / 2, y + S / 2);
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath();
    g.ellipse(-6, 14, 10, 7, -0.4, 0, Math.PI * 2);
    g.fill();
    g.fillRect(2, -22, 4, 36);
    g.beginPath();
    g.moveTo(6, -22);
    g.quadraticCurveTo(22, -12, 16, 4);
    g.quadraticCurveTo(16, -8, 6, -10);
    g.fill();
    g.restore();
  }
  {
    // Sparkle: a thin cross with a soft core.
    const { x, y } = cell(SPRITE.sparkle);
    g.save();
    g.translate(x + S / 2, y + S / 2);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.18);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(-S / 2, -S / 2, S, S);
    for (const a of [0, Math.PI / 2]) {
      g.save();
      g.rotate(a);
      const lg = g.createLinearGradient(-S / 2, 0, S / 2, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,1)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      g.fillRect(-S / 2, -1.2, S, 2.4);
      g.restore();
    }
    g.restore();
  }
  spriteTex = new THREE.CanvasTexture(c);
  spriteTex.colorSpace = THREE.NoColorSpace;
  spriteTex.generateMipmaps = true;
  spriteTex.minFilter = THREE.LinearMipmapLinearFilter;
  return spriteTex;
}

let cloudTex: THREE.CanvasTexture | null = null;

/**
 * Painted cumulus sprites, 4 in a 2 x 2 atlas. R is lit-side amount, G is
 * density shading, A is coverage. Tinted by the sky shader.
 */
export function cloudAtlas(): THREE.CanvasTexture {
  if (cloudTex) return cloudTex;
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W * 2;
  c.height = H * 2;
  const g = c.getContext('2d')!;
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * W;
    const oy = Math.floor(k / 2) * H;
    const r = rng(300 + k * 17);
    const puffs: [number, number, number][] = [];
    const n = 16 + Math.floor(r() * 10);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const px = W * (0.12 + t * 0.76) + (r() - 0.5) * 40;
      const hump = Math.sin(t * Math.PI);
      const py = H * 0.68 - hump * H * (0.22 + r() * 0.2) + (r() - 0.5) * 20;
      const pr = 30 + hump * 55 * (0.6 + r() * 0.6);
      puffs.push([px, py, pr]);
    }
    // Base coverage (alpha) in white, with a flat-ish bottom.
    g.save();
    g.beginPath();
    g.rect(ox, oy, W, H);
    g.clip();
    for (const [px, py, pr] of puffs) {
      const gr = g.createRadialGradient(ox + px, oy + py, pr * 0.2, ox + px, oy + py, pr);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(0.75, 'rgba(255,255,255,0.75)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(ox + px, oy + py, pr, 0, Math.PI * 2);
      g.fill();
    }
    // Shade the underside: multiply the colour channels towards a darker tone with height.
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, oy + H * 0.25, 0, oy + H * 0.85);
    sh.addColorStop(0, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(70,70,70,0.75)');
    g.fillStyle = sh;
    g.fillRect(ox, oy, W, H);
    // Inner puffs give painterly modelling.
    for (const [px, py, pr] of puffs) {
      const gr = g.createRadialGradient(ox + px - pr * 0.25, oy + py - pr * 0.3, 0, ox + px, oy + py, pr * 0.9);
      gr.addColorStop(0, 'rgba(255,255,255,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(ox + px, oy + py, pr, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    g.globalCompositeOperation = 'source-over';
  }
  cloudTex = new THREE.CanvasTexture(c);
  cloudTex.colorSpace = THREE.NoColorSpace;
  return cloudTex;
}

let moonTex: THREE.CanvasTexture | null = null;

/** A pale moon with soft maria. */
export function moonTexture(): THREE.CanvasTexture {
  if (moonTex) return moonTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  const r = rng(99);
  g.fillStyle = '#f4f1e6';
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.clip();
  for (let i = 0; i < 26; i++) {
    const x = S / 2 + (r() - 0.5) * S * 0.8;
    const y = S / 2 + (r() - 0.5) * S * 0.8;
    const rad = 6 + r() * (i < 6 ? 40 : 14);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(150,150,165,${i < 6 ? 0.35 : 0.5})`);
    gr.addColorStop(1, 'rgba(150,150,165,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  const lim = g.createRadialGradient(S * 0.45, S * 0.45, S * 0.2, S / 2, S / 2, S * 0.48);
  lim.addColorStop(0, 'rgba(0,0,0,0)');
  lim.addColorStop(1, 'rgba(40,40,60,0.35)');
  g.fillStyle = lim;
  g.fillRect(0, 0, S, S);
  g.restore();
  moonTex = new THREE.CanvasTexture(c);
  moonTex.colorSpace = THREE.SRGBColorSpace;
  return moonTex;
}
