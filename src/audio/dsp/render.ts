// One entry point for every offline render job, used by the worker and the fallback.

import type { InstId } from '../instruments';
import { INSTRUMENTS } from '../instruments';
import { renderInstrument } from './instruments';
import { renderSfx } from './sfx';
import { hashString, makeRng } from './util';

export type Job = { kind: 'inst'; id: InstId; midi: number } | { kind: 'sfx'; id: string; variant: number };

export interface JobResult {
  key: string;
  sr: number;
  data: Float32Array;
  /** Loop points in seconds. */
  loopStart?: number;
  loopEnd?: number;
  ms: number;
}

export const jobKey = (j: Job): string => (j.kind === 'inst' ? `${j.id}:${j.midi}` : `sfx:${j.id}:${j.variant}`);

export function runJob(j: Job): JobResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const key = jobKey(j);
  const rnd = makeRng(hashString(key));
  let out: JobResult;
  if (j.kind === 'inst') {
    const r = renderInstrument(j.id, j.midi, INSTRUMENTS[j.id].sr, rnd);
    out = {
      key,
      sr: r.sr,
      data: r.data,
      loopStart: r.loopStart !== undefined ? r.loopStart / r.sr : undefined,
      loopEnd: r.loopEnd !== undefined ? r.loopEnd / r.sr : undefined,
      ms: 0,
    };
  } else {
    const r = renderSfx(j.id, j.variant, rnd);
    out = { key, sr: r.sr, data: r.data, loopStart: r.loopStart, loopEnd: r.loopStart !== undefined ? r.data.length / r.sr : undefined, ms: 0 };
  }
  out.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return out;
}
