// The sound of Perspective Opus: procedural Web Audio, no audio files.
//
//   createAudio() -> AudioEngine
//
// One AudioContext (created on the first unlock), a mixing desk with a room and a
// hall, a worker pool that renders instrument and effect samples on demand, a
// look-ahead scheduler for the songs, effects that harmonise with the music, and
// quiet ambience. Each module explains its own part.

import type { GameEvent } from '../game/sim';
import type { AudioContextInfo, AudioEngine, AudioStats, SongId, UiSound } from './audio';
import { Ambience } from './ambience';
import { PRIO, SampleBank, zoneJobs } from './bank';
import { jobKey } from './dsp/render';
import { Mixer } from './mixer';
import { compileSong } from './music/arranger';
import { SONGS } from './music/songs';
import { parseChord, type Key } from './music/theory';
import { SongPlayer, songJobs } from './player';
import { Sfx, sfxJobs, type Harmony } from './sfx';
import { VoicePool } from './voices';

/** Seconds of music scheduled ahead of the clock. */
const LOOKAHEAD = 0.3;
const TICK_MS = 25;
/** Longest wait for a song's first samples before it starts anyway. */
const FIRST_SOUND_WAIT = 1.4;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

class Engine implements AudioEngine {
  unlocked = false;
  private ctx: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private bank: SampleBank | null = null;
  private musicPool: VoicePool | null = null;
  private sfxPool: VoicePool | null = null;
  private sfx: Sfx | null = null;
  private amb: Ambience | null = null;
  private player: SongPlayer | null = null;
  private fading: { p: SongPlayer; until: number }[] = [];
  private wanted: SongId | null = null;
  private loading: SongId | null = null;
  private loadToken = 0;
  private restored = 0;
  private blend = 1;
  private sentBlend = -1;
  private paused = false;
  private volumes = { master: 1, music: 1, sfx: 1 };
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastKey: Key = { tonic: 63, mode: 'major' };
  private firstSoundAt = -1;
  private measureFor: SongPlayer | null = null;
  /** When the current song was asked for (or the engine unlocked, if it was asked for earlier). */
  private askedAt = 0;

