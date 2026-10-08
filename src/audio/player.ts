// Plays a compiled song: both arrangements on one clock, each track behind its own
// channel strip, layers fading in as notes are restored, the loop seamless.

import { PRIO, type SampleBank } from './bank';
import { INSTRUMENTS, type InstId } from './instruments';
import type { Mixer } from './mixer';
import { beatAt, spanAt } from './music/arranger';
import type { Arr, ChordSpan, CompiledSong, NoteEvent, Timeline, TrackDef } from './music/types';
import type { Voice, VoicePool } from './voices';

/** Default stereo seats, so the stage sounds like an orchestra and the page like a small room. */
const SEATS: Record<Arr, Partial<Record<InstId, number>>> = {
  stage: {
    strings: -0.18,
    harp: -0.38,
    horn: 0.32,
    flute: 0.2,
    clarinet: 0.12,
    bass: 0.22,
    timpani: 0.08,
    glock: -0.25,
    celesta: -0.2,
    choir: 0,
    choirAh: 0,
    pizz: -0.1,
    organ: 0,
    bell: 0.15,
    triangle: 0.3,
    cymbal: 0.1,
    tick: 0.1,
    tambourine: 0.25,
  },
  score: {
    feltPiano: -0.05,
    musicbox: 0.12,
    clarinet: -0.14,
    pizz: 0.16,
    celesta: 0.1,
    harpsichord: -0.06,
    triangle: 0.2,
    woodblock: 0.15,
    tick: 0.08,
  },
};

interface Strip {
  def: TrackDef;
  gain: GainNode;
  nodes: AudioNode[];
  input: AudioNode;
  on: boolean;
  level: number;
  voices: Voice[];
}

interface Cursor {
  intro: boolean;
  idx: number;
  loop: number;
}

