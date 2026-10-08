// Compiles a SongDef into timed note events: parses harmony and melody, runs the
// accompaniment generators with voice leading, applies phrasing and humanisation.

import { hashString, makeRng, type Rng } from '../dsp/util';
import type { InstId } from '../instruments';
import { parsePart, partLength } from './notation';
import { MODES, nearestPc, parseChord, pc, type Chord, type Key } from './theory';
import type { ChordSpan, CompiledSong, GenSpec, NoteEvent, SongDef, TempoAnchor, Timeline, TrackDef } from './types';

interface Span {
  beat: number;
  dur: number;
  chord: Chord;
}

interface GenNote {
  beat: number;
  dur: number;
  midi: number;
  vel: number;
}

interface VoiceState {
  voicing: number[] | null;
  bass: number | null;
  line: number | null;
}

const EPS = 1e-6;

// ------------------------------------------------------------------ harmony

function parseHarmony(src: string, bars: number, meter: number, key: Key, warn: (m: string) => void, where: string): Span[] {
  const barStrs = src
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (barStrs.length !== bars) warn(`${where}: ${barStrs.length} chord bars, expected ${bars}`);
  const spans: Span[] = [];
  let prevBar: { off: number; dur: number; sym: string }[] = [];
  for (let b = 0; b < bars; b++) {
    const str = barStrs[Math.min(b, barStrs.length - 1)] ?? 'I';
    let items: { off: number; dur: number; sym: string }[];
    if (str === '%') items = prevBar;
    else {
      const toks = str.split(/\s+/);
      const fixed = toks.reduce((s, t) => s + (t.includes(':') ? Number(t.split(':')[1]) : 0), 0);
      const free = toks.filter((t) => !t.includes(':')).length;
      const each = free ? (meter - fixed) / free : 0;
      items = [];
      let off = 0;
      for (const t of toks) {
        const [sym, d] = t.split(':');
        const dur = d ? Number(d) : each;
        items.push({ off, dur, sym });
        off += dur;
      }
      if (Math.abs(off - meter) > EPS) warn(`${where}: chord bar ${b + 1} sums to ${off}`);
    }
    prevBar = items;
    for (const it of items) {
      if (it.sym === '-' && spans.length) {
        spans[spans.length - 1].dur += it.dur;
        continue;
      }
      let chord: Chord;
      try {
        chord = parseChord(it.sym, key);
      } catch (e) {
        warn(`${where}: ${(e as Error).message}`);
        chord = parseChord('I', key);
      }
      spans.push({ beat: b * meter + it.off, dur: it.dur, chord });
    }
  }
  return spans;
}

function chordAt(spans: Span[], beat: number): Span {
  for (let i = spans.length - 1; i >= 0; i--) if (spans[i].beat <= beat + EPS) return spans[i];
  return spans[0];
}

/** Consecutive spans with the same chord merged (so pads hold). */
function merged(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && last.chord.symbol === s.chord.symbol) last.dur += s.dur;
    else out.push({ ...s });
  }
  return out;
}

// ------------------------------------------------------------------ voicing

