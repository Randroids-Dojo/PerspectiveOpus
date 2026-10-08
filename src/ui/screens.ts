import type { NavAction } from '../core/input';
import { LEVELS } from '../game/levels';
import type { SaveData, Settings } from '../core/save';
import { fmtTime, h, noteGlyph, ROMAN } from './dom';
import { Menu, type MenuHooks, type MenuItem } from './menu';

export interface Screen {
  el: HTMLElement;
  /** Returns true if handled. 'back' falls through to the stack when unhandled. */
  nav(a: NavAction): boolean;
  enter?(): void;
  leave?(): void;
  /** Whether the game world is visible behind (default true). */
  cls?: string;
}

/** Tapping the dimmed area around a card closes it. */
function closeOnScrim(el: HTMLElement, close: () => void): void {
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });
}

function menuScreen(cls: string, top: Node[], menu: Menu, bottom: Node[] = []): Screen {
  const el = h('div', { class: `screen ${cls}` }, ...top, menu.el, ...bottom);
  return { el, nav: (a) => menu.nav(a) };
}

// ---------------------------------------------------------------- title

export function titleScreen(opts: {
  save: SaveData;
  hooks: MenuHooks;
  onBegin: () => void;
  onContinue: (i: number) => void;
  onProgramme: () => void;
  onSettings: () => void;
  onCredits: () => void;
}): Screen {
  const s = opts.save;
  const started = Object.values(s.movements).some((m) => m.done || m.notes.some(Boolean));
  const next = nextMovement(s);
  const items: MenuItem[] = [];
  if (started && next < LEVELS.length)
    items.push({
      id: 'continue',
      label: 'Continue',
      detail: () => `Movement ${ROMAN[next]}, ${LEVELS[next].info.title}`,
      select: () => opts.onContinue(next),
    });
  items.push({ id: 'begin', label: started ? 'Begin again' : 'Begin', select: opts.onBegin });
  items.push({ id: 'programme', label: 'Programme', select: opts.onProgramme });
  items.push({ id: 'settings', label: 'Settings', select: opts.onSettings });
  items.push({ id: 'credits', label: 'Credits', select: opts.onCredits });
  const menu = new Menu(items, opts.hooks, 'title-menu');
  const mark = h(
    'div',
    { class: 'title-mark' },
    h('div', { class: 'title-kicker' }, 'A symphony in two worlds'),
    h('h1', { class: 'title-name' }, h('span', { class: 'w1' }, 'Perspective'), h('span', { class: 'w2' }, 'Opus')),
    h('div', { class: 'title-rule' }),
  );
  const foot = h(
    'div',
    { class: 'title-foot' },
    h('span', { class: 'title-turn' }, 'Shift turns the world'),
    h('div', { class: 'rotate-hint' }, 'Best played with your phone turned sideways'),
  );
  return menuScreen('title', [mark], menu, [foot]);
}

export function nextMovement(s: SaveData): number {
  for (let i = 0; i < LEVELS.length; i++) if (!s.movements[LEVELS[i].info.id]?.done) return i;
  return LEVELS.length;
}

export function unlocked(s: SaveData, i: number): boolean {
  return i === 0 || !!s.movements[LEVELS[i - 1].info.id]?.done;
}

// ---------------------------------------------------------------- programme

export function programmeScreen(opts: { save: SaveData; hooks: MenuHooks; onPlay: (i: number) => void; onBack: () => void }): Screen {
  const s = opts.save;
  const items: MenuItem[] = LEVELS.map((def, i) => {
    const rec = s.movements[def.info.id];
    const open = unlocked(s, i);
    return {
      id: def.info.id,
      label: def.info.title,
      disabled: () => !open,
      select: () => opts.onPlay(i),
      build: (el) => {
        el.classList.add('prog-row');
        if (!open) el.classList.add('locked');
        const found = rec ? rec.notes.filter(Boolean).length : 0;
        const dots = h('span', { class: 'prog-notes' });
        for (let k = 0; k < 7; k++) {
          const g = noteGlyph();
          if (rec?.notes[k]) g.classList.add('found');
          dots.append(g);
        }
        el.append(
          h('span', { class: 'prog-num' }, ROMAN[i]),
          h(
            'span',
            { class: 'prog-main' },
            h('span', { class: 'prog-title' }, open ? def.info.title : 'Not yet performed'),
            h('span', { class: 'prog-tempo' }, open ? def.info.tempo : ' '),
          ),
          h(
            'span',
            { class: 'prog-side' },
            dots,
            h('span', { class: 'prog-time' }, rec?.bestTime ? fmtTime(rec.bestTime) : rec?.done ? '' : found ? `${found} of 7` : ''),
          ),
        );
      },
    };
  });
  items.push({ id: 'back', label: 'Back', select: opts.onBack, cls: 'menu-back' });
  const menu = new Menu(items, opts.hooks, 'prog-menu');
  const total = LEVELS.reduce((n, d) => n + (s.movements[d.info.id]?.notes.filter(Boolean).length ?? 0), 0);
  const head = h(
    'header',
    { class: 'card-head' },
    h('div', { class: 'card-kicker' }, 'Tonight'),
    h('h2', {}, 'Programme'),
    h('div', { class: 'card-sub' }, `${total} of ${LEVELS.length * 7} notes restored`),
  );
  const card = h('div', { class: 'card programme' }, head, menu.el);
  const el = h('div', { class: 'screen programme-screen' }, card);
  closeOnScrim(el, opts.onBack);
  return { el, nav: (a) => (a === 'back' ? (opts.onBack(), true) : menu.nav(a)) };
}

