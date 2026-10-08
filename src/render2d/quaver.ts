import { PHYS, type Game } from '../game/sim';
import { groundBelow } from '../render/ground';
import type { FrameInfo } from '../render/types';
import { css, mix } from './color';
import type { Env, Proj } from './env';
import { curvePts, ellipsePts, polyPath, ribbonPath, ringPath } from './ink';
import { hash, noise1 } from './rand';

/**
 * Quaver on the page: an eighth note come to life, in solid ink with a highlight
 * crescent, a gold flag and a vermilion scarf. Every pose is computed from the
 * same simulation state the stage reads; only the flag and scarf keep a little
 * spring state of their own so they trail behind with momentum.
 */

const P: number[] = [];

interface Tail {
  x: number[];
  y: number[];
  px: number[];
  py: number[];
}

const SEG = 0.1;
const LINKS = 8;

export interface QuaverPose {
  /** Feet position (interpolated). */
  x: number;
  y: number;
  z: number;
  visible: boolean;
  alpha: number;
}

export class QuaverPainter {
  private face = 1;
  private flagAng = -0.95;
  private flagVel = 0;
  private tails: Tail[] = [this.newTail(), this.newTail()];
  private lastNow = -1;
  private anchorX = NaN;
  private anchorY = NaN;
  /** Game time of the last respawn (set by the page from events). */
  respawnAt = -99;
  pose: QuaverPose = { x: 0, y: 0, z: 0, visible: true, alpha: 1 };

  private newTail(): Tail {
    return { x: new Array(LINKS).fill(0), y: new Array(LINKS).fill(0), px: new Array(LINKS).fill(0), py: new Array(LINKS).fill(0) };
  }

  reset(): void {
    this.anchorX = NaN;
    this.lastNow = -1;
    this.respawnAt = -99;
    this.face = 1;
  }

  /** Advances the flag and scarf springs and works out where Quaver is this frame. */
  update(game: Game, frame: FrameInfo): QuaverPose {
    const pl = game.player;
    const a = frame.alpha;
    const x = pl.prev.x + (pl.pos.x - pl.prev.x) * a;
    const y = pl.prev.y + (pl.pos.y - pl.prev.y) * a;
    const z = pl.prev.z + (pl.pos.z - pl.prev.z) * a;
    let dt = this.lastNow < 0 ? 0 : frame.now - this.lastNow;
    this.lastNow = frame.now;
    if (dt > 0.25) {
      // We were hidden; start fresh rather than whip the scarf across the page.
      this.anchorX = NaN;
      dt = 0;
    }
    dt = Math.min(dt, 1 / 30) * (frame.paused ? 0 : Math.max(0.35, frame.gameDt > 0 ? 1 : 0.35));

    // Turn smoothly: the body flattens to nothing and back as it turns round.
    this.face += (pl.facing - this.face) * (1 - Math.exp(-dt * 22));
    if (Math.abs(this.face) < 0.02 && dt === 0) this.face = pl.facing;

    // The flag streams away from the motion and droops under its own weight.
    const fwd = pl.vel.x * pl.facing;
    const dx = 1.1 - fwd * 0.85;
    const dy = -1.5 - pl.vel.y * 0.32;
    // Keep the flag on the lower and rear side of its swing so it never whips over the top.
    let target = Math.atan2(dy, dx);
    if (target > 1.05) target = target > 2.4 ? -Math.PI + 0.08 : 1.05;
    target = Math.max(-Math.PI + 0.08, target);
    const diff = target - this.flagAng;
    const k = 70;
    const c = 10;
    this.flagVel += (diff * k - this.flagVel * c) * dt;
    this.flagAng = Math.max(-Math.PI + 0.05, Math.min(1.1, this.flagAng + this.flagVel * dt));

    // Scarf tails: verlet chains hung from the knot, blown back by the motion.
    const knot = this.knotWorld(x, y, pl.facing);
    if (!Number.isFinite(this.anchorX) || Math.hypot(knot.x - this.anchorX, knot.y - this.anchorY) > 1.2) {
      for (let ti = 0; ti < 2; ti++) {
        const t = this.tails[ti];
        for (let i = 0; i < LINKS; i++) {
          t.x[i] = t.px[i] = knot.x - pl.facing * i * SEG * 0.85;
          t.y[i] = t.py[i] = knot.y - i * SEG * 0.5 - ti * 0.02;
        }
      }
    }
    this.anchorX = knot.x;
    this.anchorY = knot.y;
    if (dt > 0) {
      const wind = -pl.vel.x * 0.9;
      const lift = -pl.vel.y * 0.25;
      for (let ti = 0; ti < 2; ti++) {
        const t = this.tails[ti];
        t.x[0] = t.px[0] = knot.x;
        t.y[0] = t.py[0] = knot.y - ti * 0.03;
        const flutter = noise1(frame.now * 6 + ti * 3, 11 + ti) * (0.6 + Math.abs(pl.vel.x) * 0.25);
        for (let i = 1; i < LINKS; i++) {
          const vx = (t.x[i] - t.px[i]) * 0.86;
          const vy = (t.y[i] - t.py[i]) * 0.86;
          t.px[i] = t.x[i];
          t.py[i] = t.y[i];
          // A steady drape backwards so the tails fall behind the stem, never over the face.
          const fx = wind * 4.5 - pl.facing * 20 + flutter * 7 * (i / LINKS);
          const fy = -8 + lift * 6 + flutter * 4;
          t.x[i] += vx + fx * dt * dt;
          t.y[i] += vy + fy * dt * dt;
        }
        const len = SEG * (ti === 0 ? 1 : 0.8);
        for (let it = 0; it < 3; it++)
          for (let i = 1; i < LINKS; i++) {
            const ddx = t.x[i] - t.x[i - 1];
            const ddy = t.y[i] - t.y[i - 1];
            const d = Math.hypot(ddx, ddy) || 1e-6;
            const m = (d - len) / d;
            t.x[i] -= ddx * m;
            t.y[i] -= ddy * m;
          }
      }
    }
    const fin = game.finished ? game.time - game.finishedAt : -1;
    const alpha = fin > 1.3 ? Math.max(0, 1 - (fin - 1.3) / 0.9) : 1;
    this.pose = { x, y, z, visible: pl.dead <= 0 && alpha > 0, alpha };
    return this.pose;
  }

