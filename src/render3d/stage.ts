import * as THREE from 'three';
import { NO_DEPTH } from '../game/level';
import type { Palette } from '../game/palettes';
import { PLAYER, type Game } from '../game/sim';
import { MAT, MAT_NAMES, isSolidMat, type MatName } from '../game/types';
import { stagePose, type ViewState } from '../game/view';
import { lerpPos, type FrameInfo, type WorldRenderer } from '../render/types';

/** Placeholder stage renderer: plain boxes. Replaced by the full renderer. */
export class Stage implements WorldRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  private sim = new THREE.Group();
  private world = new THREE.Group();
  private player = new THREE.Mesh(new THREE.BoxGeometry(PLAYER.hw * 2, PLAYER.h, PLAYER.hd * 2), new THREE.MeshStandardMaterial({ color: '#111' }));
  private notes: THREE.Mesh[] = [];
  private bodies: THREE.Mesh[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    // The simulation's depth axis points away from the viewer; three.js's points towards it.
    // Everything lives in a mirrored group so it can be built in simulation coordinates.
    this.sim.scale.set(1, 1, -1);
    this.sim.add(this.world, this.player);
    this.scene.add(this.sim);
    this.scene.add(new THREE.HemisphereLight('#ddeeff', '#664422', 1.5));
    const sun = new THREE.DirectionalLight('#fff', 2);
    sun.position.set(-3, 6, -4);
    this.scene.add(sun);
  }

  load(game: Game, palette: Palette): void {
    this.world.clear();
    this.scene.background = new THREE.Color(palette.skyHorizon);
    const lv = game.level;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const byMat = new Map<number, THREE.Matrix4[]>();
    for (let z = 0; z < lv.d; z++)
      for (let y = 0; y < lv.h; y++)
        for (let x = 0; x < lv.w; x++) {
          const m = lv.cells[x + lv.w * (y + lv.h * z)];
          if (m === MAT.empty) continue;
          const list = byMat.get(m) ?? [];
          list.push(new THREE.Matrix4().makeTranslation(x + 0.5, y + 0.5, z + 0.5));
          byMat.set(m, list);
        }
    for (const [m, list] of byMat) {
      const name = MAT_NAMES[m] as MatName;
      const look = palette.mats[name];
      const mat = new THREE.MeshStandardMaterial({ color: look.color, roughness: look.rough, metalness: look.metal * 0.5 });
      const mesh = new THREE.InstancedMesh(m === MAT.thorn ? new THREE.ConeGeometry(0.4, 0.9, 5) : geo, mat, list.length);
      list.forEach((mx, i) => mesh.setMatrixAt(i, mx));
      this.world.add(mesh);
    }
    void NO_DEPTH;
    void isSolidMat;
    this.notes = lv.notes.map((n) => {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshStandardMaterial({ color: '#ffcc44', emissive: '#aa7700' }));
      m.position.set(n.pos.x, n.pos.y, n.pos.z);
      this.world.add(m);
      return m;
    });
    this.bodies = game.bodies.map((b) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: b.kind === 'drum' ? '#b5651d' : b.kind === 'gate' ? '#e0c060' : '#8b5a2b' }));
      this.world.add(m);
      return m;
    });
    const ex = new THREE.Mesh(new THREE.TorusGeometry(1, 0.15, 8, 24), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#886' }));
    ex.position.set(lv.exit.pos.x, lv.exit.pos.y + 1.2, lv.exit.pos.z);
    this.world.add(ex);
  }

  render(game: Game, view: ViewState, frame: FrameInfo): void {
    const pose = stagePose(view);
    this.camera.fov = pose.fovDeg;
    this.camera.near = pose.near;
    this.camera.far = pose.far;
    this.camera.aspect = view.w / view.h;
    this.camera.position.set(pose.position.x, pose.position.y, -pose.position.z);
    this.camera.lookAt(pose.target.x, pose.target.y, -pose.target.z);
    this.camera.updateProjectionMatrix();
    const p = lerpPos(game.player.prev, game.player.pos, frame.alpha);
    this.player.position.set(p.x, p.y + PLAYER.h / 2, p.z);
    this.player.visible = game.player.dead <= 0;
    game.level.notes.forEach((_, i) => (this.notes[i].visible = !game.notesTaken[i]));
    game.bodies.forEach((b, i) => {
      const m = this.bodies[i];
      m.visible = b.solid;
      m.scale.set(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
      m.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    });
    this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number, dpr: number): void {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
  }

  setVisible(v: boolean): void {
    this.canvas.style.visibility = v ? 'visible' : 'hidden';
  }
}
