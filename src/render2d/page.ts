import { NO_DEPTH } from '../game/level';
import type { Palette } from '../game/palettes';
import type { Game } from '../game/sim';
import type { ViewState } from '../game/view';
import type { FrameInfo, WorldRenderer } from '../render/types';
import { Backdrop } from './backdrop';
import { ChunkCache } from './chunks';
import { css, mix, rgb } from './color';
import { drawDecor } from './decor';
import { collectEntities, type Drawable } from './entities';
import { anchorAll, makePatterns, strokeScale, type Env, type Patterns, type Proj } from './env';
import { Effects } from './fx';
import { Paper } from './paper';
import { QuaverPainter } from './quaver';
import { hash } from './rand';
import { drawThorn, granulate, paintStatic, type Pen } from './terrain';
import { makeTones, type Tones } from './tones';
import { drawWipe } from './wipe';
import { World } from './world';

const CHUNK = 512;

/**
 * The Score: the world drawn as a living illuminated manuscript on Canvas 2D.
 *
 * Per frame: fixed parchment, sky staves and ink-wash silhouettes in parallax,
 * the cached static page (voxels by depth layer, thorns and decor, painted back to
 * front into chunk canvases with three boil drawings each), then live things in
 * painter's order. Anything live that sits behind scenery gets the cached page
 * redrawn over it, clipped to the cells in front, so depth on the flat page stays
 * correct. Effects, ambient particles, the vignette and the ink-blot wipe finish
 * the frame.
 */
