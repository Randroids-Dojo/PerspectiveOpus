// The mixing desk. Two music arrangements, each with its own room (a small wooden
// room for the score, a hall for the stage), crossfaded with equal power; effect
// buses for the page and the stage; a UI bus; ambience; and a master chain of
// gentle compression, a limiter and a soft clipper so nothing ever clips.

import { HALL, ROOM, makeImpulse } from './dsp/reverb';
import type { Arr } from './music/types';

interface MusicChain {
  input: GainNode;
  filter: BiquadFilterNode;
  duck: GainNode;
  out: GainNode;
  send: GainNode;
}

interface FxBus {
  input: GainNode;
  send: GainNode;
}

const SEND = { score: 0.42, stage: 0.62 } as const;
const MUSIC_LEVEL = 0.55;
/** Effects sit on top of the music, but leave the limiter little to do. */
const SFX_LEVEL = 0.8;

const setParam = (p: AudioParam, v: number, at: number, tc: number): void => {
  p.cancelScheduledValues(at);
  p.setTargetAtTime(v, at, tc);
};

export class Mixer {
  readonly music: Record<Arr, MusicChain>;
  readonly sfx: { page: FxBus; stage: FxBus };
  readonly ui: FxBus;
  readonly amb: FxBus;
  readonly room: ConvolverNode;
  readonly hall: ConvolverNode;
  readonly pre: GainNode;
  readonly master: GainNode;
  readonly comp: DynamicsCompressorNode;
  readonly limiter: DynamicsCompressorNode;
  /** Every node the desk owns (for node counts). */
  readonly nodeCount: number;

  private blend = 1;
  private vol = { master: 1, music: 1, sfx: 1 };
  private paused = false;
  private sw = 0;

