// Offline renders of the real music and effects code through an OfflineAudioContext.
// The live scheduler is reproduced with ctx.suspend(): every quarter second the
// render pauses, state changes apply (restored notes, perspective switches) and
// the next stretch is scheduled, exactly as the engine's timer does.

import type { GameEvent } from '../../game/sim';
import { MAT } from '../../game/types';
import type { SongId } from '../audio';
import { PRIO, SampleBank, zoneJobs } from '../bank';
import type { Job } from '../dsp/render';
import { Mixer } from '../mixer';
import { compileSong } from '../music/arranger';
import { SONGS } from '../music/songs';
import { parseChord } from '../music/theory';
import { SongPlayer } from '../player';
import { Sfx, sfxJobs } from '../sfx';
import { VoicePool } from '../voices';
import { analyze, seam, wavBase64, type Analysis } from './analyze';

export const bank = new SampleBank();

export interface RenderOpts {
  song: SongId;
  seconds: number;
  sampleRate?: number;
  /** Starting perspective (0 score, 1 stage). */
  blend: number;
  /** Switches: at time t, glide to `to` over 0.8 s with the game's slow-down. */
  switches?: { t: number; to: number }[];
  restored: number;
  /** Restored level changes over time. */
  restore?: { t: number; level: number }[];
  /** Start this many seconds into the song's timeline. */
  from?: number;
  /** Measure a seam at this render time. */
  seamAt?: number;
  wav?: boolean;
}

export interface RenderResult {
  song: SongId;
  analysis: Analysis;
  seam?: ReturnType<typeof seam>;
  /** Every 0.25 s: playing voices and approximate live nodes. */
  timeline: { t: number; voices: number; nodes: number }[];
  peakVoices: number;
  stolen: number;
  missing: number;
  notes: number;
  renderSeconds: number;
  prepSeconds: number;
  wav?: string;
}

/** Actions to run while an offline render is paused at given times (one suspend per render quantum). */
class Script {
  private actions = new Map<number, ((t: number) => void)[]>();
  constructor(private ctx: OfflineAudioContext) {}
  at(t: number, fn: (t: number) => void): void {
    const q = 128;
    const frame = Math.max(q, Math.round((t * this.ctx.sampleRate) / q) * q);
    if (frame >= this.ctx.length) return;
    const list = this.actions.get(frame) ?? [];
    list.push(fn);
    this.actions.set(frame, list);
  }
  arm(): void {
    for (const [frame, fns] of this.actions) {
      const t = frame / this.ctx.sampleRate;
      void this.ctx.suspend(t).then(() => {
        for (const fn of fns) fn(t);
        void this.ctx.resume();
      });
    }
  }
}

async function prepare(song: SongId): Promise<number> {
  const t0 = performance.now();
  const c = compileSong(SONGS[song]);
  const jobs: Job[] = [];
  for (const [inst, pitches] of c.needs) jobs.push(...zoneJobs(inst, pitches));
  await bank.need(jobs, PRIO.now);
  return (performance.now() - t0) / 1000;
}

