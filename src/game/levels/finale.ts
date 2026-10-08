import type { Builder, LevelDef } from '../level';

/**
 * Movement VI. The concert hall at sunset. Everything together in one ascent:
 * the page staircase, the curtain walk-round, the timpani in the pit, the golden
 * stairs, the organ pipe and the mid-air turn, the lift, and a last bridge over the hall.
 */
export const finale: LevelDef = {
  info: {
    id: 'finale',
    index: 5,
    movement: 'Movement VI',
    title: 'Finale',
    epigraph: 'All of it, at once, and gladly.',
    palette: 'finale',
    tempo: 'Allegro maestoso',
  },
  size: [172, 46, 8],
  build(b: Builder) {
    const D = 8;
    const land = (x0: number, x1: number, top: number, z0 = 0, z1 = D, mat: 'stone' | 'marble' | 'dark' | 'wood' | 'brass' = 'marble') =>
      b.box(x0, 0, z0, x1, top, z1, mat);

    // ---- A: the foyer and the grand staircase, climbed on the page.
    land(0, 20, 5);
    b.spawn(3, 5, 3);
    b.sign(5, 5, 3, 'finale', 3);
    land(10, 13, 7, 0, 1);
    land(13, 16, 9, 7, 8);
    land(16, 19, 11, 0, 1);
    land(19, 22, 13, 7, 8);
    land(20, 22, 5, 0, 7);
    b.note(20, 15, 7);
    b.decor('curtain', 1, 5, 7, 1.4).decor('candles', 6, 5, 0).decor('statue', 8, 5, 7).decor('candles', 2, 5, 0);

    // ---- B: the balcony and the curtain, with a Discord pacing behind it.
    land(22, 42, 13, 0, D, 'stone');
    b.checkpoint(24, 13, 3);
    b.box(28, 13, 0, 30, 24, 7, 'dark');
    b.discord([[29, 13, 7], [36, 13, 7]], 1.8);
    b.note(29, 13, 7);
    b.sign(25, 13, 5, 'walkaround', 2, '3d');
    b.sign(25, 13, 5, 'switch3d', 2, '2d');
    b.decor('candles', 33, 13, 0).decor('statue', 39, 13, 7).decor('banner', 24, 17, 7);

    // ---- C: the orchestra pit. Timpani at the front and back, bounced across on the page.
    land(42, 58, 4, 0, D, 'dark');
    b.thorns(42, 4, 0, 58, 5, D);
    land(44, 45, 12, 0, 1, 'wood');
    b.drum(44, 12, 0);
    land(49, 50, 12, 7, 8, 'wood');
    b.drum(49, 12, 7);
    land(54, 55, 12, 0, 1, 'wood');
    b.drum(54, 12, 0);
    b.note(52, 18, 3);
    b.sign(41, 13, 3, 'drum', 2);

    // ---- D: the stage. A key raises golden stairs; a note waits in front of the piano.
    land(58, 90, 13, 0, D, 'wood');
    b.checkpoint(59, 13, 3);
    b.key(66, 13, 1, 1);
    b.gate(72, 13, 7, 74, 15, 8, 1, true);
    b.gate(74, 13, 7, 76, 17, 8, 1, true);
    b.gate(76, 13, 7, 78, 19, 8, 1, true);
    b.gate(78, 13, 7, 80, 21, 8, 1, true);
    b.box(74, 13, 2, 80, 16, 7, 'dark');
    b.note(76, 13, 0);
    b.sign(70, 13, 1, 'hidden', 2, '3d');
    b.decor('candles', 62, 13, 7).decor('statue', 68, 13, 7).decor('curtain', 86, 13, 7, 1.3);

    // ---- E: the upper tier and the organ pipe at its edge. Jump on the stage, land on the page.
    land(80, 100, 21, 0, D, 'stone');
    land(100, 108, 21, 0, 2, 'stone');
    b.checkpoint(82, 21, 3);
    b.box(106, 0, 3, 108, 38, 6, 'brass');
    b.box(112, 18, 7, 124, 21, 8, 'wood');
    b.note(110, 23, 3);
    b.sign(100, 21, 1, 'midair', 3);
    b.decor('pipes', 90, 21, 7, 1.5).decor('pipes', 96, 21, 7, 1.2).decor('candles', 85, 21, 0).decor('banner', 102, 26, 7);

    // ---- F: the lift to the loft.
    b.platform({ size: [3, 1, 1], path: [[124, 20, 7], [124, 30, 7]], speed: 2, pause: 1.1, mat: 'brass' });
    b.note(125, 27, 7);
    land(127, 140, 31, 0, D, 'stone');
    b.checkpoint(128, 31, 3);
    b.decor('bell', 132, 31, 7, 1.2).decor('candles', 137, 31, 0);

    // ---- G: the last bridge over the hall, two Discords pacing in depth, and the podium.
    b.box(140, 28, 0, 146, 31, 1, 'wood');
    b.box(146, 28, 7, 152, 31, 8, 'wood');
    b.box(152, 28, 0, 158, 31, 1, 'wood');
    b.discord([[145, 31, 0], [145, 31, 7]], 1.5);
    b.discord([[151, 31, 7], [151, 31, 0]], 1.5);
    b.note(151, 33, 3);
    land(158, 172, 31, 0, D, 'stone');
    b.exit(166, 31, 3);
    b.decor('statue', 160, 31, 7).decor('statue', 171, 31, 7).decor('candles', 163, 31, 0).decor('candles', 169, 31, 0);
    b.decor('curtain', 158, 31, 7, 1.5);
  },
};