  private knotWorld(x: number, y: number, facing: number): { x: number; y: number } {
    return { x: x + facing * 0.22, y: y + 0.7 };
  }

  /** Squash, stretch, lean and other pose numbers for this frame. */
  private shape(game: Game) {
    const pl = game.player;
    const t = game.time;
    const run = Math.min(1, Math.abs(pl.vel.x) / PHYS.run);
    const phase = (pl.walk / (PHYS.stepEvery * 2)) * Math.PI * 2;
    let sx = 1;
    let sy = 1;
    let bob = 0;
    if (pl.grounded) {
      bob = Math.abs(Math.sin(phase)) * 0.05 * run;
      sy *= 1 + 0.045 * Math.sin(phase * 2) * run;
      sx *= 1 - 0.03 * Math.sin(phase * 2) * run;
      if (run < 0.1) {
        const br = Math.sin(t * 2.6);
        sy *= 1 + 0.028 * br;
        sx *= 1 - 0.018 * br;
      }
    } else {
      const v = pl.vel.y;
      const st = v > 0 ? Math.min(1, v / PHYS.jumpV) * 0.16 : Math.min(1, -v / PHYS.maxFall) * 0.1;
      sy *= 1 + st;
      sx *= 1 - st * 0.7;
    }
    if (pl.sinceJump < 0.22) {
      const j = 1 - pl.sinceJump / 0.22;
      sy *= 1 + 0.16 * j * j;
      sx *= 1 - 0.12 * j * j;
    }
    if (pl.sinceLand < 0.24 && pl.grounded) {
      const imp = Math.min(1, pl.lastImpact / 20);
      const u = pl.sinceLand / 0.24;
      const sq = imp * Math.sin((1 - u) * Math.PI * 0.5) * (1 - u * 0.3);
      sy *= 1 - 0.34 * sq;
      sx *= 1 + 0.3 * sq;
    }
    // Respawn: the ink gathers back into shape.
    const sinceSpawn = t - this.respawnAt;
    if (sinceSpawn >= 0 && sinceSpawn < 0.35) {
      const u = sinceSpawn / 0.35;
      const c1 = 1.9;
      const e = 1 + (c1 + 1) * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
      sx *= 0.4 + 0.6 * e;
      sy *= 0.2 + 0.8 * e;
    }
    // Victory: a twirl and a hop.
    let twirl = 1;
    let hop = 0;
    if (game.finished) {
      const f = game.time - game.finishedAt;
      if (f < 1.0) {
        twirl = Math.cos(f * Math.PI * 2 * 1.5);
        hop = Math.sin(Math.min(1, f / 0.7) * Math.PI) * 0.4;
      }
    }
    const lean = -run * 0.14 * (pl.grounded ? 1 : 0.5) + (pl.grounded ? 0 : Math.max(-0.12, Math.min(0.12, pl.vel.y * 0.006)));
    // Blinks: a deterministic rhythm with the occasional double blink.
    const cyc = 3.6;
    const bt = (t + 0.7) % cyc;
    const dbl = hash(Math.floor((t + 0.7) / cyc), 3) < 0.3;
    let blink = 1;
    if (bt < 0.12) blink = Math.abs(bt - 0.06) / 0.06;
    else if (dbl && bt > 0.22 && bt < 0.34) blink = Math.abs(bt - 0.28) / 0.06;
    blink = Math.max(0.12, blink);
    if (pl.sinceLand < 0.15 && pl.lastImpact > 12) blink = Math.min(blink, 0.35);
    const wide = !pl.grounded && pl.vel.y < -12 ? 1.18 : 1;
    return { run, phase, sx, sy, bob, twirl, hop, lean, blink, wide };
  }

