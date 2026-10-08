import { clamp, v3, type Vec3 } from '../core/math';
import { NO_DEPTH, type Level } from './level';
import { MAT, isSolidMat, type Mode, type SignDef } from './types';

/**
 * The deterministic game simulation. It knows nothing about rendering.
 *
 * Two rule sets share one world:
 * - On the Stage (3D) the player moves in x and z and collides with real voxels.
 * - On the Score (2D) depth collapses: a column (x, y) is solid if any voxel in it
 *   is solid, so things that line up on the page connect. The player keeps a depth
 *   anyway; whenever they stand on something, their depth moves to that thing's
 *   depth so switching back to 3D leaves them standing on it.
 * - If the player switches to 2D while inside a column that is solid at another
 *   depth (they walked behind a pillar), they are "embedded": they keep moving with
 *   3D collision at their own depth until they step clear. A switch never traps,
 *   kills or moves the player.
 */

export const PLAYER = { hw: 0.3, h: 0.86, hd: 0.3 } as const;
export const PHYS = {
  gravity: 40,
  fallMul: 1.28,
  apexMul: 0.62,
  apexBand: 2.4,
  jumpV: 14.7,
  jumpCut: 0.5,
  maxFall: 21,
  run: 6.1,
  accelGround: 62,
  accelAir: 38,
  decelGround: 75,
  coyote: 0.1,
  buffer: 0.13,
  killY: -5,
  stepEvery: 0.66,
} as const;

const EPS = 1e-4;
const DT_MAX = 1 / 60;

export interface InputFrame {
  moveX: number;
  moveZ: number;
  jumpHeld: boolean;
  jumpPressed: boolean;
  switchPressed: boolean;
}

export const NO_INPUT: InputFrame = { moveX: 0, moveZ: 0, jumpHeld: false, jumpPressed: false, switchPressed: false };

export type BodyKind = 'platform' | 'gate' | 'drum';

export interface Body {
  kind: BodyKind;
  /** Index into the matching def list. */
  id: number;
  min: Vec3;
  max: Vec3;
  /** How far the body moved this step. */
  delta: Vec3;
  solid: boolean;
}

export interface SupportRef {
  kind: 'world' | BodyKind;
  id: number;
}

export type GameEvent =
  | { t: 'jump'; mode: Mode }
  | { t: 'land'; impact: number; mode: Mode; surface: number }
  | { t: 'step'; mode: Mode; surface: number }
  | { t: 'note'; id: number; count: number; total: number }
  | { t: 'checkpoint'; id: number }
  | { t: 'death'; cause: 'thorn' | 'discord' | 'fall'; pos: Vec3 }
  | { t: 'respawn' }
  | { t: 'switch'; mode: Mode; embedded: boolean }
  | { t: 'bounce'; id: number }
  | { t: 'key'; id: number; group: number; on: boolean }
  | { t: 'gate'; group: number; on: boolean }
  | { t: 'exit' }
  | { t: 'bonk' };

export interface PlayerState {
  pos: Vec3;
  prev: Vec3;
  vel: Vec3;
  /** -1 or 1, the way the player faces on the page. */
  facing: number;
  /** Heading in radians on the stage (0 faces +x). */
  heading: number;
  grounded: boolean;
  coyote: number;
  buffer: number;
  jumpCut: boolean;
  /** Seconds since the last jump started (large when not jumping). */
  sinceJump: number;
  sinceLand: number;
  lastImpact: number;
  support: SupportRef | null;
  supportMat: number;
  embedded: boolean;
  /** Death timer: 0 while alive, counts down to respawn. */
  dead: number;
  stepAcc: number;
  /** Distance walked, for animation phase. */
  walk: number;
}

export interface PlatformState {
  clock: number;
  body: Body;
}

export interface DiscordState {
  pos: Vec3;
  prev: Vec3;
  /** Direction of travel along x/z, for facing. */
  dir: Vec3;
}

export interface CheckpointSnapshot {
  pos: Vec3;
  groups: boolean[];
}

export const DEATH_TIME = 0.95;

export class Game {
  readonly level: Level;
  mode: Mode = '3d';
  time = 0;
  player: PlayerState;
  bodies: Body[] = [];
  platforms: PlatformState[] = [];
  gateBodies: Body[] = [];
  drumBodies: Body[] = [];
  discords: DiscordState[] = [];
  groups: boolean[] = [];
  /** 0..1 eased visual state per gate (1 = solid). */
  gateVis: number[] = [];
  /** Seconds since each drum last bounced someone. */
  drumHit: number[] = [];
  /** 0..1 how far each key is pressed. */
  keyVis: number[] = [];
  keyDown: boolean[] = [];
  notesTaken: boolean[];
  noteTakenAt: number[];
  checkpointOn = -1;
  checkpointAt: number[];
  respawn: CheckpointSnapshot;
  deaths = 0;
  switches = 0;
  finished = false;
  finishedAt = 0;
  activeSign: SignDef | null = null;
  events: GameEvent[] = [];
  /** Wall clock of the level in seconds of game time, excluding the intro. */
  playTime = 0;

