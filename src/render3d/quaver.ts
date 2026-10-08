import * as THREE from 'three';
import { clamp, easeInOut, easeOutBack } from '../core/math';
import { PHYS, type Game } from '../game/sim';
import type { FrameInfo } from '../render/types';
import { SPRITE, spriteAtlas } from './textures';
import { col, kdamp, lerpAngle } from './util';

/**
 * Quaver on the stage: a lacquered eighth note with big eyes, stubby legs,
 * a gold flag that streams like a ponytail and a vermilion scarf. Every
 * motion is procedural and read from the simulation.
 *
 * Local frame: +x is forward, +y up. The stem rises from the back of the head
 * so the flag trails behind like a ponytail.
 */

const HEAD_Y = 0.4;
const LEG_H = 0.15;

class Chain {
  p: THREE.Vector3[] = [];
  q: THREE.Vector3[] = [];
  constructor(
    public n: number,
    public seg: number,
  ) {
    for (let i = 0; i < n; i++) {
      this.p.push(new THREE.Vector3());
      this.q.push(new THREE.Vector3());
    }
  }

  reset(anchor: THREE.Vector3, dir: THREE.Vector3): void {
    for (let i = 0; i < this.n; i++) {
      this.p[i].copy(anchor).addScaledVector(dir, i * this.seg);
      this.q[i].copy(this.p[i]);
    }
  }

  /** Verlet step with a shape memory towards `rest(i)` (unit direction of segment i). */
  step(anchor: THREE.Vector3, rest: (i: number) => THREE.Vector3, dt: number, stiff: number, grav: number, extra: (i: number, out: THREE.Vector3) => void): void {
    const tmp = new THREE.Vector3();
    const want = new THREE.Vector3();
    const f = new THREE.Vector3();
    this.p[0].copy(anchor);
    this.q[0].copy(anchor);
    const damp = Math.pow(0.04, dt);
    for (let i = 1; i < this.n; i++) {
      const p = this.p[i];
      tmp.subVectors(p, this.q[i]).multiplyScalar(damp);
      this.q[i].copy(p);
      f.set(0, -grav, 0);
      extra(i, f);
      p.add(tmp).addScaledVector(f, dt * dt);
      want.copy(this.p[i - 1]).addScaledVector(rest(i), this.seg);
      p.lerp(want, Math.min(1, stiff * dt));
    }
    for (let it = 0; it < 3; it++)
      for (let i = 1; i < this.n; i++) {
        const a = this.p[i - 1];
        const b = this.p[i];
        tmp.subVectors(b, a);
        const l = tmp.length() || 1e-5;
        b.copy(a).addScaledVector(tmp, this.seg / l);
      }
  }
}