export class Page implements WorldRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 1280;
  private h = 720;
  private dpr = 1;
  private W = 1280;
  private H = 720;
  private game: Game | null = null;
  private palette: Palette | null = null;
  private tones: Tones | null = null;
  private world: World | null = null;
  private pats: Patterns | null = null;
  private env: Env | null = null;
  private paper = new Paper();
  private backdrop = new Backdrop();
  private fx = new Effects();
  private quaver = new QuaverPainter();
  private chunks: ChunkCache;
  private chunkK = 0;
  private chunkPx = 1;
  private drawables: Drawable[] = [];
  /** Ghosts of hidden things, drawn after everything else so nothing paints over them. */
  private ghosts: { d: Drawable; cells: number[] }[] = [];
  private lastPpu = 0;
  /** Height Quaver last stood at (the backdrop settles on it). */
  private groundY = NaN;
  /** Frame cost in milliseconds (exposed for measurement scripts). */
  stats = { ms: 0, avg: 0, max: 0, paint: 0, frames: 0, chunks: 0, canvases: 0 };

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'page';
    this.ctx = this.canvas.getContext('2d', { alpha: true })!;
    this.chunks = new ChunkCache(
      (g, i, j, v) => this.paintChunk(g, i, j, v),
      (i, j) => this.probeChunk(i, j),
      CHUNK,
    );
  }

  load(game: Game, palette: Palette): void {
    this.game = game;
    this.palette = palette;
    const lv = game.level;
    this.tones = makeTones(palette, lv.d);
    this.world = new World(lv);
    this.pats = makePatterns(this.ctx, this.tones, this.dpr);
    this.env = { world: this.world, tones: this.tones, pats: this.pats, now: 0, time: 0, quality: 'high' };
    this.chunks.clear();
    this.chunkK = 0;
    this.fx.setTones(this.tones);
    this.quaver.reset();
    this.paper.build(this.tones, this.w, this.h, this.dpr);
    this.lastPpu = 0;
    this.groundY = NaN;
  }

  resize(w: number, h: number, dpr: number): void {
    const changedDpr = dpr !== this.dpr;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.W = Math.round(w * dpr);
    this.H = Math.round(h * dpr);
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    if (this.tones) {
      if (changedDpr) {
        this.pats = makePatterns(this.ctx, this.tones, dpr);
        if (this.env) this.env.pats = this.pats;
        this.chunks.purge();
        this.chunkK = 0;
      }
      this.paper.build(this.tones, w, h, dpr);
      this.lastPpu = 0;
    }
  }

  setVisible(v: boolean): void {
    this.canvas.style.visibility = v ? 'visible' : 'hidden';
  }

  // ---------------------------------------------------------------- chunk cache hooks

  private paintChunk(g: CanvasRenderingContext2D, i: number, j: number, variant: number): void {
    const env = this.env;
    if (!env) return;
    const k = this.chunkK;
    const p: Proj = { k, ox: -i * CHUNK, oy: -j * CHUNK, dpr: this.dpr, px: this.chunkPx, boil: variant };
    const x0 = (i * CHUNK) / k;
    const x1 = ((i + 1) * CHUNK) / k;
    const y0 = -((j + 1) * CHUNK) / k;
    const y1 = -(j * CHUNK) / k;
    paintStatic(g, env, p, x0, y0, x1, y1, variant);
    granulate(g, env, CHUNK, CHUNK);
  }

  private probeChunk(i: number, j: number): boolean {
    const w = this.world;
    if (!w) return false;
    const k = this.chunkK;
    const x0 = (i * CHUNK) / k;
    const x1 = ((i + 1) * CHUNK) / k;
    const y0 = -((j + 1) * CHUNK) / k;
    const y1 = -(j * CHUNK) / k;
    return w.hasContent(Math.floor(x0) - 1, Math.floor(y0) - 1, Math.ceil(x1) + 1, Math.ceil(y1) + 1);
  }

  // ---------------------------------------------------------------- frame

  render(game: Game, view: ViewState, frame: FrameInfo): void {
    const t0 = performance.now();
    if (game !== this.game || !this.env || !this.tones || !this.world) {
      if (!this.palette) return;
      this.load(game, this.palette);
    }
    const env = this.env!;
    const T = this.tones!;
    const world = this.world!;
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    const dpr = this.dpr;
    const reduce = view.reduceMotion;
    env.now = frame.now;
    env.time = game.time;
    env.quality = frame.quality;

    // The cache is laid out for one scale; rebuild when it changes.
    const k = view.ppu * dpr;
    if (Math.abs(k - this.chunkK) > 1e-6) {
      this.chunks.clear();
      this.chunkK = k;
      this.chunkPx = dpr * strokeScale(view.ppu);
    }
    if (view.ppu !== this.lastPpu) {
      this.backdrop.build(T, T.pal.id, this.w, this.h, dpr, view.ppu);
      this.lastPpu = view.ppu;
    }

    const boil = reduce ? 0 : Math.floor(frame.now * 8);
    const variants = frame.quality === 'low' || reduce ? 1 : 3;
    const variant = variants > 1 ? boil % 3 : 0;
    let sx = 0;
    let sy = 0;
    if (!reduce && view.shake > 0) {
      const s = view.shake * view.shake * 7 * dpr;
      sx = Math.round(Math.sin(frame.now * 61.3) * s);
      sy = Math.round(Math.cos(frame.now * 47.9) * s);
    }
    const ox = Math.round(W / 2 - view.c2.x * k) + sx;
    const oy = Math.round(H / 2 + view.c2.y * k) + sy;
    const p: Proj = { k, ox, oy, dpr, px: this.chunkPx, boil };

    // Events and simulation-driven state.
    if (frame.events.length) {
      this.fx.handle(frame.events, game, reduce);
      for (const e of frame.events) if (e.t === 'respawn') this.quaver.respawnAt = game.time;
    }
    this.fx.update(frame.gameDt);
    const qp = this.quaver.update(game, frame);

    // Paper and the world behind the world.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    this.paper.draw(ctx);
    const pl = game.player;
    if (pl.grounded || !Number.isFinite(this.groundY)) this.groundY = pl.pos.y;
    if (pl.dead > 0) this.groundY = game.respawn.pos.y;
    this.backdrop.lite = frame.quality === 'low';
    this.backdrop.draw(ctx, view, W, H, world.w, frame.now, this.groundY);

    // The cached page.
    const S = CHUNK;
    const i0 = Math.floor(-ox / S);
    const i1 = Math.floor((W - ox) / S);
    const j0 = Math.floor(-oy / S);
    const j1 = Math.floor((H - oy) / S);
    const visible = (i1 - i0 + 1) * (j1 - j0 + 1);
    const ring = (i1 - i0 + 3) * (j1 - j0 + 3) - visible;
    this.chunks.variants = variants;
    this.chunks.budget = Math.ceil(visible * variants + ring + 10);
    const idle = frame.quality === 'high' ? 3 : 1.8;
    this.chunks.prepare(i0, i1, j0, j1, idle, variants);
    ctx.imageSmoothingEnabled = false;
    this.chunks.draw(ctx, ox, oy, variant);
    ctx.imageSmoothingEnabled = true;

    // Live things in painter's order, back to front.
    const vx0 = (0 - ox) / k;
    const vx1 = (W - ox) / k;
    const vy0 = (oy - H) / k;
    const vy1 = oy / k;
    // Hatching on live things is anchored to the world, the same as in the cached page.
    anchorAll(env.pats, p);
    const list = this.drawables;
    list.length = 0;
    collectEntities(list, game, env, frame, { x0: vx0 - 1, y0: vy0 - 1, x1: vx1 + 1, y1: vy1 + 1 });
    for (const di of world.liveDecor) {
      if (di.x1 < vx0 || di.x0 > vx1 || di.y1 < vy0 || di.y0 > vy1) continue;
      list.push({ z: di.z + 0.2, x0: di.x0, y0: di.y0, x1: di.x1, y1: di.y1, draw: (c, pp) => drawDecor(c, env, pp, di, boil, 'live') });
    }
    if (qp.visible) {
      const q = this.quaver;
      list.push({
        z: qp.z - 0.3,
        x0: qp.x - 0.55,
        y0: qp.y - 0.1,
        x1: qp.x + 0.6,
        y1: qp.y + 1.45,
        core: { x0: qp.x - 0.28, y0: qp.y + 0.02, x1: qp.x + 0.28, y1: qp.y + 0.84 },
        draw: (c, pp) => q.draw(c, pp, env, game, frame),
        ghost: (c, pp) => q.ghost(c, pp, env, game, frame),
      });
    }
    list.sort((a, b) => b.z - a.z);
    this.ghosts.length = 0;
    for (const d of list) {
      d.draw(ctx, p);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      this.occlude(d, p, variant);
    }
    for (const g of this.ghosts) {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < g.cells.length; i += 2) ctx.rect(p.ox + g.cells[i] * k, p.oy - (g.cells[i + 1] + 1) * k, k, k);
      ctx.clip();
      g.d.ghost!(ctx, p);
      ctx.restore();
    }

    this.drawWater(game, p, frame);
    this.fx.draw(ctx, p);
    // Ambient drift runs on real time but holds still while the game is paused.
    this.fx.ambient(ctx, frame.gameDt > 0 ? frame.dt : 0, view.c2.x, view.c2.y, view.ppu, W, H, dpr, frame.quality, frame.now);
    if (frame.quality !== 'low') this.paper.drawVignette(ctx, W, H);

    if (view.wipe > 0 && view.wipe < 1) drawWipe(ctx, W, H, view.wipeOrigin.x * dpr, view.wipeOrigin.y * dpr, view.wipe, frame.now * 0.5, T, dpr);

    const ms = performance.now() - t0;
    const st = this.stats;
    st.ms = ms;
    st.frames++;
    st.avg = st.frames < 2 ? ms : st.avg * 0.95 + ms * 0.05;
    st.max = Math.max(st.max * 0.995, ms);
    st.paint = this.chunks.paintMs;
    const cs = this.chunks.stats();
    st.chunks = cs.chunks;
    st.canvases = cs.canvases;
  }

  /**
   * Redraws whatever static scenery stands in front of a live thing: decor and
   * thorns nearer than it, then the cached page clipped to the nearer voxel cells.
   * Calls the thing's ghost if it was hidden.
   */
  private occlude(d: Drawable, p: Proj, variant: number): void {
    const world = this.world!;
    const env = this.env!;
    const ctx = this.ctx;
    const zMin = d.z;
    if (zMin < 0.98) return;
    const lim = zMin + 0.02;
    if (d.core) {
      // Nothing nearer covers the core: the thing sits on top of the page as drawn.
      const c = d.core;
      let covered = false;
      for (let y = Math.max(0, Math.floor(c.y0)); y <= Math.min(world.h - 1, Math.floor(c.y1)) && !covered; y++)
        for (let x = Math.max(0, Math.floor(c.x0)); x <= Math.min(world.w - 1, Math.floor(c.x1)); x++) {
          const f = world.front[x + world.w * y];
          if (f !== NO_DEPTH && f + 1 <= lim) {
            covered = true;
            break;
          }
        }
      if (!covered) {
        // Decor and thorns in front still overlap it (a tuft of grass before Quaver).
        this.occludeDecorOnly(d, p, variant, lim);
        return;
      }
    }
    const cx0 = Math.max(0, Math.floor(d.x0));
    const cx1 = Math.min(world.w - 1, Math.floor(d.x1));
    const cy0 = Math.max(0, Math.floor(d.y0));
    const cy1 = Math.min(world.h - 1, Math.floor(d.y1));
    const cells: number[] = [];
    for (let y = cy0; y <= cy1; y++)
      for (let x = cx0; x <= cx1; x++) {
        const f = world.front[x + world.w * y];
        if (f !== NO_DEPTH && f + 1 <= lim) cells.push(x, y);
      }
    const decor = world.decor.filter((di) => di.z + 1 <= lim && di.x1 > d.x0 && di.x0 < d.x1 && di.y1 > d.y0 && di.y0 < d.y1);
    let thorns = 0;
    for (let z = 0; z < world.d && z + 1 <= lim; z++)
      for (const t of world.thorns[z]) if (t.x + 1 > d.x0 && t.x < d.x1 && t.y + 1 > d.y0 && t.y < d.y1) thorns++;
    if (!cells.length && !decor.length && !thorns) return;
    const k = p.k;
    const bx0 = Math.floor(p.ox + d.x0 * k) - 2;
    const bx1 = Math.ceil(p.ox + d.x1 * k) + 2;
    const by0 = Math.floor(p.oy - d.y1 * k) - 2;
    const by1 = Math.ceil(p.oy - d.y0 * k) + 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx0, by0, bx1 - bx0, by1 - by0);
    ctx.clip();
    if (decor.length || thorns) {
      const pen: Pen = { ctx, env, p: { ...p, px: this.chunkPx, boil: variant }, variant, L: env.tones.layers[0], z: 0 };
      for (let z = world.d - 1; z >= 0; z--) {
        if (z + 1 > lim) continue;
        pen.z = z;
        pen.L = env.tones.layers[z];
        for (const t of world.thorns[z]) if (t.x + 1 > d.x0 && t.x < d.x1 && t.y + 1 > d.y0 && t.y < d.y1) drawThorn(pen, t.x, t.y);
        for (const di of decor) if (di.z === z) drawDecor(ctx, env, pen.p, di, variant, 'static');
      }
    }
    if (cells.length) {
      ctx.beginPath();
      const g = Math.max(1, dprRound(p.dpr));
      for (let i = 0; i < cells.length; i += 2) {
        const X = p.ox + cells[i] * k;
        const Y = p.oy - (cells[i + 1] + 1) * k;
        ctx.rect(X - g, Y - g, k + g * 2, k + g * 2);
      }
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      this.chunks.drawRect(ctx, p.ox, p.oy, variant, bx0, by0, bx1, by1);
      ctx.imageSmoothingEnabled = true;
    }
    ctx.restore();
    // Only solid scenery hides a thing enough to need its ghost; decor stays see-through.
    if (d.ghost && cells.length) this.ghosts.push({ d, cells });
  }

  /** Redraws only nearer decor and thorns over a thing (no voxel cells). */
  private occludeDecorOnly(d: Drawable, p: Proj, variant: number, lim: number): void {
    const world = this.world!;
    const env = this.env!;
    const ctx = this.ctx;
    const decor = world.decor.filter((di) => di.z + 1 <= lim && di.x1 > d.x0 && di.x0 < d.x1 && di.y1 > d.y0 && di.y0 < d.y1);
    let any = decor.length > 0;
    if (!any)
      for (let z = 0; z < world.d && z + 1 <= lim && !any; z++)
        for (const t of world.thorns[z]) if (t.x + 1 > d.x0 && t.x < d.x1 && t.y + 1 > d.y0 && t.y < d.y1) any = true;
    if (!any) return;
    const k = p.k;
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.floor(p.ox + d.x0 * k) - 2, Math.floor(p.oy - d.y1 * k) - 2, Math.ceil((d.x1 - d.x0) * k) + 4, Math.ceil((d.y1 - d.y0) * k) + 4);
    ctx.clip();
    const pen: Pen = { ctx, env, p: { ...p, px: this.chunkPx, boil: variant }, variant, L: env.tones.layers[0], z: 0 };
    for (let z = world.d - 1; z >= 0; z--) {
      if (z + 1 > lim) continue;
      pen.z = z;
      pen.L = env.tones.layers[z];
      for (const t of world.thorns[z]) if (t.x + 1 > d.x0 && t.x < d.x1 && t.y + 1 > d.y0 && t.y < d.y1) drawThorn(pen, t.x, t.y);
      for (const di of decor) if (di.z === z) drawDecor(ctx, env, pen.p, di, variant, 'static');
    }
    ctx.restore();
  }

  /** Still water across the level at the water line, tinting whatever is below it. */
  private drawWater(game: Game, p: Proj, frame: FrameInfo): void {
    const wl = game.level.info.water;
    if (wl === undefined) return;
    const T = this.tones!;
    const ctx = this.ctx;
    const Y = p.oy - wl * p.k;
    if (Y > this.H) return;
    const top = Math.max(0, Y);
    const water = rgb(T.pal.water ?? T.pal.washFar);
    ctx.fillStyle = css(mix(water, T.paper, T.inv ? 0.35 : 0.45), 0.55);
    ctx.fillRect(0, top, this.W, this.H - top);
    ctx.beginPath();
    const t = frame.now;
    const step = 0.55 * p.k;
    const rows = Math.ceil((this.H - top) / (0.22 * p.k));
    for (let r = 0; r < Math.min(rows, 30); r++) {
      const y = Y + 0.05 * p.k + r * 0.22 * p.k * (1 + r * 0.08);
      if (y < 0) continue;
      const drift = ((t * (12 + r * 3) * p.dpr) % step) * (r % 2 ? 1 : -1);
      for (let x = -step + drift - ((p.ox % step) + step) % step; x < this.W + step; x += step) {
        const h = hash(Math.round((x - p.ox) / step), r, 3);
        if (h < 0.45) continue;
        const len = step * (0.3 + h * 0.6);
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y + Math.sin(x * 0.01 + r) * 0.5);
      }
    }
    ctx.strokeStyle = css(mix(T.inkFar, water, 0.3), 0.55);
    ctx.lineWidth = Math.max(0.8, 1.1 * p.px);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, Y);
    for (let x = 0; x <= this.W; x += 12 * p.dpr) ctx.lineTo(x, Y + Math.sin(x * 0.02 + t * 1.5) * 1.2 * p.dpr);
    ctx.strokeStyle = css(T.inkFar, 0.8);
    ctx.lineWidth = Math.max(1, 1.5 * p.px);
    ctx.stroke();
  }
}

function dprRound(dpr: number): number {
  return Math.round(dpr);
}
