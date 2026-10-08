import type { SongDef } from '../types';
import { THEME, THEME_CHORDS, THEME_PICKUP } from './theme';

// The title: the Opus theme stated plainly in E flat, the way a curtain rises.
// Intro (once), then A (theme) B (an answering phrase) A2 (theme with a descant).

const ANSWER = "6h. 5e 4e | 3h 5h | 4q. 3e 2q 4q | 1'h 7h | 3'h. 2'e 1'e | 7h 5h | 6q 4q 2q 7,q | 1h. 5,q";
const DESCANT = "5h 1'h | 1'h 5h | 6h 7h | 2'h. r q | 3'w | 3'h 2'q 1'q | 1'h 7h | 1'h. r q";

export const title: SongDef = {
  id: 'title',
  bpm: 72,
  meter: 4,
  key: { tonic: 63, mode: 'major' },
  full: true,
  sections: {
    intro: { bars: 2, chords: 'I | I', parts: { mel: 'r w | r h. 5,q' } },
    A: { bars: 8, chords: THEME_CHORDS, parts: { mel: THEME } },
    B: { bars: 8, chords: 'IV | I/3 | ii7 | V7sus4 V7 | vi | iii | ii7 V7 | I', parts: { mel: ANSWER } },
    A2: { bars: 8, chords: THEME_CHORDS, parts: { mel: THEME_PICKUP, desc: DESCANT } },
  },
  intro: ['intro'],
  form: ['A', 'B', 'A2'],
  trim: { score: 1.2, stage: -6.2 },
  loop: true,
  tracks: [
    // The score: felt piano, music box, a clarinet.
    { id: 'pfL', inst: 'feltPiano', arr: 'score', layer: 0, gain: 0.5, maxPoly: 4, gen: { kind: 'grid', lo: 39, hi: 55, step: 1, pattern: 'R.5.' } },
    { id: 'pfR', inst: 'feltPiano', arr: 'score', layer: 0, gain: 0.3, maxPoly: 8, gen: { kind: 'grid', lo: 55, hi: 79, step: 0.5, pattern: 'acedfedc' } },
    { id: 'mel', inst: 'musicbox', arr: 'score', layer: 1, gain: 0.85, part: 'mel', oct: 1 },
    { id: 'desc', inst: 'clarinet', arr: 'score', layer: 3, gain: 0.5, part: 'desc', only: ['A2'], humanize: 0.012 },
    { id: 'pizz', inst: 'pizz', arr: 'score', layer: 4, gain: 0.45, only: ['B', 'A2'], gen: { kind: 'grid', lo: 39, hi: 55, step: 1, pattern: 'R.R.' } },
    // The stage: strings, harp, horn, flute, choir.
    { id: 'pad', inst: 'strings', arr: 'stage', layer: 0, gain: 0.42, gen: { kind: 'pad', lo: 51, hi: 75, voices: 4, vel: 0.6 } },
    { id: 'harp', inst: 'harp', arr: 'stage', layer: 0, gain: 0.36, maxPoly: 10, gen: { kind: 'grid', lo: 46, hi: 87, step: 0.5, pattern: 'acegfeca' } },
    { id: 'vln', inst: 'strings', arr: 'stage', layer: 1, gain: 0.62, part: 'mel', oct: 1, attackSkip: 0.14, humanize: 0.01 },
    { id: 'bass', inst: 'bass', arr: 'stage', layer: 2, gain: 0.5, gen: { kind: 'grid', lo: 31, hi: 50, step: 2, pattern: 'RR' } },
    { id: 'cello', inst: 'strings', arr: 'stage', layer: 3, gain: 0.4, gen: { kind: 'line', lo: 43, hi: 62, every: 2, passing: true, vel: 0.65 } },
    { id: 'horn', inst: 'horn', arr: 'stage', layer: 6, gain: 0.4, part: 'mel', only: ['A2'] },
    { id: 'flute', inst: 'flute', arr: 'stage', layer: 5, gain: 0.4, part: 'desc', oct: 1, only: ['A2'] },
    { id: 'choir', inst: 'choir', arr: 'stage', layer: 7, gain: 0.3, only: ['B', 'A2'], gen: { kind: 'pad', lo: 55, hi: 74, voices: 3, vel: 0.55 } },
    {
      id: 'timp',
      inst: 'timpani',
      arr: 'stage',
      layer: 5,
      gain: 0.45,
      only: ['A2'],
      gen: { kind: 'hits', step: 1, pattern: ['x...', '....', '....', '....', 'x...', '....', '....', 'z.x.'], pitch: 'root', lo: 38, hi: 55 },
    },
  ],
};
