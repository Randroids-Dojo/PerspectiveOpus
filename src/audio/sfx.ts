// Sound effects for game events and menus. Every effect has a page version (paper,
// pen, ink: dry and close) and a stage version (wood, stone, cloth, air: in the
// hall). Pitched effects take their notes from the harmony sounding right now.

import type { UiSound } from './audio';
import { PRIO, rangeJobs, type SampleBank } from './bank';
import type { Job } from './dsp/render';
import { SFX_DEFS, STEP_MATS, type StepMat } from './dsp/sfx';
import { INSTRUMENTS, type InstId } from './instruments';
import type { Mixer } from './mixer';
import { voiceChord } from './music/arranger';
import { MODES, parseChord, pc, type Chord, type Key } from './music/theory';
import type { GameEvent } from '../game/sim';
import { MAT_NAMES, type Mode } from '../game/types';
import type { VoicePool } from './voices';

export interface Harmony {
  chord: Chord;
  key: Key;
}

/** What the effects need to know about the music. */
export interface MusicClock {
  harmony(at: number): Harmony;
  /** Context time of the next beat (or `at` if no music). */
  nextBeat(at: number, div?: number): number;
}

const DEFAULT_KEY: Key = { tonic: 63, mode: 'major' };

/** Samples effects use, rendered once per session. */
export function sfxJobs(): { ui: Job[]; core: Job[]; notes: Job[] } {
  const ui: Job[] = [];
  const core: Job[] = [];
  for (const [id, def] of Object.entries(SFX_DEFS)) {
    const list = id === 'tap' || id === 'pageturn' ? ui : core;
    for (let v = 0; v < def.variants; v++) list.push({ kind: 'sfx', id, variant: v });
  }
  const zones = (id: InstId, lo: number, hi: number) => rangeJobs(id, lo, hi);
  return {
    ui: [...ui, ...zones('celesta', 67, 91), ...zones('harp', 55, 84), ...zones('feltPiano', 55, 79)],
    core,
    notes: [
      ...zones('musicbox', 67, 96),
      ...zones('glock', 76, 100),
      ...zones('pizz', 62, 79),
      ...zones('grand', 55, 79),
      ...zones('strings', 50, 74),
      ...zones('horn', 50, 70),
      ...zones('timpani', 40, 52),
      ...zones('choir', 55, 72),
    ],
  };
}

export class Sfx {
  private lastStep = 0;
  private lastVariant = new Map<string, number>();
  private jumpIdx = 0;
  private uiLast = 0;

  constructor(
    private ctx: BaseAudioContext,
    private bank: SampleBank,
    private mixer: Mixer,
    private pool: VoicePool,
    private clock: MusicClock,
  ) {}

  private harmony(at: number): Harmony {
    try {
      return this.clock.harmony(at);
    } catch {
      return { chord: parseChord('I', DEFAULT_KEY), key: DEFAULT_KEY };
    }
  }

  /** A pre-rendered effect sample. */
  private one(id: string, dest: AudioNode, when: number, vel: number, rate = 1, variant?: number): void {
    const def = SFX_DEFS[id];
    if (!def) return;
    let v = variant ?? Math.floor(Math.random() * def.variants);
    if (variant === undefined && def.variants > 1 && v === this.lastVariant.get(id)) v = (v + 1) % def.variants;
    this.lastVariant.set(id, v);
    const s = this.bank.sfx(id, v);
    if (!s) {
      this.bank.need([{ kind: 'sfx', id, variant: v }], PRIO.sfx);
      return;
    }
    this.pool.play(s, dest, when, { vel, rate, prio: 2 });
  }

  /** A note on an instrument, through an optional pan. */
  private note(inst: InstId, midi: number, dest: AudioNode, when: number, vel: number, dur?: number, skip?: number): void {
    const s = this.bank.note(inst, midi);
    if (!s) return;
    const meta = INSTRUMENTS[inst];
    this.pool.play(s, dest, when, {
      vel: vel * meta.level,
      rate: s.rate,
      dur: meta.sustain ? (dur ?? 1) : dur,
      release: meta.release,
      skip,
      prio: 2,
    });
  }

