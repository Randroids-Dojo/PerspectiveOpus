import * as THREE from 'three';
import { hash3 } from '../core/math';
import type { Level } from '../game/level';
import type { Palette } from '../game/palettes';
import { patch } from './shared';
import { Bag, col, mixc, rng, rr, shade, taperTube, type Rng } from './util';

/**
 * Small living things on the blocks: instanced tufts on capped tops (grass,
 * moss, fallen leaves, snow lumps, flowers) that sway and bend away from
 * Quaver, and the thorn brambles with their glowing berries.
 */

const BEND_VERT = /* glsl */ `
#ifdef USE_INSTANCING
{
  vec3 root = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float hgt = clamp(position.y / 0.3, 0.0, 1.0);
  float k = hgt * hgt;
  float ph = uTime * 1.9 + root.x * 0.7 + root.z * 0.45;
  float gust = 0.6 + 0.4 * sin(uTime * 0.41 + root.x * 0.07);
  vec3 off = vec3(sin(ph) * 0.05, 0.0, cos(ph * 0.8) * 0.03) * gust * uWind;
  vec3 away = root - uPlayer;
  float d = length(away.xz);
  float push = (1.0 - smoothstep(0.15, 0.7, d)) * step(abs(away.y), 0.5);
  off.xz += normalize(away.xz + vec2(1e-4)) * push * 0.16;
  off.y -= push * 0.06;
  // Undo the instance rotation so the bend is in world axes.
  mat3 r = mat3(instanceMatrix);
  vec3 lo = transpose(r) * off / max(0.001, dot(r[0], r[0]));
  transformed += lo * k;
}
#endif
`;

