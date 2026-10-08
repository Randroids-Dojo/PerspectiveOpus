import * as THREE from 'three';
import type { Palette } from '../game/palettes';
import { patch } from './shared';
import { col } from './util';

/**
 * Materials shared by entities and decor. Geometry carries its colour in
 * vertex colours (built with GeoBucket), so a handful of materials cover
 * every prop and each bucket is one draw call.
 */
export class PropMaterials {
  /** Painted wood, stone, cloth, foliage. Sways by the `aWind` attribute. */
  readonly diffuse: THREE.MeshStandardMaterial;
  /** Brass, copper, iron. */
  readonly metal: THREE.MeshStandardMaterial;
  /** Polished stone and lacquer. */
  readonly gloss: THREE.MeshStandardMaterial;
  /** Self-lit glass, flames, crystals. Flickers by `aWind.y` (phase), steady when 0. */
  readonly glow: THREE.MeshBasicMaterial;
  /** Gold leaf for notes and the fermata. */
  readonly gold: THREE.MeshStandardMaterial;
  /** Burnished gold for gates: bright but not glowing. */
  readonly goldDim: THREE.MeshStandardMaterial;
  /** Translucent cloth for curtains and banners (double sided). */
  readonly cloth: THREE.MeshStandardMaterial;

  constructor() {
    this.diffuse = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }), {
      cutout: true,
      hfog: true,
      wind: true,
      key: 'pdiffuse',
    });
    this.cloth = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }), {
      cutout: true,
      hfog: true,
      wind: true,
      key: 'pcloth',
    });
    this.metal = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 1 }), {
      cutout: true,
      hfog: true,
      wind: true,
      key: 'pmetal',
    });
    this.gloss = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0 }), {
      cutout: true,
      hfog: true,
      key: 'pgloss',
    });
    this.glow = patch(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.2, 2.2) }), {
      hfog: false,
      key: 'pglow',
      extra: (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec2 aWind;\nvarying float vFlick;')
          .replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvFlick = aWind.y > 0.0 ? 0.82 + 0.18 * sin(uTime * 11.0 + aWind.y * 17.0) * sin(uTime * 7.3 + aWind.y * 5.0) : 1.0;',
          );
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vFlick;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFlick;');
      },
    });
    this.gold = new THREE.MeshStandardMaterial({ color: '#e3a53c', metalness: 1, roughness: 0.26, emissive: '#ffb030', emissiveIntensity: 0.5 });
    this.goldDim = patch(new THREE.MeshStandardMaterial({ color: '#e8b048', metalness: 1, roughness: 0.3, emissive: '#9a6418', emissiveIntensity: 0.5 }), {
      cutout: true,
      hfog: true,
      key: 'pgolddim',
    });
  }

  setPalette(p: Palette): void {
    this.gold.emissive.copy(col(p.glow));
    this.gold.emissiveIntensity = p.id === 'night' ? 0.6 : 0.35;
    this.gold.color.copy(col('#e3a53c')).lerp(col(p.glow), 0.12);
  }
}
