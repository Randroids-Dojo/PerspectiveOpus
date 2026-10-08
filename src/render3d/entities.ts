import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { clamp } from '../core/math';
import type { Palette } from '../game/palettes';
import type { Game } from '../game/sim';
import type { FrameInfo } from '../render/types';
import type { Halos } from './effects';
import { buildGate, buildKey, updateGate, updateKey, type GateObj, type KeyObj } from './gates';
import type { PropMaterials } from './props';
import { patch } from './shared';
import { Bag, GeoBucket, PRIM, col, mat, shade, type Rng, rng } from './util';

/**
 * The cast and props that the simulation moves: notes, checkpoints, the
 * Fermata arch, drums, piano keys, staff gates, music-stand platforms and
 * Discords. Built per level, animated from game state every frame.
 */

let noteGeo: THREE.BufferGeometry | null = null;
const DISCORD_RED = new THREE.Color('#ff3a2a');

/** A gold eighth note, extruded and bevelled, centred on its pickup point. */
function eighthNote(): THREE.BufferGeometry {
  if (noteGeo) return noteGeo;
  const head = new THREE.Shape();
  head.absellipse(-0.075, -0.2, 0.15, 0.105, 0, Math.PI * 2, false, 0.38);
  const stem = new THREE.Shape();
  stem.moveTo(0.045, -0.2);
  stem.lineTo(0.088, -0.18);
  stem.lineTo(0.088, 0.34);
  stem.lineTo(0.045, 0.34);
  stem.closePath();
  const flag = new THREE.Shape();
  flag.moveTo(0.06, 0.34);
  flag.bezierCurveTo(0.12, 0.26, 0.3, 0.2, 0.25, 0.0);
  flag.bezierCurveTo(0.235, -0.04, 0.22, -0.07, 0.2, -0.09);
  flag.bezierCurveTo(0.24, 0.05, 0.16, 0.16, 0.06, 0.2);
  flag.closePath();
  const g = new THREE.ExtrudeGeometry([head, stem, flag], {
    depth: 0.06,
    bevelEnabled: true,
    bevelThickness: 0.022,
    bevelSize: 0.016,
    bevelSegments: 3,
    curveSegments: 18,
  });
  g.translate(-0.06, 0.0, -0.03);
  g.computeVertexNormals();
  noteGeo = g;
  return g;
}