  constructor(level: Level, startMode: Mode = '3d') {
    this.level = level;
    this.mode = startMode;
    const s = level.spawn;
    this.player = {
      pos: v3(s.x, s.y, s.z),
      prev: v3(s.x, s.y, s.z),
      vel: v3(),
      facing: 1,
      heading: 0,
      grounded: false,
      coyote: 0,
      buffer: 0,
      jumpCut: false,
      sinceJump: 9,
      sinceLand: 9,
      lastImpact: 0,
      support: null,
      supportMat: MAT.stone,
      embedded: false,
      dead: 0,
      stepAcc: 0,
      walk: 0,
    };
    const maxGroup = Math.max(
      0,
      ...level.keys.map((k) => k.group),
      ...level.gates.map((g) => g.group),
      ...level.platforms.map((p) => p.group ?? 0),
    );
    this.groups = Array.from({ length: maxGroup + 1 }, (_, i) => level.groupsOn.includes(i));
    for (const p of level.platforms) {
      const body: Body = {
        kind: 'platform',
        id: p.id,
        min: v3(p.path[0].x, p.path[0].y, p.path[0].z),
        max: v3(p.path[0].x + p.size.x, p.path[0].y + p.size.y, p.path[0].z + p.size.z),
        delta: v3(),
        solid: true,
      };
      const st: PlatformState = { clock: p.phase, body };
      this.platforms.push(st);
      this.bodies.push(body);
      this.placePlatform(st);
      body.delta = v3();
    }
    for (const g of level.gates) {
      const solid = this.groups[g.group] === g.solidWhenOn;
      const body: Body = { kind: 'gate', id: g.id, min: { ...g.min }, max: { ...g.max }, delta: v3(), solid };
      this.gateBodies.push(body);
      this.bodies.push(body);
      this.gateVis.push(solid ? 1 : 0);
    }
    for (const d of level.drums) {
      const body: Body = {
        kind: 'drum',
        id: d.id,
        min: v3(d.pos.x + 0.06, d.pos.y, d.pos.z + 0.06),
        max: v3(d.pos.x + 0.94, d.pos.y + 0.72, d.pos.z + 0.94),
        delta: v3(),
        solid: true,
      };
      this.drumBodies.push(body);
      this.bodies.push(body);
      this.drumHit.push(9);
    }
    for (let i = 0; i < level.keys.length; i++) {
      this.keyVis.push(0);
      this.keyDown.push(false);
    }
    for (const d of level.discords) {
      const p = v3(d.path[0].x, d.path[0].y, d.path[0].z);
      this.discords.push({ pos: p, prev: { ...p }, dir: v3(1, 0, 0) });
    }
    this.updateDiscords(0);
    for (const ds of this.discords) ds.prev = { ...ds.pos };
    this.notesTaken = level.notes.map(() => false);
    this.noteTakenAt = level.notes.map(() => -1);
    this.checkpointAt = level.checkpoints.map(() => -1);
    this.respawn = { pos: { ...s }, groups: [...this.groups] };
    this.settle();
  }

  get notesCount(): number {
    return this.notesTaken.filter(Boolean).length;
  }

  /** Drops the player onto whatever is under the spawn point. */
  private settle(): void {
    for (let i = 0; i < 240 && !this.player.grounded; i++) this.physics(1 / 120, NO_INPUT);
    this.player.prev = { ...this.player.pos };
    this.player.sinceLand = 9;
    this.events.length = 0;
  }

  /** Switches the rules between the page and the stage. Never moves the player. */
  toggleMode(): void {
    if (this.player.dead > 0 || this.finished) return;
    this.mode = this.mode === '3d' ? '2d' : '3d';
    this.switches++;
    const pl = this.player;
    pl.vel.z = 0;
    if (this.mode === '2d') {
      pl.embedded = this.overlapsAny('proj', pl.pos, null);
    } else {
      pl.embedded = false;
    }
    this.events.push({ t: 'switch', mode: this.mode, embedded: pl.embedded });
  }

