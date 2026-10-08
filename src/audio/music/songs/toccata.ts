import type { SongDef } from '../types';
import { THEME, THEME_CHORDS, THEME_CHORDS_MINOR } from './theme';

// V. Toccata. D minor, driving. A sixteenth-note ostinato on a held pedal note
// (low, pedal, middle, pedal) turns like clockwork under a ticking motto of
// repeated notes. The Opus theme strides through in D minor, a circle of fifths
// winds the gears, and the theme returns in F major before the motto again.
// Form: A B C B2 A2 (40 bars).

const MOTTO = "5e 5e 5e 5e 6q 5q | 3e 3e 3e 3e 4q 3q | 1'q 6q 4q 6q | 5q #7,q 2q 5q | 5e 5e 5e 5e 1'q 5q | 6e 6e 6e 6e 1'q 6q | 4q 3q 2q #7,q | 1h. 5,q";
const GEARS = "1'e 1'e 1'e 1'e 6q 4q | 7e 7e 7e 7e 2'q 7q | 3e 3e 3e 3e 7q 5q | 6e 6e 6e 6e 3'q 1'q | 2e 2e 2e 2e 6q 4q | 5e 5e 5e 5e #7q 2'q | 1'q 5q 3q 1q | 7,q 2q 4q 7,q";
const OST = 'aCbCcCbC';

