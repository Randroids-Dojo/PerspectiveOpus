import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../src/core/input';

describe('input recovery', () => {
  let target: EventTarget;
  let doc: EventTarget & { hidden: boolean; documentElement: { dataset: Record<string, string> } };
  let pads: Gamepad[];
  let input: Input;

  beforeEach(() => {
    target = new EventTarget();
    doc = Object.assign(new EventTarget(), { hidden: false, documentElement: { dataset: {} } });
    pads = [];
    vi.stubGlobal('document', doc);
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLTextAreaElement', class {});
    input = new Input(target as unknown as Window);
  });

  afterEach(() => vi.unstubAllGlobals());

  const key = (target: EventTarget, code: string, pressed = true) => {
    const event = new Event(pressed ? 'keydown' : 'keyup', { cancelable: true });
    Object.assign(event, { code, repeat: false });
    target.dispatchEvent(event);
  };

  const pad = () => ({
    id: 'Test controller', index: 0, connected: true, axes: [1, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
  });

  it('releases keyboard, touch and pending actions on focus loss', () => {
    key(target, 'KeyD');
    key(target, 'Space');
    key(target, 'ShiftLeft');
    input.touch.x = 1;
    input.touch.jump = true;
    target.dispatchEvent(new Event('blur'));
    expect(input.frame()).toEqual({ moveX: 0, moveZ: 0, jumpHeld: false, jumpPressed: false, switchPressed: false });
    target.dispatchEvent(new Event('focus'));
    expect(input.frame().moveX).toBe(0);
  });

  it('stops movement and held jump when a controller disconnects', () => {
    const controller = pad();
    controller.buttons[0].pressed = true;
    pads = [controller as unknown as Gamepad];
    input.poll();
    expect(input.frame().moveX).toBe(1);
    pads = [];
    input.poll();
    expect(input.frame().moveX).toBe(0);
    expect(input.frame().jumpHeld).toBe(false);
  });

  it('does not confirm or switch when a controller connects with buttons held', () => {
    const actions: string[] = [];
    input.onNav((action) => actions.push(action));
    const controller = pad();
    controller.buttons[0].pressed = true;
    controller.buttons[3].pressed = true;
    pads = [controller as unknown as Gamepad];
    input.poll();
    expect(actions).toEqual([]);
    expect(input.frame().switchPressed).toBe(false);
    controller.buttons[0].pressed = false;
    controller.buttons[3].pressed = false;
    input.poll();
    controller.buttons[0].pressed = true;
    input.poll();
    expect(actions).toEqual(['confirm']);
    expect(input.frame().jumpPressed).toBe(true);
  });

  it('handles Escape once and P as pause navigation', () => {
    const actions: string[] = [];
    input.onNav((action) => actions.push(action));
    key(target, 'Escape');
    expect(actions).toEqual(['back']);
    expect(input.consumePause()).toBe(true);
    key(target, 'KeyP');
    expect(actions).toEqual(['back', 'pause']);
  });

  it('clears pending presses when the document hides', () => {
    key(target, 'KeyD');
    key(target, 'ShiftLeft');
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(input.frame().moveX).toBe(0);
    expect(input.consumeSwitch()).toBe(false);
  });
});
