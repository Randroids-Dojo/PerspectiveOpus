import type { SongDef } from '../types';
import { THEME, THEME_CHORDS } from './theme';

// VI. Finale. C major, grand. A broad tune that answers the theme's falling
// "3. 2 1" with a rising "1. 2 3 5"; then the Opus theme for the whole hall; a
// lyrical turn to A minor that lifts through B flat into E flat for the theme
// at its height; and four bars of chromatic gold (E flat, A flat, F minor, G7)
// to bring it home. A fanfare plays once at the start.
// Form: (fanfare) A B C B2 T (36 bars).

const FANFARE = "5,q. 5,e 1q 3q | 4h 6h | 5q. 3e 1q 5q | 7,h 2h";
const GRAND = "1q. 2e 3q 5q | 6h 5h | 4q. 5e 6q 1'q | 7h 2'h | 1'q. 7e 6q 5q | 1'h 7h | 6q 1'q 2'q 4'q | 3'h 1'q 5q";
const TURN = "6,q. 7,e 1q 3q | 4h 3h | 2q. 3e 4q 6q | 1'h 6h | 4q. 5e 6q 1'q | 3'h 2'h | 2'h b7h | 4h b6q b7q";
const HOME = "5h b3h | 1'h b6h | 4h b6h | 7,h 2h";

