import { v3, type Vec3 } from '../core/math';
import {
  MAT,
  isSolidMat,
  type CheckpointDef,
  type DecorDef,
  type DecorKind,
  type DiscordDef,
  type DrumDef,
  type ExitDef,
  type GateDef,
  type HintId,
  type KeyDef,
  type LevelInfo,
  type MatName,
  type Mode,
  type NoteDef,
  type PlatformDef,
  type SignDef,
} from './types';

export const NO_DEPTH = 255;

/** A compiled level: the voxel grid plus everything placed in it. */
export interface Level {
  info: LevelInfo;
  w: number;
  h: number;
  d: number;
  /** Material per voxel, index x + w * (y + h * z). */
  cells: Uint8Array;
  /** Front-most solid z per column (x, y), or NO_DEPTH. Index x + w * y. */
  front: Uint8Array;
  /** Number of solid voxels per column (x, y). */
  depthCount: Uint8Array;
  /** 1 if any thorn lies in the column (x, y). */
  thornCol: Uint8Array;
  spawn: Vec3;
  notes: NoteDef[];
  checkpoints: CheckpointDef[];
  exit: ExitDef;
  platforms: PlatformDef[];
  drums: DrumDef[];
  keys: KeyDef[];
  gates: GateDef[];
  discords: DiscordDef[];
  signs: SignDef[];
  decor: DecorDef[];
  /** Groups that start switched on. */
  groupsOn: number[];
}

export interface LevelDef {
  info: LevelInfo;
  size: [number, number, number];
  build(b: Builder): void;
}

export const cellIndex = (lv: { w: number; h: number }, x: number, y: number, z: number): number =>
  x + lv.w * (y + lv.h * z);

export function matAt(lv: Level, x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || z < 0 || x >= lv.w || y >= lv.h || z >= lv.d) return MAT.empty;
  return lv.cells[x + lv.w * (y + lv.h * z)];
}

export function solidAt(lv: Level, x: number, y: number, z: number): boolean {
  return isSolidMat(matAt(lv, x, y, z));
}

/** True if any voxel in the column (x, y) is solid. */
export function projSolid(lv: Level, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) return false;
  return lv.front[x + lv.w * y] !== NO_DEPTH;
}

/**
 * Builds levels from boxes. All ranges are integer cells, min inclusive and
 * max exclusive, so `box(0, 0, 0, 10, 1, 5)` is a slab 10 wide, 1 tall and 5 deep.
 */
export class Builder {
  readonly w: number;
  readonly h: number;
  readonly d: number;
  readonly cells: Uint8Array;
  spawnPos: Vec3 = v3(1.5, 1, 0.5);
  exitDef: ExitDef = { pos: v3(0, 0, 0) };
  notes: NoteDef[] = [];
  checkpoints: CheckpointDef[] = [];
  platforms: PlatformDef[] = [];
  drums: DrumDef[] = [];
  keys: KeyDef[] = [];
  gates: GateDef[] = [];
  discords: DiscordDef[] = [];
  signs: SignDef[] = [];
  decorList: DecorDef[] = [];
  groupsOn: number[] = [];
  private seq = 0;

  constructor(w: number, h: number, d: number) {
    this.w = w;
    this.h = h;
    this.d = d;
    this.cells = new Uint8Array(w * h * d);
  }

