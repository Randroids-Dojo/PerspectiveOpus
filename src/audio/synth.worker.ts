// Renders note and effect samples off the main thread.

import { runJob, type Job } from './dsp/render';

interface Scope {
  onmessage: ((e: MessageEvent<{ id: number; job: Job }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as Scope;

scope.onmessage = (e) => {
  const { id, job } = e.data;
  try {
    const r = runJob(job);
    scope.postMessage({ id, result: r }, [r.data.buffer]);
  } catch (err) {
    scope.postMessage({ id, error: String(err) });
  }
};
