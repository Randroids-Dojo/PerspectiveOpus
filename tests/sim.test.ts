import { describe, expect, it } from 'vitest';
import { compileLevel, type LevelDef } from '../src/game/level';
import { Game, PLAYER, type InputFrame } from '../src/game/sim';
import { isSolidMat } from '../src/game/types';

const info = { id: 't', index: 0, movement: 'Test', title: 'Test', epigraph: '', palette: 'dawn' as const, tempo: '' };

function run(g: Game, frames: number, input: Partial<InputFrame> = {}): void {
  for (let i = 0; i < frames; i++)
    g.step(1 / 120, { moveX: 0, moveZ: 0, jumpHeld: false, jumpPressed: false, switchPressed: false, ...input });
}

function free3d(g: Game): boolean {
  const lv = g.level;
  const p = g.player.pos;
  const e = 1e-3;
  for (let z = Math.floor(p.z - PLAYER.hd + e); z <= Math.floor(p.z + PLAYER.hd - e); z++)
    for (let y = Math.floor(p.y + e); y <= Math.floor(p.y + PLAYER.h - e); y++)
      for (let x = Math.floor(p.x - PLAYER.hw + e); x <= Math.floor(p.x + PLAYER.hw - e); x++) {
        if (x < 0 || y < 0 || z < 0 || x >= lv.w || y >= lv.h || z >= lv.d) continue;
        if (isSolidMat(lv.cells[x + lv.w * (y + lv.h * z)])) return false;
      }
  return true;
}

// Floor at the front from x 0..6, floor at the back from x 6..14. Lined up on the page, apart on the stage.
const bridge: LevelDef = {
  info,
  size: [16, 8, 5],
  build(b) {
    b.box(0, 0, 0, 6, 1, 1);
    b.box(6, 0, 4, 14, 1, 5);
    b.spawn(1, 1, 0);
    b.exit(13, 1, 4);
  },
};

describe('perspective rules', () => {
  it('lets the page connect floors that only line up', () => {
    const g = new Game(compileLevel(bridge), '2d');
    expect(g.player.grounded).toBe(true);
    run(g, 170, { moveX: 1 });
    expect(g.player.pos.x).toBeGreaterThan(9);
    expect(g.player.pos.y).toBeCloseTo(1, 2);
    // Standing on the back floor, the player's depth moved there.
    expect(g.player.pos.z).toBeGreaterThan(4);
    expect(free3d(g)).toBe(true);
    // Back on the stage they are still standing.
    run(g, 1, { switchPressed: true });
    expect(g.mode).toBe('3d');
    run(g, 60);
    expect(g.player.pos.y).toBeCloseTo(1, 2);
  });

  it('drops you through the same gap on the stage', () => {
    const g = new Game(compileLevel(bridge), '3d');
    run(g, 120 * 2, { moveX: 1 });
    expect(g.player.pos.y).toBeLessThan(0);
  });

  it('walks around a wall on the stage that blocks the page', () => {
    const lv = compileLevel({
      info,
      size: [16, 8, 5],
      build(b) {
        b.box(0, 0, 0, 16, 1, 5);
        b.box(7, 1, 0, 8, 5, 3); // wall at the front three depths only
        b.spawn(1, 1, 0);
      },
    });
    const page = new Game(lv, '2d');
    run(page, 240, { moveX: 1 });
    expect(page.player.pos.x).toBeLessThan(7);
    const stage = new Game(lv, '3d');
    run(stage, 90, { moveZ: 1 });
    run(stage, 240, { moveX: 1 });
    expect(stage.player.pos.x).toBeGreaterThan(9);
  });

  it('never traps the player when switching behind a pillar', () => {
    const lv = compileLevel({
      info,
      size: [16, 8, 5],
      build(b) {
        b.box(0, 0, 0, 16, 1, 5);
        b.box(5, 1, 0, 10, 4, 2); // a long block at the front
        b.spawn(1, 1, 4);
      },
    });
    const g = new Game(lv, '3d');
    run(g, 120, { moveX: 1 }); // walk behind the block at depth 4
    expect(g.player.pos.x).toBeGreaterThan(5.5);
    run(g, 1, { switchPressed: true });
    expect(g.mode).toBe('2d');
    expect(g.player.embedded).toBe(true);
    const z = g.player.pos.z;
    run(g, 240, { moveX: 1 });
    // Kept walking behind it at the same depth, then came out the other side.
    expect(g.player.pos.x).toBeGreaterThan(11);
    expect(g.player.embedded).toBe(false);
    expect(g.player.pos.z).toBeCloseTo(z, 5);
    expect(free3d(g)).toBe(true);
  });

  it('keeps the player free in 3D through random play', () => {
    const lv = compileLevel({
      info,
      size: [30, 14, 6],
      build(b) {
        b.box(0, 0, 0, 30, 1, 6);
        for (let i = 0; i < 40; i++) {
          const x = (i * 7) % 27;
          const z = (i * 3) % 6;
          const y = 1 + ((i * 5) % 6);
          b.box(x, y, z, x + 2 + (i % 3), y + 1, z + 1);
        }
        b.box(12, 1, 2, 13, 6, 6);
        b.spawn(1, 1, 5);
      },
    });
    const g = new Game(lv, '3d');
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 6000; i++) {
      const input: InputFrame = {
        moveX: rnd() < 0.7 ? 1 : -1,
        moveZ: rnd() * 2 - 1,
        jumpHeld: rnd() < 0.6,
        jumpPressed: rnd() < 0.05,
        switchPressed: rnd() < 0.01,
      };
      if (g.player.pos.x > 27) input.moveX = -1;
      g.step(1 / 120, input);
      if (g.player.dead > 0) continue;
      if (g.mode === '3d' || !g.player.embedded) expect(free3d(g)).toBe(true);
    }
  });

  it('bounces off drums and presses keys on the page', () => {
    const lv = compileLevel({
      info,
      size: [20, 12, 5],
      build(b) {
        b.box(0, 0, 0, 20, 1, 5);
        b.drum(6, 1, 3);
        b.key(12, 1, 2, 1);
        b.gate(15, 1, 0, 16, 4, 5, 1, false);
        b.spawn(1, 1, 0);
      },
    });
    const g = new Game(lv, '2d');
    let bounced = false;
    let keyed = false;
    for (let i = 0; i < 600; i++) {
      run(g, 1, { moveX: 1, jumpPressed: i === 30, jumpHeld: i < 60 });
      for (const e of g.events) {
        if (e.t === 'bounce') bounced = true;
        if (e.t === 'key') keyed = true;
      }
      g.events.length = 0;
    }
    expect(bounced).toBe(true);
    expect(keyed).toBe(true);
    expect(g.player.pos.x).toBeGreaterThan(16);
    expect(g.deaths).toBe(0);
  });
});
