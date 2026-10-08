import type { PaletteId } from '../game/types';
import type { ViewState } from '../game/view';
import { css, mix, rgb, type RGB } from './color';
import { makeCanvas, washTile } from './ink';
import { hash, hs, rng, TAU } from './rand';
import type { Tones } from './tones';

/**
 * Behind the world: faint hand-ruled staves through the sky and ink-wash
 * silhouettes in two parallax bands, chosen per movement (dawn meadow and ruins,
 * a misty lake with willows, an autumn village, a moonlit garden, the inside of a
 * clocktower, a concert hall). Every band is a horizontally seamless tile made
 * once per palette and size.
 */

interface Band {
  cv: HTMLCanvasElement;
  /** Tile width and painted height in device pixels (the canvas has a skirt below). */
  tw: number;
  th: number;
  skirt: number;
  /** Horizontal and vertical parallax. */
  fx: number;
  fy: number;
  /** Baseline height above the camera's ground line, in world units. */
  lift: number;
  /** Fill below the band so no paper shows under it. */
  base: string | null;
}

export class Backdrop {
  private bands: Band[] = [];
  private staves: HTMLCanvasElement | null = null;
  private stavesTW = 0;
  private stavesTH = 0;
  private sky: HTMLCanvasElement | null = null;
  private clouds: HTMLCanvasElement | null = null;
  private emblemFront = false;
  private key = '';
  private rs = 1;
  private refY = NaN;
  private groundY = NaN;
  private lastNow = 0;
  private washCv: HTMLCanvasElement | null = null;
  private washPat: CanvasPattern | null = null;
  private washCtx: CanvasRenderingContext2D | null = null;
  /** Low quality: skip the clouds. */
  lite = false;

  build(t: Tones, id: PaletteId, w: number, h: number, dpr: number, ppu: number): void {
    const key = `${id}|${t.pal.paper}|${w}|${h}|${dpr}|${ppu.toFixed(2)}`;
    if (key === this.key) return;
    this.key = key;
    this.rs = Math.min(dpr, 1.5);
    this.washCv = null;
    this.washPat = null;
    this.groundY = NaN;
    const U = ppu * this.rs;
    // Whole multiples of the granulation tile so the band tiles without a seam.
    const tw = Math.ceil((Math.max(1500, w * 1.1) * this.rs) / 256) * 256;
    const style = STYLE[id] ?? STYLE.dawn;
    const c = colours(t);
    this.bands = [];
    const skirt = Math.round(5 * U);
    const far = this.makeBand(tw, Math.round(9 * U), skirt, 0.1, 0.12, 1.3, css(c.farFill));
    style.far(far.cv.getContext('2d')!, far.tw, far.th, U * 0.72, c, t);
    this.finishBand(far, t);
    const mid = this.makeBand(tw, Math.round(8 * U), skirt, 0.26, 0.28, -0.4, css(c.midFill));
    style.mid(mid.cv.getContext('2d')!, mid.tw, mid.th, U * 0.92, c, t);
    this.finishBand(mid, t);
    this.bands.push(far, mid);
    this.buildStaves(t, ppu, id);
    this.buildSky(t, id, ppu);
    this.buildClouds(t, id, w, h, ppu);
    this.emblemFront = id === 'finale';
  }

  private makeBand(tw: number, th: number, skirt: number, fx: number, fy: number, lift: number, base: string | null): Band {
    return { cv: makeCanvas(tw, th + skirt), tw, th, skirt, fx, fy, lift, base };
  }

  private finishBand(b: Band, t: Tones): void {
    const g = b.cv.getContext('2d')!;
    // The skirt under the band continues the band's own bottom edge, sampled in a few places.
    const samples: number[][] = [];
    for (let i = 0; i < 7; i++) {
      const d = g.getImageData(Math.floor((b.tw * (i + 0.5)) / 7), b.th - 2, 1, 1).data;
      if (d[3] > 200) samples.push([d[0], d[1], d[2]]);
    }
    if (samples.length) {
      samples.sort((a, c) => a[0] + a[1] + a[2] - (c[0] + c[1] + c[2]));
      const m = samples[Math.floor(samples.length / 2)];
      b.base = `rgb(${m[0]},${m[1]},${m[2]})`;
    }
    if (b.base) {
      g.fillStyle = b.base;
      g.fillRect(0, b.th - 1, b.tw, b.skirt + 1);
    }
    if (!this.washCv) this.washCv = washTile(256, t.inv ? t.paperShade : t.shade, t.inv ? 0.22 : 0.1, 19);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = g.createPattern(this.washCv, 'repeat')!;
    g.fillRect(0, 0, b.tw, b.th + b.skirt);
    g.globalCompositeOperation = 'source-over';
  }

