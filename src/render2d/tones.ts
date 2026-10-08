import type { Palette } from '../game/palettes';
import type { MatName } from '../game/types';
import { css, lum, mix, rgb, saturate, scale, type RGB } from './color';

/**
 * Colours derived from a palette for the page. Depth is read by tone: layer 0
 * (front) is the darkest, densest ink; layer 7 (back) is a pale wash close to the
 * paper. On the Nocturne the same ramp runs from silver to indigo.
 */
export interface LayerTone {
  /** 0 at the front, 1 at the back. */
  k: number;
  tone: RGB;
  /** Outline colour and weight (CSS px at the reference scale). */
  ink: string;
  inkRGB: RGB;
  outlineW: number;
  /** Fill colour per material. */
  fill: Record<MatName, string>;
  fillRGB: Record<MatName, RGB>;
  /** Mark colours: light marks read on dark fills (mortar), dark marks on light ones. */
  light: string;
  dark: string;
  /** Opacity scale for marks and detail (front is densest). */
  density: number;
  /** Top cap colour (grass, moss, leaves...). */
  top: RGB;
}

export interface Tones {
  pal: Palette;
  inv: boolean;
  paper: RGB;
  paperShade: RGB;
  ink: RGB;
  inkFar: RGB;
  rubric: RGB;
  gold: RGB;
  goldLight: RGB;
  goldDark: RGB;
  /** Colour used for shadows and hatching shade (darker than the paper on both kinds of page). */
  shade: RGB;
  layers: LayerTone[];
  /** Group colours for keys and gates. */
  groups: string[];
  groupsRGB: RGB[];
  /** Quaver's body and eye colours. */
  body: RGB;
  eye: RGB;
}

const MATS: MatName[] = ['stone', 'brick', 'wood', 'brass', 'dark', 'crystal', 'leaf', 'thorn', 'marble'];

/** How much of the material colour survives into the wash, per material. */
const MAT_W: Record<MatName, number> = {
  stone: 0.34,
  brick: 0.5,
  wood: 0.5,
  brass: 0.62,
  dark: 0.3,
  crystal: 0.6,
  leaf: 0.55,
  thorn: 0.4,
  marble: 0.3,
};

export function makeTones(pal: Palette, depth: number): Tones {
  const inv = pal.inverted;
  const paper = rgb(pal.paper);
  const ink = rgb(pal.ink);
  const inkFar = rgb(pal.inkFar);
  const near = rgb(pal.washNear);
  const far = rgb(pal.washFar);
  const gold = rgb(pal.gold);
  const shade: RGB = inv ? scale(rgb(pal.paperShade), 0.55) : ink;
  const layers: LayerTone[] = [];
  // The front tone leans towards the ink so the nearest layer is clearly the densest.
  const nearD = mix(near, ink, inv ? 0.3 : 0.36);
  for (let z = 0; z < depth; z++) {
    const k = depth > 1 ? z / (depth - 1) : 0;
    const kk = Math.pow(k, 0.85);
    const tone = mix(nearD, far, kk);
    const fill = {} as Record<MatName, string>;
    const fillRGB = {} as Record<MatName, RGB>;
    for (const m of MATS) {
      const look = pal.mats[m];
      let base = rgb(look.color);
      if (inv) base = mix(base, rgb('#c7cde6'), 0.35);
      // Tone carries the depth; the material tints it. The back fades towards the paper.
      const w = MAT_W[m] * (0.42 + 0.45 * kk);
      let c = mix(tone, saturate(base, 1.08), w);
      c = mix(c, paper, 0.02 + 0.36 * kk);
      if (!inv) c = saturate(c, 1.16 - 0.1 * kk);
      fill[m] = css(c);
      fillRGB[m] = c;
    }
    const inkC = mix(ink, inkFar, Math.pow(k, 0.7));
    const fillMid = fillRGB.stone;
    const darkMark = inv ? mix(fillMid, scale(paper, 0.7), 0.55) : mix(fillMid, ink, 0.55);
    const lightMark = inv ? mix(fillMid, rgb('#ffffff'), 0.45) : mix(fillMid, mix(paper, rgb('#fffaf0'), 0.4), 0.5 + 0.1 * (1 - k));
    const top = mix(mix(rgb(pal.topColor), tone, 0.18 + 0.5 * kk), paper, 0.25 * kk);
    layers.push({
      k,
      tone,
      ink: css(inkC),
      inkRGB: inkC,
      outlineW: 2.5 - 1.5 * kk,
      fill,
      fillRGB,
      light: css(lightMark),
      dark: css(darkMark),
      density: 1 - 0.55 * kk,
      top,
    });
  }
  const groupsRGB: RGB[] = [
    rgb(pal.rubric),
    rgb('#2f5fa8'),
    rgb('#2f8a6a'),
    rgb('#7a4aa8'),
    rgb('#c9862a'),
    rgb('#2a8aa8'),
  ].map((c) => (inv ? mix(c, rgb('#ffffff'), 0.25) : c));
  return {
    pal,
    inv,
    paper,
    paperShade: rgb(pal.paperShade),
    ink,
    inkFar,
    rubric: rgb(pal.rubric),
    gold,
    goldLight: mix(gold, rgb('#fff4cf'), 0.55),
    goldDark: mix(gold, inv ? rgb('#3a2a10') : ink, 0.45),
    shade,
    layers,
    groups: groupsRGB.map((c) => css(c)),
    groupsRGB,
    body: inv ? rgb('#0b0d1c') : ink,
    eye: rgb('#fffaf0'),
  };
}

/** Continuous layer tone for things between layers (moving entities). */
export function toneAt(t: Tones, z: number): LayerTone {
  const i = Math.max(0, Math.min(t.layers.length - 1, Math.round(z - 0.5)));
  return t.layers[i];
}

/** A colour pushed towards the layer's tone, the way the page fades things that sit further back. */
export function depthTint(t: Tones, c: RGB, z: number, amount = 1): RGB {
  const L = toneAt(t, z);
  const kk = Math.pow(L.k, 0.78);
  return mix(mix(c, L.tone, 0.08 + 0.4 * kk * amount), t.paper, 0.22 * kk * amount);
}

export function isDarkPage(t: Tones): boolean {
  return lum(t.paper) < 0.4;
}
