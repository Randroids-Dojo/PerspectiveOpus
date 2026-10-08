import { makeCanvas } from './ink';

/**
 * Cached static ink. The world is laid out as a bitmap on a fixed device-pixel
 * grid (X = x * k, Y = -y * k) cut into square chunks, so chunks always meet on
 * whole pixels and never seam. Each chunk keeps up to `variants` boil drawings;
 * the first is made the moment a chunk is needed, the rest in idle time.
 */

export type ChunkPainter = (ctx: CanvasRenderingContext2D, i: number, j: number, variant: number) => void;
export type ChunkProbe = (i: number, j: number) => boolean;

interface Chunk {
  i: number;
  j: number;
  /** null until probed; true if there is nothing to draw. */
  empty: boolean | null;
  cv: (HTMLCanvasElement | null)[];
  used: number;
}

export class ChunkCache {
  readonly S: number;
  variants = 3;
  private map = new Map<number, Chunk>();
  private pool: HTMLCanvasElement[] = [];
  private frameNo = 0;
  private live = 0;
  /** Maximum canvases kept alive. */
  budget = 64;
  /** Visible range from the last `prepare`. */
  i0 = 0;
  i1 = -1;
  j0 = 0;
  j1 = -1;
  /** True when every visible chunk has all of its boil drawings. */
  boilReady = false;
  /** Milliseconds spent painting this frame (for diagnostics). */
  paintMs = 0;
  /** Optional (ahead-of-time or boil) paints allowed per frame. */
  maxOptional = 1;

  constructor(
    private paint: ChunkPainter,
    private probe: ChunkProbe,
    size = 512,
  ) {
    this.S = size;
  }

  clear(): void {
    for (const c of this.map.values()) for (const cv of c.cv) if (cv) this.release(cv);
    this.map.clear();
    this.live = 0;
    this.boilReady = false;
  }

  /** Drops pooled canvases too (on resize, when the chunk pixel size changes nothing, but memory should be returned). */
  purge(): void {
    this.clear();
    this.pool.length = 0;
  }

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  private get(i: number, j: number): Chunk {
    const key = this.key(i, j);
    let c = this.map.get(key);
    if (!c) {
      c = { i, j, empty: null, cv: [null, null, null], used: 0 };
      this.map.set(key, c);
    }
    if (c.empty === null) c.empty = !this.probe(i, j);
    return c;
  }

  private acquire(): HTMLCanvasElement {
    const cv = this.pool.pop() ?? makeCanvas(this.S, this.S);
    this.live++;
    return cv;
  }

  private release(cv: HTMLCanvasElement): void {
    this.live--;
    if (this.pool.length < 8) this.pool.push(cv);
    else {
      cv.width = 1;
      cv.height = 1;
    }
  }

