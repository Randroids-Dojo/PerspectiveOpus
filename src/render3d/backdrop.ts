import * as THREE from 'three';
import type { Level } from '../game/level';
import type { Palette } from '../game/palettes';
import type { Look } from './look';
import { cloudAtlas, moonTexture, SPRITE, spriteAtlas } from './textures';
import { Bag, col, mixc, rng, rr, shade, type Rng } from './util';

/**
 * Everything behind the level, drawn first with its own camera: the sky dome
 * (gradient, sun or moon, stars, painted clouds), layered silhouettes that fit
 * each movement, water, and light shafts. The background camera keeps a
 * normal lens even when the stage camera is almost orthographic, so the
 * backdrop reads the same at the side view and the three-quarter view.
 */

const TONE = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunSize;
uniform float uDisc;
uniform float uGlow;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  vec3 c;
  if (e >= 0.0) {
    c = mix(uHorizon, uMid, smoothstep(0.0, 0.22, e));
    c = mix(c, uTop, smoothstep(0.16, 0.75, e));
  } else {
    c = mix(uHorizon, uBottom, smoothstep(0.0, 0.2, -e));
  }
  float s = max(dot(d, uSunDir), 0.0);
  float glow = pow(s, 6.0) * 0.35 + pow(s, 40.0) * 0.6 + pow(s, 400.0) * 1.2;
  // A warm band along the horizon on the sun's side.
  float band = exp(-abs(e) * 14.0) * pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0);
  c += uSunColor * (glow + band * 0.25) * uGlow;
  float r = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
  float disc = 1.0 - smoothstep(uSunSize * 0.92, uSunSize, r);
  c += uSunColor * disc * uDisc;
  gl_FragColor = vec4(c, 1.0);
  ${TONE}
}
`;

const FLAT_VERT = /* glsl */ `
attribute vec3 aCol;
varying vec3 vCol;
varying float vY;
varying float vDist;
varying vec3 vWP;
void main() {
  vCol = aCol;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vY = wp.y;
  vDist = length(wp.xz - cameraPosition.xz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FLAT_FRAG = /* glsl */ `
uniform vec3 uMist;
uniform float uMistTop;
uniform float uMistBottom;
uniform float uMistRise;
uniform vec3 uSunDir;
uniform vec3 uSunGlow;
varying vec3 vCol;
varying float vY;
varying float vDist;
varying vec3 vWP;
float bhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bhash(i), bhash(i + vec2(1.0, 0.0)), f.x), mix(bhash(i + vec2(0.0, 1.0)), bhash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float rise = vDist * uMistRise;
  float m = 1.0 - smoothstep(uMistBottom + rise * 0.5, uMistTop + rise, vY);
  // Brush texture, broader with distance so far flats stay calm.
  float sc = 1.0 / (1.0 + vDist * 0.012);
  float n = bnoise(vWP.xy * 0.45 * sc) * 0.6 + bnoise(vWP.xy * 1.7 * sc + 13.0) * 0.4;
  vec3 c = vCol * (0.92 + 0.16 * n);
  c = mix(c, uMist, m);
  vec3 vd = normalize(vWP - cameraPosition);
  float g = pow(max(dot(vd, uSunDir), 0.0), 5.0);
  c += uSunGlow * g * (0.35 + 0.65 * smoothstep(20.0, 400.0, vDist));
  gl_FragColor = vec4(c, 1.0);
  ${TONE}
}
`;

const CLOUD_VERT = /* glsl */ `
attribute vec4 aCloud;
attribute vec2 aSize;
uniform float uTime;
varying vec2 vUv;
varying float vFade;
void main() {
  float cell = aCloud.w;
  vUv = (uv + vec2(mod(cell, 2.0), floor(cell / 2.0))) * 0.5;
  vec3 c = aCloud.xyz;
  float drift = mod(uTime * 2.0 + c.x * 7.0, 400.0) - 200.0;
  vec3 wp = c + vec3(drift, 0.0, 0.0);
  vec4 mv = viewMatrix * vec4(wp + cameraPosition, 1.0);
  mv.xy += (position.xy) * aSize;
  vFade = smoothstep(0.0, 120.0, c.y) * (1.0 - smoothstep(150.0, 200.0, abs(drift)));
  gl_Position = projectionMatrix * mv;
}
`;

const CLOUD_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uLit;
uniform vec3 uShade;
uniform float uOpacity;
varying vec2 vUv;
varying float vFade;
void main() {
  vec4 t = texture2D(uTex, vUv);
  vec3 c = mix(uShade, uLit, t.r);
  gl_FragColor = vec4(c, t.a * uOpacity * vFade);
  ${TONE}
}
`;

const BANK_VERT = /* glsl */ `
attribute vec4 aBank;
attribute vec2 aSize;
uniform float uTime;
varying vec2 vUv;
varying float vShade;
void main() {
  float cell = aBank.w;
  vUv = (uv + vec2(mod(cell, 2.0), floor(cell / 2.0))) * 0.5;
  vec3 c = aBank.xyz + vec3(sin(uTime * 0.04 + aBank.x * 0.1) * 4.0, 0.0, 0.0);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * aSize;
  vShade = position.y + 0.5;
  gl_Position = projectionMatrix * mv;
}
`;

const BANK_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uColor;
uniform vec3 uLit;
uniform float uOpacity;
varying vec2 vUv;
varying float vShade;
void main() {
  vec4 t = texture2D(uTex, vUv);
  vec3 c = mix(uColor, uLit, t.r * 0.6 * vShade);
  gl_FragColor = vec4(c, t.a * uOpacity);
  ${TONE}
}
`;

const STAR_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
varying float vA;
void main() {
  vec4 mv = viewMatrix * vec4(position + cameraPosition, 1.0);
  float tw = 0.6 + 0.4 * sin(uTime * (1.0 + aSeed * 3.0) + aSeed * 40.0);
  vA = tw * (0.4 + aSeed * 0.6) * smoothstep(0.02, 0.15, normalize(position).y);
  gl_PointSize = 1.2 + aSeed * 2.2;
  gl_Position = projectionMatrix * mv;
}
`;

const STAR_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(p)) * vA;
  gl_FragColor = vec4(uColor * 2.0, a);
  ${TONE}
}
`;

const WATER_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFog;
uniform float uTime;
uniform float uFogDist;
varying vec3 vW;
vec2 wave(vec2 p, float t) {
  vec2 g = vec2(0.0);
  g += vec2(cos(p.x * 0.9 + t * 0.7), 0.0) * 0.5;
  g += vec2(0.0, cos(p.y * 1.3 - t * 0.9)) * 0.4;
  g += vec2(cos((p.x + p.y) * 2.1 + t * 1.3)) * 0.18;
  g += vec2(cos((p.x * 3.7 - p.y * 2.9) + t * 1.9), sin(p.y * 3.1 + t * 1.7)) * 0.1;
  return g;
}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float dist = length(cameraPosition - vW);
  vec2 g = wave(vW.xz * 0.6, uTime) * 0.06;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uSky, smoothstep(0.0, 0.4, R.y));
  vec3 c = mix(uDeep, sky, 0.25 + 0.7 * fres);
  float spec = pow(max(dot(R, uSunDir), 0.0), 260.0) * 2.5 + pow(max(dot(R, uSunDir), 0.0), 24.0) * 0.12;
  c += uSunColor * spec;
  float f = 1.0 - exp(-dist / uFogDist);
  c = mix(c, uFog, f * 0.9);
  gl_FragColor = vec4(c, 1.0);
  ${TONE}
}
`;

const SHAFT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHAFT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
void main() {
  float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
  float len = smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
  float flick = 0.75 + 0.25 * sin(uTime * 0.6 + uSeed * 6.0 + vUv.x * 5.0);
  gl_FragColor = vec4(uColor * edge * len * flick, 1.0);
  ${TONE}
}
`;

