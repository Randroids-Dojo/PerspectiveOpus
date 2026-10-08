import type { Vec3 } from '../core/math';

/** The two ways of seeing the world. The Score is the flat 2D page, the Stage is the 3D world. */
export type Mode = '2d' | '3d';

/** Voxel materials. Every solid material is solid in both modes; only the look differs per palette. */
export const MAT = {
  empty: 0,
  stone: 1,
  brick: 2,
  wood: 3,
  brass: 4,
  dark: 5,
  crystal: 6,
  leaf: 7,
  thorn: 8,
  marble: 9,
} as const;
export type MatName = Exclude<keyof typeof MAT, 'empty'>;
export const MAT_NAMES: Record<number, MatName | 'empty'> = Object.fromEntries(
  Object.entries(MAT).map(([k, v]) => [v, k]),
) as Record<number, MatName | 'empty'>;

export const isSolidMat = (m: number): boolean => m !== MAT.empty && m !== MAT.thorn;

export type PaletteId = 'dawn' | 'lake' | 'autumn' | 'night' | 'clock' | 'finale' | 'title';

export interface NoteDef {
  id: number;
  pos: Vec3;
}

export interface CheckpointDef {
  id: number;
  pos: Vec3;
}

export interface PlatformDef {
  id: number;
  /** Size in cells. */
  size: Vec3;
  /** Waypoints for the platform's minimum corner. */
  path: Vec3[];
  /** Units per second along the path. */
  speed: number;
  /** Seconds to wait at each waypoint. */
  pause: number;
  /** Ping-pong (default) or loop back to the first waypoint. */
  loop: boolean;
  /** Optional group: the platform only moves while the group is on. */
  group?: number;
  /** Start offset in seconds so a row of platforms can be staggered. */
  phase: number;
  mat: 'wood' | 'brass' | 'stone';
}

export interface DrumDef {
  id: number;
  pos: Vec3;
  /** Launch height in cells. */
  power: number;
}

export interface KeyDef {
  id: number;
  pos: Vec3;
  group: number;
  /** Width of the key in cells (along x). */
  width: number;
}

export interface GateDef {
  id: number;
  min: Vec3;
  max: Vec3;
  group: number;
  /** True: solid while the group is on. False: solid while the group is off. */
  solidWhenOn: boolean;
}

export interface DiscordDef {
  id: number;
  path: Vec3[];
  speed: number;
  phase: number;
}

export interface SignDef {
  id: number;
  pos: Vec3;
  /** Trigger half-size in cells (x, z). */
  radius: number;
  hint: HintId;
  /** Only show in this mode. */
  mode?: Mode;
}

export type HintId =
  | 'move'
  | 'jump'
  | 'switch2d'
  | 'switch3d'
  | 'depth'
  | 'lineup'
  | 'walkaround'
  | 'notes'
  | 'checkpoint'
  | 'thorns'
  | 'platform'
  | 'drum'
  | 'keys'
  | 'discord'
  | 'midair'
  | 'hidden'
  | 'exit'
  | 'machine'
  | 'ride'
  | 'finale';

export type DecorKind =
  | 'tree'
  | 'pine'
  | 'lamp'
  | 'pillar'
  | 'banner'
  | 'flowers'
  | 'grass'
  | 'rock'
  | 'reeds'
  | 'lantern'
  | 'pipes'
  | 'gear'
  | 'crystals'
  | 'statue'
  | 'curtain'
  | 'arch'
  | 'mushroom'
  | 'bell'
  | 'candles';

export interface DecorDef {
  id: number;
  kind: DecorKind;
  pos: Vec3;
  /** Uniform scale, default 1. */
  scale: number;
  /** Rotation around y in radians (3D only). */
  rot: number;
  /** Seed for per-instance variation. */
  seed: number;
}

export interface ExitDef {
  pos: Vec3;
}

export interface LevelInfo {
  id: string;
  index: number;
  /** "Movement I" */
  movement: string;
  /** "Overture" */
  title: string;
  /** One line of flavour shown on the intro card. */
  epigraph: string;
  palette: PaletteId;
  /** Tempo marking shown on the programme, e.g. "Allegro moderato". */
  tempo: string;
  /** Height of the water surface, if the movement has water below. Falling in ends the attempt. */
  water?: number;
}

export interface Box {
  min: Vec3;
  max: Vec3;
}
