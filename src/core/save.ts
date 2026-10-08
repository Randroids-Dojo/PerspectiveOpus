const KEY = 'opus:v1:save';

export interface MovementRecord {
  done: boolean;
  /** Which notes have ever been found, by note id. */
  notes: boolean[];
  bestTime: number | null;
  fewestDeaths: number | null;
}

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  reduceMotion: boolean;
  quality: 'auto' | 'low' | 'medium' | 'high';
  /** Which world a movement starts in. */
  startIn: '3d' | '2d';
  showTimer: boolean;
}

export interface SaveData {
  v: 1;
  movements: Record<string, MovementRecord>;
  settings: Settings;
  seenEnding: boolean;
  /** The last movement played, for Continue. */
  last: number;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.85,
  music: 0.8,
  sfx: 0.9,
  reduceMotion: false,
  quality: 'auto',
  startIn: '3d',
  showTimer: false,
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as SaveData;
      if (d.v === 1) return { ...d, settings: { ...DEFAULT_SETTINGS, ...d.settings } };
    }
  } catch {
    // Fall through to a fresh save.
  }
  return { v: 1, movements: {}, settings: { ...DEFAULT_SETTINGS }, seenEnding: false, last: 0 };
}

export function writeSave(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Private mode or full storage: progress lasts for this visit only.
  }
}

export function record(d: SaveData, id: string, notes: number): MovementRecord {
  let r = d.movements[id];
  if (!r) {
    r = { done: false, notes: Array.from({ length: notes }, () => false), bestTime: null, fewestDeaths: null };
    d.movements[id] = r;
  }
  if (r.notes.length < notes) r.notes = [...r.notes, ...Array.from({ length: notes - r.notes.length }, () => false)];
  return r;
}