export const toccata: SongDef = {
  id: 'toccata',
  bpm: 132,
  meter: 4,
  key: { tonic: 62, mode: 'minor' },
  ambience: 'clock',
  sections: {
    A: { bars: 8, chords: 'i | i | iv | V | i | VI | iv V | i', parts: { mel: MOTTO } },
    B: { bars: 8, chords: THEME_CHORDS_MINOR, parts: { theme: THEME } },
    C: { bars: 8, chords: 'iv | VII | III | VI | iio | V | i | VII7', parts: { mel: GEARS } },
    B2: { bars: 8, key: { tonic: 65, mode: 'major' }, chords: THEME_CHORDS.replace(/I$/, 'I:2 III7:2'), parts: { theme: THEME } },
    A2: { bars: 8, chords: 'i | i | iv | V | i | VI | iv V | i:2 V7:2', parts: { mel: MOTTO.replace(/1h\. 5,q$/, '1h. r q') } },
  },
  form: ['A', 'B', 'C', 'B2', 'A2'],
  trim: { score: -2.2, stage: -4.6 },
  loop: true,
  tracks: [
    // The score: harpsichord clockwork, a music box motto, pizzicato, ticking.
    { id: 'hpsd', inst: 'harpsichord', arr: 'score', layer: 0, gain: 0.5, lowpass: 6500, ring: false, maxPoly: 6, gen: { kind: 'grid', lo: 50, hi: 77, step: 0.25, pattern: OST } },
    { id: 'tick', inst: 'tick', arr: 'score', layer: 0, gain: 0.18, gen: { kind: 'hits', step: 1, pattern: 'x.x.', note: 88 } },
    { id: 'tock', inst: 'tick', arr: 'score', layer: 0, gain: 0.18, gen: { kind: 'hits', step: 1, pattern: '.x.x', note: 82 } },
    { id: 'mel', inst: 'musicbox', arr: 'score', layer: 1, gain: 0.72, part: 'mel', oct: 1 },
    { id: 'theme', inst: 'musicbox', arr: 'score', layer: 1, gain: 0.72, part: 'theme', oct: 1 },
    { id: 'pizz', inst: 'pizz', arr: 'score', layer: 0, gain: 0.5, gen: { kind: 'grid', lo: 38, hi: 53, step: 1, pattern: 'R.R.' } },
    { id: 'ctr', inst: 'celesta', arr: 'score', layer: 3, gain: 0.34, gen: { kind: 'line', lo: 67, hi: 84, every: 2, vel: 0.6 } },
    { id: 'chords', inst: 'feltPiano', arr: 'score', layer: 4, gain: 0.3, ring: false, gen: { kind: 'grid', lo: 55, hi: 72, step: 1, pattern: 'x.x.', voices: 3, maxDur: 0.5 } },
    { id: 'wood', inst: 'woodblock', arr: 'score', layer: 5, gain: 0.3, gen: { kind: 'hits', step: 1, pattern: ['X...', '....'], note: 74 } },
    { id: 'hpMel', inst: 'harpsichord', arr: 'score', layer: 6, gain: 0.26, ring: false, part: 'mel' },
    { id: 'clar', inst: 'clarinet', arr: 'score', layer: 7, gain: 0.32, gen: { kind: 'line', lo: 55, hi: 70, every: 2, passing: true, vel: 0.55 } },
    // The stage: the organ, strings, horns, timpani and the tower bell.
    { id: 'ost', inst: 'organ', arr: 'stage', layer: 0, gain: 0.62, legato: 0.9, maxPoly: 6, gen: { kind: 'grid', lo: 50, hi: 77, step: 0.25, pattern: OST } },
    { id: 'pedal', inst: 'organ', arr: 'stage', layer: 0, gain: 0.42, gen: { kind: 'grid', lo: 26, hi: 45, step: 2, pattern: 'RR' } },
    { id: 'stick', inst: 'tick', arr: 'stage', layer: 0, gain: 0.2, gen: { kind: 'hits', step: 1, pattern: 'x.x.', note: 88 } },
    { id: 'stock', inst: 'tick', arr: 'stage', layer: 0, gain: 0.2, gen: { kind: 'hits', step: 1, pattern: '.x.x', note: 82 } },
    { id: 'vln', inst: 'strings', arr: 'stage', layer: 1, gain: 0.56, part: 'mel', attackSkip: 0.26, legato: 0.88 },
    { id: 'hornTheme', inst: 'horn', arr: 'stage', layer: 1, gain: 0.66, part: 'theme' },
    { id: 'vlnTheme', inst: 'strings', arr: 'stage', layer: 6, gain: 0.4, part: 'theme', oct: 1, attackSkip: 0.2, only: ['B2'] },
    { id: 'bass', inst: 'bass', arr: 'stage', layer: 2, gain: 0.45, legato: 0.9, gen: { kind: 'grid', lo: 26, hi: 45, step: 1, pattern: 'R.R.' } },
    { id: 'cello', inst: 'strings', arr: 'stage', layer: 3, gain: 0.36, gen: { kind: 'line', lo: 45, hi: 62, every: 2, passing: true, vel: 0.6 } },
    { id: 'spic', inst: 'strings', arr: 'stage', layer: 4, gain: 0.22, attackSkip: 0.32, legato: 0.6, maxPoly: 6, gen: { kind: 'grid', lo: 50, hi: 77, step: 0.25, pattern: OST } },
    {
      id: 'timp',
      inst: 'timpani',
      arr: 'stage',
      layer: 5,
      gain: 0.5,
      gen: { kind: 'hits', step: 1, pattern: ['x...', '....', 'x...', '....', 'x...', '....', 'x...', 'x.x.'], pitch: 'root', lo: 38, hi: 55 },
    },
    { id: 'bell', inst: 'bell', arr: 'stage', layer: 6, gain: 0.34, gen: { kind: 'hits', step: 1, pattern: ['x...', '....', '....', '....', '....', '....', '....', '....'], pitch: 'tonic', lo: 62, hi: 73 } },
    { id: 'horns', inst: 'horn', arr: 'stage', layer: 7, gain: 0.3, skip: ['B', 'B2'], gen: { kind: 'pad', lo: 50, hi: 69, voices: 3, vel: 0.6 } },
    { id: 'choir', inst: 'choirAh', arr: 'stage', layer: 7, gain: 0.32, only: ['B', 'B2'], gen: { kind: 'pad', lo: 55, hi: 72, voices: 3, vel: 0.55 } },
  ],
};
