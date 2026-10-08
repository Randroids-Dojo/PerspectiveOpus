# Perspective Opus: art and sound direction

## Premise

The Opus, a great symphony, was written on a score and performed on a stage. Its notes have scattered. Quaver, the last little note, can step between **the Score** (the page, 2D) and **the Stage** (the world, 3D) at any moment. Six movements; each has seven notes to find and ends at the Fermata arch. Found notes return their instruments to the music.

The two worlds are one place seen two ways. A player should be able to switch at any instant and feel the same place change medium, never a different place.

## The Score (2D, canvas)

An illuminated manuscript come alive.

- Warm parchment with fibre, foxing and a soft vignette. The page is fixed to the screen; the world scrolls across it.
- Iron-gall ink linework with a living, hand-drawn wobble (boil the line subtly, about 8 frames a second, never jitter fast). Cross-hatching for shade. Watercolour washes for depth tone.
- **Depth is read by tone**: the front-most surface of each column is the darkest, densest ink; surfaces further back are lighter washes. A player must be able to tell a front walk from a back walk on the page.
- Gold leaf for notes and the fermata. Vermilion rubric for accents and danger (thorns, Discords' eyes, Quaver's scarf).
- Faint five-line staves run through the sky. Background hills, towers and trees are ink-wash silhouettes in parallax.
- Everything feels drawn, never rendered: no gradients that look digital, no glow halos that look like bloom (use radiating ink strokes and gold flecks instead).
- The Nocturne turns the page: dark indigo paper with silver ink.

## The Stage (3D, three.js)

A theatrical diorama under stage light.

- Tactile materials: limestone, marble, brick, polished wood, brass, velvet. Bevelled, worn edges; soft ambient occlusion; no flat untextured faces.
- Warm key light with soft shadows, cool fill, atmospheric haze, a painted sky dome (gradient, clouds or stars), bloom on gold, motes drifting through light.
- It should feel like a miniature world built by hand and lit for a performance.

## Quaver

An eighth note come to life.

- Body: a glossy black, slightly tilted oval note head (about 0.62 wide, 0.5 tall) with two big white eyes and tiny pupils.
- A stem rises from the right side of the head (about 0.75 tall) and ends in a flag that flutters like a ponytail as Quaver moves.
- Two stubby legs. No arms, or tiny nubs.
- A vermilion scarf at the base of the stem that trails behind with momentum.
- Stage: lacquered black with clearcoat reflections, gold flag and stem tip, red scarf ribbon. Page: solid ink with a highlight crescent, gold flag, red scarf.
- Animation, all procedural and shared by both renderers' readings of the same sim state: idle breathing and blinks, run with squash and stretch, jump stretch, fall, land squash scaled by impact, death (bursts into ink droplets), respawn (ink gathers back), a victory twirl at the arch.
- The collision box is 0.6 wide, 0.86 tall, 0.6 deep. Keep the drawn silhouette close to it so jumps feel fair.

## Cast and props

- **Notes**: gold eighth notes, slowly turning, glowing softly. On pickup they burst into gold sparks.
- **Discords**: creatures of dissonance. Page: a scribbled ink tangle with one red eye. Stage: a dark, iridescent, spiky orb with a red glowing core that jitters.
- **Thorns**: bramble clusters. Page: thorny ink scribbles with vermilion tips. Stage: dark twisted thorn vines with glowing red berries.
- **Checkpoints**: brass metronomes on small plinths. Lit ones swing in time with the music (`frame.beat`) and glow warm.
- **The Fermata arch** (exit): a stone arch crowned by a golden fermata (an arc over a dot), a shimmering veil of light inside, brighter as Quaver nears.
- **Drums**: timpani, a copper kettle with a cream head and brass rim; the head ripples when bounced on.
- **Piano keys**: ivory plates set into the floor; they sink when pressed; the key and its gates share a group colour.
- **Gates**: golden "staff" bars, five horizontal rails like staff lines. Solid: bright and opaque. Open: faint dotted ghosts.
- **Moving platforms**: floating music stands: a wooden slab with brass trim and a soft light underneath.

## Movements

| # | Name | Palette | Setting |
| --- | --- | --- | --- |
| I | Overture | dawn | A sunrise meadow with old stone ruins, gold light, blue sky |
| II | Adagio | lake | A misty lake of stone causeways and willows; still water below |
| III | Scherzo | autumn | A playful autumn village of brick, timber and red leaves |
| IV | Nocturne | night | Moonlit gardens, glowing crystals, fireflies, lanterns; the page turns dark |
| V | Toccata | clock | Inside a giant clocktower organ: brass, gears, pipes, sparks |
| VI | Finale | finale | A grand concert hall at sunset: crimson velvet, gold, marble |

## Sound

- One composition per movement, arranged twice: the **score arrangement** (intimate and close: music box, felt piano, pizzicato, a little room) and the **stage arrangement** (full and wide: strings, harp, horns or choir pad, timpani, a big hall). Both play on one clock; the switch crossfades between them, so the music never stops or jumps.
- Found notes restore layers: the melody comes back as notes are found, and with all seven the full ensemble plays.
- Pickups sound the next degree of the scale, in harmony with the current chord.
- Every sound effect has a page version (paper, pen, ink, dry) and a stage version (wood, stone, air, reverberant).
