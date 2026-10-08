import { NO_DEPTH } from '../game/level';
import type { Palette } from '../game/palettes';
import { PLAYER, type Game } from '../game/sim';
import { worldToPage, type ViewState } from '../game/view';
import { lerpPos, type FrameInfo, type WorldRenderer } from '../render/types';

/** Placeholder page renderer: flat rectangles. Replaced by the full renderer. */
export class Page implements WorldRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private palette!: Palette;
  private dpr = 1;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'page';
    this.ctx = this.canvas.getContext('2d')!;
  }

  load(_game: Game, palette: Palette): void {
    this.palette = palette;
  }

  render(game: Game, view: ViewState, frame: FrameInfo): void {
    const ctx = this.ctx;
    const pal = this.palette;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.save();
    if (view.wipe > 0) {
      ctx.beginPath();
      ctx.rect(0, 0, view.w, view.h);
      const r = Math.hypot(view.w, view.h) * view.wipe;
      ctx.arc(view.wipeOrigin.x, view.wipeOrigin.y, r, 0, Math.PI * 2, true);
      ctx.clip('evenodd');
    }
    ctx.fillStyle = pal.paper;
    ctx.fillRect(0, 0, view.w, view.h);
    const lv = game.level;
    const s = view.ppu;
    const x0 = Math.max(0, Math.floor(view.c2.x - view.w / s / 2) - 1);
    const x1 = Math.min(lv.w - 1, Math.ceil(view.c2.x + view.w / s / 2) + 1);
    const y0 = Math.max(0, Math.floor(view.c2.y - view.h / s / 2) - 1);
    const y1 = Math.min(lv.h - 1, Math.ceil(view.c2.y + view.h / s / 2) + 1);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const fz = lv.front[x + lv.w * y];
        if (fz === NO_DEPTH) {
          if (lv.thornCol[x + lv.w * y]) {
            const p = worldToPage(view, x, y + 1);
            ctx.fillStyle = pal.rubric;
            ctx.fillRect(p.x + 4, p.y + 4, s - 8, s - 8);
          }
          continue;
        }
        const p = worldToPage(view, x, y + 1);
        const k = fz / (lv.d - 1);
        ctx.fillStyle = mix(pal.washNear, pal.washFar, k);
        ctx.fillRect(p.x, p.y, s + 0.5, s + 0.5);
      }
    for (const b of game.bodies) {
      if (!b.solid) continue;
      const p = worldToPage(view, b.min.x, b.max.y);
      ctx.fillStyle = pal.gold;
      ctx.fillRect(p.x, p.y, (b.max.x - b.min.x) * s, (b.max.y - b.min.y) * s);
    }
    lv.notes.forEach((n, i) => {
      if (game.notesTaken[i]) return;
      const p = worldToPage(view, n.pos.x, n.pos.y);
      ctx.fillStyle = pal.gold;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s * 0.25, 0, Math.PI * 2);
      ctx.fill();
    });
    const ex = worldToPage(view, lv.exit.pos.x, lv.exit.pos.y + 1);
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 3;
    ctx.strokeRect(ex.x - s * 0.7, ex.y - s, s * 1.4, s * 2);
    if (game.player.dead <= 0) {
      const pp = lerpPos(game.player.prev, game.player.pos, frame.alpha);
      const p = worldToPage(view, pp.x - PLAYER.hw, pp.y + PLAYER.h);
      ctx.fillStyle = game.player.embedded ? pal.inkFar : pal.ink;
      ctx.fillRect(p.x, p.y, PLAYER.hw * 2 * s, PLAYER.h * s);
    }
    ctx.restore();
  }

  resize(w: number, h: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  setVisible(v: boolean): void {
    this.canvas.style.visibility = v ? 'visible' : 'hidden';
  }
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r},${g},${bl})`;
}