  step(dt: number, input: InputFrame): void {
    dt = Math.min(dt, DT_MAX);
    this.time += dt;
    if (!this.finished) this.playTime += dt;
    const pl = this.player;
    pl.prev = { ...pl.pos };
    for (const d of this.discords) d.prev = { ...d.pos };

    if (input.switchPressed) this.toggleMode();

    this.updateGroupsVisuals(dt);
    this.updatePlatforms(dt);
    this.updateDiscords(dt);
    for (let i = 0; i < this.drumHit.length; i++) this.drumHit[i] += dt;

    if (pl.dead > 0) {
      pl.dead -= dt;
      if (pl.dead <= 0) this.doRespawn();
      return;
    }
    if (this.finished) {
      // Walk into the arch.
      const ex = this.level.exit.pos;
      pl.vel.x = clamp((ex.x - pl.pos.x) * 4, -2, 2);
      pl.vel.z = clamp((ex.z - pl.pos.z) * 4, -2, 2);
      pl.pos.x += pl.vel.x * dt;
      pl.pos.z += pl.vel.z * dt;
      if (Math.abs(pl.vel.x) > 0.05) pl.facing = Math.sign(pl.vel.x);
      pl.walk += Math.hypot(pl.vel.x, pl.vel.z) * dt;
      return;
    }

    this.carryAndPush();
    this.physics(dt, input);
    this.interact(dt);
  }

  // ---------------------------------------------------------------- moving things

  private updateGroupsVisuals(dt: number): void {
    const pl = this.player;
    for (let i = 0; i < this.gateBodies.length; i++) {
      const g = this.level.gates[i];
      const body = this.gateBodies[i];
      const want = this.groups[g.group] === g.solidWhenOn;
      if (want && !body.solid) {
        // Wait for the player to step clear before closing.
        if (!overlap3(pl.pos, body)) body.solid = true;
      } else if (!want && body.solid) body.solid = false;
      const target = body.solid ? 1 : want ? 0.35 : 0;
      this.gateVis[i] += clamp(target - this.gateVis[i], -dt * 5, dt * 5);
    }
    for (let i = 0; i < this.keyVis.length; i++) {
      const target = this.keyDown[i] ? 1 : 0;
      this.keyVis[i] += clamp(target - this.keyVis[i], -dt * 9, dt * 14);
    }
  }

  private placePlatform(st: PlatformState): void {
    const def = this.level.platforms[st.body.id];
    const p = pathPosition(def.path, def.speed, def.pause, def.loop, st.clock);
    const b = st.body;
    b.delta = v3(p.x - b.min.x, p.y - b.min.y, p.z - b.min.z);
    b.min = v3(p.x, p.y, p.z);
    b.max = v3(p.x + def.size.x, p.y + def.size.y, p.z + def.size.z);
  }

  private updatePlatforms(dt: number): void {
    for (const st of this.platforms) {
      const def = this.level.platforms[st.body.id];
      const active = def.group === undefined || this.groups[def.group];
      if (active) st.clock += dt;
      this.placePlatform(st);
    }
  }

  private updateDiscords(dt: number): void {
    void dt;
    for (let i = 0; i < this.discords.length; i++) {
      const def = this.level.discords[i];
      const d = this.discords[i];
      const p = pathPosition(def.path, def.speed, 0.35, false, this.time + def.phase);
      const dx = p.x - d.pos.x;
      const dz = p.z - d.pos.z;
      if (Math.abs(dx) + Math.abs(dz) > 1e-6) d.dir = v3(Math.sign(dx), 0, Math.sign(dz));
      d.pos = p;
    }
  }

  /** Riders move with their platform; anything a platform runs into is shoved. */
  private carryAndPush(): void {
    const pl = this.player;
    const sup = pl.support;
    if (sup && sup.kind === 'platform') {
      const b = this.platforms[sup.id].body;
      const d = b.delta;
      if (d.x !== 0 || d.y !== 0 || d.z !== 0) {
        const geo = this.geo();
        // Up first so a rising platform never drags the rider through a ledge.
        if (d.y > 0) this.moveAxis(geo, 'y', d.y, b, null);
        this.moveAxis(geo, 'x', d.x, b, null);
        if (this.mode === '3d' || pl.embedded) this.moveAxis(geo, 'z', d.z, b, null);
        else pl.pos.z += d.z;
        if (d.y < 0) this.moveAxis(geo, 'y', d.y, b, null);
      }
    }
    for (const st of this.platforms) {
      const b = st.body;
      if (sup && sup.kind === 'platform' && sup.id === b.id) continue;
      if (!overlap3(pl.pos, b)) continue;
      // Shove along the platform's motion, then let the escape rule handle anything left.
      const geo = this.geo();
      if (b.delta.x !== 0) this.moveAxis(geo, 'x', b.delta.x, b, null);
      if (b.delta.z !== 0 && (this.mode === '3d' || pl.embedded)) this.moveAxis(geo, 'z', b.delta.z, b, null);
      if (b.delta.y > 0 && pl.pos.y > b.min.y) {
        pl.pos.y = b.max.y;
        pl.vel.y = Math.max(pl.vel.y, 0);
      }
    }
  }

