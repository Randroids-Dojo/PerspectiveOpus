/** Deterministic hashing for the page: every stroke is seeded, so the drawing never jitters at random. */

/** Integer hash of up to four values, in [0, 1). */
export function hash(a: number, b = 0, c = 0, d = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca77);
  h ^= Math.imul((c | 0) + 0x1b873593, 0xc2b2ae3d) ^ Math.imul((d | 0) + 0x68e31da4, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Signed hash in [-1, 1). */
export function hs(a: number, b = 0, c = 0, d = 0): number {
  return hash(a, b, c, d) * 2 - 1;
}

/** A small seeded generator for sequences of strokes. */
export function rng(seed: number): () => number {
  let a = (seed | 0) ^ 0x5bd1e995;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D value noise in [-1, 1], period-free. */
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hs(i, seed) * (1 - u) + hs(i + 1, seed) * u;
}

export const TAU = Math.PI * 2;
