import type { DecorKind } from '../game/types';
import { mix, rgb, css, type RGB } from './color';
import type { Env, Proj } from './env';
import { hash, hs, noise1 } from './rand';
import { Sketch } from './sketch';
import type { DecorInfo } from './world';

/**
 * The 19 kinds of decor as ink illustrations. Each is varied by its seed. Static
 * parts are baked into the cached page; moving parts (a turning gear, a waving
 * banner, flames, glows, a swaying bell) are drawn live every frame.
 */

export type DecorMode = 'static' | 'live' | 'all';

const sk = new Sketch();

type Drawer = (s: Sketch, r: () => number, mode: DecorMode, env: Env) => void;

export function drawDecor(ctx: CanvasRenderingContext2D, env: Env, p: Proj, di: DecorInfo, boil: number, mode: DecorMode): void {
  const d = di.def;
  const fn = DRAW[d.kind];
  if (!fn) return;
  if (mode === 'live' && !di.live) return;
  sk.set(ctx, env, p, d.pos.x, d.pos.y, di.z, d.scale || 1, d.seed, boil);
  let a = d.seed >>> 0;
  const r = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  fn(sk, r, mode, env);
}

const showStatic = (m: DecorMode) => m !== 'live';
const showLive = (m: DecorMode) => m !== 'static';

function matC(s: Sketch, m: 'stone' | 'brick' | 'wood' | 'brass' | 'dark' | 'crystal' | 'leaf' | 'marble', second = false): RGB {
  const look = s.T.pal.mats[m];
  return rgb(second ? look.color2 : look.color);
}

/** Scalloped foliage outline around a centre, as local control points. */
function scallop(cx: number, cy: number, rx: number, ry: number, lobes: number, seed: number, depth = 0.16): number[] {
  const out: number[] = [];
  const n = lobes * 4;
  const ph = hash(seed, 3) * Math.PI;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const lobe = Math.sqrt(Math.abs(Math.sin((a * lobes) / 2 + ph)));
    const k = 1 - depth + depth * lobe + hs(seed, i, 4) * 0.04;
    out.push(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k);
  }
  return out;
}

// ---------------------------------------------------------------- kinds

const tree: Drawer = (s, r) => {
  const leaf = matC(s, 'leaf');
  const wood = matC(s, 'wood');
  const R = 0.95 + r() * 0.35;
  const th = 1.35 + r() * 0.45;
  const lean = (r() - 0.5) * 0.25;
  const cx = lean;
  const cy = th + R * 0.72;
  // Trunk with a root flare and two limbs into the crown.
  s.shape([-0.17, 0, -0.1, 0.25, -0.08, th * 0.7, -0.07 + lean * 0.6, th + 0.2, 0.07 + lean * 0.6, th + 0.2, 0.09, th * 0.7, 0.11, 0.25, 0.2, 0], s.col(wood), 1);
  s.line([0, th * 0.75, -0.35 + lean, th + 0.45, -0.55 + lean, th + 0.7], 0.8);
  s.line([0.03, th * 0.85, 0.35 + lean, th + 0.55], 0.7);
  s.marks([-0.03, 0.15, -0.02, th * 0.6, 0.04, 0.3, 0.03, th * 0.5], s.darker(wood), 0.9, 0.6);
  // Crown: a scalloped cloud of leaves, shaded below and to the right.
  const crown = scallop(cx, cy, R, R * 0.86, 7 + Math.floor(r() * 3), s.seed);
  s.shape(crown, s.col(leaf), 1.05);
  s.clip(crown, () => {
    s.blot(cx + R * 0.4, cy - R * 0.55, R * 0.9, R * 0.6, s.env.pats.hatch, 0.32);
    s.blot(cx + R * 0.55, cy - R * 0.75, R * 0.55, R * 0.35, s.env.pats.cross, 0.25);
  });
  // Inner clumps and a light catch on the upper left.
  const segs: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * 0.6 * R;
    const ux = cx + Math.cos(a) * d;
    const uy = cy + Math.sin(a) * d * 0.8;
    s.line([ux - 0.18, uy + 0.02, ux, uy - 0.07, ux + 0.18, uy + 0.03], 0.55, undefined, 0.6);
  }
  for (let i = 0; i < 4; i++) {
    const ux = cx - R * 0.45 + r() * R * 0.4;
    const uy = cy + R * 0.3 + r() * R * 0.3;
    segs.push(ux, uy, ux + 0.14, uy + 0.05);
  }
  s.marks(segs, s.lighter(leaf, 0.55), 1.4, 0.7);
};