  constructor(readonly ctx: BaseAudioContext, dest: AudioNode = ctx.destination) {
    let nodes = 0;
    const gain = (v = 1): GainNode => {
      nodes++;
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const verb = (spec: typeof ROOM): ConvolverNode => {
      nodes++;
      const c = ctx.createConvolver();
      c.normalize = false;
      const [l, r] = makeImpulse(spec, ctx.sampleRate);
      const b = ctx.createBuffer(2, l.length, ctx.sampleRate);
      b.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
      b.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
      c.buffer = b;
      return c;
    };

    this.pre = gain(1);
    this.room = verb(ROOM);
    this.hall = verb(HALL);
    const roomRet = gain(1);
    const hallRet = gain(1);
    // Keep the rooms out of the low end, where reverb only adds mud.
    const hp = (f: number): BiquadFilterNode => {
      nodes++;
      const b = ctx.createBiquadFilter();
      b.type = 'highpass';
      b.frequency.value = f;
      b.Q.value = 0.6;
      return b;
    };
    this.room.connect(hp(110)).connect(roomRet).connect(this.pre);
    this.hall.connect(hp(150)).connect(hallRet).connect(this.pre);

    const chain = (arr: Arr): MusicChain => {
      const input = gain(arr === 'stage' ? 1 : 0);
      nodes++;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000;
      filter.Q.value = 0.5;
      const duck = gain(1);
      const out = gain(MUSIC_LEVEL);
      const send = gain(SEND[arr]);
      let tail: AudioNode = input.connect(filter);
      if (arr === 'stage') {
        // The full orchestra: a little less weight at the bottom, a little air on top.
        const shelf = (type: BiquadFilterType, f: number, db: number): BiquadFilterNode => {
          nodes++;
          const b = ctx.createBiquadFilter();
          b.type = type;
          b.frequency.value = f;
          b.gain.value = db;
          return b;
        };
        tail = tail.connect(shelf('lowshelf', 160, -3)).connect(shelf('highshelf', 4500, 3));
      }
      tail.connect(duck).connect(out);
      out.connect(this.pre);
      out.connect(send).connect(arr === 'score' ? this.room : this.hall);
      return { input, filter, duck, out, send };
    };
    this.music = { score: chain('score'), stage: chain('stage') };

    const bus = (verbNode: ConvolverNode, sendLevel: number): FxBus => {
      const input = gain(1);
      const send = gain(sendLevel);
      input.connect(this.pre);
      input.connect(send).connect(verbNode);
      return { input, send };
    };
    this.sfx = { page: bus(this.room, 0.16), stage: bus(this.hall, 0.38) };
    this.ui = bus(this.room, 0.14);
    this.amb = bus(this.hall, 0.12);

    nodes += 3;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 2.5;
    this.comp.attack.value = 0.012;
    this.comp.release.value = 0.25;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -4;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.08;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    this.master = gain(1);
    this.pre.connect(this.comp).connect(this.limiter).connect(clip).connect(this.master).connect(dest);
    this.nodeCount = nodes;
  }

  /** Equal-power crossfade between the arrangements (and their rooms). */
  setBlend(b: number, at = this.ctx.currentTime, tc = 0.015): void {
    this.blend = Math.min(1, Math.max(0, b));
    const a = (this.blend * Math.PI) / 2;
    this.music.score.input.gain.setTargetAtTime(Math.cos(a), at, tc);
    this.music.stage.input.gain.setTargetAtTime(Math.sin(a), at, tc);
  }

  /** Jumps the crossfade (no glide), for scheduling exact curves offline. */
  setBlendAt(b: number, at: number): void {
    const a = (Math.min(1, Math.max(0, b)) * Math.PI) / 2;
    this.music.score.input.gain.setValueAtTime(Math.cos(a), at);
    this.music.stage.input.gain.setValueAtTime(Math.sin(a), at);
  }

  setVolumes(v: { master: number; music: number; sfx: number }, at = this.ctx.currentTime): void {
    // Faders feel even when squared.
    const curve = (x: number) => Math.min(1, Math.max(0, x)) ** 2;
    this.vol = { master: curve(v.master), music: curve(v.music), sfx: curve(v.sfx) };
    setParam(this.master.gain, this.vol.master, at, 0.05);
    for (const b of [this.sfx.page, this.sfx.stage, this.ui]) setParam(b.input.gain, this.vol.sfx * SFX_LEVEL, at, 0.05);
    this.applyMusic(at);
  }

  setPaused(p: boolean, at = this.ctx.currentTime): void {
    this.paused = p;
    this.applyMusic(at, p ? 0.12 : 0.2);
  }

  /** How far into a perspective switch we are (0 calm, 1 mid-turn): a breath into the rooms. */
  setSwitch(w: number, at = this.ctx.currentTime): void {
    w = Math.min(1, Math.max(0, w));
    if (Math.abs(w - this.sw) < 0.004) return;
    this.sw = w;
    this.applyMusic(at, 0.03);
  }

  private applyMusic(at: number, tc = 0.05): void {
    const w = this.sw;
    const pausedCut = this.paused ? 750 : 20000;
    const switchCut = Math.exp(Math.log(20000) + (Math.log(2400) - Math.log(20000)) * Math.pow(w, 0.8));
    const cut = Math.min(pausedCut, switchCut, this.ctx.sampleRate * 0.45);
    const level = MUSIC_LEVEL * this.vol.music * (this.paused ? 0.42 : 1) * (1 - 0.2 * w);
    for (const arr of ['score', 'stage'] as const) {
      const m = this.music[arr];
      setParam(m.filter.frequency, cut, at, tc);
      setParam(m.out.gain, level, at, tc);
      setParam(m.send.gain, SEND[arr] * (1 + 1.5 * w), at, tc);
    }
    setParam(this.amb.input.gain, this.vol.sfx * (this.paused ? 0.4 : 1), at, 0.2);
  }

  /** Dips the music for a moment (death, the exit cadence), then brings it back. */
  duckMusic(depth: number, hold: number, release: number, at = this.ctx.currentTime): void {
    for (const arr of ['score', 'stage'] as const) {
      const g = this.music[arr].duck.gain;
      g.cancelScheduledValues(at);
      g.setTargetAtTime(depth, at, 0.04);
      g.setTargetAtTime(1, at + hold, release / 3);
    }
  }

  get state(): { blend: number; paused: boolean; switch: number } {
    return { blend: this.blend, paused: this.paused, switch: this.sw };
  }
}

/** Linear up to 0.86, then a smooth knee that never passes 0.98. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const c = new Float32Array(n);
  const knee = 0.86;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (0.98 - knee) * Math.tanh((a - knee) / (0.98 - knee));
    c[i] = Math.sign(x) * y;
  }
  return c;
}
