import * as THREE from 'three';

/**
 * Uniforms shared by every stage material: time, wind, the occlusion cutout
 * around Quaver, and the height fog that dissolves the level into the void or
 * the water below it. Materials opt in with `patch()`.
 */
export const SHARED = {
  uTime: { value: 0 },
  /** Cutout centre in drawing-buffer pixels. */
  uCutCenter: { value: new THREE.Vector2(-9999, -9999) },
  /** Cutout radius in drawing-buffer pixels. */
  uCutRadius: { value: 1 },
  /** View-space depth of Quaver. */
  uCutDepth: { value: 0 },
  /** World height of Quaver's feet. */
  uCutFeet: { value: 0 },
  uCutOn: { value: 1 },
  /** Height fog: x = height where it starts, y = height where it is full, z = strength. */
  uHFog: { value: new THREE.Vector3(1, -3, 1) },
  uHFogColor: { value: new THREE.Color('#000') },
  /** Water line (world y), or a large negative number when there is no water. */
  uWaterY: { value: -999 },
  uWaterColor: { value: new THREE.Color('#000') },
  /** Wind strength. */
  uWind: { value: 1 },
  /** Quaver's feet in simulation coordinates, for grass that bends away. */
  uPlayer: { value: new THREE.Vector3() },
};

export interface PatchOpts {
  /** Dither away fragments between the camera and Quaver. */
  cutout?: boolean;
  /** Height fog and waterline. */
  hfog?: boolean;
  /** Vertex sway from the `aWind` attribute (x = weight, y = phase). */
  wind?: boolean;
  /** Extra key so differently patched materials never share a program. */
  key?: string;
  /** Further edits after the common ones. */
  extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
}

const VERT_PARS = /* glsl */ `
uniform float uTime;
uniform float uWind;
varying float vCutViewZ;
varying float vCutWorldY;
#ifdef OPUS_WIND
attribute vec2 aWind;
#endif
`;

const FRAG_PARS = /* glsl */ `
uniform vec2 uCutCenter;
uniform float uCutRadius;
uniform float uCutDepth;
uniform float uCutFeet;
uniform float uCutOn;
uniform vec3 uHFog;
uniform vec3 uHFogColor;
uniform float uWaterY;
uniform vec3 uWaterColor;
varying float vCutViewZ;
varying float vCutWorldY;
`;

const WIND_VERT = /* glsl */ `
#ifdef OPUS_WIND
{
  float w = aWind.x * uWind;
  if (w > 0.0) {
    vec3 wp0 = transformed;
    #ifdef USE_INSTANCING
      wp0 = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    #endif
    float ph = uTime * 1.6 + wp0.x * 0.45 + wp0.z * 0.3 + aWind.y;
    float gust = 0.65 + 0.35 * sin(uTime * 0.37 + wp0.x * 0.05);
    transformed.x += sin(ph) * 0.07 * w * gust;
    transformed.z += cos(ph * 0.83) * 0.05 * w * gust;
    transformed.y += sin(ph * 1.3) * 0.012 * w;
  }
}
#endif
`;

const CUT_VERT = /* glsl */ `
{
  vec4 cutW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    cutW = instanceMatrix * cutW;
  #endif
  cutW = modelMatrix * cutW;
  vCutWorldY = cutW.y;
  vCutViewZ = -mvPosition.z;
}
`;

const CUT_FRAG = /* glsl */ `
#ifdef OPUS_CUTOUT
{
  float nearer = uCutDepth - vCutViewZ;
  if (uCutOn > 0.0 && nearer > 0.3 && vCutWorldY > uCutFeet + 0.14) {
    vec2 d = (gl_FragCoord.xy - uCutCenter) / uCutRadius;
    d.y *= 0.82;
    float r = length(d);
    float fade = (1.0 - smoothstep(0.5, 1.0, r)) * smoothstep(0.3, 1.1, nearer) * uCutOn;
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (dither < fade * 0.88) discard;
  }
}
#endif
`;

const HFOG_FRAG = /* glsl */ `
#ifdef OPUS_HFOG
{
  float hf = 1.0 - smoothstep(uHFog.y, uHFog.x, vCutWorldY);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHFogColor, hf * uHFog.z);
  if (uWaterY > -900.0) {
    float under = 1.0 - smoothstep(uWaterY - 1.6, uWaterY + 0.02, vCutWorldY);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uWaterColor, under * 0.85);
    float foam = 1.0 - smoothstep(0.0, 0.05, abs(vCutWorldY - uWaterY - 0.02));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uHFogColor * 1.1 + 0.04, foam * 0.35);
  }
}
#endif
`;

/**
 * Adds the shared features to a built-in material. Works with standard,
 * physical, lambert and basic materials (anything using `project_vertex`
 * and `fog_fragment`).
 */
export function patch<T extends THREE.Material>(material: T, o: PatchOpts = {}): T {
  const prev = material.onBeforeCompile.bind(material);
  const defines: Record<string, string> = {};
  if (o.cutout) defines.OPUS_CUTOUT = '';
  if (o.hfog) defines.OPUS_HFOG = '';
  if (o.wind) defines.OPUS_WIND = '';
  material.defines = { ...(material.defines ?? {}), ...defines };
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, SHARED);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERT}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${CUT_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CUT_FRAG}`)
      .replace('#include <fog_fragment>', `#include <fog_fragment>\n${HFOG_FRAG}`);
    o.extra?.(shader);
  };
  const key = `opus:${o.cutout ? 'c' : ''}${o.hfog ? 'h' : ''}${o.wind ? 'w' : ''}:${o.key ?? ''}`;
  material.customProgramCacheKey = () => key;
  return material;
}
