import { Game, type InputFrame } from '../src/game/sim';
import type { Level } from '../src/game/level';
import type { Mode } from '../src/game/types';

const DT = 1 / 120;

/**
 * A closed-loop player for level solutions. Commands steer towards targets, so a
 * solution survives small physics tweaks. Every command throws with a readable
 * message if it cannot finish, which makes a broken level easy to locate.
 */
export class Bot {
  readonly game: Game;
  frames = 0;
  log: string[] = [];
  private held = false;

  constructor(level: Level, mode: Mode = '3d') {
    this.game = new Game(level, mode);
  }

  get p() {
    return this.game.player.pos;
  }

  private tick(input: Partial<InputFrame>): void {
    const f: InputFrame = { moveX: 0, moveZ: 0, jumpHeld: this.held, jumpPressed: false, switchPressed: false, ...input };
    this.game.step(DT, f);
    this.frames++;
    for (const e of this.game.events) {
      if (e.t === 'death') throw new Error(`died (${e.cause}) at ${fmt(e.pos)} after: ${this.log.slice(-4).join(' > ')}`);
    }
    this.game.events.length = 0;
  }

  private where(): string {
    return `${fmt(this.p)} ${this.game.mode}${this.game.player.grounded ? ' grounded' : ''}`;
  }

  wait(seconds: number): this {
    for (let i = 0; i < seconds / DT; i++) this.tick({});
    return this;
  }

  /** Switches perspective if not already in `mode` (or toggles when omitted). */
  switch(mode?: Mode): this {
    if (mode && this.game.mode === mode) return this;
    this.log.push(`switch ${mode ?? ''}`);
    this.tick({ switchPressed: true });
    return this;
  }

  /** Walks along x to `x` (and depth `z` on the stage), stopping there. */
  walk(x: number, z?: number, maxSeconds = 12): this {
    this.log.push(`walk ${x}${z !== undefined ? ',' + z : ''}`);
    for (let i = 0; i < maxSeconds / DT; i++) {
      const dx = x - this.p.x;
      const dz = z === undefined || this.game.mode === '2d' ? 0 : z - this.p.z;
      if (Math.abs(dx) < 0.08 && Math.abs(dz) < 0.08 && this.game.player.grounded) {
        this.settle();
        return this;
      }
      this.tick({ moveX: clamp(dx * 3), moveZ: clamp(dz * 3) });
    }
    throw new Error(`walk to ${x}${z !== undefined ? ',' + z : ''} stuck at ${this.where()}`);
  }

  /** Walks in depth only. */
  depth(z: number): this {
    return this.walk(this.p.x, z);
  }

  private settle(): void {
    for (let i = 0; i < 30; i++) {
      if (Math.abs(this.game.player.vel.x) < 0.05 && Math.abs(this.game.player.vel.z) < 0.05) break;
      this.tick({});
    }
  }

  /**
   * Runs from `from` towards `to` and jumps when crossing `from` (or immediately
   * when already past it with a running start), steering in the air, then walks to `to`.
   */
  leap(from: number, to: number, opts: { z?: number; tap?: boolean; runup?: number } = {}): this {
    this.log.push(`leap ${from}->${to}`);
    const dir = Math.sign(to - from) || 1;
    const runup = opts.runup ?? 1.6;
    // Back up for a run-up if we are too close.
    if ((from - this.p.x) * dir < runup) this.walk(from - dir * runup, opts.z);
    let jumped = false;
    for (let i = 0; i < 6 / DT; i++) {
      const tz = opts.z === undefined || this.game.mode === '2d' ? 0 : opts.z - this.p.z;
      if (!jumped && (this.p.x - from) * dir >= 0) {
        jumped = true;
        this.held = true;
        this.tick({ moveX: dir, moveZ: clamp(tz * 3), jumpPressed: true });
        continue;
      }
      if (jumped) {
        const age = this.game.player.sinceJump;
        if (opts.tap && age > 0.09) this.held = false;
        const dx = to - this.p.x;
        if (this.game.player.grounded && age > 0.05) {
          this.held = false;
          return this.walk(to, opts.z);
        }
        this.tick({ moveX: clamp(dx * 2.5), moveZ: clamp(tz * 3) });
      } else this.tick({ moveX: dir, moveZ: clamp(tz * 3) });
    }
    this.held = false;
    throw new Error(`leap ${from}->${to} never landed, at ${this.where()}`);
  }

  /** Jumps straight up (for notes overhead) and waits to land. */
  hop(tap = false): this {
    this.log.push('hop');
    this.held = true;
    this.tick({ jumpPressed: true });
    for (let i = 0; i < 3 / DT; i++) {
      if (tap && this.game.player.sinceJump > 0.09) this.held = false;
      if (this.game.player.grounded && this.game.player.sinceJump > 0.05) {
        this.held = false;
        return this;
      }
      this.tick({});
    }
    this.held = false;
    throw new Error(`hop never landed at ${this.where()}`);
  }

  /** Waits (without input) until `cond` holds. */
  until(cond: (g: Game) => boolean, label: string, maxSeconds = 20): this {
    this.log.push(`until ${label}`);
    for (let i = 0; i < maxSeconds / DT; i++) {
      if (cond(this.game)) return this;
      this.tick({});
    }
    throw new Error(`timed out waiting for ${label} at ${this.where()}`);
  }

  expectNotes(n: number): this {
    if (this.game.notesCount !== n)
      throw new Error(`expected ${n} notes, have ${this.game.notesCount} at ${this.where()} (missing ${this.missing()})`);
    return this;
  }

  missing(): string {
    return this.game.level.notes
      .filter((_, i) => !this.game.notesTaken[i])
      .map((n) => fmt(n.pos))
      .join('; ');
  }
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function fmt(p: { x: number; y: number; z: number }): string {
  return `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
}
