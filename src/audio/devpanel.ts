// A small floating panel for auditioning the audio engine by ear.
//   import { audioDevPanel } from './audio/devpanel';
//   audioDevPanel(app.audio);
// Songs, perspective (with a proper 0.8 s switch), restored notes, pause, volumes,
// every game event in both worlds, every UI sound, and live stats.

import type { AudioEngine, SongId, UiSound } from './audio';
import type { GameEvent } from '../game/sim';
import { MAT } from '../game/types';

const SONG_IDS: SongId[] = ['title', 'overture', 'adagio', 'scherzo', 'nocturne', 'toccata', 'finale', 'ending'];
const UI_SOUNDS: UiSound[] = ['hover', 'confirm', 'back', 'pause', 'resume', 'start', 'complete', 'unlock', 'page'];

export function audioDevPanel(audio: AudioEngine, parent: HTMLElement = document.body): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;right:8px;top:8px;z-index:99999;width:300px;max-height:96vh;overflow:auto;background:rgba(20,16,24,.92);color:#eee;font:12px/1.4 system-ui,sans-serif;padding:8px;border-radius:6px';
  const row = (label?: string) => {
    const r = document.createElement('div');
    r.style.cssText = 'margin:4px 0;display:flex;flex-wrap:wrap;gap:3px;align-items:center';
    if (label) {
      const l = document.createElement('span');
      l.textContent = label;
      l.style.cssText = 'width:100%;opacity:.7';
      r.append(l);
    }
    box.append(r);
    return r;
  };
  const button = (r: HTMLElement, text: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'font:11px system-ui;padding:2px 5px;background:#3a3044;color:#eee;border:1px solid #665;border-radius:3px;cursor:pointer';
    b.onclick = async () => {
      if (!audio.unlocked) await audio.unlock();
      fn();
    };
    r.append(b);
    return b;
  };
  const slider = (r: HTMLElement, label: string, min: number, max: number, step: number, value: number, fn: (v: number) => void) => {
    const w = document.createElement('label');
    w.style.cssText = 'display:flex;gap:4px;width:100%;align-items:center';
    w.textContent = label;
    const s = document.createElement('input');
    s.type = 'range';
    s.min = String(min);
    s.max = String(max);
    s.step = String(step);
    s.value = String(value);
    s.style.flex = '1';
    s.oninput = () => fn(Number(s.value));
    w.append(s);
    r.append(w);
    return s;
  };

  let blend = 1;
  let target = 1;
  let restored = 0;
  const mode = () => (target > 0.5 ? '3d' : '2d') as '2d' | '3d';

  const songs = row('Songs');
  for (const id of SONG_IDS) button(songs, id, () => audio.playSong(id));
  button(songs, 'stop', () => audio.stopSong(1.5));

  const world = row('Perspective');
  button(world, 'switch', () => {
    target = target > 0.5 ? 0 : 1;
    fire({ t: 'switch', mode: mode(), embedded: false });
  });
  const bs = slider(world, 'blend', 0, 1, 0.01, blend, (v) => {
    blend = target = v;
  });
  const rs = slider(row('Restored notes'), 'found', 0, 7, 1, 0, (v) => {
    restored = v;
    audio.setRestored(restored, 7);
  });
  void rs;
  const pr = row();
  let paused = false;
  button(pr, 'pause', () => {
    paused = !paused;
    audio.setPaused(paused);
  });
  const vols = { master: 1, music: 1, sfx: 1 };
  const vr = row('Volumes');
  for (const k of ['master', 'music', 'sfx'] as const)
    slider(vr, k, 0, 1, 0.01, 1, (v) => {
      vols[k] = v;
      audio.setVolumes(vols);
    });

  const fire = (e: GameEvent) => audio.handle([e], { mode: mode(), x: 0, y: 0, z: 0 });
  const ev = row('Events (in the current world)');
  button(ev, 'step', () => fire({ t: 'step', mode: mode(), surface: MAT.stone }));
  button(ev, 'jump', () => fire({ t: 'jump', mode: mode() }));
  button(ev, 'land', () => fire({ t: 'land', mode: mode(), impact: 14, surface: MAT.stone }));
  button(ev, 'bonk', () => fire({ t: 'bonk' }));
  button(ev, 'note', () => {
    restored = Math.min(7, restored + 1);
    fire({ t: 'note', id: 0, count: restored, total: 7 });
    audio.setRestored(restored, 7);
    rs.value = String(restored);
  });
  button(ev, 'checkpoint', () => fire({ t: 'checkpoint', id: 0 }));
  button(ev, 'death', () => fire({ t: 'death', cause: 'thorn', pos: { x: 0, y: 0, z: 0 } }));
  button(ev, 'respawn', () => fire({ t: 'respawn' }));
  button(ev, 'bounce', () => fire({ t: 'bounce', id: 0 }));
  button(ev, 'key on', () => {
    fire({ t: 'key', id: 0, group: 0, on: true });
    fire({ t: 'gate', group: 0, on: true });
  });
  button(ev, 'key off', () => {
    fire({ t: 'key', id: 0, group: 0, on: false });
    fire({ t: 'gate', group: 0, on: false });
  });
  button(ev, 'exit', () => fire({ t: 'exit' }));
  const steps = row('Footsteps');
  for (const [name, id] of Object.entries(MAT)) if (id && name !== 'thorn') button(steps, name, () => fire({ t: 'step', mode: mode(), surface: id }));
  const ui = row('UI');
  for (const u of UI_SOUNDS) button(ui, u, () => audio.ui(u));

  const stats = document.createElement('pre');
  stats.style.cssText = 'margin:4px 0;white-space:pre-wrap;font:11px ui-monospace,monospace;opacity:.85';
  box.append(stats);
  parent.append(box);

  // Drive the perspective glide and time scale like the game does (0.8 s per switch).
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (blend !== target) {
      blend = Math.min(1, Math.max(0, blend + Math.sign(target - blend) * (dt / 0.8)));
      const p = target === 1 ? blend : 1 - blend;
      audio.setTimeScale(1 - 0.66 * Math.sin(Math.PI * p));
      bs.value = String(blend);
    } else audio.setTimeScale(1);
    audio.setPerspective(blend);
    const s = audio.stats?.();
    stats.textContent =
      `beat ${audio.beat().toFixed(2)}  blend ${blend.toFixed(2)}\n` +
      (s
        ? `${s.state} ${s.song ?? '-'} r${s.restored}  voices ${s.voices} (peak ${s.peakVoices}, stolen ${s.stolen})\n` +
          `nodes ~${s.nodes}  samples ${s.samples} (${s.sampleMB.toFixed(1)} MB) queued ${s.queued}\n` +
          `render ${(s.renderMs / 1000).toFixed(2)} s  missing ${s.missingNotes}  first ${s.firstSoundMs.toFixed(0)} ms\n` +
          `${s.sampleRate} Hz  latency ${(s.outputLatency * 1000).toFixed(0)} ms`
        : '');
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return box;
}
