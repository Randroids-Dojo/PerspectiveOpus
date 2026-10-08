import * as THREE from 'three';
import type { Look } from './look';

/**
 * HDR post chain: the scene renders into a half-float target (MSAA at high),
 * a dual-filter bloom picks up gold and glows, and one composite pass does
 * exposure, ACES tone mapping, a per-palette grade, vignette, grain and the
 * sRGB conversion. Kept to a handful of cheap passes for integrated GPUs.
 */

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const PREFILTER = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
vec3 pick(vec2 uv) {
  vec3 c = texture2D(tSrc, uv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * 0.5;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);
  return min(c * w, vec3(30.0));
}
void main() {
  vec2 o = uTexel * 0.5;
  vec3 c = pick(vUv + vec2(-o.x, -o.y)) + pick(vUv + vec2(o.x, -o.y)) + pick(vUv + vec2(-o.x, o.y)) + pick(vUv + vec2(o.x, o.y));
  gl_FragColor = vec4(c * 0.25, 1.0);
}
`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 o = uTexel;
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb;
  c += texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb;
  c += texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb;
  c += texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}
`;

const UP = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec2 o = uTexel;
  vec3 c = texture2D(tSrc, vUv + vec2(-o.x * 2.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(0.0, o.y * 2.0)).rgb;
  c += texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(o.x * 2.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(0.0, -o.y * 2.0)).rgb;
  c += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
  gl_FragColor = vec4(c / 12.0 * uWeight, 1.0);
}
`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSat;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform vec2 uRes;
uniform float uHasBloom;
varying vec2 vUv;

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 ACESInputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602));
  color = ACESInputMat * (color / 0.6);
  color = RRTAndODTFit(color);
  return clamp(ACESOutputMat * color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  if (uHasBloom > 0.5) c += texture2D(tBloom, vUv).rgb * uBloom;
  c = aces(c * uExposure);
  c = toSRGB(c);
  // Lift, gamma, gain.
  c = uGain * (c + uLift * (1.0 - c));
  c = pow(max(c, vec3(0.0)), 1.0 / uGamma);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  // Vignette, a little oval.
  vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 0.9;
  float v = smoothstep(0.25, 1.05, length(q));
  c *= 1.0 - v * uVignette;
  // Film grain, stronger in the mids.
  float g = hash(vUv * uRes + fract(uTime * 13.17) * 97.0) - 0.5;
  c += g * uGrain * (0.4 + 0.6 * (1.0 - abs(l - 0.5) * 2.0));
  // Dither against banding in skies.
  c += (hash(vUv * uRes + 3.7) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

const BG_BLUR = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 o = uTexel;
  vec3 c = texture2D(tSrc, vUv).rgb * 0.4;
  c += texture2D(tSrc, vUv + vec2(o.x, o.y * 0.5)).rgb * 0.15;
  c += texture2D(tSrc, vUv + vec2(-o.x, -o.y * 0.5)).rgb * 0.15;
  c += texture2D(tSrc, vUv + vec2(-o.x * 0.5, o.y)).rgb * 0.15;
  c += texture2D(tSrc, vUv + vec2(o.x * 0.5, -o.y)).rgb * 0.15;
  gl_FragColor = vec4(c, 1.0);
}
`;