const pine: Drawer = (s, r) => {
  const leaf = mix(matC(s, 'leaf', true), matC(s, 'leaf'), 0.3);
  s.shape([-0.1, 0, -0.08, 0.7, 0.08, 0.7, 0.11, 0], s.col(matC(s, 'wood')), 0.9);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const v0 = 0.45 + i * 0.78;
    const w = 1.05 - i * 0.2 + r() * 0.06;
    const top = v0 + 1.45 - i * 0.1;
    const teeth = 4 - Math.floor(i / 2);
    const ctrl: number[] = [0 + hs(s.seed, i) * 0.03, top];
    ctrl.push(w * 0.45, v0 + 0.55, w, v0);
    for (let t = teeth - 1; t > 0; t--) {
      const u = -w + (2 * w * t) / teeth;
      ctrl.push(u + w / teeth / 2, v0 + 0.06, u, v0 - 0.04);
    }
    ctrl.push(-w, v0, -w * 0.45, v0 + 0.55);
    s.shape(ctrl, s.col(leaf), 1, { poly: true });
    s.clip(ctrl, () => s.blot(w * 0.6, v0 + 0.3, w * 0.75, 0.9, s.env.pats.hatch, 0.4), true);
  }
};

const lamp: Drawer = (s, r, mode) => {
  const iron = s.T.inv ? mix(s.T.ink, s.T.paper, 0.2) : mix(s.T.ink, rgb('#3a3430'), 0.3);
  const glass = mix(s.T.goldLight, rgb('#fff6d8'), 0.5);
  const hgt = 2.05 + r() * 0.2;
  if (showStatic(mode)) {
    s.shape([-0.2, 0, -0.14, 0.22, -0.05, 0.32, -0.04, hgt, 0.04, hgt, 0.05, 0.32, 0.14, 0.22, 0.2, 0], s.col(iron), 0.9);
    s.seg(-0.09, 0.62, 0.09, 0.62, 0.7);
    s.seg(-0.08, hgt - 0.35, 0.08, hgt - 0.35, 0.7);
    // The lantern head: a cage of glass under a little roof.
    s.shape([-0.17, hgt, -0.22, hgt + 0.38, 0.22, hgt + 0.38, 0.17, hgt], s.col(glass), 0.8);
    s.seg(0, hgt, 0, hgt + 0.38, 0.5);
    s.shape([-0.3, hgt + 0.38, 0, hgt + 0.58, 0.3, hgt + 0.38], s.col(iron), 0.8);
    s.dot(0, hgt + 0.64, 0.04, s.inkColor());
  }
  if (showLive(mode)) {
    const t = s.env.time;
    const f = 0.75 + 0.25 * noise1(t * 3 + s.seed, 5);
    s.dot(0, hgt + 0.19, 0.09 * f, css(mix(s.T.gold, rgb('#fff1c0'), 0.6)), 0.95);
    s.rays(0, hgt + 0.19, 0.3, 0.55 + 0.12 * f, 12, css(s.T.gold), 0.45 * f, t * 0.2, 1.1);
  }
};

const pillar: Drawer = (s, r) => {
  const marble = matC(s, 'marble');
  const fill = s.col(marble);
  const broken = r() < 0.3;
  s.shape([-0.55, 0, -0.55, 0.13, 0.55, 0.13, 0.55, 0], fill, 0.9, { poly: true, misreg: false });
  s.shape([-0.45, 0.13, -0.45, 0.26, 0.45, 0.26, 0.45, 0.13], fill, 0.8, { poly: true, misreg: false });
  const top = broken ? 1.5 + r() * 0.7 : 2.8;
  const shaft = broken
    ? [-0.31, 0.26, -0.29, top - 0.1, -0.15, top + 0.08, -0.02, top - 0.06, 0.12, top + 0.12, 0.28, top - 0.05, 0.31, 0.26]
    : [-0.32, 0.26, -0.28, top, 0.28, top, 0.32, 0.26];
  s.shape(shaft, fill, 1, { poly: true });
  s.clip(shaft, () => s.blot(0.38, top / 2, 0.22, top, s.env.pats.hatch, 0.55), true);
  const fl: number[] = [];
  for (let i = -1; i <= 1; i++) fl.push(i * 0.13, 0.32, i * 0.12, top - 0.12);
  s.marks(fl, s.darker(marble, 0.35), 0.9, 0.65);
  if (!broken) {
    s.shape([-0.42, top, -0.46, top + 0.16, 0.46, top + 0.16, 0.42, top], fill, 0.8);
    // Ionic volutes.
    for (const sd of [-1, 1]) {
      const cx = sd * 0.42;
      s.line([cx, top + 0.08, cx + sd * 0.1, top + 0.16, cx + sd * 0.13, top + 0.06, cx + sd * 0.05, top + 0.02, cx + sd * 0.03, top + 0.08], 0.6);
    }
    s.shape([-0.52, top + 0.16, -0.52, top + 0.28, 0.52, top + 0.28, 0.52, top + 0.16], fill, 0.8, { poly: true, misreg: false });
  } else {
    // A fallen drum of the column at its foot.
    s.shape([0.45, 0, 0.42, 0.22, 0.95, 0.24, 0.98, 0.02], fill, 0.8);
  }
};

