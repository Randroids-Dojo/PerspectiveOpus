import { compileLevel, type Level, type LevelDef } from '../level';
import { adagio } from './adagio';
import { finale } from './finale';
import { gallery } from './gallery';
import { nocturne } from './nocturne';
import { overture } from './overture';
import { scherzo } from './scherzo';
import { titleScene } from './title';
import { toccata } from './toccata';

export const LEVELS: LevelDef[] = [overture, adagio, scherzo, nocturne, toccata, finale];

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
