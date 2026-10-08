import type { Body, Game } from '../game/sim';
import type { FrameInfo } from '../render/types';
import { css, mix, rgb } from './color';
import type { Env, Proj } from './env';
import { glintPath } from './ink';
import { hash, hs, noise1, TAU } from './rand';
import { Sketch } from './sketch';

/**
 * Live things in ink and gold. Each builder returns its depth and world bounds so
 * the page can draw it in painter's order and redraw whatever stands in front.
 */

export interface Drawable {
  /** Nearest depth the thing occupies (smaller is nearer). */
  z: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  draw(ctx: CanvasRenderingContext2D, p: Proj): void;
  /** Drawn over scenery when the thing is hidden behind it. */
  ghost?(ctx: CanvasRenderingContext2D, p: Proj): void;
  /**
   * The solid core of the thing. Scenery only hides it when something nearer covers the
   * core; a sprite that merely brushes a nearer wall stays on top of it.
   */
  core?: { x0: number; y0: number; x1: number; y1: number };
}

const sk = new Sketch();

function layerOf(env: Env, z: number): number {
  return Math.max(0, Math.min(env.world.d - 1, Math.floor(z)));
}

export function collectEntities(out: Drawable[], game: Game, env: Env, frame: FrameInfo, view: { x0: number; y0: number; x1: number; y1: number }): void {
  const lv = game.level;
  const t = game.time;
  const inView = (x0: number, y0: number, x1: number, y1: number) => x1 > view.x0 && x0 < view.x1 && y1 > view.y0 && y0 < view.y1;

  // Notes.
  for (let i = 0; i < lv.notes.length; i++) {
    const n = lv.notes[i].pos;
    const taken = game.notesTaken[i];
    const since = taken ? t - game.noteTakenAt[i] : 0;
    if (taken && since > 0.7) continue;
    if (!inView(n.x - 0.6, n.y - 0.6, n.x + 0.6, n.y + 1.4)) continue;
    out.push({
      z: n.z - 0.3,
      x0: n.x - 0.5,
      y0: n.y - 0.5,
      x1: n.x + 0.5,
      y1: n.y + 0.6,
      core: { x0: n.x - 0.15, y0: n.y - 0.15, x1: n.x + 0.15, y1: n.y + 0.15 },
      draw: (ctx, p) => drawNote(ctx, p, env, i, n.x, n.y, layerOf(env, n.z), t, taken ? since : -1),
      ghost: taken ? undefined : (ctx, p) => drawNoteHint(ctx, p, env, i, n.x, n.y, t),
    });
  }

  // Checkpoints.
  for (let i = 0; i < lv.checkpoints.length; i++) {
    const c = lv.checkpoints[i].pos;
    if (!inView(c.x - 0.6, c.y, c.x + 0.6, c.y + 1.6)) continue;
    out.push({
      z: c.z - 0.35,
      x0: c.x - 0.5,
      y0: c.y,
      x1: c.x + 0.5,
      y1: c.y + 1.5,
      draw: (ctx, p) => drawCheckpoint(ctx, p, env, game, i, frame),
    });
  }

  // The Fermata arch.
  {
    const e = lv.exit.pos;
    if (inView(e.x - 1.8, e.y - 0.2, e.x + 1.8, e.y + 4.6))
      out.push({
        z: e.z - 0.5,
        x0: e.x - 1.6,
        y0: e.y,
        x1: e.x + 1.6,
        y1: e.y + 4.4,
        draw: (ctx, p) => drawExit(ctx, p, env, game),
      });
  }

  // Drums.
  for (let i = 0; i < lv.drums.length; i++) {
    const d = lv.drums[i].pos;
    if (!inView(d.x - 0.3, d.y, d.x + 1.3, d.y + 1.6)) continue;
    out.push({
      z: d.z + 0.06,
      x0: d.x,
      y0: d.y,
      x1: d.x + 1,
      y1: d.y + 1.4,
      draw: (ctx, p) => drawDrum(ctx, p, env, d.x, d.y, layerOf(env, d.z), game.drumHit[i] ?? 9, i),
    });
  }

  // Piano keys.
  for (let i = 0; i < lv.keys.length; i++) {
    const k = lv.keys[i];
    if (!inView(k.pos.x, k.pos.y - 0.2, k.pos.x + k.width, k.pos.y + 0.3)) continue;
    out.push({
      z: k.pos.z + 0.02,
      x0: k.pos.x,
      y0: k.pos.y - 0.1,
      x1: k.pos.x + k.width,
      y1: k.pos.y + 0.25,
      draw: (ctx, p) => drawKey(ctx, p, env, game, i),
    });
  }

  // Bodies: gates and moving platforms (drums are drawn above).
  for (const b of game.bodies) {
    if (b.kind === 'gate') {
      if (!inView(b.min.x - 0.2, b.min.y, b.max.x + 0.2, b.max.y + 0.3)) continue;
      out.push({
        z: b.min.z,
        x0: b.min.x - 0.1,
        y0: b.min.y,
        x1: b.max.x + 0.1,
        y1: b.max.y + 0.2,
        draw: (ctx, p) => drawGate(ctx, p, env, game, b),
      });
    } else if (b.kind === 'platform') {
      const a = 1 - frame.alpha;
      const x0 = b.min.x - b.delta.x * a;
      const y0 = b.min.y - b.delta.y * a;
      const z0 = b.min.z - b.delta.z * a;
      const w = b.max.x - b.min.x;
      const h = b.max.y - b.min.y;
      if (!inView(x0 - 0.2, y0 - 1, x0 + w + 0.2, y0 + h + 0.2)) continue;
      out.push({
        z: z0,
        x0: x0 - 0.1,
        y0: y0 - 0.9,
        x1: x0 + w + 0.1,
        y1: y0 + h + 0.1,
        draw: (ctx, p) => drawPlatform(ctx, p, env, game, b, x0, y0, z0, w, h),
      });
    }
  }

  // Discords.
  for (let i = 0; i < game.discords.length; i++) {
    const d = game.discords[i];
    const x = d.prev.x + (d.pos.x - d.prev.x) * frame.alpha;
    const y = d.prev.y + (d.pos.y - d.prev.y) * frame.alpha;
    const z = d.prev.z + (d.pos.z - d.prev.z) * frame.alpha;
    if (!inView(x - 0.7, y - 0.7, x + 0.7, y + 0.7)) continue;
    out.push({
      z: z - 0.35,
      x0: x - 0.6,
      y0: y - 0.6,
      x1: x + 0.6,
      y1: y + 0.6,
      core: { x0: x - 0.3, y0: y - 0.3, x1: x + 0.3, y1: y + 0.3 },
      draw: (ctx, p) => drawDiscord(ctx, p, env, game, i, x, y, layerOf(env, z), frame),
    });
  }
}