  async unlock(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        this.ctx = new AC();
      }
      this.init(this.ctx);
    }
    const ctx = this.ctx;
    // iOS: start a silent buffer inside the gesture, then resume.
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      // Ignore: resume() below is what matters.
    }
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        // Not allowed yet; a later gesture will try again.
      }
    }
    this.unlocked = (ctx.state as string) === 'running';
    if (this.unlocked) {
      this.startTimer();
      if (this.wanted && !this.player && !this.loading) this.load(this.wanted);
    }
  }

  private init(ctx: AudioContext): void {
    this.mixer = new Mixer(ctx);
    this.mixer.setVolumes(this.volumes);
    this.mixer.setBlend(this.blend, ctx.currentTime, 0.001);
    this.mixer.setPaused(this.paused);
    this.bank = new SampleBank();
    this.bank.makeBuffer = (length, sampleRate) => ctx.createBuffer(1, length, sampleRate);
    this.musicPool = new VoicePool(ctx, 96);
    this.sfxPool = new VoicePool(ctx, 32);
    this.sfx = new Sfx(ctx, this.bank, this.mixer, this.sfxPool, {
      harmony: (at) => this.harmony(at),
      nextBeat: (at, div) => this.player?.nextBeat(at, div) ?? at,
    });
    this.amb = new Ambience(ctx, this.bank, this.sfxPool, this.mixer);
    this.amb.setBlend(this.blend);
    const jobs = sfxJobs();
    void this.bank.need(jobs.ui, PRIO.ui);
    void this.bank.need(jobs.core, PRIO.sfx);
    void this.bank.need(jobs.notes, PRIO.later);

    // Suspend when hidden (saves battery, and the clock waits for us); resume on return.
    document.addEventListener('visibilitychange', () => {
      if (!this.unlocked) return;
      if (document.hidden) void ctx.suspend().catch(() => {});
      else void ctx.resume().catch(() => {});
    });
    // iOS can interrupt the context (calls, other audio). Any later gesture resumes it.
    const kick = () => {
      if (this.unlocked && !document.hidden && ctx.state !== 'running') void ctx.resume().catch(() => {});
    };
    for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, kick, { passive: true });
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const until = now + LOOKAHEAD;
    if (this.player) {
      this.player.schedule(until);
      if (this.player.ended && now > this.player.finishedAt()) {
        this.player.dispose();
        this.player = null;
      }
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i];
      if (now > f.until + 0.5) {
        f.p.dispose();
        this.fading.splice(i, 1);
      } else f.p.schedule(Math.min(until, f.until));
    }
    this.amb?.tick(until);
    if (this.firstSoundAt < 0 && this.measureFor && now >= this.measureFor.t0) this.firstSoundAt = performance.now();
  }

  private harmony(at: number): Harmony {
    const span = this.player?.chordAt(at);
    if (span) {
      this.lastKey = span.key;
      return { chord: span.chord, key: span.key };
    }
    return { chord: parseChord('I', this.lastKey), key: this.lastKey };
  }

  // ---------------------------------------------------------------- music

  playSong(id: SongId): void {
    if (!SONGS[id]) return;
    if (this.wanted === id && (this.player?.song.def.id === id || this.loading === id)) return;
    this.wanted = id;
    if (!this.ctx || !this.unlocked) return;
    this.load(id);
  }

  /** Renders a song's samples ahead of time (for example while a menu is open). */
  preload(id: SongId): void {
    const bank = this.bank;
    if (!bank || !SONGS[id]) return;
    const song = compileSong(SONGS[id]);
    for (const j of songJobs(song, this.restored, this.blend)) void bank.need(zoneJobs(j.inst, j.pitches), PRIO.idle);
  }

  private load(id: SongId): void {
    const ctx = this.ctx!;
    const bank = this.bank!;
    const token = ++this.loadToken;
    this.loading = id;
    this.askedAt = performance.now();
    this.firstSoundAt = -1;
    this.measureFor = null;
    const song = compileSong(SONGS[id]);
    const jobs = songJobs(song, this.restored, this.blend);
    const urgent = jobs.filter((j) => j.prio === PRIO.now).flatMap((j) => zoneJobs(j.inst, j.pitches));
    for (const j of jobs) if (j.prio !== PRIO.now) void bank.need(zoneJobs(j.inst, j.pitches), j.prio);
    const ready = bank.need(urgent, PRIO.now);
    const timeout = new Promise<void>((res) => setTimeout(res, FIRST_SOUND_WAIT * 1000));
    void Promise.race([ready, timeout]).then(() => {
      if (token !== this.loadToken || this.wanted !== id) return;
      this.loading = null;
      this.start(song, ctx);
    });
  }

  private start(song: ReturnType<typeof compileSong>, ctx: AudioContext): void {
    const now = ctx.currentTime;
    if (this.player) {
      this.player.fadeOut(1.2, now);
      this.fading.push({ p: this.player, until: now + 1.2 });
    }
    this.player = new SongPlayer(ctx, song, this.bank!, this.musicPool!, this.mixer!, now + 0.12, this.restored);
    this.audibility();
    this.measureFor = this.player;
    this.amb?.start(song.def.ambience ?? null, now);
    // Keep memory bounded: drop note samples no song or effect here needs.
    const keep = new Set<string>();
    for (const p of [this.player, ...this.fading.map((f) => f.p)])
      for (const [inst, pitches] of p.song.needs) for (const j of zoneJobs(inst, pitches)) keep.add(jobKey(j));
    for (const j of Object.values(sfxJobs()).flat()) keep.add(jobKey(j));
    setTimeout(() => this.bank?.evict((k) => k.startsWith('sfx:') || keep.has(k)), 2000);
  }

  stopSong(fadeSeconds = 1.5): void {
    this.wanted = null;
    this.loading = null;
    this.loadToken++;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (this.player) {
      this.player.fadeOut(fadeSeconds, now);
      this.fading.push({ p: this.player, until: now + fadeSeconds });
      this.player = null;
    }
    this.amb?.stop(fadeSeconds, now);
  }

  setRestored(found: number, total: number): void {
    const level = total > 0 ? Math.max(0, Math.min(7, Math.round((found / total) * 7))) : 0;
    if (level === this.restored) return;
    this.restored = level;
    this.player?.setRestored(level);
  }

  beat(): number {
    const ctx = this.ctx;
    const p = this.player;
    if (!ctx || !p || ctx.state !== 'running') return -1;
    return p.beat(this.heardTime(ctx));
  }

  /** Context time of the sample reaching the listener now. */
  private heardTime(ctx: AudioContext): number {
    if (typeof ctx.getOutputTimestamp === 'function') {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
        const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        return Math.min(t, ctx.currentTime);
      }
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  // ---------------------------------------------------------------- the two worlds

  setPerspective(blend: number): void {
    this.blend = Math.min(1, Math.max(0, blend));
    if (!this.mixer || Math.abs(this.blend - this.sentBlend) < 1e-4) return;
    this.sentBlend = this.blend;
    this.mixer.setBlend(this.blend);
    this.amb?.setBlend(this.blend);
    this.audibility();
  }

  private audibility(): void {
    for (const p of [this.player, ...this.fading.map((f) => f.p)]) {
      if (!p) continue;
      p.setAudible('score', this.blend < 0.999);
      p.setAudible('stage', this.blend > 0.001);
    }
  }

  setTimeScale(s: number): void {
    // The game slows to about 0.34 mid-switch: the music breathes into its rooms.
    this.mixer?.setSwitch((1 - Math.min(1, Math.max(0, s))) / 0.66);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.mixer?.setPaused(paused);
  }

  setVolumes(v: { master: number; music: number; sfx: number }): void {
    this.volumes = { ...v };
    this.mixer?.setVolumes(v);
  }

  // ---------------------------------------------------------------- effects

  handle(events: readonly GameEvent[], info: AudioContextInfo): void {
    if (!this.unlocked || !this.sfx || this.ctx?.state !== 'running') return;
    for (const e of events) {
      try {
        this.sfx.handle(e, info.mode);
      } catch (err) {
        console.warn('[audio] effect failed', e.t, err);
      }
    }
  }

  ui(sound: UiSound): void {
    if (!this.unlocked || !this.sfx || this.ctx?.state !== 'running') return;
    try {
      this.sfx.ui(sound);
    } catch (err) {
      console.warn('[audio] ui sound failed', sound, err);
    }
  }

  // ---------------------------------------------------------------- diagnostics

  stats(): AudioStats {
    const ctx = this.ctx;
    const voices = (this.musicPool?.active ?? 0) + (this.sfxPool?.active ?? 0);
    const strips = (this.player?.nodeCount ?? 0) + this.fading.reduce((n, f) => n + f.p.nodeCount, 0);
    return {
      state: ctx?.state ?? 'none',
      song: this.player?.song.def.id ?? null,
      restored: this.restored,
      voices,
      peakVoices: (this.musicPool?.peak ?? 0) + (this.sfxPool?.peak ?? 0),
      stolen: (this.musicPool?.stolen ?? 0) + (this.sfxPool?.stolen ?? 0),
      nodes: (this.mixer?.nodeCount ?? 0) + strips + (this.amb?.nodeCount ?? 0) + voices * 2,
      samples: this.bank?.count ?? 0,
      sampleMB: (this.bank?.bytes ?? 0) / 1048576,
      queued: this.bank?.queued ?? 0,
      renderMs: this.bank?.renderMs ?? 0,
      missingNotes: this.player?.missing ?? 0,
      firstSoundMs: this.firstSoundAt > 0 ? this.firstSoundAt - this.askedAt : -1,
      sampleRate: ctx?.sampleRate ?? 0,
      outputLatency: ctx ? ctx.outputLatency || ctx.baseLatency || 0 : 0,
    };
  }
}

export function createAudio(): AudioEngine {
  return new Engine();
}