  private buildStaves(t: Tones, ppu: number, id: PaletteId): void {
    const rs = this.rs;
    const gap = Math.max(5, ppu * 0.13) * rs;
    const spacing = Math.max(70, ppu * 2.1) * rs;
    const tw = Math.round(1400 * rs);
    const th = Math.round(spacing * 3);
    this.stavesTW = tw;
    this.stavesTH = th;
    const cv = makeCanvas(tw, th);
    const g = cv.getContext('2d')!;
    const ink = css(t.inkFar);
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineCap = 'round';
    const r = rng(1234);
    for (let s = 0; s < 3; s++) {
      const top = s * spacing + spacing * 0.3;
      // Five hand-ruled lines that sag and lift a little, seamless across the tile.
      g.lineWidth = Math.max(0.6, 0.75 * rs);
      g.globalAlpha = 0.5;
      g.beginPath();
      for (let l = 0; l < 5; l++) {
        const y0 = top + l * gap;
        const p1 = hash(s, l, 1) * TAU;
        for (let i = 0; i <= 80; i++) {
          const x = (i / 80) * tw;
          const y = y0 + Math.sin((x / tw) * TAU * 2 + p1) * gap * 0.12 + Math.sin((x / tw) * TAU * 5 + p1 * 2) * gap * 0.05;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
      }
      g.stroke();
      // Bar lines, a clef now and then, and a few faint notes.
      const bars = 4;
      g.beginPath();
      for (let b = 0; b < bars; b++) {
        const x = (tw * (b + 0.15 + hash(s, b, 2) * 0.1)) / bars;
        g.moveTo(x, top - gap * 0.05);
        g.lineTo(x + gap * 0.1, top + gap * 4.05);
      }
      g.stroke();
      g.globalAlpha = 0.42;
      for (let b = 0; b < bars; b++) {
        const xb = (tw * (b + 0.15 + hash(s, b, 2) * 0.1)) / bars;
        if (hash(s, b, 3) < 0.35) clef(g, xb + gap * 1.6, top, gap);
        const notes = 2 + Math.floor(r() * 4);
        for (let n = 0; n < notes; n++) {
          const x = xb + gap * 4 + (n * (tw / bars - gap * 6)) / notes + r() * gap;
          const step = Math.floor(r() * 9) - 1;
          const y = top + gap * 4 - (step * gap) / 2;
          noteGlyph(g, x, y, gap, r() < 0.5, r() < 0.3);
        }
      }
      g.globalAlpha = 1;
    }
    if (t.inv || id === 'night') {
      // Stars among the staves on the dark page.
      const sr = rng(55);
      for (let i = 0; i < 70; i++) {
        const x = sr() * tw;
        const y = sr() * th;
        const big = sr() < 0.15;
        g.globalAlpha = big ? 0.85 : 0.5 + sr() * 0.3;
        g.fillStyle = css(mix(t.ink, rgb('#ffffff'), 0.3));
        if (big) {
          const rr = (2 + sr() * 2) * rs;
          g.beginPath();
          g.moveTo(x - rr, y);
          g.lineTo(x + rr, y);
          g.moveTo(x, y - rr);
          g.lineTo(x, y + rr);
          g.strokeStyle = g.fillStyle;
          g.lineWidth = 0.8 * rs;
          g.stroke();
        }
        g.beginPath();
        g.arc(x, y, (0.5 + sr() * 0.7) * rs, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    this.staves = cv;
  }

  /** Ink-wash clouds for the open-sky movements, a seamless tile that drifts slowly. */
  private buildClouds(t: Tones, id: PaletteId, w: number, h: number, ppu: number): void {
    this.clouds = null;
    if (id !== 'dawn' && id !== 'title' && id !== 'autumn' && id !== 'lake') return;
    const rs = this.rs;
    const tw = Math.ceil((Math.max(1200, w * 1.4) * rs) / 64) * 64;
    const th = Math.round(Math.max(200, h * 0.5) * rs);
    const cv = makeCanvas(tw, th);
    const g = cv.getContext('2d')!;
    const r = rng(id.length * 97 + 5);
    const U = Math.max(20, ppu) * rs;
    const light = mix(t.paper, rgb('#fffdf6'), 0.55);
    const under = mix(t.paper, rgb(t.pal.washFar), id === 'lake' ? 0.25 : 0.35);
    const ink = mix(t.paper, t.inkFar, 0.55);
    const n = 4 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const cx = (tw * (i + 0.2 + r() * 0.6)) / n;
      const cy = th * (0.18 + r() * 0.55);
      const len = U * (id === 'lake' ? 4.5 + r() * 3 : 2.2 + r() * 2.2);
      const puffs = id === 'lake' ? 3 : 4 + Math.floor(r() * 3);
      const seed = Math.floor(r() * 1000);
      wrap(tw, cx, len, (x) => cloud(g, x, cy, len, puffs, seed, light, under, ink, U, id === 'lake'));
    }
    this.clouds = cv;
  }

  private buildSky(t: Tones, id: PaletteId, ppu: number): void {
    const rs = this.rs;
    const R = Math.max(22, ppu * 0.95) * rs;
    const size = Math.ceil(R * 5.2);
    const cv = makeCanvas(size, size);
    const g = cv.getContext('2d')!;
    const cx = size / 2;
    const cy = size / 2;
    g.lineCap = 'round';
    const style = STYLE[id] ?? STYLE.dawn;
    style.sky(g, cx, cy, R, t, rs);
    this.sky = cv;
  }

  /**
   * Draws staves, the sky emblem and the silhouette bands. `W`, `H` are device pixels.
   * `ground` is the height the player stands at; the bands settle on it slowly, so they
   * sit behind the ground however the camera frames the page.
   */
  draw(ctx: CanvasRenderingContext2D, view: ViewState, W: number, H: number, levelW: number, now: number, ground: number): void {
    const dt = Math.min(0.1, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    if (!Number.isFinite(this.refY) || Math.abs(view.c2.y - this.refY) > 9) this.refY = view.c2.y;
    this.refY += (view.c2.y - this.refY) * (1 - Math.exp(-0.7 * dt));
    if (!Number.isFinite(this.groundY) || Math.abs(ground - this.groundY) > 6) this.groundY = ground;
    this.groundY += (ground - this.groundY) * (1 - Math.exp(-0.9 * dt));
    const dpr = view.dpr;
    const ppu = view.ppu;
    const s = dpr / this.rs;
    const dy = (view.c2.y - this.refY) * ppu * dpr;
    ctx.imageSmoothingEnabled = true;

    // Staves through the upper sky, fading towards the horizon.
    if (this.staves) {
      const tw = this.stavesTW * s;
      const th = this.stavesTH * s;
      const ox = -((((view.c2.x * ppu * 0.06 * dpr) % tw) + tw) % tw);
      const oy = dy * 0.08 - th * 0.12;
      const rows = Math.ceil((H * 0.62) / th) + 1;
      for (let r = 0; r < rows; r++) {
        const y = oy + r * th;
        if (y > H * 0.7) break;
        ctx.globalAlpha = Math.max(0, 0.75 - (y / H) * 0.85);
        for (let x = ox; x < W; x += tw) ctx.drawImage(this.staves, x, y, tw, th);
      }
      ctx.globalAlpha = 1;
    }
    // The sky emblem: sun, moon, clock face or chandelier (the chandelier hangs in front of the boxes).
    const emblemAfterFar = this.emblemFront;
    if (this.sky && !emblemAfterFar) {
      const size = this.sky.width * s;
      const x = W * 0.76 - (view.c2.x - levelW / 2) * ppu * dpr * 0.015 - size / 2;
      const y = H * 0.19 + dy * 0.03 - size / 2;
      ctx.globalAlpha = 0.82;
      ctx.drawImage(this.sky, x, y, size, size);
      ctx.globalAlpha = 1;
    }
    // Clouds drift slowly across the sky.
    if (this.clouds && !this.lite) {
      const tw = this.clouds.width * s;
      const th = this.clouds.height * s;
      const ox = -((((view.c2.x * ppu * 0.04 * dpr + now * 5 * dpr) % tw) + tw) % tw);
      const oy = H * 0.04 + dy * 0.04;
      for (let x = ox; x < W; x += tw) ctx.drawImage(this.clouds, x, oy, tw, th);
    }
    // Silhouette bands.
    for (let bi = 0; bi < this.bands.length; bi++) {
      const b = this.bands[bi];
      if (bi === 1 && emblemAfterFar && this.sky) {
        const size = this.sky.width * s;
        const x = W * 0.62 - (view.c2.x - levelW / 2) * ppu * dpr * 0.03 - size / 2;
        ctx.drawImage(this.sky, x, H * 0.1 + dy * 0.05 - size / 2, size, size);
      }
      const tw = b.tw * s;
      const th = b.th * s;
      const full = (b.th + b.skirt) * s;
      // The band's baseline sits on the (smoothed) ground line, nudged by vertical parallax.
      const groundLine = H / 2 - (this.groundY - view.c2.y) * ppu * dpr;
      const baseY = groundLine - b.lift * ppu * dpr + dy * b.fy;
      const top = baseY - th;
      const ox = -((((view.c2.x * ppu * b.fx * dpr) % tw) + tw) % tw);
      for (let x = ox; x < W; x += tw) ctx.drawImage(b.cv, x, top, tw, full);
      if (b.base && top + full < H) {
        // Continue the band's wash below it with the same granulation, aligned to the tile.
        ctx.fillStyle = b.base;
        ctx.fillRect(0, top + full - 1, W, H - (top + full) + 1);
        const pat = this.pattern(ctx);
        if (pat) {
          pat.setTransform(new DOMMatrix([s, 0, 0, s, ox, top]));
          ctx.fillStyle = pat;
          ctx.fillRect(0, top + full - 1, W, H - (top + full) + 1);
        }
      }
    }
  }

  private pattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (!this.washCv) return null;
    if (!this.washPat || this.washCtx !== ctx) {
      this.washPat = ctx.createPattern(this.washCv, 'repeat');
      this.washCtx = ctx;
    }
    return this.washPat;
  }
}

// ---------------------------------------------------------------- colours

interface Cols {
  farFill: RGB;
  farInk: RGB;
  midFill: RGB;
  midInk: RGB;
  paper: RGB;
  gold: RGB;
  hatch: RGB;
  accent: RGB;
}

function colours(t: Tones): Cols {
  const p = t.paper;
  const far = rgb(t.pal.washFar);
  const sky = rgb(t.pal.skyTop);
  const top = rgb(t.pal.topColor);
  const farFill = t.inv ? mix(p, mix(far, sky, 0.3), 0.55) : mix(mix(p, far, 0.36), sky, 0.1);
  const midFill = t.inv ? mix(p, mix(far, top, 0.25), 0.85) : mix(mix(p, far, 0.66), top, 0.1);
  return {
    farFill,
    farInk: mix(p, t.inkFar, t.inv ? 0.55 : 0.45),
    midFill,
    midInk: mix(p, t.inkFar, t.inv ? 0.8 : 0.78),
    paper: p,
    gold: t.gold,
    hatch: mix(p, t.inkFar, t.inv ? 0.7 : 0.6),
    accent: mix(p, rgb(t.pal.mats.leaf.color), 0.5),
  };
}

// ---------------------------------------------------------------- shared silhouettes

type Painter = (g: CanvasRenderingContext2D, tw: number, th: number, U: number, c: Cols, t: Tones) => void;
type SkyPainter = (g: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: Tones, rs: number) => void;

/** Seamless hills: a sum of sines with whole-number frequencies across the tile. */
function hills(g: CanvasRenderingContext2D, tw: number, th: number, baseUp: number, amps: number[], seed: number, fill: RGB, ink: RGB, U: number, hatch: RGB | null): (x: number) => number {
  const ph = amps.map((_, i) => hash(seed, i) * TAU);
  const freq = amps.map((_, i) => [1, 2, 3, 5, 8, 13][i] ?? i + 2);
  const yAt = (x: number) => {
    let v = 0;
    for (let i = 0; i < amps.length; i++) v += amps[i] * Math.sin((x / tw) * TAU * freq[i] + ph[i]);
    return th - baseUp - v;
  };
  g.beginPath();
  g.moveTo(0, th);
  for (let i = 0; i <= 200; i++) {
    const x = (i / 200) * tw;
    g.lineTo(x, yAt(x));
  }
  g.lineTo(tw, th);
  g.closePath();
  g.fillStyle = css(fill);
  g.fill();
  g.beginPath();
  for (let i = 0; i <= 200; i++) {
    const x = (i / 200) * tw;
    const y = yAt(x) + hs(seed, i, 3) * 0.6;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.strokeStyle = css(ink);
  g.lineWidth = Math.max(0.8, U * 0.025);
  g.globalAlpha = 0.75;
  g.stroke();
  g.globalAlpha = 1;
  if (hatch) {
    // Short slanting strokes on the shaded flanks.
    g.beginPath();
    const r = rng(seed + 9);
    for (let i = 0; i < tw / (U * 0.12); i++) {
      const x = r() * tw;
      const y0 = yAt(x);
      const slope = yAt(x + 4) - y0;
      if (slope < 0.4) continue;
      const y = y0 + U * (0.15 + r() * 0.8);
      const len = U * (0.15 + r() * 0.25);
      g.moveTo(x, y);
      g.lineTo(x + len * 0.6, y + len);
    }
    g.strokeStyle = css(hatch);
    g.lineWidth = Math.max(0.6, U * 0.012);
    g.globalAlpha = 0.5;
    g.stroke();
    g.globalAlpha = 1;
  }
  return yAt;
}

/** Calls fn at x and at its wrapped copies so a feature crossing the tile edge is seamless. */
function wrap(tw: number, x: number, half: number, fn: (x: number) => void): void {
  fn(x);
  if (x - half < 0) fn(x + tw);
  if (x + half > tw) fn(x - tw);
}

function inkFill(g: CanvasRenderingContext2D, fill: RGB, ink: RGB, lw: number, alpha = 0.8): void {
  g.fillStyle = css(fill);
  g.fill();
  g.strokeStyle = css(ink);
  g.lineWidth = lw;
  g.globalAlpha = alpha;
  g.stroke();
  g.globalAlpha = 1;
}

function roundTree(g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: RGB, ink: RGB, seed: number): void {
  g.beginPath();
  g.moveTo(x - s * 0.06, y);
  g.lineTo(x - s * 0.04, y - s * 0.6);
  g.lineTo(x + s * 0.04, y - s * 0.6);
  g.lineTo(x + s * 0.06, y);
  inkFill(g, fill, ink, Math.max(0.6, s * 0.03));
  g.beginPath();
  const lobes = 7;
  for (let i = 0; i <= lobes * 4; i++) {
    const a = (i / (lobes * 4)) * TAU;
    const k = 0.85 + 0.15 * Math.sqrt(Math.abs(Math.sin((a * lobes) / 2 + seed)));
    const px = x + Math.cos(a) * s * 0.5 * k;
    const py = y - s * 0.95 + Math.sin(a) * s * 0.42 * k;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  inkFill(g, fill, ink, Math.max(0.6, s * 0.03));
}

function cloud(g: CanvasRenderingContext2D, x: number, y: number, len: number, puffs: number, seed: number, light: RGB, under: RGB, ink: RGB, U: number, flat: boolean): void {
  // Overlapping round puffs on a flat base. The outline is drawn first and the puffs
  // filled over it, so only the silhouette keeps its line.
  const circles: [number, number, number][] = [];
  const n = flat ? puffs + 3 : puffs + 2;
  for (let i = 0; i < n; i++) {
    const u = -len / 2 + (len * (i + 0.5)) / n;
    const mid = 1 - Math.abs((i + 0.5) / n - 0.5) * 1.6;
    const r = U * (flat ? 0.28 + 0.2 * mid : 0.35 + 0.45 * mid) * (0.8 + 0.4 * hash(seed, i));
    circles.push([x + u + hs(seed, i, 2) * U * 0.1, y - r * (flat ? 0.3 : 0.55), r]);
  }
  const base = y + U * 0.05;
  const draw = (pass: 'line' | 'fill') => {
    g.save();
    g.beginPath();
    g.rect(x - len, y - U * 3, len * 2, base - (y - U * 3));
    g.clip();
    g.beginPath();
    for (const [cx, cy, r] of circles) {
      g.moveTo(cx + r, cy);
      g.arc(cx, cy, r, 0, TAU);
    }
    if (pass === 'line') {
      g.strokeStyle = css(ink);
      g.lineWidth = Math.max(1.2, U * 0.05);
      g.globalAlpha = 0.4;
      g.stroke();
    } else {
      g.fillStyle = css(light);
      g.globalAlpha = 1;
      g.fill();
      // A greyer wash underneath, inside the puffs.
      g.clip();
      g.beginPath();
      g.ellipse(x, base, len * 0.6, U * (flat ? 0.25 : 0.45), 0, 0, TAU);
      g.fillStyle = css(under);
      g.globalAlpha = 0.55;
      g.fill();
    }
    g.restore();
  };
  draw('line');
  draw('fill');
  // The flat base line, faint.
  g.beginPath();
  g.moveTo(circles[0][0] - circles[0][2] * 0.6, base);
  g.lineTo(circles[n - 1][0] + circles[n - 1][2] * 0.6, base);
  g.strokeStyle = css(ink);
  g.lineWidth = Math.max(0.7, U * 0.02);
  g.globalAlpha = 0.25;
  g.stroke();
  g.globalAlpha = 1;
}

function cypress(g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: RGB, ink: RGB): void {
  g.beginPath();
  g.moveTo(x, y - s * 2.2);
  g.bezierCurveTo(x + s * 0.32, y - s * 1.6, x + s * 0.3, y - s * 0.4, x + s * 0.12, y);
  g.lineTo(x - s * 0.12, y);
  g.bezierCurveTo(x - s * 0.3, y - s * 0.4, x - s * 0.32, y - s * 1.6, x, y - s * 2.2);
  inkFill(g, fill, ink, Math.max(0.6, s * 0.03));
}

function tower(g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: RGB, ink: RGB, broken: boolean): void {
  const w = s * 0.5;
  const h = s * 1.8;
  g.beginPath();
  g.moveTo(x - w / 2, y);
  g.lineTo(x - w / 2, y - h);
  if (broken) {
    g.lineTo(x - w * 0.2, y - h - s * 0.15);
    g.lineTo(x, y - h + s * 0.1);
    g.lineTo(x + w * 0.25, y - h + s * 0.25);
  } else {
    for (let i = 0; i < 4; i++) {
      const cx = x - w / 2 + (w * i) / 4;
      g.lineTo(cx, y - h - s * 0.12);
      g.lineTo(cx + w / 8, y - h - s * 0.12);
      g.lineTo(cx + w / 8, y - h);
      g.lineTo(cx + w / 4, y - h);
    }
  }
  g.lineTo(x + w / 2, y - h + (broken ? s * 0.4 : 0));
  g.lineTo(x + w / 2, y);
  g.closePath();
  inkFill(g, fill, ink, Math.max(0.6, s * 0.025));
  // A dark window slit.
  g.beginPath();
  g.rect(x - s * 0.04, y - h * 0.7, s * 0.08, s * 0.22);
  g.fillStyle = css(ink);
  g.globalAlpha = 0.6;
  g.fill();
  g.globalAlpha = 1;
}

function ruinArch(g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: RGB, ink: RGB): void {
  const ro = s * 0.75;
  const ri = s * 0.5;
  const ph = s * 0.9;
  g.beginPath();
  g.moveTo(x - ro, y);
  g.lineTo(x - ro, y - ph);
  g.arc(x, y - ph, ro, Math.PI, Math.PI * 1.75);
  g.lineTo(x + Math.cos(Math.PI * 1.75) * ri, y - ph + Math.sin(Math.PI * 1.75) * ri);
  g.arc(x, y - ph, ri, Math.PI * 1.75, Math.PI, true);
  g.lineTo(x - ri, y);
  g.closePath();
  inkFill(g, fill, ink, Math.max(0.6, s * 0.025));
  g.beginPath();
  g.rect(x + ri, y - ph * 0.7, ro - ri, ph * 0.7);
  inkFill(g, fill, ink, Math.max(0.6, s * 0.025));
}

function colonnade(g: CanvasRenderingContext2D, x: number, y: number, s: number, n: number, fill: RGB, ink: RGB, seed: number): void {
  const gap = s * 0.55;
  for (let i = 0; i < n; i++) {
    const cx = x + (i - (n - 1) / 2) * gap;
    const h = s * (1.3 - (hash(seed, i) < 0.35 ? hash(seed, i, 2) * 0.7 : 0));
    g.beginPath();
    g.rect(cx - s * 0.09, y - h, s * 0.18, h);
    inkFill(g, fill, ink, Math.max(0.6, s * 0.022));
  }
  g.beginPath();
  g.rect(x - ((n - 1) / 2) * gap - s * 0.15, y - s * 1.42, (n - 2) * gap + s * 0.3, s * 0.12);
  inkFill(g, fill, ink, Math.max(0.6, s * 0.022));
}

function house(g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: RGB, roof: RGB, ink: RGB, seed: number, timber: boolean): void {
  const w = s * (0.8 + hash(seed, 1) * 0.5);
  const h = s * (0.6 + hash(seed, 2) * 0.4);
  const rh = s * (0.5 + hash(seed, 3) * 0.3);
  g.beginPath();
  g.rect(x - w / 2, y - h, w, h);
  inkFill(g, fill, ink, Math.max(0.6, s * 0.025));
  if (timber) {
    g.beginPath();
    g.moveTo(x - w / 2, y - h * 0.5);
    g.lineTo(x + w / 2, y - h * 0.5);
    g.moveTo(x - w / 4, y - h);
    g.lineTo(x - w / 4, y);
    g.moveTo(x + w / 4, y - h);
    g.lineTo(x + w / 4, y);
    g.moveTo(x - w / 2, y - h);
    g.lineTo(x - w / 4, y - h * 0.5);
    g.strokeStyle = css(ink);
    g.lineWidth = Math.max(0.5, s * 0.02);
    g.globalAlpha = 0.6;
    g.stroke();
    g.globalAlpha = 1;
  }
  // Chimney then roof.
  if (hash(seed, 4) < 0.6) {
    g.beginPath();
    g.rect(x + w * 0.18, y - h - rh * 0.9, s * 0.1, rh * 0.6);
    inkFill(g, fill, ink, Math.max(0.6, s * 0.02));
  }
  g.beginPath();
  g.moveTo(x - w / 2 - s * 0.08, y - h);
  g.lineTo(x, y - h - rh);
  g.lineTo(x + w / 2 + s * 0.08, y - h);
  g.closePath();
  inkFill(g, roof, ink, Math.max(0.6, s * 0.025));
  g.beginPath();
  for (let i = 1; i < 4; i++) {
    const yy = y - h - (rh * i) / 4;
    const hw = (w / 2 + s * 0.08) * (1 - i / 4);
    g.moveTo(x - hw, yy);
    g.lineTo(x + hw, yy);
  }
  g.strokeStyle = css(ink);
  g.lineWidth = Math.max(0.4, s * 0.012);
  g.globalAlpha = 0.45;
  g.stroke();
  g.globalAlpha = 1;
  // A lit window.
  g.beginPath();
  g.rect(x - s * 0.07, y - h * 0.75, s * 0.14, s * 0.16);
  g.fillStyle = css(ink);
  g.globalAlpha = 0.55;
  g.fill();
  g.globalAlpha = 1;
}

function willow(g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: RGB, ink: RGB, seed: number): void {
  const r = rng(seed);
  const topX = x + s * 0.08;
  const topY = y - s * 1.35;
  // A leaning trunk that forks.
  g.beginPath();
  g.moveTo(x - s * 0.09, y);
  g.quadraticCurveTo(x - s * 0.03, y - s * 0.75, topX - s * 0.02, topY);
  g.lineTo(topX + s * 0.07, topY + s * 0.02);
  g.quadraticCurveTo(x + s * 0.06, y - s * 0.7, x + s * 0.11, y);
  inkFill(g, fill, ink, Math.max(0.6, s * 0.025));
  // A soft mass of foliage behind the strands, from overlapping washes.
  g.fillStyle = css(fill);
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i / 5) * Math.PI;
    g.beginPath();
    g.ellipse(topX + Math.cos(a) * s * 0.55, topY + s * 0.1 + Math.sin(a) * s * 0.25 + s * 0.35, s * 0.32, s * 0.5, 0, 0, TAU);
    g.globalAlpha = 0.55;
    g.fill();
  }
  g.globalAlpha = 1;
  // Arching boughs, each shedding curtains of thin hanging strands.
  g.beginPath();
  const boughs = 5;
  for (let b = 0; b < boughs; b++) {
    const dir = (b / (boughs - 1)) * 2 - 1;
    const ex = topX + dir * s * (0.6 + r() * 0.25);
    const ey = topY + s * (0.05 + Math.abs(dir) * 0.25);
    const cx = topX + dir * s * 0.3;
    const cy = topY - s * (0.25 + r() * 0.1);
    g.moveTo(topX, topY);
    g.quadraticCurveTo(cx, cy, ex, ey);
    for (let k = 1; k <= 7; k++) {
      const t = k / 8;
      const bx = (1 - t) * (1 - t) * topX + 2 * (1 - t) * t * cx + t * t * ex;
      const by = (1 - t) * (1 - t) * topY + 2 * (1 - t) * t * cy + t * t * ey;
      const len = s * (0.45 + r() * 0.7) * (0.5 + t * 0.6);
      const sway = (r() - 0.5) * s * 0.08;
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx + sway, by + len * 0.5, bx + sway * 0.4 + dir * s * 0.03, by + len);
    }
  }
  g.strokeStyle = css(ink);
  g.lineWidth = Math.max(0.5, s * 0.016);
  g.globalAlpha = 0.65;
  g.stroke();
  g.globalAlpha = 1;
}

function gearShape(g: CanvasRenderingContext2D, x: number, y: number, R: number, teeth: number, rot: number, fill: RGB, ink: RGB): void {
  g.beginPath();
  for (let i = 0; i < teeth * 4; i++) {
    const a = rot + (i / (teeth * 4)) * TAU;
    const rr = i % 4 === 1 || i % 4 === 2 ? R : R * 0.86;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.moveTo(x + R * 0.62, y);
  g.arc(x, y, R * 0.62, 0, TAU);
  g.fillStyle = css(fill);
  g.fill('evenodd');
  g.strokeStyle = css(ink);
  g.lineWidth = Math.max(0.6, R * 0.02);
  g.globalAlpha = 0.75;
  g.stroke();
  g.globalAlpha = 1;
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i / 6) * TAU;
    g.moveTo(x + Math.cos(a) * R * 0.15, y + Math.sin(a) * R * 0.15);
    g.lineTo(x + Math.cos(a) * R * 0.64, y + Math.sin(a) * R * 0.64);
  }
  g.strokeStyle = css(fill);
  g.lineWidth = R * 0.1;
  g.stroke();
  g.beginPath();
  g.arc(x, y, R * 0.18, 0, TAU);
  inkFill(g, fill, ink, Math.max(0.6, R * 0.02));
}

function pipeBank(g: CanvasRenderingContext2D, x: number, y: number, s: number, n: number, fill: RGB, ink: RGB, light: RGB): void {
  const w = s * 0.32;
  for (let i = 0; i < n; i++) {
    const mid = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2 || 1);
    const h = s * (3.2 - mid * 1.6);
    const px = x + (i - (n - 1) / 2) * w * 1.15;
    g.beginPath();
    g.moveTo(px - w * 0.2, y);
    g.lineTo(px - w / 2, y - s * 0.3);
    g.lineTo(px - w / 2, y - h);
    g.lineTo(px + w / 2, y - h);
    g.lineTo(px + w / 2, y - s * 0.3);
    g.lineTo(px + w * 0.2, y);
    g.closePath();
    inkFill(g, fill, ink, Math.max(0.6, s * 0.02));
    g.beginPath();
    g.moveTo(px - w * 0.22, y - s * 0.45);
    g.lineTo(px - w * 0.22, y - h + s * 0.08);
    g.strokeStyle = css(light);
    g.lineWidth = Math.max(0.6, w * 0.12);
    g.globalAlpha = 0.6;
    g.stroke();
    g.globalAlpha = 1;
  }
}

