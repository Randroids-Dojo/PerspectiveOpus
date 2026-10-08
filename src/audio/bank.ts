// The sample bank: renders note and effect samples in a small worker pool, in
// priority order, and hands out AudioBuffers. Notes are rendered on a pitch grid
// per instrument (see `zoneOf`); any pitch plays from its nearest zone.

import { INSTRUMENTS, zoneOf, type InstId } from './instruments';
import { jobKey, runJob, type Job, type JobResult } from './dsp/render';

export interface Sample {
  buffer: AudioBuffer;
  loopStart?: number;
  loopEnd?: number;
}

export interface NoteSample extends Sample {
  /** Playback rate that turns the zone into the requested pitch. */
  rate: number;
}

/** Lower runs first. */
export const PRIO = { ui: 0, now: 1, soon: 2, sfx: 3, later: 4, idle: 6 } as const;

interface Pending {
  job: Job;
  prio: number;
  waiters: (() => void)[];
}

type BufferFactory = (length: number, sampleRate: number) => AudioBuffer;

const defaultFactory: BufferFactory = (length, sampleRate) => new AudioBuffer({ length, sampleRate, numberOfChannels: 1 });

export class SampleBank {
  private samples = new Map<string, Sample>();
  private zones = new Map<InstId, Set<number>>();
  private pending = new Map<string, Pending>();
  private queue: string[] = [];
  private workers: { w: Worker; busy: string | null }[] = [];
  private fallbackBusy = false;
  private seq = 0;
  private inflight = new Map<number, string>();
  /** Total bytes held in sample buffers. */
  bytes = 0;
  rendered = 0;
  renderMs = 0;
  makeBuffer: BufferFactory = defaultFactory;

  constructor(workerCount?: number) {
    const n = workerCount ?? Math.min(3, Math.max(1, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1));
    for (let i = 0; i < n; i++) {
      try {
        const w = new Worker(new URL('./synth.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<{ id: number; result?: JobResult; error?: string }>) => this.onResult(e.data, slot);
        w.onerror = () => {
          // A worker that cannot start (CSP, old browser): fall back to the main thread.
          this.workers = this.workers.filter((s) => s !== slot);
          if (slot.busy) this.requeue(slot.busy);
          this.pump();
        };
        const slot = { w, busy: null as string | null };
        this.workers.push(slot);
      } catch {
        break;
      }
    }
  }

  get queued(): number {
    return this.pending.size;
  }

  get count(): number {
    return this.samples.size;
  }

  has(key: string): boolean {
    return this.samples.has(key);
  }

  /** The sample for `midi` on `id`, from the nearest rendered zone (requests the right zone if missing). */
  note(id: InstId, midi: number): NoteSample | null {
    const meta = INSTRUMENTS[id];
    const zone = zoneOf(id, midi);
    const exact = this.samples.get(`${id}:${zone}`);
    // Unpitched instruments (one zone) always play as rendered.
    if (exact) return { ...exact, rate: meta.lo === meta.hi ? 1 : Math.pow(2, (midi - zone) / 12) };
    this.need([{ kind: 'inst', id, midi: zone }], PRIO.soon);
    const have = this.zones.get(id);
    if (!have || have.size === 0) return null;
    // Borrow the nearest zone within a fifth.
    for (let d = meta.step; d <= 7; d += meta.step) {
      for (const z of [zone - d, zone + d]) {
        const s = have.has(z) ? this.samples.get(`${id}:${z}`) : undefined;
        if (s) return { ...s, rate: Math.pow(2, (midi - z) / 12) };
      }
    }
    return null;
  }

  sfx(id: string, variant: number): Sample | null {
    return this.samples.get(`sfx:${id}:${variant}`) ?? null;
  }

  /** Makes sure these are rendered. Resolves when all are ready. */
  need(jobs: Job[], prio: number): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const job of jobs) {
      const key = jobKey(job);
      if (this.samples.has(key)) continue;
      let p = this.pending.get(key);
      if (!p) {
        p = { job, prio, waiters: [] };
        this.pending.set(key, p);
        this.queue.push(key);
      } else if (prio < p.prio) p.prio = prio;
      const pend = p;
      waits.push(new Promise<void>((res) => pend.waiters.push(res)));
    }
    this.queue.sort((a, b) => (this.pending.get(a)?.prio ?? 99) - (this.pending.get(b)?.prio ?? 99));
    this.pump();
    return Promise.all(waits).then(() => undefined);
  }