// ---------------------------------------------------------------- notes

/** The note glyph in local units around its centre: head, stem and flag. */
export function noteShape(s: Sketch, fill: string, edgeLw: number, flagWave = 0): void {
  s.ellipse(-0.07, -0.17, 0.17, 0.125, 0.38, fill, edgeLw);
  s.shape([0.065, -0.15, 0.06, 0.34, 0.115, 0.34, 0.11, -0.13], fill, edgeLw * 0.7, { poly: true, misreg: false, ampM: 0.3 });
  s.shape([0.08, 0.34, 0.2 + flagWave * 0.02, 0.22, 0.28, 0.06 + flagWave * 0.02, 0.23, -0.03, 0.24, 0.1, 0.16, 0.2, 0.09, 0.24], fill, edgeLw * 0.7, { poly: true, misreg: false });
}

function drawNote(ctx: CanvasRenderingContext2D, p: Proj, env: Env, i: number, x: number, y: number, z: number, t: number, since: number): void {
  const T = env.tones;
  const bob = Math.sin(t * 2.1 + i * 1.7) * 0.07;
  const cy = y + bob + (since >= 0 ? since * 1.6 : 0);
  const turn = Math.cos(t * 1.6 + i * 1.3);
  const sx = Math.abs(turn) < 0.12 ? 0.12 * Math.sign(turn || 1) : turn;
  const X = p.ox + x * p.k;
  const Y = p.oy - cy * p.k;
  sk.set(ctx, env, p, x, cy, z, 1, 4001 + i * 37, p.boil);
  sk.tintAmt = 0.45;
  sk.weight = 0.75;
  const fade = since >= 0 ? Math.max(0, 1 - since / 0.7) : 1;
  ctx.save();
  ctx.globalAlpha = fade;
  // Soft radiance as a ring of short gold strokes (never a bloom).
  if (since < 0) sk.rays(0, -0.02, 0.38, 0.5, 9, css(mix(T.gold, T.paper, 0.15)), 0.35 * (0.7 + 0.3 * Math.sin(t * 3 + i)), t * 0.25 + i, 1);
  ctx.translate(X, Y);
  ctx.scale(sx, 1);
  ctx.translate(-X, -Y);
  const gold = turn >= 0 ? sk.col(T.gold, 0.6) : sk.col(mix(T.gold, T.goldDark, 0.35), 0.6);
  noteShape(sk, gold, since >= 0 ? 0.5 : 0.85, Math.sin(t * 5 + i));
  // Gold leaf: a bright crescent on the head and cracked-leaf flecks.
  if (turn > 0.2) {
    sk.blot(-0.11, -0.14, 0.08, 0.04, css(T.goldLight), 0.85);
    sk.marks([0.08, 0.3, 0.09, -0.05], css(T.goldLight), 1.2, 0.6);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  // A glint that travels round now and then.
  const g = Math.sin(t * 0.9 + i * 2.3);
  if (since < 0 && g > 0.93) {
    const k = (g - 0.93) / 0.07;
    ctx.beginPath();
    glintPath(ctx, X - 0.1 * p.k * sx, Y - 0.04 * p.k, p.k * 0.16 * k, t);
    ctx.fillStyle = 'rgba(255,252,236,0.95)';
    ctx.fill();
  }
}

/** A note hidden behind a column still shows a faint glint so the player knows it is there. */
function drawNoteHint(ctx: CanvasRenderingContext2D, p: Proj, env: Env, i: number, x: number, y: number, t: number): void {
  const T = env.tones;
  const X = p.ox + x * p.k;
  const Y = p.oy - (y + Math.sin(t * 2.1 + i * 1.7) * 0.07) * p.k;
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + i);
  // A small pool of shade so the sparkle reads on any material, then the sparkle itself.
  ctx.beginPath();
  ctx.arc(X, Y, p.k * 0.2, 0, TAU);
  ctx.fillStyle = env.pats.cross;
  ctx.globalAlpha = 0.7 + 0.2 * pulse;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + t * 0.3;
    const r0 = p.k * 0.22;
    const r1 = p.k * (0.3 + 0.06 * pulse);
    ctx.moveTo(X + Math.cos(a) * r0, Y + Math.sin(a) * r0);
    ctx.lineTo(X + Math.cos(a) * r1, Y + Math.sin(a) * r1);
  }
  ctx.strokeStyle = css(T.gold, 0.55 + 0.35 * pulse);
  ctx.lineWidth = Math.max(1, 1.3 * p.px);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  glintPath(ctx, X, Y, p.k * (0.13 + 0.06 * pulse), t * 0.4 + i);
  ctx.fillStyle = css([255, 252, 238], 0.75 + 0.25 * pulse);
  ctx.fill();
}

