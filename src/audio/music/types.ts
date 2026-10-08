// Songs as data: sections of roman-numeral harmony and degree-based melody, and an
// arrangement of tracks for each of the two worlds.

import type { SongId } from '../audio';
import type { InstId } from '../instruments';
import type { Chord, Key, ModeName } from './theory';

export type Arr = 'score' | 'stage';

export type AmbienceId = 'meadow' | 'lake' | 'village' | 'garden' | 'clock' | 'hall';

export interface SectionDef {
  bars: number;
  /** Bars separated by `|`; chords in a bar split it evenly unless given `:beats`. `-` holds, `%` repeats the bar. */
  chords: string;
  key?: { tonic: number; mode: ModeName };
  meter?: number;
  bpm?: number;
  /** Melodic parts in degree notation (see notation.ts), by name. */
  parts?: Record<string, string>;
}

/**
 * Accompaniment generators. Pitches are absolute MIDI ranges; harmony comes from the section.
 * - pad: sustained voice-led chords (common tones tie over).
 * - grid: one character per step: R bass, r root, 3 5 7 8 chord members near the bass,
 *   x block chord (X accented), a..h chord tones from the bottom of the range, A..H from the top,
 *   z a roll on the bass, `.` hold, `_` rest.
 * - roll: rolled (arpeggiated) chords on `x` steps, like a harp.
 * - line: a single voice-led counter line through guide tones, with passing notes.
 * - hits: percussion. x hit, X accent, o ghost, z roll, `.` nothing.
 */
export type GenSpec =
  | { kind: 'pad'; lo: number; hi: number; voices: number; vel?: number; rearticulate?: boolean }
  | {
      kind: 'grid';
      lo: number;
      hi: number;
      step: number;
      pattern: string | string[];
      voices?: number;
      vel?: number;
      maxDur?: number;
    }
  | {
      kind: 'roll';
      lo: number;
      hi: number;
      voices: number;
      step: number;
      pattern: string | string[];
      /** Beats between the notes of a roll. */
      spread: number;
      vel?: number;
      down?: boolean;
    }
  | { kind: 'line'; lo: number; hi: number; vel?: number; passing?: boolean; every?: number }
  | {
      kind: 'hits';
      step: number;
      pattern: string | string[];
      /** Fixed pitch, or follow the harmony. */
      note?: number;
      pitch?: 'root' | 'bass' | 'tonic' | 'fifth';
      lo?: number;
      hi?: number;
      vel?: number;
    };

export interface TrackDef {
  id: string;
  inst: InstId;
  arr: Arr;
  /** Notes found before this track plays (0 to 7). */
  layer: number;
  gain: number;
  pan?: number;
  /** Melodic part name, read from each section's `parts`. */
  part?: string;
  /** Octave shift for the part. */
  oct?: number;
  /** A generator, or generators by section name (`*` for the rest, null for silence). */
  gen?: GenSpec | Record<string, GenSpec | null>;
  only?: string[];
  skip?: string[];
  /** Timing looseness in seconds. */
  humanize?: number;
  velJitter?: number;
  /** Fraction of the written length that sounds (sustained instruments). */
  legato?: number;
  /** Plucked and struck notes ring on past their written length unless this is false. */
  ring?: boolean;
  /** Seconds to skip into a sustained sample's attack for a quicker start. */
  attackSkip?: number;
  release?: number;
  lowpass?: number;
  maxPoly?: number;
  /** Seconds this layer takes to fade in when restored. */
  fade?: number;
}

export interface SongDef {
  id: SongId;
  bpm: number;
  meter: number;
  key: { tonic: number; mode: ModeName };
  sections: Record<string, SectionDef>;
  /** Played once before the form. */
  intro?: string[];
  form: string[];
  loop: boolean;
  tracks: TrackDef[];
  /** Arrangement trims in dB, to level the two arrangements. */
  trim?: { score?: number; stage?: number };
  ambience?: AmbienceId;
  /** Always fully restored (title, ending). */
  full?: boolean;
}

export interface NoteEvent {
  /** Seconds from the start of the timeline. */
  t: number;
  dur: number;
  midi: number;
  vel: number;
  track: number;
}

export interface ChordSpan {
  t: number;
  dur: number;
  beat: number;
  chord: Chord;
  key: Key;
}

export interface TempoAnchor {
  t: number;
  beat: number;
  bpm: number;
}

export interface Timeline {
  events: NoteEvent[];
  chords: ChordSpan[];
  tempo: TempoAnchor[];
  /** Section starts, for layer entries. */
  sections: { t: number; name: string }[];
  duration: number;
  beats: number;
}

export interface CompiledSong {
  def: SongDef;
  intro: Timeline | null;
  body: Timeline;
  /** Pitches each instrument plays. */
  needs: Map<InstId, Set<number>>;
  warnings: string[];
}