const banner: Drawer = (s, r, mode) => {
  const top = 1.5;
  if (showStatic(mode)) {
    s.seg(-0.62, top, 0.62, top, 1);
    s.dot(-0.66, top, 0.05, s.col(s.T.gold));
    s.dot(0.66, top, 0.05, s.col(s.T.gold));
  }
  if (showLive(mode)) {
    const t = s.env.time;
    const ph = r() * 6;
    const wave = (v: number) => Math.sin(t * 1.9 + ph - v * 2.4) * 0.07 * (top - v) * 0.7;
    const bottom = -0.6;
    const ctrl: number[] = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const v = top - ((top - bottom) * i) / steps;
      ctrl.push(-0.5 + wave(v), v);
    }
    ctrl.push(0 + wave(bottom + 0.3), bottom + 0.3);
    for (let i = steps; i >= 0; i--) {
      const v = top - ((top - bottom) * i) / steps;
      ctrl.push(0.5 + wave(v), v);
    }
    const cloth = mix(s.T.rubric, matC(s, 'dark'), 0.15);
    s.shape(ctrl, s.col(cloth), 0.9, { misreg: false });
    // A gold border and a fermata emblem.
    const bctrl: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const v = top - 0.08 - ((top - 0.08 - bottom - 0.12) * i) / steps;
      bctrl.push(-0.4 + wave(v), v);
    }
    s.line(bctrl, 0.55, s.col(s.T.gold), 0.9);
    const bc2: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const v = top - 0.08 - ((top - 0.08 - bottom - 0.12) * i) / steps;
      bc2.push(0.4 + wave(v), v);
    }
    s.line(bc2, 0.55, s.col(s.T.gold), 0.9);
    const ev = 0.6;
    const ew = wave(ev);
    s.line([-0.22 + ew, ev, -0.15 + ew, ev + 0.2, 0.15 + ew, ev + 0.2, 0.22 + ew, ev], 0.9, s.col(s.T.gold), 0.95);
    s.dot(ew, ev + 0.04, 0.05, s.col(s.T.gold));
    s.line([-0.2 + wave(0.9), 0.95, -0.15 + wave(0.2), 0.2], 0.4, s.darker(cloth), 0.5);
    s.line([0.18 + wave(1.0), 1.1, 0.12 + wave(0.0), 0.0], 0.4, s.darker(cloth), 0.5);
  }
};

const FLOWER_COLS = ['#b2362b', '#d6a33a', '#4f6fbf', '#f4eee2', '#c0609a', '#e07a3a'];

const flowers: Drawer = (s, r) => {
  const leaf = matC(s, 'leaf');
  const n = 4 + Math.floor(r() * 3);
  const heads: [number, number, string][] = [];
  for (let i = 0; i < n; i++) {
    const u = -0.4 + (0.8 * (i + r() * 0.6)) / n;
    const hgt = 0.3 + r() * 0.38;
    const tip = u + (r() - 0.5) * 0.18;
    s.line([u, 0, (u + tip) / 2 + 0.03, hgt * 0.5, tip, hgt], 0.45, s.darker(leaf, 0.3));
    if (r() < 0.6) {
      const lv = hgt * (0.25 + r() * 0.3);
      const sd = r() < 0.5 ? -1 : 1;
      s.shape([u + sd * 0.01, lv, u + sd * 0.09, lv + 0.06, u + sd * 0.16, lv + 0.02, u + sd * 0.08, lv - 0.02], s.col(leaf), 0.35, { misreg: false });
    }
    heads.push([tip, hgt, FLOWER_COLS[Math.floor(r() * FLOWER_COLS.length)]]);
  }
  for (const [u, v, c] of heads) {
    const col = s.col(c);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + u * 3;
      s.dot(u + Math.cos(a) * 0.05, v + Math.sin(a) * 0.05, 0.042, col, 0.95);
    }
    s.dot(u, v, 0.03, s.col(s.T.inv ? s.T.gold : mix(s.T.gold, s.T.ink, 0.3)));
  }
};

const grass: Drawer = (s, r) => {
  const leaf = mix(rgb(s.T.pal.topColor), matC(s, 'leaf'), 0.4);
  const n = 9 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const u = -0.35 + (0.7 * i) / n + (r() - 0.5) * 0.06;
    const hgt = 0.35 + r() * 0.42;
    const bend = (r() - 0.5) * 0.5 + u * 0.4;
    s.line([u, 0, u + bend * 0.3, hgt * 0.55, u + bend, hgt], 0.6, i % 3 === 0 ? s.lighter(leaf, 0.2) : s.darker(leaf, 0.35), 0.9);
    if (r() < 0.25) s.dot(u + bend, hgt + 0.03, 0.03, s.darker(rgb('#a08040'), 0.2));
  }
};

