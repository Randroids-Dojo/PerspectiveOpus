import * as THREE from 'three';
import type { Palette } from '../game/palettes';
import type { Game } from '../game/sim';
import type { PaletteId } from '../game/types';
import { stagePose, type ViewState } from '../game/view';
import type { FrameInfo, Quality, WorldRenderer } from '../render/types';
import { Backdrop } from './backdrop';
import { Decor } from './decor';
import { Effects } from './effects';
import { Entities } from './entities';
import { Flora, Thorns } from './flora';
import { lookFor, type Look } from './look';
import { Post } from './post';
import { PropMaterials } from './props';
import { Quaver } from './quaver';
import { SHARED } from './shared';
import { Bag, clearGroup, col } from './util';
import { WorldMaterial, buildWorld } from './worldmesh';

const TAN_MAX = Math.tan((20 * Math.PI) / 180);

/**
 * The Stage: the lit 3D world, a theatrical diorama.
 *
 * Two passes share one frame: the backdrop (sky, silhouettes, water) with its
 * own normal-lens camera, then the level with the shared stage camera from
 * `stagePose`. At swing 0 that camera is almost orthographic and matches the
 * page projection exactly. Everything in the level lives in a group mirrored
 * in z so it can be built in simulation coordinates.
 */
export class Stage implements WorldRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 1000);
  private bgCamera = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 6000);
  private sim = new THREE.Group();
  private levelGroup = new THREE.Group();
  private hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  private sun = new THREE.DirectionalLight('#ffffff', 2);
  private spot = new THREE.SpotLight('#ffd8a6', 6, 0, 0.42, 0.85, 1.2);
  private sunDir = new THREE.Vector3(0, 1, 0);
  private post: Post;
  private backdrop = new Backdrop();
  private worldMat: WorldMaterial | null = null;
  private props = new PropMaterials();
  private flora = new Flora();
  private thorns = new Thorns();
  private entities: Entities;
  private decor = new Decor();
  private effects = new Effects();
  private quaver = new Quaver();
  private bag = new Bag();
  private palette: Palette | null = null;
  private look: Look | null = null;
  private applied: Quality | null = null;
  private envs = new Map<PaletteId, THREE.Texture>();
  private pmrem: THREE.PMREMGenerator;
  private cssW = 1280;
  private cssH = 720;
  private dpr = 1;
  private pr = 1;
  private clock = 0;
  /** Resolution scale chosen by the frame-time guard (1 = full budget). */
  private resScale = 1;
  private dts: number[] = [];
  private calmFor = 0;
  private wasPaused = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage';
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.post = new Post(this.renderer);
    this.entities = new Entities(this.props);
    // The simulation's depth axis points away from the viewer; three.js's points towards it.
    // Everything lives in a mirrored group so it can be built in simulation coordinates.
    this.sim.scale.set(1, 1, -1);
    this.sim.add(this.levelGroup, this.flora.group, this.thorns.group, this.entities.group, this.decor.group, this.quaver.group, this.effects.group);
    this.scene.add(this.sim, this.hemi, this.sun, this.sun.target, this.spot, this.spot.target);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.spot.castShadow = false;
  }

  load(game: Game, palette: Palette): void {
    const t0 = performance.now();
    this.bag.dispose();
    clearGroup(this.levelGroup);
    this.palette = palette;
    const look = lookFor(palette);
    this.look = look;
    if (!this.worldMat) this.worldMat = new WorldMaterial();
    this.worldMat.setPalette(palette);
    this.props.setPalette(palette);
    const lv = game.level;
    const bag = this.bag;

    const world = buildWorld(lv, palette, this.worldMat.material, bag);
    for (const m of world.meshes) this.levelGroup.add(m);
    for (const m of world.meshes) m.updateMatrix();

    // Cells where tufts would poke through props.
    const blocked = new Set<number>();
    const block = (x: number, y: number, z: number) => blocked.add(x + lv.w * (y + lv.h * z));
    for (const k of lv.keys) for (let i = 0; i < k.width; i++) block(k.pos.x + i, k.pos.y, k.pos.z);
    for (const d of lv.drums) block(d.pos.x, d.pos.y, d.pos.z);
    for (const c of lv.checkpoints) block(Math.floor(c.pos.x), c.pos.y, Math.floor(c.pos.z));
    for (let i = -1; i <= 1; i++) block(Math.floor(lv.exit.pos.x) + i, lv.exit.pos.y, Math.floor(lv.exit.pos.z));
    for (const g of lv.gates) for (let x = g.min.x; x < g.max.x; x++) for (let z = g.min.z; z < g.max.z; z++) block(x, g.min.y, z);
    this.flora.build(lv, palette, world.capTops, blocked, bag);
    this.thorns.build(lv, palette, world.thorns, bag);
    this.entities.build(game, palette, bag);
    this.decor.build(lv, palette, this.props, bag);
    this.effects.load(palette, look);
    this.quaver.reset();
    this.quaver.setGlow(palette.glow);

    // Light rig.
    this.hemi.color.copy(col(palette.hemiSky));
    this.hemi.groundColor.copy(col(palette.hemiGround));
    this.hemi.intensity = look.hemi;
    this.sun.color.copy(col(palette.sun));
    this.sun.intensity = palette.sunIntensity * look.sun;
    this.sunDir.set(palette.sunDir[0], palette.sunDir[1], -palette.sunDir[2]).normalize();
    this.spot.color.copy(col(look.spotColor));
    this.spot.intensity = look.spot;
    this.scene.fog = new THREE.Fog(col(palette.fog).lerp(col(palette.skyHorizon), 0.35), 10, 100);
    this.scene.environment = this.envFor(palette);
    this.scene.environmentIntensity = look.env;

    this.backdrop.load(lv, palette, look, world.heights);
    SHARED.uWaterY.value = this.backdrop.waterY;
    if (palette.water) SHARED.uWaterColor.value.copy(col(palette.water)).lerp(col(palette.fog), 0.3);
    SHARED.uHFogColor.value.copy(col(palette.skyBottom)).lerp(col(palette.fog), 0.45);
    if (palette.water) SHARED.uHFogColor.value.copy(col(palette.fog)).lerp(col(palette.water), 0.4);
    SHARED.uHFog.value.set(look.hfogTop, look.hfogBottom, palette.water ? 0 : 1);
    this.applied = null;
    const ms = performance.now() - t0;
    (window as unknown as { __stageLoadMs?: number }).__stageLoadMs = ms;
  }

  /** A soft studio environment in the palette's colours, for reflections on gold, brass and lacquer. */
  private envFor(p: Palette): THREE.Texture {
    const hit = this.envs.get(p.id);
    if (hit) return hit;
    const scene = new THREE.Scene();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(10, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          top: { value: col(p.skyTop) },
          mid: { value: col(p.skyHorizon) },
          ground: { value: col(p.hemiGround) },
        },
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'uniform vec3 top; uniform vec3 mid; uniform vec3 ground; varying vec3 vP; void main(){ float e = normalize(vP).y; vec3 c = e > 0.0 ? mix(mid, top, smoothstep(0.0, 0.7, e)) : mix(mid, ground, smoothstep(0.0, 0.3, -e)); gl_FragColor = vec4(c, 1.0); }',
      }),
    );
    scene.add(sky);
    // Soft boxes: a warm key above the audience, a cool rim behind, a glow from below, like stage lights.
    const panel = (c: THREE.Color, x: number, y: number, z: number, s: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      scene.add(m);
    };
    panel(col(p.sun).multiplyScalar(3), -4, 6, 4, 4);
    panel(col(p.hemiSky).multiplyScalar(1.6), 5, 3, -5, 5);
    panel(col(p.glow).multiplyScalar(1.5), 0, -2, 7, 3);
    const rt = this.pmrem.fromScene(scene, 0.02);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.envs.set(p.id, rt.texture);
    return rt.texture;
  }

  private applyQuality(q: Quality): void {
    if (q === this.applied) return;
    this.applied = q;
    const size = q === 'high' ? 2048 : 1024;
    this.sun.castShadow = q !== 'low';
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.sun.shadow.radius = q === 'high' ? 3 : 2;
    this.spot.visible = q === 'high';
    this.renderer.toneMapping = q === 'low' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    if (this.look) this.renderer.toneMappingExposure = this.look.exposure * 1.05;
    this.flora.setQuality(q);
    this.effects.setQuality(q);
    if (this.look) this.post.setLook(this.look, q === 'high' ? 1 : 0.85);
    this.resize(this.cssW, this.cssH, this.dpr);
  }

  render(game: Game, view: ViewState, frame: FrameInfo): void {
    if (!this.palette || !this.look) return;
    const q = frame.quality;
    this.applyQuality(q);
    this.adaptResolution(frame);
    // Nothing moves while a menu is up: keep the last shadow map.
    this.renderer.shadowMap.autoUpdate = !frame.paused || !this.wasPaused;
    this.wasPaused = frame.paused;
    this.clock += frame.gameDt;
    SHARED.uTime.value = this.clock;

    // The stage camera, exactly as the shared view describes it.
    const pose = stagePose(view);
    const cam = this.camera;
    const t = view.reduceMotion ? 1 : view.swing;
    const shake = view.shake * t * 0.12;
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    cam.fov = pose.fovDeg;
    cam.near = pose.near;
    cam.far = pose.far;
    cam.aspect = view.w / view.h;
    cam.position.set(pose.position.x + sx, pose.position.y + sy, -pose.position.z);
    cam.lookAt(pose.target.x + sx, pose.target.y + sy, -pose.target.z);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const fog = this.scene.fog as THREE.Fog;
    fog.near = pose.dist + this.look.fogStart;
    fog.far = pose.dist + this.look.fogEnd;

    // The backdrop camera looks the same way but never narrower than a normal lens.
    const tanHalf = Math.tan((pose.fovDeg * Math.PI) / 360);
    const dBg = (pose.dist * tanHalf) / TAN_MAX;
    this.dir.set(pose.position.x - pose.target.x, pose.position.y - pose.target.y, pose.position.z - pose.target.z).normalize();
    this.focus.set(pose.target.x, pose.target.y, -pose.target.z);
    this.bgCamera.position.set(pose.target.x + this.dir.x * dBg, pose.target.y + this.dir.y * dBg, -(pose.target.z + this.dir.z * dBg));
    this.bgCamera.fov = 40;
    this.bgCamera.aspect = cam.aspect;
    this.bgCamera.lookAt(this.focus);
    this.bgCamera.updateProjectionMatrix();
    this.bgCamera.updateMatrixWorld();
    this.backdrop.update(this.bgCamera, this.clock);

    this.fitShadow(this.focus, view);

    // Animate the world.
    this.sim.updateMatrixWorld();
    const halos = this.effects.halos;
    halos.begin();
    this.quaver.update(game, frame, this.sim);
    const feet = this.quaver.feet;
    SHARED.uPlayer.value.copy(feet);
    this.entities.update(game, frame, halos, feet, this.clock);
    this.decor.update(this.clock, halos);
    this.thorns.update(this.clock);
    this.effects.handle(frame.events, game, feet);
    this.effects.update(frame.gameDt, game, this.tmp.set(pose.target.x, pose.target.y, pose.target.z), this.clock);
    halos.end();

    // Warm key on Quaver from above the audience.
    this.spot.position.set(feet.x - 2.2, feet.y + 6.5, -(feet.z - 4.5));
    this.spot.target.position.set(feet.x, feet.y + 0.3, -feet.z);
    this.spot.target.updateMatrixWorld();

    this.updateCutout(game);

    const r = this.renderer;
    r.autoClear = false;
    if (q === 'low') {
      r.setRenderTarget(null);
      r.clear(true, true, false);
      r.render(this.backdrop.scene, this.bgCamera);
    } else {
      r.setRenderTarget(this.post.bgRT);
      r.clear(true, true, false);
      r.render(this.backdrop.scene, this.bgCamera);
      r.setRenderTarget(this.post.sceneRT);
      r.clear(true, true, false);
      this.post.drawBackdrop();
    }
    r.clearDepth();
    r.render(this.scene, cam);
    if (q !== 'low') this.post.finish(frame.now, true);
  }

  /**
   * If frames stay slow (an integrated GPU at a high pixel ratio), lower the
   * resolution in steps; raise it again once there is headroom.
   */
  private adaptResolution(frame: FrameInfo): void {
    if (frame.paused || frame.dt <= 0 || frame.dt > 0.25) return;
    this.dts.push(frame.dt);
    if (this.dts.length < 90) return;
    const sorted = [...this.dts].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    this.dts.length = 0;
    let next = this.resScale;
    if (med > 1 / 48) {
      next = Math.max(0.6, this.resScale - 0.1);
      this.calmFor = 0;
    } else if (med < 1 / 58 && this.resScale < 1) {
      this.calmFor++;
      if (this.calmFor >= 3) {
        next = Math.min(1, this.resScale + 0.05);
        this.calmFor = 0;
      }
    }
    if (next !== this.resScale) {
      this.resScale = next;
      this.resize(this.cssW, this.cssH, this.dpr);
    }
  }

  /** Screen-space hole around Quaver for geometry between the camera and them. */
  private updateCutout(game: Game): void {
    const f = this.quaver.feet;
    const c = this.tmp.set(f.x, f.y + 0.45, -f.z);
    const up = this.tmp2.set(f.x, f.y + 1.45, -f.z);
    SHARED.uCutDepth.value = -c.clone().applyMatrix4(this.camera.matrixWorldInverse).z;
    c.project(this.camera);
    up.project(this.camera);
    const bw = this.cssW * this.pr;
    const bh = this.cssH * this.pr;
    const px = (c.x * 0.5 + 0.5) * bw;
    const py = (c.y * 0.5 + 0.5) * bh;
    const ux = (up.x * 0.5 + 0.5) * bw;
    const uy = (up.y * 0.5 + 0.5) * bh;
    SHARED.uCutCenter.value.set(px, py);
    SHARED.uCutRadius.value = Math.max(8, Math.hypot(ux - px, uy - py) * 1.25);
    SHARED.uCutFeet.value = f.y;
    SHARED.uCutOn.value = game.player.dead > 0 ? 0 : 1;
  }

  private fitShadow(focus: THREE.Vector3, view: ViewState): void {
    const sh = this.sun.shadow;
    const t = view.swing;
    const visW = (view.w / view.ppu) * 0.5;
    const S = THREE.MathUtils.lerp(visW + 3, 19, t) + view.orbit.dist * 0.4;
    const cam = sh.camera as THREE.OrthographicCamera;
    if (cam.right !== S) {
      cam.left = -S;
      cam.right = S;
      cam.top = S;
      cam.bottom = -S;
      cam.near = 1;
      cam.far = 170;
      cam.updateProjectionMatrix();
    }
    const L = this.sunDir;
    const right = this.tmp.set(0, 1, 0).cross(L).normalize();
    const up = this.tmp2.crossVectors(L, right);
    const texel = (2 * S) / sh.mapSize.x;
    const fx = Math.round(focus.dot(right) / texel) * texel;
    const fy = Math.round(focus.dot(up) / texel) * texel;
    const fz = focus.dot(L);
    const c = this.sun.target.position.set(0, 0, 0).addScaledVector(right, fx).addScaledVector(up, fy).addScaledVector(L, fz);
    this.sun.position.copy(c).addScaledVector(L, 85);
    this.sun.target.updateMatrixWorld();
  }

  resize(w: number, h: number, dpr: number): void {
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    const q = this.applied ?? 'high';
    // A pixel budget per tier keeps fill rate in check on high-density screens.
    const budget = q === 'high' ? 1.6e6 : q === 'medium' ? 1.0e6 : 0.8e6;
    const pr = Math.max(0.5, Math.min(dpr, Math.sqrt(budget / Math.max(1, w * h))) * this.resScale);
    this.pr = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    const bw = Math.round(w * pr);
    const bh = Math.round(h * pr);
    this.post.setSize(bw, bh, q === 'high' ? 5 : 4, q === 'high' ? 4 : q === 'medium' ? 2 : 0, q === 'high' ? 2 : 4);
  }

  setVisible(v: boolean): void {
    this.canvas.style.visibility = v ? 'visible' : 'hidden';
  }
}