  /** Drops samples whose keys are not kept, to bound memory between songs. */
  evict(keep: (key: string) => boolean): void {
    for (const [key, s] of this.samples) {
      if (keep(key)) continue;
      this.samples.delete(key);
      this.bytes -= s.buffer.length * 4;
      const [id, z] = key.split(':');
      if (id !== 'sfx') this.zones.get(id as InstId)?.delete(Number(z));
    }
  }

  private requeue(key: string): void {
    if (this.pending.has(key) && !this.queue.includes(key)) this.queue.unshift(key);
  }

  private take(): string | undefined {
    while (this.queue.length) {
      const key = this.queue.shift()!;
      if (this.pending.has(key) && !this.samples.has(key)) return key;
    }
    return undefined;
  }

  private pump(): void {
    for (const slot of this.workers) {
      if (slot.busy) continue;
      const key = this.take();
      if (!key) return;
      const id = ++this.seq;
      slot.busy = key;
      this.inflight.set(id, key);
      slot.w.postMessage({ id, job: this.pending.get(key)!.job });
    }
    if (this.workers.length === 0 && !this.fallbackBusy && this.queue.length) {
      // No workers: render one job per macrotask so the page stays responsive.
      this.fallbackBusy = true;
      setTimeout(() => {
        this.fallbackBusy = false;
        const key = this.take();
        if (key) {
          try {
            this.store(runJob(this.pending.get(key)!.job));
          } catch (err) {
            console.warn('[audio] render failed', key, err);
            this.finish(key);
          }
        }
        this.pump();
      }, 0);
    }
  }

  private onResult(msg: { id: number; result?: JobResult; error?: string }, slot: { busy: string | null }): void {
    const key = this.inflight.get(msg.id);
    this.inflight.delete(msg.id);
    slot.busy = null;
    if (msg.result) this.store(msg.result);
    else if (key) {
      console.warn('[audio] render failed', key, msg.error);
      this.finish(key);
    }
    this.pump();
  }

  /** Adds a finished render (also used by tests that render on the main thread). */
  store(r: JobResult): void {
    if (!this.samples.has(r.key)) {
      const buffer = this.makeBuffer(r.data.length, r.sr);
      buffer.copyToChannel(r.data as Float32Array<ArrayBuffer>, 0);
      this.samples.set(r.key, { buffer, loopStart: r.loopStart, loopEnd: r.loopEnd });
      this.bytes += r.data.length * 4;
      this.rendered++;
      this.renderMs += r.ms;
      const [id, z] = r.key.split(':');
      if (id !== 'sfx') {
        let set = this.zones.get(id as InstId);
        if (!set) this.zones.set(id as InstId, (set = new Set()));
        set.add(Number(z));
      }
    }
    this.finish(r.key);
  }

  private finish(key: string): void {
    const p = this.pending.get(key);
    this.pending.delete(key);
    if (p) for (const w of p.waiters) w();
  }

  dispose(): void {
    for (const s of this.workers) s.w.terminate();
    this.workers = [];
  }
}

/** Jobs for every zone an instrument needs to cover these pitches. */
export function zoneJobs(id: InstId, pitches: Iterable<number>): Job[] {
  const zones = new Set<number>();
  for (const m of pitches) zones.add(zoneOf(id, m));
  return [...zones].sort((a, b) => a - b).map((midi) => ({ kind: 'inst' as const, id, midi }));
}

/** Zones every few semitones across a range, for effects that can land on any pitch. */
export function rangeJobs(id: InstId, lo: number, hi: number): Job[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) out.push(m);
  return zoneJobs(id, out);
}