  draw(ctx: CanvasRenderingContext2D, p: Proj, env: Env, game: Game, frame: FrameInfo): void {
    const pose = this.pose;
    if (!pose.visible) return;
    const T = env.tones;
    const pl = game.player;
    const sh = this.shape(game);
    const k = p.k;
    const X = p.ox + pose.x * k;
    const Y = p.oy - (pose.y + sh.hop) * k;
    const face = (Math.abs(this.face) < 0.15 ? 0.15 * Math.sign(this.face || 1) : this.face) * sh.twirl;
    const u = 1 / k;
    const boil = p.boil;
    const ink = css(T.ink);
    const body = css(T.body);
    const lw = 2.3 * p.px * u;
    const amp = 0.5 * p.px * u;

    this.contactShadow(ctx, p, env, game, pose.x, pose.y);

    ctx.save();
    ctx.globalAlpha = pose.alpha;
    // Local space: world units, y up, origin at the feet, mirrored to face.
    ctx.setTransform(k * sh.sx * face, 0, 0, -k * sh.sy, X, Y);
    ctx.rotate(sh.lean);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Scarf tails trail behind the head (they live in world space, so undo the mirror).
    this.drawTails(ctx, p, env, pose, sh);

    // Legs.
    const hipY = 0.22;
    const legs: [number, number][] = [];
    for (let l = 0; l < 2; l++) {
      const off = l === 0 ? 0 : Math.PI;
      let fx: number;
      let fy: number;
      if (pl.grounded) {
        fx = Math.sin(sh.phase + off) * 0.17 * sh.run;
        fy = Math.max(0, Math.cos(sh.phase + off)) * 0.11 * sh.run;
      } else if (pl.vel.y > 0) {
        fx = (l === 0 ? 0.08 : -0.06);
        fy = 0.09 + l * 0.03;
      } else {
        fx = (l === 0 ? 0.1 : -0.1);
        fy = -0.02;
      }
      legs.push([(l === 0 ? 0.08 : -0.08) + fx, fy]);
    }
    ctx.beginPath();
    for (let l = 0; l < 2; l++) {
      const hx = l === 0 ? 0.08 : -0.08;
      const [fx, fy] = legs[l];
      curvePts(P, [hx, hipY + sh.bob, (hx + fx) / 2 + 0.02, (hipY + fy) / 2 + sh.bob * 0.5, fx, fy + 0.03], amp * 0.5, 300 + l, boil, 0.03);
      ribbonPath(ctx, P, 0.075, 310 + l, 0.2);
    }
    ctx.fillStyle = body;
    ctx.fill();
    for (let l = 0; l < 2; l++) {
      const [fx, fy] = legs[l];
      ellipsePts(P, fx + 0.035, fy + 0.03, 0.075, 0.042, 0.05, amp * 0.3, 320 + l, boil, 14);
      ctx.beginPath();
      polyPath(ctx, P, true);
      ctx.fill();
    }

    // Head: a tilted, glossy note head.
    const hx = 0;
    const hy = 0.47 + sh.bob;
    ellipsePts(P, hx, hy, 0.315, 0.25, 0.36, amp * 0.6, 330, boil, 40);
    ctx.beginPath();
    polyPath(ctx, P, true);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.beginPath();
    ringPath(ctx, P, lw, 331);
    ctx.fillStyle = ink;
    ctx.fill();
    // Highlight crescent on the upper left.
    ctx.beginPath();
    ctx.ellipse(hx - 0.1, hy + 0.08, 0.15, 0.075, 0.55, Math.PI * 0.95, Math.PI * 1.9, true);
    ctx.ellipse(hx - 0.085, hy + 0.055, 0.12, 0.05, 0.55, Math.PI * 1.85, Math.PI * 1.0, false);
    ctx.closePath();
    ctx.fillStyle = T.inv ? 'rgba(220,226,255,0.85)' : 'rgba(255,250,236,0.8)';
    ctx.fill();

    // Stem with the gold flag, then the scarf knot over the join.
    const stemX = 0.27;
    const stemY0 = hy + 0.02;
    const stemTopX = stemX - sh.run * 0.05;
    const stemTopY = hy + 0.78;
    ctx.beginPath();
    curvePts(P, [stemX, stemY0, stemX - sh.run * 0.02, (stemY0 + stemTopY) / 2, stemTopX, stemTopY], amp * 0.5, 340, boil, 0.04);
    ribbonPath(ctx, P, 0.065, 341, 0.15);
    ctx.fillStyle = body;
    ctx.fill();
    this.drawFlag(ctx, env, stemTopX, stemTopY, sh, frame);

    // Eyes.
    const lookX = Math.max(-1, Math.min(1, pl.vel.x * Math.sign(face) * 0.25 + 0.4));
    const lookY = Math.max(-1, Math.min(1, pl.vel.y * 0.06));
    for (let e = 0; e < 2; e++) {
      const ex = hx + (e === 0 ? -0.03 : 0.13);
      const ey = hy + 0.05 + (e === 0 ? 0 : 0.03);
      const ry = 0.088 * sh.blink * sh.wide;
      ctx.beginPath();
      ctx.ellipse(ex, ey, 0.066 * sh.wide, ry, 0.1, 0, Math.PI * 2);
      ctx.fillStyle = css(T.eye);
      ctx.fill();
      ctx.lineWidth = 0.012;
      ctx.strokeStyle = ink;
      ctx.stroke();
      if (sh.blink > 0.4) {
        ctx.beginPath();
        ctx.arc(ex + lookX * 0.025, ey + lookY * 0.03 - 0.005, 0.028, 0, Math.PI * 2);
        ctx.fillStyle = T.inv ? '#0b0d1c' : css(mix(T.ink, [0, 0, 0], 0.4));
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex + lookX * 0.025 - 0.01, ey + lookY * 0.03 + 0.008, 0.009, 0, Math.PI * 2);
        ctx.fillStyle = '#fffaf0';
        ctx.fill();
      }
    }
    // The scarf wrapped round the stem just above the head, with a little knot.
    const ky = hy + 0.22;
    ctx.beginPath();
    ctx.moveTo(stemX - 0.075, ky - 0.045);
    ctx.quadraticCurveTo(stemX, ky - 0.065, stemX + 0.075, ky - 0.04);
    ctx.lineTo(stemX + 0.07, ky + 0.045);
    ctx.quadraticCurveTo(stemX, ky + 0.03, stemX - 0.07, ky + 0.05);
    ctx.closePath();
    ctx.fillStyle = css(T.rubric);
    ctx.fill();
    ctx.lineWidth = 0.016;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ellipsePts(P, stemX - 0.075, ky - 0.005, 0.045, 0.04, 0.3, amp * 0.2, 350, boil, 12);
    ctx.beginPath();
    polyPath(ctx, P, true);
    ctx.fillStyle = css(mix(T.rubric, T.ink, 0.15));
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawFlag(ctx: CanvasRenderingContext2D, env: Env, sx: number, sy: number, sh: { run: number }, frame: FrameInfo): void {
    const T = env.tones;
    // An eighth-note flag: it leaves the stem top, swells, and sweeps back towards the
    // stem lower down. Its direction comes from the flag spring (facing frame, y up).
    const flutter = Math.sin(frame.now * 11) * (0.05 + sh.run * 0.1) + Math.sin(frame.now * 17.3) * 0.035 * sh.run;
    const ang = this.flagAng + flutter;
    const len = 0.46;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const nx = -sa;
    const ny = ca;
    // Which side the flag bellies out to: away from the stem, towards the head side when hanging.
    const side = ca >= 0 ? -1 : 1;
    const wave = Math.sin(frame.now * 9) * 0.03 * (0.4 + sh.run);
    const tipX = sx + ca * len + nx * wave;
    const tipY = sy + sa * len + ny * wave;
    const attachX = sx;
    const attachY = sy - 0.2;
    const bulge = 0.16;
    // Outer edge: from the stem top out to the tip, bowed away from the stem.
    const o1x = sx + ca * len * 0.45 - nx * bulge * side;
    const o1y = sy + sa * len * 0.45 - ny * bulge * side;
    // Inner edge: from the tip back to the stem, curling.
    const i1x = sx + ca * len * 0.55 - nx * bulge * 0.2 * side + nx * wave * 0.6;
    const i1y = sy - 0.1 + sa * len * 0.55 - ny * bulge * 0.2 * side;
    ctx.beginPath();
    ctx.moveTo(sx, sy + 0.01);
    ctx.quadraticCurveTo(o1x, o1y, tipX, tipY);
    ctx.quadraticCurveTo(i1x, i1y, attachX, attachY);
    ctx.closePath();
    ctx.fillStyle = css(T.gold);
    ctx.fill();
    ctx.lineWidth = 0.02;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = css(T.goldDark);
    ctx.stroke();
    // A bright edge of gold leaf along the outer curve.
    ctx.beginPath();
    ctx.moveTo(sx + ca * 0.04, sy + sa * 0.04);
    ctx.quadraticCurveTo(o1x * 0.92 + sx * 0.08, o1y * 0.92 + sy * 0.08, sx + (tipX - sx) * 0.8, sy + (tipY - sy) * 0.8);
    ctx.strokeStyle = css(T.goldLight);
    ctx.lineWidth = 0.022;
    ctx.globalAlpha *= 0.85;
    ctx.stroke();
    ctx.globalAlpha /= 0.85;
  }

