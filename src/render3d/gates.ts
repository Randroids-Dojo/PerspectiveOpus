import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GateDef, KeyDef } from '../game/types';
import { groupColor } from './effects';
import { patch } from './shared';
import { Bag, GeoBucket, PRIM, col, mat, mixc, shade } from './util';

/**
 * Staff gates and the piano keys that raise them.
 *
 * Upright gates are a gilded organ case: a dark back panel behind close-set
 * gold pipes, a sill and a tread on top, and one or two staves of five glowing
 * lines across the pipes. Flat gates are a gold slab on girders with a staff
 * engraved along its top. A gate dissolves into gold flecks as it opens and
 * condenses from the bottom up as it closes; the dotted ghost shows where it
 * will be.
 */

/** Glow (`aWind.y`) for the different parts of a gate. */
const GLOW_BODY = 0.1;
const GLOW_EDGE = 1.25;
const GLOW_LINE = 1.35;

const GATE_FRAG_PARS = /* glsl */ `
uniform float uVis;
uniform float uGlow;
uniform vec4 uSweep;
varying vec3 vGateP;
varying float vGateGlow;
float gateHash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}
`;

const GATE_DISSOLVE = /* glsl */ `
float gateEdge = 0.0;
{
  float n = gateHash(floor(vGateP * 11.0));
  float s = clamp(dot(vGateP, uSweep.xyz) + uSweep.w, 0.0, 1.0);
  float k = n * 0.45 + s * 0.55;
  float thr = uVis * 1.2 - 0.04;
  if (k > thr) discard;
  gateEdge = 1.0 - smoothstep(0.0, 0.06, thr - k);
}
`;

export interface GateObj {
  body: THREE.Mesh;
  ghost: THREE.Mesh;
  ghostMat: THREE.ShaderMaterial;
  u: { uVis: { value: number }; uGlow: { value: number } };
  i: number;
  /** Halo spots in simulation coordinates. */
  glows: THREE.Vector3[];
  upright: boolean;
}

export interface KeyObj {
  plate: THREE.Object3D;
  inlay: THREE.MeshBasicMaterial;
  base: THREE.Color;
  i: number;
  centre: THREE.Vector3;
}

function gateMaterial(bag: Bag, sweep: THREE.Vector4): { m: THREE.MeshStandardMaterial; u: GateObj['u'] } {
  const m = bag.add(
    new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.26, emissive: '#ffffff', emissiveIntensity: 1 }),
  );
  const u = { uVis: { value: 1 }, uGlow: { value: 1 } };
  const uSweep = { value: sweep };
  patch(m, {
    cutout: true,
    hfog: true,
    key: 'gate',
    extra: (shader) => {
      shader.uniforms.uVis = u.uVis;
      shader.uniforms.uGlow = u.uGlow;
      shader.uniforms.uSweep = uSweep;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aWind;\nvarying vec3 vGateP;\nvarying float vGateGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGateP = position;\nvGateGlow = aWind.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GATE_FRAG_PARS}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${GATE_DISSOLVE}`)
        // Glowing parts are lit by themselves, not by reflections.
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - clamp(vGateGlow - 0.5, 0.0, 1.0);')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance = vColor.rgb * vGateGlow * uGlow + vec3(1.0, 0.62, 0.22) * gateEdge * 2.0;`,
        );
    },
  });
  return { m, u };
}

