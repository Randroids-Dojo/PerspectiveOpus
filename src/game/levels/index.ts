import { compileLevel, type Level, type LevelDef } from '../level';
import { gallery } from './gallery';
import { overture } from './overture';
import { titleScene } from './title';

export const LEVELS: LevelDef[] = [overture];

const cache = new Map<string, Level>();
export const EXTRA_LEVELS: Record<string, LevelDef> = { gallery, title: titleScene };

export function getLevel(index: number | string): Level {
  const def = typeof index === 'string' ? EXTRA_LEVELS[index] ?? LEVELS[Number(index)] : LEVELS[index];
  let lv = cache.get(def.info.id);
  if (!lv) {
    lv = compileLevel(def);
    cache.set(def.info.id, lv);
  }
  return lv;
}