function clef(g: CanvasRenderingContext2D, x: number, top: number, gap: number): void {
  g.beginPath();
  const y = top + gap * 3;
  g.moveTo(x + gap * 0.2, top + gap * 5.2);
  g.bezierCurveTo(x - gap * 0.6, top + gap * 4.8, x + gap * 0.6, top - gap * 1.2, x + gap * 0.25, top - gap * 0.8);
  g.bezierCurveTo(x - gap * 0.4, top - gap * 0.4, x - gap * 0.9, y - gap * 0.5, x, y + gap * 0.4);
  g.bezierCurveTo(x + gap * 0.9, y + gap * 0.9, x + gap * 1, y - gap * 0.9, x + gap * 0.1, y - gap * 0.6);
  g.lineWidth = Math.max(0.7, gap * 0.16);
  g.stroke();
}

function noteGlyph(g: CanvasRenderingContext2D, x: number, y: number, gap: number, flag: boolean, open: boolean): void {
  g.beginPath();
  g.ellipse(x, y, gap * 0.62, gap * 0.45, -0.4, 0, TAU);
  if (open) {
    g.lineWidth = Math.max(0.6, gap * 0.14);
    g.stroke();
  } else g.fill();
  g.beginPath();
  g.moveTo(x + gap * 0.55, y);
  g.lineTo(x + gap * 0.55, y - gap * 3.2);
  if (flag) g.quadraticCurveTo(x + gap * 1.4, y - gap * 2.4, x + gap * 1.1, y - gap * 1.4);
  g.lineWidth = Math.max(0.6, gap * 0.12);
  g.stroke();
}