export class SongPlayer {
  readonly arrGain: Record<Arr, GainNode>;
  private strips: Strip[];
  private cursor: Cursor;
  private level = 0;
  private stopAt = Infinity;
  /** Arrangements that can be heard. Short notes of a silent one are held back, then replayed on a switch. */
  private audible: Record<Arr, boolean> = { score: true, stage: true };
  private held: { ev: NoteEvent; when: number }[] = [];
  ended = false;
  /** Notes skipped because their sample was not ready yet. */
  missing = 0;
  scheduled = 0;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly song: CompiledSong,
    private bank: SampleBank,
    private pool: VoicePool,
    mixer: Mixer,
    /** Context time of the first beat. */
    readonly t0: number,
    restored: number,
    fadeIn = 0.4,
  ) {
    const def = song.def;
    this.level = def.full ? 7 : restored;
    this.cursor = { intro: !!song.intro, idx: 0, loop: 0 };
    const trimDb = (arr: Arr) => (arr === 'score' ? def.trim?.score : def.trim?.stage) ?? 0;
    this.arrGain = {
      score: ctx.createGain(),
      stage: ctx.createGain(),
    };
    for (const arr of ['score', 'stage'] as const) {
      const g = this.arrGain[arr];
      const target = Math.pow(10, trimDb(arr) / 20);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.setTargetAtTime(target, Math.max(ctx.currentTime, t0 - 0.05), fadeIn / 3);
      g.connect(mixer.music[arr].input);
    }
    this.strips = def.tracks.map((t) => {
      const on = t.layer <= this.level;
      const level = t.gain * INSTRUMENTS[t.inst].level;
      const gain = ctx.createGain();
      gain.gain.value = on ? level : 0;
      const nodes: AudioNode[] = [gain];
      let last: AudioNode = gain;
      if (t.lowpass) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = t.lowpass;
        f.Q.value = 0.6;
        last.connect(f);
        last = f;
        nodes.push(f);
      }
      const panv = t.pan ?? SEATS[t.arr][t.inst] ?? 0;
      if (panv !== 0 && typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        p.pan.value = panv;
        last.connect(p);
        last = p;
        nodes.push(p);
      }
      last.connect(this.arrGain[t.arr]);
      return { def: t, gain, nodes, input: gain, on, level, voices: [] };
    });
  }

  get nodeCount(): number {
    return 2 + this.strips.reduce((n, s) => n + s.nodes.length, 0);
  }

  get introDuration(): number {
    return this.song.intro?.duration ?? 0;
  }

  /**
   * Tells the player which arrangements can be heard. While one is fully faded out
   * its short notes (plucks, percussion) are not created, which roughly halves the
   * voices; long notes still play so a switch always fades into a full texture.
   * When an arrangement becomes audible, the held-back notes inside the look-ahead
   * window are played at once, so nothing is missing as it fades in.
   */
  setAudible(arr: Arr, on: boolean): void {
    if (this.audible[arr] === on) return;
    this.audible[arr] = on;
    if (!on) return;
    const now = this.ctx.currentTime;
    const keep: { ev: NoteEvent; when: number }[] = [];
    for (const h of this.held) {
      if (this.song.def.tracks[h.ev.track].arr !== arr) keep.push(h);
      else if (h.when > now + 0.005) this.play(h.ev, h.when, now);
    }
    this.held = keep;
  }

  /** Sets how many notes are restored (0 to 7); layers fade in and out. */
  setRestored(level: number, at = this.ctx.currentTime): void {
    if (this.song.def.full) return;
    this.level = level;
    for (const s of this.strips) {
      const on = s.def.layer <= level;
      if (on === s.on) continue;
      s.on = on;
      const g = s.gain.gain;
      g.cancelScheduledValues(at);
      g.setValueAtTime(g.value, at);
      if (on) g.setTargetAtTime(s.level, at, (s.def.fade ?? 2.4) / 3);
      else g.setTargetAtTime(0, at, 0.5);
    }
  }

  get restored(): number {
    return this.level;
  }

  /** Schedules every note that starts before `until` (context time). */
  schedule(until: number): void {
    const song = this.song;
    const now = this.ctx.currentTime;
    for (let guard = 0; guard < 4000; guard++) {
      if (this.ended) return;
      const tl = this.cursor.intro ? song.intro! : song.body;
      if (this.cursor.idx >= tl.events.length) {
        if (this.cursor.intro) {
          this.cursor = { intro: false, idx: 0, loop: 0 };
          continue;
        }
        if (song.def.loop) {
          this.cursor.loop++;
          this.cursor.idx = 0;
          continue;
        }
        this.ended = true;
        return;
      }
      const ev = tl.events[this.cursor.idx];
      const when = this.base(this.cursor) + ev.t;
      if (when >= until || when >= this.stopAt) return;
      this.cursor.idx++;
      this.play(ev, when, now);
    }
  }

  /** Skips ahead so scheduling starts `seconds` into the timeline (for tests of the loop seam). */
  seek(seconds: number): void {
    const intro = this.song.intro;
    let t = seconds;
    if (intro && t < intro.duration) {
      this.cursor = { intro: true, idx: intro.events.findIndex((e) => e.t >= t), loop: 0 };
      if (this.cursor.idx < 0) this.cursor.idx = intro.events.length;
      return;
    }
    t -= intro?.duration ?? 0;
    const body = this.song.body;
    const loop = this.song.def.loop ? Math.floor(t / body.duration) : 0;
    t -= loop * body.duration;
    let idx = body.events.findIndex((e) => e.t >= t);
    if (idx < 0) idx = body.events.length;
    this.cursor = { intro: false, idx, loop };
  }

  private base(c: Cursor): number {
    if (c.intro) return this.t0;
    return this.t0 + this.introDuration + c.loop * this.song.body.duration;
  }

  private play(ev: NoteEvent, when: number, now: number): void {
    const strip = this.strips[ev.track];
    if (!strip.on) return;
    const t = strip.def;
    const meta = INSTRUMENTS[t.inst];
    if (!this.audible[t.arr] && !meta.sustain && ev.dur < 2.5) {
      this.held = this.held.filter((h) => h.when > now);
      this.held.push({ ev, when });
      return;
    }
    let dur = ev.dur;
    let skip = t.attackSkip ?? 0;
    if (when < now) {
      // Late (the main thread stalled). Sustained notes come in where they would be; short ones are dropped.
      const late = now - when;
      if (!meta.sustain || late > dur * 0.6) return;
      skip += late;
      dur -= late;
      when = now;
    }
    const s = this.bank.note(t.inst, ev.midi);
    if (!s) {
      this.missing++;
      return;
    }
    // Bounded polyphony per track: the oldest note is damped.
    const maxPoly = t.maxPoly ?? (meta.sustain ? 8 : 6);
    strip.voices = strip.voices.filter((v) => !v.done && v.end > now);
    if (strip.voices.length >= maxPoly) {
      const old = strip.voices.shift()!;
      this.pool.release(old, when, 0.08);
    }
    // Plucked and struck notes ring for a natural time (or their written length if longer), then are damped.
    const sounding = meta.sustain || t.ring === false ? dur : Math.max(dur, meta.ring ?? 2);
    const v = this.pool.play(s, strip.input, when, {
      vel: ev.vel,
      rate: s.rate,
      dur: sounding,
      release: t.release ?? (meta.sustain || t.ring === false ? meta.release : Math.max(meta.release, 0.4)),
      skip,
      prio: t.part ? 1.5 : 1,
    });
    if (v) {
      strip.voices.push(v);
      this.scheduled++;
    }
  }

  /** Where the timeline is at context time `at`: which timeline, and seconds into it. */
  private locate(at: number): { tl: Timeline; t: number; beats: number } | null {
    const t = at - this.t0;
    if (t < 0) return null;
    const intro = this.song.intro;
    if (intro && t < intro.duration) return { tl: intro, t, beats: 0 };
    const tb = t - (intro?.duration ?? 0);
    const body = this.song.body;
    if (!this.song.def.loop) return tb < body.duration ? { tl: body, t: tb, beats: intro?.beats ?? 0 } : null;
    const k = Math.floor(tb / body.duration);
    return { tl: body, t: tb - k * body.duration, beats: (intro?.beats ?? 0) + k * body.beats };
  }

  /** Music position in beats at context time `at`, or -1. */
  beat(at: number): number {
    if (at < this.t0) return -1;
    const l = this.locate(at);
    if (!l) return -1;
    return l.beats + beatAt(l.tl, l.t);
  }

  /** The harmony sounding at context time `at`. */
  chordAt(at: number): ChordSpan | null {
    const l = this.locate(Math.max(at, this.t0));
    return l ? spanAt(l.tl, l.t) : null;
  }

  /** Context time of the next beat boundary (in multiples of `div` beats) after `at`. */
  nextBeat(at: number, div = 1): number {
    const b = this.beat(at);
    if (b < 0) return at;
    const l = this.locate(at);
    const anchors = l?.tl.tempo ?? [];
    let bpm = this.song.def.bpm;
    for (const a of anchors) if (l && a.t <= l.t) bpm = a.bpm;
    const nb = Math.ceil(b / div - 1e-6) * div;
    return at + ((nb - b) * 60) / bpm;
  }

  /** Fades the whole song out and stops scheduling. */
  fadeOut(seconds: number, at = this.ctx.currentTime): void {
    this.stopAt = Math.min(this.stopAt, at + seconds);
    for (const arr of ['score', 'stage'] as const) {
      const g = this.arrGain[arr].gain;
      g.cancelScheduledValues(at);
      g.setValueAtTime(g.value, at);
      g.setTargetAtTime(0, at, Math.max(0.02, seconds) / 4);
    }
    for (const s of this.strips) for (const v of s.voices) this.pool.release(v, at + seconds, 0.1);
  }

  /** Disconnects everything (call after a fade has finished). */
  dispose(): void {
    this.ended = true;
    for (const s of this.strips) {
      for (const v of s.voices) this.pool.release(v, this.ctx.currentTime, 0.02);
      for (const n of s.nodes) n.disconnect();
    }
    this.arrGain.score.disconnect();
    this.arrGain.stage.disconnect();
  }

  /** Has the song (and its tail) finished? Non-looping songs only. */
  finishedAt(): number {
    if (this.song.def.loop) return Infinity;
    return this.t0 + this.introDuration + this.song.body.duration + 4;
  }
}

/** Jobs for every sample a song needs, most urgent first. */
export function songJobs(song: CompiledSong, restored: number, blend: number) {
  const def = song.def;
  const level = def.full ? 7 : restored;
  const first = blend >= 0.5 ? 'stage' : 'score';
  const order = (t: TrackDef) => (t.layer <= level ? 0 : 10 + t.layer) + (t.arr === first ? 0 : 5);
  const byInst = new Map<InstId, number>();
  for (const t of def.tracks) byInst.set(t.inst, Math.min(byInst.get(t.inst) ?? 99, order(t)));
  return [...song.needs]
    .map(([inst, pitches]) => ({ inst, pitches, rank: byInst.get(inst) ?? 50 }))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => ({ ...x, prio: x.rank === 0 ? PRIO.now : x.rank < 10 ? PRIO.soon : PRIO.later }));
}
