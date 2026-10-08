import type { Builder, LevelDef } from '../level';
import type { DecorKind } from '../types';

/** A test scene with every material, entity and decor kind. Open with `?level=gallery`. */
export const gallery: LevelDef = {
  info: {
    id: 'gallery',
    index: -1,
    movement: 'Gallery',
    title: 'Every thing',
    epigraph: 'A room with one of everything.',
    palette: 'dawn',
    tempo: 'Ad libitum',
  },
  size: [96, 22, 8],
  build(b: Builder) {
    b.box(0, 0, 0, 96, 4, 8, 'stone');
    b.spawn(3, 4, 3);
    // Materials as a row of plinths, back lane.
    const mats = ['stone', 'brick', 'wood', 'brass', 'dark', 'crystal', 'leaf', 'marble'] as const;
    mats.forEach((m, i) => b.box(6 + i * 2, 4, 6, 7 + i * 2, 6, 8, m));
    // A stepped wall mixing depths so depth tones show on the page.
    for (let z = 0; z < 8; z++) b.box(24 + z, 4, z, 25 + z, 5 + z, z + 1, z % 2 ? 'brick' : 'stone');
    // Thorns in the middle lanes and a thorn patch at the front.
    b.thorns(34, 4, 3, 37, 5, 5);
    b.thorns(38, 4, 0, 40, 5, 1);
    // Notes at several depths.
    b.note(8, 5, 2).note(10, 6, 0).note(12, 5, 7);
    b.checkpoint(18, 4, 3);
    b.checkpoint(44, 4, 3);
    // Drums and keys with their gates.
    b.drum(46, 4, 1);
    b.drum(48, 4, 5, 7);
    b.key(52, 4, 2, 1);
    b.key(54, 4, 5, 2, 2);
    b.gate(57, 4, 0, 58, 8, 8, 1, false);
    b.gate(60, 4, 0, 61, 8, 8, 2, true);
    b.groupOn(2);
    // Platforms: sideways, up and down, in depth.
    b.platform({ size: [3, 1, 2], path: [[63, 6, 1], [69, 6, 1]], speed: 2 });
    b.platform({ size: [2, 1, 2], path: [[72, 5, 5], [72, 10, 5]], speed: 2, mat: 'brass' });
    b.platform({ size: [2, 1, 2], path: [[76, 6, 0], [76, 6, 6]], speed: 1.5, mat: 'stone' });
    // Discords patrolling along x and along z.
    b.discord([[80, 4, 1], [86, 4, 1]], 1.6);
    b.discord([[84, 5, 2], [84, 5, 7]], 1.2);
    // Every decor kind.
    const kinds: DecorKind[] = ['tree', 'pine', 'lamp', 'pillar', 'banner', 'flowers', 'grass', 'rock', 'reeds', 'lantern', 'pipes', 'gear', 'crystals', 'statue', 'curtain', 'arch', 'mushroom', 'bell', 'candles'];
    kinds.forEach((k, i) => b.decor(k, 2 + i * 4.8 > 94 ? 94 : Math.round(2 + i * 4.8), 4, 7, 1));
    b.exit(92, 4, 3);
  },
};
