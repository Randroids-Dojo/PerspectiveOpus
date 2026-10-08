// The Opus theme: the leitmotif every movement quotes, in its own key, mode and character.
//
// In C major (the pickup G3 sits at the end of the bar before):
//   G3 | E4. D4 C4 G4 | A4 - G4 E4 | F4. E4 D4 G3 | D4 - - G3 |
//        E4. D4 C4 G4 | C5 - B4 A4 | G4. E4 F4 D4 | C4
// A rising sixth from below, a gentle fall, a lift to the upper tonic, and the
// classic 5 3 4 2 1 cadence. Written in degrees so it reads in any key or mode.

/** Eight bars of 4/4. Bar 4 carries the inner pickup; bar 8 ends on a rest. */
export const THEME = "3q. 2e 1q 5q | 6h 5q 3q | 4q. 3e 2q 5,q | 2h. 5,q | 3q. 2e 1q 5q | 1'h 7q 6q | 5q. 3e 4q 2q | 1h. r q";

/** The same, ending with a pickup so it can follow itself. */
export const THEME_PICKUP = THEME.replace(/1h\. r q$/, '1h. 5,q');

export const THEME_CHORDS = 'I | IV I/3 | ii V | V | I | vi iii/3:1 IV:1 | I/5 V7 | I';

/** The theme in a minor key: natural minor colours, a major dominant. */
export const THEME_CHORDS_MINOR = 'i | iv i/3 | iih V | V | i | VI III:1 iv:1 | i/5 V7 | i';

/** As a Landler in 3/4, two bars to each bar of the original. */
export const THEME_WALTZ =
  "3h 2q | 1q 5h | 6h. | 5h 3q | 4h 3q | 2h 5,q | 2h. | -h 5,q | 3h 2q | 1q 5h | 1'h. | 7h 6q | 5h 3q | 4h 2q | 1h. | r h.";

export const THEME_WALTZ_CHORDS = 'I | I | IV | I/3 | ii | V | V | V | I | I | vi | iii/3:2 IV:1 | I/5 | V7 | I | I';