const GHOST_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying vec3 vW;
varying vec3 vC;
void main() {
  // Red marks horizontal parts, dotted along their length; the rest is dotted upwards.
  float d = vC.r > 0.5 ? fract((vW.x + vW.z) * 2.5) : fract(vW.y * 3.0);
  if (d > 0.5) discard;
  gl_FragColor = vec4(uColor * uOpacity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const GHOST_VERT = /* glsl */ `
varying vec3 vW;
varying vec3 vC;
void main() {
  vW = position;
  vC = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Builds one gate in its own group. `glow` is the palette's light, used for the ghost. */
export function buildGate(gd: GateDef, i: number, glow: THREE.Color, bag: Bag): { group: THREE.Group; obj: GateObj } {
  const sx = gd.max.x - gd.min.x;
  const sy = gd.max.y - gd.min.y;
  const sz = gd.max.z - gd.min.z;
  const axis: 'x' | 'z' = sz > sx ? 'z' : 'x';
  const len = axis === 'z' ? sz : sx;
  const cross = axis === 'z' ? sx : sz;
  const upright = sy > 1.01 || len <= 1;
  const g = new THREE.Group();
  g.position.set((gd.min.x + gd.max.x) / 2, gd.min.y, (gd.min.z + gd.max.z) / 2);

  const gc = groupColor(gd.group);
  const lineCol = mixc(gc, '#ffffff', 0.12);
  // Even out the glow so a pale group colour does not blow out to white.
  const lum = 0.2126 * lineCol.r + 0.7152 * lineCol.g + 0.0722 * lineCol.b;
  lineCol.multiplyScalar(Math.min(1.4, 0.26 / Math.max(0.05, lum)));
  const gold = col('#f0bb55');
  const goldDeep = col('#c98a2c');
  const edge = col('#ffd98c');
  const caseCol = col('#6a4316');
  const b = new GeoBucket();
  const gh = new GeoBucket();
  const H = col('#ff0000');
  const V = col('#000000');
  // Place a box given along/height/across sizes, in the gate's own axes.
  const box = (
    bk: GeoBucket,
    geo: THREE.BufferGeometry,
    along: number,
    y: number,
    acrossPos: number,
    sl: number,
    sh: number,
    sc: number,
    c: THREE.Color,
    glowAmt: number,
  ) => {
    const m =
      axis === 'x' ? mat(along, y, acrossPos, 0, 0, 0, sl, sh, sc) : mat(acrossPos, y, along, 0, 0, 0, sc, sh, sl);
    bk.add(geo, m, c, { phase: glowAmt });
  };
  const rbox = (w: number, h: number, d: number, r: number) => bag.add(new RoundedBoxGeometry(w, h, d, 2, r));
  const glows: THREE.Vector3[] = [];
  const toWorld = (along: number, y: number, ac = 0) =>
    axis === 'x'
      ? new THREE.Vector3(g.position.x + along, g.position.y + y, g.position.z + ac)
      : new THREE.Vector3(g.position.x + ac, g.position.y + y, g.position.z + along);

  if (upright) {
    const depth = Math.min(cross - 0.04, 0.9);
    // Sill and tread: full footprint so the top reads as a step.
    const sillH = 0.14;
    const capH = 0.18;
    const sill = rbox(1, 1, 1, 0.04);
    box(b, sill, 0, sillH / 2, 0, len - 0.03, sillH, cross - 0.03, goldDeep, GLOW_BODY);
    box(b, sill, 0, sy - capH / 2, 0, len - 0.03, capH, cross - 0.03, gold, GLOW_BODY + 0.1);
    // Bright edges round the tread: the warm rim that says this is solid.
    for (const s of [-1, 1]) {
      box(b, PRIM.box, 0, sy - 0.012, s * (cross / 2 - 0.035), len - 0.06, 0.03, 0.05, edge, GLOW_EDGE);
      box(b, PRIM.box, s * (len / 2 - 0.035), sy - 0.012, 0, 0.05, 0.03, cross - 0.1, edge, GLOW_EDGE);
      box(b, PRIM.box, 0, sillH + 0.01, s * (cross / 2 - 0.03), len - 0.08, 0.025, 0.04, edge, GLOW_EDGE * 0.7);
    }
    // The dark case behind the pipes.
    const inner = sy - sillH - capH;
    box(b, PRIM.box, 0, sillH + inner / 2, 0, len - 0.12, inner, Math.min(0.08, depth), caseCol, 0.02);
    // End posts.
    for (const s of [-1, 1]) box(b, rbox(1, 1, 1, 0.03), s * (len / 2 - 0.07), sillH + inner / 2, 0, 0.13, inner, depth * 0.9, goldDeep, GLOW_BODY);
    // Close-set pipes: a portcullis from the side, organ pipes from the front.
    const pitch = 0.2;
    const span = len - 0.3;
    const n = Math.max(2, Math.round(span / pitch));
    const pr = Math.min(0.09, (span / n) * 0.46);
    const pipeD = pr * 2;
    const pipe = bag.add(new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1));
    for (let k = 0; k < n; k++) {
      const along = -span / 2 + (k + 0.5) * (span / n);
      const shine = 0.92 + 0.16 * ((k * 7) % 3) / 2;
      box(b, pipe, along, sillH + inner / 2, 0, pr * 2, inner, pipeD, shade(gold, shine), GLOW_BODY * 1.8);
    }
    // Staves: tight bands of five lines, never spaced like rungs.
    const staves = inner > 4 ? [0.36, 0.7] : [0.6];
    const sp = 0.1;
    for (const f of staves) {
      const yc = sillH + inner * f;
      for (let l = 0; l < 5; l++) {
        const y = yc + (l - 2) * sp;
        box(b, PRIM.box, 0, y, 0, len - 0.2, 0.026, pipeD + 0.03, lineCol, GLOW_LINE);
        box(gh, PRIM.box, 0, y, 0, len - 0.2, 0.025, 0.06, H, 0);
      }
      // Bar lines closing the staff.
      for (const s of [-1, 1]) box(b, PRIM.box, s * (len / 2 - 0.16), yc, 0, 0.026, sp * 4 + 0.03, pipeD + 0.03, lineCol, GLOW_LINE);
    }
    // Group-coloured jewels set into the tread's faces.
    for (const s of [-1, 1]) {
      const jm =
        axis === 'x'
          ? mat(0, sy - capH / 2, s * (cross / 2 - 0.01), 0, 0, Math.PI / 4, 0.1, 0.1, 0.03)
          : mat(s * (cross / 2 - 0.01), sy - capH / 2, 0, 0, Math.PI / 2, Math.PI / 4, 0.1, 0.1, 0.03);
      b.add(PRIM.box, jm, lineCol, { phase: GLOW_LINE });
    }
    // Ghost: the outline of sill, tread and posts.
    for (const yy of [0.05, sy - 0.05]) box(gh, PRIM.box, 0, yy, 0, len - 0.1, 0.05, 0.1, H, 0);
    for (const s of [-1, 1]) box(gh, PRIM.box, s * (len / 2 - 0.07), sy / 2, 0, 0.06, sy - 0.1, 0.06, V, 0);
    glows.push(toWorld(-len / 2 + 0.1, sy), toWorld(len / 2 - 0.1, sy));
    if (len > 3) glows.push(toWorld(0, sy));
  } else {
    // A gold slab on girders with a staff engraved along its top.
    const slab = 0.3;
    const top = sy;
    box(b, rbox(1, 1, 1, 0.05), 0, top - slab / 2, 0, len - 0.03, slab, cross - 0.04, gold, GLOW_BODY + 0.05);
    for (const s of [-1, 1]) {
      box(b, PRIM.box, 0, top - slab - 0.09, s * (cross / 2 - 0.12), len - 0.2, 0.18, 0.1, goldDeep, GLOW_BODY);
      // Glowing rims along the walkable edges and the ends.
      box(b, PRIM.box, 0, top - 0.012, s * (cross / 2 - 0.04), len - 0.06, 0.03, 0.05, edge, GLOW_EDGE);
      box(b, PRIM.box, s * (len / 2 - 0.04), top - 0.012, 0, 0.05, 0.03, cross - 0.1, edge, GLOW_EDGE);
    }
    const ribs = Math.max(2, Math.round(len));
    for (let k = 0; k <= ribs; k++) {
      const along = -len / 2 + 0.12 + (k / ribs) * (len - 0.24);
      box(b, PRIM.box, along, top - slab - 0.11, 0, 0.08, 0.22, cross - 0.24, goldDeep, GLOW_BODY);
    }
    const sp = Math.max(0.1, Math.min(0.3, (cross - 0.5) / 5));
    for (let l = 0; l < 5; l++) {
      const ac = (l - 2) * sp;
      box(b, PRIM.box, 0, top + 0.002, ac, len - 0.24, 0.012, 0.035, lineCol, GLOW_LINE);
      box(gh, PRIM.box, 0, top - 0.1, ac, len - 0.24, 0.05, 0.06, H, 0);
    }
    // Bar lines across the staff every few cells.
    const measures = Math.max(1, Math.round(len / 4));
    for (let k = 0; k <= measures; k++) {
      const along = -len / 2 + 0.12 + (k / measures) * (len - 0.24);
      box(b, PRIM.box, along, top + 0.002, 0, 0.035, 0.012, sp * 4 + 0.035, lineCol, GLOW_LINE);
    }
    // Ghost outline of the slab edges.
    for (const s of [-1, 1]) {
      box(gh, PRIM.box, 0, top - 0.15, s * (cross / 2 - 0.05), len - 0.1, 0.06, 0.06, H, 0);
      box(gh, PRIM.box, s * (len / 2 - 0.05), top - 0.15, 0, 0.06, 0.06, cross - 0.1, H, 0);
    }
    for (const s of [-1, 1]) for (const t of [-1, 1]) glows.push(toWorld(s * (len / 2 - 0.1), top, t * (cross / 2 - 0.1)));
  }

  // Sweep: the gate condenses bottom up (upright) or end to end (flat).
  const sweep = upright
    ? new THREE.Vector4(0, 1 / sy, 0, 0)
    : axis === 'x'
      ? new THREE.Vector4(1 / len, 0, 0, 0.5)
      : new THREE.Vector4(0, 0, 1 / len, 0.5);
  const { m, u } = gateMaterial(bag, sweep);
  const geo = bag.add(b.build()!);
  const body = new THREE.Mesh(geo, m);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const ghostMat = bag.add(
    new THREE.ShaderMaterial({
      vertexShader: GHOST_VERT,
      fragmentShader: GHOST_FRAG,
      uniforms: { uOpacity: { value: 0.5 }, uColor: { value: glow.clone().multiplyScalar(1.2) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    }),
  );
  const ghost = new THREE.Mesh(bag.add(gh.build()!), ghostMat);
  g.add(ghost);
  return { group: g, obj: { body, ghost, ghostMat, u, i, glows, upright } };
}

/** Per-frame gate animation from `game.gateVis`. */
export function updateGate(g: GateObj, v: number, clock: number): void {
  g.u.uVis.value = v;
  g.u.uGlow.value = 0.85 + 0.15 * Math.sin(clock * 2.2 + g.i * 1.3);
  g.body.visible = v > 0.01;
  g.body.castShadow = v > 0.6;
  g.ghostMat.uniforms.uOpacity.value = (1 - v) * 0.55;
  g.ghost.visible = v < 0.97;
}

/** The top outline of a white key between two sharps: wide at the front, narrow at the back. */
function whiteKeyShape(w: number, d: number, neck: number, front: number): THREE.Shape {
  // Shape y is the key's -z, so +y is the front edge towards the audience.
  const s = new THREE.Shape();
  const r = 0.08;
  const hw = w / 2;
  const hn = neck / 2;
  const yb = -d / 2;
  const yf = d / 2;
  const ys = yf - front;
  s.moveTo(-hn, yb);
  s.lineTo(hn, yb);
  s.lineTo(hn, ys);
  s.lineTo(hw, ys);
  s.lineTo(hw, yf - r);
  s.quadraticCurveTo(hw, yf, hw - r, yf);
  s.lineTo(-hw + r, yf);
  s.quadraticCurveTo(-hw, yf, -hw, yf - r);
  s.lineTo(-hw, ys);
  s.lineTo(-hn, ys);
  s.closePath();
  return s;
}

/**
 * A piano key set into the floor: an ebony bed with a light strip at the
 * front, an ivory white key with a rounded bevelled nose that sinks when
 * pressed, and the slim ebony sharps that cut into its back corners.
 */
export function buildKey(k: KeyDef, i: number, bag: Bag, gloss: THREE.Material): { group: THREE.Group; obj: KeyObj } {
  const ivory = col('#ddd0b0');
  const ivoryShade = col('#a8916a');
  const ebony = col('#17110f');
  const w = k.width;
  const g = new THREE.Group();
  g.position.set(k.pos.x + w / 2, k.pos.y, k.pos.z + 0.5);
  const gc = groupColor(k.group);
  const inlay = bag.add(new THREE.MeshBasicMaterial({ color: gc.clone().multiplyScalar(0.6) }));

  // The bed: an ebony frame standing just proud of the floor, dark inside, with the sharps.
  const bed = new GeoBucket();
  const lip = 0.045;
  bed.add(PRIM.box, mat(0, lip / 2, -0.465, 0, 0, 0, w - 0.02, lip, 0.07), ebony);
  bed.add(PRIM.box, mat(0, lip / 2, 0.465, 0, 0, 0, w - 0.02, lip, 0.07), ebony);
  for (const s of [-1, 1]) bed.add(PRIM.box, mat(s * (w / 2 - 0.035), lip / 2, 0, 0, 0, 0, 0.07, lip, 0.98), ebony);
  bed.add(PRIM.box, mat(0, 0.006, 0, 0, 0, 0, w - 0.06, 0.012, 0.88), shade(ebony, 0.6));
  const sharp = bag.add(new RoundedBoxGeometry(1, 1, 1, 2, 0.03));
  const sharpL = 0.44;
  for (let s = 0; s <= w; s++) {
    // Half sharps at the ends sit on the frame; whole ones between keys.
    const end = s === 0 || s === w;
    const sw = end ? 0.13 : 0.22;
    const x = -w / 2 + s + (s === 0 ? sw / 2 - 0.01 : s === w ? -sw / 2 + 0.01 : 0);
    bed.add(sharp, mat(x, 0.13, 0.45 - sharpL / 2, 0, 0, 0, sw, 0.26, sharpL), ebony, {
      colorFn: (_p, n, out) => {
        if (n.y > 0.5) out.multiplyScalar(2.2);
      },
    });
  }
  const bedGeo = bed.build();
  if (bedGeo) {
    const bm = new THREE.Mesh(bag.add(bedGeo), gloss);
    bm.castShadow = bm.receiveShadow = true;
    g.add(bm);
  }
  // The light strip along the front of the bed and in the gap before the key.
  const strip = new GeoBucket();
  strip.add(PRIM.box, mat(0, lip + 0.002, -0.47, 0, 0, 0, w - 0.12, 0.006, 0.035), gc);
  strip.add(PRIM.box, mat(0, 0.016, -0.415, 0, 0, 0, w - 0.1, 0.006, 0.03), gc);
  const stripGeo = strip.build();
  if (stripGeo) g.add(new THREE.Mesh(bag.add(stripGeo), inlay));

  // The white keys, which sink together.
  const plate = new THREE.Group();
  const keyH = 0.14;
  const bevel = 0.035;
  const kb = new GeoBucket();
  const ext = new THREE.ExtrudeGeometry(whiteKeyShape(0.9, 0.8, 0.5, 0.36), {
    depth: keyH,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 6,
  });
  ext.rotateX(-Math.PI / 2);
  ext.translate(0, -keyH / 2, 0);
  for (let s = 0; s < w; s++) {
    kb.add(ext, mat(-w / 2 + s + 0.5, 0, 0.01), ivory, {
      colorFn: (_p, n, out) => {
        // The top stays bright; the bevel and faces warm and darken.
        out.lerp(ivoryShade, (1 - Math.max(0, n.y)) * 0.6);
      },
    });
  }
  ext.dispose();
  const kg = kb.build();
  if (kg) {
    const km = new THREE.Mesh(bag.add(kg), gloss);
    km.castShadow = km.receiveShadow = true;
    plate.add(km);
  }
  // A lit line across the front face of each key.
  const front = new THREE.Mesh(PRIM.box, inlay);
  front.scale.set(w - 0.3, 0.022, 0.01);
  front.position.set(0, -0.01, -0.432);
  plate.add(front);
  g.add(plate);
  const centre = new THREE.Vector3(k.pos.x + w / 2, k.pos.y + 0.12, k.pos.z + 0.5);
  return { group: g, obj: { plate, inlay, base: gc, i, centre } };
}

/** Per-frame key animation: sinks with `keyVis`, the strip brightens when pressed or on. */
export function updateKey(k: KeyObj, v: number, on: boolean): number {
  k.plate.position.y = 0.07 - v * 0.11;
  const b = (on ? 1.2 : 0.7) + v * 1.8;
  k.inlay.color.copy(k.base).multiplyScalar(b);
  return b;
}
