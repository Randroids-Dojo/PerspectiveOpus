import * as THREE from 'three';
import type { Palette } from '../game/palettes';
import type { Game, GameEvent } from '../game/sim';
import { MAT } from '../game/types';
import type { Look } from './look';
import { SPRITE, spriteAtlas } from './textures';
import { col, mixc, rng, shade } from './util';

/**
 * One-off effects from game events (dust, sparks, ink, rings) as CPU-simulated
 * instanced billboards, ambient particles per palette driven entirely in the
 * vertex shader, and soft glow halos for lights.
 */

const TONE = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;

const BB_VERT = /* glsl */ `
attribute vec4 iA;
attribute vec4 iC;
attribute vec2 iR;
varying vec2 vUv;
varying vec4 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(iA.xyz, 1.0);
  float c = cos(iR.x);
  float s = sin(iR.x);
  vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iA.w;
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
  float cell = iR.y;
  vUv = (vec2(mod(cell, 4.0), 3.0 - floor(cell / 4.0)) + uv) / 4.0;
  vC = iC;
}
`;

const BB_FRAG = /* glsl */ `
uniform sampler2D uTex;
varying vec2 vUv;
varying vec4 vC;
void main() {
  vec4 t = texture2D(uTex, vUv);
  gl_FragColor = vec4(vC.rgb * t.rgb, vC.a * t.a);
  if (gl_FragColor.a < 0.004) discard;
  ${TONE}
}
`;

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  r: number;
  g: number;
  b: number;
  a: number;
  grav: number;
  drag: number;
  rot: number;
  spin: number;
  cell: number;
  /** Fade-in fraction of life. */
  fin: number;
  /** Optional attractor (for ink gathering). */
  tx?: number;
  ty?: number;
  tz?: number;
}

export interface SpawnOpts {
  vel?: [number, number, number];
  life?: number;
  size?: number;
  size1?: number;
  color?: THREE.Color;
  alpha?: number;
  grav?: number;
  drag?: number;
  rot?: number;
  spin?: number;
  cell?: number;
  fin?: number;
  target?: [number, number, number];
}

