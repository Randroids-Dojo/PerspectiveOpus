import type { Builder, LevelDef } from '../level';

/** The diorama behind the title. Quaver stands still; the world turns by itself. */
export const titleScene: LevelDef = {
  info: {
    id: 'title',
    index: -1,
    movement: 'Prelude',
    title: 'Perspective Opus',
    epigraph: '',
    palette: 'title',
    tempo: 'Andante',
  },
  size: [48, 24, 8],
  build(b: Builder) {
    b.box(2, 0, 0, 46, 5, 8, 'stone');
    b.box(17, 5, 1, 27, 6, 7, 'stone');
    b.box(19, 6, 2, 25, 7, 6, 'marble');
    b.spawn(22, 7, 4);
    // A ledge that only joins up on the page.
    b.box(8, 10, 0, 13, 11, 1, 'marble');
    b.box(13, 10, 7, 18, 11, 8, 'marble');
    b.box(28, 11, 7, 32, 12, 8, 'brick');
    b.box(32, 11, 0, 36, 12, 1, 'brick');
    // Ruined columns.
    b.box(6, 5, 6, 7, 13, 7, 'marble');
    b.box(39, 5, 6, 40, 12, 7, 'marble');
    b.box(41, 5, 5, 42, 9, 6, 'marble');
    b.box(5, 5, 2, 6, 8, 3, 'marble');
    b.note(10, 12, 0).note(15, 12, 7).note(30, 13, 7).note(34, 13, 0);
    b.exit(43, 5, 3);
    b.checkpoint(14, 5, 3);
    b.decor('tree', 4, 5, 7, 1.3).decor('tree', 31, 5, 7, 1.2).decor('tree', 45, 5, 6, 1);
    b.decor('flowers', 12, 5, 1).decor('flowers', 28, 5, 0).decor('flowers', 37, 5, 2);
    b.decor('grass', 9, 5, 3).decor('grass', 26, 5, 6).decor('grass', 33, 5, 4).decor('grass', 18, 6, 1);
    b.decor('lamp', 16, 5, 0).decor('lamp', 29, 5, 0).decor('statue', 9, 5, 7).decor('rock', 36, 5, 6);
  },
};