// ---------------------------------------------------------------- palettes

const dawnFar: Painter = (g, tw, th, U, c) => {
  const yAt = hills(g, tw, th, U * 2.4, [U * 1.1, U * 0.6, U * 0.35, U * 0.12], 11, c.farFill, c.farInk, U, null);
  const r = rng(12);
  for (let i = 0; i < 4; i++) {
    const x = (tw * (i + r() * 0.6)) / 4;
    wrap(tw, x, U, (xx) => (i % 2 ? ruinArch(g, xx, yAt(xx) + U * 0.1, U * 0.8, c.farFill, c.farInk) : tower(g, xx, yAt(xx) + U * 0.15, U * 0.9, c.farFill, c.farInk, i === 2)));
  }
  for (let i = 0; i < 26; i++) {
    const x = r() * tw;
    wrap(tw, x, U * 0.3, (xx) => roundTree(g, xx, yAt(xx) + U * 0.1, U * (0.45 + r() * 0.25), c.farFill, c.farInk, i));
  }
};

const dawnMid: Painter = (g, tw, th, U, c) => {
  const yAt = hills(g, tw, th, U * 1.4, [U * 0.8, U * 0.45, U * 0.25], 21, c.midFill, c.midInk, U, c.hatch);
  const r = rng(22);
  for (let i = 0; i < 3; i++) {
    const x = (tw * (i + 0.3 + r() * 0.4)) / 3;
    wrap(tw, x, U * 2, (xx) => (i === 1 ? colonnade(g, xx, yAt(xx) + U * 0.15, U * 1.4, 5, c.midFill, c.midInk, i) : ruinArch(g, xx, yAt(xx) + U * 0.15, U * 1.3, c.midFill, c.midInk)));
  }
  for (let i = 0; i < 14; i++) {
    const x = r() * tw;
    wrap(tw, x, U * 0.8, (xx) => roundTree(g, xx, yAt(xx) + U * 0.15, U * (0.9 + r() * 0.6), c.midFill, c.midInk, i * 3));
  }
};