export class Post {
  readonly sceneRT: THREE.WebGLRenderTarget;
  /** The backdrop renders here at reduced resolution, then is softened into the scene. */
  readonly bgRT: THREE.WebGLRenderTarget;
  private bgBlur: THREE.ShaderMaterial;
  private mips: THREE.WebGLRenderTarget[] = [];
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private scene = new THREE.Scene();
  private prefilter: THREE.ShaderMaterial;
  private down: THREE.ShaderMaterial;
  private up: THREE.ShaderMaterial;
  readonly composite: THREE.ShaderMaterial;
  private levels = 5;
  private w = 1;
  private h = 1;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      samples: 4,
    });
    this.sceneRT.texture.generateMipmaps = false;
    this.bgRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.bgRT.texture.generateMipmaps = false;
    const mk = (frag: string, uniforms: Record<string, THREE.IUniform>, blend = false) =>
      new THREE.ShaderMaterial({
        vertexShader: FS_VERT,
        fragmentShader: frag,
        uniforms,
        depthTest: false,
        depthWrite: false,
        blending: blend ? THREE.AdditiveBlending : THREE.NoBlending,
        toneMapped: false,
      });
    this.prefilter = mk(PREFILTER, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 } });
    this.down = mk(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = mk(UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, true);
    this.composite = mk(COMPOSITE, {
      tScene: { value: this.sceneRT.texture },
      tBloom: { value: null },
      uBloom: { value: 0.6 },
      uExposure: { value: 1 },
      uLift: { value: new THREE.Vector3() },
      uGamma: { value: new THREE.Vector3(1, 1, 1) },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSat: { value: 1 },
      uContrast: { value: 1 },
      uVignette: { value: 0.3 },
      uGrain: { value: 0.03 },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uHasBloom: { value: 1 },
    });
    this.bgBlur = mk(BG_BLUR, { tSrc: { value: this.bgRT.texture }, uTexel: { value: new THREE.Vector2() } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Sizes in drawing-buffer pixels. `levels` is the bloom depth; `samples` the MSAA count. */
  setSize(w: number, h: number, levels: number, samples: number, firstDiv: number): void {
    this.w = w;
    this.h = h;
    this.levels = levels;
    if (this.sceneRT.samples !== samples) {
      this.sceneRT.dispose();
      this.sceneRT.samples = samples;
    }
    this.sceneRT.setSize(w, h);
    const bw = Math.max(1, Math.round(w / 2));
    const bh = Math.max(1, Math.round(h / 2));
    this.bgRT.setSize(bw, bh);
    (this.bgBlur.uniforms.uTexel.value as THREE.Vector2).set(1 / bw, 1 / bh);
    for (const m of this.mips) m.dispose();
    this.mips = [];
    let mw = Math.max(1, Math.round(w / firstDiv));
    let mh = Math.max(1, Math.round(h / firstDiv));
    for (let i = 0; i < levels; i++) {
      const rt = new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, depthBuffer: false });
      rt.texture.generateMipmaps = false;
      rt.texture.minFilter = THREE.LinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
      this.mips.push(rt);
      mw = Math.max(1, Math.round(mw / 2));
      mh = Math.max(1, Math.round(mh / 2));
    }
    (this.composite.uniforms.uRes.value as THREE.Vector2).set(w, h);
    this.composite.uniforms.tBloom.value = this.mips[0]?.texture ?? null;
  }

  setLook(look: Look, bloomScale: number): void {
    const u = this.composite.uniforms;
    u.uBloom.value = look.bloom * bloomScale;
    u.uExposure.value = look.exposure;
    (u.uLift.value as THREE.Vector3).set(...look.grade.lift);
    (u.uGamma.value as THREE.Vector3).set(...look.grade.gamma);
    (u.uGain.value as THREE.Vector3).set(...look.grade.gain);
    u.uSat.value = look.grade.sat;
    u.uContrast.value = look.grade.contrast;
    u.uVignette.value = look.vignette;
    u.uGrain.value = look.grain;
    this.prefilter.uniforms.uThreshold.value = look.bloomThreshold;
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null, clear: boolean): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    if (clear) this.renderer.clear(true, false, false);
    this.renderer.render(this.scene, this.cam);
  }

  /** Draws the softened backdrop into the scene target (which must be bound). */
  drawBackdrop(): void {
    const r = this.renderer;
    this.quad.material = this.bgBlur;
    r.render(this.scene, this.cam);
  }

  /** Runs bloom and the composite to the screen. The scene must already be in `sceneRT`. */
  finish(time: number, bloom: boolean): void {
    const r = this.renderer;
    const auto = r.autoClear;
    r.autoClear = false;
    const u = this.composite.uniforms;
    u.uTime.value = time;
    u.uHasBloom.value = bloom && this.levels > 0 ? 1 : 0;
    if (bloom && this.levels > 0) {
      this.prefilter.uniforms.tSrc.value = this.sceneRT.texture;
      (this.prefilter.uniforms.uTexel.value as THREE.Vector2).set(1 / this.w, 1 / this.h);
      this.pass(this.prefilter, this.mips[0], false);
      for (let i = 1; i < this.levels; i++) {
        const src = this.mips[i - 1];
        this.down.uniforms.tSrc.value = src.texture;
        (this.down.uniforms.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
        this.pass(this.down, this.mips[i], false);
      }
      for (let i = this.levels - 1; i > 0; i--) {
        const src = this.mips[i];
        this.up.uniforms.tSrc.value = src.texture;
        (this.up.uniforms.uTexel.value as THREE.Vector2).set(0.5 / src.width, 0.5 / src.height);
        this.up.uniforms.uWeight.value = 1;
        this.pass(this.up, this.mips[i - 1], false);
      }
    }
    this.pass(this.composite, null, false);
    r.autoClear = auto;
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.bgRT.dispose();
    this.bgBlur.dispose();
    for (const m of this.mips) m.dispose();
    this.prefilter.dispose();
    this.down.dispose();
    this.up.dispose();
    this.composite.dispose();
  }
}