  private bus(mode: Mode): AudioNode {
    return mode === '2d' ? this.mixer.sfx.page.input : this.mixer.sfx.stage.input;
  }

  /** Chord tones of the current harmony within [lo, hi], ascending. */
  private tones(h: Harmony, lo: number, hi: number): number[] {
    const out: number[] = [];
    for (let m = lo; m <= hi; m++) if (h.chord.pcs.includes(pc(m))) out.push(m);
    return out.length ? out : [lo];
  }

  private degree(h: Harmony, d: number, octave: number): number {
    const scale = MODES[h.key.mode];
    const tonic = pc(h.key.tonic) + 12 * octave;
    const k = d - 1;
    return tonic + scale[((k % 7) + 7) % 7] + 12 * Math.floor(k / 7);
  }

  handle(e: GameEvent, mode: Mode): void {
    const now = this.ctx.currentTime + 0.005;
    const m: Mode = 'mode' in e ? e.mode : mode;
    const page = m === '2d';
    const bus = this.bus(m);
    switch (e.t) {
      case 'step': {
        if (now - this.lastStep < 0.09) return;
        this.lastStep = now;
        this.one(`step.${page ? 'page' : 'stage'}.${matOf(e.surface)}`, bus, now, page ? 0.42 : 0.3, 0.94 + Math.random() * 0.12);
        return;
      }
      case 'jump': {
        this.one(page ? 'jump.page' : 'jump.stage', bus, now, page ? 0.46 : 0.32, 0.95 + Math.random() * 0.1);
        const h = this.harmony(now);
        const t = this.tones(h, 67, 79);
        const midi = t[this.jumpIdx++ % t.length];
        this.note(page ? 'pizz' : 'harp', midi, bus, now + 0.01, page ? 0.16 : 0.11);
        return;
      }
      case 'land': {
        const k = Math.min(1, Math.max(0, (e.impact - 4) / 14));
        const mat = matOf(e.surface);
        if (e.impact < 3) {
          this.one(`step.${page ? 'page' : 'stage'}.${mat}`, bus, now, page ? 0.34 : 0.24);
          return;
        }
        this.one(page ? 'land.page' : 'land.stage', bus, now, page ? 0.2 + 0.34 * k : 0.1 + 0.22 * k, 1.05 - 0.12 * k);
        this.one(`step.${page ? 'page' : 'stage'}.${mat}`, bus, now + 0.004, page ? 0.34 + 0.25 * k : 0.22 + 0.16 * k);
        return;
      }
      case 'bonk':
        this.one(page ? 'bonk.page' : 'bonk.stage', bus, now, page ? 0.56 : 0.38);
        return;
      case 'note':
        this.pickup(e.count, e.total, page, bus, now);
        return;
      case 'checkpoint': {
        this.one('metronome', bus, now, 0.5, 1, 0);
        const at = Math.min(this.clock.nextBeat(now + 0.08, 1), now + 0.45);
        this.one('metronome', bus, at, 0.32, 1, 1);
        const h = this.harmony(at);
        const v = voiceChord(h.chord, 55, 74, 4, null);
        if (page) {
          v.forEach((n, i) => this.note('feltPiano', n, bus, at + i * 0.035, 0.32));
          this.note('musicbox', v[v.length - 1] + 12, bus, at + 0.16, 0.35);
        } else {
          v.forEach((n, i) => this.note('harp', n, bus, at + i * 0.04, 0.28));
          for (const n of v.slice(0, 3)) this.note('horn', n - 12 < 50 ? n : n - 12, bus, at, 0.14, 1.5, 0.02);
          for (const n of v) this.note('strings', n, bus, at, 0.13, 1.8, 0.12);
        }
        return;
      }
      case 'death': {
        const h = this.harmony(now);
        const r = 48 + pc(h.chord.root - 48);
        this.mixer.duckMusic(0.45, 0.7, 1.4, now);
        if (page) {
          this.one('splat', bus, now, 0.55);
          for (const [d, v] of [
            [-12, 0.32],
            [0, 0.26],
            [1, 0.22],
            [6, 0.18],
          ] as const)
            this.note('feltPiano', r + d, bus, now + 0.02 + Math.random() * 0.02, v, 1.6);
        } else {
          this.one('poof', bus, now, 0.4);
          for (const [d, v] of [
            [0, 0.14],
            [1, 0.12],
            [6, 0.1],
          ] as const)
            this.note('strings', r + 12 + d, bus, now + 0.01, v, 0.9, 0.05);
          this.note('timpani', 40 + pc(r - 40), bus, now, 0.2);
        }
        return;
      }
      case 'respawn': {
        const h = this.harmony(now + 0.45);
        const t = this.tones(h, 72, 88);
        if (page) {
          this.one('gather.page', bus, now, 0.42);
          this.note('musicbox', t[0], bus, now + 0.47, 0.42);
          this.note('celesta', t[Math.min(2, t.length - 1)], bus, now + 0.52, 0.28);
        } else {
          this.one('gather.stage', bus, now, 0.42);
          t.slice(0, 3).forEach((n, i) => this.note('harp', n - 12, bus, now + 0.42 + i * 0.06, 0.32));
          this.note('celesta', t[Math.min(2, t.length - 1)], bus, now + 0.6, 0.25);
        }
        return;
      }
      case 'switch': {
        const h = this.harmony(now);
        if (page) {
          // A page turning, a soft pen stroke, three notes falling into the score.
          const dest = this.mixer.sfx.page.input;
          this.one('pageturn', dest, now, e.embedded ? 0.32 : 0.46);
          this.one('penstroke', dest, now + 0.09, 0.3);
          const t = this.tones(h, 72, 91).slice(-4);
          for (let i = 0; i < 3 && i < t.length; i++) this.note('musicbox', t[t.length - 1 - i], dest, now + 0.05 + i * 0.075, 0.3 - i * 0.04);
          if (e.embedded) this.one('tap', dest, now + 0.3, 0.2, 0.7);
        } else {
          // Air rising and the hall opening.
          const dest = this.mixer.sfx.stage.input;
          this.one('airswell', dest, now, 0.28);
          this.one('cymswell', dest, now + 0.05, 0.12);
          const t = this.tones(h, 55, 86);
          const start = Math.max(0, t.length - 6);
          t.slice(start).forEach((n, i) => this.note('harp', n, dest, now + 0.22 + i * 0.055, 0.17 + i * 0.015));
          for (const n of voiceChord(h.chord, 55, 72, 3, null)) this.note('strings', n, dest, now + 0.3, 0.11, 0.9, 0.1);
        }
        return;
      }
      case 'bounce': {
        const h = this.harmony(now);
        if (page) {
          const root = 50 + pc(h.chord.root - 50);
          this.one('handdrum', bus, now, 0.5, Math.pow(2, (root - 54) / 12));
          this.one('tap', bus, now, 0.15);
        } else {
          const root = 40 + pc(h.chord.root - 40);
          this.one('timpgliss', bus, now, 0.42, Math.pow(2, (root - 45) / 12));
        }
        return;
      }
      case 'key': {
        const h = this.harmony(now);
        const t = this.tones(h, 60, 79);
        const i = Math.min(t.length - 2, (e.group * 2) % Math.max(1, t.length - 1));
        const a = t[Math.max(0, i)];
        const b = t[Math.max(0, i) + 1] ?? a + 12;
        const [n1, n2] = e.on ? [a, b] : [b, a];
        const inst: InstId = page ? 'feltPiano' : 'grand';
        this.one('keythock', bus, now, page ? 0.3 : 0.22);
        this.note(inst, n1, bus, now + 0.005, 0.5);
        this.note(inst, n2, bus, now + 0.12, 0.42);
        return;
      }
      case 'gate': {
        const h = this.harmony(now);
        const t = this.tones(h, 76, 98);
        const five = (e.on ? t.slice(0, 5) : t.slice(0, 5).reverse()).slice(0, 5);
        const at = now + 0.2;
        five.forEach((n, i) => {
          const w = at + i * 0.055;
          if (page) {
            this.note('celesta', n, bus, w, 0.26);
            this.one('penline', bus, w, 0.14);
          } else this.note('glock', n, bus, w, 0.24);
        });
        if (!page) this.one('clank', bus, at + (e.on ? 0 : 0.3), e.on ? 0.14 : 0.26);
        return;
      }
      case 'exit':
        this.cadence(page, bus, now);
        return;
    }
  }