const lakeFar: Painter = (g, tw, th, U, c, t) => {
  // Sharp far peaks above the mist.
  const ph = [hash(31, 1) * TAU, hash(31, 2) * TAU, hash(31, 3) * TAU];
  const yAt = (x: number) => {
    const u = (x / tw) * TAU;
    return th - U * 3 - U * 1.6 * Math.abs(Math.sin(u * 2 + ph[0])) - U * 0.7 * Math.abs(Math.sin(u * 5 + ph[1])) - U * 0.25 * Math.sin(u * 11 + ph[2]);
  };
  g.beginPath();
  g.moveTo(0, th);
  for (let i = 0; i <= 240; i++) g.lineTo((i / 240) * tw, yAt((i / 240) * tw));
  g.lineTo(tw, th);
  g.closePath();
  inkFill(g, c.farFill, c.farInk, Math.max(0.7, U * 0.022), 0.6);
  // Mist bands laid over the foothills.
  const mist = mix(c.paper, rgb('#ffffff'), t.inv ? 0.05 : 0.4);
  for (let b = 0; b < 3; b++) {
    const y = th - U * (2.6 - b * 0.7);
    g.beginPath();
    for (let i = 0; i <= 60; i++) {
      const x = (i / 60) * tw;
      const yy = y + Math.sin((x / tw) * TAU * (2 + b) + b) * U * 0.2;
      if (i === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.strokeStyle = css(mist);
    g.lineCap = 'round';
    g.lineWidth = U * (0.5 - b * 0.08);
    g.globalAlpha = 0.18;
    g.stroke();
    g.lineWidth = U * (0.28 - b * 0.05);
    g.globalAlpha = 0.25;
    g.stroke();
  }
  g.globalAlpha = 1;
};

const lakeMid: Painter = (g, tw, th, U, c, t) => {
  const yAt = hills(g, tw, th, U * 1.2, [U * 0.3, U * 0.18, U * 0.1], 41, c.midFill, c.midInk, U, null);
  const r = rng(42);
  for (let i = 0; i < 7; i++) {
    const x = (tw * (i + r() * 0.7)) / 7;
    wrap(tw, x, U * 1.2, (xx) => willow(g, xx, yAt(xx) + U * 0.1, U * (1.2 + r() * 0.5), c.midFill, c.midInk, i));
  }
  // Water: still lines and broken reflections.
  const wy = th - U * 0.9;
  g.fillStyle = css(mix(c.midFill, rgb(t.pal.water ?? t.pal.washFar), 0.25));
  g.fillRect(0, wy, tw, th - wy);
  g.beginPath();
  for (let i = 0; i < tw / (U * 0.5); i++) {
    const x = r() * tw;
    const y = wy + U * 0.1 + r() * (th - wy - U * 0.15);
    const len = U * (0.3 + r() * 1.4);
    g.moveTo(x, y);
    g.lineTo(x + len, y + r() * 0.8);
  }
  g.strokeStyle = css(c.midInk);
  g.lineWidth = Math.max(0.6, U * 0.012);
  g.globalAlpha = 0.5;
  g.stroke();
  g.globalAlpha = 1;
};

const autumnFar: Painter = (g, tw, th, U, c) => {
  const yAt = hills(g, tw, th, U * 2.2, [U * 1.0, U * 0.5, U * 0.2], 51, c.farFill, c.farInk, U, null);
  const r = rng(52);
  for (let v = 0; v < 3; v++) {
    const vx = (tw * (v + 0.2 + r() * 0.5)) / 3;
    for (let i = 0; i < 6; i++) {
      const x = vx + (i - 2.5) * U * 0.75;
      wrap(tw, x, U, (xx) => house(g, xx, yAt(xx) + U * 0.2, U * 0.55, c.farFill, mix(c.farFill, c.farInk, 0.25), c.farInk, v * 10 + i, false));
    }
    // A church spire.
    const sx = vx + U * 0.4;
    wrap(tw, sx, U, (xx) => {
      const y = yAt(xx) + U * 0.2;
      g.beginPath();
      g.rect(xx - U * 0.18, y - U * 1.2, U * 0.36, U * 1.2);
      inkFill(g, c.farFill, c.farInk, Math.max(0.6, U * 0.02));
      g.beginPath();
      g.moveTo(xx - U * 0.22, y - U * 1.2);
      g.lineTo(xx, y - U * 2.3);
      g.lineTo(xx + U * 0.22, y - U * 1.2);
      g.closePath();
      inkFill(g, mix(c.farFill, c.farInk, 0.25), c.farInk, Math.max(0.6, U * 0.02));
    });
  }
};

const autumnMid: Painter = (g, tw, th, U, c) => {
  const yAt = hills(g, tw, th, U * 1.1, [U * 0.4, U * 0.2], 61, c.midFill, c.midInk, U, c.hatch);
  const r = rng(62);
  const roof = mix(c.midFill, rgb('#a0442a'), 0.25);
  const leaf = mix(c.midFill, rgb('#c46a2c'), 0.3);
  for (let i = 0; i < 9; i++) {
    const x = (tw * (i + r() * 0.5)) / 9;
    wrap(tw, x, U * 1.2, (xx) => house(g, xx, yAt(xx) + U * 0.2, U * (0.95 + r() * 0.3), c.midFill, roof, c.midInk, 100 + i, true));
    const tx = x + U * (0.9 + r() * 0.4);
    wrap(tw, tx, U, (xx) => roundTree(g, xx, yAt(xx) + U * 0.2, U * (0.9 + r() * 0.5), leaf, c.midInk, i * 7));
  }
};

const nightFar: Painter = (g, tw, th, U, c) => {
  const yAt = hills(g, tw, th, U * 2.2, [U * 0.8, U * 0.4, U * 0.2], 71, c.farFill, c.farInk, U, null);
  const r = rng(72);
  for (let i = 0; i < 18; i++) {
    const x = r() * tw;
    wrap(tw, x, U * 0.4, (xx) => cypress(g, xx, yAt(xx) + U * 0.1, U * (0.45 + r() * 0.35), c.farFill, c.farInk));
  }
  // A domed temple.
  const x = tw * 0.4;
  wrap(tw, x, U * 1.2, (xx) => {
    const y = yAt(xx) + U * 0.1;
    colonnade(g, xx, y, U * 0.9, 4, c.farFill, c.farInk, 3);
    g.beginPath();
    g.arc(xx, y - U * 1.3, U * 0.7, Math.PI, TAU);
    g.closePath();
    inkFill(g, c.farFill, c.farInk, Math.max(0.6, U * 0.02));
  });
};

const nightMid: Painter = (g, tw, th, U, c, t) => {
  const base = th - U * 1.0;
  g.beginPath();
  g.rect(0, base, tw, th - base);
  g.fillStyle = css(c.midFill);
  g.fill();
  const r = rng(82);
  for (let i = 0; i < 12; i++) {
    const x = (tw * (i + r() * 0.5)) / 12;
    const kind = i % 3;
    wrap(tw, x, U * 0.8, (xx) => {
      if (kind === 0) {
        // Topiary ball on a stem.
        g.beginPath();
        g.rect(xx - U * 0.05, base - U * 0.8, U * 0.1, U * 0.8);
        inkFill(g, c.midFill, c.midInk, Math.max(0.6, U * 0.02));
        g.beginPath();
        g.arc(xx, base - U * 1.15, U * 0.45, 0, TAU);
        inkFill(g, c.midFill, c.midInk, Math.max(0.6, U * 0.02));
      } else if (kind === 1) {
        g.beginPath();
        g.moveTo(xx - U * 0.4, base);
        g.lineTo(xx, base - U * 1.9);
        g.lineTo(xx + U * 0.4, base);
        g.closePath();
        inkFill(g, c.midFill, c.midInk, Math.max(0.6, U * 0.02));
      } else {
        // Lantern post with a tiny gold light.
        g.beginPath();
        g.rect(xx - U * 0.04, base - U * 1.4, U * 0.08, U * 1.4);
        inkFill(g, c.midFill, c.midInk, Math.max(0.6, U * 0.02));
        g.beginPath();
        g.arc(xx, base - U * 1.5, U * 0.12, 0, TAU);
        g.fillStyle = css(mix(t.gold, rgb('#fff2c0'), 0.4));
        g.fill();
        g.beginPath();
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU;
          g.moveTo(xx + Math.cos(a) * U * 0.2, base - U * 1.5 + Math.sin(a) * U * 0.2);
          g.lineTo(xx + Math.cos(a) * U * 0.36, base - U * 1.5 + Math.sin(a) * U * 0.36);
        }
        g.strokeStyle = css(t.gold);
        g.lineWidth = Math.max(0.6, U * 0.015);
        g.globalAlpha = 0.6;
        g.stroke();
        g.globalAlpha = 1;
      }
    });
  }
  // A hedge wall along the front.
  g.beginPath();
  g.moveTo(0, th);
  for (let i = 0; i <= 120; i++) {
    const x = (i / 120) * tw;
    g.lineTo(x, base + U * 0.15 - Math.abs(Math.sin((x / tw) * TAU * 30)) * U * 0.18);
  }
  g.lineTo(tw, th);
  g.closePath();
  inkFill(g, mix(c.midFill, c.midInk, 0.1), c.midInk, Math.max(0.6, U * 0.02));
};

const clockFar: Painter = (g, tw, th, U, c) => {
  // Tall arched windows between buttresses, then great gears.
  const n = 5;
  for (let i = 0; i < n; i++) {
    const x = (tw * (i + 0.5)) / n;
    const w = U * 1.1;
    const top = th - U * 7.6;
    g.beginPath();
    g.moveTo(x - w / 2, th);
    g.lineTo(x - w / 2, top + w / 2);
    g.arc(x, top + w / 2, w / 2, Math.PI, TAU);
    g.lineTo(x + w / 2, th);
    g.closePath();
    g.strokeStyle = css(c.farInk);
    g.lineWidth = Math.max(0.7, U * 0.03);
    g.globalAlpha = 0.6;
    g.stroke();
    g.beginPath();
    for (let k = 1; k < 6; k++) {
      g.moveTo(x - w / 2, top + w / 2 + k * U * 1.1);
      g.lineTo(x + w / 2, top + w / 2 + k * U * 1.1);
    }
    g.moveTo(x, top);
    g.lineTo(x, th);
    g.lineWidth = Math.max(0.5, U * 0.015);
    g.stroke();
    g.globalAlpha = 1;
  }
  const r = rng(91);
  for (let i = 0; i < 4; i++) {
    const x = (tw * (i + r() * 0.5)) / 4;
    const R = U * (1.2 + r() * 1.3);
    wrap(tw, x, R, (xx) => gearShape(g, xx, th - U * (1.5 + r() * 2.5), R, 10 + Math.floor(r() * 8), r() * 3, c.farFill, c.farInk));
  }
  g.fillStyle = css(c.farFill);
  g.fillRect(0, th - U * 0.6, tw, U * 0.6);
};

const clockMid: Painter = (g, tw, th, U, c) => {
  const r = rng(101);
  const light = mix(c.midFill, rgb('#fff0c8'), 0.4);
  for (let i = 0; i < 4; i++) {
    const x = (tw * (i + 0.3 + r() * 0.4)) / 4;
    wrap(tw, x, U * 2, (xx) => pipeBank(g, xx, th - U * 0.6, U * 0.9, 7, c.midFill, c.midInk, light));
    const gx = x + tw / 8;
    const R = U * (0.6 + r() * 0.5);
    wrap(tw, gx, R, (xx) => gearShape(g, xx, th - U * (1.6 + r()), R, 9 + Math.floor(r() * 4), r() * 3, c.midFill, c.midInk));
  }
  g.beginPath();
  g.rect(0, th - U * 0.6, tw, U * 0.6);
  inkFill(g, c.midFill, c.midInk, Math.max(0.6, U * 0.02));
  // A balustrade.
  g.beginPath();
  for (let x = 0; x < tw; x += U * 0.3) {
    g.moveTo(x, th - U * 0.6);
    g.lineTo(x, th - U * 1.05);
  }
  g.moveTo(0, th - U * 1.05);
  g.lineTo(tw, th - U * 1.05);
  g.strokeStyle = css(c.midInk);
  g.lineWidth = Math.max(0.6, U * 0.02);
  g.globalAlpha = 0.7;
  g.stroke();
  g.globalAlpha = 1;
};

const finaleFar: Painter = (g, tw, th, U, c, t) => {
  // Tiers of boxes round the hall: arched openings with deep red interiors, gilt rails, pilasters.
  const inside = mix(c.farFill, t.rubric, t.inv ? 0.3 : 0.35);
  const gilt = mix(c.farFill, t.gold, 0.55);
  for (let tier = 0; tier < 3; tier++) {
    const y = th - U * (1.6 + tier * 2.0);
    const h = U * 1.55;
    g.beginPath();
    g.rect(0, y - h, tw, h + U * 0.25);
    g.fillStyle = css(mix(c.farFill, c.farInk, 0.04 * tier));
    g.fill();
    const n = Math.round(tw / (U * 1.6));
    const bw = tw / n;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = bw * (i + 0.5);
      const w = bw * 0.62;
      g.moveTo(x - w / 2, y);
      g.lineTo(x - w / 2, y - h * 0.5);
      g.arc(x, y - h * 0.5, w / 2, Math.PI, TAU);
      g.lineTo(x + w / 2, y);
      g.closePath();
    }
    g.fillStyle = css(inside);
    g.fill();
    g.strokeStyle = css(c.farInk);
    g.lineWidth = Math.max(0.6, U * 0.02);
    g.globalAlpha = 0.6;
    g.stroke();
    g.globalAlpha = 1;
    // Pilasters between boxes.
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = bw * i;
      g.rect(x - U * 0.09, y - h, U * 0.18, h);
    }
    g.fillStyle = css(mix(c.farFill, [255, 255, 255], 0.15));
    g.fill();
    g.strokeStyle = css(c.farInk);
    g.lineWidth = Math.max(0.5, U * 0.015);
    g.globalAlpha = 0.45;
    g.stroke();
    g.globalAlpha = 1;
    // A gilt balustrade along the front of the tier.
    g.beginPath();
    g.rect(0, y - U * 0.02, tw, U * 0.27);
    g.fillStyle = css(mix(c.farFill, t.gold, 0.25));
    g.fill();
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(tw, y);
    g.moveTo(0, y + U * 0.25);
    g.lineTo(tw, y + U * 0.25);
    for (let x = U * 0.1; x < tw; x += U * 0.2) {
      g.moveTo(x, y + U * 0.03);
      g.lineTo(x, y + U * 0.22);
    }
    g.strokeStyle = css(gilt);
    g.lineWidth = Math.max(0.6, U * 0.022);
    g.globalAlpha = 0.8;
    g.stroke();
    g.globalAlpha = 1;
  }
};