/** Flat-coloured silhouette geometry built from 2D shapes at a fixed depth. */
class Flat {
  pos: number[] = [];
  colr: number[] = [];
  idx: number[] = [];
  /** Light catching the crests, and which side the light comes from (+1 right, -1 left). */
  static rimColor: THREE.Color | null = null;
  static sunSide = -1;
  rim: THREE.Color | null = Flat.rimColor;
  sunX = Flat.sunSide;

  constructor(public z: number) {}

  /** Polygon (any simple outline) with a vertical gradient: `lo` at the bottom, `hi` at the top. */
  poly(pts: [number, number][], c: THREE.Color, lo = 0.82, hi = 1.12, holes: [number, number][][] = []): void {
    if (pts.length < 3) return;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
    const v2 = (a: [number, number][]) => a.map((p) => new THREE.Vector2(p[0], p[1]));
    const contour = v2(pts);
    const hv = holes.map(v2);
    const tris = THREE.ShapeUtils.triangulateShape(contour, hv);
    const all = [...pts, ...holes.flat()];
    const base = this.pos.length / 3;
    for (const p of all) {
      this.pos.push(p[0], p[1], this.z);
      const k = y1 > y0 ? (p[1] - y0) / (y1 - y0) : 1;
      const s = lo + (hi - lo) * k;
      this.colr.push(c.r * s, c.g * s, c.b * s);
    }
    for (const t of tris) this.idx.push(base + t[0], base + t[2], base + t[1]);
  }

  rect(x0: number, y0: number, x1: number, y1: number, c: THREE.Color, lo = 0.85, hi = 1.1): void {
    this.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], c, lo, hi);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: THREE.Color, n = 18, lo = 0.8, hi = 1.15): void {
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    this.poly(pts, c, lo, hi);
  }

  /** A strip from a top profile down to `bottom`. */
  ridge(xs: number[], ys: number[], bottom: number, c: THREE.Color, lo = 0.75, hi = 1.08): void {
    // Three rows: a thin crest that catches the light, the lit body, the dark base.
    const base = this.pos.length / 3;
    let ymax = -Infinity;
    for (const y of ys) ymax = Math.max(ymax, y);
    const band = 0.35 + this.z * 0.004;
    const rim = new THREE.Color();
    for (let i = 0; i < xs.length; i++) {
      const k = 1 - (ymax - ys[i]) / Math.max(1, ymax - bottom);
      const s = lo + (hi - lo) * k;
      const a = ys[Math.max(0, i - 1)];
      const b = ys[Math.min(ys.length - 1, i + 1)];
      const dx = xs[Math.min(xs.length - 1, i + 1)] - xs[Math.max(0, i - 1)] || 1;
      const facing = Math.max(0, Math.min(1, 0.5 - ((b - a) / dx) * this.sunX * 2.5));
      rim.setRGB(c.r * s * 1.08, c.g * s * 1.08, c.b * s * 1.08);
      if (this.rim) rim.lerp(this.rim, 0.15 + 0.4 * facing);
      this.pos.push(xs[i], ys[i], this.z, xs[i], ys[i] - band, this.z, xs[i], bottom, this.z);
      this.colr.push(rim.r, rim.g, rim.b, c.r * s, c.g * s, c.b * s, c.r * lo, c.g * lo, c.b * lo);
    }
    for (let i = 0; i < xs.length - 1; i++) {
      const a = base + i * 3;
      this.idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }

  build(bag: Bag): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.colr, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return bag.add(g);
  }
}

/** Smooth 1D noise from a few sines with seeded phases. */
function profile(r: Rng, scale: number): (x: number) => number {
  const ph = [r() * 9, r() * 9, r() * 9, r() * 9];
  return (x: number) => {
    const u = x / scale;
    return (
      Math.sin(u + ph[0]) * 0.5 +
      Math.sin(u * 2.3 + ph[1]) * 0.25 +
      Math.sin(u * 5.1 + ph[2]) * 0.14 +
      Math.sin(u * 11.7 + ph[3]) * 0.06
    );
  };
}

interface Ctx {
  r: Rng;
  pal: Palette;
  look: Look;
  /** Reference ground height of the level. */
  g0: number;
  /** Level width. */
  w: number;
  /** Fog colour for aerial perspective. */
  fog: THREE.Color;
  /** Cooler, lighter colour that distant ranges fade towards. */
  far: THREE.Color;
  lights: Flat;
  /** Extra rotating parts (gears). */
  spinners: { mesh: THREE.Mesh; speed: number }[];
  group: THREE.Group;
  bag: Bag;
  flatMat: THREE.ShaderMaterial;
}

/** Aerial perspective: near layers keep their colour, far ones cool and fade into the sky. */
function aerial(ctx: Ctx, c: THREE.Color | string, z: number): THREE.Color {
  const k = 1 - Math.exp(-z / (210 / ctx.pal.haze));
  const target = ctx.fog.clone().lerp(ctx.far, Math.min(1, z / 400));
  return col(c).lerp(target, Math.min(0.92, 0.05 + k));
}

/** How far a layer at depth z must reach past the level ends so cutscene orbits never see its edge. */
function span(ctx: Ctx, z: number): [number, number] {
  const half = (z + 30) * 2.2 + 140;
  return [-half, ctx.w + half];
}

function hillsLayer(ctx: Ctx, f: Flat, z: number, base: number, amp: number, scale: number, c: THREE.Color, step = 2): (x: number) => number {
  const [x0, x1] = span(ctx, z);
  const n = profile(ctx.r, scale);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = x0; x <= x1; x += step) {
    xs.push(x);
    ys.push(base + amp * n(x));
  }
  f.ridge(xs, ys, base - 120, c);
  return (x: number) => base + amp * n(x);
}

// ---------------------------------------------------------------- silhouette props

function tree(f: Flat, x: number, y: number, s: number, c: THREE.Color, r: Rng): void {
  f.rect(x - 0.12 * s, y - 0.5, x + 0.12 * s, y + 1.4 * s, shade(c, 0.7));
  const blobs = 3 + Math.floor(r() * 3);
  for (let i = 0; i < blobs; i++)
    f.ellipse(x + rr(r, -0.7, 0.7) * s, y + (1.6 + rr(r, -0.2, 0.7)) * s, rr(r, 0.6, 1.0) * s, rr(r, 0.5, 0.8) * s, c, 14);
}

function pine(f: Flat, x: number, y: number, s: number, c: THREE.Color): void {
  f.rect(x - 0.1 * s, y - 0.4, x + 0.1 * s, y + 0.6 * s, shade(c, 0.7));
  for (let i = 0; i < 3; i++) {
    const yy = y + (0.4 + i * 0.75) * s;
    const w = (1.0 - i * 0.24) * s;
    f.poly([[x - w, yy], [x + w, yy], [x, yy + 1.4 * s]], c);
  }
}

function cypress(f: Flat, x: number, y: number, s: number, c: THREE.Color): void {
  f.poly(
    [
      [x - 0.45 * s, y],
      [x + 0.45 * s, y],
      [x + 0.6 * s, y + 1.2 * s],
      [x + 0.45 * s, y + 2.6 * s],
      [x, y + 4 * s],
      [x - 0.45 * s, y + 2.6 * s],
      [x - 0.6 * s, y + 1.2 * s],
    ],
    c,
  );
}

function willow(f: Flat, x: number, y: number, s: number, c: THREE.Color, r: Rng): void {
  f.rect(x - 0.15 * s, y - 0.5, x + 0.15 * s, y + 1.8 * s, shade(c, 0.65));
  const pts: [number, number][] = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = Math.PI * (1 - t);
    pts.push([x + Math.cos(a) * 1.7 * s, y + 1.8 * s + Math.sin(a) * 1.2 * s]);
  }
  // Hanging strands along the bottom edge.
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const xx = x + (t * 2 - 1) * 1.75 * s;
    const hang = (i % 2 ? 0.4 : 1.4 + r() * 0.6) * s * (1 - Math.abs(t * 2 - 1) * 0.5);
    pts.push([xx, y + 1.8 * s - hang]);
  }
  f.poly(pts, c, 0.75, 1.12);
}