const rock: Drawer = (s, r) => {
  const stone = matC(s, 'stone');
  const w = 0.6 + r() * 0.2;
  const hgt = 0.45 + r() * 0.2;
  const ctrl = [-w, 0, -w * 0.95, hgt * 0.45, -w * 0.55, hgt * 0.9, -w * 0.05, hgt, w * 0.5, hgt * 0.85, w * 0.92, hgt * 0.45, w, 0];
  s.shape(ctrl, s.col(stone), 1);
  s.clip(ctrl, () => {
    s.blot(w * 0.55, hgt * 0.1, w * 0.8, hgt * 0.7, s.env.pats.cross, 0.6);
  });
  s.line([-w * 0.2, hgt * 0.95, -w * 0.05, hgt * 0.6, -w * 0.25, hgt * 0.3], 0.5, undefined, 0.7);
  s.marks([-w * 0.6, hgt * 0.6, -w * 0.35, hgt * 0.78], s.lighter(stone, 0.5), 1.5, 0.7);
  // Lichen on the crown.
  s.shape([-w * 0.45, hgt * 0.86, -w * 0.15, hgt * 1.03, w * 0.25, hgt * 0.98, w * 0.05, hgt * 0.85], s.col(s.T.pal.topColor), 0.3, { alpha: 0.85 });
};

const reeds: Drawer = (s, r) => {
  const leaf = mix(matC(s, 'leaf'), rgb(s.T.pal.topColor), 0.4);
  const head = rgb('#5a3a22');
  const n = 4 + Math.floor(r() * 3);
  for (let i = 0; i < 3; i++) {
    const sd = i - 1;
    s.line([sd * 0.05, 0, sd * 0.2, 0.5, sd * 0.45, 0.75 + r() * 0.2], 0.55, s.darker(leaf, 0.2));
  }
  for (let i = 0; i < n; i++) {
    const u = -0.3 + (0.6 * i) / Math.max(1, n - 1);
    const hgt = 1.15 + r() * 0.55;
    const tip = u + (r() - 0.5) * 0.25;
    s.line([u, 0, (u + tip) / 2, hgt * 0.5, tip, hgt], 0.45, s.darker(leaf, 0.35));
    if (r() < 0.75) {
      const hv = hgt - 0.28;
      const hu = u + (tip - u) * (hv / hgt);
      s.ellipse(hu, hv, 0.05, 0.16, 0, s.col(head), 0.5);
    }
  }
};

const lantern: Drawer = (s, r, mode) => {
  const wood = matC(s, 'wood');
  const hgt = 1.85 + r() * 0.2;
  const arm = 0.5;
  if (showStatic(mode)) {
    s.shape([-0.06, 0, -0.05, hgt, 0.05, hgt, 0.06, 0], s.col(wood), 0.8);
    s.line([0, hgt - 0.05, arm * 0.5, hgt + 0.05, arm, hgt - 0.02], 0.7);
    s.seg(-0.18, 0, 0.18, 0, 0.8);
  }
  if (showLive(mode)) {
    const t = s.env.time;
    const sway = Math.sin(t * 1.3 + s.seed) * 0.08;
    const hx = arm;
    const hy = hgt - 0.02;
    const cx = hx + Math.sin(sway) * 0.45;
    const cy = hy - Math.cos(sway) * 0.45;
    s.seg(hx, hy, hx + Math.sin(sway) * 0.2, hy - Math.cos(sway) * 0.2, 0.4);
    const f = 0.8 + 0.2 * noise1(t * 2.5 + s.seed, 9);
    const paper = mix(s.T.rubric, s.T.gold, 0.55);
    s.rays(cx, cy, 0.32, 0.55 + 0.1 * f, 10, css(s.T.gold), 0.4 * f, t * 0.15, 1);
    s.ellipse(cx, cy, 0.2, 0.25, -sway, css(mix(paper, rgb('#fff0c0'), 0.35 * f)), 0.8);
    s.marks([cx - 0.1, cy + 0.2, cx - 0.12, cy - 0.2, cx + 0.1, cy + 0.2, cx + 0.12, cy - 0.2, cx, cy + 0.24, cx, cy - 0.24], s.darker(paper, 0.4), 0.8, 0.6);
    s.shape([cx - 0.1, cy + 0.22, cx - 0.09, cy + 0.3, cx + 0.09, cy + 0.3, cx + 0.1, cy + 0.22], s.col(s.T.ink), 0.5, { poly: true, misreg: false });
    s.shape([cx - 0.1, cy - 0.22, cx - 0.08, cy - 0.3, cx + 0.08, cy - 0.3, cx + 0.1, cy - 0.22], s.col(s.T.ink), 0.5, { poly: true, misreg: false });
  }
};