  /** Rising scale degrees, in harmony with the chord sounding now; the seventh completes the scale. */
  private pickup(count: number, total: number, page: boolean, bus: AudioNode, now: number): void {
    const h = this.harmony(now);
    const d = Math.min(7, Math.max(1, Math.round((count / Math.max(1, total)) * 7)));
    const main = this.degree(h, d, 6);
    const lead: InstId = page ? 'musicbox' : 'celesta';
    const under: InstId = page ? 'celesta' : 'harp';
    const sparkle: InstId = page ? 'musicbox' : 'glock';
    if (d === 7) {
      // The flourish: a sweep up the tonic chord, landing on the octave.
      const tonicChord = parseChord(h.key.mode === 'major' ? 'I' : 'i', h.key);
      const run = this.tones({ chord: tonicChord, key: h.key }, main - 19, main + 2);
      run.forEach((n, i) => this.note(page ? 'musicbox' : 'harp', n, bus, now + i * 0.055, 0.24 + 0.02 * i));
      const top = this.degree(h, 8, 6);
      const at = now + run.length * 0.055;
      this.note(lead, top, bus, at, 0.6);
      this.note(sparkle, top + 12, bus, at + 0.07, 0.28);
      if (!page) {
        for (const n of voiceChord(tonicChord, 55, 74, 4, null)) this.note('strings', n, bus, at, 0.22, 2.2, 0.08);
        this.note('choir', top - 12, bus, at, 0.2, 2);
      } else for (const n of voiceChord(tonicChord, 55, 74, 3, null)) this.note('feltPiano', n, bus, at, 0.3);
      this.mixer.duckMusic(0.7, 1.2, 1.5, now);
      return;
    }
    this.note(lead, main, bus, now, 0.62);
    // A consonant chord tone a third to a sixth below.
    const below = this.tones(h, main - 9, main - 3);
    if (below.length && h.chord.pcs.includes(pc(below[below.length - 1]))) this.note(under, below[below.length - 1], bus, now + 0.012, 0.36);
    const up = this.tones(h, main + 5, main + 17);
    up.slice(0, 2).forEach((n, i) => this.note(sparkle, n, bus, now + 0.09 + i * 0.07, 0.16 - i * 0.04));
  }