/** Picks a voicing of `chord` in [lo, hi] that moves least from `prev`, with sensible spacing. */
export function voiceChord(chord: Chord, lo: number, hi: number, n: number, prev: number[] | null): number[] {
  const cand: number[] = [];
  for (let m = lo; m <= hi; m++) if (chord.pcs.includes(pc(m))) cand.push(m);
  if (cand.length === 0) return [];
  n = Math.min(n, cand.length);
  const root = chord.root;
  const third = chord.third !== null ? pc(root + chord.third) : -1;
  const seventh = chord.seventh !== null ? pc(root + chord.seventh) : -1;
  const fifth = chord.intervals.find((i) => i >= 6 && i <= 8);
  const fifthPc = fifth !== undefined ? pc(root + fifth) : -1;
  const center = (lo + hi) / 2;
  let best: number[] = cand.slice(0, n);
  let bestCost = Infinity;
  const pick: number[] = [];
  const consider = () => {
    const pcs = pick.map(pc);
    if (third >= 0 && !pcs.includes(third)) return;
    if (seventh >= 0 && n >= 3 && !pcs.includes(seventh)) return;
    let cost = 0;
    if (!pcs.includes(root)) cost += n >= 4 ? 2 : 1.2;
    if (fifthPc >= 0 && !pcs.includes(fifthPc)) cost += 0.5;
    const counts = new Map<number, number>();
    for (const p of pcs) counts.set(p, (counts.get(p) ?? 0) + 1);
    if ((counts.get(third) ?? 0) > 1) cost += 1.5;
    if ((counts.get(seventh) ?? 0) > 1) cost += 3;
    for (const [, c] of counts) if (c > 1) cost += 0.3;
    for (let i = 1; i < pick.length; i++) {
      const gap = pick[i] - pick[i - 1];
      if (gap > 12) cost += (gap - 12) * 0.6;
      if (gap < 3) cost += gap === 1 ? 2.5 : 1;
      if (pick[i - 1] < 52 && gap < 7) cost += 2;
    }
    // Any notes not in the chord's extensions? (9ths count as colour, fine.)
    const mean = pick.reduce((s, x) => s + x, 0) / pick.length;
    if (prev && prev.length === pick.length) {
      for (let i = 0; i < pick.length; i++) cost += Math.abs(pick[i] - prev[i]);
      // Parallel fifths and octaves between voice pairs.
      for (let i = 0; i < pick.length; i++)
        for (let j = i + 1; j < pick.length; j++) {
          const a = pc(prev[j] - prev[i]);
          const b = pc(pick[j] - pick[i]);
          if ((a === 7 || a === 0) && a === b && prev[i] !== pick[i] && Math.sign(pick[i] - prev[i]) === Math.sign(pick[j] - prev[j]))
            cost += 1.5;
        }
    } else if (prev && prev.length) {
      const pm = prev.reduce((s, x) => s + x, 0) / prev.length;
      cost += Math.abs(mean - pm) * 1.5;
    }
    cost += Math.abs(mean - center) * 0.18;
    if (cost < bestCost) {
      bestCost = cost;
      best = pick.slice();
    }
  };
  const rec = (start: number) => {
    if (pick.length === n) {
      consider();
      return;
    }
    for (let i = start; i <= cand.length - (n - pick.length); i++) {
      pick.push(cand[i]);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  return best;
}

function bassNote(target: number, lo: number, hi: number, prev: number | null): number {
  let best = lo;
  let bestCost = Infinity;
  for (let m = lo; m <= hi; m++) {
    if (pc(m) !== target) continue;
    const cost = (prev === null ? Math.abs(m - (lo + 5)) : Math.abs(m - prev)) + (m - lo) * 0.08;
    if (cost < bestCost) {
      bestCost = cost;
      best = m;
    }
  }
  return best;
}

function ladder(chord: Chord, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (chord.pcs.includes(pc(m))) out.push(m);
  return out;
}

// ------------------------------------------------------------------ generators

function accent(beatInBar: number, meter: number): number {
  if (beatInBar < EPS) return 1;
  if (meter === 4 && Math.abs(beatInBar - 2) < EPS) return 0.93;
  if (Math.abs(beatInBar - Math.round(beatInBar)) < EPS) return 0.87;
  return 0.8;
}

function patternFor(p: string | string[], bar: number, steps: number): string {
  const s = Array.isArray(p) ? p[bar % p.length] : p;
  const clean = s.replace(/\s+/g, '');
  let out = '';
  while (out.length < steps) out += clean;
  return out.slice(0, steps);
}

function genPad(spec: Extract<GenSpec, { kind: 'pad' }>, spans: Span[], st: VoiceState): GenNote[] {
  const out: GenNote[] = [];
  const list = spec.rearticulate ? spans : merged(spans);
  let active = new Map<number, GenNote>();
  for (const s of list) {
    const v = voiceChord(s.chord, spec.lo, spec.hi, spec.voices, st.voicing);
    if (v.length) st.voicing = v;
    const next = new Map<number, GenNote>();
    for (const m of v) {
      const held = active.get(m);
      if (held && !spec.rearticulate) {
        held.dur += s.dur;
        next.set(m, held);
      } else {
        const g: GenNote = { beat: s.beat, dur: s.dur, midi: m, vel: spec.vel ?? 0.7 };
        out.push(g);
        next.set(m, g);
      }
    }
    active = next;
  }
  return out;
}

function genGrid(spec: Extract<GenSpec, { kind: 'grid' }>, spans: Span[], meter: number, bars: number, st: VoiceState): GenNote[] {
  const out: GenNote[] = [];
  const steps = Math.round(meter / spec.step);
  let active: GenNote[] = [];
  const close = (beat: number) => {
    for (const n of active) n.dur = Math.max(0.05, beat - n.beat);
    active = [];
  };
  const baseVel = spec.vel ?? 0.7;
  let lastBassSpan: Span | null = null;
  for (let bar = 0; bar < bars; bar++) {
    const pat = patternFor(spec.pattern, bar, steps);
    for (let s = 0; s < steps; s++) {
      const ch = pat[s];
      const beat = bar * meter + s * spec.step;
      if (ch === '.') continue;
      close(beat);
      if (ch === '_') continue;
      const span = chordAt(spans, beat);
      const chord = span.chord;
      // A new chord since the last bass note: its bass comes first, whatever the pattern says.
      const fresh = lastBassSpan !== null && span.chord.symbol !== lastBassSpan.chord.symbol && (ch === '3' || ch === '5' || ch === '7' || ch === '8');
      const vel = baseVel * accent(s * spec.step, meter) * (ch === 'X' ? 1.2 : 1);
      const pitches: number[] = [];
      const bass = () => {
        const b = bassNote(chord.bass, spec.lo, spec.hi, st.bass);
        st.bass = b;
        return b;
      };
      const near = (iv: number, lean = 3) => {
        const b = st.bass ?? bassNote(chord.bass, spec.lo, spec.hi, null);
        let m = nearestPc(pc(chord.root + iv), b + lean);
        while (m > spec.hi) m -= 12;
        while (m < spec.lo) m += 12;
        return m;
      };
      if (ch === 'R' || ch === 'r' || fresh) lastBassSpan = span;
      if (ch === 'R' || fresh) pitches.push(bass());
      else if (ch === 'r') {
        const b = bassNote(chord.root, spec.lo, spec.hi, st.bass);
        st.bass = b;
        pitches.push(b);
      } else if (ch === '3') pitches.push(near(chord.third ?? 0));
      else if (ch === '5') pitches.push(near(chord.intervals.find((i) => i >= 6 && i <= 8) ?? 7, 0));
      else if (ch === '7') pitches.push(near(chord.seventh ?? 12));
      else if (ch === '8') {
        const b = st.bass ?? bass();
        pitches.push(b + 12 <= spec.hi ? b + 12 : b);
      } else if (ch === 'x' || ch === 'X') {
        const v = voiceChord(chord, spec.lo, spec.hi, spec.voices ?? 3, st.voicing);
        if (v.length) st.voicing = v;
        pitches.push(...v);
      } else if (ch >= 'a' && ch <= 'h') {
        const l = ladder(chord, spec.lo, spec.hi);
        if (l.length) pitches.push(l[Math.min(l.length - 1, ch.charCodeAt(0) - 97)]);
      } else if (ch >= 'A' && ch <= 'H') {
        const l = ladder(chord, spec.lo, spec.hi);
        if (l.length) pitches.push(l[Math.max(0, l.length - 1 - (ch.charCodeAt(0) - 65))]);
      } else if (ch === 'z') {
        const b = bass();
        const hits = Math.max(2, Math.round(spec.step * 6));
        for (let k = 0; k < hits; k++)
          out.push({ beat: beat + (k * spec.step) / hits, dur: spec.step / hits, midi: b, vel: baseVel * (0.35 + (0.45 * k) / hits) });
        continue;
      }
      for (const m of pitches) {
        const g: GenNote = { beat, dur: spec.step, midi: m, vel };
        out.push(g);
        active.push(g);
      }
    }
  }
  close(bars * meter);
  if (spec.maxDur) for (const n of out) n.dur = Math.min(n.dur, spec.maxDur);
  return out;
}

function genRoll(spec: Extract<GenSpec, { kind: 'roll' }>, spans: Span[], meter: number, bars: number, st: VoiceState): GenNote[] {
  const out: GenNote[] = [];
  const steps = Math.round(meter / spec.step);
  const onsets: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const pat = patternFor(spec.pattern, bar, steps);
    for (let s = 0; s < steps; s++) if (pat[s] === 'x' || pat[s] === 'X') onsets.push(bar * meter + s * spec.step);
  }
  for (let i = 0; i < onsets.length; i++) {
    const beat = onsets[i];
    const end = i + 1 < onsets.length ? onsets[i + 1] : bars * meter;
    const v = voiceChord(chordAt(spans, beat).chord, spec.lo, spec.hi, spec.voices, st.voicing);
    if (v.length) st.voicing = v;
    const order = spec.down ? [...v].reverse() : v;
    order.forEach((m, k) => {
      const b = beat + k * spec.spread;
      out.push({ beat: b, dur: Math.max(0.1, end - b), midi: m, vel: (spec.vel ?? 0.7) * accent(beat % meter, meter) * (0.9 + (0.1 * k) / order.length) });
    });
  }
  return out;
}

function genLine(spec: Extract<GenSpec, { kind: 'line' }>, spans: Span[], key: Key, st: VoiceState): GenNote[] {
  // Split long chords so the line keeps moving.
  const list: Span[] = [];
  for (const s of merged(spans)) {
    const every = spec.every ?? 4;
    let b = s.beat;
    while (b < s.beat + s.dur - EPS) {
      const d = Math.min(every, s.beat + s.dur - b);
      list.push({ beat: b, dur: d, chord: s.chord });
      b += d;
    }
  }
  const out: GenNote[] = [];
  for (const s of list) {
    const c = s.chord;
    let best = -1;
    let bestCost = Infinity;
    for (let m = spec.lo; m <= spec.hi; m++) {
      const iv = pc(m - c.root);
      if (!c.pcs.includes(pc(m))) continue;
      const role = iv === c.third ? 0 : iv === c.seventh ? 0.3 : iv === 0 ? 2.2 : 1.6;
      const prev = st.line;
      const move = (prev === null ? Math.abs(m - (spec.lo + spec.hi) / 2) : Math.abs(m - prev)) * 0.6;
      const cost = role + move + (prev !== null && m === prev ? 2.5 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = m;
      }
    }
    if (best < 0) continue;
    st.line = best;
    out.push({ beat: s.beat, dur: s.dur, midi: best, vel: spec.vel ?? 0.7 });
  }
  if (spec.passing) {
    const scale = MODES[key.mode].map((x) => pc(key.tonic + x));
    const extra: GenNote[] = [];
    for (let i = 0; i + 1 < out.length; i++) {
      const a = out[i];
      const b = out[i + 1];
      const d = b.midi - a.midi;
      if (a.dur < 2 - EPS || Math.abs(d) < 3 || Math.abs(d) > 4) continue;
      // The scale step between them.
      const dir = Math.sign(d);
      let m = a.midi + dir;
      while (!scale.includes(pc(m)) && m !== b.midi) m += dir;
      if (m === b.midi) continue;
      a.dur -= 1;
      extra.push({ beat: a.beat + a.dur, dur: 1, midi: m, vel: a.vel * 0.9 });
    }
    out.push(...extra);
  }
  return out;
}

function genHits(spec: Extract<GenSpec, { kind: 'hits' }>, spans: Span[], meter: number, bars: number, key: Key): GenNote[] {
  const out: GenNote[] = [];
  const steps = Math.round(meter / spec.step);
  const lo = spec.lo ?? 0;
  const hi = spec.hi ?? 127;
  const pitchAt = (beat: number) => {
    if (spec.note !== undefined) return spec.note;
    const c = chordAt(spans, beat).chord;
    const target =
      spec.pitch === 'bass' ? c.bass : spec.pitch === 'tonic' ? pc(key.tonic) : spec.pitch === 'fifth' ? pc(c.root + 7) : c.root;
    return bassNote(target, lo, hi, null);
  };
  const vel = spec.vel ?? 0.7;
  for (let bar = 0; bar < bars; bar++) {
    const pat = patternFor(spec.pattern, bar, steps);
    for (let s = 0; s < steps; s++) {
      const ch = pat[s];
      const beat = bar * meter + s * spec.step;
      if (ch === 'x' || ch === 'X' || ch === 'o') {
        const v = ch === 'X' ? 1 : ch === 'x' ? 0.78 : 0.45;
        out.push({ beat, dur: spec.step, midi: pitchAt(beat), vel: vel * v });
      } else if (ch === 'z') {
        const hits = Math.max(2, Math.round(spec.step * 7));
        for (let k = 0; k < hits; k++)
          out.push({ beat: beat + (k * spec.step) / hits, dur: spec.step / hits, midi: pitchAt(beat), vel: vel * (0.3 + (0.5 * k) / hits) });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ compile

function genFor(t: TrackDef, section: string): GenSpec | null {
  const g = t.gen;
  if (!g) return null;
  if ('kind' in g) return g as GenSpec;
  const map = g as Record<string, GenSpec | null>;
  if (section in map) return map[section];
  return map['*'] ?? null;
}

function plays(t: TrackDef, section: string): boolean {
  if (t.only && !t.only.includes(section)) return false;
  if (t.skip && t.skip.includes(section)) return false;
  return true;
}

function compileSequence(
  def: SongDef,
  names: string[],
  states: VoiceState[],
  rng: Rng,
  warn: (m: string) => void,
): Timeline {
  const events: NoteEvent[] = [];
  const chords: ChordSpan[] = [];
  const tempo: TempoAnchor[] = [];
  const sections: { t: number; name: string }[] = [];
  let t = 0;
  let beat = 0;
  for (const name of names) {
    const sec = def.sections[name];
    if (!sec) {
      warn(`${def.id}: missing section ${name}`);
      continue;
    }
    const key: Key = sec.key ?? def.key;
    const meter = sec.meter ?? def.meter;
    const bpm = sec.bpm ?? def.bpm;
    const spb = 60 / bpm;
    const where = `${def.id}/${name}`;
    tempo.push({ t, beat, bpm });
    sections.push({ t, name });
    const spans = parseHarmony(sec.chords, sec.bars, meter, key, warn, where);
    for (const s of spans) chords.push({ t: t + s.beat * spb, dur: s.dur * spb, beat: beat + s.beat, chord: s.chord, key });
    const len = sec.bars * meter;
    def.tracks.forEach((track, ti) => {
      if (!plays(track, name)) return;
      let notes: GenNote[] = [];
      if (track.part) {
        const src = sec.parts?.[track.part];
        if (src) {
          const parsed = parsePart(src, key, meter, warn, `${where}/${track.part}`);
          const pl = partLength(parsed);
          if (pl > len + EPS) warn(`${where}/${track.part}: part is ${pl} beats, section is ${len}`);
          const shift = (track.oct ?? 0) * 12;
          let lo = Infinity;
          let hi = -Infinity;
          for (const n of parsed) for (const m of n.midis) (lo = Math.min(lo, m)), (hi = Math.max(hi, m));
          for (const n of parsed) {
            const shape = 0.92 + 0.12 * ((n.midis[0] - lo) / Math.max(1, hi - lo));
            const down = accent(n.beat % meter, meter) > 0.99 ? 1.04 : 1;
            for (const m of n.midis)
              notes.push({ beat: n.beat, dur: n.short ? Math.min(n.dur, 0.3) : n.dur, midi: m + shift, vel: n.vel * shape * down });
          }
        }
      }
      const spec = genFor(track, name);
      if (spec) {
        const st = states[ti];
        if (spec.kind === 'pad') notes = notes.concat(genPad(spec, spans, st));
        else if (spec.kind === 'grid') notes = notes.concat(genGrid(spec, spans, meter, sec.bars, st));
        else if (spec.kind === 'roll') notes = notes.concat(genRoll(spec, spans, meter, sec.bars, st));
        else if (spec.kind === 'line') notes = notes.concat(genLine(spec, spans, key, st));
        else notes = notes.concat(genHits(spec, spans, meter, sec.bars, key));
      }
      const hum = track.humanize ?? 0.008;
      const vj = track.velJitter ?? 0.06;
      for (const n of notes) {
        const dt = (rng() * 2 - 1) * hum;
        events.push({
          t: Math.max(0, t + n.beat * spb + dt),
          dur: n.dur * spb * (track.legato ?? 1),
          midi: Math.round(n.midi),
          vel: Math.min(1.2, n.vel * (1 + (rng() * 2 - 1) * vj)),
          track: ti,
        });
      }
    });
    t += len * spb;
    beat += len;
  }
  events.sort((a, b) => a.t - b.t);
  return { events, chords, tempo, sections, duration: t, beats: beat };
}

const cache = new Map<string, CompiledSong>();

export function compileSong(def: SongDef): CompiledSong {
  const hit = cache.get(def.id);
  if (hit && hit.def === def) return hit;
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const fresh = () => def.tracks.map((): VoiceState => ({ voicing: null, bass: null, line: null }));
  let intro: Timeline | null = null;
  if (def.intro?.length) intro = compileSequence(def, def.intro, fresh(), makeRng(hashString(def.id + ':intro')), warn);
  // Run the form once to settle the voice leading, then again from where it ended,
  // so the loop seam joins the way every other bar does.
  const states = fresh();
  if (def.loop) compileSequence(def, def.form, states, makeRng(1), () => {});
  const body = compileSequence(def, def.form, states, makeRng(hashString(def.id)), warn);
  const needs = new Map<InstId, Set<number>>();
  for (const tl of [intro, body]) {
    if (!tl) continue;
    for (const e of tl.events) {
      const inst = def.tracks[e.track].inst;
      let s = needs.get(inst);
      if (!s) needs.set(inst, (s = new Set()));
      s.add(e.midi);
    }
  }
  const out = { def, intro, body, needs, warnings };
  cache.set(def.id, out);
  return out;
}

/** The harmony sounding at `t` seconds into a timeline. */
export function spanAt(tl: Timeline, t: number): ChordSpan | null {
  const c = tl.chords;
  if (!c.length) return null;
  let lo = 0;
  let hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return c[lo];
}

/** Beat position at `t` seconds into a timeline. */
export function beatAt(tl: Timeline, t: number): number {
  const a = tl.tempo;
  let k = 0;
  while (k + 1 < a.length && a[k + 1].t <= t) k++;
  const an = a[k];
  return an ? an.beat + ((t - an.t) * an.bpm) / 60 : 0;
}
