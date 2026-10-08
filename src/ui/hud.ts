import type { Device } from '../core/input';
import type { Game, GameEvent } from '../game/sim';
import { PLAYER } from '../game/sim';
import type { HintId } from '../game/types';
import { worldToScreen, type ViewState } from '../game/view';
import { fmtTime, h, noteGlyph, ROMAN } from './dom';
import { hintText } from './hints';

/** The in-game overlay: notes found, the world badge, hints and the timer. */
export class Hud {
  readonly el: HTMLElement;
  private title = h('div', { class: 'hud-title' });
  private slots = h('div', { class: 'hud-notes' });
  private count = h('span', { class: 'hud-count', 'aria-live': 'polite' });
  private badge: HTMLButtonElement;
  private badgeLabel = h('span', { class: 'badge-label' });
  private badgeKey = h('span', { class: 'badge-key' });
  private pauseBtn: HTMLButtonElement;
  private hint = h('div', { class: 'hud-hint', role: 'status' });
  private hintId: string | null = null;
  private hintDevice: Device | null = null;
  private timer = h('div', { class: 'hud-timer' });
  private flyLayer = h('div', { class: 'hud-fly' });
  private slotEls: HTMLElement[] = [];
  private flights = new Set<Animation>();
  private notice = { text: '', until: 0 };
  showTimer = false;
  /** Hints wait until this time (ms) so they never sit on top of the movement's title card. */
  quietUntil = 0;

  constructor(onSwitch: () => void, onPause: () => void) {
    this.badge = h(
      'button',
      { class: 'hud-badge', type: 'button', 'aria-label': 'Switch world', onclick: onSwitch },
      h('span', { class: 'badge-icon' }, h('i', { class: 'icon-page' }), h('i', { class: 'icon-stage' })),
      this.badgeLabel,
      this.badgeKey,
    );
    this.pauseBtn = h(
      'button',
      { class: 'hud-pause', type: 'button', 'aria-label': 'Pause', onclick: onPause },
      h('span'),
      h('span'),
    );
    this.el = h(
      'div',
      { class: 'hud hidden' },
      h('div', { class: 'hud-left' }, this.title, h('div', { class: 'hud-score' }, this.slots, this.count)),
      h('div', { class: 'hud-right' }, this.badge, this.pauseBtn),
      this.timer,
      this.hint,
      this.flyLayer,
    );
  }

  setLevel(game: Game): void {
    for (const flight of this.flights) flight.cancel();
    this.flights.clear();
    this.flyLayer.textContent = '';
    this.notice = { text: '', until: 0 };
    this.quietUntil = 0;
    const info = game.level.info;
    this.title.textContent = info.index >= 0 ? `${ROMAN[info.index]}  ${info.title}` : info.title;
    this.slots.textContent = '';
    this.slotEls = game.level.notes.map((_, i) => {
      const s = h('span', { class: 'slot' }, noteGlyph());
      s.classList.toggle('found', game.notesTaken[i]);
      this.slots.append(s);
      return s;
    });
    this.hintId = null;
    this.hint.classList.remove('show');
    this.updateCount(game);
  }

  show(v: boolean): void {
    this.el.classList.toggle('hidden', !v);
  }

  update(game: Game, view: ViewState, device: Device): void {
    const mode = game.mode;
    this.badgeLabel.textContent = mode === '3d' ? 'Stage' : 'Score';
    this.badgeKey.textContent = device === 'keyboard' ? 'Shift' : device === 'gamepad' ? 'Y' : '';
    this.badge.dataset.mode = mode;
    this.badge.setAttribute('aria-label', `The ${mode === '3d' ? 'Stage, 3D' : 'Score, 2D'}. Switch to the ${mode === '3d' ? 'Score' : 'Stage'}`);
    const sign = game.activeSign;
    const quiet = performance.now() < this.quietUntil;
    const notice = game.time < this.notice.until ? this.notice.text : '';
    const id = !quiet && !game.finished && game.player.dead <= 0 ? notice || sign?.hint || null : null;
    if (id !== this.hintId || device !== this.hintDevice) {
      this.hintId = id;
      this.hintDevice = device;
      if (id) {
        this.hint.textContent = notice || hintText(id as HintId, device);
        this.hint.classList.add('show');
      } else this.hint.classList.remove('show');
    }
    this.timer.classList.toggle('show', this.showTimer);
    if (this.showTimer) this.timer.textContent = fmtTime(game.playTime);
    this.updateCount(game);
    void view;
  }

  onEvents(events: readonly GameEvent[], game: Game, view: ViewState): void {
    for (const e of events) {
      if (e.t === 'note') {
        if (view.reduceMotion) this.slotEls[e.id]?.classList.add('found');
        else this.flyNote(e.id, game, view);
        if (e.count === e.total) this.notice = { text: 'All seven notes restored. Find the fermata arch.', until: game.time + 4.5 };
      }
      if (e.t === 'checkpoint') this.notice = { text: 'Your place is kept at this metronome.', until: game.time + 2.5 };
      if (e.t === 'respawn') this.notice = { text: 'A fresh start. Your notes are safe.', until: game.time + 2.5 };
      if (e.t === 'switch') {
        this.badge.classList.remove('pulse');
        void this.badge.offsetWidth;
        this.badge.classList.add('pulse');
      }
    }
  }

  private updateCount(game: Game): void {
    const text = `${game.notesCount} / ${game.level.notes.length}`;
    if (this.count.textContent !== text) {
      this.count.textContent = text;
      this.count.setAttribute('aria-label', `${game.notesCount} of ${game.level.notes.length} notes restored`);
    }
  }

  private flyNote(id: number, game: Game, view: ViewState): void {
    const slot = this.slotEls[id];
    if (!slot) return;
    const p = game.player.pos;
    const from = worldToScreen(view, p.x, p.y + PLAYER.h * 0.6, p.z);
    const to = slot.getBoundingClientRect();
    const g = h('span', { class: 'flying' }, noteGlyph());
    g.style.left = `${from.x}px`;
    g.style.top = `${from.y}px`;
    this.flyLayer.append(g);
    const dx = to.left + to.width / 2 - from.x;
    const dy = to.top + to.height / 2 - from.y;
    const anim = g.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%, -50%) translate(0px, -40px) scale(1.5)', opacity: 1, offset: 0.25 },
        { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(0.9)`, opacity: 1 },
      ],
      { duration: 900, easing: 'cubic-bezier(.5,0,.3,1)' },
    );
    this.flights.add(anim);
    anim.oncancel = () => {
      this.flights.delete(anim);
      g.remove();
    };
    anim.onfinish = () => {
      this.flights.delete(anim);
      g.remove();
      slot.classList.add('found', 'arrive');
      setTimeout(() => slot.classList.remove('arrive'), 700);
    };
  }
}