  private fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number): this {
    const xa = Math.max(0, Math.min(x0, x1));
    const xb = Math.min(this.w, Math.max(x0, x1));
    const ya = Math.max(0, Math.min(y0, y1));
    const yb = Math.min(this.h, Math.max(y0, y1));
    const za = Math.max(0, Math.min(z0, z1));
    const zb = Math.min(this.d, Math.max(z0, z1));
    for (let z = za; z < zb; z++)
      for (let y = ya; y < yb; y++)
        for (let x = xa; x < xb; x++) this.cells[x + this.w * (y + this.h * z)] = m;
    return this;
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: MatName = 'stone'): this {
    return this.fill(x0, y0, z0, x1, y1, z1, MAT[mat]);
  }

  /** A box spanning the full depth. */
  wall(x0: number, y0: number, x1: number, y1: number, mat: MatName = 'stone'): this {
    return this.fill(x0, y0, 0, x1, y1, this.d, MAT[mat]);
  }

  clear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    return this.fill(x0, y0, z0, x1, y1, z1, MAT.empty);
  }

  thorns(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    return this.fill(x0, y0, z0, x1, y1, z1, MAT.thorn);
  }

  set(x: number, y: number, z: number, mat: MatName | 'empty'): this {
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.h || z >= this.d) return this;
    this.cells[x + this.w * (y + this.h * z)] = MAT[mat];
    return this;
  }

  /** Player starts standing on the cell below (x, y, z). */
  spawn(x: number, y: number, z: number): this {
    this.spawnPos = v3(x + 0.5, y, z + 0.5);
    return this;
  }

  exit(x: number, y: number, z: number): this {
    this.exitDef = { pos: v3(x + 0.5, y, z + 0.5) };
    return this;
  }

  note(x: number, y: number, z: number): this {
    this.notes.push({ id: this.notes.length, pos: v3(x + 0.5, y + 0.5, z + 0.5) });
    return this;
  }

  checkpoint(x: number, y: number, z: number): this {
    this.checkpoints.push({ id: this.checkpoints.length, pos: v3(x + 0.5, y, z + 0.5) });
    return this;
  }

  platform(opts: {
    size: [number, number, number];
    path: [number, number, number][];
    speed?: number;
    pause?: number;
    loop?: boolean;
    group?: number;
    phase?: number;
    mat?: PlatformDef['mat'];
  }): this {
    this.platforms.push({
      id: this.platforms.length,
      size: v3(...opts.size),
      path: opts.path.map((p) => v3(...p)),
      speed: opts.speed ?? 2,
      pause: opts.pause ?? 0.6,
      loop: opts.loop ?? false,
      group: opts.group,
      phase: opts.phase ?? 0,
      mat: opts.mat ?? 'wood',
    });
    return this;
  }

  /** A timpani drum occupying the cell (x, y, z). */
  drum(x: number, y: number, z: number, power = 5.5): this {
    this.drums.push({ id: this.drums.length, pos: v3(x, y, z), power });
    return this;
  }

  /** A piano key lying on top of the cell below (x, y, z). Toggles `group` when stepped on. */
  key(x: number, y: number, z: number, group: number, width = 1): this {
    this.keys.push({ id: this.keys.length, pos: v3(x, y, z), group, width });
    return this;
  }

  gate(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, group: number, solidWhenOn: boolean): this {
    this.gates.push({ id: this.gates.length, min: v3(x0, y0, z0), max: v3(x1, y1, z1), group, solidWhenOn });
    return this;
  }

  groupOn(group: number): this {
    if (!this.groupsOn.includes(group)) this.groupsOn.push(group);
    return this;
  }

  /** A Discord patrolling between cell-centred waypoints. */
  discord(path: [number, number, number][], speed = 1.6, phase = 0): this {
    this.discords.push({
      id: this.discords.length,
      path: path.map(([x, y, z]) => v3(x + 0.5, y + 0.5, z + 0.5)),
      speed,
      phase,
    });
    return this;
  }

  sign(x: number, y: number, z: number, hint: HintId, radius = 1.6, mode?: Mode): this {
    this.signs.push({ id: this.signs.length, pos: v3(x + 0.5, y, z + 0.5), radius, hint, mode });
    return this;
  }

  /** Purely visual dressing, placed standing on the cell below (x, y, z). */
  decor(kind: DecorKind, x: number, y: number, z: number, scale = 1, rot?: number): this {
    const seed = (this.seq++ * 7919 + x * 31 + y * 17 + z * 13) >>> 0;
    this.decorList.push({
      id: this.decorList.length,
      kind,
      pos: v3(x + 0.5, y, z + 0.5),
      scale,
      rot: rot ?? ((seed % 628) / 100),
      seed,
    });
    return this;
  }
}

export function compileLevel(def: LevelDef): Level {
  const [w, h, d] = def.size;
  const b = new Builder(w, h, d);
  def.build(b);
  const front = new Uint8Array(w * h).fill(NO_DEPTH);
  const depthCount = new Uint8Array(w * h);
  const thornCol = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        const m = b.cells[x + w * (y + h * z)];
        if (isSolidMat(m)) {
          if (front[x + w * y] === NO_DEPTH) front[x + w * y] = z;
          depthCount[x + w * y]++;
        } else if (m === MAT.thorn) thornCol[x + w * y] = 1;
      }
    }
  return {
    info: def.info,
    w,
    h,
    d,
    cells: b.cells,
    front,
    depthCount,
    thornCol,
    spawn: b.spawnPos,
    notes: b.notes,
    checkpoints: b.checkpoints,
    exit: b.exitDef,
    platforms: b.platforms,
    drums: b.drums,
    keys: b.keys,
    gates: b.gates,
    discords: b.discords,
    signs: b.signs,
    decor: b.decorList,
    groupsOn: b.groupsOn,
  };
}
