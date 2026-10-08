import { css, mix, rgb, type RGB } from './color';
import type { Env, Proj } from './env';
import { curvePts, ellipsePts, linePts, polyPath, ribbonPath, ringPath } from './ink';
import { depthTint, toneAt, type LayerTone, type Tones } from './tones';

const LOC: number[] = [];
const PTS: number[] = [];
const TMP: number[] = [];

/**
 * A small drawing helper for illustrations placed in the world: local units are
 * world units relative to a base point (y up), scaled by `s`. Every call takes the
 * next seed so a drawing is the same stroke for stroke each time it is made, and
 * the boil index nudges the wobble.
 */
export class Sketch {
  ctx!: CanvasRenderingContext2D;
  env!: Env;
  p!: Proj;
  T!: Tones;
  L!: LayerTone;
  z = 0;
  s = 1;
  bx = 0;
  by = 0;
  k = 1;
  px = 1;
  boil = 0;
  seed = 0;
  n = 0;
  /** Mirror horizontally (local u flips). */
  flip = 1;
  /** Outline weight multiplier. */
  weight = 0.85;
  /** Depth tint amount for colours (0 keeps colours pure). */
  tintAmt = 1;

  set(ctx: CanvasRenderingContext2D, env: Env, p: Proj, bx: number, by: number, z: number, s: number, seed: number, boil: number): this {
    this.ctx = ctx;
    this.env = env;
    this.p = p;
    this.T = env.tones;
    this.z = z;
    this.L = toneAt(env.tones, z);
    this.s = s;
    this.bx = bx;
    this.by = by;
    this.k = p.k;
    this.px = p.px;
    this.boil = boil;
    this.seed = seed | 0;
    this.n = 0;
    this.flip = 1;
    this.weight = 0.85;
    this.tintAmt = 1;
    return this;
  }

  X(u: number): number {
    return this.p.ox + (this.bx + u * this.s * this.flip) * this.k;
  }
  Y(v: number): number {
    return this.p.oy - (this.by + v * this.s) * this.k;
  }
  /** Local length to device pixels. */
  D(u: number): number {
    return u * this.s * this.k;
  }
  next(): number {
    return (this.seed * 31 + ++this.n * 977) | 0;
  }
  /** A colour faded for this depth. */
  col(c: RGB | string, amount = 1): string {
    const v = typeof c === 'string' ? rgb(c) : c;
    return css(depthTint(this.T, v, this.z + 0.5, amount * this.tintAmt));
  }
  colRGB(c: RGB | string, amount = 1): RGB {
    const v = typeof c === 'string' ? rgb(c) : c;
    return depthTint(this.T, v, this.z + 0.5, amount * this.tintAmt);
  }
  inkColor(): string {
    return this.L.ink;
  }
  lw(m = 1): number {
    return Math.max(0.7, this.L.outlineW * this.weight * this.px * m * Math.min(1.3, Math.max(0.65, this.s)));
  }
  amp(m = 1): number {
    return 0.55 * this.px * m;
  }

  private toDev(ctrl: number[]): number[] {
    LOC.length = 0;
    for (let i = 0; i < ctrl.length; i += 2) LOC.push(this.X(ctrl[i]), this.Y(ctrl[i + 1]));
    return LOC;
  }

  /** Builds a smooth closed (or open) path through local control points, in device pixels. */
  pts(ctrl: number[], closed: boolean, ampM = 1): number[] {
    const dev = this.toDev(ctrl);
    curvePts(PTS, dev, this.amp(ampM), this.next(), this.boil, Math.max(3, 5 * this.px), closed);
    return PTS;
  }

