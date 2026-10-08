# Polish verification

Checked on 8 October 2026.

The representative interaction is running and holding a jump while turning between the Stage and the Score. Quaver stays alive during a rapid reversal, and a thin gold cue marks the landing surface. The cue follows real depth on the Stage, projected floors on the Score, and the tops of moving stands and drums.

The HUD now gives an explicit note count, names the touch switch's destination, keeps readable ink on Nocturne's dark page, and reports metronome and respawn recovery. The movement card clears after 2.8 seconds. Pickups are saved immediately. Reduced motion removes pickup flights and idle camera orbits.

Input fixes cover controller disconnect, connecting with buttons held, focus loss, touch cancellation and independent movement and jump fingers. Escape closes one menu at a time. Restarting or returning to the title releases the paused music mix.

## Checks

| Check | Result |
| --- | --- |
| `npm test` | 28 passing tests, including all movement solutions, input recovery and landing surfaces |
| `npm run build` | Type checking and production build pass |
| `scripts/flowtest.ts` | Keyboard, touch and controller menu, switch, pause and completion flows pass |
| `scripts/polishtest.ts` | 18 checks pass, including actual multitouch, reload, reduced motion, dark-page colors and a 320-pixel HUD |
| `scripts/campaigntest.ts` | All six solutions replay through the live app without teleporting; 42 notes saved, zero deaths, ending returns to the title |
| `scripts/audio-smoke.ts` | Gesture unlock and gameplay music start without missing samples or stolen voices |
| `scripts/audio-check.ts` | All eight scores have valid notes, ranges and bar lengths |

Regression captures and reports: `/tmp/opus-polish-regressions`, `/tmp/opus-campaign`, `/tmp/opus-polish-web`, `/tmp/opus-polish-phone`, `/tmp/opus-polish-pad`.

The campaign replay feeds the proven 120 Hz action recordings into the real app loop at increased simulation speed. Input-device flows and multitouch use separate normal-speed scenarios. These checks establish completion, state recovery and presentation; subjective feel and listening remain human judgments.

## Repeating the checks

Start `npm run dev`, then run:

```sh
npx tsx scripts/polishtest.ts
npx tsx scripts/campaigntest.ts
npx tsx scripts/flowtest.ts /tmp/opus-flow
PHONE=1 npx tsx scripts/flowtest.ts /tmp/opus-flow-phone
PAD=1 npx tsx scripts/flowtest.ts /tmp/opus-flow-pad
npx tsx scripts/audio-smoke.ts
npx tsx scripts/audio-check.ts
```

Both new regression scripts accept a deployment URL as their first argument. The campaign script also accepts an output directory as its second argument.