  private render(c: Chunk, v: number): void {
    const t0 = performance.now();
    const cv = this.acquire();
    const g = cv.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, this.S, this.S);
    this.paint(g, c.i, c.j, v);
    c.cv[v] = cv;
    this.paintMs += performance.now() - t0;
  }

  /**
   * Makes sure the visible chunks exist and spends spare time on boil drawings
   * and a ring of chunks around the view. `idleMs` caps the optional work.
   */
  prepare(i0: number, i1: number, j0: number, j1: number, idleMs: number, wantVariants: number): void {
    this.frameNo++;
    this.paintMs = 0;
    this.i0 = i0;
    this.i1 = i1;
    this.j0 = j0;
    this.j1 = j1;
    const vis: Chunk[] = [];
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = this.get(i, j);
        c.used = this.frameNo;
        if (c.empty) continue;
        vis.push(c);
        if (!c.cv[0]) this.render(c, 0);
      }
    const start = performance.now();
    // Optional work is spread out: at most `maxOptional` paints a frame, and only while
    // the frame still has idle time, so a slow device never stalls on a burst of chunks.
    let optional = this.paintMs > 0 ? 0 : this.maxOptional;
    const left = () => (optional > 0 ? idleMs - (performance.now() - start) : -1);
    // Boil drawings for what is on screen.
    let ready = true;
    for (const c of vis)
      for (let v = 1; v < wantVariants; v++) {
        if (c.cv[v]) continue;
        if (left() > 0) {
          this.render(c, v);
          optional--;
        } else ready = false;
      }
    this.boilReady = ready && wantVariants > 1;
    // A ring of neighbours so scrolling rarely has to paint on demand.
    if (left() > 0) {
      for (let j = j0 - 1; j <= j1 + 1 && left() > 0; j++)
        for (let i = i0 - 1; i <= i1 + 1 && left() > 0; i++) {
          if (i >= i0 && i <= i1 && j >= j0 && j <= j1) continue;
          const c = this.get(i, j);
          c.used = Math.max(c.used, this.frameNo - 1);
          if (c.empty) continue;
          // Only the first drawing ahead of time; boil drawings come once it is on screen.
          if (!c.cv[0]) {
            this.render(c, 0);
            optional--;
          }
        }
    }
    this.evict();
  }

  private evict(): void {
    if (this.live <= this.budget) return;
    const list = [...this.map.values()].filter((c) => c.cv.some(Boolean)).sort((a, b) => a.used - b.used);
    // First drop boil drawings of chunks that are off screen, then whole chunks, oldest first.
    for (const c of list) {
      if (this.live <= this.budget) break;
      if (c.used >= this.frameNo) continue;
      for (let v = c.cv.length - 1; v >= 1; v--) {
        const cv = c.cv[v];
        if (cv) {
          this.release(cv);
          c.cv[v] = null;
        }
      }
    }
    for (const c of list) {
      if (this.live <= this.budget) break;
      if (c.used >= this.frameNo - 1) continue;
      for (let v = 0; v < c.cv.length; v++) {
        const cv = c.cv[v];
        if (cv) {
          this.release(cv);
          c.cv[v] = null;
        }
      }
    }
  }

  /** The canvas to show for a chunk this frame, or null if empty. */
  canvasFor(i: number, j: number, variant: number): HTMLCanvasElement | null {
    const c = this.map.get(this.key(i, j));
    if (!c || c.empty) return null;
    return (this.boilReady ? c.cv[variant] : null) ?? c.cv[0];
  }

  /** Draws the visible chunks at the world-bitmap offset (ox, oy) in device pixels. */
  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, variant: number): void {
    const S = this.S;
    for (let j = this.j0; j <= this.j1; j++)
      for (let i = this.i0; i <= this.i1; i++) {
        const cv = this.canvasFor(i, j, variant);
        if (cv) ctx.drawImage(cv, ox + i * S, oy + j * S);
      }
  }

  /** Redraws the cached page inside a device-pixel rectangle (the caller sets any clip). */
  drawRect(ctx: CanvasRenderingContext2D, ox: number, oy: number, variant: number, x0: number, y0: number, x1: number, y1: number): void {
    const S = this.S;
    const ia = Math.floor((x0 - ox) / S);
    const ib = Math.floor((x1 - ox) / S);
    const ja = Math.floor((y0 - oy) / S);
    const jb = Math.floor((y1 - oy) / S);
    for (let j = ja; j <= jb; j++)
      for (let i = ia; i <= ib; i++) {
        const cv = this.canvasFor(i, j, variant);
        if (!cv) continue;
        const cx = ox + i * S;
        const cy = oy + j * S;
        const sx = Math.max(0, Math.floor(x0 - cx));
        const sy = Math.max(0, Math.floor(y0 - cy));
        const ex = Math.min(S, Math.ceil(x1 - cx));
        const ey = Math.min(S, Math.ceil(y1 - cy));
        if (ex <= sx || ey <= sy) continue;
        ctx.drawImage(cv, sx, sy, ex - sx, ey - sy, cx + sx, cy + sy, ex - sx, ey - sy);
      }
  }

  stats(): { chunks: number; canvases: number } {
    return { chunks: this.map.size, canvases: this.live };
  }
}
