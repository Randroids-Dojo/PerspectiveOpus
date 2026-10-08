# Architecture

Vite + TypeScript, three.js for the stage, Canvas 2D for the page, Web Audio for all sound (fully procedural, no audio files). Static site on Vercel.

```
src/
  main.ts              boot
  app.ts               loop: input -> fixed-step simulation -> view -> renderers, audio, UI
  core/                math, input (keyboard, gamepad, touch), save
  game/
    types.ts           materials, entity defs, Mode ('2d' | '3d')
    level.ts           Builder DSL and compiled Level (voxel grid + projection)
    levels/            one file per movement
    sim.ts             Game: deterministic simulation, both rule sets, events
    view.ts            the shared camera and the switch timeline
    palettes.ts        per-movement art palettes used by both renderers
  render/types.ts      WorldRenderer interface, FrameInfo
  render3d/            the Stage (three.js)
  render2d/            the Score (canvas 2D)
  audio/               AudioEngine: music, arrangements, sound effects
  ui/                  HUD, menus, touch controls
```

## Coordinates

- One cell is one world unit. `x` runs right, `y` up, `z` is depth: **z = 0 is the front**, nearest the viewer, and z grows away from the viewer. Stages are 8 deep.
- Voxel `(x, y, z)` occupies `[x, x+1) x [y, y+1) x [z, z+1)`. `level.cells[x + w * (y + h * z)]` is its material (`MAT` in `types.ts`).
- `level.front[x + w * y]` is the front-most solid depth of the column, or `NO_DEPTH` (255).
- The player position is the centre of the feet. Box: 0.6 wide, 0.86 tall, 0.6 deep (`PLAYER` in `sim.ts`).

### three.js handedness

A camera looking along +z has +x on its left, so the stage would be mirrored. The stage renderer puts the whole world in a group with `scale.z = -1` and builds everything in simulation coordinates inside it. Only things outside that group (the camera, screen-space effects) convert: render position = `(x, y, -z)`. three.js flips face winding for negative-determinant matrices automatically.

## The switch

`game.mode` holds the rules and flips the instant the player presses switch. `view.blend` (0 = page, 1 = stage) follows over about 0.8 s of real time, and the simulation slows to about a third in the middle of it so a mid-air switch stays readable. The timeline:

| blend | page canvas | stage canvas |
| --- | --- | --- |
| 0 | full page | hidden |
| 0 .. 0.4 (`WIPE_END`) | page with an ink-edged hole of radius `view.wipe` opening from the player (`view.wipeOrigin`) | side view, almost orthographic, matching the page exactly |
| 0.4 .. 1 | hidden | camera swings from side view to three-quarter view (`view.swing`) |
| 1 | hidden | three-quarter view |

Going to the page plays the same timeline backwards, so a switch can reverse at any moment with no jump. `stagePose(view)` gives the stage camera for any swing; at `swing = 0` it looks straight down +z from about 2800 units away with a 0.25 degree lens, centred on the page camera (`view.c2`) at the page's scale (`view.ppu` CSS pixels per unit). `worldToPage(view, x, y)` is the page projection. **Both renderers must place everything so these agree.** Near and far planes are set tight around the focus distance, so depth precision is fine even at the side view; fog and other distance effects must be computed relative to `pose.dist`, not absolute camera distance.

`view.orbit` adds yaw, pitch and distance to the stage camera for cutscenes (title, ending).

## Reading the simulation

Renderers only read `Game`. Interpolate with `frame.alpha` between previous and current step:

- Player: `game.player` (`prev`, `pos`, `vel`, `facing` (+1/-1 on the page), `heading` (radians, stage), `grounded`, `sinceJump`, `sinceLand`, `lastImpact`, `walk` (distance walked, for gait phase), `dead` (death timer, counts down from `DEATH_TIME`), `embedded` (on the page but behind scenery: draw as a silhouette behind it)).
- Notes: `level.notes[i].pos` (centre), `game.notesTaken[i]`, `game.noteTakenAt[i]` (game time).
- Checkpoints: `level.checkpoints[i].pos` (base centre), `game.checkpointOn` (index or -1), `game.checkpointAt[i]`.
- Exit: `level.exit.pos` (base centre); `game.finished`.
- Bodies (`game.bodies`): `kind` `'platform' | 'gate' | 'drum'`, `min`, `max`, `delta` (moved this step; previous min = `min - delta`), `solid`.
- Gates: `level.gates[i]` (`group`, `solidWhenOn`), `game.gateVis[i]` 0..1 eased (1 = solid).
- Drums: `level.drums[i].pos` (cell), `game.drumHit[i]` seconds since the last bounce.
- Keys: `level.keys[i]` (`pos` is the cell the key lies in, on top of the floor below; `width` cells along x; `group`), `game.keyVis[i]` 0..1 pressed, `game.groups[group]`.
- Discords: `game.discords[i]` (`prev`, `pos` centre, `dir`).
- Thorns: voxels with `MAT.thorn` (not solid, they hurt).
- Decor: `level.decor` (`kind`, `pos` base centre, `scale`, `rot`, `seed`). Purely visual, never solid.
- Time: `game.time` (game seconds).
- Events: `frame.events` (see `GameEvent` in `sim.ts`): jump, land, step, note, checkpoint, death, respawn, switch, bounce, key, gate, exit, bonk. Use them for particles and other one-off effects.
- Palette: `PALETTES[level.info.palette]`.

## Budgets

- Stage: 60 fps at 1280x720 on an integrated laptop GPU at quality `high`; `medium` for phones; `low` must still look intentional. `frame.quality` is the tier.
- Page: 60 fps on a mid-range phone. Cache static ink into chunk canvases.
- Audio: no clicks, no clipping, voice-limited; safe on iOS Safari (unlock on first gesture).

## Testing

- `npm test` for the simulation rules and level solvability.
- `npm run dev` then `npx tsx scripts/shot.ts "level=0&mode=2d" /tmp/shots` for screenshots. `STEPS` drives keys and switches (see the script). `window.__opus` is the `App`.
