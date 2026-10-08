# Level design rules

Measured from `src/game/sim.ts` (`PHYS`). Re-measure with `npx vitest run tests/metrics.test.ts` after any physics change.

| Move | Value |
| --- | --- |
| Run speed | 6.1 cells/s |
| Full jump apex | 2.68 cells |
| Tap jump apex | 1.38 cells |
| Full jump distance, same height | 4.47 cells of travel, about 5.7 cells of gap with coyote time |
| Drum launch | `power` cells (default 5.5) |

So, for a gap to be impossible on the stage:

- **Rise**: 3 or more cells.
- **Same-height gap**: 6 or more cells.
- **Depth**: the stage is 8 deep (z 0 to 7). The front lane (z 0) and back lane (z 7) are 6 apart and cannot be jumped between. Lanes closer than that can.
- Diagonals count: the run speed is capped on the diagonal, so use Euclidean distance.

## The perspective rules

- **The Score (2D)**: a column (x, y) is solid if any depth is solid. Floors that line up connect. Walls at any depth block. Thorns at any depth hurt. Notes, keys, Discords and the arch are reached by lining up on the page.
- **The Stage (3D)**: depth is real.
- On the page the player keeps a depth. Landing on something moves them to its depth (keep current depth when it is supported, else nearest, front wins ties). So a switch back to the stage leaves them standing on what they stood on.
- Switching to the page while behind something ("embedded") keeps 3D collision at the player's depth until they step clear. A switch never moves, traps or kills.

## Recipes

- **Page bridge**: a front walk ending at x, a back walk starting at x. Only the page crosses.
- **Stage walk-round**: a wall covering lanes 0 to 5 with lanes 6 to 7 open (or the reverse). Only the stage passes.
- **Page staircase**: pillars 3 wide alternating front and back lanes, each 2 higher. On the stage every next step is 6 away in depth and every same-lane step is 4 higher.
- **Page tease**: a note in front of a back wall is visible on the page but the column is solid there. Only the stage reaches it.
- **Stage hazard dodge**: thorns in one lane make the page path deadly; the stage walks past in another lane.
