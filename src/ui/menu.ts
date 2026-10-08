import type { NavAction } from '../core/input';
import { h } from './dom';

export interface MenuItem {
  id: string;
  label: string | (() => string);
  /** Right-aligned value (slider, toggle). */
  value?: () => string;
  /** Small second line. */
  detail?: () => string;
  disabled?: () => boolean;
  select?: () => void;
  left?: () => void;
  right?: () => void;
  /** Extra classes. */
  cls?: string;
  /** Custom content builder instead of label/value. */
  build?: (el: HTMLElement) => void;
}

export interface MenuHooks {
  hover?: () => void;
  select?: () => void;
  blocked?: () => void;
}

/** A vertical list driven by keyboard, gamepad, mouse and touch alike. */
export class Menu {
  readonly el: HTMLElement;
  index = 0;
  private buttons: HTMLButtonElement[] = [];

  constructor(
    private items: MenuItem[],
    private hooks: MenuHooks = {},
    cls = '',
  ) {
    this.el = h('div', { class: `menu ${cls}`, role: 'menu' });
    this.render();
    this.index = Math.max(0, this.items.findIndex((it) => !it.disabled?.()));
    this.focus(this.index, false);
  }

  setItems(items: MenuItem[]): void {
    const id = this.items[this.index]?.id;
    this.items = items;
    this.render();
    const keep = items.findIndex((it) => it.id === id);
    this.focus(keep >= 0 ? keep : 0, false);
  }

  render(): void {
    this.el.textContent = '';
    this.buttons = this.items.map((it, i) => {
      const b = h('button', { class: `menu-item ${it.cls ?? ''}`, role: 'menuitem', type: 'button' });
      if (it.build) it.build(b);
      else {
        const label = typeof it.label === 'function' ? it.label() : it.label;
        b.append(h('span', { class: 'menu-label' }, label));
        if (it.value) b.append(h('span', { class: 'menu-value' }, it.value()));
        if (it.detail) b.append(h('span', { class: 'menu-detail' }, it.detail()));
      }
      if (it.disabled?.()) b.classList.add('disabled');
      b.addEventListener('pointerenter', (e) => {
        if ((e as PointerEvent).pointerType === 'mouse' && this.index !== i) this.focus(i, true);
      });
      b.addEventListener('click', (e) => {
        const rect = b.getBoundingClientRect();
        this.focus(i, false);
        // Clicking the left or right third of a value row steps it.
        if (it.left && it.right && it.value) {
          const x = (e as MouseEvent).clientX - rect.left;
          if (x < rect.width * 0.4) return this.step(-1);
          return this.step(1);
        }
        this.activate();
      });
      this.el.append(b);
      return b;
    });
  }

  /** Refreshes labels and values without rebuilding focus. */
  refresh(): void {
    const i = this.index;
    this.render();
    this.focus(i, false);
  }

  focus(i: number, sound: boolean): void {
    if (!this.buttons.length) return;
    this.index = Math.max(0, Math.min(this.buttons.length - 1, i));
    this.buttons.forEach((b, j) => b.classList.toggle('focused', j === this.index));
    if (sound) this.hooks.hover?.();
  }

  private move(dir: number): void {
    const n = this.items.length;
    for (let k = 1; k <= n; k++) {
      const j = (this.index + dir * k + n) % n;
      if (!this.items[j].disabled?.()) {
        this.focus(j, true);
        return;
      }
    }
  }

  private step(dir: number): void {
    const it = this.items[this.index];
    const fn = dir < 0 ? it.left : it.right;
    if (!fn) return;
    fn();
    this.hooks.hover?.();
    this.refresh();
  }

  activate(): void {
    const it = this.items[this.index];
    if (!it) return;
    if (it.disabled?.()) {
      this.hooks.blocked?.();
      return;
    }
    if (it.select) {
      this.hooks.select?.();
      it.select();
    } else if (it.right) this.step(1);
  }

  nav(a: NavAction): boolean {
    if (a === 'up') this.move(-1);
    else if (a === 'down') this.move(1);
    else if (a === 'left') this.step(-1);
    else if (a === 'right') this.step(1);
    else if (a === 'confirm') this.activate();
    else return false;
    return true;
  }
}