function column(f: Flat, x: number, y: number, h: number, w: number, c: THREE.Color, broken: boolean, r: Rng): void {
  f.rect(x - w * 0.75, y, x + w * 0.75, y + w * 0.35, c);
  if (broken) {
    const top = y + h * rr(r, 0.4, 0.85);
    f.poly([[x - w / 2, y], [x + w / 2, y], [x + w / 2, top - w * 0.3], [x + w * 0.1, top], [x - w / 2, top + w * 0.2]], c);
  } else {
    f.rect(x - w / 2, y, x + w / 2, y + h, c);
    f.rect(x - w * 0.8, y + h, x + w * 0.8, y + h + w * 0.35, c);
  }
}

function archRuin(f: Flat, x: number, y: number, w: number, h: number, c: THREE.Color, broken: boolean): void {
  const t = w * 0.18;
  const r0 = w / 2;
  const ri = r0 - t;
  // Build an arch outline: left pier up, around the inner curve, down the right pier.
  const pts: [number, number][] = [[x - r0, y]];
  const yb = y + h - r0;
  pts.push([x - r0, yb]);
  const n = 14;
  const end = broken ? 0.55 : 1;
  for (let i = 0; i <= n * end; i++) {
    const a = Math.PI - (i / n) * Math.PI;
    pts.push([x + Math.cos(a) * r0, yb + Math.sin(a) * r0]);
  }
  if (broken) {
    const a = Math.PI - end * Math.PI;
    pts.push([x + Math.cos(a) * ri, yb + Math.sin(a) * ri]);
    for (let i = Math.floor(n * end); i >= 0; i--) {
      const aa = Math.PI - (i / n) * Math.PI;
      pts.push([x + Math.cos(aa) * ri, yb + Math.sin(aa) * ri]);
    }
    pts.push([x - ri, y]);
  } else {
    pts.push([x + r0, y], [x + ri, y], [x + ri, yb]);
    for (let i = n; i >= 0; i--) {
      const a = Math.PI - (i / n) * Math.PI;
      pts.push([x + Math.cos(a) * ri, yb + Math.sin(a) * ri]);
    }
    pts.push([x - ri, y]);
  }
  f.poly(pts, c);
}

function house(ctx: Ctx, f: Flat, x: number, y: number, w: number, h: number, c: THREE.Color, roof: THREE.Color, r: Rng, lit: number): void {
  f.rect(x - w / 2, y - 1, x + w / 2, y + h, c, 0.9, 1.05);
  const over = w * 0.12;
  const rh = w * rr(r, 0.45, 0.75);
  f.poly([[x - w / 2 - over, y + h], [x + w / 2 + over, y + h], [x, y + h + rh]], roof, 0.8, 1.12);
  if (r() < 0.7) {
    const cx = x + rr(r, -0.25, 0.25) * w;
    f.rect(cx - w * 0.06, y + h + rh * 0.3, cx + w * 0.06, y + h + rh * 0.85, shade(roof, 0.8));
  }
  const glow = col(ctx.pal.glow).multiplyScalar(2.4);
  ctx.lights.z = f.z - 0.1;
  const rows = Math.max(1, Math.floor(h / (w * 0.45)));
  for (let j = 0; j < rows; j++)
    for (const s of [-0.22, 0.22]) {
      if (r() > lit) continue;
      const wx = x + s * w;
      const wy = y + h * ((j + 0.55) / (rows + 0.3));
      ctx.lights.rect(wx - w * 0.06, wy - w * 0.08, wx + w * 0.06, wy + w * 0.08, glow, 1, 1);
    }
}

function gearShape(teeth: number, r0: number, r1: number, hole: number): THREE.Shape {
  const s = new THREE.Shape();
  const n = teeth * 4;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = i % 4;
    const rad = k === 1 || k === 2 ? r1 : r0;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  const spokes = 5;
  for (let i = 0; i < spokes; i++) {
    const a0 = (i / spokes) * Math.PI * 2 + 0.22;
    const a1 = ((i + 1) / spokes) * Math.PI * 2 - 0.22;
    const h = new THREE.Path();
    const ri = hole * 1.6;
    const ro = r0 * 0.78;
    h.moveTo(Math.cos(a0) * ri, Math.sin(a0) * ri);
    h.absarc(0, 0, ro, a0, a1, false);
    h.lineTo(Math.cos(a1) * ri, Math.sin(a1) * ri);
    h.absarc(0, 0, ri, a1, a0, true);
    s.holes.push(h);
  }
  return s;
}