  // ---------------------------------------------------------------- player physics

  /** Which collision geometry applies to the player right now. */
  private geo(): Geo {
    if (this.mode === '3d') return '3d';
    return this.player.embedded ? '3d' : 'proj';
  }

  private physics(dt: number, input: InputFrame): void {
    const pl = this.player;
    if (this.mode === '2d') pl.embedded = this.overlapsAny('proj', pl.pos, null);
    const geo = this.geo();

    // Horizontal intent.
    let mx = clamp(input.moveX, -1, 1);
    let mz = this.mode === '3d' ? clamp(input.moveZ, -1, 1) : 0;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
    }
    const tx = mx * PHYS.run;
    const tz = mz * PHYS.run;
    const accel = pl.grounded ? (mag > 0.05 ? PHYS.accelGround : PHYS.decelGround) : PHYS.accelAir;
    pl.vel.x = approachV(pl.vel.x, tx, accel * dt);
    pl.vel.z = this.mode === '3d' ? approachV(pl.vel.z, tz, accel * dt) : 0;
    if (Math.abs(mx) > 0.2) pl.facing = Math.sign(mx);
    if (this.mode === '3d' && Math.hypot(pl.vel.x, pl.vel.z) > 0.4) pl.heading = Math.atan2(pl.vel.z, pl.vel.x);
    else if (this.mode === '2d') pl.heading = pl.facing > 0 ? 0 : Math.PI;

    // Jumping.
    pl.sinceJump += dt;
    pl.sinceLand += dt;
    if (input.jumpPressed) pl.buffer = PHYS.buffer;
    else pl.buffer = Math.max(0, pl.buffer - dt);
    if (pl.grounded) pl.coyote = PHYS.coyote;
    else pl.coyote = Math.max(0, pl.coyote - dt);
    if (pl.buffer > 0 && pl.coyote > 0) {
      pl.vel.y = PHYS.jumpV;
      pl.grounded = false;
      pl.coyote = 0;
      pl.buffer = 0;
      pl.jumpCut = false;
      pl.sinceJump = 0;
      pl.support = null;
      this.events.push({ t: 'jump', mode: this.mode });
    }
    if (!input.jumpHeld && pl.vel.y > 0 && !pl.jumpCut && pl.sinceJump > 0.07 && pl.sinceJump < 0.6) {
      pl.vel.y *= PHYS.jumpCut;
      pl.jumpCut = true;
    }

    // Gravity with a softer apex while the button is held.
    let g = PHYS.gravity;
    if (pl.vel.y < 0) g *= PHYS.fallMul;
    else if (input.jumpHeld && Math.abs(pl.vel.y) < PHYS.apexBand) g *= PHYS.apexMul;
    pl.vel.y = Math.max(pl.vel.y - g * dt, -PHYS.maxFall);

    const wasGrounded = pl.grounded;
    const fallSpeed = -pl.vel.y;

    // Move one axis at a time.
    const hitX = this.moveAxis(geo, 'x', pl.vel.x * dt, null, null);
    if (hitX) pl.vel.x = 0;
    if (this.mode === '3d' || pl.embedded) {
      const hitZ = this.moveAxis(geo, 'z', pl.vel.z * dt, null, null);
      if (hitZ) pl.vel.z = 0;
    }
    const supports: Support[] = [];
    const hitY = this.moveAxis(geo, 'y', pl.vel.y * dt, null, supports);
    if (hitY) {
      if (pl.vel.y > 0) {
        pl.vel.y = 0;
        this.events.push({ t: 'bonk' });
      } else pl.vel.y = 0;
    }
    pl.grounded = hitY && supports.length > 0;

    if (pl.grounded) {
      const chosen = this.chooseSupport(supports, geo);
      pl.support = chosen ? { kind: chosen.kind, id: chosen.id } : null;
      pl.supportMat = chosen?.mat ?? MAT.stone;
      if (!wasGrounded) {
        pl.sinceLand = 0;
        pl.lastImpact = fallSpeed;
        this.events.push({ t: 'land', impact: fallSpeed, mode: this.mode, surface: pl.supportMat });
      }
      // Drums bounce whoever lands on them.
      if (chosen && chosen.kind === 'drum') {
        const def = this.level.drums[chosen.id];
        pl.vel.y = Math.sqrt(2 * PHYS.gravity * def.power);
        pl.grounded = false;
        pl.coyote = 0;
        pl.jumpCut = true;
        pl.sinceJump = 0;
        pl.support = null;
        this.drumHit[chosen.id] = 0;
        this.events.push({ t: 'bounce', id: chosen.id });
      }
      const speed = Math.hypot(pl.vel.x, pl.vel.z);
      pl.stepAcc += speed * dt;
      if (pl.stepAcc > PHYS.stepEvery) {
        pl.stepAcc -= PHYS.stepEvery;
        this.events.push({ t: 'step', mode: this.mode, surface: pl.supportMat });
      }
    } else {
      pl.support = null;
      pl.stepAcc = PHYS.stepEvery * 0.7;
    }
    pl.walk += Math.hypot(pl.pos.x - pl.prev.x, pl.pos.z - pl.prev.z);

