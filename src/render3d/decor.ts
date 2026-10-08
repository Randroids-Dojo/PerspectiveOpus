import * as THREE from 'three';
import type { Level } from '../game/level';
import type { Palette } from '../game/palettes';
import type { DecorDef } from '../game/types';
import type { Halos } from './effects';
import type { PropMaterials } from './props';
import { Bag, GeoBucket, PRIM, col, lumpGeometry, mat, rng, rr, shade, taperTube, type AddOpts, type Rng } from './util';

/**
 * Purely visual dressing from `level.decor`, palette-aware and varied by seed.
 * Static parts are merged into a few buckets (one draw call each); parts that
 * move (gears, bells, lanterns) are small separate meshes.
 */

interface Light {
  x: number;
  y: number;
  z: number;
  size: number;
  color: THREE.Color;
  intensity: number;
  flicker: number;
}

interface Anim {
  obj: THREE.Object3D;
  kind: 'spin' | 'swing' | 'sway';
  speed: number;
  phase: number;
  amp: number;
}

interface B {
  d: GeoBucket;
  m: GeoBucket;
  g: GeoBucket;
  c: GeoBucket;
  s: GeoBucket;
}

class Ctx {
  base = new THREE.Matrix4();
  constructor(
    public b: B,
    public r: Rng,
    public pal: Palette,
    public lights: Light[],
  ) {}
  at(m: THREE.Matrix4): THREE.Matrix4 {
    return new THREE.Matrix4().multiplyMatrices(this.base, m);
  }
  d(g: THREE.BufferGeometry, m: THREE.Matrix4, c: THREE.Color, o?: AddOpts): void {
    this.b.d.add(g, this.at(m), c, o);
  }
  m(g: THREE.BufferGeometry, m: THREE.Matrix4, c: THREE.Color, o?: AddOpts): void {
    this.b.m.add(g, this.at(m), c, o);
  }
  glow(g: THREE.BufferGeometry, m: THREE.Matrix4, c: THREE.Color, phase = 0): void {
    this.b.g.add(g, this.at(m), c, { phase });
  }
  cloth(g: THREE.BufferGeometry, m: THREE.Matrix4, c: THREE.Color, o?: AddOpts): void {
    this.b.c.add(g, this.at(m), c, o);
  }
  gloss(g: THREE.BufferGeometry, m: THREE.Matrix4, c: THREE.Color, o?: AddOpts): void {
    this.b.s.add(g, this.at(m), c, o);
  }
  /** World position of a local point. */
  wp(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.base);
  }
  light(x: number, y: number, z: number, size: number, color: THREE.Color, intensity: number, flicker = 0): void {
    const p = this.wp(x, y, z);
    this.lights.push({ x: p.x, y: p.y, z: p.z, size, color, intensity, flicker });
  }
}

const lumps = [0, 1, 2, 3, 4, 5].map((i) => lumpGeometry(40 + i * 7, 1, 0.14));
const rockLumps = [0, 1, 2].map((i) => lumpGeometry(90 + i * 11, 1, 0.28));

function foliageColor(p: Palette, r: Rng): THREE.Color {
  if (p.id === 'autumn') return [col('#c9572a'), col('#e08a2e'), col('#d9b23a'), col('#a8402a')][Math.floor(r() * 4)];
  if (p.id === 'night') return shade(p.mats.leaf.color, rr(r, 0.9, 1.2));
  if (p.id === 'lake') return shade(p.mats.leaf.color, rr(r, 0.9, 1.15), 1, rr(r, -0.02, 0.02));
  return shade(p.mats.leaf.color, rr(r, 0.95, 1.25), 1.05, rr(r, -0.03, 0.03));
}

function bark(p: Palette): THREE.Color {
  return shade(p.mats.wood.color, 0.85);
}

// ---------------------------------------------------------------- kinds

