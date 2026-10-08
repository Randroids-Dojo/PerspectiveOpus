import type { SongDef } from '../types';
import { THEME, THEME_CHORDS } from './theme';

// I. Overture. D major, Allegro moderato. A dawn tune that climbs like the sun
// (A3 D F# A, a rising arpeggio), then the Opus theme as a horn call in the
// dominant, a development through B minor, and the dawn tune in full.
// Form: A A2 B C A3 (40 bars).

const DAWN = "5,q 1q 3q 5q | 6h 1'q. 7e | 6q 4q 2q 3q | 2h. r q | 5,q 1q 3q 5q | 1'h 3'q. 2'e | 1'q 6q 7q 2'q | 1'h. r q";
const DAWN2 = "5,q 1q 3q 5q | 6h 1'q. 7e | 6q 4q 2q 3q | 2q 5e 4e 3e 2e 1e 7,e | 5,q 1q 3q 5q | 1'h 3'q. 2'e | 1'q 6q 7q 2'q | 1'q 5e 3e 1q 2q";
const RISE = "6,q 1q 3q 6q | 1'h 7q 6q | 4,q 6,q 1q 4q | 6h 5q 4q | 2q 4q 6q 1'q | 2'h 1'q 6q | 5q. 4e 5q 1'q | 7h. r q";
// A sustained descant for the second time through, stepping through guide tones.
const ANSWER = "3'w | 4'w | 4'h 2'h | 2'h 7h | 1'w | 1'h 3'h | 4'w | 3'h 2'h";

export const overture: SongDef = {
  id: 'overture',
  bpm: 116,
  meter: 4,
  key: { tonic: 62, mode: 'major' },
  ambience: 'meadow',
  sections: {
    A: { bars: 8, chords: 'I | IV | ii V | V | I | vi | IV V7 | I', parts: { mel: DAWN } },
    A2: { bars: 8, chords: 'I | IV | ii V | V7 | I | vi | IV V7 | I:2 II7:2', parts: { mel: DAWN2, ctr: ANSWER } },
    B: { bars: 8, key: { tonic: 69, mode: 'major' }, chords: THEME_CHORDS, parts: { theme: THEME } },
    C: { bars: 8, chords: 'vi | vi | IV | IV | ii7 | ii7 | V7sus4 | V7', parts: { mel: RISE } },
    A3: { bars: 8, chords: 'I | IV | ii V | V | I | vi | IV V7 | I:2 V7:2', parts: { mel: DAWN, ctr: ANSWER } },
  },
  form: ['A', 'A2', 'B', 'C', 'A3'],
  trim: { score: -3.0, stage: -7.0 },
  loop: true,
  tracks: [
    // The score: felt piano, music box, clarinet, pizzicato, a triangle.
    { id: 'pfL', inst: 'feltPiano', arr: 'score', layer: 0, gain: 0.48, maxPoly: 4, gen: { '*': { kind: 'grid', lo: 38, hi: 57, step: 1, pattern: 'R.5.' }, B: { kind: 'grid', lo: 38, hi: 57, step: 2, pattern: 'RR' } } },
    { id: 'pfR', inst: 'feltPiano', arr: 'score', layer: 0, gain: 0.3, maxPoly: 8, gen: { kind: 'grid', lo: 57, hi: 81, step: 0.5, pattern: 'bdcdbdcd' } },
    { id: 'mel', inst: 'musicbox', arr: 'score', layer: 1, gain: 0.8, part: 'mel', oct: 1 },
    { id: 'theme', inst: 'clarinet', arr: 'score', layer: 1, gain: 0.7, part: 'theme', humanize: 0.012 },
    { id: 'ctr', inst: 'clarinet', arr: 'score', layer: 3, gain: 0.42, part: 'ctr', humanize: 0.012 },
    { id: 'pizz', inst: 'pizz', arr: 'score', layer: 4, gain: 0.6, gen: { kind: 'grid', lo: 38, hi: 55, step: 1, pattern: 'R.R.' } },
    { id: 'tri', inst: 'triangle', arr: 'score', layer: 5, gain: 0.32, skip: ['B'], gen: { kind: 'hits', step: 1, pattern: ['x...', '....'], note: 84 } },
    { id: 'offb', inst: 'pizz', arr: 'score', layer: 6, gain: 0.32, gen: { kind: 'grid', lo: 62, hi: 79, step: 1, pattern: '.x.x', voices: 2 } },
    { id: 'cel', inst: 'celesta', arr: 'score', layer: 7, gain: 0.3, part: 'mel', oct: 1, only: ['A2', 'A3'] },
    // The stage: strings, harp, horns, flute, timpani, glockenspiel.
    { id: 'pad', inst: 'strings', arr: 'stage', layer: 0, gain: 0.4, gen: { kind: 'pad', lo: 50, hi: 74, voices: 4, vel: 0.6 } },
    { id: 'harp', inst: 'harp', arr: 'stage', layer: 0, gain: 0.36, maxPoly: 10, gen: { kind: 'grid', lo: 50, hi: 86, step: 0.5, pattern: 'acegfeca' } },
    { id: 'vln', inst: 'strings', arr: 'stage', layer: 1, gain: 0.6, part: 'mel', oct: 1, attackSkip: 0.2, humanize: 0.008 },
    { id: 'hornTheme', inst: 'horn', arr: 'stage', layer: 1, gain: 0.65, part: 'theme', oct: -1 },
    { id: 'vlnTheme', inst: 'strings', arr: 'stage', layer: 6, gain: 0.4, part: 'theme', attackSkip: 0.16 },
    { id: 'bass', inst: 'bass', arr: 'stage', layer: 2, gain: 0.5, gen: { kind: 'grid', lo: 33, hi: 50, step: 2, pattern: 'RR' } },
    { id: 'cello', inst: 'strings', arr: 'stage', layer: 3, gain: 0.42, gen: { kind: 'line', lo: 45, hi: 62, every: 2, passing: true, vel: 0.65 } },
    { id: 'flute', inst: 'flute', arr: 'stage', layer: 3, gain: 0.4, part: 'ctr' },
    { id: 'spizz', inst: 'pizz', arr: 'stage', layer: 4, gain: 0.45, gen: { kind: 'grid', lo: 38, hi: 55, step: 1, pattern: 'R.5.' } },
    {
      id: 'timp',
      inst: 'timpani',
      arr: 'stage',
      layer: 5,
      gain: 0.5,
      gen: {
        '*': { kind: 'hits', step: 1, pattern: ['x...', '....', 'x...', '....', 'x...', '....', 'x...', 'x.x.'], pitch: 'root', lo: 38, hi: 55 },
        C: { kind: 'hits', step: 1, pattern: ['....', '....', '....', '....', 'x...', '....', 'x...', 'zzzz'], pitch: 'root', lo: 38, hi: 55 },
      },
    },
    { id: 'stri', inst: 'triangle', arr: 'stage', layer: 5, gain: 0.28, skip: ['B'], gen: { kind: 'hits', step: 1, pattern: ['x...', '....'], note: 84 } },
    { id: 'flMel', inst: 'flute', arr: 'stage', layer: 6, gain: 0.32, part: 'mel', oct: 1, only: ['A2', 'A3'] },
    { id: 'glock', inst: 'glock', arr: 'stage', layer: 6, gain: 0.22, part: 'mel', oct: 2, only: ['A3'] },
    { id: 'horns', inst: 'horn', arr: 'stage', layer: 7, gain: 0.32, skip: ['B'], gen: { kind: 'pad', lo: 50, hi: 69, voices: 3, vel: 0.6 } },
  ],
};
