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

  it('II Adagio', () => {
    const b = new Bot(getLevel(1), '3d');
    const plat = (i: number) => b.game.platforms[i].body.min;
    // A: ride the first stand, hop for the note on the way.
    b.walk(12.6, 1.5).until(() => plat(0).x < 14.05, 'stand at the shore').walk(15.5, 1.5);
    b.until(() => b.p.x > 19.6, 'riding').hop().expectNotes(1);
    b.until(() => plat(0).x > 24.9, 'stand at the island').walk(30);
    // B: round the boathouse at the back.
    b.walk(31, 7).walk(35.5).expectNotes(2).walk(40);
    // C: jump on the stage, turn to the page in mid-air past the pillar.
    b.walk(41, 0.5).walk(49.5).leap(51.7, 57, { z: 0.5, switchAt: 54.7 }).expectNotes(3);
    expect(b.game.mode).toBe('2d');
    // D: the lift that only the page reaches.
    b.walk(65).walk(73.3).until(() => plat(1).y < 4.05, 'lift down').walk(75.5);
    b.until(() => plat(1).y > 12.95, 'lift up').expectNotes(4).walk(81);
    // E: the page staircase to the floating stone.
    b.leap(87.4, 89).leap(89.5, 91).hop().expectNotes(5).walk(95);
    // F: across on the page while the stands line up.
    b.until(() => plat(2).x < 96.05, 'stand near').walk(97.5).until(() => plat(2).x > 102.95, 'stand far');
    b.walk(107.5).hop().expectNotes(6).walk(116);
    // G: the stage-only alcove, then the arch.
    b.switch('3d').walk(122, 1).walk(125.5, 1).expectNotes(7).leap(126.3, 128.5, { z: 1 }).walk(136.5, 3);
    expect(b.game.finished).toBe(true);
    expect(b.game.deaths).toBe(0);
  });

  it('III Scherzo', () => {
    const b = new Bot(getLevel(2), '3d');
    const dis = (i: number) => b.game.discords[i];
    // A: the drum up to the town wall, catching the note on the way.
    b.bounceOn(13, 18, { z: 3.5, delay: 0.3 }).expectNotes(1);
    // B: the front lanes past the thorns; the drum in the middle lifts to the second note.
    b.walk(19, 1.5).bounceOn(25, 28, { z: 1.5 }).expectNotes(2);
    // C: crate, awning, then the page carries you to the balcony.
    b.walk(31, 1.5).walk(31.5, 3.5).walk(31.5, 0.5).until(() => dis(0).pos.x > 38, 'Discord away');
    b.leap(33.3, 35, { z: 0.5 }).leap(35.6, 37.5, { z: 0.5 }).switch('2d').walk(42.5).expectNotes(3);
    b.walk(47.5);
    // D: the stage past the front thorns, the page over the pacing Discord.
    b.switch('3d').walk(48, 6.5).walk(59.5).switch('2d').leap(61.4, 64.5).expectNotes(4).walk(69);
    // E: the bell tower, on the page.
    b.bounceOn(72, 76).bounceOn(80, 84.5).walk(85.5).hop().expectNotes(5);
    b.bounceOn(87, 90.5).walk(92.5).hop().expectNotes(6);
    // F: the bridge, under the bobbing Discord, the chimneys and the arch.
    b.walk(106.5).until(() => dis(2).pos.y > 22.6 && dis(2).dir.y >= 0, 'Discord rising').walk(116);
    b.leap(117.4, 119).leap(119.5, 121.4).hop().expectNotes(7).walk(127.5);
    expect(b.game.finished).toBe(true);
    expect(b.game.deaths).toBe(0);
  });

  it('IV Nocturne', () => {
    const b = new Bot(getLevel(3), '3d');
    // A and B: the gate key, then the key at the back that raises the front bridge.
    b.walk(8.5, 3.5).walk(16.5).expectNotes(1).walk(16.5, 6.5).walk(17.5, 1.5).walk(24.5).hop().expectNotes(2);
    b.walk(31, 1.5).walk(32.5, 3.5);
    // C: both half bridges, crossed on the page.
    b.walk(39.5, 1.5).walk(42.5, 6.5).switch('2d').walk(50.5).hop().expectNotes(3).walk(57.5);
    // D: the maze, on the stage.
    b.switch('3d').walk(62, 7).walk(62, 1).walk(66.5, 0.6).expectNotes(4).walk(66.5, 7).walk(70.5, 7.3);
    b.walk(70.5, 1).walk(76, 1).walk(80, 3.5);
    // E: the stage-only note under the ledge, then the page climbs to the key and the golden stairs.
    b.walk(90.5, 3.5).expectNotes(5).walk(85.5, 1.6).jumpTo(85.5, 0.5).switch('2d');
    b.leap(87.4, 89.5).walk(91.5).leap(93.4, 95).leap(95.4, 97).leap(97.4, 99.5).hop().expectNotes(6).walk(102.5);
    // F: the chord of three keys, the moon bridge and the arch.
    b.walk(115.5).walk(122.5).hop().expectNotes(7).walk(135.5);
    expect(b.game.finished).toBe(true);
    expect(b.game.deaths).toBe(0);
  });

  it('V Toccata', () => {
    const b = new Bot(getLevel(4), '3d');
    const plat = (i: number) => b.game.platforms[i].body.min;
    // A: wake the lift, find the note under the mezzanine, ride up.
    b.walk(6.5, 2.5).walk(9, 1.5).walk(18.5, 1.5).expectNotes(1).walk(9, 1.5).walk(9, 4.5);
    b.until(() => plat(0).y < 4.05, 'lift down').walk(11.5, 4.5).until(() => plat(0).y > 13.95, 'lift up').walk(15.5, 3.5);
    // B: ride behind the wall.
    b.walk(22, 7.5).until(() => plat(1).x < 24.05, 'stand near').walk(25.5, 7.5);
    b.until(() => b.p.x > 29.6, 'riding').hop().expectNotes(2).until(() => plat(1).x > 32.95, 'stand far').walk(37.5, 7.5).walk(37.5, 3.5);
    // C: past the pendulum at the back, then the drum to the brass walk on the page.
    b.walk(38, 7.5).walk(44.5).expectNotes(3).walk(49.4).switch('2d').bounceOn(50, 55).expectNotes(4).walk(63.3);
    // D: the paternoster, on the page.
    b.until(() => plat(2).y < 20.05 && plat(2).z < 6.9 && plat(2).z > 0.5, 'paternoster at the bottom', 30).walk(65.5);
    b.until(() => plat(2).y > 27.95, 'paternoster at the top').expectNotes(5).walk(68.5);
    // E: the gauntlet on the stage, then the last bridge on the page.
    b.switch('3d').walk(68.5, 3.5).walk(70, 7.5).walk(73.6, 7.5).leapOver(1, 87, 7.5).walk(89.5, 7.5).expectNotes(6);
    b.walk(91, 0.5).switch('2d').walk(98.5).hop().expectNotes(7).walk(110.5);
    expect(b.game.finished).toBe(true);
    expect(b.game.deaths).toBe(0);
  });

  it('VI Finale', () => {
    const b = new Bot(getLevel(5), '3d');
    const plat = (i: number) => b.game.platforms[i].body.min;
    const dis = (i: number) => b.game.discords[i];
    // A: the grand staircase on the page.
    b.walk(8).switch('2d').leap(9.4, 11.5).leap(12.4, 14.5).leap(15.4, 17.5).leap(18.4, 20.5).hop().expectNotes(1).walk(24.5);
    // B: round the curtain at the back while the Discord is away.
    b.switch('3d').walk(24.5, 3.5).walk(26.5, 7.5).until(() => dis(0).pos.x > 35 && dis(0).dir.x > 0, 'Discord away', 30);
    b.walk(29.5, 7.5).expectNotes(2).walk(31, 3).walk(41.6, 0.5);
    // C: the timpani, on the page.
    b.switch('2d').bounceChain([44.5, 49.5, 54.5], 60).expectNotes(3).walk(59.5);
    // D: the key, the note in front of the piano, the golden stairs.
    b.switch('3d').walk(66.5, 1.5).walk(70, 0.5).walk(76.5, 0.5).expectNotes(4).walk(70, 0.5).walk(70, 7.5);
    b.leap(71.5, 73, { z: 7.5 }).leap(73.5, 75, { z: 7.5 }).leap(75.5, 77, { z: 7.5 }).leap(77.5, 79, { z: 7.5 }).walk(82.5, 3.5);
    // E: along the front of the tier, past the pipe, jump and turn to the page in the air.
    b.walk(100, 1).walk(102, 1).leap(107.6, 113, { z: 1, switchAt: 108.4 }).expectNotes(5);
    // F: the lift.
    b.walk(123.3).until(() => plat(0).y < 20.05, 'lift down').walk(125.5).until(() => plat(0).y > 29.95, 'lift up').expectNotes(6).walk(128.5);
    // G: over the two Discords on the page, the podium and the arch.
    b.walk(143.2).leap(143.9, 147.5).leap(149.9, 153.5).expectNotes(7).walk(166.5);
    expect(b.game.finished).toBe(true);
    expect(b.game.deaths).toBe(0);
  });
});