// ---------------------------------------------------------------- settings

const QUALITY: Settings['quality'][] = ['auto', 'low', 'medium', 'high'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function settingsScreen(opts: {
  settings: Settings;
  hooks: MenuHooks;
  onChange: () => void;
  onControls: () => void;
  onBack: () => void;
}): Screen {
  const st = opts.settings;
  const vol = (key: 'master' | 'music' | 'sfx', label: string): MenuItem => ({
    id: key,
    label,
    value: () => bar(st[key]),
    left: () => {
      st[key] = Math.max(0, Math.round((st[key] - 0.1) * 10) / 10);
      opts.onChange();
    },
    right: () => {
      st[key] = Math.min(1, Math.round((st[key] + 0.1) * 10) / 10);
      opts.onChange();
    },
  });
  const toggle = (key: 'reduceMotion' | 'showTimer', label: string): MenuItem => ({
    id: key,
    label,
    value: () => (st[key] ? 'On' : 'Off'),
    left: () => {
      st[key] = !st[key];
      opts.onChange();
    },
    right: () => {
      st[key] = !st[key];
      opts.onChange();
    },
  });
  const items: MenuItem[] = [
    vol('master', 'Volume'),
    vol('music', 'Music'),
    vol('sfx', 'Effects'),
    {
      id: 'startIn',
      label: 'Begin each movement on',
      value: () => (st.startIn === '3d' ? 'The Stage' : 'The Score'),
      left: () => {
        st.startIn = st.startIn === '3d' ? '2d' : '3d';
        opts.onChange();
      },
      right: () => {
        st.startIn = st.startIn === '3d' ? '2d' : '3d';
        opts.onChange();
      },
    },
    toggle('reduceMotion', 'Reduce motion'),
    {
      id: 'quality',
      label: 'Detail',
      value: () => cap(st.quality),
      left: () => {
        st.quality = QUALITY[(QUALITY.indexOf(st.quality) + QUALITY.length - 1) % QUALITY.length];
        opts.onChange();
      },
      right: () => {
        st.quality = QUALITY[(QUALITY.indexOf(st.quality) + 1) % QUALITY.length];
        opts.onChange();
      },
    },
    toggle('showTimer', 'Show timer'),
    { id: 'controls', label: 'Controls', select: opts.onControls },
    { id: 'back', label: 'Back', select: opts.onBack, cls: 'menu-back' },
  ];
  const menu = new Menu(items, opts.hooks, 'settings-menu');
  const card = h('div', { class: 'card settings' }, h('header', { class: 'card-head' }, h('h2', {}, 'Settings')), menu.el);
  const el = h('div', { class: 'screen settings-screen' }, card);
  closeOnScrim(el, opts.onBack);
  return { el, nav: (a) => (a === 'back' ? (opts.onBack(), true) : menu.nav(a)) };
}

function bar(v: number): string {
  const n = Math.round(v * 10);
  return '●'.repeat(n) + '○'.repeat(10 - n);
}

export function controlsScreen(opts: { hooks: MenuHooks; onBack: () => void }): Screen {
  const row = (action: string, kb: string, pad: string, touch: string) =>
    h('tr', {}, h('th', {}, action), h('td', {}, kb), h('td', {}, pad), h('td', {}, touch));
  const table = h(
    'table',
    { class: 'controls' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Keyboard'), h('th', {}, 'Controller'), h('th', {}, 'Touch'))),
    h(
      'tbody',
      {},
      row('Move', 'A D or arrows', 'Left stick or d-pad', 'Drag on the left'),
      row('Walk in depth (Stage)', 'W S or arrows', 'Stick up and down', 'Drag up and down'),
      row('Jump', 'Space, Z or K', 'A', 'Round button'),
      row('Turn the world', 'Shift, E or X', 'Y, X or a shoulder', 'Page button'),
      row('Pause', 'Esc or P', 'Start', 'Top right'),
    ),
  );
  const menu = new Menu([{ id: 'back', label: 'Back', select: opts.onBack, cls: 'menu-back' }], opts.hooks);
  const card = h('div', { class: 'card controls-card' }, h('header', { class: 'card-head' }, h('h2', {}, 'Controls')), table, menu.el);
  const el = h('div', { class: 'screen settings-screen' }, card);
  closeOnScrim(el, opts.onBack);
  return { el, nav: (a) => (a === 'back' ? (opts.onBack(), true) : menu.nav(a)) };
}

// ---------------------------------------------------------------- pause

export function pauseScreen(opts: {
  title: string;
  movement: string;
  found: number;
  hooks: MenuHooks;
  onResume: () => void;
  onCheckpoint: () => void;
  onRestart: () => void;
  onSettings: () => void;
  onProgramme: () => void;
  onTitle: () => void;
}): Screen {
  const menu = new Menu(
    [
      { id: 'resume', label: 'Resume', select: opts.onResume },
      { id: 'checkpoint', label: 'Back to the metronome', select: opts.onCheckpoint },
      { id: 'restart', label: 'Restart the movement', select: opts.onRestart },
      { id: 'settings', label: 'Settings', select: opts.onSettings },
      { id: 'programme', label: 'Programme', select: opts.onProgramme },
      { id: 'title', label: 'Leave for the title', select: opts.onTitle },
    ],
    opts.hooks,
  );
  const head = h(
    'header',
    { class: 'card-head' },
    h('div', { class: 'card-kicker' }, opts.movement),
    h('h2', {}, opts.title),
    h('div', { class: 'card-sub' }, `${opts.found} of 7 notes`),
  );
  const card = h('div', { class: 'card pause' }, head, menu.el);
  const el = h('div', { class: 'screen pause-screen' }, card);
  closeOnScrim(el, opts.onResume);
  return { el, nav: (a) => (a === 'back' || a === 'pause' ? (opts.onResume(), true) : menu.nav(a)) };
}

// ---------------------------------------------------------------- complete

export function completeScreen(opts: {
  index: number;
  notes: boolean[];
  time: number;
  deaths: number;
  switches: number;
  best: boolean;
  last: boolean;
  hooks: MenuHooks;
  onNext: () => void;
  onReplay: () => void;
  onProgramme: () => void;
}): Screen {
  const def = LEVELS[opts.index];
  const found = opts.notes.filter(Boolean).length;
  const dots = h('div', { class: 'complete-notes' });
  opts.notes.forEach((f, i) => {
    const g = noteGlyph(f ? 'found' : '');
    g.style.animationDelay = `${0.5 + i * 0.12}s`;
    dots.append(g);
  });
  const stats = h(
    'dl',
    { class: 'complete-stats' },
    h('div', {}, h('dt', {}, 'Time'), h('dd', {}, fmtTime(opts.time) + (opts.best ? '  best' : ''))),
    h('div', {}, h('dt', {}, 'Turns of the world'), h('dd', {}, String(opts.switches))),
    h('div', {}, h('dt', {}, 'Restarts'), h('dd', {}, String(opts.deaths))),
  );
  const line =
    found === 7
      ? 'Every note is home. The movement plays in full.'
      : found === 0
        ? 'The movement is heard, though its notes are still lost.'
        : `${7 - found} ${7 - found === 1 ? 'note is' : 'notes are'} still lost somewhere in this movement.`;
  const menu = new Menu(
    [
      { id: 'next', label: opts.last ? 'The last bow' : 'Next movement', select: opts.onNext },
      { id: 'replay', label: 'Play it again', select: opts.onReplay },
      { id: 'programme', label: 'Programme', select: opts.onProgramme },
    ],
    opts.hooks,
  );
  const head = h(
    'header',
    { class: 'card-head' },
    h('div', { class: 'card-kicker' }, `${def.info.movement} complete`),
    h('h2', {}, def.info.title),
  );
  const card = h('div', { class: 'card complete' }, head, dots, h('p', { class: 'complete-line' }, line), stats, menu.el);
  const el = h('div', { class: 'screen complete-screen' }, card);
  return { el, nav: (a) => menu.nav(a) };
}

// ---------------------------------------------------------------- credits

export function creditsScreen(opts: { hooks: MenuHooks; onBack: () => void; total: number }): Screen {
  const menu = new Menu([{ id: 'back', label: 'Back', select: opts.onBack, cls: 'menu-back' }], opts.hooks);
  const roll = h(
    'div',
    { class: 'credits-roll' },
    h('div', { class: 'credits-kicker' }, 'Perspective Opus'),
    h('p', {}, 'A game by Randroid’s Dojo'),
    h('h3', {}, 'Performed by'),
    h('p', {}, 'Quaver, the last little note'),
    h('h3', {}, 'The Score'),
    h('p', {}, 'Ink, gold leaf and parchment, drawn live in canvas'),
    h('h3', {}, 'The Stage'),
    h('p', {}, 'Lit and built in three.js'),
    h('h3', {}, 'The Opus'),
    h('p', {}, 'Composed and synthesised in the browser, every note of it'),
    h('h3', {}, 'Type'),
    h('p', {}, 'Cormorant Garamond and Fraunces'),
    h('p', { class: 'credits-notes' }, `${opts.total} of 42 notes restored`),
  );
  const card = h('div', { class: 'card credits' }, roll, menu.el);
  const el = h('div', { class: 'screen credits-screen' }, card);
  closeOnScrim(el, opts.onBack);
  return { el, nav: (a) => (a === 'back' ? (opts.onBack(), true) : menu.nav(a)) };
}
