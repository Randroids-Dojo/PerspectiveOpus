// The audio bench page: a live engine with the dev panel, and the offline render
// functions the Playwright scripts call (window.__audioHarness).

import { audioDevPanel } from '../devpanel';
import { createAudio } from '../engine';
import * as offline from './offline';

const engine = createAudio();
audioDevPanel(engine);

const harness = { ...offline, engine };

declare global {
  interface Window {
    __audioHarness: typeof harness;
  }
}
window.__audioHarness = harness;