/** A ribbon following a chain: width tapers from `w0` to `w1`, flat side across `side`. */
class Ribbon {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private nor: Float32Array;
  constructor(
    private chain: Chain,
    private w0: number,
    private w1: number,
    mat: THREE.Material,
    /** 0 centres the width on the spine, -1 hangs it below. */
    private align = 0,
  ) {
    const n = chain.n;
    this.pos = new Float32Array(n * 2 * 3);
    this.nor = new Float32Array(n * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }

  update(side: THREE.Vector3, curl = 0): void {
    const c = this.chain;
    const d = new THREE.Vector3();
    const w = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    for (let i = 0; i < c.n; i++) {
      const a = c.p[Math.max(0, i - 1)];
      const b = c.p[Math.min(c.n - 1, i + 1)];
      d.subVectors(b, a).normalize();
      w.crossVectors(d, side).normalize();
      if (w.y > 0) w.negate();
      const t = i / (c.n - 1);
      const width = this.w0 + (this.w1 - this.w0) * t;
      const off = curl * t * t + (this.align === 0 ? -width / 2 : 0);
      const p = c.p[i];
      this.pos.set([p.x + w.x * off, p.y + w.y * off, p.z + w.z * off], i * 6);
      this.pos.set([p.x + w.x * (off + width), p.y + w.y * (off + width), p.z + w.z * (off + width)], i * 6 + 3);
      nrm.crossVectors(d, w).normalize();
      this.nor.set([nrm.x, nrm.y, nrm.z, nrm.x, nrm.y, nrm.z], i * 6);
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  }
}

export class Quaver {
  readonly group = new THREE.Group();
  private root = new THREE.Group();
  private body = new THREE.Group();
  private headPivot = new THREE.Group();
  private eyes: { white: THREE.Mesh; pupil: THREE.Mesh; glint: THREE.Mesh }[] = [];
  private legs: THREE.Group[] = [];
  private stemTop = new THREE.Object3D();
  private neck = new THREE.Object3D();
  private flag: Chain;
  private scarfA: Chain;
  private scarfB: Chain;
  private ribbons: Ribbon[] = [];
  private xray: THREE.Mesh[] = [];
  private blob: THREE.Mesh;
  private yaw = 0;
  private squash = 0;
  private squashV = 0;
  private lastSinceLand = 9;
  private lastSinceJump = 9;
  private blinkAt = 2;
  private blinkT = 1;
  private pop = 1;
  private wasDead = false;
  private initialised = false;
  private lean = 0;
  private prevVel = new THREE.Vector3();
  readonly mats: { lacquer: THREE.MeshPhysicalMaterial; gold: THREE.MeshStandardMaterial; scarf: THREE.MeshPhysicalMaterial };

  constructor() {
    const lacquer = new THREE.MeshPhysicalMaterial({
      color: '#0c0b11',
      roughness: 0.32,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    });
    const white = new THREE.MeshStandardMaterial({ color: '#f8f4ea', roughness: 0.3 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: '#0a090d', roughness: 0.15 });
    const glintMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.5, 2.5) });
    const gold = new THREE.MeshStandardMaterial({ color: '#d99a2b', metalness: 1, roughness: 0.3, emissive: '#7a4a10', emissiveIntensity: 0.35, side: THREE.DoubleSide });
    const scarf = new THREE.MeshPhysicalMaterial({ color: '#c5301f', roughness: 0.62, sheen: 1, sheenColor: new THREE.Color('#ff9a7a'), sheenRoughness: 0.5, side: THREE.DoubleSide });
    this.mats = { lacquer, gold, scarf };