function gear(ctx: Ctx, x: number, y: number, z: number, rad: number, c: THREE.Color, speed: number): void {
  const geo = ctx.bag.add(new THREE.ShapeGeometry(gearShape(Math.max(8, Math.round(rad * 3)), rad, rad * 1.12, rad * 0.12), 1));
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    const k = 0.85 + 0.25 * (pos.getY(i) / rad);
    colors[i * 3] = c.r * k;
    colors[i * 3 + 1] = c.g * k;
    colors[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('aCol', new THREE.BufferAttribute(colors, 3));
  const m = new THREE.Mesh(geo, ctx.flatMat);
  m.position.set(x, y, z);
  ctx.group.add(m);
  ctx.spinners.push({ mesh: m, speed });
}

// ---------------------------------------------------------------- per movement

function buildDawn(ctx: Ctx, flats: Flat[]): void {
  const { r, pal, g0 } = ctx;
  const green = col(pal.mats.leaf.color);
  const stone = col(pal.mats.stone.color);
  const far = mixc(pal.skyMid, pal.hemiSky, 0.5);
  // Distant mountains.
  const f5 = new Flat(520);
  hillsLayer(ctx, f5, 520, g0 + 34, 26, 60, aerial(ctx, shade(far, 0.8), 520), 6);
  const f4 = new Flat(260);
  hillsLayer(ctx, f4, 260, g0 + 12, 12, 34, aerial(ctx, mixc(green, far, 0.5), 260), 4);
  // Middle hills with trees and a ruined tower.
  const f3 = new Flat(120);
  const h3 = hillsLayer(ctx, f3, 120, g0 + 3, 6, 18, aerial(ctx, green, 120), 2);
  const tc3 = aerial(ctx, shade(green, 0.85), 120);
  const [a3, b3] = span(ctx, 120);
  for (let x = a3; x < b3; x += rr(r, 4, 12)) {
    const k = r();
    if (k < 0.45) tree(f3, x, h3(x), rr(r, 1.4, 2.4), tc3, r);
    else if (k < 0.6) pine(f3, x, h3(x) - 0.3, rr(r, 1.6, 2.6), shade(tc3, 0.9));
  }
  for (let x = a3 + rr(r, 20, 60); x < b3; x += rr(r, 90, 160)) {
    const sc = aerial(ctx, stone, 120);
    const y = h3(x) - 0.5;
    f3.rect(x - 3, y, x + 3, y + 16, sc);
    for (let k = -3; k < 3; k += 1.5) f3.rect(x + k, y + 16, x + k + 0.8, y + 17.2, sc);
    f3.ellipse(x, y + 11, 0.8, 1.4, shade(sc, 0.6), 10, 1, 1);
  }
  // Near hills: ruins, columns and trees.
  const f2 = new Flat(48);
  const h2 = hillsLayer(ctx, f2, 48, g0 - 1, 3.5, 11, aerial(ctx, shade(green, 0.92), 48), 1);
  const [a2, b2] = span(ctx, 48);
  const tc2 = aerial(ctx, shade(green, 0.78), 48);
  const sc2 = aerial(ctx, stone, 48);
  for (let x = a2; x < b2; x += rr(r, 3, 9)) {
    const y = h2(x) - 0.3;
    const k = r();
    if (k < 0.45) tree(f2, x, y, rr(r, 1.0, 1.7), tc2, r);
    else if (k < 0.55) column(f2, x, y, rr(r, 4, 7), 0.8, sc2, r() < 0.5, r);
    else if (k < 0.6) archRuin(f2, x, y, rr(r, 4, 6), rr(r, 6, 9), sc2, r() < 0.5);
  }
  // A low crest just behind the level.
  const f1 = new Flat(22);
  const h1 = hillsLayer(ctx, f1, 22, g0 - 4, 1.6, 6, aerial(ctx, shade(green, 0.85), 22), 0.5);
  const [a1, b1] = span(ctx, 22);
  for (let x = a1; x < b1; x += rr(r, 2, 6)) {
    const y = h1(x) - 0.2;
    const k = r();
    if (k < 0.35) tree(f1, x, y, rr(r, 0.8, 1.3), aerial(ctx, shade(green, 0.7), 22), r);
    else if (k < 0.45) f1.ellipse(x, y + 0.3, rr(r, 0.8, 1.5), rr(r, 0.5, 0.9), aerial(ctx, shade(green, 0.8), 22), 12);
    else if (k < 0.5) column(f1, x, y, rr(r, 2, 4), 0.6, aerial(ctx, stone, 22), true, r);
  }
  flats.push(f5, f4, f3, f2, f1);
}

function buildLake(ctx: Ctx, flats: Flat[], waterY: number): void {
  const { r, pal } = ctx;
  const green = col(pal.mats.leaf.color);
  const far = mixc(pal.skyMid, pal.fog, 0.4);
  const f5 = new Flat(480);
  hillsLayer(ctx, f5, 480, waterY + 26, 18, 50, aerial(ctx, shade(far, 0.85), 480), 6);
  const f4 = new Flat(240);
  hillsLayer(ctx, f4, 240, waterY + 8, 6, 30, aerial(ctx, shade(green, 0.9), 240), 4);
  const f3 = new Flat(110);
  const h3 = hillsLayer(ctx, f3, 110, waterY + 1.5, 2.5, 20, aerial(ctx, green, 110), 2);
  const [a3, b3] = span(ctx, 110);
  for (let x = a3; x < b3; x += rr(r, 5, 12)) if (r() < 0.7) willow(f3, x, h3(x) - 0.3, rr(r, 1.6, 2.6), aerial(ctx, shade(green, 0.9), 110), r);
  const f2 = new Flat(50);
  const [a2, b2] = span(ctx, 50);
  // Islands with willows and reeds.
  for (let x = a2; x < b2; x += rr(r, 14, 30)) {
    const w = rr(r, 6, 14);
    const c = aerial(ctx, shade(green, 0.8), 50);
    f2.ellipse(x, waterY, w, 1.2, c, 20);
    willow(f2, x + rr(r, -2, 2), waterY + 0.6, rr(r, 1.4, 2.0), aerial(ctx, shade(green, 0.85), 50), r);
    for (let k = 0; k < 6; k++) {
      const rx = x + rr(r, -w, w) * 0.8;
      f2.poly([[rx - 0.08, waterY], [rx + 0.08, waterY], [rx + 0.02, waterY + rr(r, 1, 2)]], c);
    }
  }
  const f1 = new Flat(26);
  const [a1, b1] = span(ctx, 26);
  for (let x = a1; x < b1; x += rr(r, 1, 4)) {
    const c = aerial(ctx, shade(green, 0.65), 26);
    for (let k = 0; k < 3; k++) {
      const rx = x + rr(r, -0.6, 0.6);
      const h = rr(r, 0.8, 2.2);
      f1.poly([[rx - 0.05, waterY - 0.5], [rx + 0.05, waterY - 0.5], [rx + rr(r, -0.3, 0.3), waterY + h]], c);
    }
  }
  flats.push(f5, f4, f3, f2, f1);
}

function buildAutumn(ctx: Ctx, flats: Flat[]): void {
  const { r, pal, g0 } = ctx;
  const leaf = col(pal.mats.leaf.color);
  const brick = col(pal.mats.brick.color);
  const roof = shade(pal.mats.brick.color2, 0.85);
  const far = mixc(pal.skyMid, pal.fog, 0.5);
  const f5 = new Flat(500);
  hillsLayer(ctx, f5, 500, g0 + 28, 18, 55, aerial(ctx, shade(far, 0.8), 500), 6);
  const f4 = new Flat(250);
  const h4 = hillsLayer(ctx, f4, 250, g0 + 8, 8, 30, aerial(ctx, mixc(leaf, far, 0.4), 250), 4);
  const [a4, b4] = span(ctx, 250);
  // A windmill and a church on the far hills.
  for (let x = a4 + 30; x < b4; x += rr(r, 120, 200)) {
    const y = h4(x) - 0.5;
    const c = aerial(ctx, shade(brick, 0.8), 250);
    f4.poly([[x - 3, y], [x + 3, y], [x + 2, y + 12], [x - 2, y + 12]], c);
    f4.poly([[x - 2.6, y + 12], [x + 2.6, y + 12], [x, y + 15]], c);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const cx = x;
      const cy = y + 12;
      const ex = cx + Math.cos(a) * 9;
      const ey = cy + Math.sin(a) * 9;
      const nx = -Math.sin(a) * 0.9;
      const ny = Math.cos(a) * 0.9;
      f4.poly([[cx, cy], [ex, ey], [ex + nx, ey + ny], [cx + nx * 0.3, cy + ny * 0.3]], c);
    }
  }
  const f3 = new Flat(120);
  const h3 = hillsLayer(ctx, f3, 120, g0 + 1, 3, 20, aerial(ctx, shade(leaf, 0.9), 120), 2);
  const [a3, b3] = span(ctx, 120);
  for (let x = a3; x < b3; x += rr(r, 7, 14)) {
    const y = h3(x) - 0.5;
    if (r() < 0.55) house(ctx, f3, x, y, rr(r, 4, 6), rr(r, 4, 8), aerial(ctx, brick, 120), aerial(ctx, roof, 120), r, 0.4);
    else tree(f3, x, y, rr(r, 1.6, 2.4), aerial(ctx, leaf, 120), r);
  }
  for (let x = a3 + 40; x < b3; x += rr(r, 140, 200)) {
    const y = h3(x) - 0.5;
    const c = aerial(ctx, shade(brick, 0.9), 120);
    f3.rect(x - 2.5, y, x + 2.5, y + 18, c);
    f3.poly([[x - 3, y + 18], [x + 3, y + 18], [x, y + 28]], aerial(ctx, roof, 120));
    ctx.lights.z = f3.z - 0.1;
    ctx.lights.ellipse(x, y + 14, 1.2, 1.2, col(pal.glow).multiplyScalar(2), 12, 1, 1);
  }
  const f2 = new Flat(50);
  const h2 = hillsLayer(ctx, f2, 50, g0 - 1.5, 1.5, 12, aerial(ctx, shade(leaf, 0.75), 50), 1);
  const [a2, b2] = span(ctx, 50);
  for (let x = a2; x < b2; x += rr(r, 4, 8)) {
    const y = h2(x) - 0.4;
    if (r() < 0.5) house(ctx, f2, x, y, rr(r, 3, 4.5), rr(r, 3, 5), aerial(ctx, shade(brick, 1.05), 50), aerial(ctx, roof, 50), r, 0.5);
    else tree(f2, x, y, rr(r, 1.1, 1.6), aerial(ctx, shade(leaf, 1.05), 50), r);
  }
  const f1 = new Flat(22);
  const h1 = hillsLayer(ctx, f1, 22, g0 - 4, 1.2, 6, aerial(ctx, shade(leaf, 0.6), 22), 0.5);
  const [a1, b1] = span(ctx, 22);
  for (let x = a1; x < b1; x += rr(r, 2, 5)) if (r() < 0.5) tree(f1, x, h1(x), rr(r, 0.8, 1.2), aerial(ctx, shade(leaf, 0.85), 22), r);
  // A fence along the near crest.
  for (let x = a1; x < b1; x += 1.2) f1.rect(x, h1(x) - 0.2, x + 0.12, h1(x) + 0.9, aerial(ctx, shade(pal.mats.wood.color, 0.8), 22));
  flats.push(f5, f4, f3, f2, f1);
}