const finaleMid: Painter = (g, tw, th, U, c, t) => {
  // Great marble columns with gilt capitals, and the front rows of seats.
  const marble = mix(c.midFill, [255, 255, 255], 0.12);
  for (let i = 0; i < 3; i++) {
    const x = (tw * (i + 0.5)) / 3;
    wrap(tw, x, U * 0.7, (xx) => {
      g.beginPath();
      g.rect(xx - U * 0.42, th - U * 7.6, U * 0.84, U * 7.6);
      inkFill(g, marble, c.midInk, Math.max(0.6, U * 0.025));
      g.beginPath();
      for (let k = -1; k <= 1; k++) {
        g.moveTo(xx + k * U * 0.2, th - U * 7.3);
        g.lineTo(xx + k * U * 0.2, th - U * 0.6);
      }
      g.strokeStyle = css(c.midInk);
      g.lineWidth = Math.max(0.5, U * 0.012);
      g.globalAlpha = 0.45;
      g.stroke();
      g.globalAlpha = 1;
      g.beginPath();
      g.rect(xx - U * 0.6, th - U * 7.85, U * 1.2, U * 0.32);
      inkFill(g, mix(c.midFill, t.gold, 0.45), c.midInk, Math.max(0.6, U * 0.02));
      g.beginPath();
      g.rect(xx - U * 0.55, th - U * 0.6, U * 1.1, U * 0.6);
      inkFill(g, marble, c.midInk, Math.max(0.6, U * 0.02));
    });
  }
  const seat = mix(c.midFill, t.rubric, t.inv ? 0.3 : 0.4);
  for (let row = 0; row < 2; row++) {
    const y = th - U * (0.16 + row * 0.42);
    g.beginPath();
    for (let x = row % 2 ? -U * 0.27 : 0; x < tw + U * 0.6; x += U * 0.55) {
      g.moveTo(x, y);
      g.lineTo(x, y - U * 0.38);
      g.quadraticCurveTo(x + U * 0.25, y - U * 0.68, x + U * 0.5, y - U * 0.38);
      g.lineTo(x + U * 0.5, y);
      g.closePath();
    }
    inkFill(g, mix(seat, c.midInk, 0.08 * row), c.midInk, Math.max(0.6, U * 0.018), 0.55);
  }
  // A parquet floor under the stalls (it also colours the skirt below the band).
  g.beginPath();
  g.rect(0, th - U * 0.16, tw, U * 0.16);
  g.fillStyle = css(mix(c.midFill, rgb(t.pal.mats.wood.color), 0.3));
  g.fill();
};