function tree(c: Ctx): void {
  const { r, pal } = c;
  const h = rr(r, 1.4, 1.9);
  const lean = rr(r, -0.08, 0.08);
  const wind = { windBase: 0, windHeight: 3 };
  const trunk = taperTube(
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * 0.5, h * 0.5, 0.02), new THREE.Vector3(lean, h, 0)],
    0.13,
    0.07,
    7,
  );
  c.d(trunk, mat(0, 0, 0), bark(pal), { grad: 0.4 });
  trunk.dispose();
  // A couple of branches.
  for (let k = 0; k < 2; k++) {
    const a = r() * Math.PI * 2;
    const br = taperTube([new THREE.Vector3(lean * 0.6, h * 0.65, 0), new THREE.Vector3(Math.cos(a) * 0.45, h * 0.95, Math.sin(a) * 0.45)], 0.05, 0.025, 5);
    c.d(br, mat(0, 0, 0), bark(pal));
    br.dispose();
  }
  if (pal.id === 'lake') {
    // Willow: a dome with hanging strands.
    const fc = foliageColor(pal, r);
    c.d(lumps[0], mat(lean, h + 0.35, 0, 0, 0, 0, 2.1, 1.2, 2.0), fc, { ...wind, wind: 0.6 });
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2 + rr(r, -0.1, 0.1);
      const rad = rr(r, 0.65, 0.95);
      const top = new THREE.Vector3(lean + Math.cos(a) * rad, h + 0.4, Math.sin(a) * rad);
      const len = rr(r, 1.0, 1.7);
      const st = taperTube([top, top.clone().add(new THREE.Vector3(Math.cos(a) * 0.15, -len * 0.5, Math.sin(a) * 0.15)), top.clone().add(new THREE.Vector3(Math.cos(a) * 0.2, -len, Math.sin(a) * 0.2))], 0.05, 0.015, 4);
      c.d(st, mat(0, 0, 0), shade(fc, rr(r, 0.85, 1.1)), { wind: 1.4, windBase: h - 1.4, windHeight: 1.8 });
      st.dispose();
    }
    return;
  }
  if (pal.id === 'finale') {
    // A clipped topiary ball in a gilded pot.
    c.m(PRIM.cyl16, mat(0, 0.25, 0, 0, 0, 0, 0.7, 0.5, 0.7), col(pal.mats.brass.color));
    c.d(lumps[1], mat(0, h + 0.4, 0, 0, 0, 0, 1.3, 1.3, 1.3), shade(pal.mats.leaf.color, 1.0), { ...wind, wind: 0.2 });
    return;
  }
  const n = 5 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r();
    const rad = k === 0 ? 0 : rr(r, 0.35, 0.7);
    const s = k === 0 ? rr(r, 1.3, 1.6) : rr(r, 0.8, 1.15);
    c.d(lumps[k % lumps.length], mat(lean + Math.cos(a) * rad, h + 0.25 + rr(r, -0.15, 0.45), Math.sin(a) * rad, r() * 3, r() * 3, 0, s, s * 0.85, s), foliageColor(pal, r), {
      ...wind,
      wind: 0.5,
      grad: 0.35,
    });
  }
  if (pal.id === 'night') {
    for (let k = 0; k < 5; k++) {
      const a = r() * Math.PI * 2;
      const p = new THREE.Vector3(lean + Math.cos(a) * 0.8, h + rr(r, 0, 0.8), Math.sin(a) * 0.8);
      c.glow(PRIM.sphereLo, mat(p.x, p.y, p.z, 0, 0, 0, 0.07), col('#cfe8ff'), 0);
    }
  }
}

function pine(c: Ctx): void {
  const { r, pal } = c;
  const h = rr(r, 2.6, 3.4);
  c.d(PRIM.cyl6, mat(0, 0.4, 0, 0, 0, 0, 0.16, 0.8, 0.16), bark(pal));
  const green = pal.id === 'autumn' ? col('#3d5a35') : shade(pal.mats.leaf.color, 0.8, 1, 0.03);
  const tiers = 4;
  for (let k = 0; k < tiers; k++) {
    const t = k / tiers;
    const w = (1.3 - t * 0.85) * rr(r, 0.9, 1.05);
    const y = 0.55 + t * (h - 0.9);
    c.d(PRIM.cone, mat(0, y + 0.45, 0, 0, r() * 3, 0, w, 1.0, w), shade(green, 0.85 + t * 0.25), { wind: 0.3, windBase: 0, windHeight: h, grad: 0.4 });
    if (pal.top === 'snow') c.d(PRIM.cone, mat(0, y + 0.62, 0, 0, 0, 0, w * 0.7, 0.55, w * 0.7), col('#f2f6fb'));
  }
}

function lamp(c: Ctx): void {
  const { pal } = c;
  const iron = col('#26222a');
  const h = 2.3;
  c.m(PRIM.cyl, mat(0, 0.08, 0, 0, 0, 0, 0.34, 0.16, 0.34), iron);
  c.m(PRIM.cyl, mat(0, h / 2, 0, 0, 0, 0, 0.08, h, 0.08), iron);
  c.m(PRIM.torus, mat(0, h * 0.7, 0, Math.PI / 2, 0, 0, 0.12, 0.12, 0.5), iron);
  c.m(PRIM.cone5, mat(0, h + 0.5, 0, 0, Math.PI / 4, 0, 0.42, 0.22, 0.42), iron);
  c.m(PRIM.box, mat(0, h + 0.03, 0, 0, Math.PI / 4, 0, 0.28, 0.05, 0.28), iron);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) c.m(PRIM.box, mat(sx * 0.1, h + 0.2, sz * 0.1, 0, 0, 0, 0.025, 0.36, 0.025), iron);
  const glow = col(pal.glow);
  c.glow(PRIM.box, mat(0, h + 0.2, 0, 0, Math.PI / 4, 0, 0.18, 0.32, 0.18), glow, 0.5 + c.r());
  c.light(0, h + 0.2, 0, 1.8, glow, 0.55, 1);
}