// ---------------------------------------------------------------- checkpoints

function drawCheckpoint(ctx: CanvasRenderingContext2D, p: Proj, env: Env, game: Game, i: number, frame: FrameInfo): void {
  const T = env.tones;
  const c = game.level.checkpoints[i].pos;
  const active = game.checkpointOn === i;
  const visited = game.checkpointAt[i] >= 0;
  sk.set(ctx, env, p, c.x, c.y, layerOf(env, c.z), 1, 5003 + i * 53, p.boil);
  sk.tintAmt = 0.7;
  const stone = T.pal.mats.stone.color;
  const wood = rgb(T.pal.mats.wood.color);
  const brass = rgb(T.pal.mats.brass.color);
  const since = visited ? game.time - game.checkpointAt[i] : 99;
  // Warm light when lit.
  if (visited) {
    const pulse = since < 0.8 ? 1 - since / 0.8 : 0;
    sk.rays(0, 0.95, 0.55 + pulse * 0.2, 0.85 + pulse * 0.6, 14, sk.col(T.gold, 0.5), (active ? 0.4 : 0.22) + pulse * 0.4, game.time * 0.2, 1.1);
  }
  sk.shape([-0.36, 0, -0.36, 0.16, 0.36, 0.16, 0.36, 0], sk.col(stone), 0.8, { poly: true, misreg: false });
  const body = [-0.27, 0.16, -0.1, 1.12, 0.1, 1.12, 0.27, 0.16];
  sk.shape(body, sk.col(visited ? mix(wood, brass, 0.25) : mix(wood, T.ink, 0.15)), 0.9, { poly: true, misreg: false });
  sk.clip(body, () => sk.blot(0.25, 0.6, 0.12, 0.6, env.pats.hatch, 0.5), true);
  // Face plate with tempo ticks.
  sk.shape([-0.12, 0.32, -0.06, 0.98, 0.06, 0.98, 0.12, 0.32], sk.col(mix(T.paper, brass, 0.3)), 0.5, { poly: true, misreg: false, ampM: 0.3 });
  const ticks: number[] = [];
  for (let k = 0; k < 6; k++) {
    const v = 0.42 + k * 0.1;
    ticks.push(-0.05, v, 0.05, v);
  }
  sk.marks(ticks, sk.col(T.ink), 0.8, 0.6);
  // The pendulum.
  const beat = frame.beat >= 0 ? frame.beat : game.time * (100 / 60);
  const ang = active ? 0.42 * Math.sin(Math.PI * beat) : 0;
  const px = 0;
  const py = 0.3;
  const len = 0.95;
  const tipX = px + Math.sin(ang) * len;
  const tipY = py + Math.cos(ang) * len;
  sk.seg(px, py, tipX, tipY, 0.75);
  const wx = px + Math.sin(ang) * len * 0.62;
  const wy = py + Math.cos(ang) * len * 0.62;
  sk.ellipse(wx, wy, 0.07, 0.05, ang, sk.col(visited ? T.gold : brass), 0.55);
  sk.dot(px, py, 0.035, sk.col(brass));
  if (active) sk.dot(tipX, tipY, 0.03, css(T.goldLight));
}