function tuftMaterial(bag: Bag, opts: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const m = bag.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, ...opts }));
  patch(m, {
    cutout: true,
    hfog: true,
    key: 'tuft',
    extra: (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uPlayer;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BEND_VERT}`);
      // Shade blades like the ground they grow from, on both sides.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
      );
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(1.0, 0.0, 0.0);\n#endif');
    },
  });
  return m;
}

/** Builds a geometry with vertex colours from a list of [geometry, colour(y)] parts. */
function vc(parts: { g: THREE.BufferGeometry; c: (y: number) => THREE.Color }[]): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const g = p.g.index ? p.g.toNonIndexed() : p.g;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const c = p.c(pos.getY(i));
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geos.push(g);
  }
  const out = mergeNonIndexed(geos);
  for (const g of geos) g.dispose();
  return out;
}

function mergeNonIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const colr = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    colr.set(g.attributes.color.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  out.computeBoundingSphere();
  return out;
}

/** A clump of curved blades. */
function bladeClump(r: Rng, blades: number, h: number, base: THREE.Color, tip: THREE.Color): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let b = 0; b < blades; b++) {
    const a = r() * Math.PI * 2;
    const lean = rr(r, 0.1, 0.5);
    const bh = h * rr(r, 0.6, 1.1);
    const w = rr(r, 0.012, 0.022);
    const ox = Math.cos(a) * rr(r, 0, 0.06);
    const oz = Math.sin(a) * rr(r, 0, 0.06);
    const segs = 2;
    const pts: [number, number, number][] = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const bend = lean * t * t * bh;
      pts.push([ox + Math.cos(a) * bend, t * bh, oz + Math.sin(a) * bend]);
    }
    const px = -Math.sin(a);
    const pz = Math.cos(a);
    for (let s = 0; s < segs; s++) {
      const [x0, y0, z0] = pts[s];
      const [x1, y1, z1] = pts[s + 1];
      const w0 = w * (1 - s / segs);
      const w1 = w * (1 - (s + 1) / segs);
      pos.push(x0 - px * w0, y0, z0 - pz * w0, x0 + px * w0, y0, z0 + pz * w0, x1 + px * w1, y1, z1 + pz * w1);
      pos.push(x0 - px * w0, y0, z0 - pz * w0, x1 + px * w1, y1, z1 + pz * w1, x1 - px * w1, y1, z1 - pz * w1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return vc([{ g, c: (y) => base.clone().lerp(tip, Math.min(1, y / h)) }]);
}

/** A small flower: stem plus a ring of petals and a centre. */
function flower(r: Rng, petal: THREE.Color, stem: THREE.Color): THREE.BufferGeometry {
  const parts: { g: THREE.BufferGeometry; c: (y: number) => THREE.Color }[] = [];
  const h = rr(r, 0.16, 0.28);
  const s = new THREE.CylinderGeometry(0.008, 0.012, h, 4, 1);
  s.translate(0, h / 2, 0);
  parts.push({ g: s, c: () => stem });
  const n = 5;
  for (let i = 0; i < n; i++) {
    const p = new THREE.SphereGeometry(0.032, 4, 2);
    p.scale(1.5, 0.35, 0.8);
    p.translate(0.04, 0, 0);
    p.rotateY((i / n) * Math.PI * 2);
    p.translate(0, h, 0);
    parts.push({ g: p, c: () => petal });
  }
  const c = new THREE.SphereGeometry(0.022, 6, 4);
  c.translate(0, h + 0.01, 0);
  parts.push({ g: c, c: () => col('#f2c84b') });
  return vc(parts);
}

/** Two or three small flowers of different colours. */
function flowerPatch(r: Rng, petals: THREE.Color[], stem: THREE.Color): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const f = flower(r, petals[Math.floor(r() * petals.length)], stem);
    f.translate(rr(r, -0.12, 0.12), 0, rr(r, -0.12, 0.12));
    parts.push(f);
  }
  const out = mergeNonIndexed(parts);
  for (const g of parts) g.dispose();
  return out;
}

/** A few flat leaves lying in a little pile. */
function leafPile(r: Rng, a: THREE.Color, b: THREE.Color): THREE.BufferGeometry {
  const parts: { g: THREE.BufferGeometry; c: (y: number) => THREE.Color }[] = [];
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const g = new THREE.CircleGeometry(0.07, 6);
    g.scale(1, 0.55, 1);
    g.rotateX(-Math.PI / 2 + rr(r, -0.4, 0.4));
    g.rotateY(r() * Math.PI * 2);
    g.translate(rr(r, -0.12, 0.12), 0.015 + i * 0.008, rr(r, -0.12, 0.12));
    const c = a.clone().lerp(b, r());
    parts.push({ g, c: () => c });
  }
  return vc(parts);
}

function snowLump(r: Rng): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.12, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(rr(r, 1, 1.8), rr(r, 0.4, 0.7), rr(r, 1, 1.6));
  return vc([{ g, c: () => col('#f2f6fb') }]);
}

function mossClump(r: Rng, c: THREE.Color): THREE.BufferGeometry {
  const parts: { g: THREE.BufferGeometry; c: (y: number) => THREE.Color }[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.SphereGeometry(rr(r, 0.05, 0.09), 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, rr(r, 0.5, 0.9), 1);
    g.translate(rr(r, -0.08, 0.08), 0, rr(r, -0.08, 0.08));
    const cc = shade(c, rr(r, 0.8, 1.15));
    parts.push({ g, c: () => cc });
  }
  // A few fern fronds.
  const blades = bladeClump(r, 4, 0.16, shade(c, 0.7), shade(c, 1.2));
  const g = vc(parts);
  const merged = mergeNonIndexed([g, blades]);
  g.dispose();
  blades.dispose();
  return merged;
}

export interface FloraOpts {
  quality: 'low' | 'medium' | 'high';
}

export class Flora {
  readonly group = new THREE.Group();
  private tufts: THREE.InstancedMesh[] = [];
  private full: number[] = [];

  build(lv: Level, pal: Palette, capTops: number[], blocked: Set<number>, bag: Bag): void {
    this.group.clear();
    this.tufts = [];
    this.full = [];
    if (pal.top === 'none' || pal.top === 'carpet' || capTops.length === 0) return;
    const r = rng(lv.w * 13 + lv.h);
    const top = col(pal.topColor);
    const protos: { geo: THREE.BufferGeometry; weight: number; scale: [number, number] }[] = [];
    if (pal.top === 'grass') {
      for (let i = 0; i < 2; i++)
        protos.push({ geo: bladeClump(r, 11, 0.2, shade(top, 0.7), shade(top, 1.6, 0.95, -0.03)), weight: 6, scale: [0.8, 1.25] });
      const petals = pal.id === 'title' ? ['#f3d2e6', '#ffffff', '#c9b6ff'] : ['#ffffff', '#f6d36b', '#e98fa8', '#c3a7f0'];
      protos.push({ geo: flowerPatch(r, petals.map((c) => col(c)), shade(top, 0.7)), weight: 0.7, scale: [0.8, 1.2] });
    } else if (pal.top === 'moss') {
      for (let i = 0; i < 2; i++) protos.push({ geo: mossClump(r, top), weight: 4, scale: [0.8, 1.4] });
      const petal = pal.id === 'night' ? ['#9fd0ff', '#c6b6ff'] : ['#e7e2ff', '#f6e7a0'];
      protos.push({ geo: flowerPatch(r, petal.map((c) => col(c)), shade(top, 0.7)), weight: 0.6, scale: [0.7, 1] });
    } else if (pal.top === 'leaves') {
      const a = col(pal.topColor);
      const b = col(pal.mats.leaf.color2);
      for (let i = 0; i < 2; i++) protos.push({ geo: leafPile(r, a, mixc(b, '#e2b23a', i * 0.4)), weight: 3, scale: [0.9, 1.4] });
      protos.push({ geo: bladeClump(r, 6, 0.18, shade(pal.mats.leaf.color2, 0.6), shade('#b9a05a', 1)), weight: 1, scale: [0.8, 1.1] });
    } else if (pal.top === 'snow') {
      for (let i = 0; i < 2; i++) protos.push({ geo: snowLump(r), weight: 2, scale: [0.8, 1.4] });
    }
    for (const p of protos) bag.add(p.geo);
    const mat = tuftMaterial(bag, {});
    const total = protos.reduce((s, p) => s + p.weight, 0);
    // Placements per prototype and per chunk along x, so off-screen chunks are culled.
    const CH = 24;
    const chunks = Math.ceil(lv.w / CH);
    const P = protos.length;
    const lists: THREE.Matrix4[][] = Array.from({ length: P * chunks }, () => []);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < capTops.length; i += 3) {
      const x = capTops[i];
      const y = capTops[i + 1];
      const z = capTops[i + 2];
      if (blocked.has(x + lv.w * (y + lv.h * z))) continue;
      const per = 3 + Math.floor(hash3(x, y, z) * 3);
      for (let k = 0; k < per; k++) {
        let pick = r() * total;
        let pi = 0;
        while (pi < protos.length - 1 && pick > protos[pi].weight) {
          pick -= protos[pi].weight;
          pi++;
        }
        const pr = protos[pi];
        // Keep a margin at the front edge so tufts never poke past the page silhouette much.
        p.set(x + rr(r, 0.08, 0.92), y, z + rr(r, 0.06, 0.94));
        e.set(0, r() * Math.PI * 2, 0);
        q.setFromEuler(e);
        const s = rr(r, pr.scale[0], pr.scale[1]);
        sc.set(s, s * rr(r, 0.85, 1.15), s);
        m.compose(p, q, sc);
        lists[Math.floor(x / CH) * P + pi].push(m.clone());
      }
    }
    lists.forEach((list, li) => {
      const pr = protos[li % P];
      if (!list.length) return;
      // Shuffle so lowering the count keeps an even spread.
      for (let k = list.length - 1; k > 0; k--) {
        const j = Math.floor(r() * (k + 1));
        [list[k], list[j]] = [list[j], list[k]];
      }
      const im = new THREE.InstancedMesh(pr.geo, mat, list.length);
      list.forEach((mm, k) => im.setMatrixAt(k, mm));
      const tint = new THREE.Color();
      for (let k = 0; k < list.length; k++) {
        tint.setScalar(rr(r, 0.82, 1.12));
        im.setColorAt(k, tint);
      }
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.receiveShadow = true;
      im.castShadow = false;
      this.group.add(im);
      this.tufts.push(im);
      this.full.push(list.length);
    });
  }

  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.group.visible = q !== 'low';
    this.tufts.forEach((t, i) => (t.count = q === 'high' ? this.full[i] : Math.ceil(this.full[i] * 0.45)));
  }
}

// ---------------------------------------------------------------- thorns

/**
 * One part of a hazard: geometry in cell space, its colour, how hot it glows
 * (by local position, before any transform) and, for cogs, how it spins.
 */
interface HotPart {
  g: THREE.BufferGeometry;
  c: THREE.Color | ((p: THREE.Vector3) => THREE.Color);
  hot?: (p: THREE.Vector3) => number;
  /** Centre x, centre y, speed (rad/s), phase: spins in the xy plane. */
  spin?: [number, number, number, number];
  m?: THREE.Matrix4;
}

/** Merges hazard parts into one geometry with colour, `aHot` and `aSpin`. */
function hotGeometry(parts: HotPart[]): THREE.BufferGeometry {
  let n = 0;
  const geos = parts.map((p) => {
    const g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    n += g.attributes.position.count;
    return g;
  });
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const colr = new Float32Array(n * 3);
  const hot = new Float32Array(n);
  const spin = new Float32Array(n * 4);
  const v = new THREE.Vector3();
  let o = 0;
  geos.forEach((g, gi) => {
    const p = parts[gi];
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i);
      const c = typeof p.c === 'function' ? p.c(v) : p.c;
      colr.set([c.r, c.g, c.b], (o + i) * 3);
      hot[o + i] = p.hot ? p.hot(v) : 0;
      if (p.spin) spin.set(p.spin, (o + i) * 4);
    }
    if (p.m) g.applyMatrix4(p.m);
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += pa.count;
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  out.setAttribute('aHot', new THREE.BufferAttribute(hot, 1));
  out.setAttribute('aSpin', new THREE.BufferAttribute(spin, 4));
  out.computeBoundingSphere();
  return out;
}

const HOT_VERT_PARS = /* glsl */ `
attribute float aHot;
attribute vec4 aSpin;
varying float vHot;
`;

// Cogs turn in the xy plane about their own centres; neighbours along x turn the other way.
const SPIN_NORMAL = /* glsl */ `
float spinDir = 1.0;
#ifdef USE_INSTANCING
  spinDir = mod(floor(instanceMatrix[3][0] + 0.01), 2.0) < 0.5 ? 1.0 : -1.0;
#endif
float spinA = uTime * aSpin.z * spinDir + aSpin.w + (spinDir < 0.0 ? 0.31 : 0.0);
float spinC = cos(spinA);
float spinS = sin(spinA);
mat2 spinM = mat2(spinC, spinS, -spinS, spinC);
objectNormal.xy = spinM * objectNormal.xy;
vHot = aHot;
`;

const SPIN_POS = /* glsl */ `
transformed.xy = aSpin.xy + spinM * (transformed.xy - aSpin.xy);
`;

function hotMaterial(bag: Bag, key: string, o: THREE.MeshStandardMaterialParameters): { m: THREE.MeshStandardMaterial; u: { value: THREE.Color } } {
  const m = bag.add(new THREE.MeshStandardMaterial({ vertexColors: true, ...o }));
  const u = { value: new THREE.Color() };
  patch(m, {
    cutout: true,
    hfog: true,
    key,
    extra: (shader) => {
      shader.uniforms.uHot = u;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${HOT_VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${SPIN_NORMAL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SPIN_POS}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHot;\nvarying float vHot;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - vHot * vHot;')
        // Heat is interpolated from tip to root; sharpen it so only the points burn.
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uHot * pow(vHot, 3.0);');
    },
  });
  return { m, u };
}

function bramble(seed: number, stem: THREE.Color, tip: THREE.Color): { geo: THREE.BufferGeometry; berries: THREE.Vector3[] } {
  const r = rng(seed);
  const parts: HotPart[] = [];
  const berries: THREE.Vector3[] = [];
  const vines = 6 + Math.floor(r() * 3);
  const stemCol = (p: THREE.Vector3) => stem.clone().multiplyScalar(0.7 + p.y * 0.45);
  const up = new THREE.Vector3(0, 1, 0);
  for (let v = 0; v < vines; v++) {
    const pts: THREE.Vector3[] = [];
    const a0 = r() * Math.PI * 2;
    const turns = rr(r, 0.6, 1.4) * (r() < 0.5 ? -1 : 1);
    const rad = rr(r, 0.18, 0.4);
    const h = rr(r, 0.65, 1.05);
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = a0 + turns * t * Math.PI * 2;
      const rr0 = rad * (1 - t * 0.5) + rr(r, -0.05, 0.05);
      pts.push(new THREE.Vector3(0.5 + Math.cos(a) * rr0, t * h, 0.5 + Math.sin(a) * rr0));
    }
    parts.push({ g: taperTube(pts, 0.05, 0.014, 5), c: stemCol });
    const curve = new THREE.CatmullRomCurve3(pts);
    // Long thorns along the vine with red-hot points: they should look like they hurt.
    for (let k = 0; k < 11; k++) {
      const t = rr(r, 0.05, 0.98);
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const side = new THREE.Vector3(rr(r, -1, 1), rr(r, -0.2, 0.8), rr(r, -1, 1)).normalize();
      side.addScaledVector(tan, -side.dot(tan)).normalize();
      const len = rr(r, 0.12, 0.19);
      const cone = new THREE.ConeGeometry(0.028, len, 4);
      cone.translate(0, len / 2, 0);
      const m = new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(up, side), new THREE.Vector3(1, 1, 1));
      parts.push({
        g: cone,
        c: (q) => (q.y > len * 0.62 ? tip : stem),
        hot: (q) => Math.max(0, (q.y / len - 0.68) / 0.32),
        m,
      });
    }
    const p = curve.getPointAt(rr(r, 0.4, 1));
    berries.push(p.add(new THREE.Vector3(rr(r, -0.05, 0.05), 0.03, rr(r, -0.05, 0.05))));
  }
  const geo = hotGeometry(parts);
  for (const p of parts) p.g.dispose();
  return { geo, berries };
}

/** An escape wheel outline: hooked, saw-like teeth and round lightening holes, in the xy plane. */
function cogShape(teeth: number, r0: number, r1: number, hub: number): THREE.Shape {
  const s = new THREE.Shape();
  const w = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * w;
    // Steep leading face up to a narrow flat tip, then a long slope back to the root.
    const pts: [number, number][] = [
      [a, r0],
      [a + w * 0.12, r1],
      [a + w * 0.2, r1 * 0.985],
      [a + w * 0.7, r0 * 1.04],
    ];
    for (const [ang, rad] of pts) {
      if (i === 0 && ang === a) s.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
      else s.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
    }
  }
  s.closePath();
  const holes = 5;
  const hr = (r0 - hub) * 0.4;
  const hc = (r0 + hub) / 2;
  for (let i = 0; i < holes; i++) {
    const a = (i / holes) * Math.PI * 2 + 0.3;
    const h = new THREE.Path();
    h.absarc(Math.cos(a) * hc, Math.sin(a) * hc, hr, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  return s;
}

/**
 * Clockwork hazards for the clock movement: spiked brass cogs turning half
 * sunk into the floor, with glowing hot teeth and a hot hub, and a couple of
 * fixed gear-tooth spikes between them.
 */
function cogCluster(seed: number, brass: THREE.Color, iron: THREE.Color, variant: number): THREE.BufferGeometry {
  const r = rng(seed);
  const body = shade(brass, 0.42, 0.8);
  const parts: HotPart[] = [];
  const cog = (cx: number, cy: number, cz: number, teeth: number, r1: number, speed: number) => {
    const r0 = r1 * 0.7;
    const hub = r1 * 0.26;
    const t = 0.09;
    const g = new THREE.ExtrudeGeometry(cogShape(teeth, r0, r1, hub), {
      depth: t,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.01,
      bevelSegments: 1,
      curveSegments: 2,
    });
    g.translate(cx, cy, cz - t / 2);
    parts.push({
      g,
      c: (p) => (Math.hypot(p.x - cx, p.y - cy) > r0 * 1.02 ? brass : body),
      hot: (p) => {
        const d = Math.hypot(p.x - cx, p.y - cy);
        return Math.max(0, Math.min(1, ((d - r0) / (r1 - r0) - 0.55) / 0.45));
      },
      spin: [cx, cy, speed, r() * 6.28],
    });
    // The hub: an iron boss with a hot core, turning with the cog.
    const boss = new THREE.CylinderGeometry(hub, hub, t + 0.07, 10);
    boss.rotateX(Math.PI / 2);
    boss.translate(cx, cy, cz);
    parts.push({ g: boss, c: shade(brass, 1.25), spin: [cx, cy, speed, 0] });
    const core = new THREE.CylinderGeometry(hub * 0.32, hub * 0.32, t + 0.1, 8);
    core.rotateX(Math.PI / 2);
    core.translate(cx, cy, cz);
    parts.push({ g: core, c: col('#ff9a3a'), hot: () => 1, spin: [cx, cy, speed, 0] });
  };
  const spike = (x: number, z: number, h: number) => {
    // A square gear-tooth spike on a little iron foot.
    const g = new THREE.ConeGeometry(0.075, h, 4);
    g.rotateY(Math.PI / 4);
    g.translate(x, h / 2 + 0.04, z);
    parts.push({ g, c: (p) => (p.y > h * 0.7 ? col('#ffb15a') : brass), hot: (p) => Math.max(0, ((p.y - 0.04) / h - 0.7) / 0.3) });
    const foot = new THREE.BoxGeometry(0.2, 0.05, 0.2);
    foot.translate(x, 0.025, z);
    parts.push({ g: foot, c: iron });
  };
  const speed = rr(r, 0.9, 1.4);
  if (variant === 0) {
    cog(0.5, 0.32, 0.5, 14, 0.46, speed);
    spike(0.18, 0.12, 0.34);
    spike(0.82, 0.88, 0.3);
  } else if (variant === 1) {
    cog(0.5, 0.3, 0.32, 14, 0.44, speed);
    cog(0.5, 0.26, 0.76, 10, 0.3, -speed * 1.45);
  } else {
    cog(0.5, 0.36, 0.62, 16, 0.48, speed * 0.8);
    spike(0.2, 0.16, 0.38);
    spike(0.5, 0.14, 0.3);
    spike(0.8, 0.16, 0.38);
  }
  const geo = hotGeometry(parts);
  for (const p of parts) p.g.dispose();
  return geo;
}

export class Thorns {
  readonly group = new THREE.Group();
  private berryMat: THREE.MeshStandardMaterial | null = null;
  private hot: { value: THREE.Color } | null = null;
  private hotBase = new THREE.Color();
  private clockwork = false;

  build(lv: Level, pal: Palette, cells: number[], bag: Bag): void {
    this.group.clear();
    this.berryMat = null;
    this.hot = null;
    if (!cells.length) return;
    const look = pal.mats.thorn;
    this.clockwork = pal.id === 'clock';
    const r = rng(lv.w * 3 + cells.length);
    let variants: { geo: THREE.BufferGeometry; berries: THREE.Vector3[] }[];
    let mat: THREE.MeshStandardMaterial;
    if (this.clockwork) {
      const brass = shade(pal.mats.brass.color, 0.62, 1.05);
      const iron = col('#2a221d');
      variants = [0, 1, 2].map((i) => ({ geo: cogCluster(700 + i * 17, brass, iron, i), berries: [] }));
      const hm = hotMaterial(bag, 'cog', { roughness: 0.42, metalness: 0.85 });
      mat = hm.m;
      this.hot = hm.u;
      this.hotBase.copy(col('#ff5a10')).multiplyScalar(1.5);
    } else {
      const stem = col(look.color);
      const tip = shade(look.color2, 1.1);
      variants = [0, 1, 2].map((i) => bramble(900 + i * 31, stem, tip));
      const hm = hotMaterial(bag, 'thorn', { roughness: 0.55, metalness: 0.1 });
      mat = hm.m;
      this.hot = hm.u;
      this.hotBase.copy(col(look.emissive ?? '#c4283a')).multiplyScalar(1.6);
    }
    for (const v of variants) bag.add(v.geo);
    const lists: THREE.Matrix4[][] = [[], [], []];
    const berries: THREE.Matrix4[] = [];
    for (let i = 0; i < cells.length; i += 3) {
      const x = cells[i];
      const y = cells[i + 1];
      const z = cells[i + 2];
      const vi = Math.floor(hash3(x, y, z + 11) * 3) % 3;
      let m: THREE.Matrix4;
      if (this.clockwork) {
        // Cogs keep facing the audience so the gear trains read; only their size varies.
        const s = rr(r, 0.94, 1.04);
        m = new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeScale(1, s, 1));
      } else {
        const rot = Math.floor(r() * 4) * (Math.PI / 2) + rr(r, -0.3, 0.3);
        const s = rr(r, 0.95, 1.15);
        m = new THREE.Matrix4()
          .makeTranslation(x + 0.5, y, z + 0.5)
          .multiply(new THREE.Matrix4().makeRotationY(rot))
          .multiply(new THREE.Matrix4().makeScale(s, rr(r, 0.9, 1.1), s))
          .multiply(new THREE.Matrix4().makeTranslation(-0.5, 0, -0.5));
      }
      lists[vi].push(m);
      for (const b of variants[vi].berries) {
        const bp = b.clone().applyMatrix4(m);
        const bs = rr(r, 0.8, 1.2);
        berries.push(new THREE.Matrix4().makeTranslation(bp.x, bp.y, bp.z).multiply(new THREE.Matrix4().makeScale(bs, bs, bs)));
      }
    }
    lists.forEach((list, i) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(variants[i].geo, mat, list.length);
      list.forEach((mm, k) => im.setMatrixAt(k, mm));
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    });
    if (berries.length) {
      const berryMat = bag.add(
        new THREE.MeshStandardMaterial({
          color: col(look.color2),
          emissive: col(look.emissive ?? '#c4283a'),
          emissiveIntensity: 2.2,
          roughness: 0.25,
        }),
      );
      this.berryMat = berryMat;
      const im = new THREE.InstancedMesh(bag.add(new THREE.SphereGeometry(0.04, 8, 6)), berryMat, berries.length);
      berries.forEach((mm, k) => im.setMatrixAt(k, mm));
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  update(time: number): void {
    if (this.berryMat) this.berryMat.emissiveIntensity = 1.8 + Math.sin(time * 2.2) * 0.6;
    if (this.hot) {
      // Brambles throb slowly; clockwork flickers like a forge.
      const k = this.clockwork ? 0.85 + 0.1 * Math.sin(time * 7.3) + 0.06 * Math.sin(time * 17.1) : 0.8 + 0.25 * Math.sin(time * 2.2);
      this.hot.value.copy(this.hotBase).multiplyScalar(k);
    }
  }
}