export async function renderSong(o: RenderOpts): Promise<RenderResult> {
  const prepSeconds = await prepare(o.song);
  const song = compileSong(SONGS[o.song]);
  const sr = o.sampleRate ?? 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(o.seconds * sr), sr);
  const mixer = new Mixer(ctx);
  mixer.setVolumes({ master: 1, music: 1, sfx: 1 }, 0);
  mixer.setBlendAt(o.blend, 0);
  const pool = new VoicePool(ctx, 96);
  const from = o.from ?? 0;
  const player = new SongPlayer(ctx, song, bank, pool, mixer, 0.05 - from, o.restored, 0.01);
  if (from > 0) player.seek(from);
  const audible = (b: number) => {
    player.setAudible('score', b < 0.999);
    player.setAudible('stage', b > 0.001);
  };
  audible(o.blend);
  const timeline: RenderResult['timeline'] = [];
  const script = new Script(ctx);
  let blend = o.blend;
  player.schedule(0.5);
  for (const c of o.restore ?? []) script.at(c.t, (t) => player.setRestored(c.level, t));
  for (const g of o.switches ?? []) {
    let start = NaN;
    for (let k = 0; k <= 16; k++)
      script.at(g.t + k * 0.05, (t) => {
        if (Number.isNaN(start)) start = blend;
        const p = Math.min(1, k / 16);
        blend = start + (g.to - start) * p;
        mixer.setBlend(blend, t, 0.012);
        audible(blend);
        mixer.setSwitch(Math.sin(Math.PI * p), t);
      });
  }
  for (let k = 1; k * 0.25 < o.seconds; k++)
    script.at(k * 0.25, (t) => {
      player.schedule(t + 0.35);
      timeline.push({ t, voices: pool.active, nodes: mixer.nodeCount + player.nodeCount + pool.active * 2 });
    });
  script.arm();
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  const renderSeconds = (performance.now() - t0) / 1000;
  return {
    song: o.song,
    analysis: analyze(buf),
    seam: o.seamAt !== undefined ? seam(buf, o.seamAt, (song.def.meter * 60) / song.def.bpm) : undefined,
    timeline,
    peakVoices: pool.peak,
    stolen: pool.stolen,
    missing: player.missing,
    notes: player.scheduled,
    renderSeconds,
    prepSeconds,
    wav: o.wav ? wavBase64(buf) : undefined,
  };
}

/** The timeline position of the loop seam, for `from`. */
export function seamOf(id: SongId): number {
  const c = compileSong(SONGS[id]);
  return (c.intro?.duration ?? 0) + c.body.duration;
}