// ---------------------------------------------------------------- sky emblems

const sun: SkyPainter = (g, cx, cy, R, t, rs) => {
  const gold = t.gold;
  g.beginPath();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    const long = i % 2 === 0;
    g.moveTo(cx + Math.cos(a) * R * 1.25, cy + Math.sin(a) * R * 1.25);
    g.lineTo(cx + Math.cos(a) * R * (long ? 2.25 : 1.7), cy + Math.sin(a) * R * (long ? 2.25 : 1.7));
  }
  g.strokeStyle = css(mix(gold, t.paper, 0.35));
  g.lineWidth = 1.1 * rs;
  g.globalAlpha = 0.6;
  g.stroke();
  g.globalAlpha = 1;
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.fillStyle = css(mix(gold, t.paper, 0.35));
  g.fill();
  g.beginPath();
  g.arc(cx - R * 0.1, cy - R * 0.08, R * 0.82, 0, TAU);
  g.fillStyle = css(mix(t.goldLight, t.paper, 0.2));
  g.globalAlpha = 0.6;
  g.fill();
  g.globalAlpha = 1;
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.strokeStyle = css(mix(t.goldDark, t.paper, 0.2));
  g.lineWidth = 1.4 * rs;
  g.stroke();
  // A face, as old almanacs drew it.
  g.beginPath();
  g.arc(cx - R * 0.3, cy - R * 0.1, R * 0.09, 0, TAU);
  g.arc(cx + R * 0.3, cy - R * 0.1, R * 0.09, 0, TAU);
  g.fillStyle = css(mix(t.goldDark, t.paper, 0.3));
  g.globalAlpha = 0.6;
  g.fill();
  g.beginPath();
  g.arc(cx, cy + R * 0.1, R * 0.35, 0.2 * Math.PI, 0.8 * Math.PI);
  g.strokeStyle = css(mix(t.goldDark, t.paper, 0.3));
  g.lineWidth = 1.2 * rs;
  g.stroke();
  g.globalAlpha = 1;
};

