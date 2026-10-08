/** Colour helpers for the page. Colours are kept as [r, g, b] in 0..255. */

export type RGB = [number, number, number];

const parsed = new Map<string, RGB>();

export function rgb(hex: string): RGB {
  let c = parsed.get(hex);
  if (c) return c;
  const s = hex.replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/(.)/g, '$1$1') : s, 16);
  c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  parsed.set(hex, c);
  return c;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function css(c: RGB, a = 1): string {
  const r = Math.round(c[0]);
  const g = Math.round(c[1]);
  const b = Math.round(c[2]);
  return a >= 0.999 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${Math.max(0, a).toFixed(3)})`;
}

/** Perceived lightness, 0..1. */
export function lum(c: RGB): number {
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}

/** Multiplies a colour by f (f < 1 darkens). */
export function scale(c: RGB, f: number): RGB {
  return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
}

/** Pushes a colour away from grey (s > 1) or towards it (s < 1). */
export function saturate(c: RGB, s: number): RGB {
  const l = (c[0] + c[1] + c[2]) / 3;
  return [clamp255(l + (c[0] - l) * s), clamp255(l + (c[1] - l) * s), clamp255(l + (c[2] - l) * s)];
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