const pipes: Drawer = (s, r) => {
  const brass = matC(s, 'brass');
  const n = 5 + Math.floor(r() * 3);
  const span = 2.1;
  const pw = (span / n) * 0.78;
  s.shape([-span / 2 - 0.1, 0, -span / 2 - 0.1, 0.42, span / 2 + 0.1, 0.42, span / 2 + 0.1, 0], s.col(matC(s, 'wood')), 0.9, { poly: true, misreg: false });
  for (let i = 0; i < n; i++) {
    const u = -span / 2 + (span * (i + 0.5)) / n;
    const mid = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2 || 1);
    const hgt = 3.35 - mid * 1.5 + r() * 0.1;
    const hw = pw / 2;
    s.shape([u - hw * 0.35, 0.42, u - hw, 0.75, u - hw, hgt, u + hw, hgt, u + hw, 0.75, u + hw * 0.35, 0.42], s.col(brass), 0.85, { poly: true, misreg: false });
    s.ellipse(u, hgt, hw, hw * 0.3, 0, s.darker(brass, 0.55), 0.6);
    // The mouth.
    s.shape([u - hw * 0.6, 0.95, u, 1.15, u + hw * 0.6, 0.95, u, 0.85], s.darker(brass, 0.6), 0.5, { poly: true, misreg: false });
    s.marks([u - hw * 0.45, 1.25, u - hw * 0.45, hgt - 0.1], s.lighter(brass, 0.6), 1.6, 0.75);
    s.marks([u + hw * 0.6, 0.85, u + hw * 0.6, hgt - 0.05], s.darker(brass, 0.4), 1, 0.5);
  }
};

