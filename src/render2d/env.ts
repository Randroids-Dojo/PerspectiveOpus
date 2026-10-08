import { anchorPattern, hatchTile, washTile } from './ink';
import { css, mix, type RGB } from './color';
import type { Tones } from './tones';
import type { World } from './world';

/**
 * A projection from world units to device pixels: x' = ox + x * k, y' = oy - y * k.
 * The world bitmap is laid out on a fixed device-pixel grid so cached chunks and
 * live drawing always land on the same pixels.
 */
export interface Proj {
  /** Device pixels per world unit. */
  k: number;
  ox: number;
  oy: number;
  /** Device pixels per CSS pixel. */
  dpr: number;
  /** Stroke scale: device pixels per "drawing pixel" (dpr adjusted for the page scale). */
  px: number;
  /** Boil frame index (changes about 8 times a second). */
  boil: number;
}

export interface Patterns {
  /** Diagonal hatching in the shade colour. */
  hatch: CanvasPattern;
  /** Cross-hatching in the shade colour. */
  cross: CanvasPattern;
  /** Dense cross-hatching for dark material and deep shade. */
  dense: CanvasPattern;
  /** Watercolour granulation and blotches. */
  wash: CanvasPattern;
  /** Fine light hatching (highlights on dark fills). */
  light: CanvasPattern;
}

/** Everything a drawing function needs to know about the current page. */
export interface Env {
  world: World;
  tones: Tones;
  pats: Patterns;
  /** Real seconds, for live decor. */
  now: number;
  /** Game seconds. */
  time: number;
  quality: 'low' | 'medium' | 'high';
}

export function strokeScale(ppu: number): number {
  return Math.pow(Math.max(0.45, Math.min(1.6, ppu / 57.6)), 0.6);
}

export function makePatterns(ctx: CanvasRenderingContext2D, t: Tones, dpr: number): Patterns {
  const shade = css(t.shade);
  const sp = Math.max(3, Math.round(4.2 * dpr));
  const size = sp * 16;
  const lightC: RGB = t.inv ? mix(t.paper, [255, 255, 255], 0.75) : mix(t.paper, [255, 252, 240], 0.6);
  const mk = (c: HTMLCanvasElement): CanvasPattern => ctx.createPattern(c, 'repeat')!;
  return {
    hatch: mk(hatchTile(size, shade, t.inv ? 0.55 : 0.5, sp, 0.9 * dpr, false, 11)),
    cross: mk(hatchTile(size, shade, t.inv ? 0.5 : 0.45, sp, 0.8 * dpr, true, 23)),
    dense: mk(hatchTile(Math.round(size * 0.75), shade, 0.6, Math.max(2, Math.round(sp * 0.75)), 0.85 * dpr, true, 37)),
    wash: mk(washTile(Math.round(256 * Math.min(2, dpr)), t.inv ? t.paperShade : t.shade, t.inv ? 0.2 : 0.15, 7)),
    light: mk(hatchTile(size, css(lightC), 0.5, sp, 0.7 * dpr, false, 41)),
  };
}

/** Anchors every pattern to the world bitmap origin for a projection. */
export function anchorAll(p: Patterns, proj: Proj): void {
  anchorPattern(p.hatch, proj.ox, proj.oy);
  anchorPattern(p.cross, proj.ox, proj.oy);
  anchorPattern(p.dense, proj.ox, proj.oy);
  anchorPattern(p.wash, proj.ox, proj.oy);
  anchorPattern(p.light, proj.ox, proj.oy);
}
