import type { SongId } from '../../audio';
import type { SongDef } from '../types';
import { adagio } from './adagio';
import { ending } from './ending';
import { finale } from './finale';
import { nocturne } from './nocturne';
import { overture } from './overture';
import { scherzo } from './scherzo';
import { title } from './title';
import { toccata } from './toccata';

export const SONGS: Record<SongId, SongDef> = { title, overture, adagio, scherzo, nocturne, toccata, finale, ending };
