# AGENTS.md

Rules for any coding agent working in Perspective Opus.

## Product

A complete, polished puzzle platformer for the browser. The player switches between a hand-inked 2D world (the Score) and a lit 3D world (the Stage) at any moment; the switch is seamless and every part of the game works in both. Six movements, seven notes each, a title, a programme (level select), settings, pause, and an ending. Read `docs/ART_DIRECTION.md`, `docs/ARCHITECTURE.md` and `docs/LEVEL_DESIGN.md` before changing anything.

## Rules

1. **No em dashes or en dashes.** Not in code, comments, copy, commits or PRs. Use a period, comma, colon or parentheses.
2. **Commit messages and PR descriptions read as written by a human.** No AI attribution, no generated-by footers.
3. **Both worlds, always.** Anything added to the game must be drawn by both renderers, sound right in both arrangements, and work under both rule sets. A switch never moves, traps or kills the player.
4. **`src/game` is deterministic and render-free.** No DOM, no `Math.random` in the simulation. Renderers and audio only read `Game` and its events.
5. **Levels are proven.** Every movement has a scripted solution in `tests/levels.test.ts` that reaches the arch and collects all seven notes. Gaps follow the measured limits in `docs/LEVEL_DESIGN.md`.
6. **Every input path.** Keyboard, gamepad and touch must each be able to play the whole game and drive every menu.
7. **Copy is short, plain and sentence case**, in the game's voice (a concert programme, gently musical). No exclamation-heavy hype.
8. Never commit `.env*` files or print secrets.

## Commands

```bash
npm run dev          # Vite on :5233
npm run typecheck
npm test             # simulation rules and level solutions
npm run build
npx tsx scripts/shot.ts "level=0&mode=2d" /tmp/shots   # screenshots (dev server running)
```