    this.group.add(this.root);
    this.root.add(this.body);
    this.body.add(this.headPivot);
    this.headPivot.position.set(0, HEAD_Y, 0);
    this.headPivot.rotation.z = -0.2;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 24), lacquer);
    head.scale.set(0.64, 0.5, 0.48);
    head.castShadow = true;
    this.headPivot.add(head);

    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(0.25, 0.05, side * 0.1);
      eye.rotation.y = -side * 0.42;
      eye.rotation.z = 0.22;
      const w = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), white);
      w.scale.set(0.06, 0.112, 0.088);
      const p = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), pupilMat);
      p.scale.set(0.034, 0.058, 0.046);
      p.position.set(0.04, -0.01, 0);
      const g = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), glintMat);
      g.scale.setScalar(0.014);
      g.position.set(0.07, 0.016, -side * 0.012);
      eye.add(w, p, g);
      this.headPivot.add(eye);
      this.eyes.push({ white: w, pupil: p, glint: g });
    }

    // Stem from the back of the head, gold tip.
    const stemLen = 0.64;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, stemLen, 12), lacquer);
    stem.position.set(-0.235, stemLen / 2 + 0.02, 0);
    stem.castShadow = true;
    this.headPivot.add(stem);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.024, 0.09, 12), gold);
    tip.position.set(-0.235, stemLen + 0.02, 0);
    this.headPivot.add(tip);
    this.stemTop.position.set(-0.235, stemLen + 0.04, 0);
    this.headPivot.add(this.stemTop);
    // Scarf knot.
    const knot = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.026, 8, 18), scarf);
    knot.rotation.x = Math.PI / 2;
    knot.position.set(-0.235, 0.24, 0);
    knot.castShadow = true;
    this.headPivot.add(knot);
    this.neck.position.set(-0.27, 0.24, 0);
    this.headPivot.add(this.neck);

    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(0, LEG_H + 0.04, side * 0.1);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.11, 4, 10), lacquer);
      shin.position.y = -0.09;
      shin.castShadow = true;
      const foot = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), lacquer);
      foot.scale.set(0.075, 0.04, 0.055);
      foot.position.set(0.025, -LEG_H - 0.005, 0);
      foot.castShadow = true;
      leg.add(shin, foot);
      this.root.add(leg);
      this.legs.push(leg);
    }

    this.flag = new Chain(8, 0.068);
    this.scarfA = new Chain(7, 0.06);
    this.scarfB = new Chain(6, 0.055);
    const fr = new Ribbon(this.flag, 0.17, 0.025, gold, -1);
    const sa = new Ribbon(this.scarfA, 0.07, 0.045, scarf);
    const sb = new Ribbon(this.scarfB, 0.06, 0.04, scarf);
    this.ribbons.push(fr, sa, sb);
    this.group.add(fr.mesh, sa.mesh, sb.mesh);

    // Silhouette through walls: drawn only where something hides Quaver.
    const xm = new THREE.MeshBasicMaterial({ color: '#2a2440', transparent: true, opacity: 0.45, depthFunc: THREE.GreaterDepth, depthWrite: false });
    for (const m of [head, stem]) {
      const x = new THREE.Mesh(m.geometry, xm);
      x.position.copy(m.position);
      x.scale.copy(m.scale);
      x.renderOrder = 20;
      m.parent!.add(x);
      this.xray.push(x);
    }

    // Soft contact shadow.
    const bg = new THREE.PlaneGeometry(1, 1);
    const uvs = bg.attributes.uv as THREE.BufferAttribute;
    const cell = SPRITE.dot;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, ((cell % 4) + uvs.getX(i)) / 4, 1 - (Math.floor(cell / 4) + 1 - uvs.getY(i)) / 4);
    bg.rotateX(-Math.PI / 2);
    this.blob = new THREE.Mesh(
      bg,
      new THREE.MeshBasicMaterial({ map: spriteAtlas(), color: '#000', transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    this.blob.renderOrder = 2;
    this.group.add(this.blob);
  }

  setGlow(glow: string): void {
    this.mats.gold.emissive.copy(col(glow)).multiplyScalar(0.25);
  }

  /** Called on level load so chains start at rest where Quaver stands. */
  reset(): void {
    this.initialised = false;
    this.pop = 1;
    this.wasDead = false;
    this.squash = 0;
    this.squashV = 0;
  }

  /** Feet position in simulation coordinates and an approximate centre for effects. */
  readonly feet = new THREE.Vector3();

  update(game: Game, frame: FrameInfo, sim: THREE.Object3D): void {
    const pl = game.player;
    const a = frame.alpha;
    const dt = Math.min(0.05, frame.gameDt);
    const now = frame.now;
    const t = game.time;
    this.feet.set(pl.prev.x + (pl.pos.x - pl.prev.x) * a, pl.prev.y + (pl.pos.y - pl.prev.y) * a, pl.prev.z + (pl.pos.z - pl.prev.z) * a);
    const dead = pl.dead > 0;
    if (this.wasDead && !dead) this.pop = 0;
    this.wasDead = dead;
    this.root.visible = !dead;
    for (const r of this.ribbons) r.mesh.visible = !dead;
    this.root.position.copy(this.feet);

    const speed = Math.hypot(pl.vel.x, pl.vel.z);
    const runK = clamp(speed / PHYS.run, 0, 1);
    // Facing: the travel direction, turned a little towards the audience.
    const idle = speed < 0.3 && pl.grounded;
    let target = lerpAngle(pl.heading, -Math.PI / 2, idle ? 0.45 : 0.28);
    if (game.finished) {
      const ft = t - game.finishedAt;
      const spin = easeInOut(clamp(ft / 1.1, 0, 1)) * Math.PI * 2;
      target = lerpAngle(pl.heading, -Math.PI / 2, clamp(ft / 1.1, 0, 1)) + spin;
      this.yaw = target;
    } else this.yaw = lerpAngle(this.yaw, target, kdamp(14, dt || 1 / 60));
    this.root.rotation.y = -this.yaw;

    // Squash and stretch spring: kicked by jumps and landings.
    if (pl.sinceLand < this.lastSinceLand - 1e-4 && pl.sinceLand < 0.1) this.squashV -= clamp(pl.lastImpact / 21, 0.15, 1) * 5.5;
    if (pl.sinceJump < this.lastSinceJump - 1e-4 && pl.sinceJump < 0.1) this.squashV += 4.2;
    this.lastSinceLand = pl.sinceLand;
    this.lastSinceJump = pl.sinceJump;
    if (dt > 0) {
      const acc = -190 * this.squash - 13 * this.squashV;
      this.squashV += acc * dt;
      this.squash = clamp(this.squash + this.squashV * dt, -0.38, 0.32);
    }
    const air = pl.grounded ? 0 : clamp(pl.vel.y / 32, -0.07, 0.12);
    const breath = Math.sin(now * 2.3) * 0.022 * (1 - runK) * (pl.grounded ? 1 : 0);
    const phase = (pl.walk / 0.44) * Math.PI;
    const bob = Math.abs(Math.sin(phase)) * 0.055 * runK * (pl.grounded ? 1 : 0);
    const stepSquash = -Math.cos(phase * 2) * 0.035 * runK * (pl.grounded ? 1 : 0);
    let sy = 1 + this.squash + air + breath + stepSquash;
    let hop = 0;
    if (game.finished) {
      const ft = t - game.finishedAt;
      hop = ft < 0.7 ? Math.sin((ft / 0.7) * Math.PI) * 0.35 : Math.abs(Math.sin((ft - 0.7) * 3.2)) * 0.06;
      sy += ft < 0.7 ? 0.08 : 0;
    }
    const popS = this.pop < 1 ? easeOutBack(this.pop) : 1;
    if (this.pop < 1) this.pop = Math.min(1, this.pop + (frame.dt || 0.016) * 3.2);
    const sxz = 1 / Math.sqrt(Math.max(0.4, sy));
    this.body.scale.set(sxz * popS, sy * popS, sxz * popS);
    this.body.position.y = bob + hop;

    // Lean into acceleration and speed.
    const ax = dt > 0 ? (pl.vel.x - this.prevVel.x) / dt : 0;
    const az = dt > 0 ? (pl.vel.z - this.prevVel.z) / dt : 0;
    this.prevVel.set(pl.vel.x, pl.vel.y, pl.vel.z);
    const fwdAcc = ax * Math.cos(this.yaw) + az * Math.sin(this.yaw);
    const leanT = -runK * 0.14 - clamp(fwdAcc / 120, -0.12, 0.12);
    this.lean += (leanT - this.lean) * kdamp(10, dt || 1 / 60);
    this.headPivot.rotation.z = -0.2 + this.lean + (pl.grounded ? 0 : clamp(-pl.vel.y * 0.006, -0.1, 0.12));

    // Legs: stride on the ground, tuck while rising, dangle while falling.
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i];
      const s = i === 0 ? 1 : -1;
      let ang = Math.sin(phase) * 0.85 * runK * s;
      if (!pl.grounded) ang = pl.vel.y > 0 ? 0.5 * s * 0.3 + 0.35 : -0.25 + Math.sin(now * 14 + i) * 0.12;
      if (game.finished) ang = Math.sin(now * 10 + i * 3) * 0.3;
      leg.rotation.z = ang;
      leg.position.y = LEG_H + 0.04 + (pl.grounded ? Math.max(0, Math.sin(phase + (i ? Math.PI : 0))) * 0.05 * runK : 0.03);
      leg.scale.setScalar(popS);
    }

    // Blinks and gaze.
    this.blinkT += frame.dt;
    if (now > this.blinkAt) {
      this.blinkT = 0;
      this.blinkAt = now + 1.8 + Math.random() * 3.4;
    }
    const blink = this.blinkT < 0.13 ? 1 - Math.sin((this.blinkT / 0.13) * Math.PI) : 1;
    const happy = game.finished ? 0.4 : 1;
    const wide = !pl.grounded && pl.vel.y < -8 ? 1.12 : 1;
    for (const e of this.eyes) {
      e.white.scale.y = 0.112 * Math.max(0.08, blink * happy) * wide;
      e.pupil.scale.y = 0.058 * Math.max(0.05, blink * happy);
      e.glint.visible = blink > 0.5;
      e.pupil.position.y = -0.01 + clamp(pl.vel.y * 0.0015, -0.02, 0.02);
      e.pupil.position.z = 0;
    }

    // Contact shadow on whatever is below.
    const gy = this.groundBelow(game, this.feet);
    const hgt = Math.max(0, this.feet.y - gy);
    this.blob.visible = !dead && gy > -50;
    this.blob.position.set(this.feet.x, gy + 0.02, this.feet.z);
    const bs = (0.75 - Math.min(0.35, hgt * 0.08)) * popS;
    this.blob.scale.set(bs, 1, bs * 0.85);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.42 * Math.max(0, 1 - hgt / 6);

    // Flag and scarf chains in simulation space.
    this.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(sim.matrixWorld).invert();
    const top = this.stemTop.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const neck = this.neck.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const fwd = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const side = new THREE.Vector3(-Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (!this.initialised || dead) {
      const back = fwd.clone().multiplyScalar(-1);
      this.flag.reset(top, back.clone().add(new THREE.Vector3(0, -0.6, 0)).normalize());
      this.scarfA.reset(neck, back.clone().add(new THREE.Vector3(0, -0.8, 0)).normalize());
      this.scarfB.reset(neck, back.clone().add(new THREE.Vector3(0, -1, 0.2)).normalize());
      this.initialised = true;
    }
    if (dt > 0) {
      // The flag curls like a ponytail: out and back from the stem top, then down.
      const flutter = now * 9;
      const fr: THREE.Vector3[] = [];
      for (let i = 0; i < this.flag.n; i++) {
        const k = i / (this.flag.n - 1);
        const ang = 0.45 - k * 1.9;
        fr.push(fwd.clone().multiplyScalar(-Math.cos(ang)).add(new THREE.Vector3(0, Math.sin(ang), 0)).normalize());
      }
      this.flag.step(top, (i) => fr[i], dt, 18, 3, (i, f) => {
        f.addScaledVector(side, Math.sin(flutter + i * 0.9) * 4 * (0.3 + runK));
        f.y += Math.sin(flutter * 0.7 + i) * 3 * runK;
      });
      const scarfRest = fwd.clone().multiplyScalar(-0.5).add(new THREE.Vector3(0, -0.85, 0)).normalize();
      const scarfRestB = scarfRest.clone().add(side.clone().multiplyScalar(0.3)).normalize();
      this.scarfA.step(neck, () => scarfRest, dt, 5, 9, (i, f) => f.addScaledVector(side, Math.sin(now * 7 + i * 0.8) * 3 * (0.2 + runK)));
      this.scarfB.step(neck, () => scarfRestB, dt, 5, 9, (i, f) => f.addScaledVector(side, Math.cos(now * 6 + i) * 3 * (0.2 + runK)));
    }
    // Keep the flag broad side facing across the body.
    this.ribbons[0].update(side, 0);
    this.ribbons[1].update(side);
    this.ribbons[2].update(side);
    for (const x of this.xray) x.visible = !dead;
  }

  /** Height of the first solid surface under a point (voxels and solid bodies). */
  private groundBelow(game: Game, p: THREE.Vector3): number {
    const lv = game.level;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    let best = -99;
    if (x >= 0 && x < lv.w && z >= 0 && z < lv.d) {
      for (let y = Math.min(lv.h - 1, Math.floor(p.y + 0.05)); y >= 0; y--) {
        const m = lv.cells[x + lv.w * (y + lv.h * z)];
        if (m !== 0 && m !== 8) {
          best = y + 1;
          break;
        }
      }
    }
    for (const b of game.bodies) {
      if (!b.solid) continue;
      if (p.x < b.min.x || p.x > b.max.x || p.z < b.min.z || p.z > b.max.z) continue;
      if (b.max.y <= p.y + 0.05 && b.max.y > best) best = b.max.y;
    }
    return best;
  }
}