function pillar(c: Ctx): void {
  const { r, pal } = c;
  const m = shade(pal.mats.marble.color, rr(r, 0.95, 1.02));
  const broken = r() < 0.4;
  const h = broken ? rr(r, 1.4, 2.6) : rr(r, 3.0, 3.6);
  c.gloss(PRIM.box, mat(0, 0.12, 0, 0, 0, 0, 0.9, 0.24, 0.9), shade(m, 0.92), { grad: 0.3 });
  c.gloss(PRIM.cyl16, mat(0, 0.3, 0, 0, 0, 0, 0.74, 0.12, 0.74), m);
  const shaft = new THREE.CylinderGeometry(0.29, 0.32, h, 20, 1);
  c.gloss(shaft, mat(0, 0.36 + h / 2, 0), m, {
    colorFn: (p, _n, out) => {
      const a = Math.atan2(p.z, p.x);
      out.multiplyScalar(0.9 + 0.1 * Math.abs(Math.cos(a * 10)));
    },
  });
  shaft.dispose();
  if (!broken) {
    c.gloss(PRIM.cyl16, mat(0, 0.36 + h + 0.06, 0, 0, 0, 0, 0.7, 0.12, 0.7), m);
    c.gloss(PRIM.box, mat(0, 0.36 + h + 0.2, 0, 0, 0, 0, 0.86, 0.16, 0.86), shade(m, 1.03));
  } else {
    // A jagged break and a fallen drum at the foot.
    c.gloss(PRIM.cone5, mat(0.05, 0.36 + h + 0.08, 0, 0.3, 0, 0.2, 0.55, 0.25, 0.55), shade(m, 0.95));
    c.gloss(PRIM.cyl16, mat(rr(r, 0.6, 0.9), 0.3, rr(r, -0.4, 0.4), Math.PI / 2, r() * 3, 0, 0.6, 0.55, 0.6), shade(m, 0.93));
  }
  if (pal.top === 'grass' || pal.top === 'moss')
    for (let k = 0; k < 4; k++) c.d(lumps[k], mat(rr(r, -0.35, 0.35), 0.35 + rr(r, 0, 0.6), rr(r, -0.35, 0.35), 0, 0, 0, 0.25, 0.18, 0.25), shade(pal.topColor, 0.8));
}

function banner(c: Ctx, onWall: boolean): void {
  const { pal } = c;
  const red = col(pal.rubric);
  const gold = col(pal.mats.brass.color);
  const w = 0.95;
  const h = 2.2;
  const top = onWall ? 1.6 : 3.0;
  if (!onWall) c.m(PRIM.cyl, mat(-w / 2 - 0.06, top / 2 + 0.2, 0, 0, 0, 0, 0.07, top + 0.4, 0.07), col('#2a2228'));
  c.m(PRIM.cyl, mat(0, top + 0.05, 0, 0, 0, Math.PI / 2, 0.05, w + 0.3, 0.05), gold);
  for (const s of [-1, 1]) c.m(PRIM.sphere, mat(s * (w / 2 + 0.17), top + 0.05, 0, 0, 0, 0, 0.09), gold);
  // Cloth with a swallowtail hem.
  const g = new THREE.PlaneGeometry(w, h, 6, 12);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    if (y < -h / 2 + 0.01) y += Math.max(0, 0.35 - Math.abs(x) * 0.7);
    pos.setXYZ(i, x, y, Math.sin(y * 3 + x * 2) * 0.03);
  }
  g.computeVertexNormals();
  c.cloth(g, mat(0, top - h / 2, -0.02), red, { wind: 0.35, windBase: top, windHeight: -h, grad: 0.25 });
  g.dispose();
  // Gold trim and an eighth-note emblem.
  c.m(PRIM.box, mat(0, top - 0.12, -0.04, 0, 0, 0, w, 0.06, 0.012), gold);
  c.m(PRIM.sphere, mat(-0.06, top - 0.95, -0.05, 0, 0, 0.4, 0.2, 0.15, 0.04), gold);
  c.m(PRIM.box, mat(0.04, top - 0.72, -0.05, 0, 0, 0, 0.035, 0.5, 0.02), gold);
  c.m(PRIM.box, mat(0.12, top - 0.55, -0.05, 0, 0, -0.7, 0.03, 0.3, 0.02), gold);
}

function flowers(c: Ctx): void {
  const { r, pal } = c;
  const palette =
    pal.id === 'night'
      ? ['#9fd0ff', '#c6b6ff', '#e8f4ff']
      : pal.id === 'autumn'
        ? ['#e8822e', '#d8b23a', '#b8432c']
        : pal.id === 'lake'
          ? ['#8a7ad8', '#e6e2f5', '#5f8ad0']
          : pal.id === 'finale'
            ? ['#c2263a', '#f2e6d0', '#e0b25a']
            : ['#f2f0e6', '#f6d36b', '#e98fa8', '#b99af0'];
  const stem = shade(pal.topColor, 0.65);
  const n = 7 + Math.floor(r() * 5);
  for (let k = 0; k < n; k++) {
    const x = rr(r, -0.4, 0.4);
    const z = rr(r, -0.4, 0.4);
    const h = rr(r, 0.22, 0.48);
    c.d(PRIM.cyl6, mat(x, h / 2, z, rr(r, -0.15, 0.15), 0, rr(r, -0.15, 0.15), 0.025, h, 0.025), stem, { wind: 0.6, windBase: 0, windHeight: 0.5 });
    const pc = col(palette[Math.floor(r() * palette.length)]);
    const glowy = pal.id === 'night';
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      const m = mat(x + Math.cos(a) * 0.045, h, z + Math.sin(a) * 0.045, 0, -a, 0.5, 0.09, 0.025, 0.055);
      if (glowy) c.glow(PRIM.sphereLo, m, pc.clone().multiplyScalar(0.5));
      else c.d(PRIM.sphereLo, m, pc, { wind: 0.6, windBase: 0, windHeight: 0.5 });
    }
    c.d(PRIM.sphereLo, mat(x, h + 0.01, z, 0, 0, 0, 0.04), col('#f0c040'), { wind: 0.6, windBase: 0, windHeight: 0.5 });
  }
  for (let k = 0; k < 6; k++) c.d(PRIM.cone5, mat(rr(r, -0.4, 0.4), 0.1, rr(r, -0.4, 0.4), rr(r, -0.4, 0.4), 0, rr(r, -0.4, 0.4), 0.06, 0.25, 0.06), shade(stem, 1.2), { wind: 0.4 });
}