    this.updateKeys();
  }

  /**
   * Picks what the player stands on. On the stage that is a body if any, else the world.
   * On the page it also decides the player's depth: keep the current depth if it is
   * still supported, otherwise move to the nearest supported depth (front wins ties).
   */
  private chooseSupport(supports: Support[], geo: Geo): Support | null {
    const pl = this.player;
    if (supports.length === 0) return null;
    const zLo = pl.pos.z - PLAYER.hd;
    const zHi = pl.pos.z + PLAYER.hd;
    if (geo === '3d') {
      // Every support already overlaps the player's depth.
      return supports.find((s) => s.kind === 'drum') ?? supports.find((s) => s.kind === 'platform') ?? supports[0];
    }
    const drum = nearestByDepth(supports.filter((s) => s.kind === 'drum'), pl.pos.z);
    let chosen: Support | null = drum;
    if (!chosen) {
      const here = supports.filter((s) => s.z1 > zLo + EPS && s.z0 < zHi - EPS);
      chosen = here.find((s) => s.kind === 'platform') ?? here[0] ?? nearestByDepth(supports, pl.pos.z);
    }
    if (!chosen) return null;
    if (!(chosen.z1 > zLo + EPS && chosen.z0 < zHi - EPS)) {
      const span = chosen.z1 - chosen.z0;
      const nz =
        span >= PLAYER.hd * 2
          ? clamp(pl.pos.z, chosen.z0 + PLAYER.hd, chosen.z1 - PLAYER.hd)
          : (chosen.z0 + chosen.z1) / 2;
      pl.pos.z = nz;
    }
    return chosen;
  }

  private updateKeys(): void {
    const pl = this.player;
    const lv = this.level;
    for (let i = 0; i < lv.keys.length; i++) {
      const k = lv.keys[i];
      let on = false;
      if (pl.grounded && Math.abs(pl.pos.y - k.pos.y) < 0.02) {
        const xOver = pl.pos.x + PLAYER.hw > k.pos.x + 0.08 && pl.pos.x - PLAYER.hw < k.pos.x + k.width - 0.08;
        if (xOver) {
          if (this.geo() === '3d') {
            on = pl.pos.z + PLAYER.hd > k.pos.z + 0.08 && pl.pos.z - PLAYER.hd < k.pos.z + 0.92;
          } else {
            on = true;
            // On the page, stepping on a key takes you to its depth.
            if (solidAt3(lv, Math.floor(clamp(pl.pos.x, k.pos.x, k.pos.x + k.width - 0.01)), k.pos.y - 1, k.pos.z))
              pl.pos.z = k.pos.z + 0.5;
          }
        }
      }
      if (on && !this.keyDown[i]) {
        this.groups[k.group] = !this.groups[k.group];
        this.events.push({ t: 'key', id: i, group: k.group, on: this.groups[k.group] });
        this.events.push({ t: 'gate', group: k.group, on: this.groups[k.group] });
      }
      this.keyDown[i] = on;
    }
  }

  // ---------------------------------------------------------------- interactions

  private interact(dt: number): void {
    void dt;
    const pl = this.player;
    const lv = this.level;
    const flat = this.mode === '2d';
    const pc = v3(pl.pos.x, pl.pos.y + PLAYER.h / 2, pl.pos.z);

    for (let i = 0; i < lv.notes.length; i++) {
      if (this.notesTaken[i]) continue;
      const n = lv.notes[i].pos;
      const dx = Math.abs(n.x - pc.x) - PLAYER.hw;
      const dy = Math.abs(n.y - pc.y) - PLAYER.h / 2;
      const dz = flat ? -1 : Math.abs(n.z - pc.z) - PLAYER.hd;
      if (dx < 0.38 && dy < 0.38 && dz < 0.38) {
        this.notesTaken[i] = true;
        this.noteTakenAt[i] = this.time;
        this.events.push({ t: 'note', id: i, count: this.notesCount, total: lv.notes.length });
      }
    }

    for (let i = 0; i < lv.checkpoints.length; i++) {
      const c = lv.checkpoints[i].pos;
      const near =
        Math.abs(c.x - pl.pos.x) < 0.75 &&
        pl.pos.y >= c.y - 0.2 &&
        pl.pos.y < c.y + 2 &&
        (flat || Math.abs(c.z - pl.pos.z) < 0.9);
      if (near && this.checkpointOn !== i) {
        const forward = this.checkpointOn < 0 || i > this.checkpointOn || this.checkpointAt[i] < 0;
        if (forward) {
          this.checkpointOn = i;
          this.checkpointAt[i] = this.time;
          this.respawn = { pos: { ...c }, groups: [...this.groups] };
          this.events.push({ t: 'checkpoint', id: i });
        }
      }
    }

    // Exit arch.
    const ex = lv.exit.pos;
    if (
      Math.abs(ex.x - pl.pos.x) < 0.7 &&
      pl.pos.y >= ex.y - 0.3 &&
      pl.pos.y < ex.y + 2.2 &&
      (flat || Math.abs(ex.z - pl.pos.z) < 1.0)
    ) {
      this.finished = true;
      this.finishedAt = this.time;
      pl.vel.y = 0;
      this.events.push({ t: 'exit' });
      return;
    }

    // Hazards.
    if (pl.pos.y < PHYS.killY) return this.die('fall');
    if (this.touchesThorns()) return this.die('thorn');
    for (const d of this.discords) {
      const dx = Math.abs(d.pos.x - pc.x) - PLAYER.hw;
      const dy = Math.abs(d.pos.y - pc.y) - PLAYER.h / 2;
      const dz = flat ? -1 : Math.abs(d.pos.z - pc.z) - PLAYER.hd;
      if (dx < 0.3 && dy < 0.3 && dz < 0.3) return this.die('discord');
    }

    // Hints.
    this.activeSign = null;
    for (const s of lv.signs) {
      if (s.mode && s.mode !== this.mode) continue;
      if (
        Math.abs(s.pos.x - pl.pos.x) < s.radius &&
        pl.pos.y > s.pos.y - 1.5 &&
        pl.pos.y < s.pos.y + 3 &&
        (flat || Math.abs(s.pos.z - pl.pos.z) < s.radius + 2)
      ) {
        this.activeSign = s;
        break;
      }
    }
  }

  private touchesThorns(): boolean {
    const pl = this.player;
    const lv = this.level;
    const inset = 0.16;
    const x0 = Math.floor(pl.pos.x - PLAYER.hw + inset);
    const x1 = Math.floor(pl.pos.x + PLAYER.hw - inset);
    const y0 = Math.floor(pl.pos.y + inset);
    const y1 = Math.floor(pl.pos.y + PLAYER.h - inset);
    const geo = this.geo();
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) continue;
        if (geo === 'proj') {
          if (lv.thornCol[x + lv.w * y]) return true;
        } else {
          const z0 = Math.floor(pl.pos.z - PLAYER.hd + inset);
          const z1 = Math.floor(pl.pos.z + PLAYER.hd - inset);
          for (let z = z0; z <= z1; z++)
            if (z >= 0 && z < lv.d && lv.cells[x + lv.w * (y + lv.h * z)] === MAT.thorn) return true;
        }
      }
    return false;
  }

  private die(cause: 'thorn' | 'discord' | 'fall'): void {
    const pl = this.player;
    pl.dead = DEATH_TIME;
    pl.vel = v3();
    this.deaths++;
    this.events.push({ t: 'death', cause, pos: { ...pl.pos } });
  }

  /** Sends the player back to the last metronome without counting a death. */
  returnToCheckpoint(): void {
    if (this.finished) return;
    this.doRespawn();
  }

  private doRespawn(): void {
    const pl = this.player;
    const r = this.respawn;
    pl.dead = 0;
    pl.pos = { ...r.pos };
    pl.prev = { ...r.pos };
    pl.vel = v3();
    pl.grounded = false;
    pl.support = null;
    pl.buffer = 0;
    pl.coyote = 0;
    this.groups = [...r.groups];
    for (let i = 0; i < this.gateBodies.length; i++) {
      const g = this.level.gates[i];
      const want = this.groups[g.group] === g.solidWhenOn;
      this.gateBodies[i].solid = want && !overlap3(pl.pos, this.gateBodies[i]);
    }
    if (this.mode === '2d') pl.embedded = this.overlapsAny('proj', pl.pos, null);
    for (let i = 0; i < 30 && !pl.grounded; i++) this.physics(1 / 120, NO_INPUT);
    pl.prev = { ...pl.pos };
    pl.sinceLand = 9;
    this.events = this.events.filter((e) => e.t !== 'land' && e.t !== 'step');
    this.events.push({ t: 'respawn' });
  }

  // ---------------------------------------------------------------- collision core

  /** True if the player box at `pos` overlaps anything solid in the given geometry. */
  overlapsAny(geo: Geo, pos: Vec3, ignore: Body | null): boolean {
    let hit = false;
    const box = playerBox(pos);
    this.forEachSolid(geo, box, ignore, (b) => {
      if (boxOverlap(box, b, geo)) hit = true;
    });
    return hit;
  }

  /**
   * Moves the player along one axis and stops at the first solid face. Solids the
   * player already overlapped before the move are ignored so nothing can trap them.
   * Returns true if something was hit. Downward hits are reported in `supports`.
   */
  private moveAxis(geo: Geo, axis: 'x' | 'y' | 'z', d: number, ignore: Body | null, supports: Support[] | null): boolean {
    if (d === 0) return false;
    const pl = this.player;
    const pre = playerBox(pl.pos);
    pl.pos[axis] += d;
    const post = playerBox(pl.pos);
    const sweep: Box6 = {
      x0: Math.min(pre.x0, post.x0),
      y0: Math.min(pre.y0, post.y0),
      z0: Math.min(pre.z0, post.z0),
      x1: Math.max(pre.x1, post.x1),
      y1: Math.max(pre.y1, post.y1),
      z1: Math.max(pre.z1, post.z1),
    };
    let limit = d > 0 ? Infinity : -Infinity;
    let hit = false;
    const hits: Support[] = [];
    this.forEachSolid(geo, sweep, ignore, (b) => {
      if (!boxOverlap(post, b, geo)) return;
      if (boxOverlap(pre, b, geo)) return;
      hit = true;
      if (d > 0) {
        const face = axis === 'x' ? b.x0 : axis === 'y' ? b.y0 : b.z0;
        if (face < limit) limit = face;
      } else {
        const face = axis === 'x' ? b.x1 : axis === 'y' ? b.y1 : b.z1;
        if (face > limit) limit = face;
        if (axis === 'y' && supports) hits.push({ ...b.src, top: b.y1, z0: b.z0, z1: b.z1 });
      }
    });
    if (!hit) return false;
    if (axis === 'x') pl.pos.x = d > 0 ? limit - PLAYER.hw - EPS : limit + PLAYER.hw + EPS;
    else if (axis === 'z') pl.pos.z = d > 0 ? limit - PLAYER.hd - EPS : limit + PLAYER.hd + EPS;
    else pl.pos.y = d > 0 ? limit - PLAYER.h - EPS : limit + EPS;
    if (supports && d <= 0) for (const s of hits) if (Math.abs(s.top - limit) < 1e-3) supports.push(s);
    return true;
  }

  /** Calls `cb` for every solid box near `box`: voxel cells (or columns) and bodies. */
  private forEachSolid(geo: Geo, box: Box6, ignore: Body | null, cb: (b: SolidBox) => void): void {
    const lv = this.level;
    const x0 = Math.max(0, Math.floor(box.x0 + EPS));
    const x1 = Math.min(lv.w - 1, Math.floor(box.x1 - EPS));
    const y0 = Math.max(0, Math.floor(box.y0 + EPS));
    const y1 = Math.min(lv.h - 1, Math.floor(box.y1 - EPS));
    if (geo === 'proj') {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const fz = lv.front[x + lv.w * y];
          if (fz === NO_DEPTH) continue;
          // One callback per solid depth so the page knows every depth it could land on.
          for (let z = fz; z < lv.d; z++) {
            const m = lv.cells[x + lv.w * (y + lv.h * z)];
            if (!isSolidMat(m)) continue;
            cb({ x0: x, y0: y, z0: z, x1: x + 1, y1: y + 1, z1: z + 1, src: { kind: 'world', id: 0, mat: m } });
          }
        }
    } else {
      const z0 = Math.max(0, Math.floor(box.z0 + EPS));
      const z1 = Math.min(lv.d - 1, Math.floor(box.z1 - EPS));
      for (let z = z0; z <= z1; z++)
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const m = lv.cells[x + lv.w * (y + lv.h * z)];
            if (!isSolidMat(m)) continue;
            cb({ x0: x, y0: y, z0: z, x1: x + 1, y1: y + 1, z1: z + 1, src: { kind: 'world', id: 0, mat: m } });
          }
    }
    // Invisible walls at the ends of the level and at the front and back of the stage.
    const BIG = 1e4;
    if (box.x0 < 0) cb({ x0: -BIG, y0: -BIG, z0: -BIG, x1: 0, y1: BIG, z1: BIG, src: WALL });
    if (box.x1 > lv.w) cb({ x0: lv.w, y0: -BIG, z0: -BIG, x1: BIG, y1: BIG, z1: BIG, src: WALL });
    if (geo === '3d') {
      if (box.z0 < 0) cb({ x0: -BIG, y0: -BIG, z0: -BIG, x1: BIG, y1: BIG, z1: 0, src: WALL });
      if (box.z1 > lv.d) cb({ x0: -BIG, y0: -BIG, z0: lv.d, x1: BIG, y1: BIG, z1: BIG, src: WALL });
    }
    for (const b of this.bodies) {
      if (!b.solid || b === ignore) continue;
      if (b.max.x <= box.x0 || b.min.x >= box.x1 || b.max.y <= box.y0 || b.min.y >= box.y1) continue;
      if (geo === '3d' && (b.max.z <= box.z0 || b.min.z >= box.z1)) continue;
      const mat = b.kind === 'drum' ? MAT.brass : b.kind === 'gate' ? MAT.brass : MAT.wood;
      cb({ x0: b.min.x, y0: b.min.y, z0: b.min.z, x1: b.max.x, y1: b.max.y, z1: b.max.z, src: { kind: b.kind, id: b.id, mat } });
    }
  }
}