export const finale: SongDef = {
  id: 'finale',
  bpm: 100,
  meter: 4,
  key: { tonic: 60, mode: 'major' },
  ambience: 'hall',
  sections: {
    F: { bars: 4, chords: 'I | IV | I/5 | V7', parts: { fan: FANFARE } },
    A: { bars: 8, chords: 'I | IV I | ii7 | V | I IV | vi iii | IV V7 | I', parts: { mel: GRAND } },
    B: { bars: 8, key: { tonic: 72, mode: 'major' }, chords: THEME_CHORDS, parts: { theme: THEME } },
    C: { bars: 8, chords: 'vi | vi | ii | ii | IV | IV | bVII | bVII7', parts: { mel: TURN } },
    B2: { bars: 8, key: { tonic: 75, mode: 'major' }, chords: THEME_CHORDS, parts: { theme: THEME } },
    T: { bars: 4, chords: 'bIII | bVI | iv | V7', parts: { mel: HOME } },
  },
  intro: ['F'],
  form: ['A', 'B', 'C', 'B2', 'T'],
  trim: { score: -1.0, stage: -5.8 },
  loop: true,
  tracks: [
    // The score: piano, music box, clarinet, pizzicato, celesta.
    { id: 'pfL', inst: 'feltPiano', arr: 'score', layer: 0, gain: 0.46, maxPoly: 4, gen: { kind: 'grid', lo: 36, hi: 55, step: 1, pattern: 'R.5.' } },
    { id: 'pfR', inst: 'feltPiano', arr: 'score', layer: 0, gain: 0.3, maxPoly: 8, gen: { kind: 'grid', lo: 55, hi: 79, step: 0.5, pattern: 'bdcdbdcd' } },
    { id: 'mel', inst: 'musicbox', arr: 'score', layer: 1, gain: 0.78, part: 'mel', oct: 1 },
    { id: 'theme', inst: 'musicbox', arr: 'score', layer: 1, gain: 0.78, part: 'theme' },
    { id: 'fan', inst: 'clarinet', arr: 'score', layer: 1, gain: 0.6, part: 'fan' },
    { id: 'ctr', inst: 'clarinet', arr: 'score', layer: 3, gain: 0.38, gen: { kind: 'line', lo: 55, hi: 72, every: 2, passing: true, vel: 0.6 } },
    { id: 'pizz', inst: 'pizz', arr: 'score', layer: 4, gain: 0.5, gen: { kind: 'grid', lo: 36, hi: 55, step: 1, pattern: 'R.R.' } },
    { id: 'tri', inst: 'triangle', arr: 'score', layer: 5, gain: 0.28, gen: { kind: 'hits', step: 1, pattern: ['x...', '....'], note: 84 } },
    { id: 'cel', inst: 'celesta', arr: 'score', layer: 6, gain: 0.28, part: 'theme', oct: 1 },
    { id: 'pch', inst: 'pizz', arr: 'score', layer: 7, gain: 0.3, gen: { kind: 'grid', lo: 60, hi: 77, step: 1, pattern: '.x.x', voices: 3 } },
    // The stage: the full orchestra and choir.
    { id: 'pad', inst: 'strings', arr: 'stage', layer: 0, gain: 0.4, gen: { kind: 'pad', lo: 48, hi: 76, voices: 4, vel: 0.62 } },
    { id: 'harp', inst: 'harp', arr: 'stage', layer: 0, gain: 0.34, maxPoly: 10, gen: { kind: 'grid', lo: 43, hi: 88, step: 0.5, pattern: 'acegfeca' } },
    { id: 'vln', inst: 'strings', arr: 'stage', layer: 1, gain: 0.62, part: 'mel', oct: 1, attackSkip: 0.15 },
    { id: 'vlnT', inst: 'strings', arr: 'stage', layer: 1, gain: 0.62, part: 'theme', attackSkip: 0.15 },
    { id: 'hornT', inst: 'horn', arr: 'stage', layer: 2, gain: 0.55, part: 'theme', oct: -1 },
    { id: 'hornF', inst: 'horn', arr: 'stage', layer: 1, gain: 0.66, part: 'fan' },
    { id: 'bass', inst: 'bass', arr: 'stage', layer: 2, gain: 0.48, gen: { kind: 'grid', lo: 28, hi: 48, step: 1, pattern: 'R.R.' } },
    { id: 'cello', inst: 'strings', arr: 'stage', layer: 3, gain: 0.4, gen: { kind: 'line', lo: 43, hi: 62, every: 2, passing: true, vel: 0.65 } },
    {
      id: 'timp',
      inst: 'timpani',
      arr: 'stage',
      layer: 5,
      gain: 0.52,
      gen: {
        '*': { kind: 'hits', step: 1, pattern: ['x...', '....', 'x...', '....', 'x...', '....', 'x...', 'x.zz'], pitch: 'root', lo: 38, hi: 55 },
        T: { kind: 'hits', step: 1, pattern: ['x...', 'x...', 'x...', 'zzzz'], pitch: 'root', lo: 38, hi: 55 },
      },
    },
    {
      id: 'cym',
      inst: 'cymbal',
      arr: 'stage',
      layer: 5,
      gain: 0.28,
      only: ['B2', 'T'],
      gen: { B2: { kind: 'hits', step: 1, pattern: ['X...', '....', '....', '....', '....', '....', '....', '....'], note: 72 }, T: { kind: 'hits', step: 1, pattern: ['....', '....', '....', '..zz'], note: 72 } },
    },
    { id: 'flute', inst: 'flute', arr: 'stage', layer: 6, gain: 0.34, part: 'mel', oct: 1, only: ['A', 'C'] },
    { id: 'glock', inst: 'glock', arr: 'stage', layer: 6, gain: 0.2, part: 'theme', oct: 1, only: ['B2'] },
    { id: 'bell', inst: 'bell', arr: 'stage', layer: 6, gain: 0.32, only: ['B2'], gen: { kind: 'hits', step: 1, pattern: ['x...', '....', '....', '....', 'x...', '....', '....', '....'], pitch: 'tonic', lo: 60, hi: 72 } },
    { id: 'choir', inst: 'choirAh', arr: 'stage', layer: 7, gain: 0.36, only: ['B', 'B2', 'T'], gen: { kind: 'pad', lo: 55, hi: 76, voices: 4, vel: 0.6 } },
    { id: 'horns', inst: 'horn', arr: 'stage', layer: 7, gain: 0.3, skip: ['F'], gen: { kind: 'pad', lo: 50, hi: 70, voices: 3, vel: 0.6 } },
  ],
};
