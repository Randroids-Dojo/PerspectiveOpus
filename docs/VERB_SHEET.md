# Core interaction

Genre and intended pace: a perspective puzzle platformer. Brisk movement, thoughtful pauses at each puzzle.
Intended input: keyboard, controller or touch, all complete. Muted audio loses nothing essential; every cue has a visual twin.
Viewing mode: the Stage (three-quarter 3D view following Quaver) or the Score (flat side view on parchment), switched at any moment.
Representative starting state: Movement I, the Stage, standing in the meadow.

| Player action | Input | Consequence | Constraint or tradeoff | Feedback | Verification |
| --- | --- | --- | --- | --- | --- |
| Move | A D, arrows, stick, drag left | Quaver runs along x | Same speed on both worlds | Run cycle, footsteps by surface | `tests/levels.test.ts` |
| Walk in depth | W S, arrows, stick, drag up and down | On the Stage, moves along z | Ignored on the Score | Quaver turns, camera follows | `tests/sim.test.ts` walk-round |
| Jump | Space, Z, K, A button, round button | Jump; hold for full height | 2.68 high, about 5.7 across with coyote time | Squash and stretch, dust or ink puff | `tests/metrics.test.ts` |
| Turn the world | Shift, E, X, Y, shoulders, page button | Rules flip instantly; the view swings and inks over 0.8 s while time slows to a third | On the Score, whatever lines up connects; on the Stage, depth is real; never traps or moves Quaver | Camera swing, ink wipe, music crossfades between arrangements, page or hall swell | `tests/sim.test.ts`, `tests/view.test.ts` |
| Find a note | Touch it | Restores a layer of the music | Some only on one world | Gold burst, scale degree in harmony, note flies to the HUD | Level solutions collect all 42 |
| Bounce | Land on a drum | Launches high | On the Score, any drum below you counts and moves you to its depth | Timpani hit, head ripple | Scherzo, Finale solutions |
| Press a key | Stand on it | Toggles its golden bars | Gates close only once Quaver is clear | Piano note, bars rise or fade | Nocturne solution |
| Ride | Stand on a music stand | Carried; momentum kept when leaving | Platforms never crush; behind a wall on the Score you ride embedded | Stand moves, light below | Adagio, Toccata solutions |
| Pause | Esc, P, Start, top right | Menu with return to the metronome | Time stops, music muffles | Card over the world | Manual |

## First action and recovery

The first sign appears at the spawn point. Falling, thorns and Discords send Quaver back to the last metronome in under a second, with keys and bars restored to that moment; notes already found stay found.

## Done when

Every movement is completable with all notes on keyboard, controller and touch; the switch is seamless from any state; and both renderers and both arrangements show the same world.
