import './styles.css';
import { App } from './app';
import type { Mode } from './game/types';

const root = document.getElementById('world')!;
const app = new App(root);
const params = new URLSearchParams(location.search);
const level = Number(params.get('level') ?? 0);
const mode = (params.get('mode') ?? '3d') as Mode;
app.startLevel(level, mode);
app.start();

declare global {
  interface Window {
    __opus: App;
  }
}
window.__opus = app;
