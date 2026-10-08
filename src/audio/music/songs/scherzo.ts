import type { SongDef } from '../types';
import { THEME_WALTZ, THEME_WALTZ_CHORDS } from './theme';

// III. Scherzo. B flat major, 3/4, one beat in a bar. A skipping village tune
// with a cheeky chromatic neighbour (C B-natural C), oom-pah-pah underneath.
// The trio turns the Opus theme into a Landler in E flat. Form: A B A2 (48 bars).

const SKIP = "5,q* 1q* 3q* | 5q. 4e 3q* | 2q #1q 2q* | 3q* 1q* 5,q* | 6,q* 1q* 4q* | 3q. 2e 1q* | 2q* 4q* 6q* | 5h r q | 5,q* 1q* 3q* | 5q. 6e 5q* | 4q 3q 2q* | 1q* 3q* 5q* | 1'q. 7e 6q* | #4q 5q 6q* | 4q 2q 7,q* | 1h";
const CHORDS = 'I | I | V7 | I | IV | I | ii | V | I | I | V7 | I | IV | II7 | V7 | I';

export const scherzo: SongDef = {
  id: 'scherzo',
  bpm: 144,
  meter: 3,
  key: { tonic: 70, mode: 'major' },
  ambience: 'village',
  sections: {
    A: { bars: 16, chords: CHORDS, parts: { mel: SKIP + ' 1,q' } },
    B: {
      bars: 16,
      key: { tonic: 63, mode: 'major' },
      chords: THEME_WALTZ_CHORDS.replace(/I$/, 'II7'),
      parts: { trio: THEME_WALTZ },
    },
    A2: { bars: 16, chords: CHORDS, parts: { mel: SKIP + ' r q' } },
  },
  form: ['A', 'B', 'A2'],
  trim: { score: -2.8, stage: -4.5 },
  loop: true,
  tracks: [
    // The score: pizzicato and felt piano oom-pah-pah, a music box tune.
    { id: 'oom', inst: 'pizz', arr: 'score', layer: 0, gain: 0.6, gen: { kind: 'grid', lo: 34, hi: 53, step: 1, pattern: ['R..', '5..'] } },
    { id: 'pah', inst: 'feltPiano', arr: 'score', layer: 0, gain: 0.3, ring: false, release: 0.15, maxPoly: 6, gen: { kind: 'grid', lo: 55, hi: 72, step: 1, pattern: '.xx', voices: 3, maxDur: 0.6 } },
    { id: 'mel', inst: 'musicbox', arr: 'score', layer: 1, gain: 0.8, part: 'mel' },
    { id: 'trio', inst: 'clarinet', arr: 'score', layer: 1, gain: 0.66, part: 'trio', humanize: 0.012 },
    { id: 'ctr', inst: 'celesta', arr: 'score', layer: 3, gain: 0.36, gen: { kind: 'line', lo: 67, hi: 84, every: 3, vel: 0.6 } },
    { id: 'wood', inst: 'woodblock', arr: 'score', layer: 5, gain: 0.3, skip: ['B'], gen: { kind: 'hits', step: 1, pattern: 'x.o', note: 79 } },
    { id: 'tri', inst: 'triangle', arr: 'score', layer: 5, gain: 0.26, gen: { kind: 'hits', step: 1, pattern: ['x..', '...', '...', '...'], note: 84 } },
    { id: 'hi', inst: 'pizz', arr: 'score', layer: 6, gain: 0.3, gen: { kind: 'grid', lo: 62, hi: 79, step: 1, pattern: '.x.', voices: 2 } },
    { id: 'clar', inst: 'clarinet', arr: 'score', layer: 7, gain: 0.34, skip: ['B'], gen: { kind: 'line', lo: 55, hi: 70, every: 3, passing: true, vel: 0.55 } },
    // The stage: string pizzicato, violins, horns for the trio, timpani and triangle.
    { id: 'soom', inst: 'pizz', arr: 'stage', layer: 0, gain: 0.7, gen: { kind: 'grid', lo: 34, hi: 53, step: 1, pattern: ['R..', '5..'] } },
    { id: 'spah', inst: 'pizz', arr: 'stage', layer: 0, gain: 0.45, gen: { kind: 'grid', lo: 55, hi: 74, step: 1, pattern: '.xx', voices: 3 } },
    { id: 'vln', inst: 'strings', arr: 'stage', layer: 1, gain: 0.55, part: 'mel', attackSkip: 0.26, legato: 0.85 },
    { id: 'hornTrio', inst: 'horn', arr: 'stage', layer: 1, gain: 0.66, part: 'trio' },
    { id: 'pad', inst: 'strings', arr: 'stage', layer: 2, gain: 0.3, gen: { kind: 'pad', lo: 55, hi: 74, voices: 3, vel: 0.55 } },
    { id: 'line', inst: 'strings', arr: 'stage', layer: 3, gain: 0.36, gen: { kind: 'line', lo: 45, hi: 62, every: 3, passing: true, vel: 0.6 } },
    { id: 'bass', inst: 'bass', arr: 'stage', layer: 4, gain: 0.42, legato: 0.8, gen: { kind: 'grid', lo: 29, hi: 46, step: 1, pattern: 'R..' } },
    { id: 'timp', inst: 'timpani', arr: 'stage', layer: 5, gain: 0.45, gen: { kind: 'hits', step: 1, pattern: ['x..', '...'], pitch: 'root', lo: 38, hi: 53 } },
    { id: 'stri', inst: 'triangle', arr: 'stage', layer: 5, gain: 0.24, gen: { kind: 'hits', step: 1, pattern: ['x..', '...', '...', '...'], note: 84 } },
    { id: 'flute', inst: 'flute', arr: 'stage', layer: 6, gain: 0.34, part: 'mel', oct: 1, only: ['A2'] },
    { id: 'flTrio', inst: 'flute', arr: 'stage', layer: 6, gain: 0.3, part: 'trio', oct: 1 },
    { id: 'glock', inst: 'glock', arr: 'stage', layer: 6, gain: 0.2, part: 'mel', oct: 1, only: ['A2'] },
    { id: 'horns', inst: 'horn', arr: 'stage', layer: 7, gain: 0.3, legato: 0.6, skip: ['B'], gen: { kind: 'grid', lo: 53, hi: 70, step: 1, pattern: '.xx', voices: 3 } },
    { id: 'tamb', inst: 'tambourine', arr: 'stage', layer: 7, gain: 0.22, only: ['A2'], gen: { kind: 'hits', step: 1, pattern: 'xoo', note: 84 } },
  ],
};