/** Every effect, page then stage, over quiet music: a listening tour. */
export async function renderSfxTour(
  wav = true,
  musicVol = 0.8,
  gap = 1.8,
): Promise<{ analysis: Analysis; cues: { t: number; what: string; peakDb: number; rmsDb: number }[]; wav?: string }> {
  await prepare('overture');
  const j = sfxJobs();
  await bank.need([...j.ui, ...j.core, ...j.notes], PRIO.now);
  const song = compileSong(SONGS.overture);
  const sr = 48000;
  const events: { what: string; e?: GameEvent; ui?: string; mode: '2d' | '3d' }[] = [];
  for (const mode of ['2d', '3d'] as const) {
    const m = mode;
    events.push(
      { what: 'steps stone', e: { t: 'step', mode: m, surface: MAT.stone }, mode },
      { what: 'steps wood', e: { t: 'step', mode: m, surface: MAT.wood }, mode },
      { what: 'steps brass', e: { t: 'step', mode: m, surface: MAT.brass }, mode },
      { what: 'steps leaf', e: { t: 'step', mode: m, surface: MAT.leaf }, mode },
      { what: 'steps crystal', e: { t: 'step', mode: m, surface: MAT.crystal }, mode },
      { what: 'steps marble', e: { t: 'step', mode: m, surface: MAT.marble }, mode },
      { what: 'jump', e: { t: 'jump', mode: m }, mode },
      { what: 'land soft', e: { t: 'land', mode: m, impact: 6, surface: MAT.stone }, mode },
      { what: 'land hard', e: { t: 'land', mode: m, impact: 20, surface: MAT.wood }, mode },
      { what: 'bonk', e: { t: 'bonk' }, mode },
      ...[1, 2, 3, 4, 5, 6, 7].map((k) => ({ what: `note ${k}`, e: { t: 'note', id: k, count: k, total: 7 } as GameEvent, mode })),
      { what: 'checkpoint', e: { t: 'checkpoint', id: 0 }, mode },
      { what: 'death', e: { t: 'death', cause: 'thorn', pos: { x: 0, y: 0, z: 0 } }, mode },
      { what: 'respawn', e: { t: 'respawn' }, mode },
      { what: 'bounce', e: { t: 'bounce', id: 0 }, mode },
      { what: 'key on + gate', e: { t: 'key', id: 0, group: 0, on: true }, mode },
      { what: 'key off + gate', e: { t: 'key', id: 0, group: 0, on: false }, mode },
      { what: 'switch', e: { t: 'switch', mode: mode === '2d' ? '2d' : '3d', embedded: false }, mode },
      { what: 'exit', e: { t: 'exit' }, mode },
    );
  }
  for (const u of ['hover', 'confirm', 'back', 'pause', 'resume', 'start', 'complete', 'unlock', 'page']) events.push({ what: `ui ${u}`, ui: u, mode: '3d' });
  const seconds = 2 + events.length * gap + 3;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const mixer = new Mixer(ctx);
  mixer.setVolumes({ master: 1, music: musicVol, sfx: 1 }, 0);
  mixer.setBlendAt(0, 0);
  const pool = new VoicePool(ctx, 96);
  const sfxPool = new VoicePool(ctx, 32);
  const player = new SongPlayer(ctx, song, bank, pool, mixer, 0.05, 2, 0.01);
  const fx = new Sfx(ctx, bank, mixer, sfxPool, {
    harmony: (at) => {
      const s = player.chordAt(at);
      return s ? { chord: s.chord, key: s.key } : { chord: parseChord('I', song.def.key), key: song.def.key };
    },
    nextBeat: (at, div) => player.nextBeat(at, div),
  });
  const cues: { t: number; what: string; peakDb: number; rmsDb: number }[] = [];
  const script = new Script(ctx);
  player.schedule(0.5);
  events.forEach((ev, i) => {
    const at = 2 + i * gap;
    cues.push({ t: at, what: `${ev.mode === '2d' ? 'page' : 'stage'} ${ev.what}`, peakDb: 0, rmsDb: 0 });
    script.at(at - 0.9, (t) => mixer.setBlend(ev.mode === '3d' ? 1 : 0, t, 0.1));
    const e = ev.e;
    if (e?.t === 'step') {
      // A short walk.
      for (let k = 0; k < 4; k++) script.at(at + k * 0.28, () => fx.handle(e, ev.mode));
    } else if (e) {
      script.at(at, () => {
        fx.handle(e, ev.mode);
        if (e.t === 'key') fx.handle({ t: 'gate', group: 0, on: e.on }, ev.mode);
      });
    } else if (ev.ui) script.at(at, () => fx.ui(ev.ui as never));
  });
  for (let k = 1; k * 0.25 < seconds; k++) script.at(k * 0.25, (t) => player.schedule(t + 0.35));
  script.arm();
  const buf = await ctx.startRendering();
  // Per cue: peak and RMS over its slot (most useful with the music muted).
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  for (const c of cues) {
    let p = 0;
    let e = 0;
    const a = Math.round(c.t * sr);
    const b = Math.min(buf.length, Math.round((c.t + gap) * sr));
    for (let i = a; i < b; i++) {
      p = Math.max(p, Math.abs(l[i]), Math.abs(r[i]));
      e += l[i] * l[i] + r[i] * r[i];
    }
    c.peakDb = 20 * Math.log10(Math.max(p, 1e-9));
    c.rmsDb = 10 * Math.log10(Math.max(e / (2 * Math.max(1, b - a)), 1e-18));
  }
  return { analysis: analyze(buf), cues, wav: wav ? wavBase64(buf) : undefined };
}

/** Time to render every sample one song needs (main-thread-free, in the worker pool). */
export async function timeSongSamples(id: SongId): Promise<{ seconds: number; samples: number; mb: number }> {
  const before = bank.count;
  const mb0 = bank.bytes;
  const s = await prepare(id);
  return { seconds: s, samples: bank.count - before, mb: (bank.bytes - mb0) / 1048576 };
}
