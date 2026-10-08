import type { Palette } from '../game/palettes';
import type { PaletteId } from '../game/types';

/**
 * Stage-only lighting and grading per movement, on top of the shared palette.
 * Distances are relative to the camera's focus distance so the same numbers
 * work at the side view (about 2800 units away) and the three-quarter view.
 */
export interface Look {
  exposure: number;
  hemi: number;
  /** Multiplier on `palette.sunIntensity`. */
  sun: number;
  env: number;
  /** Warm key on Quaver. */
  spot: number;
  spotColor: string;
  /** Fog start and end behind the focus, in world units. */
  fogStart: number;
  fogEnd: number;
  /** Height fog into the void: starts at `hfogTop`, full at `hfogBottom` (world y). */
  hfogTop: number;
  hfogBottom: number;
  bloom: number;
  bloomThreshold: number;
  grade: {
    lift: [number, number, number];
    gamma: [number, number, number];
    gain: [number, number, number];
    sat: number;
    contrast: number;
  };
  vignette: number;
  grain: number;
  /** Where the visible sun or moon sits in the sky (simulation axes, +z is away from the viewer). */
  skyBody: { dir: [number, number, number]; size: number; kind: 'sun' | 'moon' | 'clock' | 'window' };
  stars: number;
  clouds: number;
  /** Ambient particle count multiplier. */
  ambient: number;
  /** Secondary ambient (motes in light). */
  motes: number;
  /** Light shafts in the backdrop. */
  shafts: number;
}

const BASE: Look = {
  exposure: 1,
  hemi: 0.95,
  sun: 1.45,
  env: 0.55,
  spot: 6,
  spotColor: '#ffd8a6',
  fogStart: 10,
  fogEnd: 95,
  hfogTop: 1.2,
  hfogBottom: -3.5,
  bloom: 0.7,
  bloomThreshold: 0.9,
  grade: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], sat: 1.05, contrast: 1.06 },
  vignette: 0.34,
  grain: 0.035,
  skyBody: { dir: [-0.45, 0.1, 1], size: 1, kind: 'sun' },
  stars: 0,
  clouds: 1,
  ambient: 1,
  motes: 0.4,
  shafts: 0,
};

const LOOKS: Record<PaletteId, Partial<Look>> = {
  dawn: {
    exposure: 1.02,
    grade: { lift: [0.012, 0.008, 0.02], gamma: [1, 1, 1.03], gain: [1.04, 1.0, 0.95], sat: 1.1, contrast: 1.09 },
    skyBody: { dir: [-0.5, 0.09, 1], size: 1.2, kind: 'sun' },
    clouds: 1,
    motes: 0,
  },
  lake: {
    exposure: 1.05,
    hemi: 1.35,
    sun: 1.1,
    fogStart: 6,
    fogEnd: 70,
    grade: { lift: [0.01, 0.02, 0.025], gamma: [1.02, 1, 0.98], gain: [0.97, 1.0, 1.02], sat: 0.94, contrast: 1.02 },
    skyBody: { dir: [0.35, 0.22, 1], size: 1.4, kind: 'sun' },
    clouds: 0.8,
    shafts: 0.6,
    motes: 0.2,
  },
  autumn: {
    exposure: 1.0,
    grade: { lift: [0.02, 0.01, 0.0], gamma: [0.98, 1, 1.04], gain: [1.06, 1.0, 0.9], sat: 1.12, contrast: 1.06 },
    skyBody: { dir: [0.6, 0.07, 1], size: 1.5, kind: 'sun' },
    clouds: 1.2,
    motes: 0.3,
  },
  night: {
    exposure: 1.15,
    hemi: 1.6,
    sun: 1.9,
    env: 0.7,
    spot: 9,
    spotColor: '#ffe0b0',
    fogStart: 8,
    fogEnd: 80,
    bloom: 1.0,
    bloomThreshold: 0.75,
    grade: { lift: [0.0, 0.01, 0.035], gamma: [1.04, 1.0, 0.94], gain: [0.95, 1.0, 1.08], sat: 0.98, contrast: 1.08 },
    vignette: 0.42,
    skyBody: { dir: [-0.38, 0.3, 1], size: 1.2, kind: 'moon' },
    stars: 1,
    clouds: 0.4,
    motes: 0,
  },
  clock: {
    exposure: 1.05,
    hemi: 1.0,
    sun: 1.2,
    spot: 7,
    fogStart: 6,
    fogEnd: 60,
    bloom: 0.9,
    bloomThreshold: 0.8,
    grade: { lift: [0.02, 0.008, 0.0], gamma: [0.97, 1.0, 1.06], gain: [1.08, 1.0, 0.88], sat: 1.06, contrast: 1.1 },
    vignette: 0.45,
    skyBody: { dir: [0, 0.18, 1], size: 2.2, kind: 'clock' },
    clouds: 0,
    shafts: 1,
    motes: 0.6,
  },
  finale: {
    exposure: 1.02,
    hemi: 1.05,
    sun: 1.15,
    spot: 7,
    bloom: 0.9,
    grade: { lift: [0.02, 0.0, 0.012], gamma: [0.98, 1.02, 1.0], gain: [1.06, 0.99, 0.94], sat: 1.1, contrast: 1.08 },
    vignette: 0.4,
    skyBody: { dir: [0, 0.1, 1], size: 1.7, kind: 'window' },
    clouds: 0,
    shafts: 1,
    motes: 0.5,
  },
  title: {
    exposure: 1.02,
    bloom: 0.85,
    grade: { lift: [0.015, 0.0, 0.03], gamma: [1, 1, 1], gain: [1.04, 0.98, 1.0], sat: 1.06, contrast: 1.05 },
    skyBody: { dir: [-0.45, 0.06, 1], size: 1.5, kind: 'sun' },
    stars: 0.6,
    clouds: 0.8,
    motes: 0.6,
  },
};

export function lookFor(p: Palette): Look {
  const l = { ...BASE, ...LOOKS[p.id] };
  l.fogEnd /= p.haze;
  l.fogStart /= Math.sqrt(p.haze);
  return l;
}
