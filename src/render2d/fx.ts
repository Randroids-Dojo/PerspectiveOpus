import type { Palette } from '../game/palettes';
import type { Game, GameEvent } from '../game/sim';
import { css, mix, rgb, type RGB } from './color';
import type { Proj } from './env';
import { blobPath, glintPath } from './ink';
import { hash, hs, noise1, rng, TAU } from './rand';
import type { Tones } from './tones';

/**
 * One-off ink effects from game events, and ambient particles per palette.
 * Event effects live in world units; ambient ones live in screen space with their
 * own parallax so they drift at different depths.
 */

type Kind = 'drop' | 'splat' | 'puff' | 'mark' | 'fleck' | 'ring' | 'rays' | 'gather' | 'spark' | 'arc' | 'accent' | 'dash';

interface Fx {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Age and lifetime in game seconds. Negative age is a delay. */
  age: number;
  life: number;
  size: number;
  seed: number;
  rot: number;
  spin: number;
  color: string;
  /** Target for gathering ink. */
  tx: number;
  ty: number;
  grav: number;
  drag: number;
}

interface Amb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  depth: number;
  seed: number;
  rot: number;
  spin: number;
  color: string;
}

const MAX_FX = 420;

export class Effects {
  private list: Fx[] = [];
  private amb: Amb[] = [];
  private ambKind: Palette['ambient'] = 'motes';
  private T!: Tones;
  private r = rng(99);
  private lastCam = { x: NaN, y: NaN };
  private spawnAcc = 0;

  setTones(t: Tones): void {
    this.T = t;
    this.ambKind = t.pal.ambient;
    this.list.length = 0;
    this.amb.length = 0;
    this.lastCam = { x: NaN, y: NaN };
  }

  clear(): void {
    this.list.length = 0;
    this.amb.length = 0;
    this.lastCam = { x: NaN, y: NaN };
  }

  private add(f: Partial<Fx> & { kind: Kind; x: number; y: number; life: number }): void {
    if (this.list.length >= MAX_FX) this.list.shift();
    this.list.push({
      vx: 0,
      vy: 0,
      age: 0,
      size: 0.1,
      seed: Math.floor(this.r() * 1e6),
      rot: this.r() * TAU,
      spin: 0,
      color: css(this.T.ink),
      tx: 0,
      ty: 0,
      grav: 0,
      drag: 0,
      ...f,
    });
  }

