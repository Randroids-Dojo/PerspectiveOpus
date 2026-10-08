import * as THREE from 'three';
import { hash3 } from '../core/math';
import type { Level } from '../game/level';
import type { MatLook, Palette, TopCap } from '../game/palettes';
import { MAT } from '../game/types';
import { patch } from './shared';
import { CAP_BASE, CAP_ORDER, MAT_ORDER, VARIANTS, surfaceTextures, type CapKey } from './textures';
import { col, mixc, shade, type Bag } from './util';

/**
 * The voxel world: exposed faces only, chunked along x, with per-vertex
 * ambient occlusion and per-face edge flags. The material bevels convex edges
 * in the shader (bent normals plus worn, lighter edges), so blocks read as
 * dressed stone and planks rather than flat cubes.
 */

export const CHUNK = 16;

/** MAT id to index in MAT_ORDER, or -1 for non-block materials. */
export const MAT_INDEX: Record<number, number> = {
  [MAT.stone]: 0,
  [MAT.brick]: 1,
  [MAT.wood]: 2,
  [MAT.brass]: 3,
  [MAT.dark]: 4,
  [MAT.crystal]: 5,
  [MAT.leaf]: 6,
  [MAT.marble]: 7,
};

interface Face {
  n: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  o: [number, number, number];
  flip: boolean;
}

const FACES: Face[] = [
  { n: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], o: [1, 0, 0], flip: true },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], o: [0, 0, 0], flip: false },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], o: [0, 1, 0], flip: true },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], o: [0, 0, 0], flip: false },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], o: [0, 0, 1], flip: false },
  { n: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], o: [0, 0, 0], flip: true },
];

const AO_CURVE = [0.32, 0.58, 0.8, 1];

/** Which materials take the palette's top cap. */
function capable(mi: number, cap: TopCap): boolean {
  if (cap === 'none') return false;
  const name = MAT_ORDER[mi];
  if (name === 'brass' || name === 'crystal') return false;
  if (name === 'leaf') return cap === 'snow' || cap === 'leaves';
  if (name === 'wood') return cap !== 'grass';
  if (name === 'brick') return cap !== 'carpet';
  return true;
}

export interface WorldBuild {
  meshes: THREE.Mesh[];
  /** Top faces that carry a cap and have open air above (for tufts). */
  capTops: number[];
  /** Thorn cells as flat x, y, z triples. */
  thorns: number[];
  /** Highest solid top per column (x, z), for blob shadows and placement. */
  heights: Int16Array;
}

export function buildWorld(lv: Level, palette: Palette, material: THREE.Material, bag: Bag): WorldBuild {
  const { w, h, d, cells } = lv;
  const solid = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) return false;
    const m = cells[x + w * (y + h * z)];
    return m !== MAT.empty && m !== MAT.thorn;
  };
  const cap = palette.top;
  const meshes: THREE.Mesh[] = [];
  const capTops: number[] = [];
  const thorns: number[] = [];
  const heights = new Int16Array(w * d).fill(-1);

  for (let cx = 0; cx < w; cx += CHUNK) {
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const info: number[] = [];
    const idx: number[] = [];
    const xe = Math.min(w, cx + CHUNK);
    for (let z = 0; z < d; z++)
      for (let y = 0; y < h; y++)
        for (let x = cx; x < xe; x++) {
          const m = cells[x + w * (y + h * z)];
          if (m === MAT.empty) continue;
          if (m === MAT.thorn) {
            thorns.push(x, y, z);
            continue;
          }
          if (y + 1 > heights[x + w * z]) heights[x + w * z] = y + 1;
          const mi = MAT_INDEX[m] ?? 0;
          const variant = Math.floor(hash3(x, y, z) * VARIANTS) % VARIANTS;
          const layer = mi * VARIANTS + variant;
          const topOpen = !solid(x, y + 1, z);
          const capped = topOpen && capable(mi, cap) ? 1 : 0;
          if (capped && !(lv.cells[x + w * (y + 1 + h * z)] === MAT.thorn) && y + 1 < h) capTops.push(x, y + 1, z);
          for (let f = 0; f < 6; f++) {
            const F = FACES[f];
            const nx = x + F.n[0];
            const ny = y + F.n[1];
            const nz = z + F.n[2];
            if (solid(nx, ny, nz)) continue;
            if (F.n[1] === -1 && y === 0) continue;
            const base = pos.length / 3;
            const ao: number[] = [];
            for (let k = 0; k < 4; k++) {
              const cu = k === 1 || k === 2 ? 1 : 0;
              const cv = k >= 2 ? 1 : 0;
              pos.push(
                x + F.o[0] + cu * F.u[0] + cv * F.v[0],
                y + F.o[1] + cu * F.u[1] + cv * F.v[1],
                z + F.o[2] + cu * F.u[2] + cv * F.v[2],
              );
              nor.push(F.n[0], F.n[1], F.n[2]);
              uv.push(cu, cv);
              const su = cu ? 1 : -1;
              const sv = cv ? 1 : -1;
              const s1 = solid(nx + su * F.u[0], ny + su * F.u[1], nz + su * F.u[2]) ? 1 : 0;
              const s2 = solid(nx + sv * F.v[0], ny + sv * F.v[1], nz + sv * F.v[2]) ? 1 : 0;
              const cr = solid(nx + su * F.u[0] + sv * F.v[0], ny + su * F.u[1] + sv * F.v[1], nz + su * F.u[2] + sv * F.v[2]) ? 1 : 0;
              const a = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
              ao.push(a);
            }
            let bits = 0;
            if (!solid(x - F.u[0], y - F.u[1], z - F.u[2])) bits |= 1;
            if (!solid(x + F.u[0], y + F.u[1], z + F.u[2])) bits |= 2;
            if (!solid(x - F.v[0], y - F.v[1], z - F.v[2])) bits |= 4;
            if (!solid(x + F.v[0], y + F.v[1], z + F.v[2])) bits |= 8;
            const capFlag = F.n[1] === -1 ? 0 : capped;
            for (let k = 0; k < 4; k++) info.push(layer, AO_CURVE[ao[k]], bits, capFlag);
            const alt = ao[0] + ao[2] < ao[1] + ao[3];
            const [a0, a1, a2, a3] = alt ? [1, 2, 3, 0] : [0, 1, 2, 3];
            if (F.flip) idx.push(base + a0, base + a2, base + a1, base + a0, base + a3, base + a2);
            else idx.push(base + a0, base + a1, base + a2, base + a0, base + a2, base + a3);
          }
        }
    if (!idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    bag.add(g);
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    meshes.push(mesh);
  }
  return { meshes, capTops, thorns, heights };
}

