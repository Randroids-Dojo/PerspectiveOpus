import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-500-italic.css';
import '@fontsource/cormorant-garamond/latin-600-italic.css';
import '@fontsource-variable/fraunces/index.css';
import './styles.css';
import './ui/ui.css';
import { App } from './app';
import { Director } from './director';
import type { Mode, PaletteId } from './game/types';

const root = document.getElementById('world')!;
const app = new App(root);
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