// ---------------------------------------------------------------- the Fermata arch

function drawExit(ctx: CanvasRenderingContext2D, p: Proj, env: Env, game: Game): void {
  const T = env.tones;
  const e = game.level.exit.pos;
  const pl = game.player;
  const dist = Math.hypot(pl.pos.x - e.x, pl.pos.y - e.y);
  const near = Math.max(0, Math.min(1, 1 - (dist - 1) / 7));
  const done = game.finished ? Math.min(1, (game.time - game.finishedAt) / 1.2) : 0;
  const glow = Math.min(1, near * 0.7 + done);
  const t = game.time;
  sk.set(ctx, env, p, e.x, e.y, layerOf(env, e.z), 1, 6007, p.boil);
  sk.tintAmt = 0.5;
  const stone = sk.col(T.pal.mats.marble.color);
  const ri = 0.92;
  const ro = 1.32;
  const ph = 2.25;
  // The veil: gold threads hanging in the opening, drifting.
  {
    const strands = 13;
    const segs: number[] = [];
    for (let s = 0; s < strands; s++) {
      const u0 = -ri + 0.08 + ((2 * ri - 0.16) * s) / (strands - 1);
      const topV = ph + Math.sqrt(Math.max(0, ri * ri - u0 * u0)) - 0.08;
      const sway = (v: number) => Math.sin(t * 1.4 + s * 0.9 + v * 2.2) * 0.04 * (1 + glow);
      for (let k = 0; k < 6; k++) {
        const v0 = 0.05 + (topV * k) / 6;
        const v1 = 0.05 + (topV * (k + 1)) / 6;
        segs.push(u0 + sway(v0), v0, u0 + sway(v1), v1);
      }
    }
    sk.marks(segs, css(mix(T.gold, T.goldLight, 0.5)), 1.1, 0.18 + 0.5 * glow);
    // Motes of light rising through it.
    for (let k = 0; k < 8; k++) {
      const ph2 = (t * (0.25 + hash(k, 1) * 0.2) + hash(k, 2)) % 1;
      const u = -ri * 0.8 + hash(k, 3) * ri * 1.6 + Math.sin(t + k) * 0.05;
      const v = ph2 * (ph + ri * 0.7);
      sk.dot(u, v, 0.025 + 0.02 * glow, css(T.goldLight), (0.3 + 0.6 * glow) * Math.sin(ph2 * Math.PI));
    }
  }
  // Piers, arch ring and keystone.
  for (const sd of [-1, 1]) {
    const pier = [sd * ri, 0, sd * ri, ph, sd * ro, ph, sd * ro, 0];
    sk.shape(pier, stone, 1, { poly: true, misreg: false });
    if (sd === 1) sk.clip(pier, () => sk.blot(ro, ph / 2, 0.22, ph, env.pats.hatch, 0.55), true);
    const joints: number[] = [];
    for (let v = 0.45; v < ph; v += 0.45) joints.push(sd * ri, v, sd * ro, v);
    sk.marks(joints, sk.darker(T.pal.mats.marble.color, 0.35), 0.9, 0.6);
    sk.shape([sd * (ri - 0.08), 0, sd * (ri - 0.08), 0.18, sd * (ro + 0.08), 0.18, sd * (ro + 0.08), 0], stone, 0.8, { poly: true, misreg: false });
  }
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI - (i / n) * Math.PI;
    const a1 = Math.PI - ((i + 1) / n) * Math.PI;
    const key = i === Math.floor(n / 2);
    const o = key ? ro + 0.14 : ro;
    sk.shape([Math.cos(a0) * ri, ph + Math.sin(a0) * ri, Math.cos(a0) * o, ph + Math.sin(a0) * o, Math.cos(a1) * o, ph + Math.sin(a1) * o, Math.cos(a1) * ri, ph + Math.sin(a1) * ri], stone, 0.8, { poly: true, misreg: false, ampM: 0.3 });
  }
  // The golden fermata: an arc over a dot, with radiating strokes.
  const fv = ph + ro + 0.62;
  const shimmer = 0.6 + 0.4 * Math.sin(t * 2.2);
  sk.rays(0, fv - 0.02, 0.62, 1.0 + 0.3 * glow, 20, css(T.gold), 0.3 + 0.35 * glow * shimmer, t * 0.15, 1.2);
  sk.tintAmt = 0.2;
  const gold = sk.col(T.gold);
  sk.shape([-0.62, fv - 0.16, -0.52, fv + 0.2, 0, fv + 0.4, 0.52, fv + 0.2, 0.62, fv - 0.16, 0.52, fv - 0.09, 0.4, fv + 0.1, 0, fv + 0.25, -0.4, fv + 0.1, -0.52, fv - 0.09], gold, 0.9, { misreg: false });
  sk.marks([-0.42, fv + 0.17, 0.06, fv + 0.32], css(T.goldLight), 1.6, 0.85);
  sk.ellipse(0, fv - 0.17, 0.11, 0.1, 0, gold, 0.8);
  sk.dot(-0.03, fv - 0.14, 0.03, css(T.goldLight), 0.9);
  if (Math.sin(t * 0.8) > 0.9) {
    const k = (Math.sin(t * 0.8) - 0.9) / 0.1;
    ctx.beginPath();
    glintPath(ctx, sk.X(-0.38), sk.Y(fv + 0.16), p.k * 0.26 * k, t);
    ctx.fillStyle = 'rgba(255,252,236,0.95)';
    ctx.fill();
  }
}