function buildNight(ctx: Ctx, flats: Flat[]): void {
  const { r, pal, g0 } = ctx;
  const hedge = col(pal.mats.leaf.color);
  const stone = col(pal.mats.marble.color);
  const far = mixc(pal.skyHorizon, pal.skyMid, 0.5);
  const lamp = col(pal.glow).multiplyScalar(1.8);
  const warm = col('#ffcf7a').multiplyScalar(1.6);
  const f5 = new Flat(500);
  hillsLayer(ctx, f5, 500, g0 + 24, 16, 50, aerial(ctx, shade(far, 0.7), 500), 6);
  const f4 = new Flat(240);
  const h4 = hillsLayer(ctx, f4, 240, g0 + 6, 6, 30, aerial(ctx, shade(hedge, 0.9), 240), 4);
  const [a4, b4] = span(ctx, 240);
  for (let x = a4; x < b4; x += rr(r, 8, 18)) if (r() < 0.5) cypress(f4, x, h4(x) - 0.5, rr(r, 2, 3), aerial(ctx, shade(hedge, 0.8), 240));
  const f3 = new Flat(110);
  const h3 = hillsLayer(ctx, f3, 110, g0 + 1, 2, 20, aerial(ctx, hedge, 110), 2);
  const [a3, b3] = span(ctx, 110);
  for (let x = a3; x < b3; x += rr(r, 4, 9)) {
    const y = h3(x) - 0.4;
    const k = r();
    if (k < 0.5) cypress(f3, x, y, rr(r, 1.4, 2.2), aerial(ctx, shade(hedge, 0.85), 110));
    else if (k < 0.62) {
      // A domed pavilion.
      const c = aerial(ctx, stone, 110);
      f3.rect(x - 4, y, x + 4, y + 0.8, c);
      for (const s of [-3.2, -1.1, 1.1, 3.2]) f3.rect(x + s - 0.3, y + 0.8, x + s + 0.3, y + 6, c);
      f3.rect(x - 4, y + 6, x + 4, y + 6.8, c);
      const dome: [number, number][] = [];
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI;
        dome.push([x + Math.cos(a) * 3.8, y + 6.8 + Math.sin(a) * 3]);
      }
      f3.poly(dome, c);
      ctx.lights.z = f3.z - 0.1;
      ctx.lights.ellipse(x, y + 3.4, 0.7, 0.9, warm, 10, 1, 1);
    }
  }
  const f2 = new Flat(48);
  const h2 = hillsLayer(ctx, f2, 48, g0 - 1, 1.2, 12, aerial(ctx, shade(hedge, 0.8), 48), 1);
  const [a2, b2] = span(ctx, 48);
  for (let x = a2; x < b2; x += rr(r, 2.5, 6)) {
    const y = h2(x) - 0.3;
    const k = r();
    const c = aerial(ctx, shade(hedge, 0.9), 48);
    if (k < 0.3) f2.ellipse(x, y + 0.9, 1.2, 1.1, c, 14);
    else if (k < 0.5) {
      f2.ellipse(x, y + 0.6, 0.7, 0.7, c, 12);
      f2.ellipse(x, y + 1.7, 0.55, 0.55, c, 12);
      f2.ellipse(x, y + 2.6, 0.38, 0.38, c, 12);
    } else if (k < 0.65) cypress(f2, x, y, rr(r, 0.9, 1.4), c);
    else if (k < 0.75) {
      const lc = aerial(ctx, shade(stone, 0.6), 48);
      f2.rect(x - 0.08, y, x + 0.08, y + 2.4, lc);
      ctx.lights.z = f2.z - 0.1;
      ctx.lights.ellipse(x, y + 2.5, 0.25, 0.3, lamp, 8, 1, 1);
    }
  }
  const f1 = new Flat(22);
  const h1 = hillsLayer(ctx, f1, 22, g0 - 4, 0.8, 6, aerial(ctx, shade(hedge, 0.7), 22), 0.5);
  const [a1, b1] = span(ctx, 22);
  // A clipped hedge with a balustrade.
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = a1; x <= b1; x += 0.5) {
    xs.push(x);
    ys.push(h1(x) + 1.2);
  }
  f1.ridge(xs, ys, g0 - 60, aerial(ctx, shade(hedge, 0.75), 22));
  for (let x = a1; x < b1; x += rr(r, 6, 12)) f1.ellipse(x, h1(x) + 1.8, 0.7, 0.7, aerial(ctx, shade(hedge, 0.85), 22), 12);
  flats.push(f5, f4, f3, f2, f1);
}

function buildClock(ctx: Ctx, flats: Flat[]): void {
  const { r, pal, g0 } = ctx;
  const brass = col(pal.mats.brass.color);
  const wood = col(pal.mats.wood.color);
  const dark = col(pal.mats.dark.color);
  // Back wall with a round opening for the clock face.
  const f5 = new Flat(200);
  const [a5, b5] = span(ctx, 200);
  const wallC = aerial(ctx, shade(wood, 0.7), 200);
  const cx = ctx.w / 2;
  const cy = g0 + 6;
  const R = 30;
  const outer: [number, number][] = [[a5, g0 - 120], [b5, g0 - 120], [b5, g0 + 140], [a5, g0 + 140]];
  const hole: [number, number][] = [];
  for (let i = 0; i < 48; i++) {
    const a = -(i / 48) * Math.PI * 2;
    hole.push([cx + Math.cos(a) * (R + 1.5), cy + Math.sin(a) * (R + 1.5)]);
  }
  f5.poly(outer, wallC, 0.7, 1.05, [hole]);
  // Pilasters on the back wall.
  for (let x = a5; x < b5; x += 24) if (Math.abs(x - cx) > R + 6) f5.rect(x - 1.5, g0 - 120, x + 1.5, g0 + 140, aerial(ctx, shade(wood, 0.85), 199));
  const f4 = new Flat(150);
  const [a4, b4] = span(ctx, 150);
  // Tall organ pipes.
  for (let x = a4; x < b4; x += rr(r, 1.6, 2.6)) {
    if (Math.abs(x - cx) < R * 0.9) continue;
    const h = 30 + 20 * Math.sin(x * 0.07) + rr(r, -4, 4);
    const w = rr(r, 0.7, 1.2);
    const c = aerial(ctx, shade(brass, rr(r, 0.75, 1.0)), 150);
    f4.rect(x - w, g0 - 40, x + w, g0 + h, c, 0.6, 1.15);
    f4.poly([[x - w, g0 + h - 3], [x + w, g0 + h - 3], [x, g0 + h - 1.5]], shade(c, 0.4), 1, 1);
  }
  for (let i = 0; i < 6; i++) gear(ctx, cx + rr(r, -70, 70) + (r() < 0.5 ? -50 : 50), g0 + rr(r, -6, 30), 120, rr(r, 5, 12), aerial(ctx, shade(brass, 0.8), 120), rr(r, -0.25, 0.25));
  const f3 = new Flat(70);
  const [a3, b3] = span(ctx, 70);
  // Trusses and beams.
  const beamC = aerial(ctx, shade(dark, 1.2), 70);
  for (let x = a3; x < b3; x += 16) {
    f3.rect(x - 0.8, g0 - 40, x + 0.8, g0 + 40, beamC);
    f3.poly([[x, g0 + 8], [x + 0.9, g0 + 8], [x + 16.9, g0 + 24], [x + 16, g0 + 24]], beamC);
  }
  f3.rect(a3, g0 + 23.5, b3, g0 + 25.5, beamC);
  f3.rect(a3, g0 + 7, b3, g0 + 8.5, beamC);
  for (let i = 0; i < 8; i++) gear(ctx, rr(r, a3 + 40, b3 - 40), g0 + rr(r, -4, 16), 60, rr(r, 3, 7), aerial(ctx, brass, 60), rr(r, -0.5, 0.5));
  const f2 = new Flat(34);
  const [a2, b2] = span(ctx, 34);
  for (let x = a2; x < b2; x += rr(r, 5, 11)) {
    const c = aerial(ctx, shade(brass, 0.9), 34);
    // Pipes rising from the dark below, some with valves.
    const w = rr(r, 0.3, 0.6);
    const top = g0 - rr(r, 0, 4);
    f2.rect(x - w, g0 - 60, x + w, top, c, 0.55, 1.1);
    if (r() < 0.5) f2.ellipse(x, top - rr(r, 1, 3), w * 2, w * 2, shade(c, 1.1), 12);
  }
  for (let i = 0; i < 10; i++) gear(ctx, rr(r, a2, b2), g0 + rr(r, -12, -2), 28, rr(r, 1.5, 4), aerial(ctx, shade(brass, 1.05), 28), rr(r, -0.9, 0.9));
  flats.push(f5, f4, f3, f2);
}

