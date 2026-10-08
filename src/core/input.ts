import type { InputFrame } from '../game/sim';

export type Device = 'keyboard' | 'gamepad' | 'touch';
export type NavAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause';

const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyK', 'KeyZ', 'KeyC'],
  switch: ['ShiftLeft', 'ShiftRight', 'KeyE', 'KeyX', 'KeyL', 'KeyQ'],
  pause: ['Escape', 'KeyP'],
} as const;

const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };

/**
 * Collects keyboard, gamepad and touch into one action model. Presses are latched
 * until the simulation reads them, so a tap shorter than a frame still counts.
 */
export class Input {
  device: Device = 'keyboard';
  private down = new Set<string>();
  private jumpLatch = false;
  private switchLatch = false;
  private pauseLatch = false;
  private navListeners: ((a: NavAction) => void)[] = [];
  private deviceListeners: ((d: Device) => void)[] = [];
  private padPrev: boolean[] = [];
  private padAxesPrev = { x: 0, y: 0 };
  /** Touch controls write here. */
  touch = { x: 0, y: 0, jump: false, active: false };
  enabled = true;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => this.onKey(e, true));
    target.addEventListener('keyup', (e) => this.onKey(e, false));
    target.addEventListener('blur', () => this.down.clear());
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.setDevice('touch');
    });
  }

  onNav(fn: (a: NavAction) => void): () => void {
    this.navListeners.push(fn);
    return () => {
      this.navListeners = this.navListeners.filter((f) => f !== fn);
    };
  }

  onDevice(fn: (d: Device) => void): void {
    this.deviceListeners.push(fn);
  }

  private setDevice(d: Device): void {
    if (this.device === d) return;
    this.device = d;
    document.documentElement.dataset.device = d;
    for (const fn of this.deviceListeners) fn(d);
  }

  private emitNav(a: NavAction): void {
    for (const fn of [...this.navListeners]) fn(a);
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    const code = e.code;
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (typing) return;
    if (isDown) this.setDevice('keyboard');
    const known = Object.values(KEYS).some((list) => (list as readonly string[]).includes(code)) || code === 'Enter' || code === 'Backspace';
    if (known) e.preventDefault();
    if (isDown && !e.repeat) {
      if ((KEYS.jump as readonly string[]).includes(code)) this.jumpLatch = true;
      if ((KEYS.switch as readonly string[]).includes(code)) this.switchLatch = true;
      if ((KEYS.pause as readonly string[]).includes(code)) this.pauseLatch = true;
      if ((KEYS.up as readonly string[]).includes(code)) this.emitNav('up');
      if ((KEYS.down as readonly string[]).includes(code)) this.emitNav('down');
      if ((KEYS.left as readonly string[]).includes(code)) this.emitNav('left');
      if ((KEYS.right as readonly string[]).includes(code)) this.emitNav('right');
      if (code === 'Enter' || code === 'Space') this.emitNav('confirm');
      if (code === 'Escape' || code === 'Backspace') this.emitNav('back');
      if (code === 'Escape' || code === 'KeyP') this.emitNav('pause');
    }
    if (isDown) this.down.add(code);
    else this.down.delete(code);
  }

  private any(list: readonly string[]): boolean {
    for (const k of list) if (this.down.has(k)) return true;
    return false;
  }

  /** Reads gamepads once per frame. */
  poll(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) {
      pad = p;
      break;
    }
    if (!pad) return;
    const b = (i: number) => !!pad!.buttons[i]?.pressed;
    const now: boolean[] = pad.buttons.map((btn) => btn.pressed);
    const edge = (i: number) => now[i] && !this.padPrev[i];
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    if (now.some(Boolean) || Math.abs(ax) > 0.4 || Math.abs(ay) > 0.4) this.setDevice('gamepad');
    if (edge(PAD.a)) {
      this.jumpLatch = true;
      this.emitNav('confirm');
    }
    if (edge(PAD.x) || edge(PAD.y) || edge(PAD.lb) || edge(PAD.rb) || edge(PAD.lt) || edge(PAD.rt)) this.switchLatch = true;
    if (edge(PAD.start)) {
      this.pauseLatch = true;
      this.emitNav('pause');
    }
    if (edge(PAD.b)) this.emitNav('back');
    if (edge(PAD.up) || (ay < -0.6 && this.padAxesPrev.y >= -0.6)) this.emitNav('up');
    if (edge(PAD.down) || (ay > 0.6 && this.padAxesPrev.y <= 0.6)) this.emitNav('down');
    if (edge(PAD.left) || (ax < -0.6 && this.padAxesPrev.x >= -0.6)) this.emitNav('left');
    if (edge(PAD.right) || (ax > 0.6 && this.padAxesPrev.x <= 0.6)) this.emitNav('right');
    this.padPrev = now;
    this.padAxesPrev = { x: ax, y: ay };
    this.pad = {
      x: deadzone(ax) + (b(PAD.right) ? 1 : 0) - (b(PAD.left) ? 1 : 0),
      y: deadzone(ay) + (b(PAD.down) ? 1 : 0) - (b(PAD.up) ? 1 : 0),
      jump: b(PAD.a),
    };
  }

  private pad = { x: 0, y: 0, jump: false };

  pressJump(): void {
    this.jumpLatch = true;
  }

  pressSwitch(): void {
    this.switchLatch = true;
  }

  consumePause(): boolean {
    const p = this.pauseLatch;
    this.pauseLatch = false;
    return p;
  }

  /** Drops any latched presses (used when a menu closes so its confirm does not jump). */
  flush(): void {
    this.jumpLatch = false;
    this.switchLatch = false;
    this.pauseLatch = false;
  }

  /** Builds one simulation frame. Presses are handed out once. */
  frame(): InputFrame {
    if (!this.enabled) return { moveX: 0, moveZ: 0, jumpHeld: false, jumpPressed: false, switchPressed: false };
    let x = (this.any(KEYS.right) ? 1 : 0) - (this.any(KEYS.left) ? 1 : 0);
    let z = (this.any(KEYS.up) ? 1 : 0) - (this.any(KEYS.down) ? 1 : 0);
    x += this.pad.x + this.touch.x;
    z += -this.pad.y + this.touch.y;
    const f: InputFrame = {
      moveX: Math.max(-1, Math.min(1, x)),
      moveZ: Math.max(-1, Math.min(1, z)),
      jumpHeld: this.any(KEYS.jump) || this.pad.jump || this.touch.jump,
      jumpPressed: this.jumpLatch,
      switchPressed: this.switchLatch,
    };
    this.jumpLatch = false;
    this.switchLatch = false;
    return f;
  }
}

function deadzone(v: number): number {
  const a = Math.abs(v);
  if (a < 0.18) return 0;
  return Math.sign(v) * Math.min(1, (a - 0.18) / 0.72);
}