  /** A V7 to I cadence in the song's key, over the music. */
  private cadence(page: boolean, bus: AudioNode, now: number): void {
    const h = this.harmony(now);
    const key = h.key;
    const five = parseChord('V7', key);
    // Minor keys resolve to a major tonic too (a Picardy third): the exit is a homecoming.
    const one = parseChord('I', key);
    this.mixer.duckMusic(0.5, 2.6, 2, now);
    const v5 = voiceChord(five, 55, 79, 4, null);
    const v1 = voiceChord(one, 55, 79, 4, v5);
    const at = now + 0.55;
    if (page) {
      v5.forEach((n, i) => this.note('feltPiano', n, bus, now + i * 0.06, 0.3));
      v1.forEach((n, i) => this.note('feltPiano', n, bus, at + i * 0.03, 0.33));
      this.note('feltPiano', 36 + pc(one.root - 36), bus, at, 0.4);
      const top = this.degree(h, 8, 6);
      this.note('musicbox', this.degree(h, 5, 6), bus, at - 0.2, 0.4);
      this.note('musicbox', top, bus, at, 0.55);
      this.note('celesta', top + 12, bus, at + 0.12, 0.3);
    } else {
      const run = this.tones({ chord: five, key }, 55, 84);
      run.forEach((n, i) => this.note('harp', n, bus, now + i * (0.5 / run.length), 0.22));
      for (const n of v1) {
        this.note('strings', n, bus, at, 0.2, 2.6, 0.12);
        this.note('horn', n - 12 >= 50 ? n - 12 : n, bus, at, 0.13, 2.2, 0.03);
      }
      this.note('glock', this.degree(h, 8, 6) + 12, bus, at, 0.26);
      this.note('timpani', 40 + pc(one.root - 40), bus, at, 0.34);
      this.one('cymswell', bus, at - 1.0, 0.16);
    }
  }