const gear: Drawer = (s, r, mode) => {
  if (!showLive(mode)) return;
  const brass = matC(s, 'brass');
  const R = 1.15 + r() * 0.25;
  const cy = R * 0.92;
  const teeth = 12 + Math.floor(r() * 5);
  const dir = r() < 0.5 ? -1 : 1;
  const rot = s.env.time * 0.35 * dir + r() * 6;
  const ctx = s.ctx;
  const X = (u: number) => s.X(u);
  const Y = (v: number) => s.Y(v);
  // Toothed rim with a hollow centre (even-odd), then spokes and hub.
  ctx.beginPath();
  for (let i = 0; i < teeth * 4; i++) {
    const a = rot + (i / (teeth * 4)) * Math.PI * 2;
    const phase = i % 4;
    const rr = phase === 1 || phase === 2 ? R : R - 0.17;
    const px = X(Math.cos(a) * rr);
    const py = Y(cy + Math.sin(a) * rr);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const inner = R - 0.36;
  ctx.moveTo(X(inner), Y(cy));
  for (let i = 1; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ctx.lineTo(X(Math.cos(a) * inner), Y(cy + Math.sin(a) * inner));
  }
  ctx.closePath();
  ctx.fillStyle = s.col(brass);
  ctx.globalAlpha = 0.95;
  ctx.fill('evenodd');
  ctx.strokeStyle = s.inkColor();
  ctx.lineWidth = s.lw(0.75);
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;
  const spokes = 5;
  for (let i = 0; i < spokes; i++) {
    const a = rot + (i / spokes) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const w = 0.07;
    s.shape(
      [ca * 0.15 - sa * w, cy + sa * 0.15 + ca * w, ca * (inner + 0.02) - sa * w, cy + sa * (inner + 0.02) + ca * w, ca * (inner + 0.02) + sa * w, cy + sa * (inner + 0.02) - ca * w, ca * 0.15 + sa * w, cy + sa * 0.15 - ca * w],
      s.col(brass),
      0.6,
      { poly: true, misreg: false, ampM: 0.3 },
    );
  }
  s.ellipse(0, cy, 0.22, 0.22, 0, s.col(mix(brass, s.T.gold, 0.3)), 0.8);
  s.dot(0, cy, 0.07, s.darker(brass, 0.6));
  s.marks([-R * 0.6, cy + R * 0.55, -R * 0.35, cy + R * 0.72], s.lighter(brass, 0.6), 1.6, 0.7);
};

const crystals: Drawer = (s, r) => {
  const c1 = matC(s, 'crystal');
  const c2 = matC(s, 'crystal', true);
  const n = 4 + Math.floor(r() * 3);
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  order.sort((a, b) => Math.abs(b - (n - 1) / 2) - Math.abs(a - (n - 1) / 2));
  for (const i of order) {
    const u = -0.45 + (0.9 * i) / Math.max(1, n - 1);
    const ang = (u * 0.9 + (r() - 0.5) * 0.3) * 0.9;
    const len = 0.55 + (1 - Math.abs(u) * 1.4) * 0.6 + r() * 0.15;
    const w = 0.1 + r() * 0.06;
    const ca = Math.sin(ang);
    const sa = Math.cos(ang);
    const tipU = u + ca * len;
    const tipV = sa * len;
    const midU = u + ca * len * 0.78;
    const midV = sa * len * 0.78;
    const nx = sa * w;
    const ny = -ca * w;
    const ctrl = [u - nx, 0 - ny, midU - nx, midV - ny, tipU, tipV, midU + nx, midV + ny, u + nx, 0 + ny];
    s.shape(ctrl, s.col(mix(c1, c2, r() * 0.5)), 0.7, { poly: true, misreg: false, ampM: 0.2 });
    s.region([u - nx, -ny, midU - nx, midV - ny, tipU, tipV, u, 0], s.lighter(c1, 0.6), 0.55, true);
    s.marks([u, 0, tipU, tipV], s.darker(c2, 0.3), 0.8, 0.7);
  }
  s.rays(0, 0.7, 0.75, 0.95, 8, s.lighter(c1, 0.7), 0.35, s.seed, 1);
};

const statue: Drawer = (s, r) => {
  const marble = matC(s, 'marble');
  const fill = s.col(marble);
  const face = r() < 0.5 ? -1 : 1;
  s.shape([-0.5, 0, -0.5, 0.15, 0.5, 0.15, 0.5, 0], fill, 0.9, { poly: true, misreg: false });
  s.shape([-0.38, 0.15, -0.36, 1.15, 0.36, 1.15, 0.38, 0.15], fill, 0.9, { poly: true, misreg: false });
  s.clip([-0.38, 0.15, -0.36, 1.15, 0.36, 1.15, 0.38, 0.15], () => s.blot(0.4, 0.6, 0.2, 0.6, s.env.pats.hatch, 0.6), true);
  s.shape([-0.46, 1.15, -0.46, 1.28, 0.46, 1.28, 0.46, 1.15], fill, 0.8, { poly: true, misreg: false });
  s.marks([-0.25, 0.35, 0.25, 0.35, -0.25, 0.95, 0.25, 0.95], s.darker(marble, 0.3), 0.8, 0.5);
  // A composer's bust: shoulders, neck and a storm of hair.
  s.flip = face;
  const bust = [-0.42, 1.28, -0.38, 1.62, -0.2, 1.82, -0.08, 1.88, 0.1, 1.88, 0.22, 1.82, 0.38, 1.62, 0.42, 1.28];
  s.shape(bust, fill, 0.9);
  s.shape([-0.08, 1.8, -0.08, 2.0, 0.08, 2.0, 0.08, 1.8], fill, 0.6, { poly: true, misreg: false });
  const head = [0.0, 1.98, -0.17, 2.08, -0.19, 2.3, -0.08, 2.47, 0.1, 2.46, 0.2, 2.32, 0.23, 2.22, 0.27, 2.18, 0.21, 2.12, 0.18, 2.02];
  s.shape(head, fill, 0.9);
  const hair = scallop(-0.06, 2.33, 0.21, 0.19, 9, s.seed + 5, 0.3);
  s.shape(hair, s.darker(marble, 0.18), 0.7, { misreg: false });
  s.dot(0.12, 2.27, 0.018, s.inkColor());
  s.clip(bust, () => s.blot(0.35, 1.45, 0.25, 0.4, s.env.pats.cross, 0.55));
  s.line([-0.25, 1.7, -0.05, 1.45, 0.15, 1.7], 0.45, undefined, 0.6);
  s.flip = 1;
};

const curtain: Drawer = (s, r) => {
  const velvet = s.T.inv ? mix(s.T.rubric, rgb('#401020'), 0.5) : mix(s.T.rubric, rgb('#5a0c1c'), 0.45);
  const gold = s.T.gold;
  const tie = 1.5 + r() * 0.3;
  for (const sd of [-1, 1]) {
    s.flip = sd;
    const panel = [-1.25, 4.0, -0.15, 4.0, -0.25, 3.0, -0.75, tie + 0.15, -0.6, tie - 0.1, -0.35, 0.6, -0.4, 0, -1.3, 0, -1.2, tie, -1.18, 3.0];
    s.shape(panel, s.col(velvet), 1);
    s.clip(panel, () => {
      s.blot(-0.3, 2.5, 0.35, 2.4, s.env.pats.cross, 0.55);
      s.blot(-1.25, 1.0, 0.2, 1.5, s.env.pats.hatch, 0.45);
    });
    for (let f = 0; f < 3; f++) {
      const u0 = -1.1 + f * 0.3;
      s.line([u0, 3.95, u0 + 0.05, 3.0, -0.95 + f * 0.1, tie + 0.05], 0.45, s.darker(velvet, 0.5), 0.75);
      s.line([-0.95 + f * 0.1, tie - 0.05, -1.05 + f * 0.25, 0.8, -1.15 + f * 0.3, 0.03], 0.45, s.darker(velvet, 0.5), 0.75);
    }
    s.line([-1.15, 3.6, -1.1, 2.5], 0.6, s.lighter(velvet, 0.35), 0.6);
    // A gold rope tie-back with a tassel.
    s.line([-1.25, tie, -0.95, tie - 0.06, -0.62, tie + 0.02], 0.9, s.col(gold), 0.95);
    s.shape([-0.66, tie - 0.02, -0.72, tie - 0.35, -0.55, tie - 0.35, -0.6, tie - 0.02], s.col(gold), 0.5, { poly: true, misreg: false });
  }
  s.flip = 1;
  // The pelmet with swags and a fringe.
  s.shape([-1.35, 4.2, 1.35, 4.2, 1.35, 3.95, -1.35, 3.95], s.col(mix(velvet, rgb('#000000'), 0.1)), 0.8, { poly: true, misreg: false });
  for (let i = 0; i < 3; i++) {
    const u0 = -1.35 + i * 0.9;
    s.shape([u0, 3.95, u0 + 0.45, 3.62, u0 + 0.9, 3.95], s.col(velvet), 0.7);
    s.line([u0 + 0.05, 3.9, u0 + 0.45, 3.67, u0 + 0.85, 3.9], 0.5, s.col(gold), 0.9);
  }
  s.line([-1.35, 4.12, 1.35, 4.12], 0.6, s.col(gold), 0.9);
};

const arch: Drawer = (s, r) => {
  const stone = matC(s, 'stone');
  const fill = s.col(stone);
  const pier = 2.0;
  const ri = 0.85;
  const ro = 1.3;
  const broken = r() < 0.5 ? (r() < 0.5 ? -1 : 1) : 0;
  for (const sd of [-1, 1]) {
    const ctrl = [sd * ri, 0, sd * ri, pier, sd * ro, pier, sd * ro, 0];
    s.shape(ctrl, fill, 0.9, { poly: true, misreg: false });
    const segs: number[] = [];
    for (let v = 0.4; v < pier; v += 0.4) segs.push(sd * ri, v, sd * ro, v);
    s.marks(segs, s.darker(stone, 0.4), 0.9, 0.6);
    if (sd === 1) s.clip(ctrl, () => s.blot(ro, pier / 2, 0.25, pier, s.env.pats.hatch, 0.5), true);
  }
  // Voussoirs round the arch; a ruined arch loses a few stones on one side.
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI - (i / n) * Math.PI;
    const a1 = Math.PI - ((i + 1) / n) * Math.PI;
    if (broken === -1 && i < 3) continue;
    if (broken === 1 && i > n - 4) continue;
    const key = i === Math.floor(n / 2);
    const o = key ? ro + 0.1 : ro;
    const ctrl = [Math.cos(a0) * ri, pier + Math.sin(a0) * ri, Math.cos(a0) * o, pier + Math.sin(a0) * o, Math.cos(a1) * o, pier + Math.sin(a1) * o, Math.cos(a1) * ri, pier + Math.sin(a1) * ri];
    s.shape(ctrl, fill, 0.7, { poly: true, misreg: false, ampM: 0.3 });
  }
  // Ivy trailing from the crown.
  const ivy = rgb(s.T.pal.topColor);
  for (let i = 0; i < 3; i++) {
    const u = -0.6 + i * 0.55 + r() * 0.2;
    const v = pier + Math.sqrt(Math.max(0, ri * ri - u * u)) + 0.1;
    const len = 0.5 + r() * 0.8;
    s.line([u, v + 0.2, u + 0.06, v - len * 0.5, u - 0.03, v - len], 0.4, s.darker(ivy, 0.3), 0.8);
    for (let j = 0; j < 4; j++) {
      const lv = v - (len * j) / 4;
      s.dot(u + (j % 2 ? 0.06 : -0.05), lv, 0.06, s.col(ivy), 0.9);
    }
  }
};

