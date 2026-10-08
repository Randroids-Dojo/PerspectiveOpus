import type { Vec3 } from '../core/math';
import { NO_DEPTH } from '../game/level';
import type { Game } from '../game/sim';
import { isSolidMat } from '../game/types';

/** The surface directly below Quaver, including stands, keys' gates and drums. */
export function groundBelow(game: Game, p: Vec3): number | null {
  const lv = game.level;
  const x = Math.floor(p.x);
  const z = Math.floor(p.z);
  const projected = game.mode === '2d' && !game.player.embedded;
  let best: number | null = null;
  if (x >= 0 && x < lv.w && (projected || (z >= 0 && z < lv.d))) {
    for (let y = Math.min(lv.h - 1, Math.floor(p.y - 0.04)); y >= 0; y--) {
      const solid = projected ? lv.front[x + lv.w * y] !== NO_DEPTH : isSolidMat(lv.cells[x + lv.w * (y + lv.h * z)]);
      if (solid) {
        best = y + 1;
        break;
      }
    }
  }
  for (const b of game.bodies) {
    if (!b.solid || b.max.y > p.y + 0.08) continue;
    if (p.x < b.min.x || p.x > b.max.x) continue;
    if (!projected && (p.z < b.min.z || p.z > b.max.z)) continue;
    best = Math.max(best ?? -Infinity, b.max.y);
  }
  return best;
}
