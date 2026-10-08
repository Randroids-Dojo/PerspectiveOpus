import './styles.css';
import { App } from './app';
import type { Mode, PaletteId } from './game/types';

const root = document.getElementById('world')!;
const app = new App(root);
const params = new URLSearchParams(location.search);
const levelParam = params.get('level') ?? '0';
const level = /^\d+$/.test(levelParam) ? Number(levelParam) : levelParam;
const mode = (params.get('mode') ?? '3d') as Mode;
app.startLevel(level, mode, (params.get('palette') as PaletteId | null) ?? undefined);
if (params.has('x'))
  app.teleport(Number(params.get('x')), Number(params.get('y') ?? 12), Number(params.get('z') ?? 3));
app.start();

declare global {
  interface Window {
    __opus: App;
  }
}
window.__opus = app;
