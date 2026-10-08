import { it } from 'vitest';
import { compileLevel } from '../src/game/level';
import { Game } from '../src/game/sim';
const info = { id: 't', index: 0, movement: 'Test', title: 'Test', epigraph: '', palette: 'dawn' as const, tempo: '' };
it('metrics', () => {
  const lv = compileLevel({ info, size: [60, 20, 3], build(b) { b.box(0, 0, 0, 60, 1, 3); b.spawn(1, 1, 1); } });
  const g = new Game(lv, '3d');
  // get to full speed
  for (let i = 0; i < 120; i++) g.step(1/120, { moveX: 1, moveZ: 0, jumpHeld: false, jumpPressed: false, switchPressed: false });
  const x0 = g.player.pos.x; let maxY = 0; let t = 0; let peakT = 0;
  g.step(1/120, { moveX: 1, moveZ: 0, jumpHeld: true, jumpPressed: true, switchPressed: false });
  for (let i = 0; i < 300; i++) {
    g.step(1/120, { moveX: 1, moveZ: 0, jumpHeld: true, jumpPressed: false, switchPressed: false }); t += 1/120;
    if (g.player.pos.y > maxY) { maxY = g.player.pos.y; peakT = t; }
    if (g.player.grounded) break;
  }
  console.log('apex', (maxY - 1).toFixed(3), 'peakT', peakT.toFixed(3), 'airtime', t.toFixed(3), 'dist', (g.player.pos.x - x0).toFixed(3), 'speed', g.player.vel.x);
  // tap jump
  const g2 = new Game(lv, '3d'); let m2 = 0;
  g2.step(1/120, { moveX: 0, moveZ: 0, jumpHeld: true, jumpPressed: true, switchPressed: false });
  for (let i = 0; i < 200; i++) { g2.step(1/120, { moveX: 0, moveZ: 0, jumpHeld: false, jumpPressed: false, switchPressed: false }); m2 = Math.max(m2, g2.player.pos.y); }
  console.log('tap apex', (m2 - 1).toFixed(3));
});