function grassTuft(c: Ctx): void {
  const { r, pal } = c;
  const base = shade(pal.topColor, 0.6);
  const tip = shade(pal.topColor, 1.25);
  for (let k = 0; k < 26; k++) {
    const a = r() * Math.PI * 2;
    const rad = rr(r, 0, 0.35);
    const h = rr(r, 0.35, 0.75);
    const lean = rr(r, 0.1, 0.45);
    c.d(PRIM.cone5, mat(Math.cos(a) * rad, h / 2, Math.sin(a) * rad, Math.sin(a) * lean, 0, -Math.cos(a) * lean, 0.06, h, 0.025), base.clone().lerp(tip, r()), {
      wind: 0.9,
      windBase: 0,
      windHeight: 0.7,
      grad: 0.5,
    });
  }
}

function rock(c: Ctx): void {
  const { r, pal } = c;
  const s = rr(r, 0.55, 0.9);
  const stone = shade(pal.mats.stone.color, rr(r, 0.75, 0.9));
  const moss = col(pal.top === 'none' || pal.top === 'carpet' ? pal.mats.stone.color2 : pal.topColor);
  c.d(rockLumps[Math.floor(r() * 3)], mat(0, s * 0.3, 0, r(), r() * 6, r(), s * 1.3, s * 0.8, s), stone, {
    colorFn: (_p, n, out) => {
      if (n.y > 0.55) out.lerp(moss, Math.min(1, (n.y - 0.55) * 2.5) * 0.8);
    },
  });
  if (r() < 0.7) c.d(rockLumps[Math.floor(r() * 3)], mat(s * 0.7, s * 0.15, s * 0.3, r(), r() * 6, r(), s * 0.6, s * 0.45, s * 0.5), shade(stone, 1.05));
}

function reeds(c: Ctx): void {
  const { r, pal } = c;
  const green = shade(pal.mats.leaf.color, 1.0, 0.9);
  const brown = col('#6b4a2c');
  const n = 9 + Math.floor(r() * 5);
  for (let k = 0; k < n; k++) {
    const x = rr(r, -0.4, 0.4);
    const z = rr(r, -0.4, 0.4);
    const h = rr(r, 0.9, 1.6);
    const tilt = rr(r, -0.12, 0.12);
    c.d(PRIM.cyl6, mat(x, h / 2, z, tilt, 0, tilt, 0.025, h, 0.025), green, { wind: 0.8, windBase: 0, windHeight: 1.5 });
    if (r() < 0.6) c.d(PRIM.cyl6, mat(x + tilt * h * 0.4, h * 0.85, z - tilt * h * 0.4, tilt, 0, tilt, 0.06, 0.22, 0.06), brown, { wind: 0.8, windBase: 0, windHeight: 1.5 });
  }
  for (let k = 0; k < 7; k++) {
    const a = r() * Math.PI * 2;
    c.d(PRIM.cone5, mat(Math.cos(a) * 0.2, 0.35, Math.sin(a) * 0.2, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35, 0.08, 0.7, 0.02), shade(green, 0.9), { wind: 0.7 });
  }
}

function lantern(c: Ctx, anims: Anim[], group: THREE.Group, mats: PropMaterials, bag: Bag): void {
  const { pal, r } = c;
  const iron = col('#2a2530');
  c.m(PRIM.cyl, mat(0, 0.9, 0, 0, 0, 0, 0.06, 1.8, 0.06), iron);
  const hook = taperTube([new THREE.Vector3(0, 1.8, 0), new THREE.Vector3(0.1, 2.05, 0), new THREE.Vector3(0.4, 2.05, 0), new THREE.Vector3(0.5, 1.9, 0)], 0.03, 0.025, 5);
  c.m(hook, mat(0, 0, 0), iron);
  hook.dispose();
  // The lantern swings from the hook.
  const pivot = c.wp(0.5, 1.88, 0);
  const lb = new GeoBucket();
  const lg = new GeoBucket();
  const paper = pal.id === 'night' ? col('#ffd9a0') : col(pal.glow);
  lb.add(PRIM.cyl, mat(0, -0.1, 0, 0, 0, 0, 0.18, 0.04, 0.18), iron);
  lb.add(PRIM.cyl, mat(0, -0.52, 0, 0, 0, 0, 0.2, 0.04, 0.2), iron);
  lb.add(PRIM.cyl6, mat(0, -0.05, 0, 0, 0, 0, 0.01, 0.12, 0.01), iron);
  lg.add(PRIM.sphere, mat(0, -0.31, 0, 0, 0, 0, 0.3, 0.42, 0.3), paper, { phase: 0.3 + r() });
  const g = new THREE.Group();
  g.position.copy(pivot);
  const s = c.base.elements[0] ** 2 + c.base.elements[1] ** 2 + c.base.elements[2] ** 2;
  g.scale.setScalar(Math.sqrt(s));
  const bgeo = lb.build();
  const ggeo = lg.build();
  if (bgeo) g.add(new THREE.Mesh(bag.add(bgeo), mats.metal));
  if (ggeo) g.add(new THREE.Mesh(bag.add(ggeo), mats.glow));
  group.add(g);
  anims.push({ obj: g, kind: 'swing', speed: 1.4, phase: r() * 6, amp: 0.1 });
  c.lights.push({ x: pivot.x, y: pivot.y - 0.31, z: pivot.z, size: 1.6, color: paper, intensity: 0.6, flicker: 1 });
}