const VEIL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vP;
void main() {
  vUv = uv;
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const VEIL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vP;
void main() {
  float x = vP.x;
  float y = vP.y;
  float streak = 0.5 + 0.5 * sin(x * 14.0 + sin(y * 2.0 + uTime * 1.3) * 2.0 + uTime * 0.7);
  streak *= 0.6 + 0.4 * sin(x * 31.0 - uTime * 2.1);
  float rise = 0.5 + 0.5 * sin(y * 6.0 - uTime * 2.4 + x * 3.0);
  float edge = smoothstep(0.0, 0.35, 0.82 - abs(x)) * smoothstep(0.0, 0.5, y);
  float a = edge * (0.25 + 0.55 * streak * rise) * uGlow;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface NoteObj {
  mesh: THREE.Mesh;
  i: number;
}
interface CheckObj {
  arm: THREE.Object3D;
  lamp: THREE.Mesh;
  lampMat: THREE.MeshBasicMaterial;
  i: number;
  swing: number;
}
interface DrumObj {
  group: THREE.Group;
  head: THREE.Mesh;
  u: { uHit: { value: number } };
  i: number;
}
interface PlatObj {
  group: THREE.Group;
  i: number;
  size: THREE.Vector3;
}
interface DiscordObj {
  group: THREE.Group;
  shell: THREE.Mesh;
  core: THREE.Mesh;
  i: number;
}

export class Entities {
  readonly group = new THREE.Group();
  private notes: NoteObj[] = [];
  private checks: CheckObj[] = [];
  private drums: DrumObj[] = [];
  private keys: KeyObj[] = [];
  private gates: GateObj[] = [];
  private plats: PlatObj[] = [];
  private discords: DiscordObj[] = [];
  private veil: THREE.ShaderMaterial | null = null;
  private fermata: THREE.Object3D | null = null;
  private discordMat: THREE.MeshPhysicalMaterial;
  private coreMat: THREE.MeshBasicMaterial;
  private glowCol = new THREE.Color();
  private drumHead: THREE.MeshStandardMaterial | null = null;

  constructor(private mats: PropMaterials) {
    this.discordMat = new THREE.MeshPhysicalMaterial({
      color: '#2a1f38',
      metalness: 0.75,
      roughness: 0.18,
      iridescence: 1,
      iridescenceIOR: 1.9,
      iridescenceThicknessRange: [250, 900],
      flatShading: true,
    });
    this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.55, 0.4) });
  }

  build(game: Game, pal: Palette, bag: Bag): void {
    this.group.clear();
    this.notes = [];
    this.checks = [];
    this.drums = [];
    this.keys = [];
    this.gates = [];
    this.plats = [];
    this.discords = [];
    this.glowCol.copy(col(pal.glow));
    const lv = game.level;
    const r = rng(lv.w * 7 + 3);
    const m = this.mats;

    // Notes.
    const ng = eighthNote();
    lv.notes.forEach((n, i) => {
      const mesh = new THREE.Mesh(ng, m.gold);
      mesh.position.set(n.pos.x, n.pos.y, n.pos.z);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.notes.push({ mesh, i });
    });

    // Checkpoints: brass metronomes on plinths.
    const stone = col(pal.mats.stone.color);
    const wood = col(pal.mats.wood.color);
    const brass = col(pal.mats.brass.color);
    lv.checkpoints.forEach((c, i) => {
      const g = new THREE.Group();
      g.position.set(c.pos.x, c.pos.y, c.pos.z);
      g.rotation.y = 0;
      const d = new GeoBucket();
      const mt = new GeoBucket();
      d.add(PRIM.box, mat(0, 0.08, 0, 0, 0, 0, 0.74, 0.16, 0.74), shade(stone, 0.95), { grad: 0.3 });
      d.add(PRIM.box, mat(0, 0.19, 0, 0, 0, 0, 0.6, 0.06, 0.6), shade(stone, 1.05));
      const body = new THREE.CylinderGeometry(0.15, 0.31, 0.86, 4, 1);
      d.add(body, mat(0, 0.22 + 0.43, 0, 0, Math.PI / 4, 0), wood, { grad: 0.25 });
      body.dispose();
      // Brass face plate with tick marks, facing the audience (-z).
      mt.add(PRIM.box, mat(0, 0.62, -0.19, -0.19, 0, 0, 0.14, 0.62, 0.02), brass);
      for (let k = 0; k < 6; k++) mt.add(PRIM.box, mat(0, 0.42 + k * 0.08, -0.205 + k * 0.016, -0.19, 0, 0, 0.08, 0.012, 0.01), shade(brass, 0.6));
      mt.add(PRIM.sphere, mat(0, 1.12, 0, 0, 0, 0, 0.1), brass);
      mt.add(PRIM.cyl, mat(0, 1.06, 0, 0, 0, 0, 0.06, 0.06, 0.06), brass);
      const dg = d.build();
      const mg = mt.build();
      if (dg) {
        const mm = new THREE.Mesh(bag.add(dg), m.diffuse);
        mm.castShadow = mm.receiveShadow = true;
        g.add(mm);
      }
      if (mg) {
        const mm = new THREE.Mesh(bag.add(mg), m.metal);
        mm.castShadow = true;
        g.add(mm);
      }
      // Pendulum arm pivoting low on the front.
      const arm = new THREE.Group();
      arm.position.set(0, 0.36, -0.235);
      const ab = new GeoBucket();
      ab.add(PRIM.cyl, mat(0, 0.36, 0, 0, 0, 0, 0.018, 0.72, 0.018), shade(brass, 1.1));
      ab.add(PRIM.box, mat(0, 0.52, 0, 0, 0, 0, 0.09, 0.07, 0.04), brass);
      ab.add(PRIM.sphere, mat(0, 0, 0, 0, 0, 0, 0.05), shade(brass, 0.8));
      const ag = ab.build();
      if (ag) {
        const am = new THREE.Mesh(bag.add(ag), m.metal);
        am.castShadow = true;
        arm.add(am);
      }
      g.add(arm);
      const lampMat = bag.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.25, 0.15) }));
      const lamp = new THREE.Mesh(PRIM.sphere, lampMat);
      lamp.scale.setScalar(0.085);
      lamp.position.set(0, 1.12, -0.03);
      g.add(lamp);
      this.group.add(g);
      this.checks.push({ arm, lamp, lampMat, i, swing: 0 });
    });

    // The Fermata arch.
    {
      const ex = lv.exit.pos;
      const g = new THREE.Group();
      g.position.set(ex.x, ex.y, ex.z);
      const d = new GeoBucket();
      const sc = col(pal.mats.marble.color).lerp(stone, 0.3);
      const H = 2.3;
      const ri = 0.82;
      const ro = 1.2;
      for (const s of [-1, 1]) {
        const x = s * (ri + ro) / 2;
        d.add(PRIM.box, mat(x, 0.1, 0, 0, 0, 0, ro - ri + 0.16, 0.2, 0.74), shade(sc, 0.9), { grad: 0.2 });
        d.add(PRIM.box, mat(x, 0.2 + (H - 0.4) / 2, 0, 0, 0, 0, ro - ri, H - 0.4, 0.56), sc, { grad: 0.18, jitter: 0.05 });
        for (let k = 1; k < 4; k++) d.add(PRIM.box, mat(x, 0.2 + k * ((H - 0.4) / 4), 0, 0, 0, 0, ro - ri + 0.02, 0.025, 0.58), shade(sc, 0.82));
        d.add(PRIM.box, mat(x, H - 0.1, 0, 0, 0, 0, ro - ri + 0.14, 0.2, 0.68), shade(sc, 1.05));
      }
      const n = 9;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI + 0.012;
        const a1 = ((k + 1) / n) * Math.PI - 0.012;
        const s = new THREE.Shape();
        const key = k === Math.floor(n / 2);
        const out = key ? ro + 0.12 : ro;
        s.moveTo(Math.cos(a0) * ri, Math.sin(a0) * ri);
        s.lineTo(Math.cos(a0) * out, Math.sin(a0) * out);
        s.absarc(0, 0, out, a0, a1, false);
        s.lineTo(Math.cos(a1) * ri, Math.sin(a1) * ri);
        s.absarc(0, 0, ri, a1, a0, true);
        const eg = new THREE.ExtrudeGeometry(s, { depth: key ? 0.62 : 0.54, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 4 });
        eg.translate(0, 0, key ? -0.31 : -0.27);
        d.add(eg, mat(0, H, 0), shade(sc, key ? 1.08 : 1 + (r() - 0.5) * 0.1));
        eg.dispose();
      }
      const ag = d.build();
      if (ag) {
        const am = new THREE.Mesh(bag.add(ag), m.gloss);
        am.castShadow = am.receiveShadow = true;
        g.add(am);
      }
      // The golden fermata: an arc over a dot.
      const fermata = new THREE.Group();
      fermata.position.set(0, H + ro + 0.32, 0);
      const arcG = bag.add(new THREE.TorusGeometry(0.34, 0.06, 10, 32, Math.PI));
      const arc = new THREE.Mesh(arcG, m.gold);
      arc.castShadow = true;
      const dot = new THREE.Mesh(PRIM.sphereHi, m.gold);
      dot.scale.setScalar(0.17);
      dot.position.y = 0.08;
      fermata.add(arc, dot);
      g.add(fermata);
      this.fermata = fermata;
      // The veil of light.
      const vs = new THREE.Shape();
      vs.moveTo(-ri + 0.02, 0.2);
      vs.lineTo(ri - 0.02, 0.2);
      vs.lineTo(ri - 0.02, H);
      vs.absarc(0, H, ri - 0.02, 0, Math.PI, false);
      vs.lineTo(-ri + 0.02, 0.2);
      const vg = bag.add(new THREE.ShapeGeometry(vs, 24));
      this.veil = bag.add(
        new THREE.ShaderMaterial({
          vertexShader: VEIL_VERT,
          fragmentShader: VEIL_FRAG,
          uniforms: { uTime: { value: 0 }, uGlow: { value: 0.5 }, uColor: { value: this.glowCol.clone().multiplyScalar(1.6) } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      const veil = new THREE.Mesh(vg, this.veil);
      veil.renderOrder = 14;
      g.add(veil);
      this.group.add(g);
    }

    // Drums.
    const copper = col('#b8683e');
    const cream = col('#efe3c8');
    const prof = [
      [0.05, 0.1],
      [0.18, 0.12],
      [0.31, 0.19],
      [0.4, 0.31],
      [0.445, 0.46],
      [0.455, 0.64],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    if (lv.drums.length && !this.drumHead) {
      this.drumHead = new THREE.MeshStandardMaterial({ color: cream, roughness: 0.75 });
    }
    lv.drums.forEach((dr, i) => {
      const g = new THREE.Group();
      g.position.set(dr.pos.x + 0.5, dr.pos.y, dr.pos.z + 0.5);
      const mt = new GeoBucket();
      const lathe = new THREE.LatheGeometry(prof, 28);
      mt.add(lathe, mat(0, 0, 0), copper);
      lathe.dispose();
      mt.add(PRIM.torus, mat(0, 0.655, 0, Math.PI / 2, 0, 0, 0.93, 0.93, 0.6), brass);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        mt.add(PRIM.box, mat(Math.cos(a) * 0.46, 0.56, Math.sin(a) * 0.46, 0, -a, 0, 0.04, 0.12, 0.05), shade(brass, 0.9));
      }
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.5;
        mt.add(PRIM.cyl, mat(Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35, 0.03, 0.26, 0.03), shade(brass, 0.8));
      }
      const geo = mt.build();
      const head = new THREE.Mesh(bag.add(new THREE.RingGeometry(0.001, 0.43, 36, 8)), this.drumHead!.clone());
      bag.add(head.material as THREE.Material);
      head.rotation.x = -Math.PI / 2;
      head.position.y = 0.665;
      const u = { uHit: { value: 9 } };
      const hm = head.material as THREE.MeshStandardMaterial;
      patch(hm, {
        cutout: true,
        hfog: true,
        key: 'drumhead',
        extra: (shader) => {
          shader.uniforms.uHit = u.uHit;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uHit;')
            .replace(
              '#include <begin_vertex>',
              `#include <begin_vertex>
              {
                float rr = length(position.xy);
                float env = exp(-uHit * 4.0) * (1.0 - rr / 0.43);
                transformed.z += (-0.05 * exp(-uHit * 9.0) + sin(rr * 32.0 - uHit * 38.0) * 0.018) * env;
              }`,
            );
        },
      });
      if (geo) {
        const mm = new THREE.Mesh(bag.add(geo), m.metal);
        mm.castShadow = mm.receiveShadow = true;
        g.add(mm);
      }
      head.receiveShadow = true;
      g.add(head);
      this.group.add(g);
      this.drums.push({ group: g, head, u, i });
    });

    // Piano keys set into the floor, and the staff gates they raise.
    lv.keys.forEach((k, i) => {
      const { group, obj } = buildKey(k, i, bag, m.gloss);
      this.group.add(group);
      this.keys.push(obj);
    });
    lv.gates.forEach((gd, i) => {
      const { group, obj } = buildGate(gd, i, this.glowCol, bag);
      this.group.add(group);
      this.gates.push(obj);
    });

    // Moving platforms: floating music stands.
    lv.platforms.forEach((p, i) => {
      const g = new THREE.Group();
      const sx = p.size.x;
      const sy = p.size.y;
      const sz = p.size.z;
      const slab = Math.min(sy, 0.42);
      const look = pal.mats[p.mat];
      const base = col(look.color);
      const b = new GeoBucket();
      const mt = new GeoBucket();
      const rb = new RoundedBoxGeometry(sx - 0.02, slab, sz - 0.02, 2, 0.05);
      b.add(rb, mat(sx / 2, sy - slab / 2, sz / 2), base, {
        colorFn: (pp, _n, out) => {
          // Plank stripes along x for wood, quiet veining otherwise.
          const s = p.mat === 'wood' ? Math.sin(pp.z * 26) * 0.05 + Math.sin(pp.x * 3.1 + pp.z * 9) * 0.03 : Math.sin(pp.x * 5 + pp.z * 7) * 0.03;
          out.multiplyScalar(1 + s);
        },
      });
      rb.dispose();
      // Brass trim along the long edges and the corners.
      for (const zz of [0.02, sz - 0.02]) mt.add(PRIM.box, mat(sx / 2, sy - slab + 0.04, zz, 0, 0, 0, sx - 0.02, 0.08, 0.04), brass);
      for (const xx of [0.02, sx - 0.02]) mt.add(PRIM.box, mat(xx, sy - slab + 0.04, sz / 2, 0, 0, 0, 0.04, 0.08, sz - 0.02), brass);
      // The stand: a pole and a little tripod floating below.
      const poleLen = 0.75;
      mt.add(PRIM.cyl, mat(sx / 2, sy - slab - poleLen / 2, sz / 2, 0, 0, 0, 0.05, poleLen, 0.05), shade(brass, 0.9));
      mt.add(PRIM.sphere, mat(sx / 2, sy - slab - poleLen, sz / 2, 0, 0, 0, 0.1), brass);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        mt.add(PRIM.cyl, mat(sx / 2 + Math.cos(a) * 0.12, sy - slab - poleLen - 0.08, sz / 2 + Math.sin(a) * 0.12, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9, 0.025, 0.3, 0.025), shade(brass, 0.8));
      }
      // A lit trim round the top and bolts at the corners, so a stand that sits
      // flush with the floor still reads as machinery that moves.
      const gl = new GeoBucket();
      const trim = this.glowCol.clone().multiplyScalar(0.4);
      for (const zz of [0.06, sz - 0.06]) gl.add(PRIM.box, mat(sx / 2, sy + 0.003, zz, 0, 0, 0, sx - 0.16, 0.012, 0.03), trim);
      for (const xx of [0.06, sx - 0.06]) gl.add(PRIM.box, mat(xx, sy + 0.003, sz / 2, 0, 0, 0, 0.03, 0.012, sz - 0.16), trim);
      for (const xx of [0.14, sx - 0.14]) for (const zz of [0.14, sz - 0.14]) mt.add(PRIM.sphereLo, mat(xx, sy, zz, 0, 0, 0, 0.09, 0.05, 0.09), shade(brass, 1.1));
      if (p.mat === 'brass' && sx > 1.5 && sz > 1.5) b.add(PRIM.box, mat(sx / 2, sy + 0.002, sz / 2, 0, 0, 0, sx - 0.5, 0.01, sz - 0.5), shade(base, 0.55));
      const glg = gl.build();
      if (glg) g.add(new THREE.Mesh(bag.add(glg), m.glow));
      const bg = b.build();
      const mg = mt.build();
      if (bg) {
        const bm = new THREE.Mesh(bag.add(bg), p.mat === 'brass' ? m.metal : m.diffuse);
        bm.castShadow = bm.receiveShadow = true;
        g.add(bm);
      }
      if (mg) {
        const mm = new THREE.Mesh(bag.add(mg), m.metal);
        mm.castShadow = true;
        g.add(mm);
      }
      this.group.add(g);
      this.plats.push({ group: g, i, size: new THREE.Vector3(sx, sy, sz) });
    });

    // Discords.
    const shellGeo = bag.add(this.discordGeometry(r));
    lv.discords.forEach((_d, i) => {
      const g = new THREE.Group();
      const shell = new THREE.Mesh(shellGeo, this.discordMat);
      shell.castShadow = true;
      const core = new THREE.Mesh(PRIM.sphereHi, this.coreMat);
      core.scale.setScalar(0.3);
      g.add(shell, core);
      this.group.add(g);
      this.discords.push({ group: g, shell, core, i });
    });
  }

  private discordGeometry(r: Rng): THREE.BufferGeometry {
    const b = new GeoBucket();
    const dark = col('#2a1d33');
    const ico = new THREE.IcosahedronGeometry(0.2, 1);
    b.add(ico, mat(0, 0, 0), dark);
    ico.dispose();
    const dirs = new THREE.IcosahedronGeometry(1, 0).attributes.position;
    const seen = new Set<string>();
    for (let i = 0; i < dirs.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(dirs, i).normalize();
      const k = `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const len = 0.2 + r() * 0.12;
      const cone = new THREE.ConeGeometry(0.06, len, 5);
      cone.translate(0, len / 2 + 0.14, 0);
      cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v));
      b.add(cone, mat(0, 0, 0), shade(dark, 0.8 + r() * 0.4));
      cone.dispose();
    }
    const g = b.build()!;
    // Flat shading wants non-indexed faces; the physical material computes facet normals itself.
    return g;
  }

  update(game: Game, frame: FrameInfo, halos: Halos, feet: THREE.Vector3, clock: number): void {
    const lv = game.level;
    const t = game.time;
    const a = frame.alpha;
    const gold = this.glowCol;

    for (const n of this.notes) {
      const def = lv.notes[n.i];
      const taken = game.notesTaken[n.i];
      const since = taken ? t - game.noteTakenAt[n.i] : 0;
      if (taken && since > 0.35) {
        n.mesh.visible = false;
        continue;
      }
      n.mesh.visible = true;
      const bob = Math.sin(clock * 2.1 + n.i * 1.7) * 0.07;
      n.mesh.position.set(def.pos.x, def.pos.y + bob + (taken ? since * 2.5 : 0), def.pos.z);
      n.mesh.rotation.y = clock * 1.4 + n.i * 0.9 + (taken ? since * 30 : 0);
      const s = taken ? Math.max(0.01, 1 - since / 0.35) * (1 + since * 2) : 1;
      n.mesh.scale.setScalar(s * 1.05);
      halos.add(def.pos.x, def.pos.y + bob, def.pos.z, 1.1 * s, gold, 0.45 + Math.sin(clock * 3 + n.i) * 0.08);
    }

    const beat = frame.beat >= 0 ? frame.beat : t * 1.6;
    for (const c of this.checks) {
      const on = game.checkpointOn === c.i;
      const lit = game.checkpointAt[c.i] >= 0;
      const target = on ? 1 : 0;
      c.swing += (target - c.swing) * Math.min(1, frame.dt * 3);
      c.arm.rotation.z = Math.cos(Math.PI * beat) * 0.42 * c.swing + (1 - c.swing) * 0.05;
      const k = on ? 1 : lit ? 0.35 : 0;
      c.lampMat.color.copy(gold).multiplyScalar(0.25 + k * 2.6);
      const p = lv.checkpoints[c.i].pos;
      if (k > 0) halos.add(p.x, p.y + 1.12, p.z - 0.03, 0.9 + k * 0.4, gold, 0.25 + 0.35 * k);
    }

    if (this.veil && this.fermata) {
      const ex = lv.exit.pos;
      const d = Math.hypot(feet.x - ex.x, (feet.y - ex.y) * 0.5, (feet.z - ex.z) * 0.6);
      const near = clamp(1 - (d - 1) / 7, 0, 1);
      const fin = game.finished ? clamp((t - game.finishedAt) / 0.8, 0, 1) : 0;
      this.veil.uniforms.uTime.value = clock;
      this.veil.uniforms.uGlow.value = 0.35 + near * 0.55 + fin * 0.8;
      this.fermata.rotation.y = Math.sin(clock * 0.8) * 0.25;
      this.fermata.position.y = 2.3 + 1.2 + 0.32 + Math.sin(clock * 1.6) * 0.04;
      halos.add(ex.x, ex.y + 3.86, ex.z, 1.4, gold, 0.4 + near * 0.3);
      halos.add(ex.x, ex.y + 1.4, ex.z, 3.2, gold, 0.12 + near * 0.25 + fin * 0.5);
    }

    for (const d of this.drums) {
      const hit = game.drumHit[d.i];
      d.u.uHit.value = hit;
      const sq = hit < 0.4 ? 1 - Math.sin((hit / 0.4) * Math.PI) * 0.08 * Math.exp(-hit * 4) : 1;
      d.group.scale.set(1 + (1 - sq) * 0.6, sq, 1 + (1 - sq) * 0.6);
    }

    for (const k of this.keys) {
      const v = game.keyVis[k.i];
      const b = updateKey(k, v, game.groups[lv.keys[k.i].group]);
      halos.add(k.centre.x, k.centre.y, k.centre.z, 1 + v * 0.5, k.base, 0.08 + b * 0.1);
    }

    for (const g of this.gates) {
      const v = game.gateVis[g.i];
      updateGate(g, v, clock);
      if (v > 0.05) for (const p of g.glows) halos.add(p.x, p.y, p.z, 1.1, gold, 0.22 * v);
    }

    for (const p of this.plats) {
      const body = game.platforms[p.i].body;
      p.group.position.set(body.min.x - body.delta.x * (1 - a), body.min.y - body.delta.y * (1 - a), body.min.z - body.delta.z * (1 - a));
      const gp = p.group.position;
      halos.add(gp.x + p.size.x / 2, gp.y + p.size.y - 0.55, gp.z + p.size.z / 2, 1.4, gold, 0.18);
    }

    for (const d of this.discords) {
      const s = game.discords[d.i];
      const x = s.prev.x + (s.pos.x - s.prev.x) * a;
      const y = s.prev.y + (s.pos.y - s.prev.y) * a;
      const z = s.prev.z + (s.pos.z - s.prev.z) * a;
      const j = 0.025;
      d.group.position.set(x + (Math.random() - 0.5) * j, y + (Math.random() - 0.5) * j, z + (Math.random() - 0.5) * j);
      d.shell.rotation.set(clock * 0.7 + Math.random() * 0.05, clock * 1.1, clock * 0.4);
      const pulse = 0.85 + 0.25 * Math.sin(clock * 9 + d.i) + (Math.random() - 0.5) * 0.1;
      d.core.scale.setScalar(0.27 * pulse);
      halos.add(x, y, z, 1.4, DISCORD_RED, 0.5 * pulse);
    }
  }
}
