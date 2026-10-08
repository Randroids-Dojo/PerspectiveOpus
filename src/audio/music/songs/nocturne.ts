import type { SongDef } from '../types';
import { THEME } from './theme';

// IV. Nocturne. D flat major with a Lydian G natural for moonlight, triplets
// rolling underneath. The middle steps sideways to A major (a chromatic mediant:
// D flat and C sharp are the same note) for the Opus theme on celesta and flute,
// then slips back home. Form: A A2 B A3 (32 bars).

const MOON = "5h. 7q | 6h #4h | 1'h. 3'q | 2'h 1'h | 6h. 1'q | #4h. 6q | 1'q 6q 7q 2'q | 1'w";
const MOON2 = "5h. 7q | 6q. 5e #4h | 1'h 2't 1't 7t 3'q | 2'h 1'h | 6h. 1'q | #4h 5q 6q | 1'q 6q 7q 2'q | 1'h. b3q";
const CHORDS = 'Imaj7 | II@1 | IVmaj7 | I | vi7 | II7 | ii7 V7 | I';

export const nocturne: SongDef = {
  id: 'nocturne',
  bpm: 58,
  meter: 4,
  key: { tonic: 61, mode: 'major' },
  ambience: 'garden',
  sections: {
    A: { bars: 8, chords: CHORDS, parts: { mel: MOON } },
    A2: { bars: 8, chords: CHORDS.replace(/I$/, 'I:3 bVI:1'), parts: { mel: MOON2 } },
    B: {
      bars: 8,
      key: { tonic: 69, mode: 'major' },
      chords: 'Imaj7 | IVmaj7 I/3 | ii7 V | V7sus4 V | Imaj7 | vi7 iii/3:1 IVmaj7:1 | I/5 V7 | I',
      parts: { mel: THEME },
    },
    A3: { bars: 8, chords: CHORDS, parts: { mel: MOON } },
  },
  form: ['A', 'A2', 'B', 'A3'],
  trim: { score: -0.1, stage: -7.0 },
  loop: true,
  tracks: [
    // The score: celesta over rolling felt piano, a music box answering.
    { id: 'pfL', inst: 'feltPiano', arr: 'score', layer: 0, gain: 0.45, maxPoly: 4, gen: { kind: 'grid', lo: 37, hi: 56, step: 2, pattern: 'RR' } },
    { id: 'pfR', inst: 'feltPiano', arr: 'score', layer: 0, gain: 0.28, maxPoly: 9, gen: { kind: 'grid', lo: 56, hi: 80, step: 1 / 3, pattern: 'acedca' } },
    { id: 'mel', inst: 'celesta', arr: 'score', layer: 1, gain: 0.72, part: 'mel', oct: 1 },
    { id: 'mbox', inst: 'musicbox', arr: 'score', layer: 3, gain: 0.34, gen: { kind: 'line', lo: 70, hi: 86, every: 4, vel: 0.6 } },
    { id: 'pizz', inst: 'pizz', arr: 'score', layer: 4, gain: 0.42, gen: { kind: 'grid', lo: 37, hi: 53, step: 2, pattern: 'R.' } },
    { id: 'spark', inst: 'celesta', arr: 'score', layer: 5, gain: 0.22, gen: { kind: 'grid', lo: 79, hi: 96, step: 1, pattern: ['...a', '..b.', '....', '.c..'] } },
    { id: 'pfMel', inst: 'feltPiano', arr: 'score', layer: 6, gain: 0.28, part: 'mel' },
    { id: 'clar', inst: 'clarinet', arr: 'score', layer: 7, gain: 0.32, gen: { kind: 'line', lo: 53, hi: 68, every: 2, passing: true, vel: 0.5 } },
    // The stage: muted strings, harp triplets, flute, a hushed choir, glockenspiel.
    { id: 'pad', inst: 'strings', arr: 'stage', layer: 0, gain: 0.4, lowpass: 3200, gen: { kind: 'pad', lo: 49, hi: 73, voices: 4, vel: 0.55 } },
    { id: 'harp', inst: 'harp', arr: 'stage', layer: 0, gain: 0.34, maxPoly: 10, gen: { kind: 'grid', lo: 44, hi: 84, step: 1 / 3, pattern: 'acegec' } },
    { id: 'flute', inst: 'flute', arr: 'stage', layer: 1, gain: 0.56, part: 'mel', oct: 1, humanize: 0.012 },
    { id: 'bass', inst: 'bass', arr: 'stage', layer: 2, gain: 0.42, gen: { kind: 'grid', lo: 30, hi: 49, step: 2, pattern: 'RR' } },
    { id: 'choir', inst: 'choir', arr: 'stage', layer: 3, gain: 0.36, gen: { kind: 'pad', lo: 56, hi: 75, voices: 3, vel: 0.5 } },
    { id: 'horn', inst: 'horn', arr: 'stage', layer: 4, gain: 0.28, lowpass: 2200, gen: { kind: 'line', lo: 49, hi: 65, every: 4, vel: 0.5 } },
    { id: 'glock', inst: 'glock', arr: 'stage', layer: 5, gain: 0.2, gen: { kind: 'grid', lo: 84, hi: 100, step: 1, pattern: ['...a', '..b.', '....', '.c..'] } },
    { id: 'vln', inst: 'strings', arr: 'stage', layer: 6, gain: 0.36, part: 'mel', oct: 1, attackSkip: 0.08, only: ['B', 'A3'] },
    { id: 'cel', inst: 'celesta', arr: 'stage', layer: 6, gain: 0.24, part: 'mel', oct: 2, only: ['A2', 'B'] },
    { id: 'cym', inst: 'cymbal', arr: 'stage', layer: 7, gain: 0.2, gen: { kind: 'hits', step: 1, pattern: ['o...', '....', '....', '....', '....', '....', '....', '....'], note: 72 } },
    {
      id: 'timp',
      inst: 'timpani',
      arr: 'stage',
      layer: 7,
      gain: 0.3,
      only: ['B'],
      gen: { kind: 'hits', step: 1, pattern: ['....', '....', '....', '....', '....', '....', '....', 'z.o.'], pitch: 'root', lo: 38, hi: 55 },
    },
  ],
};