function buildFinale(ctx: Ctx, flats: Flat[]): void {
  const { r, pal, g0 } = ctx;
  const velvet = col(pal.mats.dark.color);
  const gold = col(pal.mats.brass.color);
  const marble = col(pal.mats.marble.color);
  const warm = col(pal.glow).multiplyScalar(1.7);
  const cx = ctx.w / 2;
  // Back wall with tall arched windows onto the sunset.
  const f5 = new Flat(200);
  const [a5, b5] = span(ctx, 200);
  const wall = aerial(ctx, shade(velvet, 1.1), 200);
  const holes: [number, number][][] = [];
  for (let x = cx - 90; x <= cx + 90; x += 45) {
    const w = 9;
    const h: [number, number][] = [];
    h.push([x + w, g0 - 10], [x + w, g0 + 30]);
    for (let i = 1; i < 12; i++) {
      const a = (i / 12) * Math.PI;
      h.push([x + Math.cos(a) * w, g0 + 30 + Math.sin(a) * w]);
    }
    h.push([x - w, g0 + 30], [x - w, g0 - 10]);
    holes.push(h.reverse());
  }
  f5.poly([[a5, g0 - 120], [b5, g0 - 120], [b5, g0 + 140], [a5, g0 + 140]], wall, 0.7, 1.05, holes);
  const f4 = new Flat(140);
  const [a4, b4] = span(ctx, 140);
  ctx.lights.z = 139.8;
  // Balcony tiers with gold rails and lamps.
  for (let tier = 0; tier < 3; tier++) {
    const y = g0 + 6 + tier * 9;
    const c = aerial(ctx, shade(velvet, 0.9 - tier * 0.05), 140);
    f4.rect(a4, y - 3, b4, y, c, 0.8, 1.05);
    f4.rect(a4, y - 0.3, b4, y + 0.4, aerial(ctx, gold, 140), 0.9, 1.1);
    for (let x = a4; x < b4; x += 6) ctx.lights.ellipse(x, y + 1.0, 0.3, 0.4, warm, 8, 1, 1);
  }
  for (let x = a4; x < b4; x += 18) f4.rect(x - 1.2, g0 - 40, x + 1.2, g0 + 33, aerial(ctx, marble, 140), 0.75, 1.05);
  // Chandeliers.
  for (let x = a4 + 20; x < b4; x += rr(r, 50, 80)) {
    const y = g0 + 26;
    f4.rect(x - 0.05, y + 2, x + 0.05, y + 14, aerial(ctx, gold, 139));
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      ctx.lights.ellipse(x + Math.cos(a) * 2.2, y + Math.sin(a) * 0.5, 0.25, 0.3, warm, 8, 1, 1);
    }
    ctx.lights.ellipse(x, y - 1, 0.4, 0.5, warm, 8, 1, 1);
  }
  const f3 = new Flat(70);
  const [a3, b3] = span(ctx, 70);
  // Grand curtains: swagged drapes between columns.
  for (let x = a3; x < b3; x += 22) {
    const c = aerial(ctx, velvet, 70);
    const pts: [number, number][] = [];
    const n = 12;
    for (let i = 0; i <= n; i++) pts.push([x + (i / n) * 22, g0 + 30 - Math.sin((i / n) * Math.PI) * 6]);
    pts.push([x + 22, g0 + 34], [x, g0 + 34]);
    f3.poly(pts, c, 0.75, 1.1);
    f3.poly([[x - 2, g0 - 30], [x + 2.5, g0 - 30], [x + 1.2, g0 + 31], [x - 2, g0 + 34]], shade(c, 0.9), 0.6, 1.1);
    f3.rect(x - 2.6, g0 + 33.5, x + 24.6, g0 + 35, aerial(ctx, gold, 70));
  }
  const f2 = new Flat(32);
  const [a2, b2] = span(ctx, 32);
  // Rows of seats seen from the stage.
  for (let row = 0; row < 4; row++) {
    const y = g0 - 6 - row * 2.2;
    const c = aerial(ctx, shade(velvet, 1.2 - row * 0.08), 32 + row);
    for (let x = a2; x < b2; x += 1.5) {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI;
        pts.push([x + 0.65 + Math.cos(a) * 0.65, y + 1.6 + Math.sin(a) * 0.5]);
      }
      pts.push([x, y], [x + 1.3, y]);
      f2.poly(pts, c, 0.7, 1.1);
    }
  }
  flats.push(f5, f4, f3, f2);
}

// ---------------------------------------------------------------- clock face and windows

function clockFaceTexture(pal: Palette): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.5);
  gr.addColorStop(0, '#fff3d6');
  gr.addColorStop(0.7, pal.skyHorizon);
  gr.addColorStop(1, pal.skyMid);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#2a1a12';
  g.lineCap = 'round';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.47, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 4;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const big = i % 5 === 0;
    g.lineWidth = big ? 9 : 3;
    const r0 = S * (big ? 0.38 : 0.42);
    const r1 = S * 0.45;
    g.beginPath();
    g.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0);
    g.lineTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1);
    g.stroke();
  }
  // Mullions: the face is a window.
  g.lineWidth = 5;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(S / 2 + Math.cos(a) * S * 0.1, S / 2 + Math.sin(a) * S * 0.1);
    g.lineTo(S / 2 + Math.cos(a) * S * 0.36, S / 2 + Math.sin(a) * S * 0.36);
    g.stroke();
  }
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.1, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- the backdrop

export class Backdrop {
  readonly scene = new THREE.Scene();
  private dome: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private flatMat: THREE.ShaderMaterial;
  private lightMat: THREE.ShaderMaterial;
  private sim = new THREE.Group();
  private follow = new THREE.Group();
  private levelBag = new Bag();
  private spinners: { mesh: THREE.Mesh; speed: number }[] = [];
  private cloudMat: THREE.ShaderMaterial;
  private starMat: THREE.ShaderMaterial;
  private waterMat: THREE.ShaderMaterial;
  private bankMat: THREE.ShaderMaterial;
  private water: THREE.Mesh;
  private shafts: THREE.Mesh[] = [];
  private hands: THREE.Mesh[] = [];
  private bodyDir = new THREE.Vector3(0, 0.1, -1).normalize();
  waterY = -999;

