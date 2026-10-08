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

function bramble(seed: number, stem: THREE.Color, tip: THREE.Color): { geo: THREE.BufferGeometry; berries: THREE.Vector3[] } {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const berries: THREE.Vector3[] = [];
  const vines = 6 + Math.floor(r() * 3);
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
    const tube = taperTube(pts, 0.05, 0.014, 5);
    parts.push(tube);
    const curve = new THREE.CatmullRomCurve3(pts);
    // Thorns along the vine.
    for (let k = 0; k < 12; k++) {
      const t = rr(r, 0.05, 0.95);
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const side = new THREE.Vector3(rr(r, -1, 1), rr(r, -0.3, 0.6), rr(r, -1, 1)).normalize();
      side.addScaledVector(tan, -side.dot(tan)).normalize();
      const cone = new THREE.ConeGeometry(0.02, 0.11, 4);
      cone.translate(0, 0.055, 0);
      // Mark thorn tips so they take the red.
      cone.userData.tip = true;
      cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), side));
      cone.translate(p.x, p.y, p.z);
      parts.push(cone);
    }
    for (let k = 0; k < 2; k++) {
      const p = curve.getPointAt(rr(r, 0.3, 1));
      berries.push(p.add(new THREE.Vector3(rr(r, -0.05, 0.05), 0.03, rr(r, -0.05, 0.05))));
    }
  }
  const geos = parts.map((g) => {
    const out = g.index ? g.toNonIndexed() : g;
    out.userData.tip = g.userData.tip;
    return out;
  });
  for (const g of geos) {
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const pos = g.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const c = g.userData.tip ? tip : stem.clone().multiplyScalar(0.8 + pos.getY(i) * 0.4);
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  const geo = mergeNonIndexed(geos);
  for (const g of geos) g.dispose();
  for (const g of parts) g.dispose();
  return { geo, berries };
}

export class Thorns {
  readonly group = new THREE.Group();
  berryMat: THREE.MeshStandardMaterial | null = null;

  build(lv: Level, pal: Palette, cells: number[], bag: Bag): void {
    this.group.clear();
    this.berryMat = null;
    if (!cells.length) return;
    const look = pal.mats.thorn;
    const stem = col(look.color);
    const tip = shade(look.color2, 0.85);
    const variants = [0, 1, 2].map((i) => bramble(900 + i * 31, stem, tip));
    for (const v of variants) bag.add(v.geo);
    const mat = bag.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 }));
    patch(mat, { cutout: true, hfog: true, key: 'thorn' });
    const berryMat = bag.add(
      new THREE.MeshStandardMaterial({
        color: col(look.color2),
        emissive: col(look.emissive ?? '#c4283a'),
        emissiveIntensity: 2.2,
        roughness: 0.25,
      }),
    );
    this.berryMat = berryMat;
    const berryGeo = bag.add(new THREE.SphereGeometry(0.045, 8, 6));
    const lists: THREE.Matrix4[][] = [[], [], []];
    const berries: THREE.Matrix4[] = [];
    const r = rng(lv.w * 3 + cells.length);
    for (let i = 0; i < cells.length; i += 3) {
      const x = cells[i];
      const y = cells[i + 1];
      const z = cells[i + 2];
      const vi = Math.floor(hash3(x, y, z + 11) * 3) % 3;
      const rot = Math.floor(r() * 4) * (Math.PI / 2) + rr(r, -0.3, 0.3);
      const s = rr(r, 0.95, 1.15);
      const m = new THREE.Matrix4()
        .makeTranslation(x + 0.5, y, z + 0.5)
        .multiply(new THREE.Matrix4().makeRotationY(rot))
        .multiply(new THREE.Matrix4().makeScale(s, rr(r, 0.9, 1.1), s))
        .multiply(new THREE.Matrix4().makeTranslation(-0.5, 0, -0.5));
      lists[vi].push(m);
      for (const b of variants[vi].berries) {
        const bp = b.clone().applyMatrix4(m);
        berries.push(new THREE.Matrix4().makeTranslation(bp.x, bp.y, bp.z).multiply(new THREE.Matrix4().makeScale(...([1, 1, 1].map(() => rr(r, 0.8, 1.2)) as [number, number, number]))));
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
      const im = new THREE.InstancedMesh(berryGeo, berryMat, berries.length);
      berries.forEach((mm, k) => im.setMatrixAt(k, mm));
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  update(time: number): void {
    if (this.berryMat) this.berryMat.emissiveIntensity = 1.8 + Math.sin(time * 2.2) * 0.6;
  }
}
