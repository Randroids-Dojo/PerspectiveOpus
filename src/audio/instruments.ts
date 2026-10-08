// The orchestra. Metadata shared by the renderer (worker) and the players (main thread).

export type InstId =
  | 'feltPiano'
  | 'grand'
  | 'musicbox'
  | 'celesta'
  | 'glock'
  | 'pizz'
  | 'harp'
  | 'harpsichord'
  | 'strings'
  | 'bass'
  | 'choir'
  | 'choirAh'
  | 'horn'
  | 'clarinet'
  | 'flute'
  | 'organ'
  | 'timpani'
  | 'bell'
  | 'triangle'
  | 'woodblock'
  | 'tick'
  | 'cymbal'
  | 'bassdrum'
  | 'tambourine';

export interface InstMeta {
  /** Sample rate the notes are rendered at. Dark instruments use less. */
  sr: number;
  /** Rendered pitch grid in semitones; other pitches are resampled from the nearest zone. */
  step: number;
  lo: number;
  hi: number;
  /** Bowed, blown or sung: the sample has a seamless sustain loop. */
  sustain: boolean;
  /** Seconds to fade when a note is released (or damped). */
  release: number;
  /** Mix level, so every instrument sits at about the same loudness at gain 1. */
  level: number;
  /** Seconds of attack baked into a sustained sample (lets fast notes skip into it). */
  attack?: number;
  /** Struck and plucked notes are damped this long after they start (or at their written end if later). */
  ring?: number;
}

export const INSTRUMENTS: Record<InstId, InstMeta> = {
  feltPiano: { sr: 32000, step: 3, lo: 28, hi: 96, sustain: false, release: 0.28, level: 0.9, ring: 1.8 },
  grand: { sr: 32000, step: 3, lo: 28, hi: 100, sustain: false, release: 0.3, level: 0.85, ring: 2.2 },
  musicbox: { sr: 32000, step: 4, lo: 60, hi: 108, sustain: false, release: 0.2, level: 0.62, ring: 2.2 },
  celesta: { sr: 32000, step: 4, lo: 60, hi: 108, sustain: false, release: 0.25, level: 0.7, ring: 1.8 },
  glock: { sr: 32000, step: 4, lo: 72, hi: 108, sustain: false, release: 0.3, level: 0.5, ring: 1.8 },
  pizz: { sr: 32000, step: 4, lo: 28, hi: 96, sustain: false, release: 0.12, level: 0.95, ring: 0.9 },
  harp: { sr: 32000, step: 3, lo: 28, hi: 100, sustain: false, release: 0.35, level: 0.85, ring: 2.0 },
  harpsichord: { sr: 32000, step: 3, lo: 29, hi: 91, sustain: false, release: 0.08, level: 0.6, ring: 1.2 },
  strings: { sr: 24000, step: 3, lo: 28, hi: 100, sustain: true, release: 0.55, level: 0.75, attack: 0.36 },
  bass: { sr: 22050, step: 4, lo: 24, hi: 60, sustain: true, release: 0.4, level: 0.95, attack: 0.16 },
  choir: { sr: 24000, step: 3, lo: 40, hi: 84, sustain: true, release: 0.7, level: 0.6, attack: 0.4 },
  choirAh: { sr: 24000, step: 3, lo: 40, hi: 84, sustain: true, release: 0.7, level: 0.6, attack: 0.36 },
  horn: { sr: 24000, step: 3, lo: 34, hi: 79, sustain: true, release: 0.3, level: 0.7, attack: 0.1 },
  clarinet: { sr: 32000, step: 2, lo: 50, hi: 94, sustain: true, release: 0.18, level: 0.62, attack: 0.08 },
  flute: { sr: 32000, step: 2, lo: 59, hi: 98, sustain: true, release: 0.2, level: 0.55, attack: 0.1 },
  organ: { sr: 32000, step: 3, lo: 24, hi: 96, sustain: true, release: 0.12, level: 0.5, attack: 0.05 },
  timpani: { sr: 24000, step: 2, lo: 38, hi: 57, sustain: false, release: 0.5, level: 1.0, ring: 2.4 },
  bell: { sr: 32000, step: 3, lo: 48, hi: 90, sustain: false, release: 0.8, level: 0.55, ring: 4.0 },
  triangle: { sr: 32000, step: 12, lo: 84, hi: 84, sustain: false, release: 0.4, level: 0.35, ring: 2.2 },
  woodblock: { sr: 32000, step: 2, lo: 70, hi: 86, sustain: false, release: 0.05, level: 0.45, ring: 0.3 },
  tick: { sr: 32000, step: 2, lo: 80, hi: 96, sustain: false, release: 0.03, level: 0.4, ring: 0.2 },
  cymbal: { sr: 32000, step: 12, lo: 72, hi: 72, sustain: false, release: 1.2, level: 0.35, ring: 3.4 },
  bassdrum: { sr: 22050, step: 12, lo: 36, hi: 36, sustain: false, release: 0.6, level: 0.9, ring: 2.0 },
  tambourine: { sr: 32000, step: 12, lo: 84, hi: 84, sustain: false, release: 0.1, level: 0.3, ring: 0.5 },
};

/** The rendered pitch that plays `midi` for this instrument. */
export function zoneOf(id: InstId, midi: number): number {
  const m = INSTRUMENTS[id];
  const c = Math.min(m.hi, Math.max(m.lo, Math.round(midi)));
  if (m.lo === m.hi) return m.lo;
  let z = m.step * Math.round(c / m.step);
  if (z > m.hi) z -= m.step;
  if (z < m.lo) z += m.step;
  return z;
}

export const sampleKey = (id: InstId, zone: number): string => `${id}:${zone}`;
