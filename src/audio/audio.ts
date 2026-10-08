import type { GameEvent } from '../game/sim';
import type { Mode } from '../game/types';

export type SongId = 'title' | 'overture' | 'adagio' | 'scherzo' | 'nocturne' | 'toccata' | 'finale' | 'ending';

export type UiSound =
  | 'hover'
  | 'confirm'
  | 'back'
  | 'pause'
  | 'resume'
  | 'start'
  | 'complete'
  | 'unlock'
  | 'page';

/** Diagnostics from the real engine (optional on AudioEngine). */
export interface AudioStats {
  state: string;
  song: SongId | null;
  restored: number;
  /** Sample voices playing or scheduled. */
  voices: number;
  peakVoices: number;
  /** Voices let go early because the pool was full. */
  stolen: number;
  /** Approximate live audio nodes (desk, channel strips, ambience, voices). */
  nodes: number;
  samples: number;
  sampleMB: number;
  /** Samples waiting to be rendered. */
  queued: number;
  renderMs: number;
  /** Notes skipped because their sample was not ready yet. */
  missingNotes: number;
  /** Milliseconds from asking for the current song (or unlocking, if asked before) to its first note. */
  firstSoundMs: number;
  sampleRate: number;
  outputLatency: number;
}

export interface AudioContextInfo {
  mode: Mode;
  /** Listener position for spatial effects (player position). */
  x: number;
  y: number;
  z: number;
}

/**
 * The sound of the game. One composition per movement, arranged twice: the
 * score arrangement (intimate, close, dry) and the stage arrangement (full, wide,
 * reverberant). Both play on one clock and `setPerspective` crossfades between
 * them, so switching never interrupts the music.
 */
export interface AudioEngine {
  /** Starts the audio context. Must be called from a user gesture. */
  unlock(): Promise<void>;
  readonly unlocked: boolean;
  /** 0 = score arrangement, 1 = stage arrangement. Called every frame with the view blend. */
  setPerspective(blend: number): void;
  playSong(id: SongId): void;
  stopSong(fadeSeconds?: number): void;
  /** How much of the movement's music has been restored (notes found / total). */
  setRestored(found: number, total: number): void;
  /** Sound effects for simulation events. */
  handle(events: readonly GameEvent[], info: AudioContextInfo): void;
  ui(sound: UiSound): void;
  /** Music position in beats, or -1 if nothing is playing. */
  beat(): number;
  setVolumes(v: { master: number; music: number; sfx: number }): void;
  /** Muffles the music under menus. */
  setPaused(paused: boolean): void;
  /** Game-time multiplier while the world turns (for a gentle filter sweep). */
  setTimeScale(s: number): void;
  /** Optional: renders a song's samples ahead of time, for example on the programme screen. */
  preload?(id: SongId): void;
  /** Optional: diagnostics (voices, nodes, sample memory). */
  stats?(): AudioStats;
}

/** Silent engine used until the real one loads, and in tests. */
export class SilentAudio implements AudioEngine {
  unlocked = false;
  async unlock(): Promise<void> {
    this.unlocked = true;
  }
  setPerspective(): void {}
  playSong(): void {}
  stopSong(): void {}
  setRestored(): void {}
  handle(): void {}
  ui(): void {}
  beat(): number {
    return -1;
  }
  setVolumes(): void {}
  setPaused(): void {}
  setTimeScale(): void {}
}
