import { describe, expect, it } from 'vitest';
import { createView, resizeView, worldToPage, worldToStage } from '../src/game/view';

describe('shared camera', () => {
  it('lines the stage side view up with the page', () => {
    const v = createView();
    resizeView(v, 1280, 720, 1);
    v.c2 = { x: 20, y: 8 };
    v.f3 = { x: 23, y: 9, z: 3 };
    v.swing = 0;
    for (const [x, y, z] of [
      [20, 8, 0],
      [12, 3, 7],
      [30, 14, 2],
    ]) {
      const a = worldToPage(v, x, y);
      const b = worldToStage(v, x, y, z);
      expect(Math.abs(a.x - b.x)).toBeLessThan(2);
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    }
  });

  it('keeps +x on the right and +y up on the stage', () => {
    const v = createView();
    resizeView(v, 1280, 720, 1);
    v.f3 = { x: 10, y: 5, z: 3 };
    v.c2 = { x: 10, y: 5 };
    v.swing = 1;
    const c = worldToStage(v, 10, 5, 3);
    const r = worldToStage(v, 12, 5, 3);
    const u = worldToStage(v, 10, 7, 3);
    expect(r.x).toBeGreaterThan(c.x);
    expect(u.y).toBeLessThan(c.y);
  });
});
