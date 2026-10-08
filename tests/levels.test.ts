import { describe, expect, it } from 'vitest';
import { getLevel } from '../src/game/levels';
import { Bot } from './bot';
import { SOLUTIONS } from './solutions';

/** Every movement must be completable with all seven notes. */
describe('movement solutions', () => {
  for (const s of SOLUTIONS)
    it(s.name, () => {
      const b = new Bot(getLevel(s.level), '3d');
      s.run(b);
      expect(b.game.finished).toBe(true);
      expect(b.game.deaths).toBe(0);
    });
});
