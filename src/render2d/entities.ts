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
    if (!inView(k.pos.x, k.pos.y - 0.2, k.pos.x + k.width, k.pos.y + 0.5)) continue;
    out.push({
      z: k.pos.z + 0.02,
      x0: k.pos.x,
      y0: k.pos.y - 0.15,
      x1: k.pos.x + k.width,
      y1: k.pos.y + 0.45,
      // The part above the floor, so the floor the key is set into does not paint over it.
      core: { x0: k.pos.x + 0.15, y0: k.pos.y + 0.02, x1: k.pos.x + k.width - 0.15, y1: k.pos.y + 0.12 },
      draw: (ctx, p) => drawKey(ctx, p, env, game, i),
    });
  }

  // Bodies: gates and moving platforms (drums are drawn above).
  for (const b of game.bodies) {
    if (b.kind === 'gate') {
      if (!inView(b.min.x - 0.2, b.min.y, b.max.x + 0.2, b.max.y + 0.4)) continue;
      out.push({
        z: b.min.z,
        x0: b.min.x - 0.1,
        y0: b.min.y - 0.05,
        x1: b.max.x + 0.1,
        y1: b.max.y + 0.35,
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

/**
 * A piano key set into the floor, seen side on: an ivory cap with a rounded nose
 * and lip, on an ebony key body that stands in a slot in the ground. The whole
 * key sinks as it is pressed. The group's lozenge (the same mark its gates carry)
 * is inked on the ivory and brightens, with a few radiating strokes, when it goes down.
 */
function drawKey(ctx: CanvasRenderingContext2D, p: Proj, env: Env, game: Game, i: number): void {
  const T = env.tones;
  const k = game.level.keys[i];
  const v = game.keyVis[i] ?? 0;
  const on = game.groups[k.group];
  sk.set(ctx, env, p, k.pos.x, k.pos.y, layerOf(env, k.pos.z), 1, 8009 + i * 23, p.boil);
  sk.tintAmt = 0.4;
  const w = k.width;
  const ivory = T.inv ? rgb('#ece6d4') : rgb('#fbf3de');
  const ebony = T.inv ? rgb('#11131f') : mix(T.ink, [12, 8, 10], 0.5);
  const gc = T.groupsRGB[k.group % T.groupsRGB.length];
  const top = 0.24 - v * 0.17;
  const capH = 0.12;
  const x0 = 0.1;
  const x1 = w - 0.1;
  // The slot, a dark keybed cut into the floor, and the ebony key body standing in it.
  sk.shape([x0 - 0.04, -0.12, x0 - 0.04, 0.015, x1 + 0.04, 0.015, x1 + 0.04, -0.12], css(mix(ebony, T.shade, 0.3)), 0.55, { poly: true, misreg: false, ampM: 0.2 });
  sk.shape([x0 + 0.03, -0.1, x0 + 0.03, top - capH + 0.01, x1 - 0.06, top - capH + 0.01, x1 - 0.06, -0.1], css(ebony), 0.5, { poly: true, misreg: false, ampM: 0.2 });
  // The ivory cap: square at the back (left), a rounded nose and lip at the front (right).
  const c0 = top - capH;
  const cap = [x0, c0, x0, top, x1 - 0.06, top, x1 - 0.015, top - 0.02, x1, top - 0.055, x1 - 0.005, c0 + 0.02, x1 - 0.03, c0 - 0.01];
  sk.shape(cap, sk.col(ivory), 0.75, { poly: true, misreg: false, ampM: 0.2 });
  sk.marks([x0 + 0.04, top - 0.03, x1 - 0.08, top - 0.03], 'rgba(255,253,245,0.95)', 1.3, 0.9);
  sk.marks([x0 + 0.02, c0 + 0.025, x1 - 0.05, c0 + 0.025], sk.darker(ivory, 0.3), 1.2, 0.55);
  // The group mark on the ivory: muted at rest, full colour with rays when pressed or when its group is on.
  const lit = Math.max(v, on ? 0.6 : 0);
  const mv = top - capH / 2;
  const mr = 0.055;
  const mc = css(mix(mix(gc, ivory, 0.25), gc, lit));
  sk.shape([w / 2, mv - mr, w / 2 + mr * 1.5, mv, w / 2, mv + mr, w / 2 - mr * 1.5, mv], mc, 0.45, { poly: true, misreg: false, ampM: 0.15 });
  if (v > 0.05) {
    const segs: number[] = [];
    const n = 5;
    for (let q = 0; q < n; q++) {
      const a = Math.PI * (0.2 + (0.6 * q) / (n - 1));
      const r0 = 0.22;
      const r1 = 0.22 + 0.16 * v;
      segs.push(w / 2 + Math.cos(a) * r0 * 1.6, top + Math.sin(a) * r0, w / 2 + Math.cos(a) * r1 * 1.6, top + Math.sin(a) * r1);
    }
    sk.marks(segs, css(gc), 1.4, 0.75 * v);
  }
}

// ---------------------------------------------------------------- gates

/**
 * Gates come in three shapes, all gold leaf crossed by a five-line staff:
 * upright grilles of spear-topped bars (taller than wide), gilded step blocks
 * (wide and tall, the golden stairs) and planks (one cell tall, the bridges).
 * A solid gate rises out of the floor (a plank inks itself across) as the key
 * raises it; an open one is a faint dotted ghost.
 */
function drawGate(ctx: CanvasRenderingContext2D, p: Proj, env: Env, game: Game, b: Body): void {
  const def = game.level.gates[b.id];
  const vis = game.gateVis[b.id] ?? (b.solid ? 1 : 0);
  const w = b.max.x - b.min.x;
  const h = b.max.y - b.min.y;
  const shape = h <= 1.05 ? 'plank' : w >= 1.5 ? 'step' : 'bars';
  const t = game.time;
  sk.set(ctx, env, p, b.min.x, b.min.y, layerOf(env, b.min.z), 1, 8501 + b.id * 29, p.boil);
  sk.tintAmt = 0.3;
  if (vis < 0.98) drawGateGhost(ctx, p, env, def.group, shape, w, h, 1 - vis, t);
  if (vis <= 0.02) return;
  // Ease the reveal so the last stretch settles rather than snaps.
  const e = 1 - (1 - vis) * (1 - vis);
  ctx.save();
  if (vis < 0.98) {
    ctx.beginPath();
    if (shape === 'plank') ctx.rect(sk.X(-0.2), sk.Y(h + 0.4), sk.D(w * e + 0.2), sk.D(h + 0.6));
    else ctx.rect(sk.X(-0.3), sk.Y(h * e + (shape === 'bars' ? 0.4 : 0.1)), sk.D(w + 0.6), sk.D(h * e + 0.6));
    ctx.clip();
  }
  const g = solidGate(p, env, b, def.group, shape, w, h);
  if (g) ctx.drawImage(g.canvas, g.x, g.y);
  else {
    sk.set(ctx, env, p, b.min.x, b.min.y, layerOf(env, b.min.z), 1, 8501 + b.id * 29, p.boil);
    sk.tintAmt = 0.3;
    drawGateShape(env, def.group, shape, w, h, b.id);
  }
  ctx.restore();
}

/**
 * Solid gates are drawn once per boil drawing (three, as the cached page is) into a
 * small canvas and stamped each frame, so a wall of gold costs a single image.
 */
const GATE_PAD = 0.4;
const gateCanvases = new Map<string, HTMLCanvasElement>();
let gateStamp = '';
let gateEnv: Env | null = null;
let pendingStamp = '';
let pendingAt = 0;

function drawGateShape(env: Env, group: number, shape: string, w: number, h: number, id: number): void {
  if (shape === 'bars') drawGateBars(env, group, w, h, id);
  else if (shape === 'step') drawGateStep(env, group, w, h, id);
  else drawGatePlank(env, group, w, h, id);
}

/** The cached solid gate, or null while the page scale is still changing (drawn live then). */
function solidGate(p: Proj, env: Env, b: Body, group: number, shape: string, w: number, h: number): { canvas: HTMLCanvasElement; x: number; y: number } | null {
  const x = Math.floor(p.ox + (b.min.x - GATE_PAD) * p.k);
  const y = Math.floor(p.oy - (b.max.y + GATE_PAD) * p.k);
  // The page sits on a fixed device-pixel grid, so only the scale and the sub-pixel phase matter.
  const fx = p.ox + (b.min.x - GATE_PAD) * p.k - x;
  const fy = p.oy - (b.max.y + GATE_PAD) * p.k - y;
  const stamp = `${p.k}|${p.px}|${p.dpr}`;
  if (stamp !== gateStamp || env !== gateEnv) {
    // Wait for the scale to settle (a zoom changes it every frame) before caching at it.
    if (stamp !== pendingStamp || env !== gateEnv) {
      pendingStamp = stamp;
      pendingAt = env.now;
      gateEnv = env;
      gateCanvases.clear();
    }
    if (env.now - pendingAt < 0.15) return null;
    gateStamp = stamp;
  }
  const v = ((p.boil % 3) + 3) % 3;
  const key = `${b.id}|${v}|${fx.toFixed(2)}|${fy.toFixed(2)}`;
  let canvas = gateCanvases.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = Math.ceil((w + GATE_PAD * 2) * p.k) + 2;
    canvas.height = Math.ceil((h + GATE_PAD * 2) * p.k) + 2;
    const g = canvas.getContext('2d')!;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const q: Proj = { ...p, ox: p.ox - x, oy: p.oy - y, boil: v };
    sk.set(g, env, q, b.min.x, b.min.y, layerOf(env, b.min.z), 1, 8501 + b.id * 29, v);
    sk.tintAmt = 0.3;
    drawGateShape(env, group, shape, w, h, b.id);
    gateCanvases.set(key, canvas);
  }
  return { canvas, x, y };
}

/** Positions of the five staff lines of a staff centred on `v`. */
function staffLines(v: number, gap: number): number[] {
  return [v - 2 * gap, v - gap, v, v + gap, v + 2 * gap];
}

/** Staff centres on a gate face: one per three cells of height on a grille, one under a step's tread. */
function gateStaffs(shape: string, h: number): number[] {
  if (shape === 'plank') return [h * 0.52];
  if (shape === 'step') return [h - 0.48];
  const n = Math.max(1, Math.round(h / 3));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((h * (i + 0.5)) / n);
  return out;
}

/** A lozenge in the group colour (the mark the gate shares with its key). */
function groupMark(env: Env, group: number, u: number, v: number, r: number): void {
  const T = env.tones;
  const gc = T.groupsRGB[group % T.groupsRGB.length];
  sk.shape([u, v - r, u + r * 0.8, v, u, v + r, u - r * 0.8, v], css(gc), 0.6, { poly: true, misreg: false, ampM: 0.2 });
  sk.dot(u - r * 0.2, v + r * 0.3, r * 0.22, 'rgba(255,250,236,0.85)');
}

/** Cracked gold leaf: a scatter of bright flecks inside a rectangle. */
function goldFlecks(env: Env, u0: number, v0: number, u1: number, v1: number, n: number, seed: number): void {
  const ctx = sk.ctx;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = sk.X(u0 + hash(seed, i, 1) * (u1 - u0));
    const y = sk.Y(v0 + hash(seed, i, 2) * (v1 - v0));
    const r = Math.max(0.6, sk.D(0.012 + hash(seed, i, 3) * 0.018));
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
  ctx.fillStyle = css(env.tones.goldLight);
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function gateGold(env: Env, dark = 0): string {
  const T = env.tones;
  return sk.col(mix(mix(T.gold, T.goldLight, 0.12), T.goldDark, dark));
}

/** An upright grille: spear-topped gilded bars between gold rails, crossed by staves. */
function drawGateBars(env: Env, group: number, w: number, h: number, id: number): void {
  const T = env.tones;
  const ink = sk.inkColor();
  const gold = gateGold(env);
  const goldDim = gateGold(env, 0.3);
  // A dark gilded ground between the bars so the grille reads as a wall, not a frame.
  sk.region([0.08, 0.05, 0.08, h - 0.1, w - 0.08, h - 0.1, w - 0.08, 0.05], sk.col(mix(T.goldDark, T.gold, 0.35)), T.inv ? 0.5 : 0.42, true);
  sk.region([0.08, 0.05, 0.08, h - 0.1, w - 0.08, h - 0.1, w - 0.08, 0.05], env.pats.cross, 0.55, true);
  const nb = Math.max(3, Math.round(w * 4));
  const bw = 0.075;
  const top = h - 0.02;
  for (let i = 0; i < nb; i++) {
    const u = 0.14 + ((w - 0.28) * i) / (nb - 1);
    sk.shape([u - bw / 2, 0, u - bw / 2, top, u + bw / 2, top, u + bw / 2, 0], gold, 0.55, { poly: true, misreg: false, ampM: 0.25 });
    // Spear point above the top rail.
    sk.shape([u - 0.075, top + 0.02, u, top + 0.3, u + 0.075, top + 0.02], goldDim, 0.55, { poly: true, misreg: false, ampM: 0.2 });
  }
  // Shade down the right of each bar and a lit edge on the left.
  const shade: number[] = [];
  const lit: number[] = [];
  for (let i = 0; i < nb; i++) {
    const u = 0.14 + ((w - 0.28) * i) / (nb - 1);
    shade.push(u + bw * 0.3, 0.05, u + bw * 0.3, top - 0.05);
    lit.push(u - bw * 0.2, 0.08, u - bw * 0.2, top - 0.08);
  }
  sk.marks(shade, sk.darker(T.gold, 0.5), 1.1, 0.7);
  sk.marks(lit, css(T.goldLight), 0.9, 0.8);
  // Rails: a heavy foot and a capping rail.
  sk.shape([-0.04, 0, -0.04, 0.16, w + 0.04, 0.16, w + 0.04, 0], goldDim, 0.8, { poly: true, misreg: false, ampM: 0.3 });
  sk.shape([-0.04, top - 0.16, -0.04, top, w + 0.04, top, w + 0.04, top - 0.16], gold, 0.8, { poly: true, misreg: false, ampM: 0.3 });
  sk.marks([0, top - 0.04, w, top - 0.04], css(T.goldLight), 1, 0.8);
  // Staves: five fine lines crossing the bars, with the group's lozenge as their clef.
  const lines: number[] = [];
  for (const v of gateStaffs('bars', h)) for (const lv of staffLines(v, 0.07)) lines.push(-0.06, lv, w + 0.06, lv);
  sk.marks(lines, ink, 1, 0.85);
  for (const v of gateStaffs('bars', h)) groupMark(env, group, w / 2, v, 0.15);
  goldFlecks(env, 0.1, 0.2, w - 0.1, top - 0.2, Math.round(h * 4), 900 + id);
}

/** A gilded step: a solid block of gold leaf with a tread to stand on and a staff under the nosing. */
function drawGateStep(env: Env, group: number, w: number, h: number, id: number): void {
  const T = env.tones;
  const ink = sk.inkColor();
  const body = [0.02, 0, 0.02, h - 0.14, w - 0.02, h - 0.14, w - 0.02, 0];
  sk.shape(body, gateGold(env, 0.08), 0.9, { poly: true, misreg: false, ampM: 0.3 });
  sk.clip(
    body,
    () => {
      // Volume: hatched shade down the right and under the tread, a warm lit band on the left.
      sk.blot(w, h * 0.45, w * 0.35, h * 0.7, env.pats.hatch, 0.6);
      sk.blot(w / 2, h - 0.14, w * 0.8, 0.12, env.pats.cross, 0.55);
      sk.blot(0.15, h * 0.5, 0.18, h * 0.6, css(T.goldLight), 0.35);
      // Faint seams where the sheets of leaf were laid, staggered so they never line up into rungs.
      const seams: number[] = [];
      for (let v = 0.55, r = 0; v < h - 0.6; v += 0.55, r++) {
        const off = r % 2 ? 0.5 : 0;
        for (let u = 0.5 + off; u < w - 0.1; u += 1) seams.push(u, v - 0.5, u, v);
      }
      sk.marks(seams, sk.darker(T.gold, 0.4), 0.8, 0.35);
    },
    true,
  );
  // Courses every two cells, level with the neighbouring treads, so the stair reads as stacked blocks.
  const courses: number[] = [];
  const lits: number[] = [];
  for (let v = h - 2; v > 0.5; v -= 2) {
    courses.push(0.02, v, w - 0.02, v);
    lits.push(0.06, v + 0.05, w - 0.06, v + 0.05);
  }
  if (courses.length) {
    sk.marks(courses, ink, 1.4, 0.75);
    sk.marks(lits, css(T.goldLight), 1, 0.6);
  }
  // The tread: a lighter gold board with a rounded nosing that overhangs the riser.
  sk.shape([-0.05, h - 0.16, -0.08, h - 0.08, -0.05, h, w + 0.05, h, w + 0.08, h - 0.08, w + 0.05, h - 0.16], sk.col(mix(T.gold, T.goldLight, 0.45)), 0.9, { poly: true, misreg: false, ampM: 0.25 });
  sk.marks([0.05, h - 0.035, w - 0.05, h - 0.035], css(T.goldLight), 1.3, 0.9);
  // Staff engraved beneath the nosing.
  const lines: number[] = [];
  const sv = gateStaffs('step', h)[0];
  for (const lv of staffLines(sv, 0.085)) lines.push(0.08, lv, w - 0.08, lv);
  lines.push(w - 0.3, sv - 0.17, w - 0.3, sv + 0.17);
  sk.marks(lines, ink, 1, 0.85);
  sk.marks([w - 0.2, sv - 0.17, w - 0.2, sv + 0.17], ink, 2.2, 0.85);
  groupMark(env, group, 0.3, sv, 0.15);
  // A few engraved notes climbing the staff, as a stair should.
  for (let q = 0; q < 3; q++) {
    const u = 0.62 + q * ((w - 1.1) / 2);
    const v = sv - 0.085 + q * 0.085;
    sk.ellipse(u, v, 0.07, 0.05, 0.35, ink, 0, 0.85);
    sk.marks([u + 0.06, v, u + 0.06, v + 0.24], ink, 1.1, 0.85);
  }
  goldFlecks(env, 0.1, 0.15, w - 0.1, h - 0.3, Math.min(16, Math.round(w * h * 1.5)), 1300 + id);
}

/** A gilded plank: one cell deep, a staff running its length, bar lines at each measure. */
function drawGatePlank(env: Env, group: number, w: number, h: number, id: number): void {
  const T = env.tones;
  const ink = sk.inkColor();
  const v0 = 0.14;
  const v1 = h - 0.02;
  const board = [-0.02, v0, -0.02, v1, w + 0.02, v1, w + 0.02, v0];
  sk.shape(board, gateGold(env, 0.05), 0.9, { poly: true, misreg: false, ampM: 0.3 });
  sk.clip(
    board,
    () => {
      sk.region([-0.1, v0, -0.1, v0 + 0.22, w + 0.1, v0 + 0.22, w + 0.1, v0], env.pats.hatch, 0.6, true);
      sk.region([-0.1, v1 - 0.12, -0.1, v1, w + 0.1, v1, w + 0.1, v1 - 0.12], css(T.goldLight), 0.45, true);
    },
    true,
  );
  // The staff along it, bar lines every two cells and a double bar at each end.
  const sv = gateStaffs('plank', h)[0];
  const lines: number[] = [];
  for (const lv of staffLines(sv, 0.11)) lines.push(0.06, lv, w - 0.06, lv);
  for (let u = 2; u < w - 0.5; u += 2) lines.push(u, sv - 0.22, u, sv + 0.22);
  sk.marks(lines, ink, 1, 0.8);
  sk.marks([0.08, sv - 0.22, 0.08, sv + 0.22, w - 0.08, sv - 0.22, w - 0.08, sv + 0.22], ink, 2.2, 0.85);
  sk.marks([0.17, sv - 0.22, 0.17, sv + 0.22, w - 0.17, sv - 0.22, w - 0.17, sv + 0.22], ink, 1, 0.85);
  sk.marks([0.02, v1 - 0.03, w - 0.02, v1 - 0.03], css(T.goldLight), 1.3, 0.9);
  groupMark(env, group, 0.42, sv, 0.13);
  if (w > 3) groupMark(env, group, w - 0.42, sv, 0.13);
  goldFlecks(env, 0.1, v0 + 0.1, w - 0.1, v1 - 0.1, Math.round(w * 4), 1700 + id);
}

/** The open gate: its outline and staves as faint dotted gold, drifting slowly. */
function drawGateGhost(ctx: CanvasRenderingContext2D, p: Proj, env: Env, group: number, shape: string, w: number, h: number, a: number, t: number): void {
  const T = env.tones;
  const gold = css(mix(T.gold, T.goldLight, 0.15));
  const vb = shape === 'plank' ? 0.14 : 0;
  const top = shape === 'step' ? h : h - 0.02;
  ctx.save();
  ctx.globalAlpha = 0.6 * a;
  ctx.setLineDash([2.5 * p.px, 5 * p.px]);
  ctx.lineDashOffset = -t * 6 * p.px;
  ctx.beginPath();
  for (const v of gateStaffs(shape, h)) {
    const gap = shape === 'plank' ? 0.11 : 0.07;
    for (const lv of staffLines(v, gap)) {
      ctx.moveTo(sk.X(0.06), sk.Y(lv));
      ctx.lineTo(sk.X(w - 0.06), sk.Y(lv));
    }
  }
  ctx.strokeStyle = gold;
  ctx.lineWidth = Math.max(1, 1.5 * p.px);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(sk.X(0.04), sk.Y(top), sk.D(w - 0.08), sk.D(top - vb));
  if (shape === 'bars') {
    const nb = Math.max(3, Math.round(w * 4));
    for (let i = 1; i < nb - 1; i++) {
      const u = 0.14 + ((w - 0.28) * i) / (nb - 1);
      ctx.moveTo(sk.X(u), sk.Y(0));
      ctx.lineTo(sk.X(u), sk.Y(top));
    }
  }
  ctx.setLineDash([3 * p.px, 4 * p.px]);
  ctx.lineWidth = Math.max(1, 1.2 * p.px);
  ctx.globalAlpha = 0.45 * a;
  ctx.stroke();
  ctx.setLineDash([]);
  // The group's lozenge stays faintly visible so the gate can still be matched to its key.
  const gc = T.groupsRGB[group % T.groupsRGB.length];
  ctx.globalAlpha = 0.55 * a;
  ctx.fillStyle = css(gc);
  ctx.beginPath();
  for (const v of gateStaffs(shape, h)) {
    const u = shape === 'bars' ? w / 2 : shape === 'step' ? 0.32 : 0.42;
    const r = 0.12;
    ctx.moveTo(sk.X(u), sk.Y(v - r));
    ctx.lineTo(sk.X(u + r * 0.8), sk.Y(v));
    ctx.lineTo(sk.X(u), sk.Y(v + r));
    ctx.lineTo(sk.X(u - r * 0.8), sk.Y(v));
    ctx.closePath();
  }
  ctx.fill();
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
