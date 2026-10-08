// Melody notation in scale degrees, so a tune can be set in any key or mode.
//
//   3q. 2e 1q 5,q | 6h 5q 3 |
//
// Degrees 1 to 7 with accidentals before (`#4`, `b7`) and octave marks after
// (`'` up, `,` down). Durations: w h q e s, t (triplet eighth), x (triplet
// sixteenth), a dot for dotted, or `:1.5` in beats. A note without a duration
// keeps the previous one. `r` is a rest, `-` ties onto the previous note,
// `[1 3 5]q` is a chord. Suffix `>` accents, `*` plays short. `!p`, `!mf`, `!f`
// (or `!0.7`) set the dynamic. Bar lines `|` are checked against the meter.

import { degreeMidi, type Key } from './theory';

export interface PartNote {
  beat: number;
  dur: number;
  midis: number[];
  vel: number;
  short: boolean;
}

const DURS: Record<string, number> = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 1 / 3, x: 1 / 6 };
const DYN: Record<string, number> = { pp: 0.42, p: 0.54, mp: 0.66, mf: 0.78, f: 0.9, ff: 1 };
const TOKEN = /^(\[[^\]]*\]|r|-|[#b]*[1-7][',]*)([whqestx]?)(\.?)(?::([\d.]+))?([>*]*)$/;

export function parsePart(src: string, key: Key, meter: number, warn: (m: string) => void, where: string): PartNote[] {
  const notes: PartNote[] = [];
  // `r q` (a rest and its length written apart) reads as `rq`.
  const text = src.replace(/(^|\s)r\s+([whqestx]\.?)(?=\s|\||$)/g, '$1r$2');
  const tokens = text.match(/\[[^\]]*\][^\s|]*|\||[^\s|]+/g) ?? [];
  let beat = 0;
  let dur = 1;
  let vel = DYN.mf;
  let bar = 1;
  let barStart = 0;
  for (const tok of tokens) {
    if (tok === '|') {
      if (Math.abs(beat - barStart - meter) > 1e-6)
        warn(`${where}: bar ${bar} has ${+(beat - barStart).toFixed(3)} beats, expected ${meter}`);
      bar++;
      barStart = beat;
      continue;
    }
    if (tok[0] === '!') {
      const v = tok.slice(1);
      vel = DYN[v] ?? Number(v);
      if (!Number.isFinite(vel)) warn(`${where}: bad dynamic ${tok}`);
      continue;
    }
    const m = TOKEN.exec(tok);
    if (!m) {
      warn(`${where}: bad token "${tok}"`);
      continue;
    }
    const [, head, letter, dot, beats, flags] = m;
    if (beats) dur = Number(beats);
    else if (letter) dur = DURS[letter];
    if (dot && !beats) dur *= 1.5;
    if (head === 'r') {
      beat += dur;
      continue;
    }
    if (head === '-') {
      const last = notes[notes.length - 1];
      if (last) last.dur += dur;
      beat += dur;
      continue;
    }
    const degs = head[0] === '[' ? head.slice(1, -1).trim().split(/\s+/) : [head];
    const accent = flags.includes('>');
    notes.push({
      beat,
      dur,
      midis: degs.map((d) => degreeMidi(key, d)),
      vel: vel * (accent ? 1.15 : 1),
      short: flags.includes('*'),
    });
    beat += dur;
  }
  return notes;
}

/** Length in beats of a part (for checks). */
export function partLength(notes: PartNote[]): number {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.beat + n.dur);
  return end;
}