const paleSun: SkyPainter = (g, cx, cy, R, t, rs) => {
  g.beginPath();
  g.arc(cx, cy, R * 0.9, 0, TAU);
  g.fillStyle = css(mix(t.paper, rgb('#fffdf5'), 0.7));
  g.fill();
  g.strokeStyle = css(mix(t.paper, t.inkFar, 0.5));
  g.lineWidth = 1 * rs;
  g.stroke();
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const y = cy + R * (0.2 + i * 0.25);
    g.moveTo(cx - R * (1.6 - i * 0.2), y);
    g.lineTo(cx + R * (1.8 - i * 0.3), y + R * 0.05);
  }
  g.strokeStyle = css(mix(t.paper, rgb('#ffffff'), 0.4));
  g.lineWidth = R * 0.14;
  g.globalAlpha = 0.8;
  g.stroke();
  g.globalAlpha = 1;
};

const moon: SkyPainter = (g, cx, cy, R, t, rs) => {
  const silver = mix(t.ink, rgb('#ffffff'), 0.2);
  g.beginPath();
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * TAU;
    g.moveTo(cx + Math.cos(a) * R * 1.3, cy + Math.sin(a) * R * 1.3);
    g.lineTo(cx + Math.cos(a) * R * (i % 3 === 0 ? 2.1 : 1.6), cy + Math.sin(a) * R * (i % 3 === 0 ? 2.1 : 1.6));
  }
  g.strokeStyle = css(silver);
  g.lineWidth = 0.8 * rs;
  g.globalAlpha = 0.35;
  g.stroke();
  g.globalAlpha = 1;
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.fillStyle = css(mix(silver, t.paper, 0.15));
  g.fill();
  // The dark limb of a gibbous moon.
  g.beginPath();
  g.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2);
  g.ellipse(cx, cy, R * 0.45, R, 0, Math.PI / 2, -Math.PI / 2, false);
  g.fillStyle = css(mix(t.paper, silver, 0.25));
  g.globalAlpha = 0.85;
  g.fill();
  g.globalAlpha = 1;
  g.beginPath();
  for (const [dx, dy, rr] of [[-0.3, -0.2, 0.18], [-0.1, 0.35, 0.12], [-0.5, 0.25, 0.08]]) {
    g.moveTo(cx + dx * R + rr * R, cy + dy * R);
    g.arc(cx + dx * R, cy + dy * R, rr * R, 0, TAU);
  }
  g.strokeStyle = css(mix(t.paper, silver, 0.55));
  g.lineWidth = 1 * rs;
  g.stroke();
};

const clockFace: SkyPainter = (g, cx, cy, R0, t, rs) => {
  const R = R0 * 1.9;
  const ink = mix(t.paper, t.inkFar, 0.7);
  const brass = mix(t.paper, t.gold, 0.5);
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.fillStyle = css(mix(t.paper, rgb('#fff6e0'), 0.4));
  g.fill();
  g.lineWidth = R * 0.08;
  g.strokeStyle = css(brass);
  g.stroke();
  g.lineWidth = 1.2 * rs;
  g.strokeStyle = css(ink);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, R * 0.82, 0, TAU);
  g.stroke();
  g.beginPath();
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU;
    const long = i % 5 === 0;
    g.moveTo(cx + Math.cos(a) * R * 0.82, cy + Math.sin(a) * R * 0.82);
    g.lineTo(cx + Math.cos(a) * R * (long ? 0.66 : 0.76), cy + Math.sin(a) * R * (long ? 0.66 : 0.76));
  }
  g.lineWidth = 1 * rs;
  g.stroke();
  // Roman numeral strokes.
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU - Math.PI / 2;
    const n = (i % 4) + 1;
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * R * 0.035;
      const x = cx + Math.cos(a) * R * 0.56 - Math.sin(a) * off;
      const y = cy + Math.sin(a) * R * 0.56 + Math.cos(a) * off;
      g.moveTo(x - Math.cos(a) * R * 0.05, y - Math.sin(a) * R * 0.05);
      g.lineTo(x + Math.cos(a) * R * 0.05, y + Math.sin(a) * R * 0.05);
    }
  }
  g.lineWidth = 1.3 * rs;
  g.stroke();
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + R * 0.35, cy - R * 0.25);
  g.moveTo(cx, cy);
  g.lineTo(cx - R * 0.1, cy - R * 0.62);
  g.lineWidth = 2.2 * rs;
  g.stroke();
};

const chandelier: SkyPainter = (g, cx, cy, R, t, rs) => {
  const gold = mix(t.gold, t.paper, 0.25);
  const ink = mix(t.paper, t.inkFar, 0.75);
  g.beginPath();
  g.moveTo(cx, 0);
  g.lineTo(cx, cy - R * 0.8);
  g.strokeStyle = css(ink);
  g.lineWidth = 1.2 * rs;
  g.stroke();
  for (let tier = 0; tier < 3; tier++) {
    const y = cy - R * 0.4 + tier * R * 0.55;
    const w = R * (1.6 - tier * 0.45);
    g.beginPath();
    g.ellipse(cx, y, w, w * 0.18, 0, 0, Math.PI);
    g.strokeStyle = css(gold);
    g.lineWidth = 2 * rs;
    g.stroke();
    const n = 7 - tier * 2;
    for (let i = 0; i < n; i++) {
      const x = cx - w + (2 * w * i) / (n - 1);
      const yy = y + Math.sin((i / (n - 1)) * Math.PI) * w * 0.18;
      g.beginPath();
      g.moveTo(x, yy);
      g.lineTo(x, yy - R * 0.2);
      g.strokeStyle = css(ink);
      g.lineWidth = 1 * rs;
      g.stroke();
      g.beginPath();
      g.ellipse(x, yy - R * 0.27, R * 0.04, R * 0.08, 0, 0, TAU);
      g.fillStyle = css(mix(t.goldLight, rgb('#fff4d0'), 0.4));
      g.fill();
      g.beginPath();
      g.moveTo(x, yy);
      g.lineTo(x - R * 0.03, yy + R * 0.18);
      g.lineTo(x + R * 0.03, yy + R * 0.18);
      g.closePath();
      g.fillStyle = css(mix(t.paper, rgb('#ffffff'), 0.5));
      g.globalAlpha = 0.8;
      g.fill();
      g.globalAlpha = 1;
    }
  }
  g.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    g.moveTo(cx + Math.cos(a) * R * 1.7, cy + R * 0.2 + Math.sin(a) * R * 1.1);
    g.lineTo(cx + Math.cos(a) * R * 2.3, cy + R * 0.2 + Math.sin(a) * R * 1.5);
  }
  g.strokeStyle = css(gold);
  g.lineWidth = 0.9 * rs;
  g.globalAlpha = 0.45;
  g.stroke();
  g.globalAlpha = 1;
};

const STYLE: Record<string, { far: Painter; mid: Painter; sky: SkyPainter }> = {
  dawn: { far: dawnFar, mid: dawnMid, sky: sun },
  title: { far: dawnFar, mid: dawnMid, sky: sun },
  lake: { far: lakeFar, mid: lakeMid, sky: paleSun },
  autumn: { far: autumnFar, mid: autumnMid, sky: sun },
  night: { far: nightFar, mid: nightMid, sky: moon },
  clock: { far: clockFar, mid: clockMid, sky: clockFace },
  finale: { far: finaleFar, mid: finaleMid, sky: chandelier },
};