// ---------------------------------------------------------------- material

const VERT_PARS = /* glsl */ `
attribute vec4 aInfo;
varying vec2 vLuv;
varying vec4 vInfo;
varying vec3 vSimPos;
varying vec3 vObjN;
varying vec3 vTu;
varying vec3 vTv;
`;

const VERT_MAIN = /* glsl */ `
vLuv = uv;
vInfo = aInfo;
vSimPos = position;
vObjN = normal;
{
  vec3 tuo = abs(normal.y) > 0.5 ? vec3(1.0, 0.0, 0.0) : (abs(normal.x) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0));
  vec3 tvo = abs(normal.y) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vTu = normalMatrix * tuo;
  vTv = normalMatrix * tvo;
}
`;

const FRAG_PARS = /* glsl */ `
uniform highp sampler2DArray uDetail;
uniform highp sampler2DArray uNormalArr;
uniform vec3 uCol1[8];
uniform vec3 uCol2[8];
uniform vec3 uGrout[8];
uniform vec4 uProps[8];
uniform vec3 uEmis[8];
uniform vec3 uCap1;
uniform vec3 uCap2;
uniform vec3 uCapGrout;
uniform float uCapLayer;
uniform float uCapOn;
uniform vec4 uCapStyle;
uniform float uGlowPulse;
uniform float uMacro[8];
uniform float uMacroLayer;
varying vec2 vLuv;
varying vec4 vInfo;
varying vec3 vSimPos;
varying vec3 vObjN;
varying vec3 vTu;
varying vec3 vTv;
`;