function pipes(c: Ctx): void {
  const { r, pal } = c;
  const brass = col(pal.mats.brass.color);
  const n = 5 + Math.floor(r() * 3);
  const w = 0.17;
  for (let k = 0; k < n; k++) {
    const x = (k - (n - 1) / 2) * w * 2.1;
    const h = 1.4 + Math.sin((k / (n - 1)) * Math.PI) * 1.4 + rr(r, -0.15, 0.15);
    const pc = shade(brass, rr(r, 0.9, 1.08));
    c.m(PRIM.cone, mat(x, 0.18, 0, Math.PI, 0, 0, w * 1.6, 0.36, w * 1.6), pc);
    c.m(PRIM.cyl16, mat(x, 0.36 + h / 2, 0, 0, 0, 0, w * 2, h, w * 2), pc);
    c.m(PRIM.torus, mat(x, 0.36 + h, 0, Math.PI / 2, 0, 0, w * 1.05, w * 1.05, 0.6), shade(pc, 1.1));
    // The mouth.
    c.d(PRIM.box, mat(x, 0.65, -w * 0.85, 0, 0, 0, w * 1.1, 0.14, 0.04), col('#140c08'));
  }
  c.d(PRIM.box, mat(0, 0.05, 0, 0, 0, 0, n * w * 2.2 + 0.2, 0.1, 0.6), shade(pal.mats.wood.color, 0.8));
}

function gear(c: Ctx, anims: Anim[], group: THREE.Group, mats: PropMaterials, bag: Bag): void {
  const { r, pal } = c;
  const R = rr(r, 0.8, 1.1);
  const teeth = Math.round(R * 14);
  const s = new THREE.Shape();
  const n = teeth * 4;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = i % 4;
    const rad = k === 1 || k === 2 ? R : R * 0.86;
    if (i === 0) s.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    else s.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2 + 0.2;
    const a1 = ((i + 1) / 6) * Math.PI * 2 - 0.2;
    const h = new THREE.Path();
    h.absarc(0, 0, R * 0.68, a0, a1, false);
    h.absarc(0, 0, R * 0.25, a1, a0, true);
    s.holes.push(h);
  }
  const eg = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 2, curveSegments: 6 });
  eg.translate(0, 0, -0.06);
  const gb = new GeoBucket();
  gb.add(eg, mat(0, 0, 0), col(pal.mats.brass.color));
  gb.add(PRIM.cyl16, mat(0, 0, 0, Math.PI / 2, 0, 0, R * 0.3, 0.26, R * 0.3), shade(pal.mats.brass.color, 0.8));
  eg.dispose();
  const geo = gb.build();
  // Stand.
  c.d(PRIM.box, mat(0, (R + 0.25) / 2, 0.16, 0, 0, 0, 0.2, R + 0.25, 0.12), shade(pal.mats.wood.color, 0.8));
  c.d(PRIM.box, mat(0, 0.06, 0.16, 0, 0, 0, 0.8, 0.12, 0.5), shade(pal.mats.wood.color, 0.7));
  if (!geo) return;
  const m = new THREE.Mesh(bag.add(geo), mats.metal);
  m.castShadow = true;
  const holder = new THREE.Group();
  holder.applyMatrix4(c.at(mat(0, R + 0.25, 0)));
  holder.add(m);
  group.add(holder);
  anims.push({ obj: m, kind: 'spin', speed: rr(r, 0.25, 0.5) * (r() < 0.5 ? -1 : 1), phase: 0, amp: 1 });
}

function crystals(c: Ctx): void {
  const { r, pal } = c;
  const em = col(pal.mats.crystal.emissive ?? pal.mats.crystal.color);
  const body = col(pal.mats.crystal.color);
  const n = 5 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2;
    const rad = k === 0 ? 0 : rr(r, 0.15, 0.4);
    const h = k === 0 ? rr(r, 1.0, 1.5) : rr(r, 0.4, 0.9);
    const w = h * 0.22;
    const tx = Math.cos(a) * 0.35 * (k ? 1 : 0);
    const tz = Math.sin(a) * 0.35 * (k ? 1 : 0);
    const m1 = mat(Math.cos(a) * rad, h / 2, Math.sin(a) * rad, tz, r() * 3, -tx, w, h, w);
    const tint = body.clone().lerp(em, rr(r, 0.3, 0.7)).multiplyScalar(0.55);
    c.glow(PRIM.cyl6, m1, tint, 0);
    const m2 = mat(Math.cos(a) * rad + Math.sin(-tx) * h * 0.55, h + w * 0.6, Math.sin(a) * rad + Math.sin(tz) * h * 0.55, tz, 0, -tx, w, w * 1.4, w);
    c.glow(PRIM.cone5, m2, tint.clone().multiplyScalar(1.3), 0);
  }
  c.d(rockLumps[1], mat(0, 0.08, 0, 0, r() * 6, 0, 0.9, 0.3, 0.8), shade(pal.mats.dark.color, 1.2));
  c.light(0, 0.6, 0, 2.4, em, 0.4, 0);
}

