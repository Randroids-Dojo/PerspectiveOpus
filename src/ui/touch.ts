import type { Input } from '../core/input';
import { h } from './dom';

/** On-screen controls: a floating stick on the left, jump and switch on the right. */
export class TouchControls {
  readonly el: HTMLElement;
  private stick = h('div', { class: 'stick' }, h('div', { class: 'stick-knob' }));
  private knob: HTMLElement;
  private stickId: number | null = null;
  private origin = { x: 0, y: 0 };
  private jumpBtn: HTMLElement;
  private switchBtn: HTMLElement;

  constructor(private input: Input) {
    this.knob = this.stick.firstElementChild as HTMLElement;
    this.jumpBtn = h('div', { class: 'tbtn tjump', 'aria-label': 'Jump' }, h('span', { class: 'tjump-glyph' }));
    this.switchBtn = h('div', { class: 'tbtn tswitch', 'aria-label': 'Switch world' }, h('i', { class: 'icon-page' }), h('i', { class: 'icon-stage' }));
    const zone = h('div', { class: 'stick-zone' });
    this.el = h('div', { class: 'touch hidden' }, zone, this.stick, this.switchBtn, this.jumpBtn);

    zone.addEventListener('pointerdown', (e) => this.stickStart(e));
    window.addEventListener('pointermove', (e) => this.stickMove(e));
    window.addEventListener('pointerup', (e) => this.stickEnd(e));
    window.addEventListener('pointercancel', (e) => this.stickEnd(e));

    const press = (el: HTMLElement, down: () => void, up?: () => void) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add('down');
        down();
      });
      const release = () => {
        el.classList.remove('down');
        up?.();
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
    };
    press(
      this.jumpBtn,
      () => {
        this.input.touch.jump = true;
        this.input.pressJump();
        navigator.vibrate?.(8);
      },
      () => (this.input.touch.jump = false),
    );
    press(this.switchBtn, () => {
      this.input.pressSwitch();
      navigator.vibrate?.(14);
    });
  }

  show(v: boolean): void {
    this.el.classList.toggle('hidden', !v);
    if (!v) this.reset();
  }

  setMode(mode: '2d' | '3d'): void {
    this.el.dataset.mode = mode;
  }

  private reset(): void {
    this.stickId = null;
    this.input.touch.x = 0;
    this.input.touch.y = 0;
    this.input.touch.jump = false;
    this.stick.classList.remove('active');
  }

  private stickStart(e: PointerEvent): void {
    if (this.stickId !== null) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    this.origin = { x: e.clientX, y: e.clientY };
    this.stick.style.left = `${e.clientX}px`;
    this.stick.style.top = `${e.clientY}px`;
    this.stick.classList.add('active');
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    const R = 52;
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      // Let the stick follow a thumb that drifts too far.
      this.origin.x += (dx / d) * (d - R);
      this.origin.y += (dy / d) * (d - R);
      this.stick.style.left = `${this.origin.x}px`;
      this.stick.style.top = `${this.origin.y}px`;
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const dead = 0.18;
    const nx = dx / R;
    const ny = -dy / R;
    this.input.touch.x = Math.abs(nx) < dead ? 0 : nx;
    this.input.touch.y = Math.abs(ny) < dead + 0.12 ? 0 : ny;
  }

  private stickEnd(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.reset();
  }
}
