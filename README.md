# Perspective Opus

A puzzle platformer for the browser, played in two worlds at once. Quaver, the last little note of a scattered symphony, can turn the world at any moment between **the Score**, a hand-inked 2D page, and **the Stage**, a lit 3D diorama. On the page, anything that lines up is joined; on the stage, depth is real. Six movements, seven notes in each, and every note found brings an instrument back to the music.

Play: https://perspective-opus.vercel.app

## Controls

| | Keyboard | Controller | Touch |
| --- | --- | --- | --- |
| Move | A D or arrows | Left stick | Drag on the left |
| Walk in depth (Stage) | W S or arrows | Stick up and down | Drag up and down |
| Jump | Space, Z or K | A | Round button |
| Turn the world | Shift, E or X | Y, X or a shoulder | Page button |
| Pause | Esc or P | Start | Top right |

## How it works

- One deterministic simulation (`src/game/sim.ts`) with two rule sets. On the Score a column is solid if any depth is solid; Quaver keeps a depth and moves to whatever they land on, so turning back to the Stage leaves them standing on it. Switching while behind scenery keeps 3D collision at Quaver's depth until they step clear, so a switch can never trap them.
- One shared camera (`src/game/view.ts`). At the midpoint of a switch the Stage camera is an almost orthographic side view at the page's exact scale, so the ink wipe can reveal one world over the other with no seam.
- The Stage is three.js (`src/render3d`), the Score is Canvas 2D (`src/render2d`), and the music is synthesised live in Web Audio (`src/audio`): each movement is one composition arranged twice and crossfaded on a single clock.
- Every movement has a scripted solution in `tests/levels.test.ts` that collects all seven notes.

## Development

```bash
npm install
npm run dev        # http://localhost:5233
npm test
npm run build
```

`?level=0..5` (or `gallery`) jumps straight into a movement; `&mode=2d` starts on the Score; `&palette=night` restyles it; `&x=40` teleports.

Deploys to Vercel from `main`.