const mushroom: Drawer = (s, r) => {
  const cap = r() < 0.7 ? s.T.rubric : rgb('#9a6a3a');
  const stem = rgb('#efe4cc');
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const u = -0.25 + (0.5 * i) / Math.max(1, n - 1) + (r() - 0.5) * 0.08;
    const hgt = 0.22 + r() * 0.3;
    const cw = 0.13 + hgt * 0.35;
    const lean = (r() - 0.5) * 0.12;
    s.shape([u - 0.05, 0, u - 0.04 + lean, hgt, u + 0.04 + lean, hgt, u + 0.05, 0], s.col(stem), 0.6, { poly: true, misreg: false });
    const cu = u + lean;
    const capC = [cu - cw, hgt - 0.02, cu - cw * 0.8, hgt + cw * 0.45, cu, hgt + cw * 0.62, cu + cw * 0.8, hgt + cw * 0.45, cu + cw, hgt - 0.02];
    s.shape(capC, s.col(cap), 0.7);
    for (let d = 0; d < 3; d++) s.dot(cu + (d - 1) * cw * 0.5, hgt + cw * (0.28 + (d === 1 ? 0.15 : 0)), 0.022, s.col(rgb('#fffaf0')), 0.9);
  }
};

const bell: Drawer = (s, r, mode) => {
  const wood = matC(s, 'wood');
  const brass = matC(s, 'brass');
  const beam = 2.15;
  if (showStatic(mode)) {
    s.shape([-0.66, 0, -0.62, beam, -0.52, beam, -0.5, 0], s.col(wood), 0.8, { poly: true, misreg: false });
    s.shape([0.5, 0, 0.52, beam, 0.62, beam, 0.66, 0], s.col(wood), 0.8, { poly: true, misreg: false });
    s.shape([-0.78, beam, -0.78, beam + 0.14, 0.78, beam + 0.14, 0.78, beam], s.col(wood), 0.8, { poly: true, misreg: false });
    s.shape([-0.88, beam + 0.14, 0, beam + 0.48, 0.88, beam + 0.14], s.col(mix(wood, s.T.rubric, 0.25)), 0.8);
    s.seg(-0.6, 0.5, 0.6, 0.5, 0.5);
  }
  if (showLive(mode)) {
    const t = s.env.time;
    const sway = Math.sin(t * 1.25 + r() * 6) * 0.1;
    const px = 0;
    const py = beam - 0.02;
    const rot = (u: number, v: number): [number, number] => {
      const dx = u - px;
      const dy = v - py;
      return [px + dx * Math.cos(sway) - dy * Math.sin(sway), py + dx * Math.sin(sway) + dy * Math.cos(sway)];
    };
    const pts: number[] = [];
    for (const [u, v] of [[-0.12, 0], [-0.16, -0.12], [-0.2, -0.45], [-0.32, -0.68], [-0.36, -0.75], [0.36, -0.75], [0.32, -0.68], [0.2, -0.45], [0.16, -0.12], [0.12, 0]] as const) {
      const [a, b] = rot(u, py + v);
      pts.push(a, b);
    }
    s.shape(pts, s.col(brass), 0.85);
    const [hx, hy] = rot(-0.1, py - 0.2);
    const [hx2, hy2] = rot(-0.18, py - 0.62);
    s.marks([hx, hy, hx2, hy2], s.lighter(brass, 0.65), 1.8, 0.8);
    const [lx, ly] = rot(-0.33, py - 0.7);
    const [lx2, ly2] = rot(0.33, py - 0.7);
    s.marks([lx, ly, lx2, ly2], s.darker(brass, 0.5), 1, 0.7);
    const [cx, cy] = rot(Math.sin(sway * 1.6) * 0.1, py - 0.84);
    s.dot(cx, cy, 0.06, s.inkColor());
  }
};

