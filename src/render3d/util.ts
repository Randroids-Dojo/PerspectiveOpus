import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math';

/** Small helpers shared by the stage modules. */

export type Rng = () => number;

export function rng(seed: number): Rng {
  return mulberry32((seed * 2654435761) >>> 0 || 1);
}

/** Random float in [a, b). */
export const rr = (r: Rng, a: number, b: number): number => a + (b - a) * r();

/** Linear-space colour from an sRGB hex string. */
export const col = (hex: string | THREE.Color): THREE.Color => new THREE.Color(hex);

/** Mixes two colours (linear space) without touching the inputs. */
export function mixc(a: THREE.Color | string, b: THREE.Color | string, t: number): THREE.Color {
  return col(a).lerp(col(b), t);
}

/** Scales a colour's lightness in HSL space and returns a new colour. */
export function shade(c: THREE.Color | string, light: number, sat = 1, hueShift = 0): THREE.Color {
  const out = col(c);
  const hsl = { h: 0, s: 0, l: 0 };
  out.getHSL(hsl);
  out.setHSL((hsl.h + hueShift + 1) % 1, Math.min(1, hsl.s * sat), Math.min(1, hsl.l * light));
  return out;
}

/** Collects disposables for one level so `load()` can free everything from the previous one. */
export class Bag {
  private items: { dispose(): void }[] = [];
  add<T extends { dispose(): void }>(x: T): T {
    this.items.push(x);
    return x;
  }
  dispose(): void {
    for (const x of this.items) x.dispose();
    this.items.length = 0;
  }
}

/** Removes every child from a group (geometry and materials are owned by bags). */
export function clearGroup(g: THREE.Object3D): void {
  while (g.children.length) g.remove(g.children[0]);
}

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpM3 = new THREE.Matrix3();

export interface AddOpts {
  /** Wind weight at the top of the part (0 = rigid). Grows with height above `windBase`. */
  wind?: number;
  windBase?: number;
  windHeight?: number;
  /** Darkens the bottom of the part: colour at the bottom is `color * (1 - grad)`. */
  grad?: number;
  /** Per-vertex colour jitter amount. */
  jitter?: number;
  /** Optional emissive-like phase used by glow materials for flicker. */
  phase?: number;
  /** Custom per-vertex colour: receives local position (before transform) and writes into `out`. */
  colorFn?: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void;
}

/**
 * Accumulates many small transformed primitives into one geometry with vertex
 * colours, a wind weight and a phase. One bucket becomes one draw call.
 */
export class GeoBucket {
  private parts: THREE.BufferGeometry[] = [];
  private seed = 1;

  get empty(): boolean {
    return this.parts.length === 0;
  }

  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color, o: AddOpts = {}): void {
    const g = geo.index ? geo.clone() : withIndex(geo.clone());
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    const n = pos.count;
    const colors = new Float32Array(n * 3);
    const wind = new Float32Array(n * 2);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const c = new THREE.Color();
    const r = rng(this.seed++);
    tmpM3.getNormalMatrix(m);
    for (let i = 0; i < n; i++) {
      tmpV.fromBufferAttribute(pos, i);
      tmpN.fromBufferAttribute(nrm, i);
      c.copy(color);
      if (o.colorFn) o.colorFn(tmpV, tmpN, c);
      if (o.grad) {
        const k = maxY > minY ? (tmpV.y - minY) / (maxY - minY) : 1;
        c.multiplyScalar(1 - o.grad * (1 - k));
      }
      if (o.jitter) c.multiplyScalar(1 + (r() - 0.5) * o.jitter);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.applyMatrix4(m);
    const tpos = g.attributes.position as THREE.BufferAttribute;
    let wMin = Infinity;
    let wMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = tpos.getY(i);
      if (y < wMin) wMin = y;
      if (y > wMax) wMax = y;
    }
    const base = o.windBase ?? wMin;
    const hgt = o.windHeight ?? Math.max(0.05, wMax - base);
    for (let i = 0; i < n; i++) {
      let w = 0;
      if (o.wind) w = o.wind * Math.min(1.5, Math.max(0, (tpos.getY(i) - base) / hgt));
      wind[i * 2] = w;
      wind[i * 2 + 1] = o.phase ?? 0;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aWind', new THREE.BufferAttribute(wind, 2));
    this.parts.push(g);
  }

  /** Merges everything added so far. Returns null when empty. */
  build(): THREE.BufferGeometry | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) return null;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

/** Gives a non-indexed geometry a trivial index so it can be merged with indexed ones. */
export function withIndex(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.index) return g;
  const n = g.attributes.position.count;
  const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Builds a transform from position, Euler rotation (x, y, z) and scale. */
export function mat(
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _s.set(sx, sy, sz);
  _p.set(x, y, z);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

/** Shared unit primitives (never disposed; reused for every level). */
export const PRIM = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1),
  cyl16: new THREE.CylinderGeometry(0.5, 0.5, 1, 18, 1),
  cone: new THREE.ConeGeometry(0.5, 1, 8, 1),
  cone5: new THREE.ConeGeometry(0.5, 1, 5, 1),
  sphere: new THREE.SphereGeometry(0.5, 12, 8),
  sphereLo: new THREE.SphereGeometry(0.5, 6, 4),
  sphereHi: new THREE.SphereGeometry(0.5, 20, 14),
  torus: new THREE.TorusGeometry(0.5, 0.08, 6, 20),
};

/** A blob made from an icosahedron with seeded radial noise (rocks, foliage). */
export function lumpGeometry(seed: number, detail = 1, rough = 0.18): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(0.5, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico);
  ico.dispose();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const r = rng(seed);
  const a = rr(r, 0, 6.28);
  const b = rr(r, 0, 6.28);
  const c = rr(r, 0, 6.28);
  const v = new THREE.Vector3();
  // Displace by position so welded corners move together and normals stay smooth.
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      Math.sin(v.x * 7 + a) * Math.sin(v.y * 6 + b) * Math.sin(v.z * 8 + c) * 0.6 +
      Math.sin(v.x * 13 + b) * Math.sin(v.z * 11 + a) * 0.4;
    v.multiplyScalar(1 + n * rough);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A tapered tube along a list of points (vines, stems, willow strands). */
export function taperTube(points: THREE.Vector3[], r0: number, r1: number, sides = 5): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const segs = Math.max(4, points.length * 3);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nor.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = i * sides + ((j + 1) % sides);
      const c = (i + 1) * sides + j;
      const d = (i + 1) * sides + ((j + 1) % sides);
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Clamped lerp of angles along the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Exponential smoothing factor for a rate (1/s) over dt seconds. */
export const kdamp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