const FRAG_MAP = /* glsl */ `
float oLayer = floor(vInfo.x + 0.5);
int oMi = int(floor(oLayer / ${VARIANTS.toFixed(1)} + 0.01));
vec4 oDet = texture(uDetail, vec3(vLuv, oLayer));
vec4 oProps = uProps[oMi];
vec2 oMUv = abs(vObjN.y) > 0.5 ? vSimPos.xz : vec2(vSimPos.x + vSimPos.z, vSimPos.y);
float oMacro = texture(uDetail, vec3(oMUv * 0.083, uMacroLayer)).b * 0.6 + texture(uDetail, vec3(oMUv * 0.29 + 0.37, uMacroLayer)).b * 0.4;
oDet.r = clamp(oDet.r + (oMacro - 0.5) * uMacro[oMi] * 1.6, 0.0, 1.0);
float oBits = floor(vInfo.z + 0.5);
float oW = oProps.z;
float kNU = mod(oBits, 2.0) * pow(1.0 - smoothstep(0.0, oW, vLuv.x), 1.6);
float kPU = mod(floor(oBits / 2.0), 2.0) * pow(1.0 - smoothstep(0.0, oW, 1.0 - vLuv.x), 1.6);
float kNV = mod(floor(oBits / 4.0), 2.0) * pow(1.0 - smoothstep(0.0, oW, vLuv.y), 1.6);
float kPV = mod(floor(oBits / 8.0), 2.0) * pow(1.0 - smoothstep(0.0, oW, 1.0 - vLuv.y), 1.6);
vec2 oBevel = vec2(kPU - kNU, kPV - kNV);
float oWear = max(max(kNU, kPU), max(kNV, kPV));
vec3 oAlb = mix(uCol1[oMi], uCol2[oMi], oDet.r) * (0.55 + 0.9 * oDet.g) * (1.0 + (oMacro - 0.5) * 0.35 * uMacro[oMi]);
oAlb = mix(oAlb, uGrout[oMi], oDet.a);
float oChip = smoothstep(0.3, 0.8, oWear + (oDet.b - 0.5) * 0.9);
oAlb = mix(oAlb, oAlb * 1.22 + 0.015, oChip * 0.55);
float oCap = 0.0;
vec3 oCapN = vec3(0.0, 0.0, 1.0);
if (uCapOn > 0.5 && vInfo.w > 0.5) {
  bool oTop = vObjN.y > 0.5;
  vec2 cuv = oTop ? vSimPos.xz * 0.5 : vec2((vSimPos.x + vSimPos.z) * 0.5, vSimPos.y * 0.5);
  vec4 cd = texture(uDetail, vec3(cuv, uCapLayer));
  oCapN = texture(uNormalArr, vec3(cuv, uCapLayer)).xyz * 2.0 - 1.0;
  if (oTop) {
    oCap = 1.0;
  } else {
    float depth = uCapStyle.x * (0.45 + cd.b * 1.1);
    oCap = 1.0 - smoothstep(depth - 0.02, depth + 0.02, 1.0 - vLuv.y);
  }
  float cm = clamp(cd.r + (oMacro - 0.5) * 1.4, 0.0, 1.0);
  vec3 cc = mix(uCap1, uCap2, cm) * (0.55 + 0.9 * cd.g) * (0.9 + oMacro * 0.2);
  cc = mix(cc, uCapGrout, cd.a);
  oAlb = mix(oAlb, cc, oCap);
}
float oAO = vInfo.y;
diffuseColor.rgb = oAlb;
`;

const FRAG_ROUGH = /* glsl */ `
float roughnessFactor = clamp(oProps.x + (oDet.b - 0.5) * 0.45, 0.05, 1.0);
roughnessFactor = mix(roughnessFactor, uCapStyle.y, oCap);
`;

const FRAG_METAL = /* glsl */ `
float metalnessFactor = oProps.y * (1.0 - oCap) * (1.0 - oDet.a * 0.8);
`;

const FRAG_NORMAL = /* glsl */ `
{
  vec3 tn = texture(uNormalArr, vec3(vLuv, oLayer)).xyz * 2.0 - 1.0;
  tn.xy *= oProps.w;
  tn = mix(tn, oCapN * vec3(1.4, 1.4, 1.0), oCap);
  tn.xy += oBevel * 1.1;
  vec3 oT = normalize(vTu);
  vec3 oB = normalize(vTv);
  normal = normalize(oT * tn.x + oB * tn.y + normal * max(tn.z, 0.2));
}
`;

const FRAG_EMIS = /* glsl */ `
totalEmissiveRadiance = uEmis[oMi] * (0.2 + oDet.a * oDet.a * 1.8) * (1.0 - oCap) * uGlowPulse;
`;

const FRAG_AO = /* glsl */ `
reflectedLight.indirectDiffuse *= oAO;
reflectedLight.indirectSpecular *= mix(1.0, oAO, 0.8);
reflectedLight.directDiffuse *= mix(0.72, 1.0, oAO);
`;

export interface WorldUniforms {
  [k: string]: THREE.IUniform;
}

/** The block material: one per stage, retinted per palette. */
export class WorldMaterial {
  readonly material: THREE.MeshStandardMaterial;
  readonly u: WorldUniforms;