  handle(events: readonly GameEvent[], game: Game, reduce: boolean): void {
    const T = this.T;
    const pl = game.player;
    const lv = game.level;
    const r = this.r;
    const ink = css(T.ink);
    const gold = css(T.gold);
    const goldL = css(T.goldLight);
    const m = reduce ? 0.5 : 1;
    for (const e of events) {
      switch (e.t) {
        case 'jump': {
          for (let i = 0; i < 6 * m; i++) {
            const a = Math.PI + 0.25 + (i / 5) * (Math.PI - 0.5);
            this.add({ kind: 'puff', x: pl.pos.x + Math.cos(a) * 0.12, y: pl.pos.y + 0.02, vx: Math.cos(a) * 2.2, vy: -Math.sin(a) * 0.9 + 0.3, life: 0.32, size: 0.12 + r() * 0.08, drag: 6, rot: a });
          }
          for (let i = 0; i < 3; i++) this.add({ kind: 'drop', x: pl.pos.x + hs(i, 7) * 0.2, y: pl.pos.y + 0.03, vx: hs(i, 8) * 1.5, vy: 1.5 + r() * 1.5, grav: 22, life: 0.35, size: 0.03 + r() * 0.02 });
          break;
        }
        case 'land': {
          const imp = Math.min(1, e.impact / 20);
          if (imp < 0.15) break;
          const n = Math.round((2 + 9 * imp) * m);
          for (let i = 0; i < n; i++) {
            const sd = i % 2 ? 1 : -1;
            this.add({ kind: 'drop', x: pl.pos.x + sd * (0.1 + r() * 0.2), y: pl.pos.y + 0.03, vx: sd * (1 + r() * 3 * imp), vy: 1 + r() * 4 * imp, grav: 26, life: 0.45 + r() * 0.2, size: 0.03 + r() * 0.035 * (0.5 + imp) });
          }
          for (const sd of [-1, 1]) this.add({ kind: 'dash', x: pl.pos.x + sd * 0.32, y: pl.pos.y + 0.02, vx: sd * 1.4 * imp, life: 0.4, size: 0.18 + 0.35 * imp, rot: sd, drag: 5 });
          break;
        }
        case 'step': {
          if (!pl.grounded) break;
          this.add({ kind: 'mark', x: pl.pos.x - pl.facing * 0.12, y: pl.pos.y + 0.015, life: 0.4, size: 0.1 + r() * 0.05, rot: -pl.facing });
          break;
        }
        case 'note': {
          const n = lv.notes[e.id]?.pos;
          if (!n) break;
          for (let i = 0; i < 18 * m; i++) {
            const a = r() * TAU;
            const s = 1.5 + r() * 3.5;
            this.add({ kind: 'fleck', x: n.x, y: n.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 1.5, grav: 6, drag: 2.2, life: 0.8 + r() * 0.6, size: 0.05 + r() * 0.05, spin: hs(i, 3) * 12, color: r() < 0.3 ? goldL : gold });
          }
          this.add({ kind: 'rays', x: n.x, y: n.y, life: 0.5, size: 0.9, color: gold });
          this.add({ kind: 'ring', x: n.x, y: n.y, life: 0.55, size: 0.9, color: gold });
          break;
        }
        case 'checkpoint': {
          const c = lv.checkpoints[e.id]?.pos;
          if (!c) break;
          this.add({ kind: 'ring', x: c.x, y: c.y + 0.9, life: 0.8, size: 1.6, color: ink });
          this.add({ kind: 'ring', x: c.x, y: c.y + 0.9, life: 0.6, size: 1.1, color: gold, age: -0.08 });
          this.add({ kind: 'rays', x: c.x, y: c.y + 1.05, life: 0.6, size: 1.1, color: gold });
          break;
        }
        case 'death': {
          const x = e.pos.x;
          const y = e.pos.y + 0.45;
          this.add({ kind: 'splat', x, y, life: 1.5, size: 0.62, color: ink });
          for (let i = 0; i < 4; i++) {
            const a = r() * TAU;
            const d = 0.6 + r() * 0.6;
            this.add({ kind: 'splat', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, life: 1.4, size: 0.08 + r() * 0.1, color: ink, age: -0.05 - r() * 0.1 });
          }
          for (let i = 0; i < 26 * m; i++) {
            const a = r() * TAU;
            const s = 2 + r() * 6;
            this.add({ kind: 'drop', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 2.5, grav: 18, drag: 0.8, life: 0.7 + r() * 0.4, size: 0.04 + r() * 0.06 });
          }
          // The ink gathers again at the respawn point just before Quaver returns.
          const rp = game.respawn.pos;
          for (let i = 0; i < 16 * m; i++) {
            const a = r() * TAU;
            const d = 1 + r() * 1.4;
            this.add({ kind: 'gather', x: rp.x + Math.cos(a) * d, y: rp.y + 0.4 + Math.sin(a) * d * 0.8, tx: rp.x, ty: rp.y + 0.4, age: -(0.5 + r() * 0.12), life: 0.38 + r() * 0.06, size: 0.04 + r() * 0.05 });
          }
          break;
        }
        case 'respawn': {
          this.add({ kind: 'ring', x: pl.pos.x, y: pl.pos.y + 0.4, life: 0.45, size: 0.9, color: ink });
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU;
            this.add({ kind: 'drop', x: pl.pos.x + Math.cos(a) * 0.3, y: pl.pos.y + 0.4 + Math.sin(a) * 0.3, vx: Math.cos(a) * 1.5, vy: Math.sin(a) * 1.5, grav: 4, drag: 4, life: 0.3, size: 0.03 });
          }
          break;
        }
        case 'bounce': {
          const d = lv.drums[e.id]?.pos;
          if (!d) break;
          for (let i = 0; i < 3; i++) this.add({ kind: 'arc', x: d.x + 0.5, y: d.y + 0.8, life: 0.5, size: 0.5 + i * 0.25, age: -i * 0.06 });
          for (let i = 0; i < 6 * m; i++) this.add({ kind: 'drop', x: d.x + 0.5 + hs(i, 4) * 0.35, y: d.y + 0.75, vx: hs(i, 5) * 2, vy: 2 + r() * 3, grav: 20, life: 0.45, size: 0.03 + r() * 0.03 });
          break;
        }
        case 'key': {
          const k = lv.keys[e.id];
          if (!k) break;
          const col = T.groups[k.group % T.groups.length];
          for (let i = 0; i < 3; i++) this.add({ kind: 'accent', x: k.pos.x + (k.width * (i + 0.5)) / 3, y: k.pos.y + 0.35, vy: 0.9, life: 0.7, size: 0.16, color: col, age: -i * 0.05 });
          break;
        }
        case 'gate': {
          for (let gi = 0; gi < lv.gates.length; gi++) {
            const g = lv.gates[gi];
            if (g.group !== e.group) continue;
            for (let i = 0; i < 10 * m; i++) {
              this.add({ kind: 'spark', x: g.min.x + r() * (g.max.x - g.min.x), y: g.min.y + r() * (g.max.y - g.min.y), vy: 0.4 + r() * 0.6, life: 0.6 + r() * 0.4, size: 0.08 + r() * 0.06, color: goldL, age: -r() * 0.2 });
            }
          }
          break;
        }
        case 'exit': {
          const x = lv.exit.pos;
          this.add({ kind: 'rays', x: x.x, y: x.y + 1.6, life: 1.2, size: 2.6, color: gold });
          this.add({ kind: 'ring', x: x.x, y: x.y + 1.6, life: 1.0, size: 2.4, color: gold });
          for (let i = 0; i < 30 * m; i++) {
            const a = r() * TAU;
            const s = 1 + r() * 4;
            this.add({ kind: 'fleck', x: x.x + hs(i, 9) * 0.6, y: x.y + 1 + r() * 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 1, grav: 2, drag: 1.5, life: 1.2 + r() * 0.8, size: 0.05 + r() * 0.06, spin: hs(i, 3) * 10, color: r() < 0.4 ? goldL : gold });
          }
          break;
        }
        case 'bonk': {
          this.add({ kind: 'rays', x: pl.pos.x, y: pl.pos.y + 1.0, life: 0.28, size: 0.45, color: ink });
          break;
        }
        default:
          break;
      }
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const L = this.list;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const f = L[i];
      f.age += dt;
      if (f.age > f.life) continue;
      if (f.age > 0) {
        f.vy -= f.grav * dt;
        if (f.drag) {
          const d = Math.exp(-f.drag * dt);
          f.vx *= d;
          f.vy *= d;
        }
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.rot += f.spin * dt;
      }
      L[w++] = f;
    }
    L.length = w;
  }

  /** Draws the event effects in world space. */
  draw(ctx: CanvasRenderingContext2D, p: Proj): void {
    const T = this.T;
    const k = p.k;
    for (const f of this.list) {
      if (f.age < 0 && f.kind !== 'gather') continue;
      const u = Math.max(0, f.age / f.life);
      const X = p.ox + f.x * k;
      const Y = p.oy - f.y * k;
      ctx.globalAlpha = 1;
      switch (f.kind) {
        case 'drop': {
          const sp = Math.hypot(f.vx, f.vy);
          const r = f.size * k * (1 - u * 0.5);
          const stretch = Math.min(2.5, 1 + sp * 0.08);
          ctx.save();
          ctx.translate(X, Y);
          ctx.rotate(Math.atan2(-f.vy, f.vx));
          ctx.scale(stretch, 1 / Math.sqrt(stretch));
          ctx.beginPath();
          ctx.arc(0, 0, Math.max(0.6, r), 0, TAU);
          ctx.fillStyle = f.color;
          ctx.globalAlpha = 1 - u * u;
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'splat': {
          const grow = Math.min(1, f.age / 0.12);
          const r = f.size * k * (0.4 + 0.6 * grow);
          ctx.beginPath();
          blobPath(ctx, X, Y, r, 0.35, f.seed, 0, 28);
          if (f.size > 0.3) {
            // Spikes thrown out from the splat.
            for (let i = 0; i < 9; i++) {
              const a = hash(f.seed, i) * TAU;
              const len = r * (1.3 + hash(f.seed, i, 2) * 0.8);
              const w = r * 0.12;
              ctx.moveTo(X + Math.cos(a + 0.15) * r * 0.8, Y + Math.sin(a + 0.15) * r * 0.8);
              ctx.lineTo(X + Math.cos(a) * len, Y + Math.sin(a) * len);
              ctx.lineTo(X + Math.cos(a - 0.15) * r * 0.8, Y + Math.sin(a - 0.15) * r * 0.8);
              ctx.closePath();
              ctx.moveTo(X + Math.cos(a) * (len + w * 1.5) + w, Y + Math.sin(a) * (len + w * 1.5));
              ctx.arc(X + Math.cos(a) * (len + w * 1.5), Y + Math.sin(a) * (len + w * 1.5), w, 0, TAU);
            }
          }
          ctx.fillStyle = f.color;
          ctx.globalAlpha = u < 0.6 ? 0.92 : 0.92 * (1 - (u - 0.6) / 0.4);
          ctx.fill();
          break;
        }
        case 'puff': {
          const len = f.size * k * (0.5 + u);
          ctx.beginPath();
          const a = f.rot;
          ctx.moveTo(X, Y);
          ctx.quadraticCurveTo(X + Math.cos(a) * len * 0.6, Y + len * 0.1, X + Math.cos(a) * len, Y - Math.sin(a) * len * 0.3);
          ctx.strokeStyle = css(T.ink);
          ctx.lineWidth = Math.max(0.8, 1.4 * p.px * (1 - u));
          ctx.globalAlpha = 0.7 * (1 - u);
          ctx.stroke();
          break;
        }
        case 'mark':
        case 'dash': {
          const len = f.size * k;
          ctx.beginPath();
          ctx.moveTo(X - len * 0.5, Y);
          ctx.quadraticCurveTo(X, Y - len * 0.08 * f.rot, X + len * 0.5, Y);
          ctx.strokeStyle = css(T.ink);
          ctx.lineWidth = Math.max(0.8, (f.kind === 'dash' ? 1.8 : 1.2) * p.px);
          ctx.globalAlpha = (f.kind === 'dash' ? 0.75 : 0.45) * (1 - u);
          ctx.stroke();
          break;
        }
        case 'fleck': {
          const s = f.size * k;
          const sx = Math.cos(f.rot);
          ctx.save();
          ctx.translate(X, Y);
          ctx.scale(Math.max(0.15, Math.abs(sx)), 1);
          ctx.rotate(f.rot * 0.3);
          ctx.beginPath();
          ctx.moveTo(0, -s);
          ctx.lineTo(s * 0.6, 0);
          ctx.lineTo(0, s);
          ctx.lineTo(-s * 0.6, 0);
          ctx.closePath();
          ctx.fillStyle = Math.abs(sx) > 0.85 ? css(T.goldLight) : f.color;
          ctx.globalAlpha = 1 - u * u;
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'ring': {
          const r = f.size * k * (0.25 + 0.75 * Math.sqrt(u));
          ctx.beginPath();
          for (let i = 0; i <= 40; i++) {
            const a = (i / 40) * TAU;
            const rr = r * (1 + 0.05 * Math.sin(a * 5 + f.seed) + 0.03 * Math.sin(a * 9 + f.seed * 2));
            if (i === 0) ctx.moveTo(X + Math.cos(a) * rr, Y + Math.sin(a) * rr);
            else ctx.lineTo(X + Math.cos(a) * rr, Y + Math.sin(a) * rr);
          }
          ctx.strokeStyle = f.color;
          ctx.lineWidth = Math.max(1, 2.6 * p.px * (1 - u));
          ctx.globalAlpha = 0.85 * (1 - u);
          ctx.stroke();
          break;
        }
        case 'rays': {
          const r0 = f.size * k * (0.2 + 0.5 * u);
          const r1 = f.size * k * (0.45 + 0.75 * Math.sqrt(u));
          ctx.beginPath();
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * TAU + f.seed;
            const j = 0.7 + 0.5 * hash(f.seed, i);
            ctx.moveTo(X + Math.cos(a) * r0, Y + Math.sin(a) * r0);
            ctx.lineTo(X + Math.cos(a) * r1 * j, Y + Math.sin(a) * r1 * j);
          }
          ctx.strokeStyle = f.color;
          ctx.lineWidth = Math.max(1, 1.8 * p.px);
          ctx.lineCap = 'round';
          ctx.globalAlpha = 0.85 * (1 - u);
          ctx.stroke();
          break;
        }
        case 'gather': {
          if (f.age < 0) {
            // Drops wait, then race inwards along a curve.
            if (f.age > -0.25) {
              ctx.beginPath();
              ctx.arc(X, Y, Math.max(0.6, f.size * k * 0.6), 0, TAU);
              ctx.fillStyle = css(T.ink);
              ctx.globalAlpha = (0.25 + f.age) * 2;
              ctx.fill();
            }
            break;
          }
          const e = u * u * (3 - 2 * u);
          const bend = Math.sin(u * Math.PI) * 0.5;
          const gx = f.x + (f.tx - f.x) * e + (f.ty - f.y) * bend * 0.3;
          const gy = f.y + (f.ty - f.y) * e - (f.tx - f.x) * bend * 0.3;
          ctx.beginPath();
          ctx.arc(p.ox + gx * k, p.oy - gy * k, Math.max(0.6, f.size * k * (1 - e * 0.4)), 0, TAU);
          ctx.fillStyle = css(T.ink);
          ctx.globalAlpha = 0.9;
          ctx.fill();
          break;
        }
        case 'spark': {
          ctx.beginPath();
          glintPath(ctx, X, Y, f.size * k * Math.sin(u * Math.PI), f.rot);
          ctx.fillStyle = f.color;
          ctx.globalAlpha = 0.9;
          ctx.fill();
          break;
        }
        case 'arc': {
          const r = f.size * k * (0.6 + 0.8 * u);
          ctx.beginPath();
          ctx.arc(X, Y, r, -0.82 * Math.PI, -0.18 * Math.PI);
          ctx.strokeStyle = css(T.ink);
          ctx.lineWidth = Math.max(1, 2 * p.px * (1 - u));
          ctx.globalAlpha = 0.75 * (1 - u);
          ctx.stroke();
          break;
        }
        case 'accent': {
          const s = f.size * k;
          ctx.beginPath();
          ctx.moveTo(X - s * 0.6, Y - s * 0.4);
          ctx.lineTo(X + s * 0.6, Y);
          ctx.lineTo(X - s * 0.6, Y + s * 0.4);
          ctx.strokeStyle = f.color;
          ctx.lineWidth = Math.max(1, 2 * p.px);
          ctx.lineJoin = 'round';
          ctx.globalAlpha = 0.9 * (1 - u);
          ctx.stroke();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- ambient

  /** Updates and draws ambient particles in screen space (device pixels). */
  ambient(ctx: CanvasRenderingContext2D, dt: number, camX: number, camY: number, ppu: number, W: number, H: number, dpr: number, quality: string, now: number): void {
    const T = this.T;
    const want = quality === 'low' ? 10 : quality === 'medium' ? 20 : 30;
    const kind = this.ambKind;
    const count = kind === 'mist' ? Math.round(want * 0.3) : want;
    // Camera motion moves particles by their depth.
    const ppd = ppu * dpr;
    if (Number.isFinite(this.lastCam.x)) {
      const dx = (camX - this.lastCam.x) * ppd;
      const dy = (camY - this.lastCam.y) * ppd;
      if (Math.abs(dx) + Math.abs(dy) < W) {
        for (const a of this.amb) {
          a.x -= dx * a.depth;
          a.y += dy * a.depth;
        }
      }
    }
    this.lastCam = { x: camX, y: camY };
    while (this.amb.length < count) this.amb.push(this.spawnAmb(kind, W, H, dpr, this.amb.length < count * 0.5 || this.amb.length === 0));
    this.spawnAcc += dt;
    const margin = 60 * dpr;
    for (let i = 0; i < this.amb.length; i++) {
      const a = this.amb[i];
      a.age += dt;
      const sway = noise1(now * 0.6 + a.seed * 0.01, a.seed & 1023);
      a.x += (a.vx + sway * 18 * dpr) * dt;
      a.y += a.vy * dt;
      a.rot += a.spin * dt;
      if (a.age > a.life || a.x < -margin || a.x > W + margin || a.y < -margin || a.y > H + margin) this.amb[i] = this.spawnAmb(kind, W, H, dpr, false);
    }
    // Draw.
    for (const a of this.amb) {
      const u = a.age / a.life;
      const fade = Math.min(1, u * 5, (1 - u) * 4);
      if (fade <= 0) continue;
      ctx.globalAlpha = fade;
      switch (kind) {
        case 'motes': {
          ctx.beginPath();
          ctx.arc(a.x, a.y, a.size, 0, TAU);
          ctx.fillStyle = a.color;
          ctx.globalAlpha = fade * 0.65;
          ctx.fill();
          break;
        }
        case 'petals':
        case 'leaves': {
          const s = a.size;
          const sx = Math.cos(a.rot);
          ctx.save();
          ctx.translate(a.x, a.y);
          ctx.rotate(a.rot * 0.4);
          ctx.scale(Math.max(0.2, Math.abs(sx)), 1);
          ctx.beginPath();
          ctx.moveTo(-s, 0);
          ctx.quadraticCurveTo(0, -s * 0.55, s, 0);
          ctx.quadraticCurveTo(0, s * 0.55, -s, 0);
          ctx.fillStyle = a.color;
          ctx.globalAlpha = fade * 0.9;
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-s * 0.8, 0);
          ctx.lineTo(s * 0.8, 0);
          ctx.strokeStyle = css(T.ink);
          ctx.lineWidth = Math.max(0.5, 0.6 * dpr);
          ctx.globalAlpha = fade * 0.5;
          ctx.stroke();
          ctx.restore();
          break;
        }
        case 'fireflies': {
          const blink = 0.5 + 0.5 * Math.sin(now * (1.5 + (a.seed % 7) * 0.2) + a.seed);
          const b = blink * blink;
          ctx.beginPath();
          ctx.arc(a.x, a.y, a.size * (0.6 + 0.4 * b), 0, TAU);
          ctx.fillStyle = a.color;
          ctx.globalAlpha = fade * (0.35 + 0.65 * b);
          ctx.fill();
          if (b > 0.5) {
            ctx.beginPath();
            for (let k = 0; k < 6; k++) {
              const ang = (k / 6) * TAU + a.rot;
              ctx.moveTo(a.x + Math.cos(ang) * a.size * 1.8, a.y + Math.sin(ang) * a.size * 1.8);
              ctx.lineTo(a.x + Math.cos(ang) * a.size * 3.2, a.y + Math.sin(ang) * a.size * 3.2);
            }
            ctx.strokeStyle = a.color;
            ctx.lineWidth = Math.max(0.6, 0.7 * dpr);
            ctx.globalAlpha = fade * (b - 0.5) * 1.2;
            ctx.stroke();
          }
          break;
        }
        case 'sparks': {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(a.x - a.vx * 0.04, a.y - a.vy * 0.04);
          ctx.strokeStyle = a.color;
          ctx.lineWidth = Math.max(0.8, a.size);
          ctx.lineCap = 'round';
          ctx.globalAlpha = fade * 0.9;
          ctx.stroke();
          break;
        }
        case 'embers': {
          const fl = 0.6 + 0.4 * Math.sin(now * 9 + a.seed);
          ctx.beginPath();
          ctx.arc(a.x, a.y, a.size * fl, 0, TAU);
          ctx.fillStyle = a.color;
          ctx.globalAlpha = fade * 0.85;
          ctx.fill();
          break;
        }
        case 'mist': {
          // A drifting bank of mist: a few soft overlapping washes, wider than tall.
          ctx.fillStyle = a.color;
          for (let l = 0; l < 4; l++) {
            const ox = Math.sin(a.seed + l * 2.1) * a.size * 4;
            const oy = Math.cos(a.seed * 0.7 + l) * a.size * 0.5;
            ctx.beginPath();
            ctx.ellipse(a.x + ox, a.y + oy, a.size * (7 - l * 1.2), a.size * (1.1 - l * 0.15), 0, 0, TAU);
            ctx.globalAlpha = fade * 0.07;
            ctx.fill();
          }
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private spawnAmb(kind: Palette['ambient'], W: number, H: number, dpr: number, anywhere: boolean): Amb {
    const r = this.r;
    const T = this.T;
    const depth = 0.5 + r() * 0.7;
    const a: Amb = { x: r() * W, y: r() * H, vx: 0, vy: 0, age: anywhere ? r() * 3 : 0, life: 4 + r() * 5, size: 1, depth, seed: Math.floor(r() * 1e6), rot: r() * TAU, spin: 0, color: css(T.ink) };
    switch (kind) {
      case 'motes':
        a.vx = (r() - 0.5) * 10 * dpr;
        a.vy = -(3 + r() * 8) * dpr;
        a.size = (0.7 + r() * 1.3) * dpr * depth;
        a.color = r() < 0.4 ? css(T.gold) : css(mix(T.ink, T.paper, 0.35));
        break;
      case 'petals':
        a.vx = (20 + r() * 25) * dpr;
        a.vy = (14 + r() * 20) * dpr;
        a.size = (3 + r() * 3) * dpr * depth;
        a.spin = (r() - 0.5) * 6;
        a.color = css(mix(rgb('#e8a6b0'), T.paper, 0.2));
        if (!anywhere) {
          a.x = -20 * dpr;
          a.y = r() * H * 0.8;
        }
        break;
      case 'leaves': {
        const cols: RGB[] = [rgb('#c4602a'), rgb('#d8902e'), T.rubric, rgb('#a8462a')];
        a.vx = (10 + r() * 30) * dpr;
        a.vy = (22 + r() * 28) * dpr;
        a.size = (4 + r() * 4) * dpr * depth;
        a.spin = (r() - 0.5) * 7;
        a.color = css(mix(cols[Math.floor(r() * cols.length)], T.paper, 0.1 + (1 - depth) * 0.3));
        if (!anywhere) {
          a.x = r() * W * 1.2 - W * 0.2;
          a.y = -20 * dpr;
        }
        a.life = 6 + r() * 6;
        break;
      }
      case 'fireflies':
        a.vx = (r() - 0.5) * 16 * dpr;
        a.vy = (r() - 0.5) * 10 * dpr;
        a.size = (1.4 + r() * 1.4) * dpr * depth;
        a.color = r() < 0.5 ? css(mix(T.ink, rgb('#ffffff'), 0.4)) : css(mix(T.gold, rgb('#fff4c0'), 0.4));
        a.y = H * (0.25 + r() * 0.7);
        a.life = 5 + r() * 6;
        break;
      case 'sparks':
        a.vx = (r() - 0.5) * 60 * dpr;
        a.vy = (40 + r() * 80) * dpr;
        a.size = (0.9 + r() * 1.2) * dpr;
        a.color = css(r() < 0.5 ? T.goldLight : mix(T.gold, rgb('#ff8a3a'), 0.4));
        a.life = 0.8 + r() * 1.4;
        if (!anywhere) {
          a.y = -10 * dpr + r() * H * 0.3;
        }
        break;
      case 'embers':
        a.vx = (r() - 0.5) * 14 * dpr;
        a.vy = -(10 + r() * 22) * dpr;
        a.size = (1 + r() * 1.6) * dpr * depth;
        a.color = css(mix(rgb('#ff9a4a'), T.gold, r() * 0.6));
        if (!anywhere) a.y = H + 10 * dpr;
        a.life = 5 + r() * 4;
        break;
      case 'mist':
        a.vx = (6 + r() * 10) * dpr * (r() < 0.5 ? -1 : 1);
        a.vy = 0;
        a.size = (10 + r() * 14) * dpr;
        a.y = H * (0.45 + r() * 0.5);
        a.color = css(T.inv ? mix(T.paper, rgb('#8090c0'), 0.5) : mix(T.paper, rgb('#ffffff'), 0.5));
        a.life = 9 + r() * 8;
        break;
    }
    return a;
  }
}