function billboardGeometry(max: number): { geo: THREE.InstancedBufferGeometry; a: Float32Array; c: Float32Array; r: Float32Array } {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const a = new Float32Array(max * 4);
  const c = new Float32Array(max * 4);
  const r = new Float32Array(max * 2);
  geo.setAttribute('iA', new THREE.InstancedBufferAttribute(a, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('iC', new THREE.InstancedBufferAttribute(c, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('iR', new THREE.InstancedBufferAttribute(r, 2).setUsage(THREE.DynamicDrawUsage));
  geo.instanceCount = 0;
  return { geo, a, c, r };
}

function billboardMaterial(additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: BB_VERT,
    fragmentShader: BB_FRAG,
    uniforms: { uTex: { value: spriteAtlas() } },
    transparent: true,
    depthWrite: false,
    // Billboards are built in view space inside the mirrored world group, so winding is flipped.
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/** A pool of simulated billboards. */
class Pool {
  readonly mesh: THREE.Mesh;
  private ps: P[] = [];
  private geo: THREE.InstancedBufferGeometry;
  private a: Float32Array;
  private c: Float32Array;
  private r: Float32Array;

  constructor(
    private max: number,
    additive: boolean,
  ) {
    const b = billboardGeometry(max);
    this.geo = b.geo;
    this.a = b.a;
    this.c = b.c;
    this.r = b.r;
    this.mesh = new THREE.Mesh(this.geo, billboardMaterial(additive));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 11;
  }

  clear(): void {
    this.ps.length = 0;
    this.geo.instanceCount = 0;
  }

  spawn(x: number, y: number, z: number, o: SpawnOpts): void {
    if (this.ps.length >= this.max) this.ps.shift();
    const c = o.color ?? new THREE.Color(1, 1, 1);
    const life = o.life ?? 0.6;
    this.ps.push({
      x,
      y,
      z,
      vx: o.vel?.[0] ?? 0,
      vy: o.vel?.[1] ?? 0,
      vz: o.vel?.[2] ?? 0,
      life,
      max: life,
      s0: o.size ?? 0.2,
      s1: o.size1 ?? o.size ?? 0.2,
      r: c.r,
      g: c.g,
      b: c.b,
      a: o.alpha ?? 1,
      grav: o.grav ?? 0,
      drag: o.drag ?? 0,
      rot: o.rot ?? Math.random() * 6.28,
      spin: o.spin ?? 0,
      cell: o.cell ?? SPRITE.dot,
      fin: o.fin ?? 0.08,
      tx: o.target?.[0],
      ty: o.target?.[1],
      tz: o.target?.[2],
    });
  }

  update(dt: number): void {
    const ps = this.ps;
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.tx !== undefined) {
        // Ease towards a target, arriving as life runs out.
        const k = Math.min(1, dt / Math.max(0.02, p.life));
        p.x += (p.tx - p.x) * k;
        p.y += (p.ty! - p.y) * k;
        p.z += (p.tz! - p.z) * k;
      } else {
        const d = Math.exp(-p.drag * dt);
        p.vx *= d;
        p.vy = p.vy * d - p.grav * dt;
        p.vz *= d;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
      }
      p.rot += p.spin * dt;
      ps[n++] = p;
    }
    ps.length = n;
    const a = this.a;
    const c = this.c;
    const r = this.r;
    for (let i = 0; i < n; i++) {
      const p = ps[i];
      const t = 1 - p.life / p.max;
      const fade = Math.min(1, t / Math.max(1e-3, p.fin)) * Math.min(1, (1 - t) * 3);
      a[i * 4] = p.x;
      a[i * 4 + 1] = p.y;
      a[i * 4 + 2] = p.z;
      a[i * 4 + 3] = p.s0 + (p.s1 - p.s0) * t;
      c[i * 4] = p.r;
      c[i * 4 + 1] = p.g;
      c[i * 4 + 2] = p.b;
      c[i * 4 + 3] = p.a * fade;
      r[i * 2] = p.rot;
      r[i * 2 + 1] = p.cell;
    }
    this.geo.instanceCount = n;
    for (const k of ['iA', 'iC', 'iR']) {
      const attr = this.geo.attributes[k] as THREE.InstancedBufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
}

/** Glow halos placed fresh every frame by whoever owns a light. */
export class Halos {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private a: Float32Array;
  private c: Float32Array;
  private r: Float32Array;
  private n = 0;
  scale = 1;

  constructor(private max = 256) {
    const b = billboardGeometry(max);
    this.geo = b.geo;
    this.a = b.a;
    this.c = b.c;
    this.r = b.r;
    this.mesh = new THREE.Mesh(this.geo, billboardMaterial(true));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
  }

  begin(): void {
    this.n = 0;
  }

  add(x: number, y: number, z: number, size: number, color: THREE.Color, intensity = 1, cell: number = SPRITE.halo): void {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.a.set([x, y, z, size], i * 4);
    this.c.set([color.r * intensity * this.scale, color.g * intensity * this.scale, color.b * intensity * this.scale, 1], i * 4);
    this.r.set([0, cell], i * 2);
  }

  end(): void {
    this.geo.instanceCount = this.n;
    for (const k of ['iA', 'iC', 'iR']) {
      const attr = this.geo.attributes[k] as THREE.InstancedBufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.n * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------- ambient

const AMB_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec3 uVel;
uniform float uWobble;
uniform float uSize;
uniform float uSpin;
uniform float uKind;
uniform float uCell;
varying vec2 vUv;
varying float vA;
varying float vTone;
void main() {
  float sp = 0.6 + aSeed.w * 0.8;
  vec3 drift = uVel * uTime * sp;
  float ph = aSeed.w * 40.0;
  vec3 wob = vec3(sin(uTime * 0.7 + ph), sin(uTime * 0.9 + ph * 1.3) * 0.6, cos(uTime * 0.6 + ph * 0.7)) * uWobble;
  vec3 p = aSeed.xyz * uBoxSize + drift + wob;
  p = mod(p - uBoxMin, uBoxSize) + uBoxMin;
  vec3 e = min(p - uBoxMin, uBoxMin + uBoxSize - p) / (uBoxSize * 0.12);
  float edge = clamp(min(e.x, min(e.y, e.z)), 0.0, 1.0);
  float tw = 1.0;
  if (uKind > 0.5 && uKind < 1.5) tw = smoothstep(0.2, 1.0, sin(uTime * (1.5 + aSeed.w * 2.0) + ph)) ;
  if (uKind > 1.5 && uKind < 2.5) tw = 0.5 + 0.5 * sin(uTime * 3.0 + ph);
  if (uKind > 2.5) tw = 0.7 + 0.3 * sin(uTime * 2.0 + ph);
  vA = edge * tw;
  vTone = fract(aSeed.w * 7.13);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float rot = uSpin * (uTime * (0.5 + aSeed.w) + ph);
  float c = cos(rot);
  float s = sin(rot);
  float size = uSize * (0.6 + aSeed.w * 0.8);
  vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * size;
  if (uSpin > 0.0) q.x *= 0.55 + 0.45 * sin(uTime * 3.0 + ph);
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
  vUv = (vec2(mod(uCell, 4.0), 3.0 - floor(uCell / 4.0)) + uv) / 4.0;
}
`;

const AMB_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uAlpha;
varying vec2 vUv;
varying float vA;
varying float vTone;
void main() {
  vec4 t = texture2D(uTex, vUv);
  vec3 c = mix(uColA, uColB, vTone) * t.rgb;
  gl_FragColor = vec4(c, t.a * vA * uAlpha);
  if (gl_FragColor.a < 0.004) discard;
  ${TONE}
}
`;

class Ambient {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private max: number;

  constructor(max: number, seed: number, additive: boolean) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const s = new Float32Array(max * 4);
    const r = rng(seed);
    for (let i = 0; i < max * 4; i++) s[i] = r();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(s, 4));
    geo.instanceCount = max;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: AMB_VERT,
      fragmentShader: AMB_FRAG,
      uniforms: {
        uTex: { value: spriteAtlas() },
        uTime: { value: 0 },
        uBoxMin: { value: new THREE.Vector3() },
        uBoxSize: { value: new THREE.Vector3(44, 16, 28) },
        uVel: { value: new THREE.Vector3() },
        uWobble: { value: 0.3 },
        uSize: { value: 0.06 },
        uSpin: { value: 0 },
        uKind: { value: 0 },
        uCell: { value: SPRITE.dot },
        uColA: { value: new THREE.Color() },
        uColB: { value: new THREE.Color() },
        uAlpha: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  setCount(n: number): void {
    this.geo.instanceCount = Math.min(this.max, Math.max(0, Math.round(n)));
  }
}

interface AmbientSpec {
  count: number;
  additive: boolean;
  kind: number;
  cell: number;
  size: number;
  vel: [number, number, number];
  wobble: number;
  spin: number;
  a: THREE.Color;
  b: THREE.Color;
  alpha: number;
  /** Box height range relative to the focus. */
  y: [number, number];
}

function ambientSpecs(p: Palette, look: Look): AmbientSpec[] {
  const glow = col(p.glow);
  const out: AmbientSpec[] = [];
  const motes = (count: number): AmbientSpec => ({
    count,
    additive: true,
    kind: 1,
    cell: SPRITE.dot,
    size: 0.05,
    vel: [0.12, 0.05, 0.04],
    wobble: 0.5,
    spin: 0,
    a: glow.clone().multiplyScalar(1.6),
    b: col('#ffffff').multiplyScalar(1.2),
    alpha: 0.85,
    y: [-4, 9],
  });
  switch (p.ambient) {
    case 'motes':
      out.push(motes(260));
      break;
    case 'mist':
      out.push({
        count: 70,
        additive: false,
        kind: 0,
        cell: SPRITE.mist,
        size: 5,
        vel: [0.35, 0.0, 0.05],
        wobble: 0.8,
        spin: 0,
        a: col(p.fog).multiplyScalar(1.05),
        b: col(p.skyHorizon),
        alpha: 0.32,
        y: [-6, 1],
      });
      break;
    case 'leaves':
    case 'petals':
      out.push({
        count: 120,
        additive: false,
        kind: 0,
        cell: p.ambient === 'leaves' ? SPRITE.leaf : SPRITE.petal,
        size: 0.14,
        vel: [0.6, -0.8, 0.15],
        wobble: 0.9,
        spin: 1,
        a: col(p.mats.leaf.color),
        b: p.ambient === 'leaves' ? col('#e3a23c') : col('#f6d3e4'),
        alpha: 1,
        y: [-5, 10],
      });
      break;
    case 'fireflies':
      out.push({
        count: 110,
        additive: true,
        kind: 2,
        cell: SPRITE.fly,
        size: 0.16,
        vel: [0.05, 0.03, 0.05],
        wobble: 1.4,
        spin: 0,
        a: col('#d8ff8a').multiplyScalar(2.6),
        b: col('#ffe68a').multiplyScalar(2.2),
        alpha: 1,
        y: [-3, 6],
      });
      break;
    case 'sparks':
      out.push({
        count: 140,
        additive: true,
        kind: 3,
        cell: SPRITE.dot,
        size: 0.05,
        vel: [0.2, 1.4, 0.05],
        wobble: 0.25,
        spin: 0,
        a: col('#ffb24a').multiplyScalar(2.4),
        b: col('#ffe0a0').multiplyScalar(2),
        alpha: 1,
        y: [-5, 10],
      });
      break;
    case 'embers':
      out.push({
        count: 150,
        additive: true,
        kind: 3,
        cell: SPRITE.dot,
        size: 0.06,
        vel: [0.15, 0.55, 0.05],
        wobble: 0.6,
        spin: 0,
        a: col('#ff7a3a').multiplyScalar(2.4),
        b: col('#ffc46a').multiplyScalar(2),
        alpha: 1,
        y: [-5, 10],
      });
      break;
  }
  if (look.motes > 0 && p.ambient !== 'motes') out.push(motes(Math.round(200 * look.motes)));
  return out;
}

// ---------------------------------------------------------------- the effects system

export class Effects {
  readonly group = new THREE.Group();
  readonly halos = new Halos(320);
  private soft = new Pool(1400, false);
  private glow = new Pool(1400, true);
  private ambients: Ambient[] = [];
  private specs: AmbientSpec[] = [];
  private rings: { mesh: THREE.Mesh; t: number; dur: number; size: number }[] = [];
  private pal: Palette | null = null;
  private dust = new THREE.Color();
  private gold = new THREE.Color();
  private ink = col('#0c0a12');
  private gatherAcc = 0;
  private quality: 'low' | 'medium' | 'high' = 'high';

  constructor() {
    this.group.add(this.soft.mesh, this.glow.mesh, this.halos.mesh);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.035, 6, 48),
        new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.rotation.x = Math.PI / 2;
      m.visible = false;
      m.renderOrder = 12;
      this.group.add(m);
      this.rings.push({ mesh: m, t: 1, dur: 1, size: 1 });
    }
  }

  load(p: Palette, look: Look): void {
    this.pal = p;
    this.soft.clear();
    this.glow.clear();
    for (const r of this.rings) {
      r.t = r.dur;
      r.mesh.visible = false;
    }
    for (const a of this.ambients) {
      this.group.remove(a.mesh);
      a.mesh.geometry.dispose();
      a.mat.dispose();
    }
    this.ambients = [];
    this.specs = ambientSpecs(p, look);
    this.specs.forEach((s, i) => {
      const a = new Ambient(s.count, 77 + i * 13, s.additive);
      const u = a.mat.uniforms;
      u.uVel.value.set(...s.vel);
      u.uWobble.value = s.wobble;
      u.uSize.value = s.size;
      u.uSpin.value = s.spin;
      u.uKind.value = s.kind;
      u.uCell.value = s.cell;
      (u.uColA.value as THREE.Color).copy(s.a);
      (u.uColB.value as THREE.Color).copy(s.b);
      u.uAlpha.value = s.alpha;
      this.ambients.push(a);
      this.group.add(a.mesh);
    });
    this.dust.copy(mixc(p.mats.stone.color, p.fog, 0.45)).multiplyScalar(1.1);
    this.gold.copy(col(p.glow));
    this.setQuality(this.quality);
  }

  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.quality = q;
    const k = q === 'high' ? 1 : q === 'medium' ? 0.55 : 0.3;
    this.ambients.forEach((a, i) => a.setCount(this.specs[i].count * k));
    this.halos.scale = q === 'low' ? 1.6 : 1;
  }

  /** Spawns a ring that expands flat on the ground. */
  ring(x: number, y: number, z: number, size: number, color: THREE.Color, dur = 0.8): void {
    const r = this.rings.find((q) => q.t >= q.dur) ?? this.rings[0];
    r.t = 0;
    r.dur = dur;
    r.size = size;
    r.mesh.position.set(x, y, z);
    (r.mesh.material as THREE.MeshBasicMaterial).color.copy(color);
    r.mesh.visible = true;
  }

  burst(x: number, y: number, z: number, n: number, o: SpawnOpts & { speed: number; up?: number; flat?: boolean; spread?: number }, additive: boolean): void {
    const pool = additive ? this.glow : this.soft;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = o.flat ? (Math.random() - 0.3) * 0.4 : Math.asin(Math.random() * 2 - 1);
      const sp = o.speed * (0.5 + Math.random() * 0.7);
      const vx = Math.cos(a) * Math.cos(e) * sp;
      const vy = Math.sin(e) * sp + (o.up ?? 0);
      const vz = Math.sin(a) * Math.cos(e) * sp;
      const s = o.spread ?? 0;
      pool.spawn(x + (Math.random() - 0.5) * s, y + (Math.random() - 0.5) * s, z + (Math.random() - 0.5) * s, {
        ...o,
        vel: [vx, vy, vz],
        life: (o.life ?? 0.6) * (0.7 + Math.random() * 0.6),
        size: (o.size ?? 0.2) * (0.7 + Math.random() * 0.6),
        spin: o.spin ?? (Math.random() - 0.5) * 4,
      });
    }
  }

  private puff(x: number, y: number, z: number, n: number, speed: number, size: number, color: THREE.Color, life = 0.5): void {
    this.burst(x, y + 0.05, z, n, { speed, up: 0.4, flat: true, size: size * 0.6, size1: size * 1.6, color, alpha: 0.55, drag: 5, life, cell: SPRITE.puff, fin: 0.05 }, false);
  }

  handle(events: readonly GameEvent[], game: Game, feet: THREE.Vector3): void {
    const p = this.pal;
    if (!p) return;
    const lv = game.level;
    for (const e of events) {
      switch (e.t) {
        case 'jump':
          this.puff(feet.x, feet.y, feet.z, 7, 1.6, 0.28, this.dust);
          break;
        case 'land': {
          const k = Math.min(1, e.impact / 21);
          this.puff(feet.x, feet.y, feet.z, Math.round(5 + k * 12), 1.2 + k * 3, 0.24 + k * 0.3, this.dust, 0.45 + k * 0.3);
          if (k > 0.55)
            this.burst(feet.x, feet.y + 0.05, feet.z, 8, { speed: 2.5, up: 2.5, size: 0.05, color: shade(this.dust, 0.7), alpha: 1, grav: 14, life: 0.6, cell: SPRITE.dot }, false);
          if (e.surface === MAT.stone || e.surface === MAT.marble) this.ring(feet.x, feet.y + 0.03, feet.z, 0.4 + k * 0.9, this.dust.clone().multiplyScalar(0.25 * k), 0.4);
          break;
        }
        case 'step':
          this.puff(feet.x, feet.y, feet.z, 2, 0.6, 0.16, this.dust, 0.35);
          break;
        case 'note': {
          const n = lv.notes[e.id].pos;
          this.burst(n.x, n.y, n.z, 34, { speed: 4.5, size: 0.14, size1: 0.02, color: this.gold.clone().multiplyScalar(3), drag: 3, grav: 2, life: 0.8, cell: SPRITE.sparkle }, true);
          this.burst(n.x, n.y, n.z, 5, { speed: 1, up: 1.4, size: 0.22, color: this.gold.clone().multiplyScalar(2.2), drag: 1, life: 1.4, cell: SPRITE.note, spin: 0 }, true);
          this.glow.spawn(n.x, n.y, n.z, { size: 0.4, size1: 2.6, color: this.gold.clone().multiplyScalar(2), life: 0.35, cell: SPRITE.halo, fin: 0.01 });
          break;
        }
        case 'checkpoint': {
          const c = lv.checkpoints[e.id].pos;
          this.ring(c.x, c.y + 0.05, c.z, 1.6, this.gold.clone().multiplyScalar(2.2), 0.9);
          this.burst(c.x, c.y + 0.6, c.z, 22, { speed: 1.2, up: 2.2, size: 0.1, size1: 0.02, color: this.gold.clone().multiplyScalar(2.5), drag: 1.5, life: 1.1, cell: SPRITE.sparkle, spread: 0.5 }, true);
          break;
        }
        case 'death': {
          const q = e.pos;
          this.burst(q.x, q.y + 0.45, q.z, 48, { speed: 5.5, up: 2.5, size: 0.17, size1: 0.08, color: this.ink, alpha: 1, grav: 16, drag: 0.6, life: 0.9, cell: SPRITE.drop, fin: 0.01 }, false);
          this.burst(q.x, q.y + 0.45, q.z, 10, { speed: 2.2, up: 3, size: 0.3, size1: 0.12, color: this.ink, alpha: 1, grav: 12, drag: 0.4, life: 0.8, cell: SPRITE.drop, fin: 0.01 }, false);
          this.burst(q.x, q.y + 0.45, q.z, 8, { speed: 1.4, size: 0.4, size1: 1.1, color: this.ink, alpha: 0.5, drag: 4, life: 0.6, cell: SPRITE.puff }, false);
          this.glow.spawn(q.x, q.y + 0.45, q.z, { size: 0.3, size1: 2.2, color: col(p.rubric).multiplyScalar(1.6), life: 0.3, cell: SPRITE.halo, fin: 0.01 });
          break;
        }
        case 'respawn': {
          const q = game.player.pos;
          this.ring(q.x, q.y + 0.04, q.z, 0.9, this.gold.clone().multiplyScalar(1.6), 0.6);
          this.glow.spawn(q.x, q.y + 0.45, q.z, { size: 0.2, size1: 1.8, color: this.gold.clone().multiplyScalar(1.4), life: 0.35, cell: SPRITE.halo, fin: 0.01 });
          break;
        }
        case 'bounce': {
          const d = lv.drums[e.id].pos;
          this.ring(d.x + 0.5, d.y + 0.74, d.z + 0.5, 0.9, this.gold.clone().multiplyScalar(1.8), 0.5);
          this.ring(d.x + 0.5, d.y + 0.74, d.z + 0.5, 1.5, this.gold.clone().multiplyScalar(0.9), 0.8);
          this.burst(d.x + 0.5, d.y + 0.9, d.z + 0.5, 6, { speed: 0.8, up: 2.5, size: 0.2, color: this.gold.clone().multiplyScalar(2), drag: 1, life: 1.1, cell: SPRITE.note, spin: 0 }, true);
          break;
        }
        case 'key': {
          const k = lv.keys[e.id];
          const gc = groupColor(e.group).multiplyScalar(2.2);
          this.burst(k.pos.x + k.width / 2, k.pos.y + 0.1, k.pos.z + 0.5, 16, { speed: 1.5, up: 1.6, size: 0.1, size1: 0.02, color: gc, drag: 2, life: 0.7, cell: SPRITE.sparkle, spread: 0.6 }, true);
          this.ring(k.pos.x + k.width / 2, k.pos.y + 0.06, k.pos.z + 0.5, 0.8 + k.width * 0.3, gc.clone().multiplyScalar(0.7), 0.5);
          break;
        }
        case 'gate': {
          lv.gates.forEach((g) => {
            if (g.group !== e.group) return;
            for (let i = 0; i < 18; i++) {
              const x = g.min.x + Math.random() * (g.max.x - g.min.x);
              const y = g.min.y + Math.random() * (g.max.y - g.min.y);
              const z = g.min.z + Math.random() * (g.max.z - g.min.z);
              this.glow.spawn(x, y, z, { vel: [0, 0.6, 0], size: 0.12, size1: 0.02, color: this.gold.clone().multiplyScalar(2.2), life: 0.7, cell: SPRITE.sparkle, drag: 1 });
            }
          });
          break;
        }
        case 'exit': {
          const x = lv.exit.pos;
          this.burst(x.x, x.y + 1.3, x.z, 50, { speed: 4, size: 0.16, size1: 0.02, color: this.gold.clone().multiplyScalar(3), drag: 2, grav: 0.5, life: 1.3, cell: SPRITE.sparkle }, true);
          this.burst(x.x, x.y + 0.5, x.z, 12, { speed: 0.6, up: 2, size: 0.25, color: this.gold.clone().multiplyScalar(2), drag: 0.6, life: 2.2, cell: SPRITE.note, spin: 0, spread: 1.2 }, true);
          this.ring(x.x, x.y + 0.05, x.z, 2.4, this.gold.clone().multiplyScalar(2), 1.2);
          break;
        }
        case 'switch':
          this.burst(feet.x, feet.y + 0.45, feet.z, 12, { speed: 1.6, size: 0.08, size1: 0.01, color: this.gold.clone().multiplyScalar(2), drag: 3, life: 0.5, cell: SPRITE.sparkle }, true);
          break;
        case 'bonk':
          this.burst(feet.x, feet.y + 0.9, feet.z, 5, { speed: 1.6, up: 0.6, size: 0.12, color: col('#fff3c4').multiplyScalar(2), drag: 3, life: 0.4, cell: SPRITE.star }, true);
          break;
      }
    }
  }

  update(dt: number, game: Game, focus: THREE.Vector3, time: number): void {
    this.soft.update(dt);
    this.glow.update(dt);
    for (const r of this.rings) {
      if (r.t >= r.dur) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const s = r.size * (0.3 + 0.7 * (1 - Math.pow(1 - k, 3)));
      r.mesh.scale.set(s, s, 1);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      if (k >= 1) r.mesh.visible = false;
    }
    // Ink gathering back at the respawn point near the end of the death timer.
    const pl = game.player;
    if (pl.dead > 0 && pl.dead < 0.45) {
      this.gatherAcc += dt * 70;
      const t = game.respawn.pos;
      while (this.gatherAcc > 1) {
        this.gatherAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = 0.6 + Math.random() * 0.9;
        this.soft.spawn(t.x + Math.cos(a) * r, t.y + 0.45 + (Math.random() - 0.3) * 1.2, t.z + Math.sin(a) * r, {
          size: 0.1,
          size1: 0.04,
          color: this.ink,
          alpha: 1,
          life: Math.max(0.05, pl.dead),
          cell: SPRITE.drop,
          target: [t.x, t.y + 0.45, t.z],
          fin: 0.2,
        });
      }
    } else this.gatherAcc = 0;
    for (let i = 0; i < this.ambients.length; i++) {
      const a = this.ambients[i];
      const s = this.specs[i];
      const u = a.mat.uniforms;
      u.uTime.value = time;
      const size = u.uBoxSize.value as THREE.Vector3;
      (u.uBoxMin.value as THREE.Vector3).set(focus.x - size.x / 2, focus.y + s.y[0], -6);
      size.y = s.y[1] - s.y[0];
    }
  }
}

/** Colours shared by a key and its gates. */
export function groupColor(g: number): THREE.Color {
  const list = ['#e3b341', '#d5503c', '#3f86d8', '#4aa86a', '#a26ad8', '#e07fb0', '#4ab6b8'];
  return col(list[((g % list.length) + list.length) % list.length]);
}
