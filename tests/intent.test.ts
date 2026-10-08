import { describe, expect, it } from 'vitest';
import { LEVELS, getLevel } from '../src/game/levels';
import { canFinishIn } from './reach';

/** No movement can be finished on one world alone: every one needs the switch. */
describe('puzzle intent', () => {
  LEVELS.forEach((def, i) => {
    it(`${def.info.title} needs both worlds`, () => {
      const lv = getLevel(i);
      const stage = canFinishIn(lv, '3d');
      const page = canFinishIn(lv, '2d');
      expect({ stageOnly: stage.reached, pageOnly: page.reached }).toEqual({ stageOnly: false, pageOnly: false });
      // The search must have actually explored, not given up at the start.
      console.log(`${def.info.title}: stage alone reaches x ${stage.furthest}, page alone reaches x ${page.furthest} of ${lv.w}`);
      expect(stage.furthest).toBeGreaterThan(20);
      expect(page.furthest).toBeGreaterThan(10);
    });
  });
});
