import { clamp, damp, easeInOut, lerp, smoothstep, v3, type Vec3 } from '../core/math';
import type { Game } from './sim';

/**
 * The shared camera. Both renderers draw from this one state, which is what makes
 * the switch seamless: at `swing = 0` the stage camera looks straight down the
 * depth axis with an almost orthographic lens, centred on the page camera at the
 * page's scale, so the two pictures line up exactly while the ink wipe runs.
 *
 * Timeline of `blend` (0 = page, 1 = stage):
 *   0 .. WIPE_END   the ink wipe: the page opens from the player outwards (stage at side view behind it)
 *   WIPE_END .. 1   the swing: the stage camera turns from side view to three-quarter view
 * Going back to the page plays the same timeline in reverse, so a switch can be
 * reversed at any instant without a jump.
 */

export const WIPE_END = 0.4;
export const TRANSITION_SECONDS = 0.78;
export const REDUCED_TRANSITION_SECONDS = 0.32;

export const STAGE_CAM = {
  yaw: -0.4,
  pitch: 0.34,
  fovDeg: 40,
  minFovDeg: 0.25,
  /** The stage frames a little tighter than the page. */
  zoom: 0.86,
} as const;

export interface ViewState {
  /** CSS pixels. */
  w: number;
  h: number;
  dpr: number;
  /** CSS pixels per world unit on the page. */
  ppu: number;
  /** Page camera centre in world units. */
  c2: { x: number; y: number };
  /** Free stage camera focus. */
  f3: Vec3;
  blend: number;
  /** Stage camera swing, 0 = side view, 1 = three-quarter view. */
  swing: number;
  /** Ink wipe, 0 = page covers everything, 1 = page fully open. */
  wipe: number;
  /** Where the wipe is centred, in CSS pixels. */
  wipeOrigin: { x: number; y: number };
  /** Game-time multiplier while the world turns. */
  timeScale: number;
  /** Which way the last switch went. */
  heading: 'to2d' | 'to3d';
  /** Seconds since the last switch began. */
  sinceSwitch: number;
  /** Screen shake amount, decays. */
  shake: number;
  reduceMotion: boolean;
  /** Overrides for cutscenes: extra distance and lift for the stage camera. */
  orbit: { yaw: number; pitch: number; dist: number };
  /** When set, both cameras frame this point instead of following the player. */
  focus: Vec3 | null;
}

export interface Pose3 {
  position: Vec3;
  target: Vec3;
  fovDeg: number;
  near: number;
  far: number;
  /** Distance from camera to focus. */
  dist: number;
}

export function createView(): ViewState {
  return {
    w: 1280,
    h: 720,
    dpr: 1,
    ppu: 60,
    c2: { x: 0, y: 0 },
    f3: v3(),
    blend: 1,
    swing: 1,
    wipe: 1,
    wipeOrigin: { x: 0, y: 0 },
    timeScale: 1,
    heading: 'to3d',
    sinceSwitch: 9,
    shake: 0,
    reduceMotion: false,
    orbit: { yaw: 0, pitch: 0, dist: 0 },
    focus: null,
  };
}

export function pixelsPerUnit(w: number, h: number): number {
  return Math.min(h / 12.5, w / 16);
}

export function resizeView(view: ViewState, w: number, h: number, dpr: number): void {
  view.w = w;
  view.h = h;
  view.dpr = dpr;
  view.ppu = pixelsPerUnit(w, h);
}

/** Where the page camera wants to be. */
function pageTarget(game: Game, view: ViewState): { x: number; y: number } {
  if (view.focus) return { x: view.focus.x, y: view.focus.y };
  const pl = game.player;
  const lv = game.level;
  const halfW = view.w / view.ppu / 2;
  const halfH = view.h / view.ppu / 2;
  let x = pl.pos.x + pl.facing * 1.4;
  let y = pl.pos.y + 1.6;
  const minX = halfW - 1;
  const maxX = lv.w - halfW + 1;
  x = minX > maxX ? lv.w / 2 : clamp(x, minX, maxX);
  y = Math.max(y, halfH - 2.2);
  return { x, y };
}

function stageTarget(game: Game, view: ViewState): Vec3 {
  if (view.focus) return { ...view.focus };
  const pl = game.player;
  return v3(pl.pos.x + pl.facing * 1.1, pl.pos.y + 1.3, pl.pos.z);
}

export function snapView(view: ViewState, game: Game): void {
  const t = pageTarget(game, view);
  view.c2 = { ...t };
  view.f3 = stageTarget(game, view);
  view.blend = game.mode === '3d' ? 1 : 0;
  splitBlend(view);
}

function splitBlend(view: ViewState): void {
  if (view.reduceMotion) {
    view.swing = 1;
    view.wipe = view.blend;
    return;
  }
  view.wipe = clamp(view.blend / WIPE_END, 0, 1);
  view.swing = clamp((view.blend - WIPE_END) / (1 - WIPE_END), 0, 1);
}