  constructor() {
    this.sim.scale.z = -1;
    this.scene.add(this.follow, this.sim);
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uMid: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uBottom: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 0.1, -1) },
        uSunColor: { value: new THREE.Color() },
        uSunSize: { value: 0.02 },
        uDisc: { value: 6 },
        uGlow: { value: 1 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.skyMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.follow.add(this.dome);
    this.flatMat = new THREE.ShaderMaterial({
      vertexShader: FLAT_VERT,
      fragmentShader: FLAT_FRAG,
      uniforms: { uMist: { value: new THREE.Color() }, uMistTop: { value: 0 }, uMistBottom: { value: -10 }, uMistRise: { value: 0.04 }, uSunDir: { value: new THREE.Vector3(0, 0, -1) }, uSunGlow: { value: new THREE.Color() } },
      side: THREE.DoubleSide,
    });
    this.lightMat = new THREE.ShaderMaterial({
      vertexShader: FLAT_VERT,
      fragmentShader: FLAT_FRAG,
      uniforms: { uMist: { value: new THREE.Color() }, uMistTop: { value: -999 }, uMistBottom: { value: -1000 }, uMistRise: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 0, -1) }, uSunGlow: { value: new THREE.Color() } },
      side: THREE.DoubleSide,
    });
    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        uTex: { value: cloudAtlas() },
        uLit: { value: new THREE.Color() },
        uShade: { value: new THREE.Color() },
        uOpacity: { value: 0.9 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uColor: { value: new THREE.Color('#dfe8ff') }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uDeep: { value: new THREE.Color() },
        uSky: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uTime: { value: 0 },
        uFogDist: { value: 200 },
      },
    });
    this.bankMat = new THREE.ShaderMaterial({
      vertexShader: BANK_VERT,
      fragmentShader: BANK_FRAG,
      uniforms: {
        uTex: { value: cloudAtlas() },
        uColor: { value: new THREE.Color() },
        uLit: { value: new THREE.Color() },
        uOpacity: { value: 0.5 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.renderOrder = -5;
    this.water.visible = false;
    this.scene.add(this.water);
  }

  load(lv: Level, pal: Palette, look: Look, heights: Int16Array): void {
    this.levelBag.dispose();
    while (this.sim.children.length) this.sim.remove(this.sim.children[0]);
    for (const c of [...this.follow.children]) if (c !== this.dome) this.follow.remove(c);
    this.spinners = [];
    this.shafts = [];
    this.hands = [];
    const bag = this.levelBag;
    const u = this.skyMat.uniforms;
    (u.uTop.value as THREE.Color).copy(col(pal.skyTop));
    (u.uMid.value as THREE.Color).copy(col(pal.skyMid));
    (u.uHorizon.value as THREE.Color).copy(col(pal.skyHorizon));
    (u.uBottom.value as THREE.Color).copy(col(pal.skyBottom));
    const bd = look.skyBody.dir;
    this.bodyDir.set(bd[0], bd[1], -bd[2]).normalize();
    (u.uSunDir.value as THREE.Vector3).copy(this.bodyDir);
    (u.uSunColor.value as THREE.Color).copy(col(pal.sun));
    const kind = look.skyBody.kind;
    u.uSunSize.value = kind === 'sun' ? 0.03 * look.skyBody.size : 0;
    u.uDisc.value = kind === 'sun' ? 7 : 0;
    u.uGlow.value = kind === 'moon' ? 0.35 : kind === 'sun' ? 1 : 0.6;

    // Reference height: the most common floor height of the level.
    const counts = new Map<number, number>();
    for (let i = 0; i < heights.length; i++) if (heights[i] > 0) counts.set(heights[i], (counts.get(heights[i]) ?? 0) + 1);
    let g0 = 4;
    let best = 0;
    for (const [h, n] of counts) if (n > best) {
      best = n;
      g0 = h;
    }
    let minTop = Infinity;
    for (let i = 0; i < heights.length; i++) if (heights[i] > 0) minTop = Math.min(minTop, heights[i]);
    if (!Number.isFinite(minTop)) minTop = g0;

    this.waterY = pal.water ? Math.max(0.4, Math.min(2.5, minTop - 1.6)) : -999;
    const fog = col(pal.fog).lerp(col(pal.skyHorizon), 0.35);
    const mist = col(pal.skyBottom).lerp(col(pal.fog), 0.45);
    const fu = this.flatMat.uniforms;
    (fu.uMist.value as THREE.Color).copy(pal.water ? col(pal.fog).lerp(col(pal.water), 0.25) : mist);
    fu.uMistTop.value = pal.water ? this.waterY + 3 : g0 - 3;
    fu.uMistBottom.value = pal.water ? this.waterY - 0.5 : g0 - 26;
    (fu.uSunDir.value as THREE.Vector3).copy(this.bodyDir);
    (fu.uSunGlow.value as THREE.Color).copy(col(pal.sun)).lerp(col(pal.skyHorizon), 0.5).multiplyScalar(kind === 'sun' ? 0.45 : kind === 'moon' ? 0.12 : 0.3);

    Flat.rimColor = kind === 'sun' || kind === 'window' ? col(pal.sun).lerp(col(pal.skyHorizon), 0.3).multiplyScalar(1.15) : col(pal.sun).multiplyScalar(0.8);
    Flat.sunSide = this.bodyDir.x >= 0 ? 1 : -1;
    const lights = new Flat(0);
    const ctx: Ctx = {
      r: rng(lv.w * 31 + lv.h * 7 + pal.id.length * 101),
      pal,
      look,
      g0,
      w: lv.w,
      fog,
      far: col(pal.hemiSky).lerp(col(pal.skyHorizon), 0.45),
      lights,
      spinners: this.spinners,
      group: this.sim,
      bag,
      flatMat: this.flatMat,
    };
    const flats: Flat[] = [];
    switch (pal.id) {
      case 'lake':
        buildLake(ctx, flats, this.waterY);
        break;
      case 'autumn':
        buildAutumn(ctx, flats);
        break;
      case 'night':
        buildNight(ctx, flats);
        break;
      case 'clock':
        buildClock(ctx, flats);
        break;
      case 'finale':
        buildFinale(ctx, flats);
        break;
      default:
        buildDawn(ctx, flats);
    }
    for (const f of flats) {
      const g = f.build(bag);
      if (g) this.sim.add(new THREE.Mesh(g, this.flatMat));
    }
    // Mist banks drifting between the layers.
    if (pal.id !== 'clock' && pal.id !== 'finale') {
      const r = rng(41 + lv.w);
      const n = pal.id === 'lake' ? 34 : pal.id === 'night' ? 22 : 26;
      const geo = new THREE.InstancedBufferGeometry();
      const base = new THREE.PlaneGeometry(1, 1);
      geo.index = base.index;
      geo.setAttribute('position', base.attributes.position);
      geo.setAttribute('uv', base.attributes.uv);
      const data = new Float32Array(n * 4);
      const size = new Float32Array(n * 2);
      const floor = pal.water ? this.waterY : g0;
      for (let i = 0; i < n; i++) {
        const z = 26 + Math.pow(r(), 1.6) * 260;
        const [a, b] = span(ctx, z);
        data[i * 4] = rr(r, a, b);
        data[i * 4 + 1] = floor - 3 + z * 0.03 + rr(r, -1.5, 2.5);
        data[i * 4 + 2] = z;
        data[i * 4 + 3] = Math.floor(r() * 4);
        const w = (24 + z * 0.35) * rr(r, 0.8, 1.4);
        size[i * 2] = w;
        size[i * 2 + 1] = w * rr(r, 0.22, 0.32);
      }
      geo.setAttribute('aBank', new THREE.InstancedBufferAttribute(data, 4));
      geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
      geo.instanceCount = n;
      bag.add(geo);
      base.dispose();
      const bu = this.bankMat.uniforms;
      (bu.uColor.value as THREE.Color).copy(pal.water ? col(pal.fog).lerp(col(pal.water), 0.15) : mist).multiplyScalar(1.02);
      (bu.uLit.value as THREE.Color).copy(col(pal.sun).lerp(col(pal.skyHorizon), 0.5)).multiplyScalar(kind === 'moon' ? 0.35 : 1);
      bu.uOpacity.value = pal.id === 'lake' ? 0.62 : pal.id === 'night' ? 0.35 : 0.48;
      const m = new THREE.Mesh(geo, this.bankMat);
      m.frustumCulled = false;
      m.renderOrder = 2;
      this.sim.add(m);
    }

    // Lit windows and lamps sit just in front of their layers.
    const lg = lights.build(bag);
    if (lg) this.sim.add(new THREE.Mesh(lg, this.lightMat));

    // Water.
    this.water.visible = !!pal.water;
    if (pal.water) {
      const w = this.waterMat.uniforms;
      (w.uDeep.value as THREE.Color).copy(col(pal.water));
      (w.uSky.value as THREE.Color).copy(col(pal.skyMid));
      (w.uHorizon.value as THREE.Color).copy(col(pal.skyHorizon));
      (w.uSunDir.value as THREE.Vector3).copy(this.bodyDir);
      (w.uSunColor.value as THREE.Color).copy(col(pal.sun)).multiplyScalar(kind === 'moon' ? 0.35 : 0.8);
      (w.uFog.value as THREE.Color).copy(fog);
      w.uFogDist.value = 260 / pal.haze;
      this.water.position.y = this.waterY;
    }

    // Clouds.
    if (look.clouds > 0) {
      const n = Math.round(14 * look.clouds);
      const geo = new THREE.InstancedBufferGeometry();
      const base = new THREE.PlaneGeometry(1, 1);
      geo.index = base.index;
      geo.setAttribute('position', base.attributes.position);
      geo.setAttribute('uv', base.attributes.uv);
      const data = new Float32Array(n * 4);
      const size = new Float32Array(n * 2);
      const r = rng(17 + lv.w);
      for (let i = 0; i < n; i++) {
        const az = rr(r, -1.4, 1.4) + Math.PI;
        const el = rr(r, 0.03, 0.24);
        const d = 900;
        data[i * 4] = Math.sin(az) * Math.cos(el) * d;
        data[i * 4 + 1] = Math.sin(el) * d;
        data[i * 4 + 2] = Math.cos(az) * Math.cos(el) * d;
        data[i * 4 + 3] = Math.floor(r() * 4);
        const s = rr(r, 160, 300);
        size[i * 2] = s;
        size[i * 2 + 1] = s * 0.5;
      }
      geo.setAttribute('aCloud', new THREE.InstancedBufferAttribute(data, 4));
      geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
      geo.instanceCount = n;
      bag.add(geo);
      base.dispose();
      const cu = this.cloudMat.uniforms;
      const lit = col(pal.sun).lerp(col(pal.skyHorizon), 0.4).multiplyScalar(kind === 'moon' ? 0.35 : 1.05);
      const sh = col(pal.skyMid).lerp(col(pal.skyTop), 0.3).multiplyScalar(kind === 'moon' ? 0.5 : 0.85);
      (cu.uLit.value as THREE.Color).copy(lit);
      (cu.uShade.value as THREE.Color).copy(sh);
      cu.uOpacity.value = kind === 'moon' ? 0.55 : 0.92;
      const m = new THREE.Mesh(geo, this.cloudMat);
      m.frustumCulled = false;
      m.renderOrder = -8;
      this.follow.add(m);
    }

    // Stars.
    if (look.stars > 0) {
      const n = Math.round(900 * look.stars);
      const pos = new Float32Array(n * 3);
      const seed = new Float32Array(n);
      const r = rng(5);
      for (let i = 0; i < n; i++) {
        const az = r() * Math.PI * 2;
        const el = Math.asin(r() * 0.98);
        pos[i * 3] = Math.cos(az) * Math.cos(el) * 950;
        pos[i * 3 + 1] = Math.sin(el) * 950;
        pos[i * 3 + 2] = Math.sin(az) * Math.cos(el) * 950;
        seed[i] = r();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      bag.add(g);
      const pts = new THREE.Points(g, this.starMat);
      pts.frustumCulled = false;
      pts.renderOrder = -9;
      this.follow.add(pts);
    }

    // The visible body: moon, clock face or windows.
    if (kind === 'moon') {
      const mat = bag.add(new THREE.MeshBasicMaterial({ map: moonTexture(), transparent: true, depthWrite: false, color: new THREE.Color(1.6, 1.6, 1.7) }));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      bag.add(m.geometry);
      m.scale.setScalar(70 * look.skyBody.size);
      m.position.copy(this.bodyDir).multiplyScalar(900);
      m.lookAt(0, 0, 0);
      m.renderOrder = -7;
      this.follow.add(m);
      const hm = bag.add(
        new THREE.MeshBasicMaterial({ map: spriteAtlas(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: col(pal.sun).multiplyScalar(0.5) }),
      );
      const hg = bag.add(new THREE.PlaneGeometry(1, 1));
      const uvs = hg.attributes.uv as THREE.BufferAttribute;
      const cell = SPRITE.halo;
      for (let i = 0; i < uvs.count; i++) uvs.setXY(i, ((cell % 4) + uvs.getX(i)) / 4, 1 - (Math.floor(cell / 4) + 1 - uvs.getY(i)) / 4);
      const halo = new THREE.Mesh(hg, hm);
      halo.scale.setScalar(420);
      halo.position.copy(this.bodyDir).multiplyScalar(910);
      halo.lookAt(0, 0, 0);
      halo.renderOrder = -8;
      this.follow.add(halo);
    } else if (kind === 'clock') {
      const tex = bag.add(clockFaceTexture(pal));
      const mat = bag.add(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 2.0, 1.7) }));
      const geo = bag.add(new THREE.CircleGeometry(30, 64));
      const face = new THREE.Mesh(geo, mat);
      face.position.set(lv.w / 2, g0 + 6, 205);
      this.sim.add(face);
      const handMat = bag.add(new THREE.MeshBasicMaterial({ color: '#1c120c' }));
      for (const [len, wid] of [[16, 1.2], [24, 0.7]]) {
        const hg = bag.add(new THREE.PlaneGeometry(wid, len));
        hg.translate(0, len / 2 - 2, 0);
        const hand = new THREE.Mesh(hg, handMat);
        hand.position.set(lv.w / 2, g0 + 6, 204);
        this.sim.add(hand);
        this.hands.push(hand);
      }
    } else if (kind === 'window') {
      // Sunset seen through the windows: a lit plane behind the back wall.
      const geo = bag.add(new THREE.PlaneGeometry(lv.w + 600, 260));
      const cols = new Float32Array(geo.attributes.position.count * 3);
      const pos = geo.attributes.position;
      const hor = col(pal.skyHorizon).multiplyScalar(0.85);
      const mid = col(pal.skyMid).multiplyScalar(0.7);
      for (let i = 0; i < pos.count; i++) {
        const k = THREE.MathUtils.clamp((pos.getY(i) + 40) / 120, 0, 1);
        const c = hor.clone().lerp(mid, k);
        cols[i * 3] = c.r;
        cols[i * 3 + 1] = c.g;
        cols[i * 3 + 2] = c.b;
      }
      geo.setAttribute('aCol', new THREE.BufferAttribute(cols, 3));
      const m = new THREE.Mesh(geo, this.lightMat);
      m.position.set(lv.w / 2, g0 + 20, 215);
      this.sim.add(m);
    }

    // Light shafts.
    if (look.shafts > 0) {
      const r = rng(23);
      const n = Math.round(6 * look.shafts);
      for (let i = 0; i < n; i++) {
        const mat = bag.add(
          new THREE.ShaderMaterial({
            vertexShader: SHAFT_VERT,
            fragmentShader: SHAFT_FRAG,
            uniforms: {
              uColor: { value: col(pal.sun).lerp(col(pal.fog), 0.4).multiplyScalar(0.05 * look.shafts) },
              uTime: { value: 0 },
              uSeed: { value: r() },
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          }),
        );
        const geo = bag.add(new THREE.PlaneGeometry(1, 1));
        const m = new THREE.Mesh(geo, mat);
        const z = rr(r, 30, 120);
        const w = rr(r, 3, 8);
        const h = rr(r, 50, 90);
        m.scale.set(w, h, 1);
        m.position.set(rr(r, 0, lv.w), g0 + h * 0.25, z);
        m.rotation.z = rr(r, -0.45, -0.2) * (this.bodyDir.x > 0 ? -1 : 1);
        this.sim.add(m);
        this.shafts.push(m);
      }
    }
  }

  update(cam: THREE.PerspectiveCamera, time: number): void {
    this.follow.position.copy(cam.position);
    this.skyMat.uniforms.uSunDir.value.copy(this.bodyDir);
    this.cloudMat.uniforms.uTime.value = time;
    this.starMat.uniforms.uTime.value = time;
    this.waterMat.uniforms.uTime.value = time;
    this.bankMat.uniforms.uTime.value = time;
    if (this.water.visible) {
      this.water.position.x = cam.position.x;
      this.water.position.z = cam.position.z;
    }
    for (const s of this.spinners) s.mesh.rotation.z = time * s.speed;
    for (const s of this.shafts) (s.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    if (this.hands.length === 2) {
      this.hands[0].rotation.z = -time * 0.02;
      this.hands[1].rotation.z = -time * 0.24;
    }
  }

  dispose(): void {
    this.levelBag.dispose();
  }
}
