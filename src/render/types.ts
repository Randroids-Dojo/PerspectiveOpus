import type { Palette } from '../game/palettes';
import type { Game, GameEvent } from '../game/sim';
import type { ViewState } from '../game/view';

export type Quality = 'low' | 'medium' | 'high';

export interface FrameInfo {
  /** Interpolation between the previous and the current simulation step, 0..1. */
  alpha: number;
  /** Real seconds since the last frame (unscaled). */
  dt: number;
  /** Game seconds advanced this frame (scaled by the switch slow-down, 0 while paused). */
  gameDt: number;
  /** Real seconds since the app started. */
  now: number;
  /** Game events produced since the last frame. Read-only; every consumer sees the same list. */
  events: readonly GameEvent[];
  /** Music position in beats (fractional), or -1 when no music is playing. */
  beat: number;
  quality: Quality;
  /** True while a menu covers the game (renderers may lower their cost). */
  paused: boolean;
}

/**
 * A way of drawing the world. The stage (3D, three.js) and the score (2D, canvas)
 * both implement this. They share the simulation and the view, and must agree on
 * where everything is: at `view.swing = 0` the stage camera matches the page.
 */
export interface WorldRenderer {
  readonly canvas: HTMLCanvasElement;
  /** Builds everything for a level. Called once per level start (and for the title scene). */
  load(game: Game, palette: Palette): void;
  render(game: Game, view: ViewState, frame: FrameInfo): void;
  resize(w: number, h: number, dpr: number): void;
  setVisible(v: boolean): void;
}

/** Interpolated position of a moving thing. */
export function lerpPos(prev: { x: number; y: number; z: number }, cur: { x: number; y: number; z: number }, a: number) {
  return { x: prev.x + (cur.x - prev.x) * a, y: prev.y + (cur.y - prev.y) * a, z: prev.z + (cur.z - prev.z) * a };
}