function statue(c: Ctx): void {
  const { r, pal } = c;
  const m = shade(pal.mats.marble.color, 1.0);
  // A tall pedestal with mouldings.
  c.gloss(PRIM.box, mat(0, 0.08, 0, 0, 0, 0, 0.78, 0.16, 0.78), shade(m, 0.9), { grad: 0.2 });
  c.gloss(PRIM.box, mat(0, 0.2, 0, 0, 0, 0, 0.66, 0.08, 0.66), shade(m, 0.96));
  c.gloss(PRIM.box, mat(0, 0.75, 0, 0, 0, 0, 0.54, 1.0, 0.54), m, { grad: 0.25 });
  c.gloss(PRIM.box, mat(0, 1.29, 0, 0, 0, 0, 0.66, 0.08, 0.66), shade(m, 1.02));
  // A composer's bust: shoulders, neck, head, hair and a gilded laurel.
  const sh = new THREE.LatheGeometry(
    [
      [0.0, 0],
      [0.3, 0.0],
      [0.34, 0.12],
      [0.3, 0.3],
      [0.17, 0.42],
      [0.0, 0.44],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    18,
  );
  c.gloss(sh, mat(0, 1.33, 0, 0, 0, 0, 1, 1, 0.62), m);
  sh.dispose();
  c.gloss(PRIM.cyl16, mat(0, 1.82, 0, 0, 0, 0, 0.17, 0.2, 0.17), m);
  c.gloss(PRIM.sphereHi, mat(0, 2.02, -0.01, 0, 0, 0, 0.3, 0.36, 0.33), m);
  c.gloss(PRIM.sphere, mat(0, 1.94, -0.15, 0, 0, 0, 0.07, 0.1, 0.07), shade(m, 0.98));
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    c.gloss(lumps[k % 6], mat(Math.cos(a) * 0.12, 2.14 + rr(r, -0.02, 0.05), Math.sin(a) * 0.12 + 0.03, 0, 0, 0, 0.16, 0.12, 0.16), shade(m, 0.95));
  }
  const laurel = new THREE.TorusGeometry(0.16, 0.022, 6, 20);
  c.m(laurel, mat(0, 2.1, 0.01, Math.PI / 2 - 0.25, 0, 0), col(pal.mats.brass.color));
  laurel.dispose();
  if (r() < 0.5 && pal.top !== 'none' && pal.top !== 'carpet') c.d(lumps[2], mat(0.32, 0.2, 0.32, 0, 0, 0, 0.3, 0.2, 0.3), shade(pal.topColor, 0.75));
}

function curtain(c: Ctx): void {
  const { pal } = c;
  const velvet = pal.id === 'finale' ? col(pal.mats.dark.color).multiplyScalar(1.4) : col(pal.rubric).multiplyScalar(0.8);
  const gold = col(pal.mats.brass.color);
  const W = 2.6;
  const H = 3.4;
  c.m(PRIM.cyl, mat(0, H + 0.1, 0, 0, 0, Math.PI / 2, 0.06, W + 0.5, 0.06), gold);
  for (const s of [-1, 1]) c.m(PRIM.sphere, mat(s * (W / 2 + 0.28), H + 0.1, 0, 0, 0, 0, 0.12), gold);
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(W * 0.48, H, 18, 14);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const v = (y + H / 2) / H;
      // Gathered towards the tie-back low on the outer side.
      const pinch = Math.exp(-((v - 0.32) ** 2) / 0.01) * 0.55;
      const outer = s * (W * 0.24);
      const nx = x + (outer - x) * pinch * (s * x < W * 0.24 ? 1 : 0.3);
      pos.setXYZ(i, nx, y, Math.sin(x * 22) * 0.07 * (1 - pinch * 0.5) - 0.05);
    }
    g.computeVertexNormals();
    c.cloth(g, mat(s * W * 0.25, H / 2, 0), velvet, { wind: 0.08, windBase: H, windHeight: -H, grad: 0.35 });
    g.dispose();
    c.m(PRIM.sphere, mat(s * W * 0.42, H * 0.32, -0.06, 0, 0, 0, 0.1, 0.16, 0.1), gold);
    c.m(PRIM.cone, mat(s * W * 0.42, H * 0.32 - 0.18, -0.06, 0, 0, 0, 0.12, 0.22, 0.12), gold);
  }
  // A valance across the top.
  const v = new THREE.PlaneGeometry(W + 0.3, 0.45, 24, 2);
  const vp = v.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < vp.count; i++) {
    const x = vp.getX(i);
    const y = vp.getY(i);
    vp.setXYZ(i, x, y - (y < 0 ? Math.abs(Math.sin(x * 4)) * 0.18 : 0), -0.09 + Math.sin(x * 12) * 0.02);
  }
  v.computeVertexNormals();
  c.cloth(v, mat(0, H - 0.12, 0), shade(velvet, 1.1));
  v.dispose();
}

