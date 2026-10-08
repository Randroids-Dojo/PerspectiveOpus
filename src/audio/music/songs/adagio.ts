import type { SongDef } from '../types';
import { THEME, THEME_CHORDS_MINOR } from './theme';

// II. Adagio. F major, slow and tender, over a bass that walks down a step at a
// time (F E D C B flat A G C). The melody sighs (B flat falling to A over D minor).
// In the middle the Opus theme turns to D minor, sung by a clarinet on the page
// and a cello on the stage. Form: A A2 B A3 (32 bars).

const LAKE = "5h 3q. 2e | 2h. 3q | 4h 3h | 1h. 2e 3e | 4h 6q 5q | 5q. 4e 3h | 2q 4q 7,q 2q | 1w";
const LAKE2 = "5h 3q. 2e | 2h. 3q | 4h 3h | 1h. 2e 3e | 4q 6q 1'q 6q | 5h 1'q 7q | 6q 4q 2q 7,q | 1h. 3,q";
const CHORDS = 'I | V/3 | vi | I/5 | IV | I/3 | ii7 V7 | I';

export const adagio: SongDef = {
  id: 'adagio',
  bpm: 63,
  meter: 4,
  key: { tonic: 65, mode: 'major' },
  ambience: 'lake',
  sections: {
    A: { bars: 8, chords: CHORDS, parts: { mel: LAKE } },
    A2: { bars: 8, chords: CHORDS, parts: { mel: LAKE2 } },
    B: { bars: 8, key: { tonic: 62, mode: 'minor' }, chords: THEME_CHORDS_MINOR, parts: { theme: THEME } },
    A3: { bars: 8, chords: CHORDS, parts: { mel: LAKE } },
  },
  form: ['A', 'A2', 'B', 'A3'],
  trim: { score: -2.4, stage: -7.0 },
  loop: true,
  tracks: [
    // The score: felt piano and a clarinet, a music box far off.
    { id: 'pfL', inst: 'feltPiano', arr: 'score', layer: 0, gain: 0.48, maxPoly: 4, gen: { kind: 'grid', lo: 36, hi: 55, step: 2, pattern: 'RR' } },
    { id: 'pfR', inst: 'feltPiano', arr: 'score', layer: 0, gain: 0.36, maxPoly: 8, gen: { kind: 'grid', lo: 53, hi: 77, step: 0.5, pattern: 'abcdebcd' } },
    { id: 'mel', inst: 'clarinet', arr: 'score', layer: 1, gain: 0.66, part: 'mel', humanize: 0.014, legato: 0.98 },
    { id: 'theme', inst: 'clarinet', arr: 'score', layer: 1, gain: 0.66, part: 'theme', humanize: 0.014 },
    { id: 'mbox', inst: 'musicbox', arr: 'score', layer: 3, gain: 0.36, gen: { kind: 'line', lo: 72, hi: 88, every: 2, vel: 0.6 } },
    { id: 'pizz', inst: 'pizz', arr: 'score', layer: 4, gain: 0.45, skip: ['A'], gen: { kind: 'grid', lo: 36, hi: 52, step: 2, pattern: 'R.' } },
    { id: 'drops', inst: 'celesta', arr: 'score', layer: 5, gain: 0.26, gen: { kind: 'grid', lo: 72, hi: 91, step: 1, pattern: ['...c', '..d.', '...b', '....'] } },
    { id: 'pfMel', inst: 'feltPiano', arr: 'score', layer: 6, gain: 0.3, part: 'mel', oct: 1, only: ['A2', 'A3'] },
    { id: 'clar2', inst: 'clarinet', arr: 'score', layer: 7, gain: 0.34, gen: { kind: 'line', lo: 53, hi: 67, every: 2, passing: true, vel: 0.55 } },
    // The stage: strings, harp, flute, a cello for the theme, choir.
    { id: 'pad', inst: 'strings', arr: 'stage', layer: 0, gain: 0.42, gen: { kind: 'pad', lo: 48, hi: 72, voices: 4, vel: 0.6 } },
    { id: 'harp', inst: 'harp', arr: 'stage', layer: 0, gain: 0.36, maxPoly: 10, gen: { kind: 'grid', lo: 41, hi: 84, step: 0.5, pattern: 'acegfeca' } },
    { id: 'vln', inst: 'strings', arr: 'stage', layer: 1, gain: 0.6, part: 'mel', oct: 1, attackSkip: 0.1, humanize: 0.012 },
    { id: 'cello', inst: 'strings', arr: 'stage', layer: 1, gain: 0.68, part: 'theme', oct: -1, attackSkip: 0.08, humanize: 0.012 },
    { id: 'bass', inst: 'bass', arr: 'stage', layer: 2, gain: 0.5, gen: { kind: 'grid', lo: 29, hi: 48, step: 2, pattern: 'RR' } },
    { id: 'horn', inst: 'horn', arr: 'stage', layer: 3, gain: 0.36, gen: { kind: 'line', lo: 50, hi: 67, every: 4, vel: 0.55 } },
    { id: 'spizz', inst: 'pizz', arr: 'stage', layer: 4, gain: 0.35, skip: ['A'], gen: { kind: 'grid', lo: 41, hi: 57, step: 1, pattern: 'R.5.' } },
    {
      id: 'timp',
      inst: 'timpani',
      arr: 'stage',
      layer: 5,
      gain: 0.36,
      gen: { kind: 'hits', step: 1, pattern: ['x...', '....', '....', '....', '....', '....', '....', 'z.x.'], pitch: 'root', lo: 38, hi: 53 },
    },
    { id: 'cel', inst: 'celesta', arr: 'stage', layer: 5, gain: 0.22, gen: { kind: 'grid', lo: 72, hi: 91, step: 1, pattern: ['...c', '..d.', '...b', '....'] } },
    { id: 'flute', inst: 'flute', arr: 'stage', layer: 6, gain: 0.36, part: 'mel', oct: 1, only: ['A2', 'A3'] },
    { id: 'choir', inst: 'choir', arr: 'stage', layer: 7, gain: 0.34, gen: { kind: 'pad', lo: 55, hi: 74, voices: 3, vel: 0.55 } },
  ],
};
