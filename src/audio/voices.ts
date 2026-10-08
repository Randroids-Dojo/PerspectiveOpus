// Playing samples, and keeping the number of playing voices bounded.

import type { Sample } from './bank';

export interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  start: number;
  end: number;
  prio: number;
  vel: number;
  done: boolean;
}

export interface PlayOpts {
  vel: number;
  rate?: number;
  /** Sounding length in seconds; the note is released (damped) after it. Omit to let it ring out. */
  dur?: number;
  release?: number;
  /** Seconds of the sample's attack to skip (sustained instruments start quicker). */
  skip?: number;
  prio?: number;
}

/** A bounded set of voices. When full, the quietest, oldest, least important voice is let go. */
export class VoicePool {
  readonly list: Voice[] = [];
  created = 0;
  stolen = 0;
  peak = 0;

  constructor(
    readonly ctx: BaseAudioContext,
    public max: number,
  ) {}

  get active(): number {
    return this.list.length;
  }

  play(s: Sample, dest: AudioNode, when: number, o: PlayOpts): Voice | null {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.prune(now);
    if (this.list.length >= this.max && !this.steal(when, o.prio ?? 1)) return null;
    const rate = o.rate ?? 1;
    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    src.playbackRate.value = rate;
    const looped = s.loopStart !== undefined && s.loopEnd !== undefined;
    if (looped) {
      src.loop = true;
      src.loopStart = s.loopStart!;
      src.loopEnd = s.loopEnd!;
    }
    const g = ctx.createGain();
    const offset = Math.min((o.skip ?? 0) * rate, looped ? s.loopStart! : s.buffer.duration * 0.5);
    const ramp = offset > 0 ? 0.025 : 0.003;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(o.vel, when + ramp);
    let stopAt: number;
    const natural = when + (s.buffer.duration - offset) / rate;
    if (o.dur !== undefined || looped) {
      const rel = Math.max(0.02, o.release ?? 0.2);
      const end = Math.max(when + ramp + 0.005, when + (o.dur ?? 1));
      g.gain.setValueAtTime(o.vel, end);
      g.gain.setTargetAtTime(0, end, rel / 4);
      stopAt = end + rel * 1.6;
      if (!looped) stopAt = Math.min(stopAt, natural);
    } else stopAt = natural;
    src.connect(g).connect(dest);
    src.start(when, offset);
    src.stop(stopAt);
    const v: Voice = { src, gain: g, start: when, end: stopAt, prio: o.prio ?? 1, vel: o.vel, done: false };
    src.onended = () => this.finish(v);
    this.list.push(v);
    this.created++;
    if (this.list.length > this.peak) this.peak = this.list.length;
    return v;
  }

  /** Fades a voice out quickly from `at`. */
  release(v: Voice, at: number, time = 0.06): void {
    if (v.done) return;
    const t = Math.max(at, this.ctx.currentTime);
    if (t >= v.end) return;
    try {
      v.gain.gain.cancelScheduledValues(t);
      if (t < v.start) {
        // Never started: silence it before it begins.
        v.gain.gain.setValueAtTime(0, v.start);
        v.src.stop(v.start + 0.001);
        v.end = v.start + 0.001;
        return;
      }
      v.gain.gain.setTargetAtTime(0, t, time / 4);
      const stop = t + time * 1.5;
      if (stop < v.end) {
        v.src.stop(stop);
        v.end = stop;
      }
    } catch {
      // The voice may have ended between our check and now.
    }
  }

  private steal(when: number, prio: number): boolean {
    let best: Voice | null = null;
    let bestScore = Infinity;
    for (const v of this.list) {
      if (v.done || v.prio > prio) continue;
      // Prefer voices near their end, quiet ones, and low priority.
      const left = v.end - when;
      const score = v.prio * 10 + v.vel * 2 + Math.max(0, left) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    if (!best) return false;
    this.release(best, when, 0.03);
    best.done = true;
    this.remove(best);
    this.stolen++;
    return true;
  }

  private finish(v: Voice): void {
    if (!v.done) {
      v.done = true;
      this.remove(v);
    }
    v.src.onended = null;
    v.src.disconnect();
    v.gain.disconnect();
  }

  private remove(v: Voice): void {
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** Forgets voices whose end time has passed (in case `ended` events are slow). */
  prune(now: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i];
      if (v.end < now - 0.5) {
        v.done = true;
        this.list.splice(i, 1);
      }
    }
  }

  releaseAll(at: number, time = 0.3): void {
    for (const v of this.list) this.release(v, at, time);
  }
}