  /** Builds a polygon with wobbly straight edges through local corner points, in device pixels. */
  poly(ctrl: number[], closed: boolean, ampM = 1): number[] {
    const dev = this.toDev(ctrl);
    const m = dev.length / 2;
    const out: number[] = [];
    const segs = closed ? m : m - 1;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % m;
      linePts(TMP, dev[i * 2], dev[i * 2 + 1], dev[j * 2], dev[j * 2 + 1], { amp: this.amp(ampM) * 0.7, seed: this.next(), boil: this.boil, step: 6 * this.px, wl: this.px, bow: 0.4 });
      // Pin the corners so edges meet.
      TMP[0] = dev[i * 2];
      TMP[1] = dev[i * 2 + 1];
      for (let q = 0; q < TMP.length - 2; q += 2) out.push(TMP[q], TMP[q + 1]);
    }
    if (!closed) out.push(dev[(m - 1) * 2], dev[(m - 1) * 2 + 1]);
    PTS.length = 0;
    for (let i = 0; i < out.length; i++) PTS.push(out[i]);
    return PTS;
  }

  /** Fills a smooth closed shape (or a polygon with `poly`), then inks its outline. */
  shape(ctrl: number[], fill: string | CanvasPattern | null, lwM = 1, opts: { alpha?: number; outline?: boolean; ampM?: number; misreg?: boolean; poly?: boolean } = {}): void {
    const ctx = this.ctx;
    const pts = opts.poly ? this.poly(ctrl, true, opts.ampM ?? 1) : this.pts(ctrl, true, opts.ampM ?? 1);
    if (fill) {
      ctx.beginPath();
      if (opts.misreg !== false) {
        // The wash is laid a hair off the line, as a painter's brush would be.
        const ox = 0.8 * this.px;
        const oy = 0.5 * this.px;
        ctx.moveTo(pts[0] + ox, pts[1] + oy);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + ox, pts[i + 1] + oy);
        ctx.closePath();
      } else polyPath(ctx, pts, true);
      ctx.fillStyle = fill;
      ctx.globalAlpha = opts.alpha ?? 0.95;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (opts.outline !== false && lwM > 0) {
      ctx.beginPath();
      ringPath(ctx, pts, this.lw(lwM), this.next());
      ctx.fillStyle = this.L.ink;
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** Fills a closed region with a pattern or colour without an outline (shade, highlights). */
  region(ctrl: number[], fill: string | CanvasPattern, alpha: number, poly = false): void {
    const ctx = this.ctx;
    const pts = poly ? this.poly(ctrl, true, 0.4) : this.pts(ctrl, true, 0.6);
    ctx.beginPath();
    polyPath(ctx, pts, true);
    ctx.fillStyle = fill;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Runs `fn` clipped to a closed shape (for shading inside a form). */
  clip(ctrl: number[], fn: () => void, poly = false): void {
    const ctx = this.ctx;
    const pts = poly ? this.poly(ctrl, true, 0.4) : this.pts(ctrl, true, 0.5);
    ctx.save();
    ctx.beginPath();
    polyPath(ctx, pts, true);
    ctx.clip();
    fn();
    ctx.restore();
  }

  /** Fills a local-space ellipse with a fill (for shading inside a clip). */
  blot(cu: number, cv: number, ru: number, rv: number, fill: string | CanvasPattern, alpha: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.ellipse(this.X(cu), this.Y(cv), Math.max(0.5, this.D(ru)), Math.max(0.5, this.D(rv)), 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** A nib stroke along a smooth open curve. */
  line(ctrl: number[], lwM = 1, color?: string, alpha = 0.92, ampM = 1): void {
    const ctx = this.ctx;
    const pts = this.pts(ctrl, false, ampM);
    ctx.beginPath();
    ribbonPath(ctx, pts, this.lw(lwM), this.next());
    ctx.fillStyle = color ?? this.L.ink;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** A straight nib stroke. */
  seg(u0: number, v0: number, u1: number, v1: number, lwM = 1, color?: string, alpha = 0.92): void {
    const ctx = this.ctx;
    linePts(PTS, this.X(u0), this.Y(v0), this.X(u1), this.Y(v1), { amp: this.amp(), seed: this.next(), boil: this.boil, step: 5 * this.px, wl: this.px });
    ctx.beginPath();
    ribbonPath(ctx, PTS, this.lw(lwM), this.n);
    ctx.fillStyle = color ?? this.L.ink;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Thin marks (hatching, grain) as one stroked path of straight local segments [u0, v0, u1, v1, ...]. */
  marks(segs: number[], color: string, widthPx: number, alpha: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      ctx.moveTo(this.X(segs[i]), this.Y(segs[i + 1]));
      ctx.lineTo(this.X(segs[i + 2]), this.Y(segs[i + 3]));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.6, widthPx * this.px);
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** A wobbly ellipse, filled and outlined. */
  ellipse(cu: number, cv: number, ru: number, rv: number, rot: number, fill: string | CanvasPattern | null, lwM = 1, alpha = 0.95): void {
    const ctx = this.ctx;
    ellipsePts(PTS, this.X(cu), this.Y(cv), this.D(ru), this.D(rv), -rot * this.flip, this.amp(0.7), this.next(), this.boil);
    if (fill) {
      ctx.beginPath();
      polyPath(ctx, PTS, true);
      ctx.fillStyle = fill;
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (lwM > 0) {
      ctx.beginPath();
      ringPath(ctx, PTS, this.lw(lwM), this.next());
      ctx.fillStyle = this.L.ink;
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** A plain filled circle (dots, berries, flecks). */
  dot(cu: number, cv: number, r: number, color: string, alpha = 1): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(this.X(cu), this.Y(cv), Math.max(0.6, this.D(r)), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Radiating ink strokes for light (never a digital glow). */
  rays(cu: number, cv: number, r0: number, r1: number, count: number, color: string, alpha: number, phase = 0, widthPx = 1): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const a = phase + (i / count) * Math.PI * 2;
      const j = 0.75 + 0.5 * (((i * 7919 + this.seed) % 13) / 13);
      ctx.moveTo(this.X(cu) + Math.cos(a) * this.D(r0), this.Y(cv) - Math.sin(a) * this.D(r0));
      ctx.lineTo(this.X(cu) + Math.cos(a) * this.D(r1 * j), this.Y(cv) - Math.sin(a) * this.D(r1 * j));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.7, widthPx * this.px);
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Mixes towards the page's ink, for a darker version of a colour. */
  darker(c: RGB | string, t = 0.45): string {
    const v = typeof c === 'string' ? rgb(c) : c;
    return css(depthTint(this.T, mix(v, this.T.inv ? this.T.paperShade : this.T.ink, t), this.z + 0.5, this.tintAmt));
  }
  lighter(c: RGB | string, t = 0.45): string {
    const v = typeof c === 'string' ? rgb(c) : c;
    return css(depthTint(this.T, mix(v, [255, 250, 236], t), this.z + 0.5, this.tintAmt));
  }
}
