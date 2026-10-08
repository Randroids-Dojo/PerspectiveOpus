import { SilentAudio, type AudioEngine } from './audio/audio';
import { Input } from './core/input';
import { getLevel } from './game/levels';
import { PALETTES } from './game/palettes';
import { Game, type GameEvent } from './game/sim';
import type { Mode, PaletteId } from './game/types';
import { createView, resizeView, snapView, updateView, type ViewState } from './game/view';
import type { FrameInfo, Quality, WorldRenderer } from './render/types';
import { Page } from './render2d/page';
import { Stage } from './render3d/stage';

const STEP = 1 / 120;

/** Owns the loop, the simulation, both renderers and the audio. */
export class App {
  readonly input = new Input();
  readonly view: ViewState = createView();
  audio: AudioEngine = new SilentAudio();
  stage: WorldRenderer;
  page: WorldRenderer;
  game: Game | null = null;
  levelIndex = 0;
  paused = false;
  quality: Quality = 'high';
  private acc = 0;
  private last = performance.now();
  private started = performance.now();
  private pendingEvents: GameEvent[] = [];
  private eventListeners: ((e: readonly GameEvent[]) => void)[] = [];
  private frameListeners: ((dt: number) => void)[] = [];

  constructor(private root: HTMLElement) {
    this.stage = new Stage();
    this.page = new Page();
    root.append(this.stage.canvas, this.page.canvas);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  onEvents(fn: (e: readonly GameEvent[]) => void): void {
    this.eventListeners.push(fn);
  }

  onFrame(fn: (dt: number) => void): void {
    this.frameListeners.push(fn);
  }

  private qualitySetting: 'auto' | Quality = 'auto';
  private slowFrames = 0;
  private frameCount = 0;

  /** Picks a detail tier. 'auto' starts from the device and steps down if frames run slow. */
  setQuality(q: 'auto' | Quality): void {
    this.qualitySetting = q;
    if (q === 'auto') {
      const coarse = window.matchMedia?.('(pointer: coarse)').matches;
      const small = Math.min(window.innerWidth, window.innerHeight) < 600;
      this.quality = coarse || small ? 'medium' : 'high';
    } else this.quality = q;
    this.slowFrames = 0;
    this.resize();
  }

  private watchFrameRate(dt: number): void {
    if (this.qualitySetting !== 'auto' || this.paused || document.hidden) return;
    this.frameCount++;
    if (this.frameCount < 120) return;
    // Over about three seconds of slow frames, drop a tier.
    if (dt > 1 / 40) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 0.25);
    if (this.slowFrames > 90 && this.quality !== 'low') {
      this.quality = this.quality === 'high' ? 'medium' : 'low';
      this.slowFrames = 0;
      this.frameCount = 0;
      this.resize();
    }
  }

  resize(): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1);
    resizeView(this.view, w, h, dpr);
    this.stage.resize(w, h, dpr);
    this.page.resize(w, h, dpr);
  }

  startLevel(index: number | string, mode: Mode, paletteOverride?: PaletteId): Game {
    this.levelIndex = typeof index === 'number' ? index : -1;
    const level = getLevel(index);
    const game = new Game(level, mode);
    this.game = game;
    const palette = PALETTES[paletteOverride ?? level.info.palette];
    this.stage.load(game, palette);
    this.page.load(game, palette);
    snapView(this.view, game);
    this.acc = 0;
    this.pendingEvents = [];
    this.frameCount = 0;
    return game;
  }

  /** Dev helper: moves the player and snaps the cameras. */
  teleport(x: number, y: number, z: number): void {
    const g = this.game;
    if (!g) return;
    g.player.pos = { x, y, z };
    g.player.prev = { x, y, z };
    g.player.vel = { x: 0, y: 0, z: 0 };
    snapView(this.view, g);
  }

  start(): void {
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.input.poll();
    const game = this.game;
    let gameDt = 0;
    if (game && !this.paused) {
      this.acc += dt * this.view.timeScale;
      let steps = 0;
      while (this.acc >= STEP && steps < 12) {
        game.step(STEP, this.input.frame());
        this.acc -= STEP;
        gameDt += STEP;
        steps++;
      }
      if (steps === 12) this.acc = 0;
      if (game.events.length) {
        this.pendingEvents.push(...game.events);
        game.events.length = 0;
      }
    }
    const events = this.pendingEvents;
    this.pendingEvents = [];
    if (game) {
      if (!this.paused) updateView(this.view, game, dt);
      this.audio.setPerspective(this.view.blend);
      this.audio.setTimeScale(this.view.timeScale);
      if (events.length) {
        const p = game.player.pos;
        this.audio.handle(events, { mode: game.mode, x: p.x, y: p.y, z: p.z });
        for (const fn of this.eventListeners) fn(events);
      }
      const info: FrameInfo = {
        alpha: this.paused ? 1 : this.acc / STEP,
        dt,
        gameDt,
        now: (now - this.started) / 1000,
        events,
        beat: this.audio.beat(),
        quality: this.quality,
        paused: this.paused,
      };
      const showStage = this.view.wipe > 0;
      const showPage = this.view.wipe < 1;
      this.stage.setVisible(showStage);
      this.page.setVisible(showPage);
      if (showStage) this.stage.render(game, this.view, info);
      if (showPage) this.page.render(game, this.view, info);
    }
    for (const fn of this.frameListeners) fn(dt);
    this.watchFrameRate(dt);
  }
}