const candles: Drawer = (s, r, mode) => {
  const wax = s.T.inv ? rgb('#e8e2d0') : rgb('#f3ead2');
  const brass = matC(s, 'brass');
  const n = 2 + Math.floor(r() * 3);
  const list: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const u = -0.32 + (0.64 * i) / Math.max(1, n - 1) + (r() - 0.5) * 0.06;
    list.push([u, 0.3 + r() * 0.55, 0.05 + r() * 0.025]);
  }
  if (showStatic(mode)) {
    s.ellipse(0, 0.05, 0.48, 0.07, 0, s.col(brass), 0.7);
    for (const [u, h, w] of list) {
      s.shape([u - w, 0.06, u - w, h, u - w * 0.3, h + 0.02, u + w * 0.4, h - 0.01, u + w, h, u + w, 0.06], s.col(wax), 0.6, { poly: true, misreg: false });
      // A drip of wax down one side.
      s.shape([u + w * 0.2, h, u + w * 0.35, h - 0.12, u + w * 0.5, h - 0.15, u + w * 0.62, h - 0.02], s.col(wax), 0.4, { misreg: false });
      s.seg(u, h, u + 0.01, h + 0.05, 0.5);
    }
  }
  if (showLive(mode)) {
    const t = s.env.now;
    for (let i = 0; i < list.length; i++) {
      const [u, h] = list[i];
      const f = noise1(t * 7 + i * 13 + s.seed, 3);
      const fh = 0.13 + 0.03 * f;
      const lean = 0.02 * noise1(t * 4 + i * 5, 4);
      s.rays(u, h + 0.12, 0.13, 0.24 + 0.03 * f, 8, css(s.T.gold), 0.35, t * 0.3 + i, 0.9);
      s.shape([u - 0.035, h + 0.06, u + lean, h + 0.06 + fh, u + 0.035, h + 0.06, u, h + 0.04], css(mix(s.T.gold, rgb('#ffcf6a'), 0.4)), 0.35, { poly: true, misreg: false, ampM: 0.2 });
      s.dot(u + lean * 0.3, h + 0.09, 0.016, 'rgb(255,250,230)', 0.95);
    }
  }
};

const DRAW: Record<DecorKind, Drawer> = {
  tree,
  pine,
  lamp,
  pillar,
  banner,
  flowers,
  grass,
  rock,
  reeds,
  lantern,
  pipes,
  gear,
  crystals,
  statue,
  curtain,
  arch,
  mushroom,
  bell,
  candles,
};
