import type { Builder, LevelDef } from '../level';

/**
 * Movement III. An autumn village. Introduces timpani drums, thorns (which on the
 * page stand at every depth) and Discords. Ends with a bell tower only the page can climb.
 */
export const scherzo: LevelDef = {
  info: {
    id: 'scherzo',
    index: 2,
    movement: 'Movement III',
    title: 'Scherzo',
    epigraph: 'A joke told in three-four time.',
    palette: 'autumn',
    tempo: 'Allegro vivace',
  },
  size: [132, 32, 8],
  build(b: Builder) {
    const D = 8;
    const land = (x0: number, x1: number, top: number, z0 = 0, z1 = D, mat: 'stone' | 'brick' | 'wood' = 'stone') =>
      b.box(x0, 0, z0, x1, top, z1, mat);

    // ---- A: the square and the first drum up to the town wall.
    land(0, 16, 5);
    b.spawn(3, 5, 3);
    b.drum(13, 5, 3);
    b.note(13, 11, 3);
    b.sign(10, 5, 3, 'drum', 3);
    land(16, 46, 10, 0, D, 'brick');
    b.decor('tree', 2, 5, 7, 1.3).decor('tree', 8, 5, 7, 1.1).decor('lamp', 6, 5, 0).decor('flowers', 4, 5, 1).decor('rock', 15, 5, 6);
    b.decor('grass', 9, 5, 5);

    // ---- B: thorns across the back of the wall-top. On the page they bar the way.
    b.thorns(20, 10, 3, 30, 11, 8);
    b.drum(25, 10, 1);
    b.note(25, 15, 1);
    b.sign(18, 10, 2, 'thorns', 2.5);
    b.decor('lamp', 19, 10, 0).decor('tree', 17, 10, 7, 1.1);

    // ---- C: a Discord in the street; a balcony only the page can reach.
    b.checkpoint(31, 10, 3);
    b.discord([[33, 10, 2], [42, 10, 2]], 1.6);
    b.sign(31, 10, 5, 'discord', 2.5);
    b.box(34, 10, 0, 36, 12, 1, 'wood');
    b.box(36, 12, 0, 40, 13, 1, 'wood');
    b.box(40, 12, 7, 44, 13, 8, 'brick');
    b.note(42, 13, 7);
    b.decor('lantern', 37, 13, 0).decor('flowers', 43, 13, 7).decor('banner', 30, 13, 7);

    // ---- D: down to the lane. Thorns at the front, a Discord pacing in depth.
    land(46, 70, 5);
    b.checkpoint(47, 5, 3);
    b.thorns(50, 5, 0, 58, 6, 3);
    b.sign(48, 5, 6, 'switch3d', 2.5, '2d');
    b.discord([[62, 5, 0], [62, 5, 7]], 1.4);
    b.note(62, 7, 4);
    b.decor('tree', 66, 5, 7, 1.2).decor('lamp', 59, 5, 7).decor('mushroom', 68, 5, 0).decor('grass', 64, 5, 2);

    // ---- E: the bell tower. Drums at the front, landings at the back, only lined up on the page.
    land(70, 74, 5);
    b.drum(72, 5, 1);
    land(74, 82, 10, 0, D, 'brick');
    b.drum(80, 10, 1);
    b.box(82, 0, 6, 88, 15, 8, 'brick');
    b.note(85, 17, 7);
    b.drum(87, 15, 7);
    b.box(88, 0, 0, 96, 20, 3, 'brick');
    b.checkpoint(89, 20, 1);
    b.note(92, 22, 1);
    b.decor('bell', 93, 20, 1, 1.3).decor('banner', 76, 14, 0).decor('lamp', 75, 10, 0);
    land(74, 132, 5, 3, 6);
    land(82, 88, 5, 0, 3);
    land(96, 132, 5, 0, 3);
    land(88, 132, 5, 6, 8);
    b.thorns(98, 5, 0, 114, 6, 8);

    // ---- F: the rooftop bridge, a bobbing Discord, a chimney climb and the arch.
    b.box(96, 19, 0, 104, 20, 1, 'wood');
    b.box(104, 19, 7, 114, 20, 8, 'wood');
    b.discord([[109, 20, 7], [109, 24, 7]], 2.2);
    b.sign(97, 20, 0, 'lineup', 2.5, '2d');
    b.sign(97, 20, 0, 'switch2d', 2.5, '3d');
    b.box(114, 5, 0, 132, 20, D, 'brick');
    b.box(118, 20, 0, 120, 22, 1, 'stone');
    b.box(120, 20, 7, 122, 24, 8, 'stone');
    b.note(121, 25, 7);
    b.exit(127, 20, 3);
    b.decor('tree', 130, 20, 7, 1.1).decor('lamp', 124, 20, 0).decor('flowers', 116, 20, 3).decor('banner', 126, 24, 7);
  },
};
