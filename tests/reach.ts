import { NO_DEPTH, type Level } from '../src/game/level';
import { PHYS } from '../src/game/sim';
import { MAT, isSolidMat, type Mode } from '../src/game/types';

/**
 * An optimistic reachability search used to check puzzle intent: can a movement
 * be finished without ever switching? Standing spots are cells with something
 * solid below and room above. Jumps are judged by the real jump arc. Moving
 * platforms count as standable all along their paths, gates that a key raises
 * count as standable and gates a key lowers count as open, drums launch high.
 * Obstacles are checked roughly along the jump line. Being optimistic, "cannot
 * reach" is a strong answer; "can reach" means look closer.
 */
export function canFinishIn(level: Level, mode: Mode): { reached: boolean; explored: number; furthest: number } {
  const { w, h, d } = level;
  const flat = mode === '2d';
  const D = flat ? 1 : d;
  const extra = new Uint8Array(w * h * d); // 1 = extra floor (platform path, raised gate), 2 = drum top
  const drumPower = new Map<number, number>();
  const idx = (x: number, y: number, z: number) => x + w * (y + h * z);
  const mark = (x: number, y: number, z: number, v: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) return;
    extra[idx(x, y, z)] = Math.max(extra[idx(x, y, z)], v);
  };
  for (const p of level.platforms) {
    for (let i = 0; i < p.path.length; i++) {
      const a = p.path[i];
      const b = p.path[(i + 1) % p.path.length];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)) + 1;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x0 = Math.round(a.x + (b.x - a.x) * t);
        const y0 = Math.round(a.y + (b.y - a.y) * t);
        const z0 = Math.round(a.z + (b.z - a.z) * t);
        for (let dx = 0; dx < p.size.x; dx++) for (let dz = 0; dz < p.size.z; dz++) mark(x0 + dx, y0 + p.size.y - 1, z0 + dz, 1);
      }
    }
  }
  for (const g of level.gates)
    if (g.solidWhenOn)
      for (let x = g.min.x; x < g.max.x; x++) for (let z = g.min.z; z < g.max.z; z++) mark(x, g.max.y - 1, z, 1);
  for (const dr of level.drums) {
    mark(dr.pos.x, dr.pos.y, dr.pos.z, 2);
    drumPower.set(idx(dr.pos.x, dr.pos.y, dr.pos.z), dr.power);
  }

  const solid3 = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < w && y < h && z < d && isSolidMat(level.cells[idx(x, y, z)]);
  const thorn3 = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < w && y < h && z < d && level.cells[idx(x, y, z)] === MAT.thorn;
  const solid = (x: number, y: number, z: number) => (flat ? x >= 0 && y >= 0 && x < w && y < h && level.front[x + w * y] !== NO_DEPTH : solid3(x, y, z));
  const thorn = (x: number, y: number, z: number) => (flat ? x >= 0 && y >= 0 && x < w && y < h && level.thornCol[x + w * y] === 1 : thorn3(x, y, z));
  const floorBelow = (x: number, y: number, z: number): number => {
    // 0 none, 1 floor, 2 drum
    if (flat) {
      for (let zz = 0; zz < d; zz++) if (extra[idx(x, y, zz)] === 2) return 2;
      if (solid(x, y - 1, 0)) return 1;
      let best = 0;
      for (let zz = 0; zz < d; zz++) {
        const e = y - 1 >= 0 ? extra[idx(x, y - 1, zz)] : 0;
        if (e === 1) best = Math.max(best, 1);
        const dr = extra[idx(x, y, zz)] === 2;
        if (dr) best = 2;
      }
      return best;
    }
    if (extra[idx(x, y, z)] === 2) return 2;
    if (solid3(x, y - 1, z)) return 1;
    if (y - 1 >= 0 && extra[idx(x, y - 1, z)] === 1) return 1;
    return 0;
  };
  const standable = (x: number, y: number, z: number) =>
    !solid(x, y, z) && !thorn(x, y, z) && !(level.info.water !== undefined && y < level.info.water) && floorBelow(x, y, z) > 0;

  // Horizontal reach for a given rise, from the real jump constants.
  const reachFor = (rise: number, launchV: number): number => {
    let y = 0;
    let v = launchV;
    let t = 0;
    let peaked = false;
    for (let i = 0; i < 2000; i++) {
      const g = v < 0 ? PHYS.gravity * PHYS.fallMul : Math.abs(v) < PHYS.apexBand ? PHYS.gravity * PHYS.apexMul : PHYS.gravity;
      v = Math.max(v - g / 120, -PHYS.maxFall);
      y += v / 120;
      t += 1 / 120;
      if (v < 0) peaked = true;
      if (peaked && y <= rise) return PHYS.run * (t + PHYS.coyote) + 0.9;
    }
    return 0;
  };
  const reachCache = new Map<string, number>();
  const reach = (rise: number, v: number) => {
    const k = `${rise}:${v}`;
    let r = reachCache.get(k);
    if (r === undefined) reachCache.set(k, (r = reachFor(rise, v)));
    return r;
  };

  const clearLine = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean => {
    const top = Math.max(ay, by);
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) * 3) + 1;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = Math.floor(ax + 0.5 + (bx - ax) * t);
      const z = Math.floor(az + 0.5 + (bz - az) * t);
      if (solid(x, top, flat ? 0 : z) || solid(x, top + 1, flat ? 0 : z)) return false;
    }
    return true;
  };

  const sx = Math.floor(level.spawn.x);
  const sy = Math.round(level.spawn.y);
  const sz = flat ? 0 : Math.floor(level.spawn.z);
  const ex = Math.floor(level.exit.pos.x);
  const ey = Math.round(level.exit.pos.y);
  const ez = Math.floor(level.exit.pos.z);
  const seen = new Uint8Array(w * h * d);
  const queue: number[] = [];
  const push = (x: number, y: number, z: number) => {
    const i = idx(x, y, z);
    if (seen[i]) return;
    seen[i] = 1;
    queue.push(i);
  };
  // The spawn may sit above a shallow drop; settle it.
  let y0 = sy;
  while (y0 > 0 && !standable(sx, y0, sz)) y0--;
  push(sx, y0, sz);
  const baseV = PHYS.jumpV;
  let furthest = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const x = i % w;
    const y = Math.floor(i / w) % h;
    const z = Math.floor(i / (w * h));
    furthest = Math.max(furthest, x);
    if (x === ex && Math.abs(y - ey) <= 1 && (flat || Math.abs(z - ez) <= 1)) return { reached: true, explored: queue.length, furthest };
    const onDrum = floorBelow(x, y, z) === 2;
    const power = onDrum ? (flat ? 5.5 : drumPower.get(idx(x, y, z)) ?? 5.5) : 0;
    const v = onDrum ? Math.sqrt(2 * PHYS.gravity * power) : baseV;
    const maxRise = onDrum ? Math.floor(power + 0.72) : 2;
    const R = Math.ceil(reach(-12, v));
    for (let ny = Math.max(0, y - 14); ny <= Math.min(h - 1, y + maxRise); ny++) {
      const r = reach(ny - y, v);
      if (r <= 0) continue;
      const rr = Math.min(R, Math.ceil(r));
      for (let nz = flat ? 0 : Math.max(0, z - rr); nz <= (flat ? 0 : Math.min(D - 1, z + rr)); nz++)
        for (let nx = Math.max(0, x - rr); nx <= Math.min(w - 1, x + rr); nx++) {
          if (seen[idx(nx, ny, nz)]) continue;
          if (Math.hypot(nx - x, nz - z) > r) continue;
          if (!standable(nx, ny, nz)) continue;
          if (!clearLine(x, y, z, nx, ny, nz)) continue;
          push(nx, ny, nz);
        }
    }
  }
  return { reached: false, explored: queue.length, furthest };
}
