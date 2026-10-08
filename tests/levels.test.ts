import { describe, expect, it } from 'vitest';
import { getLevel } from '../src/game/levels';
import { Bot } from './bot';

/**
 * Every movement must be completable with all seven notes. Each solution is a
 * human-readable route; see docs/LEVEL_DESIGN.md for the gap rules.
 */
describe('movement solutions', () => {
  it('I Overture', () => {
    const b = new Bot(getLevel(0), '3d');
    // A: the meadow.
    b.walk(8).leap(9, 12).depth(4.5).leap(15.5, 17.2).hop().expectNotes(1);
    // B: round the wall at the back.
    b.walk(24, 7).walk(29.5).expectNotes(2).walk(38);
    // C: the first page bridge.
    b.walk(39, 0.6).walk(46).switch('2d').walk(51.5).hop().expectNotes(3).walk(61);
    // D: back to the stage, round the back wall at the front.
    b.switch('3d').depth(0.6).walk(65.5).expectNotes(4).walk(74);
    // E: the page staircase.
    b.leap(75, 77.5, { z: 0.6 }).switch('2d').leap(78.4, 80.5).leap(81.4, 83.5).leap(84.4, 86.5).hop().expectNotes(5);
    // F: the terrace, round the wall at the back, then a page bridge to the front.
    b.walk(95).switch('3d').depth(7).walk(108).switch('2d').walk(111.5).hop().expectNotes(6);
    // G: the tower staircase and the arch.
    b.walk(121).leap(123.4, 125.5).leap(126.4, 128).leap(128.4, 130).hop().expectNotes(7);
    b.walk(133).walk(135.5);
    expect(b.game.finished).toBe(true);
    expect(b.game.deaths).toBe(0);
  });
});
