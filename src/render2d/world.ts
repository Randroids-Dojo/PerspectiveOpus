import { NO_DEPTH, type Level } from '../game/level';
import { MAT, isSolidMat, type DecorDef, type DecorKind } from '../game/types';

/**
 * What the page needs to know about a level, computed once per load: which voxel
 * shows at the front of each column, the silhouette of every depth layer as long
 * merged edge runs (so outlines are drawn as single strokes), the visible top
 * surfaces, thorns and decor with their bounds.
 */

export const Side = { Top: 0, Bottom: 1, Left: 2, Right: 3 } as const;
export type Side = 0 | 1 | 2 | 3;

export interface EdgeRun {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  side: Side;
  z: number;
  seed: number;
}

export interface Seam {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z: number;
}

export interface ThornCell {
  x: number;
  y: number;
  z: number;
}

export interface DecorInfo {
  def: DecorDef;
  /** World bounds of the drawing. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z: number;
  /** Drawn every frame instead of being baked (moving parts). */
  live: boolean;
}

/** Drawing extents per decor kind at scale 1: half width, height above base, depth below base. */
const DECOR_SIZE: Record<DecorKind, [number, number, number]> = {
  tree: [1.5, 3.9, 0.1],
  pine: [1.1, 4.1, 0.1],
  lamp: [0.8, 2.6, 0.05],
  pillar: [0.65, 3.3, 0.05],
  banner: [0.75, 2.3, 0.9],
  flowers: [0.6, 0.75, 0.05],
  grass: [0.6, 0.8, 0.05],
  rock: [0.75, 0.75, 0.08],
  reeds: [0.6, 1.8, 0.05],
  lantern: [0.7, 2.3, 0.05],
  pipes: [1.2, 3.6, 0.05],
  gear: [1.5, 2.9, 0.1],
  crystals: [0.8, 1.3, 0.05],
  statue: [0.8, 3.0, 0.05],
  curtain: [1.3, 4.2, 0.05],
  arch: [1.5, 3.4, 0.05],
  mushroom: [0.6, 0.7, 0.05],
  bell: [0.9, 2.5, 0.05],
  candles: [0.6, 1.1, 0.05],
};

const LIVE_DECOR = new Set<DecorKind>(['gear', 'banner', 'candles', 'lantern', 'lamp', 'bell']);

export class World {
  readonly lv: Level;
  readonly w: number;
  readonly h: number;
  readonly d: number;
  readonly front: Uint8Array;
  /** Outline runs per layer. */
  readonly edges: EdgeRun[][];
  readonly seams: Seam[][];
  readonly thorns: ThornCell[][];
  readonly decor: DecorInfo[];
  readonly decorByLayer: DecorInfo[][];
  readonly liveDecor: DecorInfo[];
  /** 1 where a cell has anything static to draw (for skipping empty chunks). */
  readonly content: Uint8Array;

  constructor(lv: Level) {
    this.lv = lv;
    this.w = lv.w;
    this.h = lv.h;
    this.d = lv.d;
    this.front = lv.front;
    this.edges = [];
    this.seams = [];
    this.thorns = [];
    for (let z = 0; z < lv.d; z++) {
      this.edges.push(this.buildEdges(z));
      this.seams.push(this.buildSeams(z));
      this.thorns.push([]);
    }
    for (let z = 0; z < lv.d; z++)
      for (let y = 0; y < lv.h; y++)
        for (let x = 0; x < lv.w; x++) {
          if (lv.cells[x + lv.w * (y + lv.h * z)] !== MAT.thorn) continue;
          const f = lv.front[x + lv.w * y];
          if (f !== NO_DEPTH && f < z) continue;
          this.thorns[z].push({ x, y, z });
        }
    this.decor = lv.decor.map((def) => {
      const [hw, hh, below] = DECOR_SIZE[def.kind] ?? [1, 2, 0.1];
      const s = def.scale || 1;
      return {
        def,
        x0: def.pos.x - hw * s,
        x1: def.pos.x + hw * s,
        y0: def.pos.y - below * s - 0.05,
        y1: def.pos.y + hh * s,
        z: Math.max(0, Math.min(lv.d - 1, Math.floor(def.pos.z))),
        live: LIVE_DECOR.has(def.kind),
      };
    });
    this.decorByLayer = Array.from({ length: lv.d }, () => [] as DecorInfo[]);
    for (const di of this.decor) this.decorByLayer[di.z].push(di);
    this.liveDecor = this.decor.filter((d) => d.live);

    this.content = new Uint8Array(lv.w * lv.h);
    for (let i = 0; i < lv.w * lv.h; i++) if (lv.front[i] !== NO_DEPTH || lv.thornCol[i]) this.content[i] = 1;
    for (const di of this.decor) {
      for (let y = Math.max(0, Math.floor(di.y0)); y <= Math.min(lv.h - 1, Math.floor(di.y1)); y++)
        for (let x = Math.max(0, Math.floor(di.x0)); x <= Math.min(lv.w - 1, Math.floor(di.x1)); x++) this.content[x + lv.w * y] = 1;
    }
  }

