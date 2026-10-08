import type { App } from './app';
import type { SongId } from './audio/audio';
import type { NavAction } from './core/input';
import { loadSave, record, writeSave, type SaveData } from './core/save';
import { LEVELS } from './game/levels';
import type { GameEvent } from './game/sim';
import type { Mode } from './game/types';
import { h, ROMAN } from './ui/dom';
import { Hud } from './ui/hud';
import type { MenuHooks } from './ui/menu';
import {
  completeScreen,
  controlsScreen,
  creditsScreen,
  pauseScreen,
  programmeScreen,
  settingsScreen,
  nextMovement,
  titleScreen,
  type Screen,
} from './ui/screens';
import { TouchControls } from './ui/touch';

type State = 'title' | 'play' | 'pause' | 'complete' | 'ending';

const SONGS: Record<string, SongId> = {
  overture: 'overture',
  adagio: 'adagio',
  scherzo: 'scherzo',
  nocturne: 'nocturne',
  toccata: 'toccata',
  finale: 'finale',
  title: 'title',
};

/** Runs the game around the loop: title, programme, play, pause, completion, ending. */
export class Director {
  readonly save: SaveData = loadSave();
  state: State = 'title';
  private ui: HTMLElement;
  private layer = h('div', { class: 'screens' });
  private stack: Screen[] = [];
  private hud: Hud;
  private touch: TouchControls;
  private card = h('div', { class: 'intro-card' });
  private fade = h('div', { class: 'fade' });
  private hooks: MenuHooks;
  private titleClock = 0;
  private titleTurnAt = 9;
  private completeTimer = -1;
  private busy = false;
  private endingTimer = -1;

