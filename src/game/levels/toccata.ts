import type { Builder, LevelDef } from '../level';

/**
 * Movement V. Inside a clocktower. Keys wake machinery, a stand rides behind a
 * wall the page cannot pass, pendulum Discords swing, a paternoster climbs to the
 * belfry, and a gear-tooth gauntlet leads to the last bridge.
 */
export const toccata: LevelDef = {
  info: {
    id: 'toccata',
    index: 4,
    movement: 'Movement V',
    title: 'Toccata',
    epigraph: 'Every gear keeps the beat.',
    palette: 'clock',
    tempo: 'Presto meccanico',
  },
  size: [118, 38, 8],
  build(b: Builder) {
    const D = 8;
    const land = (x0: number, x1: number, top: number, z0 = 0, z1 = D, mat: 'stone' | 'brass' | 'wood' | 'dark' | 'brick' = 'stone') =>
      b.box(x0, 0, z0, x1, top, z1, mat);

    // ---- A: the workshop. A key wakes the lift; a note under the mezzanine.
    land(0, 24, 5);
    b.clear(10, 4, 3, 13, 5, 6);
    b.spawn(3, 5, 3);
    b.key(6, 5, 2, 1);
    b.sign(4, 5, 3, 'machine', 3);
    b.platform({ size: [3, 1, 3], path: [[10, 4, 3], [10, 14, 3]], speed: 2.2, pause: 1, group: 1, mat: 'brass' });
    b.box(13, 14, 0, 24, 15, D, 'wood');
    b.box(13, 5, 7, 14, 14, 8, 'dark');
    b.box(23, 5, 7, 24, 14, 8, 'dark');
    b.note(18, 5, 1);
    b.checkpoint(15, 15, 3);
    b.decor('gear', 2, 5, 7, 1.4).decor('candles', 8, 5, 0).decor('pipes', 20, 15, 7).decor('lantern', 16, 5, 0);

    // ---- B: a stand rides behind a wall the page cannot pass.
    land(24, 36, 5, 0, D, 'dark');
    b.thorns(24, 5, 0, 36, 6, D);
    b.box(26, 15, 0, 34, 22, 7, 'brick');
    b.platform({ size: [3, 1, 1], path: [[24, 14, 7], [33, 14, 7]], speed: 2, pause: 0.9 });
    b.note(30, 17, 7);
    b.sign(22, 15, 6, 'ride', 2.5);

    // ---- C: the pendulum hall and a drum to the brass walk only the page reaches.
    land(36, 52, 15, 0, D, 'brick');
    b.checkpoint(37, 15, 3);
    b.discord([[40, 15, 3], [48, 15, 3]], 3.2);
    b.note(44, 15, 7);
    b.drum(50, 15, 7, 7);
    b.note(50, 22, 7);
    b.box(52, 20, 0, 64, 21, 1, 'brass');
    b.decor('gear', 38, 15, 7, 1.6).decor('pipes', 46, 15, 7).decor('candles', 42, 15, 0);
    land(52, 118, 3, 0, D, 'dark');
    b.thorns(52, 3, 0, 118, 4, D);

    // ---- D: the paternoster to the belfry.
    const loop: [number, number, number][] = [
      [64, 20, 0],
      [64, 28, 0],
      [64, 28, 7],
      [64, 20, 7],
    ];
    b.platform({ size: [3, 1, 1], path: loop, speed: 2.2, pause: 0.6, loop: true, mat: 'brass' });
    b.platform({ size: [3, 1, 1], path: loop, speed: 2.2, pause: 0.6, loop: true, phase: 7.98, mat: 'brass' });
    b.note(65, 25, 0);

    // ---- E: the belfry, the gear-tooth gauntlet and the last bridge.
    b.box(67, 26, 0, 92, 29, D, 'wood');
    b.checkpoint(68, 29, 3);
    b.thorns(74, 29, 0, 86, 30, 7);
    b.discord([[76, 29, 7], [86, 29, 7]], 2.4);
    b.note(89, 29, 7);
    b.sign(72, 29, 6, 'discord', 2);
    b.box(92, 26, 0, 98, 29, 1, 'wood');
    b.box(98, 26, 7, 104, 29, 8, 'wood');
    b.note(98, 31, 3);
    b.box(104, 26, 0, 118, 29, D, 'wood');
    b.exit(110, 29, 3);
    b.decor('bell', 70, 29, 7, 1.4).decor('bell', 89, 29, 7, 1.1).decor('gear', 106, 29, 7, 1.3).decor('candles', 114, 29, 0);
    b.decor('pipes', 116, 29, 7);
  },
};