// ---------------------------------------------------------------- helpers

export type Geo = '3d' | 'proj';

interface Box6 {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

interface SolidBox extends Box6 {
  src: { kind: SupportRef['kind']; id: number; mat: number };
}

const WALL = { kind: 'world' as const, id: -1, mat: MAT.stone };

interface Support {
  kind: SupportRef['kind'];
  id: number;
  mat: number;
  top: number;
  z0: number;
  z1: number;
}

function playerBox(p: Vec3): Box6 {
  return {
    x0: p.x - PLAYER.hw,
    y0: p.y,
    z0: p.z - PLAYER.hd,
    x1: p.x + PLAYER.hw,
    y1: p.y + PLAYER.h,
    z1: p.z + PLAYER.hd,
  };
}

function boxOverlap(a: Box6, b: Box6, geo: Geo): boolean {
  if (a.x1 <= b.x0 + EPS || a.x0 >= b.x1 - EPS) return false;
  if (a.y1 <= b.y0 + EPS || a.y0 >= b.y1 - EPS) return false;
  if (geo === 'proj') return true;
  return a.z1 > b.z0 + EPS && a.z0 < b.z1 - EPS;
}

function overlap3(p: Vec3, b: { min: Vec3; max: Vec3 }): boolean {
  return boxOverlap(playerBox(p), { x0: b.min.x, y0: b.min.y, z0: b.min.z, x1: b.max.x, y1: b.max.y, z1: b.max.z }, '3d');
}

function solidAt3(lv: Level, x: number, y: number, z: number): boolean {
  if (x < 0 || y < 0 || z < 0 || x >= lv.w || y >= lv.h || z >= lv.d) return false;
  return isSolidMat(lv.cells[x + lv.w * (y + lv.h * z)]);
}

function nearestByDepth(list: Support[], z: number): Support | null {
  let best: Support | null = null;
  let bestD = Infinity;
  for (const s of list) {
    const d = z < s.z0 ? s.z0 - z : z > s.z1 ? z - s.z1 : 0;
    // Ties go to the front (smaller z) because the page shows the front.
    if (d < bestD - 1e-6 || (Math.abs(d - bestD) < 1e-6 && best && s.z0 < best.z0)) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

function approachV(v: number, target: number, step: number): number {
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target);
}

/** Position along a waypoint path at time t, with a pause at every waypoint. */
export function pathPosition(path: Vec3[], speed: number, pause: number, loop: boolean, t: number): Vec3 {
  if (path.length === 1) return { ...path[0] };
  const legs: [Vec3, Vec3][] = [];
  for (let i = 0; i < path.length - 1; i++) legs.push([path[i], path[i + 1]]);
  if (loop) legs.push([path[path.length - 1], path[0]]);
  else for (let i = path.length - 1; i > 0; i--) legs.push([path[i], path[i - 1]]);
  const durs = legs.map(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / speed);
  const cycle = durs.reduce((s, d) => s + d + pause, 0);
  let u = ((t % cycle) + cycle) % cycle;
  for (let i = 0; i < legs.length; i++) {
    if (u < pause) return { ...legs[i][0] };
    u -= pause;
    if (u < durs[i]) {
      const k = durs[i] > 0 ? u / durs[i] : 1;
      // Ease in and out so platforms settle gently at each stop.
      const e = k * k * (3 - 2 * k);
      const [a, b] = legs[i];
      return v3(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, a.z + (b.z - a.z) * e);
    }
    u -= durs[i];
  }
  return { ...path[0] };
}
