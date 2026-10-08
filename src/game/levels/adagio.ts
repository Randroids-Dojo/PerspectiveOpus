import type { Builder, LevelDef } from '../level';

/**
 * Movement II. A misty lake. Introduces music stands (moving platforms), riding a
 * lift that only the page can reach, and turning the world in mid-air.
 */
export const adagio: LevelDef = {
  info: {
    id: 'adagio',
    index: 1,
    movement: 'Movement II',
    title: 'Adagio',
    epigraph: 'Slowly, over still water.',
    palette: 'lake',
    tempo: 'Adagio cantabile',
    water: 3,
  },
  size: [142, 28, 8],
  build(b: Builder) {
    const D = 8;
    const land = (x0: number, x1: number, top: number, z0 = 0, z1 = D, mat: 'stone' | 'brick' | 'marble' | 'wood' = 'stone') =>
      b.box(x0, 0, z0, x1, top, z1, mat);

    // ---- A: the shore and the first music stand.
    land(0, 14, 5);
    b.spawn(3, 5, 3);
    b.sign(11, 5, 2, 'platform', 3);
    b.platform({ size: [3, 1, 3], path: [[14, 4, 0], [25, 4, 0]], speed: 2.2, pause: 1 });
    b.note(20, 7, 1);
    b.decor('tree', 2, 5, 7, 1.3).decor('reeds', 13, 5, 6).decor('reeds', 12, 5, 0).decor('rock', 7, 5, 6).decor('lantern', 10, 5, 0);
    b.decor('grass', 5, 5, 1).decor('flowers', 8, 5, 4);

    // ---- B: the boathouse. Round the back on the stage.
    land(28, 42, 5);
    b.box(33, 5, 0, 38, 10, 6, 'wood');
    b.box(32, 10, 0, 39, 11, 6, 'brick');
    b.note(35, 5, 7);
    b.sign(30, 5, 3, 'walkaround', 2.5, '3d');
    b.sign(30, 5, 3, 'switch3d', 2.5, '2d');
    b.checkpoint(40, 5, 3);
    b.decor('lantern', 32, 5, 0).decor('reeds', 29, 5, 7).decor('tree', 41, 5, 7, 1.2).decor('mushroom', 39, 5, 6);

    // ---- C: turning in mid-air. A pillar blocks the page; the landing only joins on the page.
    land(42, 52, 5, 0, 1, 'wood');
    b.box(53, 0, 3, 54, 12, 5, 'marble');
    b.box(52, 12, 2, 55, 13, 6, 'marble');
    b.note(53, 7, 0);
    land(55, 64, 5, 7, 8, 'wood');
    b.sign(47, 5, 0, 'midair', 4);
    b.decor('lantern', 43, 5, 0).decor('lantern', 51, 5, 0).decor('reeds', 60, 5, 7);

    // ---- D: the lift only the page can reach.
    land(64, 67, 5);
    b.checkpoint(65, 5, 3);
    land(67, 74, 5, 0, 1, 'wood');
    b.platform({ size: [3, 1, 1], path: [[74, 4, 7], [74, 13, 7]], speed: 1.7, pause: 1.3, mat: 'brass' });
    b.note(75, 10, 7);
    b.sign(70, 5, 0, 'lineup', 3, '2d');
    b.sign(70, 5, 0, 'switch2d', 3, '3d');
    b.box(77, 0, 0, 80, 14, D, 'stone');
    b.decor('reeds', 66, 5, 6).decor('lantern', 73, 5, 0);

    // ---- E: the terrace. A note on a stone only the page can climb to.
    land(80, 96, 14);
    b.checkpoint(81, 14, 3);
    b.box(88, 14, 0, 90, 16, 1, 'marble');
    b.box(90, 17, 7, 92, 18, 8, 'marble');
    b.note(91, 19, 7);
    b.decor('tree', 84, 14, 7, 1.3).decor('pillar', 94, 14, 7).decor('flowers', 86, 14, 1).decor('grass', 92, 14, 3).decor('statue', 82, 14, 7);

    // ---- F: two stands, one sideways and one into the distance.
    b.platform({ size: [3, 1, 3], path: [[96, 13, 0], [103, 13, 0]], speed: 2, pause: 0.9 });
    b.platform({ size: [3, 1, 2], path: [[106, 13, 0], [106, 13, 6]], speed: 1.6, pause: 1.1, mat: 'brass' });
    b.note(107, 16, 6);

    // ---- G: the far shore and the arch, with a note in a stage-only alcove.
    land(109, 114, 14, 6, 8);
    land(114, 142, 14);
    b.clear(124, 12, 0, 127, 14, 2);
    b.note(125, 12, 0);
    b.sign(121, 14, 1, 'hidden', 2.5);
    b.checkpoint(116, 14, 3);
    b.exit(136, 14, 3);
    b.decor('tree', 118, 14, 7, 1.25).decor('tree', 131, 14, 7, 1.4).decor('reeds', 115, 14, 0).decor('lantern', 133, 14, 0);
    b.decor('lantern', 139, 14, 0).decor('flowers', 129, 14, 4).decor('mushroom', 122, 14, 6).decor('grass', 140, 14, 2);
  },
};
