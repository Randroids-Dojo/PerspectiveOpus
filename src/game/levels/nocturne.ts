import type { Builder, LevelDef } from '../level';

/**
 * Movement IV. Moonlit gardens and a still pond. Introduces piano keys and the
 * golden bars they raise and lower, including bridges that only join on the page
 * and a hedge maze that only the stage can walk.
 */
export const nocturne: LevelDef = {
  info: {
    id: 'nocturne',
    index: 3,
    movement: 'Movement IV',
    title: 'Nocturne',
    epigraph: 'Played softly, by moonlight.',
    palette: 'night',
    tempo: 'Lento sostenuto',
    water: 3,
  },
  size: [142, 30, 8],
  build(b: Builder) {
    const D = 8;
    const land = (x0: number, x1: number, top: number, z0 = 0, z1 = D, mat: 'stone' | 'marble' | 'brick' = 'stone') =>
      b.box(x0, 0, z0, x1, top, z1, mat);

    // ---- A: the garden gate and its key.
    land(0, 18, 5);
    b.spawn(3, 5, 3);
    b.key(8, 5, 3, 1);
    b.gate(14, 5, 0, 15, 11, D, 1, false);
    b.sign(6, 5, 3, 'keys', 3);
    b.note(16, 5, 3);
    b.decor('lantern', 2, 5, 0).decor('tree', 4, 5, 7, 1.2).decor('crystals', 11, 5, 7).decor('flowers', 10, 5, 1).decor('candles', 13, 5, 0);

    // ---- B: a key at the back raises a bridge at the front.
    b.key(16, 5, 6, 2);
    b.gate(18, 4, 0, 30, 5, 3, 2, true);
    b.note(24, 7, 1);
    land(30, 44, 5);
    b.checkpoint(32, 5, 3);
    b.decor('lantern', 31, 5, 0).decor('tree', 36, 5, 7, 1.3).decor('mushroom', 34, 5, 6).decor('crystals', 41, 5, 7, 0.9);

    // ---- C: two keys, two half bridges. Together they only join on the page.
    b.key(39, 5, 1, 3);
    b.key(42, 5, 6, 4);
    b.gate(44, 4, 0, 50, 5, 1, 3, true);
    b.gate(50, 4, 7, 56, 5, 8, 4, true);
    b.note(50, 7, 4);
    b.sign(44, 5, 0, 'lineup', 3, '2d');
    b.sign(41, 5, 3, 'switch2d', 3, '3d');

    // ---- D: the hedge maze. Only the stage can walk it; its key opens the far gate.
    land(56, 84, 5);
    const hedge = (x: number, z0: number, z1: number) => b.box(x, 5, z0, x + 1, 8, z1, 'leaf');
    hedge(60, 0, 6);
    hedge(64, 2, 8);
    hedge(68, 0, 6);
    hedge(72, 2, 8);
    b.note(66, 5, 0);
    b.key(70, 5, 7, 5);
    b.gate(78, 5, 0, 79, 12, D, 5, false);
    b.checkpoint(57, 5, 3);
    b.sign(58, 5, 6, 'walkaround', 2, '3d');
    b.sign(58, 5, 6, 'switch3d', 2, '2d');
    b.decor('lantern', 62, 5, 7).decor('lantern', 74, 5, 0).decor('statue', 75, 5, 7).decor('flowers', 67, 5, 3).decor('crystals', 82, 5, 7);

    // ---- E: a key that only the page can climb to raises golden stairs.
    b.box(84, 0, 0, 88, 7, 1, 'marble');
    b.box(88, 0, 7, 94, 9, 8, 'marble');
    b.key(91, 9, 7, 6);
    b.note(90, 5, 3);
    b.gate(94, 5, 0, 96, 11, 1, 6, true);
    b.gate(96, 5, 0, 98, 13, 1, 6, true);
    b.gate(98, 5, 0, 100, 15, 1, 6, true);
    land(84, 100, 5, 1, 7);
    b.note(99, 17, 0);
    b.sign(86, 7, 0, 'hidden', 2.5, '3d');

    // ---- F: the moon terrace and the chord of three keys.
    land(100, 116, 15);
    b.checkpoint(102, 15, 3);
    b.key(106, 15, 1, 7);
    b.key(109, 15, 1, 8);
    b.key(112, 15, 1, 9);
    b.gate(116, 14, 0, 120, 15, 1, 7, true);
    b.gate(120, 14, 7, 124, 15, 8, 8, true);
    b.gate(124, 14, 0, 128, 15, 1, 9, true);
    b.note(122, 17, 7);
    land(128, 142, 15);
    b.exit(135, 15, 3);
    b.decor('lantern', 104, 15, 7).decor('crystals', 114, 15, 7, 1.2).decor('tree', 140, 15, 7, 1.3).decor('candles', 130, 15, 0);
    b.decor('statue', 132, 15, 7).decor('flowers', 138, 15, 1);
  },
};
