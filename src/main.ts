import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-500-italic.css';
import '@fontsource/cormorant-garamond/latin-600-italic.css';
import '@fontsource-variable/fraunces/index.css';
import './styles.css';
import './ui/ui.css';
import { App } from './app';
import { Director } from './director';
import { registerServiceWorker, watchForUpdates } from './core/update';
import type { Mode, PaletteId } from './game/types';

const root = document.getElementById('world')!;
let app: App;
try {
  app = new App(root);
} catch (err) {
  // Without WebGL there is no stage to stand on; say so plainly.
  const boot = document.getElementById('boot');
  if (boot)
    boot.innerHTML =
      '<div class="boot-mark"><em>Perspective</em><span>Opus</span></div>' +
      '<p style="max-width:420px;text-align:center;font:italic 18px/1.4 Georgia,serif;color:#f5ead2cc">' +
      'This browser could not open the Stage (WebGL is turned off or unavailable). ' +
      'Try a current Chrome, Safari, Edge or Firefox with hardware acceleration on.</p>';
  throw err;
}
const director = new Director(app);
const params = new URLSearchParams(location.search);

if (params.has('level')) {
  // Development: straight into a level (or the gallery) with the HUD.
  const levelParam = params.get('level')!;
  const level = /^\d+$/.test(levelParam) ? Number(levelParam) : levelParam;
  director.playNow(level, (params.get('mode') ?? '3d') as Mode, (params.get('palette') as PaletteId | null) ?? undefined);
  if (params.has('x'))
    app.teleport(Number(params.get('x')), Number(params.get('y') ?? 12), Number(params.get('z') ?? 3));
} else director.start();
app.start();

declare global {
  interface Window {
    __opus: App;
    __director: Director;
  }
}
window.__opus = app;
window.__director = director;
registerServiceWorker();
watchForUpdates(() => director.showUpdate());
document.getElementById('boot')?.classList.add('gone');
setTimeout(() => document.getElementById('boot')?.remove(), 900);