  private drawTails(ctx: CanvasRenderingContext2D, p: Proj, env: Env, pose: QuaverPose, sh: { hop: number }): void {
    const T = env.tones;
    // Undo the local transform: draw the tails straight in device space.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const k = p.k;
    for (let ti = 1; ti >= 0; ti--) {
      const t = this.tails[ti];
      const ctrl: number[] = [];
      for (let i = 0; i < LINKS; i++) ctrl.push(p.ox + t.x[i] * k, p.oy - (t.y[i] + sh.hop) * k);
      curvePts(P, ctrl, 0.4 * p.px, 370 + ti, p.boil, 3 * p.px);
      // Tapering ribbon: wide at the knot, narrow at the tip.
      const n = P.length / 2;
      const L: number[] = [];
      const R: number[] = [];
      for (let i = 0; i < n; i++) {
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(n - 1, i + 1);
        let tx = P[i1 * 2] - P[i0 * 2];
        let ty = P[i1 * 2 + 1] - P[i0 * 2 + 1];
        const l = Math.hypot(tx, ty) || 1;
        tx /= l;
        ty /= l;
        const w = k * (0.06 - 0.035 * (i / (n - 1))) * (1 + 0.25 * Math.sin(i * 0.9 + ti));
        L.push(P[i * 2] - ty * w, P[i * 2 + 1] + tx * w);
        R.push(P[i * 2] + ty * w, P[i * 2 + 1] - tx * w);
      }
      ctx.beginPath();
      ctx.moveTo(L[0], L[1]);
      for (let i = 2; i < L.length; i += 2) ctx.lineTo(L[i], L[i + 1]);
      // A forked tip.
      const ex = P[P.length - 2];
      const ey = P[P.length - 1];
      ctx.lineTo(ex - (L[L.length - 2] - ex) * 0.2, ey - (L[L.length - 1] - ey) * 0.2);
      for (let i = R.length - 2; i >= 0; i -= 2) ctx.lineTo(R[i], R[i + 1]);
      ctx.closePath();
      ctx.fillStyle = css(ti === 0 ? T.rubric : mix(T.rubric, T.ink, 0.25));
      ctx.globalAlpha = pose.alpha;
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, 1.1 * p.px);
      ctx.strokeStyle = css(T.ink);
      ctx.globalAlpha = 0.8 * pose.alpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** A small hatched shadow on whatever Quaver stands over. */
  private contactShadow(ctx: CanvasRenderingContext2D, p: Proj, env: Env, game: Game, x: number, y: number): void {
    const gy = groundBelow(game, { x, y, z: this.pose.z });
    if (gy === null) return;
    const hgt = y - gy;
    if (hgt > 8) return;
    const s = Math.max(0, 1 - hgt / 4);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(p.ox + x * p.k, p.oy - gy * p.k + 0.02 * p.k, p.k * 0.34 * (0.5 + 0.5 * s), p.k * 0.06 * (0.5 + 0.5 * s), 0, 0, Math.PI * 2);
    ctx.fillStyle = env.pats.cross;
    ctx.globalAlpha = 0.8 * s;
    ctx.fill();
    if (!game.player.grounded && !game.finished) {
      ctx.globalAlpha = 0.8 * Math.min(1, hgt * 3) * Math.max(0, 1 - hgt / 10);
      ctx.beginPath();
      ctx.ellipse(p.ox + x * p.k, p.oy - gy * p.k, p.k * 0.3, p.k * 0.065, 0, 0, Math.PI * 2);
      ctx.strokeStyle = css(env.tones.gold);
      ctx.lineWidth = Math.max(1, 1.2 * p.px);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Dotted outline and light hatching over scenery when Quaver is behind it. */
  ghost(ctx: CanvasRenderingContext2D, p: Proj, env: Env, game: Game, frame: FrameInfo): void {
    const pose = this.pose;
    if (!pose.visible) return;
    const T = env.tones;
    const sh = this.shape(game);
    const k = p.k;
    const X = p.ox + pose.x * k;
    const Y = p.oy - (pose.y + sh.hop) * k;
    const face = Math.abs(this.face) < 0.15 ? 0.15 * Math.sign(this.face || 1) : this.face;
    ctx.save();
    ctx.setTransform(k * sh.sx * face, 0, 0, -k * sh.sy, X, Y);
    ctx.rotate(sh.lean);
    const hy = 0.47 + sh.bob;
    ctx.beginPath();
    ctx.ellipse(0, hy, 0.315, 0.25, 0.36, 0, Math.PI * 2);
    ctx.moveTo(0.27, hy + 0.02);
    ctx.lineTo(0.27 - sh.run * 0.05, hy + 0.78);
    ctx.moveTo(0.08, 0.22);
    ctx.lineTo(0.08, 0.02);
    ctx.moveTo(-0.08, 0.22);
    ctx.lineTo(-0.08, 0.02);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Light hatch inside the head.
    ctx.save();
    ctx.clip();
    ctx.restore();
    const light = T.inv ? 'rgba(240,236,220,0.95)' : css(mix(T.paper, [255, 255, 255], 0.5), 0.95);
    ctx.setLineDash([2.2 * p.px, 3.2 * p.px]);
    ctx.lineDashOffset = -frame.now * 12 * p.px;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, 3.4 * p.px);
    ctx.strokeStyle = css(T.ink, 0.65);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.2, 2 * p.px);
    ctx.strokeStyle = light;
    ctx.stroke();
    ctx.setLineDash([]);
    // The scarf knot and eyes stay as small accents so Quaver reads at a glance.
    ctx.setTransform(k * sh.sx * face, 0, 0, -k * sh.sy, X, Y);
    ctx.rotate(sh.lean);
    ctx.beginPath();
    ctx.ellipse(0.24, hy + 0.15, 0.08, 0.045, -0.2, 0, Math.PI * 2);
    ctx.fillStyle = css(T.rubric, 0.85);
    ctx.fill();
    for (let e = 0; e < 2; e++) {
      ctx.beginPath();
      ctx.ellipse(e === 0 ? -0.03 : 0.13, hy + 0.05 + e * 0.03, 0.05, 0.065 * sh.blink, 0.1, 0, Math.PI * 2);
      ctx.fillStyle = light;
      ctx.fill();
    }
    ctx.restore();
  }
}
