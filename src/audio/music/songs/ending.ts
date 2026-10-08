import type { SongDef } from '../types';
import { THEME } from './theme';

// The ending: the whole Opus, about ninety seconds, played once. The theme alone
// and tender in E flat, a two-bar swell, the theme for everyone with choir and
// bells, a plagal amen, then the theme's first phrase on its own, slowing, and a
// last chord left to ring.

export const ending: SongDef = {
  id: 'ending',
  bpm: 66,
  meter: 4,
  key: { tonic: 63, mode: 'major' },
  full: true,
  sections: {
    E0: { bars: 1, chords: 'I', parts: { mel: 'r h. 5,q' } },
    E1: { bars: 8, chords: 'I | IV I/3 | ii V | V | I | vi iii/3:1 IV:1 | I/5 V7 | I', parts: { mel: THEME } },
    E2: { bars: 2, bpm: 70, chords: 'IV | V7', parts: { mel: '6h 5h | 4h 2q 5,q' } },
    E3: {
      bars: 8,
      bpm: 76,
      chords: 'I | IV I/3 | ii V | V | I | vi iii/3:1 IV:1 | I/5 V7 | I',
      parts: { mel: THEME, desc: "5h 1'h | 1'h 5h | 6h 7h | 2'h. r q | 3'w | 3'h 2'q 1'q | 1'h 7h | 1'h. r q" },
    },
    E4: { bars: 2, bpm: 76, chords: 'IV | I', parts: { mel: '6h 4h | 3h. 5,q' } },
    E5: { bars: 5, bpm: 56, chords: 'I | IV I/3 | ii7 V7 | I | I', parts: { mel: "3q. 2e 1q 5q | 6h 5q 3q | 4q. 3e 2q 7,q | 1w | r w" } },
  },
  form: ['E0', 'E1', 'E2', 'E3', 'E4', 'E5'],
  trim: { score: 0.0, stage: -6.0 },
  loop: false,
  tracks: [
    // The score.
    { id: 'pfL', inst: 'feltPiano', arr: 'score', layer: 0, gain: 0.46, maxPoly: 4, gen: { '*': { kind: 'grid', lo: 39, hi: 55, step: 1, pattern: 'R.5.' }, E5: { kind: 'grid', lo: 39, hi: 55, step: 2, pattern: 'RR' } } },
    { id: 'pfR', inst: 'feltPiano', arr: 'score', layer: 0, gain: 0.3, maxPoly: 8, gen: { kind: 'grid', lo: 55, hi: 79, step: 0.5, pattern: 'acedfedc' } },
    { id: 'mel', inst: 'musicbox', arr: 'score', layer: 0, gain: 0.8, part: 'mel', oct: 1 },
    { id: 'desc', inst: 'clarinet', arr: 'score', layer: 0, gain: 0.45, part: 'desc' },
    { id: 'pizz', inst: 'pizz', arr: 'score', layer: 0, gain: 0.5, only: ['E2', 'E3', 'E4'], gen: { kind: 'grid', lo: 39, hi: 55, step: 1, pattern: 'R.R.' } },
    { id: 'cel', inst: 'celesta', arr: 'score', layer: 0, gain: 0.3, part: 'mel', oct: 1, only: ['E3', 'E4'] },
    // The stage.
    { id: 'pad', inst: 'strings', arr: 'stage', layer: 0, gain: 0.4, gen: { kind: 'pad', lo: 51, hi: 75, voices: 4, vel: 0.6 } },
    { id: 'harp', inst: 'harp', arr: 'stage', layer: 0, gain: 0.36, maxPoly: 10, gen: { kind: 'grid', lo: 46, hi: 87, step: 0.5, pattern: 'acegfeca' } },
    { id: 'flute', inst: 'flute', arr: 'stage', layer: 0, gain: 0.52, part: 'mel', oct: 1, only: ['E0', 'E1', 'E2'] },
    { id: 'vln', inst: 'strings', arr: 'stage', layer: 0, gain: 0.66, part: 'mel', oct: 1, attackSkip: 0.12, only: ['E3', 'E4'] },
    { id: 'horn', inst: 'horn', arr: 'stage', layer: 0, gain: 0.5, part: 'mel', only: ['E3', 'E4'] },
    { id: 'flDesc', inst: 'flute', arr: 'stage', layer: 0, gain: 0.38, part: 'desc', oct: 1 },
    { id: 'cel2', inst: 'celesta', arr: 'stage', layer: 0, gain: 0.55, part: 'mel', oct: 1, only: ['E5'] },
    { id: 'bass', inst: 'bass', arr: 'stage', layer: 0, gain: 0.48, gen: { kind: 'grid', lo: 31, hi: 50, step: 2, pattern: 'RR' } },
    { id: 'cello', inst: 'strings', arr: 'stage', layer: 0, gain: 0.4, only: ['E3', 'E4'], gen: { kind: 'line', lo: 43, hi: 62, every: 2, passing: true, vel: 0.65 } },
    { id: 'horns', inst: 'horn', arr: 'stage', layer: 0, gain: 0.32, only: ['E2', 'E3', 'E4'], gen: { kind: 'pad', lo: 50, hi: 70, voices: 3, vel: 0.62 } },
    { id: 'choir', inst: 'choirAh', arr: 'stage', layer: 0, gain: 0.38, only: ['E3', 'E4'], gen: { kind: 'pad', lo: 55, hi: 76, voices: 4, vel: 0.6 } },
    { id: 'choirOo', inst: 'choir', arr: 'stage', layer: 0, gain: 0.3, only: ['E5'], gen: { kind: 'pad', lo: 55, hi: 72, voices: 3, vel: 0.5 } },
    {
      id: 'timp',
      inst: 'timpani',
      arr: 'stage',
      layer: 0,
      gain: 0.55,
      only: ['E2', 'E3', 'E4'],
      gen: {
        E2: { kind: 'hits', step: 1, pattern: ['zzzz', 'zzzz'], pitch: 'root', lo: 38, hi: 55 },
        E3: { kind: 'hits', step: 1, pattern: ['X...', '....', 'x...', '....', 'X...', '....', 'x...', 'x.x.'], pitch: 'root', lo: 38, hi: 55 },
        E4: { kind: 'hits', step: 1, pattern: ['X...', 'z..X'], pitch: 'root', lo: 38, hi: 55 },
      },
    },
    {
      id: 'cym',
      inst: 'cymbal',
      arr: 'stage',
      layer: 0,
      gain: 0.3,
      only: ['E3', 'E4'],
      gen: { E3: { kind: 'hits', step: 1, pattern: ['X...', '....', '....', '....', '....', '....', '....', '....'], note: 72 }, E4: { kind: 'hits', step: 1, pattern: ['....', '...X'], note: 72 } },
    },
    { id: 'glock', inst: 'glock', arr: 'stage', layer: 0, gain: 0.2, part: 'mel', oct: 1, only: ['E3'] },
    { id: 'bell', inst: 'bell', arr: 'stage', layer: 0, gain: 0.34, only: ['E4'], gen: { kind: 'hits', step: 1, pattern: ['x...', 'x...'], pitch: 'tonic', lo: 60, hi: 72 } },
  ],
};