  constructor(private app: App) {
    this.ui = document.getElementById('ui')!;
    this.hooks = {
      hover: () => app.audio.ui('hover'),
      select: () => app.audio.ui('confirm'),
      blocked: () => app.audio.ui('back'),
    };
    this.hud = new Hud(
      () => app.input.pressSwitch(),
      () => this.pause(),
    );
    this.touch = new TouchControls(app.input);
    this.ui.append(this.hud.el, this.touch.el, this.layer, this.card, this.fade);
    app.input.onNav((a) => this.nav(a));
    app.input.onDevice(() => this.refreshTouch());
    document.documentElement.dataset.device = app.input.device;
    app.onEvents((e) => this.onEvents(e));
    app.onFrame((dt) => this.frame(dt));
    this.applySettings();

    // Audio can only start from a gesture.
    const unlock = () => {
      if (app.audio.unlocked) return;
      void app.audio.unlock().then(() => this.playMusicForState());
    };
    // Phones only grant sound on the release of a tap (pointerup, touchend, click), not on the press.
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'])
      window.addEventListener(ev, unlock, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play') this.pause();
    });
  }

  // ---------------------------------------------------------------- flow

  start(): void {
    this.showTitle(true);
  }

  private showTitle(first = false): void {
    this.state = 'title';
    this.clearScreens();
    this.hud.show(false);
    this.card.classList.remove('show');
    const game = this.app.startLevel('title', '3d');
    void game;
    this.app.input.enabled = false;
    this.app.paused = false;
    this.app.audio.setPaused(false);
    this.app.view.focus = { x: 20, y: 9.2, z: 4 };
    this.app.view.orbit = { yaw: 0, pitch: 0, dist: 0 };
    this.titleClock = 0;
    this.titleTurnAt = first ? 7 : 5;
    this.push(this.makeTitle());
    this.refreshTouch();
    this.playMusicForState();
    this.fadeIn();
  }

  private makeTitle(): Screen {
    return titleScreen({
      save: this.save,
      hooks: this.hooks,
      onBegin: () => this.play(0),
      onContinue: (i) => this.play(i),
      onProgramme: () => this.push(this.makeProgramme()),
      onSettings: () => this.push(this.makeSettings()),
      onCredits: () => this.push(this.makeCredits()),
    });
  }

  private makeProgramme(): Screen {
    return programmeScreen({
      save: this.save,
      hooks: this.hooks,
      onPlay: (i) => this.play(i),
      onBack: () => this.pop(),
    });
  }

  private makeSettings(): Screen {
    return settingsScreen({
      settings: this.save.settings,
      hooks: this.hooks,
      onChange: () => {
        this.applySettings();
        writeSave(this.save);
      },
      onControls: () => this.push(controlsScreen({ hooks: this.hooks, onBack: () => this.pop() })),
      onBack: () => this.pop(),
    });
  }

  private makeCredits(): Screen {
    return creditsScreen({ hooks: this.hooks, onBack: () => this.pop(), total: this.totalNotes() });
  }

  private totalNotes(): number {
    return LEVELS.reduce((n, d) => n + (this.save.movements[d.info.id]?.notes.filter(Boolean).length ?? 0), 0);
  }

  /** Starts a movement with a fade and its title card. */
  play(index: number, mode?: Mode): void {
    if (this.busy) return;
    this.busy = true;
    this.app.audio.ui('start');
    this.fadeOut(() => {
      this.busy = false;
      this.clearScreens();
      this.state = 'play';
      this.save.last = index;
      writeSave(this.save);
      this.app.view.focus = null;
      this.app.view.orbit = { yaw: 0, pitch: 0, dist: 0 };
      const game = this.app.startLevel(index, mode ?? this.save.settings.startIn);
      record(this.save, game.level.info.id, game.level.notes.length);
      this.app.input.enabled = true;
      this.app.input.flush();
      this.app.paused = false;
      this.app.audio.setPaused(false);
      this.completeTimer = -1;
      this.hud.setLevel(game);
      this.hud.show(true);
      this.refreshTouch();
      this.app.audio.setRestored(0, game.level.notes.length);
      this.playMusicForState();
      this.showCard(index);
      this.hud.quietUntil = performance.now() + 2800;
      this.fadeIn();
    });
  }

  /** Development entry: no fade, no card. */
  playNow(level: number | string, mode: Mode, palette?: import('./game/types').PaletteId): void {
    this.clearScreens();
    this.state = 'play';
    const game = this.app.startLevel(level, mode, palette);
    this.app.input.enabled = true;
    this.app.paused = false;
    this.app.audio.setPaused(false);
    this.app.audio.setRestored(0, game.level.notes.length);
    this.hud.setLevel(game);
    this.hud.show(true);
    this.refreshTouch();
    this.playMusicForState();
  }

  private showCard(index: number): void {
    const info = LEVELS[index].info;
    this.card.textContent = '';
    this.card.append(
      h('div', { class: 'card-movement' }, info.movement),
      h('div', { class: 'card-title' }, info.title),
      h('div', { class: 'card-tempo' }, info.tempo),
      h('div', { class: 'card-epigraph' }, info.epigraph),
    );
    this.card.classList.remove('show');
    void this.card.offsetWidth;
    this.card.classList.add('show');
  }

  pause(): void {
    if (this.state !== 'play' || this.app.game?.finished) return;
    const game = this.app.game!;
    this.state = 'pause';
    this.app.paused = true;
    this.app.audio.setPaused(true);
    this.app.audio.ui('pause');
    this.hud.show(false);
    this.refreshTouch();
    const info = game.level.info;
    this.push(
      pauseScreen({
        title: info.title,
        movement: info.movement,
        found: game.notesCount,
        hooks: this.hooks,
        onResume: () => this.resume(),
        onCheckpoint: () => {
          this.resume();
          this.app.game?.returnToCheckpoint();
        },
        onRestart: () => this.play(this.app.levelIndex, this.app.game?.mode),
        onSettings: () => this.push(this.makeSettings()),
        onProgramme: () => this.push(this.makeProgramme()),
        onTitle: () => this.fadeOut(() => this.showTitle()),
      }),
    );
  }

  private resume(): void {
    if (this.state !== 'pause') return;
    this.clearScreens();
    this.state = 'play';
    this.app.paused = false;
    this.app.audio.setPaused(false);
    this.app.audio.ui('resume');
    this.app.input.flush();
    this.hud.show(true);
    this.refreshTouch();
  }

  private complete(): void {
    const game = this.app.game!;
    const index = this.app.levelIndex;
    const def = LEVELS[index];
    const rec = record(this.save, def.info.id, game.level.notes.length);
    const wasDone = rec.done;
    rec.done = true;
    game.notesTaken.forEach((t, i) => {
      if (t) rec.notes[i] = true;
    });
    const best = rec.bestTime === null || game.playTime < rec.bestTime;
    if (best) rec.bestTime = game.playTime;
    rec.fewestDeaths = rec.fewestDeaths === null ? game.deaths : Math.min(rec.fewestDeaths, game.deaths);
    writeSave(this.save);
    this.state = 'complete';
    this.app.input.enabled = false;
    this.hud.show(false);
    this.refreshTouch();
    this.app.audio.ui('complete');
    const last = index === LEVELS.length - 1;
    this.app.audio.preload?.(last ? 'ending' : SONGS[LEVELS[index + 1].info.id]);
    this.push(
      completeScreen({
        index,
        notes: game.notesTaken,
        time: game.playTime,
        deaths: game.deaths,
        switches: game.switches,
        best: best && wasDone,
        last,
        hooks: this.hooks,
        onNext: () => (last ? this.ending() : this.play(index + 1)),
        onReplay: () => this.play(index),
        onProgramme: () => this.push(this.makeProgramme()),
      }),
    );
  }

  /** The last bow: the whole Opus plays over the hall while the credits roll. */
  private ending(): void {
    this.fadeOut(() => {
      this.clearScreens();
      this.state = 'ending';
      this.save.seenEnding = true;
      writeSave(this.save);
      this.app.startLevel('title', '3d', 'finale');
      this.app.input.enabled = false;
      this.app.paused = false;
      this.app.audio.setPaused(false);
      this.app.view.focus = { x: 22.5, y: 9.4, z: 4 };
      this.app.view.orbit = { yaw: 0, pitch: 0.1, dist: 6 };
      this.hud.show(false);
      this.refreshTouch();
      this.app.audio.playSong('ending');
      this.endingTimer = 0;
      const total = this.totalNotes();
      const lines = [
        'The last note found its place.',
        'The page and the stage were never two places.',
        'They were one song, heard two ways.',
        total === 42 ? 'Every one of the forty-two notes is home. Encore.' : `${total} of 42 notes are home. The rest are still out there, humming.`,
      ];
      const roll = h('div', { class: 'ending-roll' }, ...lines.map((l, i) => h('p', { style: { animationDelay: `${2 + i * 6}s` } }, l)));
      const credits = creditsScreen({ hooks: this.hooks, onBack: () => this.fadeOut(() => this.showTitle()), total });
      credits.el.classList.add('ending-credits');
      const el = h('div', { class: 'screen ending-screen' }, roll, credits.el);
      this.push({ el, nav: (a) => (this.endingTimer > 3 ? credits.nav(a) : true) });
      this.fadeIn(2.5);
    });
  }

  // ---------------------------------------------------------------- per frame

  private frame(dt: number): void {
    const app = this.app;
    const game = app.game;
    if (!game) return;
    document.documentElement.dataset.world = app.view.blend > 0.5 ? '3d' : '2d';
    document.documentElement.dataset.darkPage = String(app.darkPage);
    this.touch.setMode(game.mode);
    if (this.state === 'play') {
      if (app.input.consumePause()) this.pause();
      this.hud.update(game, app.view, app.input.device);
      if (this.completeTimer >= 0) {
        this.completeTimer += dt;
        if (this.completeTimer > 1.7) {
          this.completeTimer = -1;
          this.complete();
        }
      }
    } else if (this.state === 'title' || this.state === 'ending') {
      app.input.consumePause();
      // The title world turns by itself, and on request.
      this.titleClock += dt;
      const asked = app.input.consumeSwitch();
      if (asked || this.titleClock > this.titleTurnAt) {
        game.toggleMode();
        this.titleClock = 0;
        this.titleTurnAt = game.mode === '3d' ? 8 : 5.5;
        if (asked) app.audio.ui('page');
      }
      const t = performance.now() / 1000;
      if (this.state === 'title') app.view.orbit = app.view.reduceMotion ? { yaw: 0, pitch: 0, dist: 2 } : { yaw: Math.sin(t * 0.11) * 0.22, pitch: Math.sin(t * 0.07) * 0.06, dist: 2 };
      else {
        this.endingTimer += dt;
        app.view.orbit = { yaw: Math.sin(t * 0.08) * 0.35, pitch: 0.12 + Math.min(this.endingTimer * 0.004, 0.2), dist: 6 + this.endingTimer * 0.12 };
        if (app.view.reduceMotion) app.view.orbit = { yaw: 0, pitch: 0.12, dist: 6 };
      }
    } else {
      app.input.consumePause();
      app.input.consumeSwitch();
    }
  }

  private onEvents(events: readonly GameEvent[]): void {
    const game = this.app.game;
    if (!game || this.state !== 'play') return;
    this.hud.onEvents(events, game, this.app.view);
    for (const e of events) {
      if (e.t === 'note') {
        this.app.audio.setRestored(e.count, e.total);
        const rec = record(this.save, game.level.info.id, game.level.notes.length);
        rec.notes[e.id] = true;
        writeSave(this.save);
      }
      if (e.t === 'exit') this.completeTimer = 0;
      if (e.t === 'death') this.app.view.shake = this.save.settings.reduceMotion ? 0 : 0.6;
      if (e.t === 'land' && e.impact > 17) this.app.view.shake = Math.max(this.app.view.shake, this.save.settings.reduceMotion ? 0 : 0.25);
    }
  }

  // ---------------------------------------------------------------- input and screens

  private nav(a: NavAction): void {
    if (this.busy) return;
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      if (a === 'pause' && this.state === 'play') {
        // Handled through consumePause in frame so a held key does not double-fire.
      }
      return;
    }
    if (a === 'pause' && this.state === 'pause' && this.stack.length > 1) {
      this.pop();
      return;
    }
    const handled = top.nav(a);
    if (!handled && a === 'back' && this.stack.length > 1) this.pop();
  }

  private push(s: Screen): void {
    const prev = this.stack[this.stack.length - 1];
    if (prev) prev.el.classList.add('under');
    this.stack.push(s);
    this.layer.append(s.el);
    requestAnimationFrame(() => s.el.classList.add('in'));
    s.enter?.();
  }

  private pop(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.app.audio.ui('back');
    s.leave?.();
    s.el.classList.remove('in');
    s.el.classList.add('out');
    setTimeout(() => s.el.remove(), 260);
    const top = this.stack[this.stack.length - 1];
    if (top) top.el.classList.remove('under');
  }

  private clearScreens(): void {
    for (const s of this.stack) {
      s.leave?.();
      s.el.remove();
    }
    this.stack = [];
  }

  private refreshTouch(): void {
    const show = this.app.input.device === 'touch' && this.state === 'play';
    this.touch.show(show);
    document.documentElement.dataset.device = this.app.input.device;
  }

  private fadeOut(then: () => void): void {
    this.fade.style.transitionDuration = '0.45s';
    this.fade.classList.add('on');
    setTimeout(then, 470);
  }

  private fadeIn(seconds = 0.6): void {
    this.fade.style.transitionDuration = `${seconds}s`;
    requestAnimationFrame(() => this.fade.classList.remove('on'));
  }

  private playMusicForState(): void {
    const audio = this.app.audio;
    if (!audio.unlocked) return;
    if (this.state === 'ending') return audio.playSong('ending');
    const id = this.app.game?.level.info.id ?? 'title';
    audio.playSong(SONGS[id] ?? 'title');
    // From the title, the next thing played is the movement Begin or Continue leads to.
    if (this.state === 'title') {
      const next = nextMovement(this.save);
      audio.preload?.(SONGS[LEVELS[Math.min(next, LEVELS.length - 1)].info.id]);
    }
  }

  /** A newer version is live: offer a refresh without interrupting play. */
  showUpdate(): void {
    if (this.ui.querySelector('.update')) return;
    const bar = h(
      'button',
      { class: 'update', type: 'button', onclick: () => location.reload() },
      h('span', {}, 'A new performance is ready.'),
      h('strong', {}, 'Refresh'),
    );
    this.ui.append(bar);
  }

  applySettings(): void {
    const s = this.save.settings;
    this.app.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    this.app.view.reduceMotion = s.reduceMotion;
    document.documentElement.dataset.reduceMotion = String(s.reduceMotion);
    this.hud.showTimer = s.showTimer;
    this.app.setQuality(s.quality);
  }
}

export { ROMAN };