// ---------------------------------------------------------------- drums

function drawDrum(ctx: CanvasRenderingContext2D, p: Proj, env: Env, x: number, y: number, z: number, hit: number, i: number): void {
  const T = env.tones;
  sk.set(ctx, env, p, x + 0.5, y, z, 1, 7001 + i * 17, p.boil);
  sk.tintAmt = 0.7;
  const copper = mix(rgb('#b8683a'), rgb(T.pal.mats.brass.color), 0.25);
  const brass = rgb(T.pal.mats.brass.color);
  const cream = T.inv ? rgb('#e6e0cc') : rgb('#f1e6c8');
  const k = hit < 0.6 ? 1 - hit / 0.6 : 0;
  const dip = Math.sin(Math.min(1, hit / 0.18) * Math.PI) * 0.07 * (hit < 0.18 ? 1 : 0);
  // Legs.
  sk.seg(-0.3, 0.02, -0.2, 0.22, 0.7);
  sk.seg(0.3, 0.02, 0.2, 0.22, 0.7);
  sk.seg(0, 0.02, 0, 0.18, 0.6);
  const bowl = [-0.42, 0.6, -0.4, 0.4, -0.28, 0.22, 0, 0.14, 0.28, 0.22, 0.4, 0.4, 0.42, 0.6];
  sk.shape(bowl, sk.col(copper), 1);
  sk.clip(bowl, () => {
    sk.blot(0.3, 0.25, 0.3, 0.3, env.pats.cross, 0.55);
  });
  sk.marks([-0.3, 0.52, -0.26, 0.3], sk.lighter(copper, 0.55), 1.8, 0.7);
  // Rim, lugs and head.
  sk.shape([-0.45, 0.6, -0.45, 0.68, 0.45, 0.68, 0.45, 0.6], sk.col(brass), 0.7, { poly: true, misreg: false });
  const lugs: number[] = [];
  for (let l = -2; l <= 2; l++) lugs.push(l * 0.17, 0.62, l * 0.17, 0.5);
  sk.marks(lugs, sk.darker(brass, 0.4), 1.4, 0.8);
  sk.ellipse(0, 0.69 - dip, 0.43, 0.055, 0, sk.col(cream), 0.6);
  if (k > 0) {
    // Ripples over the head and rings of sound.
    const segs: number[] = [];
    for (let r = 0; r < 3; r++) {
      const rr = 0.1 + ((1 - k) * 0.5 + r * 0.12) % 0.45;
      segs.push(-rr, 0.69 - dip, rr, 0.69 - dip);
    }
    sk.marks(segs, sk.darker(cream, 0.35), 1, 0.6 * k);
    const ctx2 = ctx;
    ctx2.beginPath();
    for (let r = 0; r < 3; r++) {
      const rad = (0.35 + (1 - k) * 0.9 + r * 0.22) * p.k;
      ctx2.moveTo(sk.X(0) + Math.cos(-0.35 * Math.PI) * rad, sk.Y(0.75) + Math.sin(-0.35 * Math.PI) * rad);
      ctx2.arc(sk.X(0), sk.Y(0.75), rad, -0.85 * Math.PI, -0.15 * Math.PI);
    }
    ctx2.strokeStyle = sk.inkColor();
    ctx2.lineWidth = Math.max(1, 1.3 * p.px);
    ctx2.globalAlpha = 0.6 * k;
    ctx2.stroke();
    ctx2.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- keys

function drawKey(ctx: CanvasRenderingContext2D, p: Proj, env: Env, game: Game, i: number): void {
  const T = env.tones;
  const k = game.level.keys[i];
  const v = game.keyVis[i] ?? 0;
  const on = game.groups[k.group];
  sk.set(ctx, env, p, k.pos.x, k.pos.y, layerOf(env, k.pos.z), 1, 8009 + i * 23, p.boil);
  sk.tintAmt = 0.6;
  const ivory = T.inv ? rgb('#e8e4d6') : rgb('#f6efdc');
  const top = 0.16 - v * 0.11;
  const gc = T.groupsRGB[k.group % T.groupsRGB.length];
  const x0 = 0.05;
  const x1 = k.width - 0.05;
  sk.shape([x0, -0.02, x0, top, x1, top, x1, -0.02], sk.col(ivory), 0.85, { poly: true, misreg: false, ampM: 0.4 });
  sk.shape([x0 + 0.04, top - 0.005, x0 + 0.04, top - 0.05, x1 - 0.04, top - 0.05, x1 - 0.04, top - 0.005], css(mix(gc, [255, 255, 255], on ? 0.1 : 0.35)), 0, { poly: true, misreg: false, outline: false, alpha: on ? 0.95 : 0.7 });
  const divs: number[] = [];
  for (let c = 1; c < k.width; c++) divs.push(c, -0.01, c, top - 0.01);
  if (divs.length) sk.marks(divs, sk.inkColor(), 0.9, 0.7);
  if (v > 0.05) sk.marks([x0, top + 0.02, x1, top + 0.02], sk.darker(ivory, 0.5), 1, 0.5 * v);
}

// ---------------------------------------------------------------- gates

function drawGate(ctx: CanvasRenderingContext2D, p: Proj, env: Env, game: Game, b: Body): void {
  const T = env.tones;
  const def = game.level.gates[b.id];
  const vis = game.gateVis[b.id] ?? (b.solid ? 1 : 0);
  const gc = T.groups[def.group % T.groups.length];
  const ink = T.layers[0].ink;
  const X0 = p.ox + (b.min.x + 0.1) * p.k;
  const X1 = p.ox + (b.max.x - 0.1) * p.k;
  const Y0 = p.oy - b.min.y * p.k;
  const Y1 = p.oy - (b.max.y - 0.05) * p.k;
  const gold = css(mix(T.gold, T.goldLight, 0.15));
  const t = game.time;
  ctx.save();
  if (vis > 0.02) {
    // A gilded, hatched panel so a closed gate reads as a barrier.
    ctx.fillStyle = css(mix(T.gold, T.paper, 0.35), 0.4 * vis);
    ctx.fillRect(X0, Y1, X1 - X0, Y0 - Y1);
    ctx.fillStyle = env.pats.hatch;
    ctx.globalAlpha = 0.45 * vis;
    ctx.fillRect(X0, Y1, X1 - X0, Y0 - Y1);
    ctx.globalAlpha = 1;
  }
  const rails: number[] = [];
  const span = Y0 - Y1;
  for (let r = 0; r < 5; r++) rails.push(Y1 + span * (0.1 + (0.8 * r) / 4));
  const ext = 0.06 * p.k;
  if (vis > 0.02) {
    ctx.globalAlpha = vis;
    ctx.beginPath();
    for (const ry of rails) {
      const w = Math.sin(t * 2.2 + ry * 0.05) * 0.5 * p.px;
      ctx.moveTo(X0 - ext, ry + w);
      ctx.lineTo(X1 + ext, ry - w);
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(2.5, 4.6 * p.px);
    ctx.stroke();
    ctx.strokeStyle = gold;
    ctx.lineWidth = Math.max(1.5, 2.8 * p.px);
    ctx.stroke();
    ctx.strokeStyle = css(T.goldLight);
    ctx.lineWidth = Math.max(0.6, 0.9 * p.px);
    ctx.globalAlpha = 0.8 * vis;
    ctx.stroke();
  }
  if (vis < 0.98) {
    // Open: faint dotted ghosts of the rails.
    ctx.globalAlpha = 0.6 * (1 - vis);
    ctx.setLineDash([2.5 * p.px, 5 * p.px]);
    ctx.lineDashOffset = -t * 6 * p.px;
    ctx.beginPath();
    for (const ry of rails) {
      ctx.moveTo(X0, ry);
      ctx.lineTo(X1, ry);
    }
    ctx.strokeStyle = gold;
    ctx.lineWidth = Math.max(1, 1.8 * p.px);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Posts as bar lines, with group-coloured finials.
  ctx.globalAlpha = 0.3 + 0.7 * vis;
  ctx.beginPath();
  ctx.moveTo(X0, Y0);
  ctx.lineTo(X0, Y1);
  ctx.moveTo(X1, Y0);
  ctx.lineTo(X1, Y1);
  if (vis < 0.5) ctx.setLineDash([3 * p.px, 4 * p.px]);
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(2, 4 * p.px);
  ctx.stroke();
  ctx.strokeStyle = gold;
  ctx.lineWidth = Math.max(1, 1.4 * p.px);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.5 + 0.5 * vis;
  for (const X of [X0, X1]) {
    ctx.beginPath();
    ctx.arc(X, Y1 - 0.08 * p.k, 0.1 * p.k, 0, TAU);
    ctx.fillStyle = gc;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, 1.3 * p.px);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(X - 0.03 * p.k, Y1 - 0.11 * p.k, 0.03 * p.k, 0, TAU);
    ctx.fillStyle = 'rgba(255,250,236,0.8)';
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- moving platforms

function drawPlatform(ctx: CanvasRenderingContext2D, p: Proj, env: Env, game: Game, b: Body, x0: number, y0: number, z0: number, w: number, h: number): void {
  const T = env.tones;
  const def = game.level.platforms[b.id];
  const mat = rgb(T.pal.mats[def.mat].color);
  const brass = rgb(T.pal.mats.brass.color);
  const t = game.time;
  sk.set(ctx, env, p, x0, y0, layerOf(env, z0), 1, 9001 + b.id * 31, p.boil);
  sk.tintAmt = 0.65;
  // Soft light underneath, as fanned strokes.
  const segs: number[] = [];
  const n = Math.max(5, Math.round(w * 5));
  for (let i = 0; i < n; i++) {
    const u = (w * (i + 0.5)) / n;
    const len = 0.35 + 0.2 * Math.sin(t * 2.5 + i * 1.7);
    segs.push(u, -0.08, u + (u - w / 2) * 0.15, -0.08 - len);
  }
  sk.marks(segs, css(mix(T.gold, T.goldLight, 0.4)), 1, 0.35);
  // The stand: a stem fading below.
  const cx = w / 2;
  sk.seg(cx, 0, cx, -0.55, 0.7, undefined, 0.8);
  sk.seg(cx, -0.55, cx - 0.18, -0.75, 0.55, undefined, 0.5);
  sk.seg(cx, -0.55, cx + 0.18, -0.75, 0.55, undefined, 0.5);
  // The desk.
  const desk = [0, 0, 0, h, w, h, w, 0];
  sk.shape(desk, sk.col(mat), 1, { poly: true, misreg: false, ampM: 0.5 });
  sk.clip(desk, () => sk.blot(w, h * 0.2, w * 0.4, h * 0.5, env.pats.hatch, 0.45), true);
  sk.shape([0, h - 0.1, 0, h, w, h, w, h - 0.1], sk.col(brass), 0.6, { poly: true, misreg: false, ampM: 0.3 });
  sk.shape([0, 0, 0, 0.08, w, 0.08, w, 0], sk.col(brass), 0.6, { poly: true, misreg: false, ampM: 0.3 });
  // Sheet music pinned to the desk.
  const sheetX0 = 0.18;
  const sheetX1 = w - 0.18;
  if (h >= 0.6 && sheetX1 - sheetX0 > 0.4) {
    sk.shape([sheetX0, 0.16, sheetX0, h - 0.16, sheetX1, h - 0.16, sheetX1, 0.16], sk.col(mix(T.paper, [255, 252, 240], 0.4)), 0.4, { poly: true, misreg: false, ampM: 0.3 });
    const lines: number[] = [];
    const notes: number[] = [];
    for (let st = 0; st < 2; st++) {
      const base = 0.24 + st * (h - 0.42) * 0.5;
      for (let l = 0; l < 5; l++) lines.push(sheetX0 + 0.05, base + l * 0.035, sheetX1 - 0.05, base + l * 0.035);
      const m = Math.max(2, Math.floor((sheetX1 - sheetX0) / 0.35));
      for (let q = 0; q < m; q++) notes.push(sheetX0 + 0.15 + q * 0.33, base + (hash(b.id, st, q) * 4) * 0.035);
    }
    sk.marks(lines, sk.inkColor(), 0.6, 0.5);
    for (let q = 0; q < notes.length; q += 2) sk.dot(notes[q], notes[q + 1], 0.03, sk.inkColor(), 0.8);
  }
}

// ---------------------------------------------------------------- discords

function drawDiscord(ctx: CanvasRenderingContext2D, p: Proj, env: Env, game: Game, i: number, x: number, y: number, z: number, frame: FrameInfo): void {
  const T = env.tones;
  const restless = Math.floor(frame.now * 12);
  const jx = hs(i, restless, 1) * 0.03;
  const jy = hs(i, restless, 2) * 0.03;
  sk.set(ctx, env, p, x + jx, y + jy, z, 1, 10007 + i * 41, restless);
  sk.tintAmt = 0.35;
  const ink = T.inv ? css(mix(T.paper, [0, 0, 0], 0.6)) : css(mix(T.ink, [10, 6, 14], 0.4));
  const pl = game.player;
  // A scribbled tangle: loops re-scrawled a dozen times a second.
  for (let l = 0; l < 4; l++) {
    const ctrl: number[] = [];
    const pts = 6 + (l % 2);
    for (let k = 0; k < pts; k++) {
      const a = (k / pts) * TAU + hs(i, l, k, restless) * 0.5 + l;
      const r = 0.22 + hash(i, l * 7 + k, restless) * 0.2;
      ctrl.push(Math.cos(a) * r, Math.sin(a) * r * 0.9);
    }
    const pts2 = sk.pts(ctrl, true, 1.4);
    ctx.beginPath();
    for (let q = 0; q < pts2.length; q += 2) (q === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, pts2[q], pts2[q + 1]);
    ctx.closePath();
    if (l === 0) {
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.55;
      ctx.fill();
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, (1.2 + l * 0.3) * p.px);
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Spikes.
  const spikes: number[] = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU + hs(i, k, restless) * 0.3;
    spikes.push(Math.cos(a) * 0.3, Math.sin(a) * 0.28, Math.cos(a) * (0.45 + hash(i, k, restless + 1) * 0.12), Math.sin(a) * (0.42 + hash(i, k, restless + 2) * 0.12));
  }
  sk.marks(spikes, ink, 1.5, 0.85);
  // One red eye that follows the player.
  const dx = pl.pos.x - x;
  const dy = pl.pos.y + 0.45 - y;
  const dl = Math.hypot(dx, dy) || 1;
  const ex = (dx / dl) * 0.05;
  const ey = (dy / dl) * 0.05;
  const blink = noise1(game.time * 1.3 + i * 9, 3) > 0.85 ? 0.3 : 1;
  sk.ellipse(ex, ey + 0.02, 0.12, 0.12 * blink, 0, css(T.rubric), 0.6);
  sk.dot(ex + (dx / dl) * 0.04, ey + 0.02 + (dy / dl) * 0.04, 0.045 * blink, css(mix(T.ink, [0, 0, 0], 0.5)));
  sk.dot(ex - 0.04, ey + 0.06, 0.02 * blink, 'rgba(255,240,230,0.9)');
}
