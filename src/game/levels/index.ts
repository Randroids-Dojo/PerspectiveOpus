import { compileLevel, type Level, type LevelDef } from '../level';
import { overture } from './overture';

export const LEVELS: LevelDef[] = [overture];

const cache = new Map<string, Level>();
export function getLevel(index: number): Level {
  const def = LEVELS[index];
  let lv = cache.get(def.info.id);
  if (!lv) {
    lv = compileLevel(def);
    cache.set(def.info.id, lv);
  }
  return lv;
}