  constructor() {
    const tex = surfaceTextures();
    this.u = {
      uDetail: { value: tex.detail },
      uNormalArr: { value: tex.normal },
      uCol1: { value: MAT_ORDER.map(() => new THREE.Color()) },
      uCol2: { value: MAT_ORDER.map(() => new THREE.Color()) },
      uGrout: { value: MAT_ORDER.map(() => new THREE.Color()) },
      uProps: { value: MAT_ORDER.map(() => new THREE.Vector4()) },
      uEmis: { value: MAT_ORDER.map(() => new THREE.Color()) },
      uCap1: { value: new THREE.Color() },
      uCap2: { value: new THREE.Color() },
      uCapGrout: { value: new THREE.Color() },
      uCapLayer: { value: CAP_BASE },
      uCapOn: { value: 1 },
      uCapStyle: { value: new THREE.Vector4(0.16, 0.9, 0.5, 0) },
      uGlowPulse: { value: 1 },
      uMacro: { value: [1, 0.5, 0.4, 0.3, 0.6, 0.2, 0.7, 0.5] },
      uMacroLayer: { value: CAP_BASE + 1 },
    };
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    const u = this.u;
    patch(m, {
      cutout: true,
      hfog: true,
      key: 'world',
      extra: (shader) => {
        Object.assign(shader.uniforms, u);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
          .replace('#include <map_fragment>', FRAG_MAP)
          .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
          .replace('#include <metalnessmap_fragment>', FRAG_METAL)
          .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
          .replace('#include <emissivemap_fragment>', FRAG_EMIS)
          .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FRAG_AO}`);
      },
    });
    this.material = m;
  }

  setPalette(p: Palette): void {
    const u = this.u;
    const props: Record<string, [number, number]> = {
      stone: [0.075, 0.9],
      brick: [0.05, 0.9],
      wood: [0.05, 0.8],
      brass: [0.06, 0.9],
      dark: [0.07, 1],
      crystal: [0.09, 1.1],
      leaf: [0.1, 1],
      marble: [0.05, 0.7],
    };
    MAT_ORDER.forEach((name, i) => {
      const look: MatLook = p.mats[name];
      (u.uCol1.value as THREE.Color[])[i].copy(col(look.color));
      (u.uCol2.value as THREE.Color[])[i].copy(col(look.color2));
      const grout =
        name === 'brick'
          ? mixc(p.mats.stone.color, '#d9d0bf', 0.55).multiplyScalar(0.85)
          : name === 'crystal'
            ? shade(look.color, 1.25, 0.9)
            : name === 'marble'
              ? shade(look.color2, 0.85)
              : name === 'leaf'
                ? shade(look.color2, 0.38)
                : name === 'wood'
                  ? shade(look.color2, 0.45)
                  : shade(look.color2, 0.55);
      (u.uGrout.value as THREE.Color[])[i].copy(grout);
      const [bevel, nstr] = props[name];
      (u.uProps.value as THREE.Vector4[])[i].set(look.rough, look.metal, bevel, nstr);
      const emis = (u.uEmis.value as THREE.Color[])[i];
      if (look.emissive) emis.copy(col(look.emissive)).multiplyScalar(name === 'crystal' ? 1.6 : 1);
      else emis.setRGB(0, 0, 0);
    });
    const cap = p.top;
    u.uCapOn.value = cap === 'none' ? 0 : 1;
    if (cap !== 'none') {
      const key = cap as CapKey;
      u.uCapLayer.value = CAP_BASE + CAP_ORDER.indexOf(key);
      const top = col(p.topColor);
      const style = u.uCapStyle.value as THREE.Vector4;
      const c1 = u.uCap1.value as THREE.Color;
      const c2 = u.uCap2.value as THREE.Color;
      const cg = u.uCapGrout.value as THREE.Color;
      if (cap === 'grass') {
        c1.copy(top);
        c2.copy(shade(p.topColor, 1.12, 1.1, -0.05));
        cg.copy(shade(p.topColor, 0.5));
        style.set(0.17, 0.92, 0.5, 0);
      } else if (cap === 'moss') {
        c1.copy(top);
        c2.copy(shade(p.topColor, 0.8, 1.2, 0.04));
        cg.copy(shade(p.topColor, 0.5));
        style.set(0.13, 0.95, 0.5, 0);
      } else if (cap === 'leaves') {
        c1.copy(top);
        c2.copy(col(p.mats.leaf.color2));
        cg.copy(shade(p.mats.wood.color2, 0.8));
        style.set(0.1, 0.85, 0.5, 0);
      } else if (cap === 'snow') {
        c1.copy(col('#f4f7fb'));
        c2.copy(col('#d8e2f0'));
        cg.copy(col('#c8d4e6'));
        style.set(0.2, 0.6, 0.5, 0);
      } else {
        c1.copy(top);
        c2.copy(shade(p.topColor, 0.75));
        cg.copy(col(p.mats.brass.color));
        style.set(0.07, 0.95, 0.5, 0);
      }
    }
  }
}
