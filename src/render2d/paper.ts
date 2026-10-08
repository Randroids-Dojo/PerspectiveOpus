import { css, mix, rgb, scale, type RGB } from './color';
import { makeCanvas } from './ink';
import { hash, rng } from './rand';
import type { Tones } from './tones';

/**
 * The page itself: parchment fixed to the screen. Rendered once per size and
 * palette: mottled tone, fine grain, fibres and foxing. The vignette is a separate
 * small canvas stretched over everything at the end so the drawing sits in it too.
 */
export class Paper {
  canvas: HTMLCanvasElement | null = null;
  vignette: HTMLCanvasElement | null = null;
  private key = '';

  build(t: Tones, w: number, h: number, dpr: number): void {
    const key = `${t.pal.paper}|${t.pal.paperShade}|${w}|${h}|${dpr}`;
    if (key === this.key && this.canvas) return;
    this.key = key;
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    const cv = this.canvas && this.canvas.width === W && this.canvas.height === H ? this.canvas : makeCanvas(W, H);
    const g = cv.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    const paper = t.paper;
    const shade = t.paperShade;
    const inv = t.inv;
    g.fillStyle = css(paper);
    g.fillRect(0, 0, W, H);

    // Mottling: two octaves of smoothed noise.
    const mottle = (cols: number, rows: number, color: RGB, alpha: number, seed: number) => {
      const m = makeCanvas(cols, rows);
      const mg = m.getContext('2d')!;
      const img = mg.createImageData(cols, rows);
      for (let i = 0; i < cols * rows; i++) {
        const v = hash(i, seed);
        img.data[i * 4] = color[0];
        img.data[i * 4 + 1] = color[1];
        img.data[i * 4 + 2] = color[2];
        img.data[i * 4 + 3] = Math.round(Math.pow(v, 1.6) * 255);
      }
      mg.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.globalAlpha = alpha;
      g.drawImage(m, 0, 0, W, H);
      g.globalAlpha = 1;
    };
    mottle(18, 11, shade, inv ? 0.5 : 0.3, 1);
    mottle(64, 38, shade, inv ? 0.25 : 0.2, 2);
    mottle(40, 24, inv ? mix(paper, rgb('#3a4a80'), 0.6) : mix(paper, rgb('#fffbea'), 0.7), 0.25, 3);

    // Fine grain.
    const gs = 128;
    const grain = makeCanvas(gs, gs);
    const gg = grain.getContext('2d')!;
    const gi = gg.createImageData(gs, gs);
    const dark = inv ? scale(shade, 0.6) : scale(shade, 0.7);
    const lite = inv ? mix(paper, rgb('#8090c0'), 0.5) : rgb('#fffdf4');
    for (let i = 0; i < gs * gs; i++) {
      const v = hash(i, 9);
      const c = v > 0.5 ? dark : lite;
      gi.data[i * 4] = c[0];
      gi.data[i * 4 + 1] = c[1];
      gi.data[i * 4 + 2] = c[2];
      gi.data[i * 4 + 3] = Math.round(Math.abs(v - 0.5) * 2 * (inv ? 34 : 26));
    }
    gg.putImageData(gi, 0, 0);
    g.fillStyle = g.createPattern(grain, 'repeat')!;
    g.fillRect(0, 0, W, H);

    // Fibres: short, slightly curled hairs laid every which way.
    const r = rng(77);
    const count = Math.round((w * h) / 900);
    g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath();
      const light = pass === 1;
      for (let i = 0; i < (light ? count * 0.6 : count); i++) {
        const x = r() * W;
        const y = r() * H;
        const len = (5 + r() * 26) * dpr;
        const a = r() * Math.PI * 2;
        const bend = (r() - 0.5) * len * 0.5;
        const ex = x + Math.cos(a) * len;
        const ey = y + Math.sin(a) * len;
        g.moveTo(x, y);
        g.quadraticCurveTo((x + ex) / 2 - Math.sin(a) * bend, (y + ey) / 2 + Math.cos(a) * bend, ex, ey);
      }
      g.strokeStyle = light ? css(inv ? mix(paper, rgb('#9aa6d8'), 0.6) : rgb('#fffaf0')) : css(inv ? scale(shade, 0.5) : scale(shade, 0.72));
      g.globalAlpha = light ? (inv ? 0.16 : 0.32) : inv ? 0.32 : 0.14;
      g.lineWidth = Math.max(0.5, 0.65 * dpr);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Foxing: rusty spots, gathered towards the edges.
    const fox = inv ? mix(paper, rgb('#7d88b8'), 0.5) : mix(shade, rgb('#9a6a3a'), 0.55);
    const spots = Math.round(10 + (w * h) / 60000);
    for (let i = 0; i < spots; i++) {
      let x = r();
      let y = r();
      if (r() < 0.7) {
        // Push towards an edge.
        if (r() < 0.5) x = x < 0.5 ? x * 0.25 : 1 - (1 - x) * 0.25;
        else y = y < 0.5 ? y * 0.25 : 1 - (1 - y) * 0.25;
      }
      const cx = x * W;
      const cy = y * H;
      const big = (2 + r() * 12) * dpr;
      const blobs = 2 + Math.floor(r() * 5);
      for (let b = 0; b < blobs; b++) {
        const bx = cx + (r() - 0.5) * big * 1.6;
        const by = cy + (r() - 0.5) * big * 1.6;
        const br = big * (0.3 + r() * 0.7);
        g.beginPath();
        for (let k = 0; k <= 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const rr = br * (0.75 + 0.35 * hash(i, b, k));
          if (k === 0) g.moveTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr);
          else g.lineTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr);
        }
        g.closePath();
        g.fillStyle = css(fox);
        g.globalAlpha = (inv ? 0.05 : 0.06) + r() * 0.07;
        g.fill();
      }
      if (r() < 0.6) {
        g.beginPath();
        g.arc(cx, cy, (0.5 + r() * 1.2) * dpr, 0, Math.PI * 2);
        g.fillStyle = css(inv ? mix(paper, rgb('#c0c8f0'), 0.6) : scale(fox, 0.8));
        g.globalAlpha = 0.25 + r() * 0.25;
        g.fill();
      }
    }
    g.globalAlpha = 1;
    this.canvas = cv;

    // The vignette: darker, warmer edges with an uneven fall-off.
    const vw = 120;
    const vh = Math.max(40, Math.round((120 * h) / w));
    const v = makeCanvas(vw, vh);
    const vg = v.getContext('2d')!;
    const vi = vg.createImageData(vw, vh);
    const edge = inv ? scale(shade, 0.35) : mix(scale(shade, 0.62), rgb('#6a4020'), 0.25);
    for (let y = 0; y < vh; y++)
      for (let x = 0; x < vw; x++) {
        const nx = (x / (vw - 1)) * 2 - 1;
        const ny = (y / (vh - 1)) * 2 - 1;
        const d = Math.pow(Math.pow(Math.abs(nx), 2.6) + Math.pow(Math.abs(ny), 2.6), 1 / 2.6);
        const n = smoothNoise(x / 7, y / 7, 5) * 0.14 + smoothNoise(x / 2.5, y / 2.5, 6) * 0.04;
        // Fade to nothing towards the clear middle (the vignette is drawn as edge strips
        // covering the outer 20% each side, so it must be zero where the strips stop).
        const e = Math.max(0, (Math.abs(nx) - 0.6) / 0.4, (Math.abs(ny) - 0.6) / 0.4);
        const fall = e <= 0 ? 0 : e >= 0.5 ? 1 : (e / 0.5) * (e / 0.5) * (3 - (2 * e) / 0.5);
        const a = Math.max(0, Math.min(1, (d - 0.62 + n) / 0.5)) * fall;
        const i = (y * vw + x) * 4;
        vi.data[i] = edge[0];
        vi.data[i + 1] = edge[1];
        vi.data[i + 2] = edge[2];
        vi.data[i + 3] = Math.round(Math.pow(a, 1.6) * (inv ? 210 : 165));
      }
    vg.putImageData(vi, 0, 0);
    this.vignette = v;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.canvas) ctx.drawImage(this.canvas, 0, 0);
  }

  /** The vignette is drawn as four edge strips: its middle is clear, so skip those pixels. */
  drawVignette(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const v = this.vignette;
    if (!v) return;
    ctx.imageSmoothingEnabled = true;
    const vw = v.width;
    const vh = v.height;
    const ex = Math.floor(vw * 0.2);
    const ey = Math.floor(vh * 0.2);
    const sx = W / vw;
    const sy = H / vh;
    ctx.drawImage(v, 0, 0, vw, ey, 0, 0, W, ey * sy);
    ctx.drawImage(v, 0, vh - ey, vw, ey, 0, H - ey * sy, W, ey * sy);
    ctx.drawImage(v, 0, ey, ex, vh - 2 * ey, 0, ey * sy, ex * sx, H - 2 * ey * sy);
    ctx.drawImage(v, vw - ex, ey, ex, vh - 2 * ey, W - ex * sx, ey * sy, ex * sx, H - 2 * ey * sy);
  }
}

/** Bilinear value noise in [0, 1). */
function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}