function arch(c: Ctx): void {
  const { r, pal } = c;
  const st = shade(pal.mats.stone.color, rr(r, 0.92, 1.02));
  const H = 1.8;
  for (const s of [-1, 1]) {
    c.d(PRIM.box, mat(s * 0.95, H / 2, 0, 0, 0, 0, 0.36, H, 0.5), st, { grad: 0.3, jitter: 0.06 });
    c.d(PRIM.box, mat(s * 0.95, H + 0.05, 0, 0, 0, 0, 0.46, 0.1, 0.58), shade(st, 1.05));
  }
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n) * Math.PI;
    c.d(PRIM.box, mat(Math.cos(a) * 0.95, H + 0.1 + Math.sin(a) * 0.95, 0, 0, 0, a - Math.PI / 2, 0.36, 0.4, 0.5), shade(st, 0.95 + r() * 0.1));
  }
  if (pal.top === 'grass' || pal.top === 'moss' || pal.top === 'leaves') {
    const ivy = pal.top === 'leaves' ? col('#b8502a') : shade(pal.mats.leaf.color, 1.05);
    for (let k = 0; k < 9; k++) {
      const a = r() * Math.PI;
      c.d(lumps[k % 6], mat(Math.cos(a) * 1.05, H + 0.15 + Math.sin(a) * 1.05, rr(r, -0.25, 0.25), 0, 0, 0, 0.32, 0.26, 0.3), shade(ivy, rr(r, 0.85, 1.15)), { wind: 0.2 });
    }
  }
}

function mushroom(c: Ctx): void {
  const { r, pal } = c;
  const night = pal.id === 'night';
  const n = 3 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const x = k === 0 ? 0 : rr(r, -0.35, 0.35);
    const z = k === 0 ? 0 : rr(r, -0.35, 0.35);
    const h = k === 0 ? rr(r, 0.4, 0.6) : rr(r, 0.15, 0.35);
    const capR = h * rr(r, 0.6, 0.9);
    c.d(PRIM.cyl, mat(x, h / 2, z, 0, 0, 0, capR * 0.4, h, capR * 0.4), col('#efe6d2'), { grad: 0.2 });
    const cap = new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const capC = night ? col('#7fc4ff') : pal.id === 'autumn' ? col('#a0522d') : col('#c9302c');
    if (night) c.glow(cap, mat(x, h - 0.02, z, 0, 0, 0, capR * 2, capR * 1.1, capR * 2), capC.clone().multiplyScalar(0.7), 0);
    else c.d(cap, mat(x, h - 0.02, z, 0, 0, 0, capR * 2, capR * 1.2, capR * 2), capC);
    cap.dispose();
    if (!night)
      for (let s = 0; s < 4; s++) {
        const a = r() * Math.PI * 2;
        const e = rr(r, 0.3, 1.1);
        c.d(PRIM.sphereLo, mat(x + Math.cos(a) * Math.cos(e) * capR, h - 0.02 + Math.sin(e) * capR * 0.6, z + Math.sin(a) * Math.cos(e) * capR, 0, 0, 0, capR * 0.22, capR * 0.08, capR * 0.22), col('#f6f0e2'));
      }
    else c.light(x, h, z, 0.9, capC, 0.35, 0);
  }
}