  mat(x: number, y: number, z: number): number {
    const lv = this.lv;
    if (x < 0 || y < 0 || z < 0 || x >= lv.w || y >= lv.h || z >= lv.d) return MAT.empty;
    return lv.cells[x + lv.w * (y + lv.h * z)];
  }

  solid(x: number, y: number, z: number): boolean {
    return isSolidMat(this.mat(x, y, z));
  }

  /** Front-most solid depth of a column, NO_DEPTH outside the level or if empty. */
  frontAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return NO_DEPTH;
    return this.front[x + this.w * y];
  }

  /** True if anything static needs drawing in the cell rectangle [x0, x1] x [y0, y1] (inclusive). */
  hasContent(x0: number, y0: number, x1: number, y1: number): boolean {
    const a = Math.max(0, x0);
    const b = Math.min(this.w - 1, x1);
    const c = Math.max(0, y0);
    const e = Math.min(this.h - 1, y1);
    for (let y = c; y <= e; y++)
      for (let x = a; x <= b; x++) if (this.content[x + this.w * y]) return true;
    return false;
  }

  private buildEdges(z: number): EdgeRun[] {
    const out: EdgeRun[] = [];
    const { w, h } = this;
    // An edge shows unless both columns it separates are covered by something nearer.
    const visible = (sx: number, sy: number, ex: number, ey: number): boolean => {
      const fs = this.frontAt(sx, sy);
      const fe = this.frontAt(ex, ey);
      return fs === z || fe === NO_DEPTH || fe > z;
    };
    // Horizontal runs: top and bottom edges.
    for (let side = 0; side < 2; side++) {
      const dy = side === Side.Top ? 1 : -1;
      for (let y = 0; y < h; y++) {
        let start = -1;
        for (let x = 0; x <= w; x++) {
          const isEdge = x < w && this.solid(x, y, z) && !this.solid(x, y + dy, z) && visible(x, y, x, y + dy);
          if (isEdge && start < 0) start = x;
          if (!isEdge && start >= 0) {
            const ey = side === Side.Top ? y + 1 : y;
            out.push({ x0: start, y0: ey, x1: x, y1: ey, side: side as Side, z, seed: (start * 7349 + ey * 3911 + z * 101 + side * 17) | 0 });
            start = -1;
          }
        }
      }
    }
    // Vertical runs: left and right edges.
    for (let side = 2; side < 4; side++) {
      const dx = side === Side.Left ? -1 : 1;
      for (let x = 0; x < w; x++) {
        let start = -1;
        for (let y = 0; y <= h; y++) {
          const isEdge = y < h && this.solid(x, y, z) && !this.solid(x + dx, y, z) && visible(x, y, x + dx, y);
          if (isEdge && start < 0) start = y;
          if (!isEdge && start >= 0) {
            const ex = side === Side.Left ? x : x + 1;
            out.push({ x0: ex, y0: start, x1: ex, y1: y, side: side as Side, z, seed: (ex * 5113 + start * 2711 + z * 131 + side * 29) | 0 });
            start = -1;
          }
        }
      }
    }
    return out;
  }

  private buildSeams(z: number): Seam[] {
    const out: Seam[] = [];
    const { w, h } = this;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const m = this.mat(x, y, z);
        if (!isSolidMat(m)) continue;
        const vis = this.frontAt(x, y) === z;
        const mr = this.mat(x + 1, y, z);
        if (isSolidMat(mr) && mr !== m && (vis || this.frontAt(x + 1, y) === z)) out.push({ x0: x + 1, y0: y, x1: x + 1, y1: y + 1, z });
        const mu = this.mat(x, y + 1, z);
        if (isSolidMat(mu) && mu !== m && (vis || this.frontAt(x, y + 1) === z)) out.push({ x0: x, y0: y + 1, x1: x + 1, y1: y + 1, z });
      }
    return out;
  }
}
