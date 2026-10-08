// Keys, scale degrees and roman-numeral chords.

export type ModeName = 'major' | 'minor' | 'dorian' | 'lydian' | 'mixolydian' | 'harmonic';

export const MODES: Record<ModeName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};

export interface Key {
  /** MIDI pitch of scale degree 1 in the reference octave. */
  tonic: number;
  mode: ModeName;
}

export const pc = (m: number): number => ((m % 12) + 12) % 12;

const DEG = /^([#b]*)([1-7])([',]*)$/;

/** Semitones above the tonic for a degree token such as `3`, `b7,`, `#4'`. */
export function degreeSemis(key: Key, token: string): number {
  const m = DEG.exec(token);
  if (!m) throw new Error(`bad degree "${token}"`);
  let s = MODES[key.mode][Number(m[2]) - 1];
  for (const ch of m[1]) s += ch === '#' ? 1 : -1;
  for (const ch of m[3]) s += ch === "'" ? 12 : -12;
  return s;
}

export const degreeMidi = (key: Key, token: string): number => key.tonic + degreeSemis(key, token);

export interface Chord {
  symbol: string;
  /** Root pitch class. */
  root: number;
  /** Intervals above the root, ascending (0 first). */
  intervals: number[];
  /** Pitch classes of the chord tones. */
  pcs: number[];
  /** Bass pitch class (the root unless inverted or over a pedal). */
  bass: number;
  /** Interval of the third (or the suspension that replaces it). */
  third: number | null;
  seventh: number | null;
}

const NUMERALS = ['VII', 'VI', 'IV', 'V', 'III', 'II', 'I'];
const NUM_VALUE: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
const SUFFIXES = ['maj9', 'maj7', 'add9', 'sus4', 'sus2', 'm7', '7', '6', '9'];

/**
 * Parses a roman numeral in a key. Case gives the quality (upper major, lower minor),
 * then optional `o` (diminished), `+` (augmented) or `h` (half-diminished seventh),
 * then extensions (`7`, `maj7`, `6`, `9`, `sus4`, `sus2`, `add9`), then an
 * inversion (`/3`, `/5`, `/7`) or a pedal bass on a scale degree (`@5`, `@b7`).
 * Accidentals before the numeral move the root: `bVI`, `#iv`.
 */
export function parseChord(sym: string, key: Key): Chord {
  let s = sym;
  let acc = 0;
  while (s[0] === 'b' || s[0] === '#') {
    acc += s[0] === '#' ? 1 : -1;
    s = s.slice(1);
  }
  const upper = s.toUpperCase();
  const num = NUMERALS.find((n) => upper.startsWith(n));
  if (!num) throw new Error(`bad chord "${sym}"`);
  const isUpper = s.slice(0, num.length) === num;
  s = s.slice(num.length);
  let intervals = isUpper ? [0, 4, 7] : [0, 3, 7];
  let dim = false;
  if (s[0] === 'o') {
    intervals = [0, 3, 6];
    dim = true;
    s = s.slice(1);
  } else if (s[0] === '+') {
    intervals = [0, 4, 8];
    s = s.slice(1);
  } else if (s[0] === 'h') {
    intervals = [0, 3, 6, 10];
    s = s.slice(1);
  }
  let bassSpec = '';
  const slash = s.search(/[/@]/);
  if (slash >= 0) {
    bassSpec = s.slice(slash);
    s = s.slice(0, slash);
  }
  while (s.length) {
    const suf = SUFFIXES.find((x) => s.startsWith(x));
    if (!suf) throw new Error(`bad chord suffix "${sym}"`);
    s = s.slice(suf.length);
    const third = intervals[1];
    switch (suf) {
      case '7':
        intervals.push(dim ? 9 : 10);
        break;
      case 'm7':
        intervals.push(10);
        break;
      case 'maj7':
        intervals.push(11);
        break;
      case '6':
        intervals.push(9);
        break;
      case '9':
        if (!intervals.some((i) => i >= 10)) intervals.push(10);
        intervals.push(14);
        break;
      case 'maj9':
        intervals.push(11, 14);
        break;
      case 'add9':
        intervals.push(14);
        break;
      case 'sus4':
        intervals = intervals.map((i) => (i === third ? 5 : i));
        break;
      case 'sus2':
        intervals = intervals.map((i) => (i === third ? 2 : i));
        break;
    }
  }
  intervals = [...new Set(intervals)].sort((a, b) => a - b);
  const root = pc(key.tonic + MODES[key.mode][NUM_VALUE[num] - 1] + acc);
  const thirdIv = intervals.find((i) => i >= 2 && i <= 5) ?? null;
  const seventh = intervals.find((i) => i === 9 || i === 10 || i === 11) ?? null;
  let bass = root;
  if (bassSpec.startsWith('/')) {
    const which = bassSpec.slice(1);
    const fifth = intervals.find((i) => i >= 6 && i <= 8) ?? 7;
    const iv = which === '3' ? thirdIv ?? 0 : which === '5' ? fifth : which === '7' ? seventh ?? 0 : 0;
    bass = pc(root + iv);
  } else if (bassSpec.startsWith('@')) {
    bass = pc(key.tonic + degreeSemis(key, bassSpec.slice(1)));
  }
  return {
    symbol: sym,
    root,
    intervals,
    pcs: intervals.map((i) => pc(root + i)),
    bass,
    third: thirdIv,
    seventh,
  };
}

/** The scale of a key as pitch classes. */
export const scalePcs = (key: Key): number[] => MODES[key.mode].map((s) => pc(key.tonic + s));

/** Nearest pitch with pitch class `p` to `near` (ties go down). */
export function nearestPc(p: number, near: number): number {
  const d = pc(p - near);
  return d <= 6 ? near + d : near + d - 12;
}