  ui(sound: UiSound): void {
    const now = this.ctx.currentTime + 0.005;
    const bus = this.mixer.ui.input;
    const h = this.harmony(now);
    switch (sound) {
      case 'hover':
        if (now - this.uiLast < 0.04) return;
        this.uiLast = now;
        this.one('tap', bus, now, 0.42, 1 + Math.random() * 0.1);
        return;
      case 'confirm':
        this.one('tap', bus, now, 0.18);
        this.note('celesta', this.degree(h, 5, 5), bus, now, 0.4);
        this.note('celesta', this.degree(h, 8, 5), bus, now + 0.075, 0.46);
        return;
      case 'back':
        this.one('tap', bus, now, 0.15, 0.9);
        this.note('celesta', this.degree(h, 8, 5), bus, now, 0.32);
        this.note('celesta', this.degree(h, 5, 5), bus, now + 0.075, 0.28);
        return;
      case 'pause':
        this.one('pageturn', bus, now, 0.14);
        this.note('feltPiano', this.degree(h, 3, 5), bus, now, 0.36);
        this.note('feltPiano', this.degree(h, 1, 5), bus, now + 0.09, 0.32);
        return;
      case 'resume':
        this.note('feltPiano', this.degree(h, 1, 5), bus, now, 0.32);
        this.note('feltPiano', this.degree(h, 5, 5), bus, now + 0.09, 0.36);
        return;
      case 'start': {
        const tonic = parseChord(h.key.mode === 'major' ? 'I' : 'i', h.key);
        const run = this.tones({ chord: tonic, key: h.key }, 55, 84);
        run.forEach((n, i) => this.note('harp', n, bus, now + i * 0.05, 0.3 + i * 0.015));
        this.note('celesta', this.degree(h, 8, 5), bus, now + run.length * 0.05, 0.42);
        return;
      }
      case 'complete': {
        // The head of the Opus theme: 5, 3. 2 1 5 and a rolled tonic chord.
        const head: [number, number][] = [
          [this.degree(h, 5, 4), 0],
          [this.degree(h, 3, 5), 0.2],
          [this.degree(h, 2, 5), 0.5],
          [this.degree(h, 1, 5), 0.6],
          [this.degree(h, 5, 5), 0.8],
        ];
        for (const [n, t] of head) this.note('celesta', n, bus, now + t, 0.42);
        const tonic = parseChord(h.key.mode === 'major' ? 'I' : 'i', h.key);
        voiceChord(tonic, 55, 79, 4, null).forEach((n, i) => this.note('harp', n, bus, now + 1.1 + i * 0.04, 0.32));
        return;
      }
      case 'unlock': {
        const tonic = parseChord(h.key.mode === 'major' ? 'I' : 'i', h.key);
        const run = this.tones({ chord: tonic, key: h.key }, 76, 98).slice(0, 5);
        run.forEach((n, i) => this.note('glock', n, bus, now + i * 0.06, 0.26));
        this.note('celesta', run[run.length - 1] ?? 84, bus, now + 0.32, 0.3);
        return;
      }
      case 'page':
        this.one('pageturn', bus, now, 0.42);
        return;
    }
  }
}

function matOf(surface: number): StepMat {
  const name = MAT_NAMES[surface];
  return (STEP_MATS as readonly string[]).includes(name) ? (name as StepMat) : 'stone';
}