function bell(c: Ctx, anims: Anim[], group: THREE.Group, mats: PropMaterials, bag: Bag): void {
  const { pal, r } = c;
  const wood = shade(pal.mats.wood.color, 0.9);
  const H = 2.2;
  for (const s of [-1, 1]) c.d(PRIM.box, mat(s * 0.6, H / 2, 0, 0, 0, s * 0.05, 0.14, H, 0.14), wood, { grad: 0.3 });
  c.d(PRIM.box, mat(0, H, 0, 0, 0, 0, 1.5, 0.16, 0.18), shade(wood, 1.1));
  c.d(PRIM.cone5, mat(0, H + 0.25, 0, 0, Math.PI / 4, 0, 1.0, 0.4, 0.4), shade(wood, 0.8));
  const bb = new GeoBucket();
  const bronze = col('#b07a3a');
  const prof = [
    [0.02, 0],
    [0.12, -0.02],
    [0.16, -0.12],
    [0.18, -0.3],
    [0.24, -0.5],
    [0.3, -0.58],
    [0.28, -0.62],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const lathe = new THREE.LatheGeometry(prof, 20);
  bb.add(lathe, mat(0, 0, 0), bronze);
  lathe.dispose();
  bb.add(PRIM.torus, mat(0, 0.03, 0, 0, 0, 0, 0.12, 0.12, 0.5), bronze);
  bb.add(PRIM.sphere, mat(0, -0.55, 0, 0, 0, 0, 0.08), shade(bronze, 0.7));
  const geo = bb.build();
  if (!geo) return;
  const m = new THREE.Mesh(bag.add(geo), mats.metal);
  m.castShadow = true;
  const holder = new THREE.Group();
  holder.applyMatrix4(c.at(mat(0, H - 0.08, 0)));
  holder.add(m);
  group.add(holder);
  anims.push({ obj: m, kind: 'swing', speed: 1.1, phase: r() * 6, amp: 0.18 });
}

function candles(c: Ctx): void {
  const { r, pal } = c;
  const wax = col('#f2e8d2');
  const brass = col(pal.mats.brass.color);
  c.m(PRIM.cyl16, mat(0, 0.04, 0, 0, 0, 0, 0.7, 0.08, 0.5), brass);
  const n = 3 + Math.floor(r() * 4);
  const flame = col('#ffc46a');
  for (let k = 0; k < n; k++) {
    const x = (k - (n - 1) / 2) * 0.16 + rr(r, -0.03, 0.03);
    const z = rr(r, -0.12, 0.12);
    const h = rr(r, 0.2, 0.6);
    c.gloss(PRIM.cyl, mat(x, 0.08 + h / 2, z, 0, 0, 0, 0.08, h, 0.08), wax);
    c.gloss(PRIM.sphere, mat(x + 0.03, 0.08 + h - 0.03, z, 0, 0, 0, 0.03, 0.06, 0.03), wax);
    c.d(PRIM.cyl6, mat(x, 0.08 + h + 0.02, z, 0, 0, 0, 0.008, 0.04, 0.008), col('#1a1410'));
    const ph = 1 + r() * 5;
    c.glow(PRIM.sphere, mat(x, 0.08 + h + 0.08, z, 0, 0, 0, 0.05, 0.12, 0.05), flame, ph);
    c.light(x, 0.08 + h + 0.08, z, 0.7, flame, 0.5, 1);
  }
}

// ---------------------------------------------------------------- assembly

export class Decor {
  readonly group = new THREE.Group();
  private lights: Light[] = [];
  private anims: Anim[] = [];

  build(lv: Level, pal: Palette, mats: PropMaterials, bag: Bag): void {
    this.group.clear();
    this.lights = [];
    this.anims = [];
    const b: B = { d: new GeoBucket(), m: new GeoBucket(), g: new GeoBucket(), c: new GeoBucket(), s: new GeoBucket() };
    for (const d of lv.decor) {
      const r = rng(d.seed + 1);
      const c = new Ctx(b, r, pal, this.lights);
      const { pos, onWall } = placement(lv, d);
      // Built things face the audience; growing things take their seeded turn.
      const facing = ['banner', 'curtain', 'arch', 'pipes', 'gear', 'bell', 'statue', 'lamp', 'candles', 'pillar'];
      const rot = onWall || facing.includes(d.kind) ? (d.kind === 'pillar' ? d.rot * 0.1 : 0) : d.rot;
      c.base.compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(d.scale, d.scale, d.scale));
      switch (d.kind) {
        case 'tree':
          tree(c);
          break;
        case 'pine':
          pine(c);
          break;
        case 'lamp':
          lamp(c);
          break;
        case 'pillar':
          pillar(c);
          break;
        case 'banner':
          banner(c, onWall);
          break;
        case 'flowers':
          flowers(c);
          break;
        case 'grass':
          grassTuft(c);
          break;
        case 'rock':
          rock(c);
          break;
        case 'reeds':
          reeds(c);
          break;
        case 'lantern':
          lantern(c, this.anims, this.group, mats, bag);
          break;
        case 'pipes':
          pipes(c);
          break;
        case 'gear':
          gear(c, this.anims, this.group, mats, bag);
          break;
        case 'crystals':
          crystals(c);
          break;
        case 'statue':
          statue(c);
          break;
        case 'curtain':
          curtain(c);
          break;
        case 'arch':
          arch(c);
          break;
        case 'mushroom':
          mushroom(c);
          break;
        case 'bell':
          bell(c, this.anims, this.group, mats, bag);
          break;
        case 'candles':
          candles(c);
          break;
      }
    }
    const add = (bk: GeoBucket, m: THREE.Material, shadow = true) => {
      const g = bk.build();
      if (!g) return;
      const mesh = new THREE.Mesh(bag.add(g), m);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    add(b.d, mats.diffuse);
    add(b.m, mats.metal);
    add(b.s, mats.gloss);
    add(b.c, mats.cloth);
    add(b.g, mats.glow, false);
  }

  update(time: number, halos: Halos): void {
    for (const a of this.anims) {
      if (a.kind === 'spin') a.obj.rotation.z = time * a.speed;
      else if (a.kind === 'swing') a.obj.rotation.z = Math.sin(time * a.speed + a.phase) * a.amp;
    }
    for (const l of this.lights) {
      const f = l.flicker ? 0.85 + 0.15 * Math.sin(time * 9 + l.x * 3) * Math.sin(time * 6.3 + l.z * 5) : 1;
      halos.add(l.x, l.y, l.z, l.size, l.color, l.intensity * f);
    }
  }
}

/** Decor sits on the cell below its position; wall-mounted kinds move to the nearest open face towards the viewer. */
function placement(lv: Level, d: DecorDef): { pos: THREE.Vector3; onWall: boolean } {
  const pos = new THREE.Vector3(d.pos.x, d.pos.y, d.pos.z);
  const x = Math.floor(d.pos.x);
  const y = Math.floor(d.pos.y);
  let z = Math.floor(d.pos.z);
  const solid = (zz: number) => {
    if (x < 0 || y < 0 || zz < 0 || x >= lv.w || y >= lv.h || zz >= lv.d) return false;
    const m = lv.cells[x + lv.w * (y + lv.h * zz)];
    return m !== 0 && m !== 8;
  };
  if (solid(z)) {
    while (z > 0 && solid(z - 1)) z--;
    pos.z = z - 0.04;
    pos.y = d.pos.y - 1.0;
    return { pos, onWall: true };
  }
  return { pos, onWall: false };
}