/** Advances the cameras and the switch timeline by real (unscaled) time. */
export function updateView(view: ViewState, game: Game, realDt: number): void {
  const target = game.mode === '3d' ? 1 : 0;
  const dur = view.reduceMotion ? REDUCED_TRANSITION_SECONDS : TRANSITION_SECONDS;
  const prevHeading = view.heading;
  view.heading = target === 1 ? 'to3d' : 'to2d';
  if (prevHeading !== view.heading) view.sinceSwitch = 0;
  view.sinceSwitch += realDt;
  view.blend = clamp(view.blend + Math.sign(target - view.blend) * (realDt / dur), 0, 1);
  splitBlend(view);

  // Slow the world while it turns so a switch in mid-air stays readable.
  const p = target === 1 ? view.blend : 1 - view.blend;
  const moving = view.blend !== target;
  const win = moving ? smoothstep(Math.min(p, 1 - p) / 0.14) : 0;
  view.timeScale = view.reduceMotion ? 1 : 1 - 0.66 * win;

  const dead = game.player.dead > 0;
  if (!dead) {
    const t2 = pageTarget(game, view);
    // Horizontal follow is quick, vertical is lazier while airborne.
    const vRate = game.player.grounded ? 5 : 2.6;
    view.c2.x = damp(view.c2.x, t2.x, 4.2, realDt);
    view.c2.y = damp(view.c2.y, t2.y, vRate, realDt);
    // Never let the player leave the page vertically.
    const halfH = view.h / view.ppu / 2;
    const py = game.player.pos.y;
    if (!view.focus) {
      if (py < view.c2.y - halfH + 1.2) view.c2.y = py - 1.2 + halfH;
      if (py > view.c2.y + halfH - 2.4) view.c2.y = py + 2.4 - halfH;
    }
    const t3 = stageTarget(game, view);
    view.f3.x = damp(view.f3.x, t3.x, 3.6, realDt);
    view.f3.y = damp(view.f3.y, t3.y, game.player.grounded ? 4 : 2.2, realDt);
    view.f3.z = damp(view.f3.z, t3.z, 3.6, realDt);
  }

  const sp = worldToPage(view, game.player.pos.x, game.player.pos.y + 0.45);
  view.wipeOrigin = sp;
  view.shake = Math.max(0, view.shake - realDt * 2.5);
}

/** Page projection: world units to CSS pixels. */
export function worldToPage(view: ViewState, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - view.c2.x) * view.ppu + view.w / 2,
    y: view.h / 2 - (y - view.c2.y) * view.ppu,
  };
}

/** The stage camera for the current swing. */
export function stagePose(view: ViewState): Pose3 {
  const t = view.reduceMotion ? 1 : easeInOut(view.swing);
  const focus = v3(lerp(view.c2.x, view.f3.x, t), lerp(view.c2.y, view.f3.y, t), view.f3.z);
  const visibleH = (view.h / view.ppu) * lerp(1, STAGE_CAM.zoom, t);
  const tanMin = Math.tan(((STAGE_CAM.minFovDeg * Math.PI) / 180) / 2);
  const tanMax = Math.tan(((STAGE_CAM.fovDeg * Math.PI) / 180) / 2);
  const tanHalf = lerp(tanMin, tanMax, t);
  const fovDeg = (2 * Math.atan(tanHalf) * 180) / Math.PI;
  const dist = visibleH / 2 / tanHalf + view.orbit.dist * t;
  const yaw = STAGE_CAM.yaw * t + view.orbit.yaw * t;
  const pitch = STAGE_CAM.pitch * t + view.orbit.pitch * t;
  const position = v3(
    focus.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    focus.y + Math.sin(pitch) * dist,
    focus.z - Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  return {
    position,
    target: focus,
    fovDeg,
    near: Math.max(0.1, dist - 80),
    far: dist + 220,
    dist,
  };
}

/** Projects a world point through the stage camera to CSS pixels. */
export function worldToStage(view: ViewState, x: number, y: number, z: number): { x: number; y: number; behind: boolean } {
  const pose = stagePose(view);
  const p = pose.position;
  const t = pose.target;
  // Camera basis in simulation space (z away from the viewer, so this is a left-handed frame).
  let fx = t.x - p.x;
  let fy = t.y - p.y;
  let fz = t.z - p.z;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = up x forward (keeps +x on the right for a camera looking along +z)
  let rx = fz;
  let ry = 0;
  let rz = -fx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = fy * rz - fz * ry;
  const uy = fz * rx - fx * rz;
  const uz = fx * ry - fy * rx;
  const dx = x - p.x;
  const dy = y - p.y;
  const dz = z - p.z;
  const cx = dx * rx + dy * ry + dz * rz;
  const cy = dx * ux + dy * uy + dz * uz;
  const cz = dx * fx + dy * fy + dz * fz;
  const f = view.h / 2 / Math.tan(((pose.fovDeg * Math.PI) / 180) / 2);
  return { x: view.w / 2 + (cx / cz) * f, y: view.h / 2 - (cy / cz) * f, behind: cz <= 0 };
}

/** Screen position of a world point in whichever world is showing. */
export function worldToScreen(view: ViewState, x: number, y: number, z: number): { x: number; y: number } {
  if (view.wipe < 1) return worldToPage(view, x, y);
  return worldToStage(view, x, y, z);
}
