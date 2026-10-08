import type { Builder, LevelDef } from '../level';

/**
 * Movement I. Teaches moving in depth, walking round walls on the stage, and
 * crossing things that line up on the page. Depth runs 0 (front) to 7 (back).
 * See docs/LEVEL_DESIGN.md for the jump limits these gaps are built against.
 */
export const overture: LevelDef = {
  info: {
    id: 'overture',
    index: 0,
    movement: 'Movement I',
    title: 'Overture',
    epigraph: 'Every symphony begins with a single step.',
    palette: 'dawn',
    tempo: 'Allegro moderato',
  },
  size: [140, 28, 8],
  build(b: Builder) {
    const D = 8;
    const ground = (x0: number, x1: number, top: number, z0 = 0, z1 = D, mat: 'stone' | 'brick' | 'marble' = 'stone') =>
      b.box(x0, 0, z0, x1, top, z1, mat);

    // ---- A: the meadow. Walk, jump, first note.
    ground(0, 10, 4);
    ground(10, 24, 5);
    b.spawn(3, 4, 3);
    b.sign(3, 4, 3, 'move', 3.5);
    b.sign(8, 4, 3, 'jump', 1.8);
    b.box(16, 5, 2, 18, 6, 6, 'brick');
    b.note(17, 7, 4);
    b.decor('tree', 2, 4, 7, 1.2).decor('tree', 13, 5, 7, 1).decor('flowers', 6, 4, 1).decor('flowers', 20, 5, 0);
    b.decor('grass', 4, 4, 0).decor('grass', 11, 5, 1).decor('rock', 22, 5, 6).decor('lamp', 23, 5, 0);

    // ---- B: a wall that only covers the front. Walk round it at the back.
    ground(24, 40, 5);
    b.box(28, 5, 0, 31, 14, 6, 'brick');
    b.box(27, 5, 0, 32, 6, 6, 'stone');
    b.sign(25, 5, 3, 'depth', 2.5, '3d');
    b.sign(25, 5, 3, 'switch3d', 2.5, '2d');
    b.note(29, 5, 7);
    b.decor('banner', 29, 10, 0).decor('tree', 35, 5, 7, 1.1).decor('flowers', 33, 5, 2).decor('grass', 37, 5, 4);
    b.checkpoint(38, 5, 3);

    // ---- C: the first bridge on the page. The front walk ends where the back walk starts.
    ground(40, 48, 5, 0, 1);
    ground(48, 60, 5, 7, 8);
    b.sign(45, 5, 0, 'switch2d', 2.5, '3d');
    b.sign(45, 5, 0, 'lineup', 3, '2d');
    b.note(51, 7, 7);
    b.decor('lamp', 41, 5, 0).decor('reeds', 54, 5, 7).decor('lamp', 59, 5, 7);

    // ---- D: a wall at the back this time. Back to the stage, step to the front.
    ground(60, 76, 5);
    b.box(64, 5, 2, 67, 14, 8, 'brick');
    b.box(63, 5, 2, 68, 6, 8, 'stone');
    b.sign(61, 5, 7, 'switch3d', 2.5, '2d');
    b.sign(61, 5, 3, 'walkaround', 2.5, '3d');
    b.note(65, 5, 0);
    b.decor('banner', 65, 10, 2).decor('tree', 71, 5, 7, 1.15).decor('flowers', 69, 5, 0).decor('grass', 73, 5, 2);
    b.checkpoint(74, 5, 3);

    // ---- E: a staircase on the page. On the stage each next pillar is a lane away and each same-lane pillar 4 higher.
    const pillar = (x: number, top: number, z: number) => b.box(x, 0, z, x + 3, top, z + 1, 'marble');
    pillar(76, 7, 0);
    pillar(79, 9, 7);
    pillar(82, 11, 0);
    pillar(85, 13, 7);
    b.sign(76, 7, 0, 'lineup', 2, '2d');
    b.sign(75, 5, 3, 'switch2d', 2, '3d');
    b.note(86, 15, 7);

    // ---- F: the high terrace.
    ground(88, 102, 13);
    b.checkpoint(90, 13, 3);
    b.decor('pillar', 92, 13, 7).decor('pillar', 98, 13, 7).decor('flowers', 95, 13, 1).decor('statue', 96, 13, 7);
    // A wall across the front six lanes; the way round is the back lane, which ends at a chasm.
    b.box(102, 13, 0, 104, 20, 6, 'brick');
    ground(102, 110, 13, 6, 8);
    b.sign(100, 13, 3, 'walkaround', 2, '3d');
    b.sign(100, 13, 3, 'switch3d', 2, '2d');
    // Across the chasm the walk continues at the front: they meet on the page.
    ground(110, 118, 13, 0, 1);
    b.note(111, 14, 4);
    b.sign(107, 13, 7, 'lineup', 2.5, '2d');
    b.sign(107, 13, 7, 'switch2d', 2.5, '3d');

    // ---- G: the hill and the arch.
    ground(118, 140, 13);
    b.checkpoint(120, 13, 3);
    // A tower with a note on top, climbed by a page staircase.
    b.box(124, 13, 7, 127, 15, 8, 'marble');
    b.box(127, 13, 0, 129, 17, 1, 'marble');
    b.box(129, 13, 7, 131, 19, 8, 'marble');
    b.note(130, 20, 7);
    b.exit(135, 13, 3);
    b.decor('tree', 122, 13, 6, 1.25).decor('flowers', 132, 13, 1).decor('lamp', 133, 13, 0).decor('lamp', 138, 13, 0);
    b.decor('grass', 121, 13, 0).decor('tree', 139, 13, 7, 1.1);
    b.sign(133, 13, 3, 'exit', 2.5);
  },
};
