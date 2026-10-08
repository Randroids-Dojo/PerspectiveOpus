// Quiet procedural ambience for each movement: looped noise beds shaped by filters
// and slow LFOs, and sparse events (birds, drips, leaves, crickets, clanks, creaks).
// Louder on the stage than on the page, and always well under the music.

import { PRIO, type SampleBank } from './bank';
import { SFX_DEFS } from './dsp/sfx';
import type { Mixer } from './mixer';
import type { AmbienceId } from './music/types';
import type { VoicePool } from './voices';

interface BedSpec {
  noise: 'noise.pink' | 'noise.brown';
  type: BiquadFilterType;
  freq: number;
  q?: number;
  gain: number;
  /** LFO rate (Hz) and depth (0..1) on the level. */
  lfo: number;
  depth: number;
}

interface EventSpec {
  id: string;
  every: [number, number];
  gain: [number, number];
  rate: [number, number];
  /** Repeat as a chorus of this many voices with steady periods (crickets). */
  chorus?: number;
}

const CONFIG: Record<AmbienceId, { beds: BedSpec[]; events: EventSpec[] }> = {
  meadow: {
    beds: [{ noise: 'noise.pink', type: 'lowpass', freq: 520, q: 0.5, gain: 0.05, lfo: 0.07, depth: 0.6 }],
    events: [{ id: 'bird', every: [2.5, 7], gain: [0.04, 0.1], rate: [0.9, 1.15] }],
  },
  lake: {
    beds: [
      { noise: 'noise.brown', type: 'bandpass', freq: 380, q: 0.7, gain: 0.1, lfo: 0.23, depth: 0.7 },
      { noise: 'noise.pink', type: 'lowpass', freq: 420, gain: 0.03, lfo: 0.05, depth: 0.5 },
    ],
    events: [{ id: 'plip', every: [1.4, 4.5], gain: [0.03, 0.08], rate: [0.85, 1.2] }],
  },
  village: {
    beds: [
      { noise: 'noise.pink', type: 'highpass', freq: 2600, gain: 0.016, lfo: 0.11, depth: 0.8 },
      { noise: 'noise.pink', type: 'lowpass', freq: 460, gain: 0.035, lfo: 0.06, depth: 0.5 },
    ],
    events: [
      { id: 'rustle', every: [2.5, 7], gain: [0.04, 0.1], rate: [0.9, 1.1] },
      { id: 'bird', every: [7, 16], gain: [0.02, 0.05], rate: [0.8, 1] },
    ],
  },
  garden: {
    beds: [{ noise: 'noise.pink', type: 'lowpass', freq: 340, gain: 0.025, lfo: 0.04, depth: 0.4 }],
    events: [{ id: 'cricket', every: [0.55, 0.95], gain: [0.025, 0.05], rate: [0.94, 1.06], chorus: 3 }],
  },
  clock: {
    beds: [{ noise: 'noise.brown', type: 'bandpass', freq: 150, q: 1.2, gain: 0.08, lfo: 0.13, depth: 0.4 }],
    events: [{ id: 'clank.far', every: [5, 12], gain: [0.04, 0.09], rate: [0.8, 1.1] }],
  },
  hall: {
    beds: [
      { noise: 'noise.pink', type: 'lowpass', freq: 280, gain: 0.04, lfo: 0.05, depth: 0.3 },
      { noise: 'noise.pink', type: 'bandpass', freq: 700, q: 1.5, gain: 0.01, lfo: 3.7, depth: 0.6 },
    ],
    events: [{ id: 'creak', every: [8, 20], gain: [0.025, 0.05], rate: [0.85, 1.1] }],
  },
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Voice {
  spec: EventSpec;
  next: number;
  period: number;
  rate: number;
  pan: number;
  /** Crickets rest now and then. */
  restUntil: number;
}

export class Ambience {
  readonly out: GainNode;
  private pans: StereoPannerNode[] | null = null;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private voices: Voice[] = [];
  id: AmbienceId | null = null;
  private blend = 1;

  constructor(
    private ctx: BaseAudioContext,
    private bank: SampleBank,
    private pool: VoicePool,
    mixer: Mixer,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(mixer.amb.input);
    if (typeof ctx.createStereoPanner === 'function') {
      this.pans = [-0.6, 0, 0.6].map((p) => {
        const n = ctx.createStereoPanner();
        n.pan.value = p;
        n.connect(this.out);
        return n;
      });
    }
  }

  get nodeCount(): number {
    return 1 + (this.pans?.length ?? 0) + this.nodes.length;
  }

  start(id: AmbienceId | null, at = this.ctx.currentTime): void {
    if (id === this.id) return;
    this.stop(1.5, at);
    this.id = id;
    if (!id) return;
    const cfg = CONFIG[id];
    const need = [...new Set([...cfg.beds.map((b) => b.noise), ...cfg.events.map((e) => e.id)])];
    const jobs = need.flatMap((n) => Array.from({ length: SFX_DEFS[n]?.variants ?? 1 }, (_, v) => ({ kind: 'sfx' as const, id: n, variant: v })));
    void this.bank.need(jobs, PRIO.later).then(() => {
      if (this.id !== id) return;
      const t = Math.max(this.ctx.currentTime, at);
      for (const b of cfg.beds) this.bed(b, t);
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(0, t);
      this.out.gain.setTargetAtTime(this.level(), t, 1.2);
    });
    for (const e of cfg.events) {
      const n = e.chorus ?? 1;
      for (let i = 0; i < n; i++)
        this.voices.push({
          spec: e,
          next: at + rand(1, 4),
          period: rand(e.every[0], e.every[1]),
          rate: rand(e.rate[0], e.rate[1]),
          pan: Math.floor(Math.random() * 3),
          restUntil: 0,
        });
    }
  }

  private bed(b: BedSpec, at: number): void {
    const s = this.bank.sfx(b.noise, 0);
    if (!s) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    src.loop = true;
    src.loopStart = s.loopStart ?? 0;
    src.loopEnd = s.buffer.duration;
    const f = ctx.createBiquadFilter();
    f.type = b.type;
    f.frequency.value = b.freq;
    f.Q.value = b.q ?? 0.7;
    const g = ctx.createGain();
    g.gain.value = b.gain * (1 - b.depth / 2);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = b.lfo * rand(0.85, 1.15);
    const lg = ctx.createGain();
    lg.gain.value = (b.gain * b.depth) / 2;
    const drift = ctx.createOscillator();
    drift.frequency.value = rand(0.02, 0.04);
    const dg = ctx.createGain();
    dg.gain.value = b.freq * 0.25;
    lfo.connect(lg).connect(g.gain);
    drift.connect(dg).connect(f.frequency);
    src.connect(f).connect(g).connect(this.out);
    src.start(at, rand(0, s.buffer.duration * 0.8));
    lfo.start(at);
    drift.start(at);
    this.sources.push(src, lfo, drift);
    this.nodes.push(src, f, g, lfo, lg, drift, dg);
  }

  private level(): number {
    return 0.35 + 0.65 * this.blend;
  }

  setBlend(b: number, at = this.ctx.currentTime): void {
    if (Math.abs(b - this.blend) < 0.01) return;
    this.blend = b;
    if (this.id) this.out.gain.setTargetAtTime(this.level(), at, 0.2);
  }

  stop(fade = 1.5, at = this.ctx.currentTime): void {
    if (!this.id && !this.sources.length) return;
    this.id = null;
    this.voices = [];
    this.out.gain.cancelScheduledValues(at);
    this.out.gain.setValueAtTime(this.out.gain.value, at);
    this.out.gain.setTargetAtTime(0, at, fade / 4);
    const sources = this.sources;
    const nodes = this.nodes;
    this.sources = [];
    this.nodes = [];
    for (const s of sources) s.stop(at + fade + 0.1);
    sources[0]?.addEventListener('ended', () => {
      for (const n of nodes) n.disconnect();
    });
  }

  /** Schedules events up to `until`. */
  tick(until: number): void {
    if (!this.id) return;
    for (const v of this.voices) {
      while (v.next < until) {
        const at = v.next;
        const e = v.spec;
        if (e.chorus) {
          v.next += v.period * rand(0.97, 1.03);
          if (at < v.restUntil) continue;
          if (Math.random() < 0.04) v.restUntil = at + rand(2, 6);
        } else v.next += rand(e.every[0], e.every[1]);
        if (at < this.ctx.currentTime) continue;
        const variant = Math.floor(Math.random() * (SFX_DEFS[e.id]?.variants ?? 1));
        const s = this.bank.sfx(e.id, variant) ?? this.bank.sfx(e.id, 0);
        if (!s) {
          void this.bank.need([{ kind: 'sfx', id: e.id, variant }], PRIO.idle);
          continue;
        }
        const dest = this.pans ? this.pans[e.chorus ? v.pan : Math.floor(Math.random() * 3)] : this.out;
        this.pool.play(s, dest, at, { vel: rand(e.gain[0], e.gain[1]), rate: e.chorus ? v.rate : rand(e.rate[0], e.rate[1]), prio: 0 });
      }
    }
  }
}
