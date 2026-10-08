import { describe, expect, it } from 'vitest';
import { compileLevel } from '../src/game/level';
import { Game } from '../src/game/sim';
import { groundBelow } from '../src/render/ground';

const info = { id: 'landing', index: 0, movement: 'Test', title: 'Test', epigraph: '', palette: 'dawn' as const, tempo: '' };

describe('landing feedback', () => {
  it('shows the projected floor on the Score and the actual depth on the Stage', () => {
    const level = compileLevel({ info, size: [12, 8, 5], build(b) {
      b.box(0, 0, 0, 6, 1, 1);
      b.box(6, 0, 4, 12, 1, 5);
      b.spawn(1, 1, 0);
    } });
    const position = { x: 8.5, y: 3, z: 0.5 };
    expect(groundBelow(new Game(level, '3d'), position)).toBeNull();
    const page = new Game(level, '2d');
    expect(groundBelow(page, position)).toBe(1);
    page.player.embedded = true;
    expect(groundBelow(page, position)).toBeNull();
  });

  it('keeps the cue on the stand or drum above the floor', () => {
    const level = compileLevel({ info, size: [12, 10, 5], build(b) {
      b.box(0, 0, 0, 12, 1, 5);
      b.spawn(1, 1, 0);
      b.platform({ size: [2, 0.4, 1], path: [[5, 3, 3], [8, 3, 3]] });
      b.drum(9, 1, 0);
    } });
    const stage = new Game(level, '3d');
    const stand = stage.platforms[0].body;
    const position = { x: (stand.min.x + stand.max.x) / 2, y: stand.max.y + 2, z: (stand.min.z + stand.max.z) / 2 };
    expect(groundBelow(stage, position)).toBe(stand.max.y);
    expect(groundBelow(stage, { ...position, z: 0.5 })).toBe(1);
    const page = new Game(level, '2d');
    expect(groundBelow(page, { ...position, z: 0.5 })).toBe(stand.max.y);
    const drum = stage.bodies.find((body) => body.kind === 'drum')!;
    expect(groundBelow(stage, { x: 9.5, y: 4, z: 0.5 })).toBe(drum.max.y);
  });
});
