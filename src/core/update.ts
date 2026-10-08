// Spots a newer deploy while the game is open: the build knows its own
// version, and /version.json (never cached) holds the live one. Checked every
// few minutes and whenever the game comes back to the foreground.

declare const __APP_VERSION__: string;

const POLL_MS = 180_000;
export const APP_VERSION = __APP_VERSION__;

export async function newerVersion(current: string): Promise<string | null> {
  if (!current || current === 'dev') return null;
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const { version } = (await res.json()) as { version?: unknown };
    return typeof version === 'string' && version && version !== current ? version : null;
  } catch {
    return null;
  }
}

export function watchForUpdates(onUpdate: (version: string) => void): void {
  if (APP_VERSION === 'dev') return;
  let told = '';
  let checking = false;
  const check = async () => {
    if (checking || document.visibilityState !== 'visible') return;
    checking = true;
    const v = await newerVersion(APP_VERSION);
    checking = false;
    if (v && v !== told) {
      told = v;
      onUpdate(v);
    }
  };
  setInterval(() => void check(), POLL_MS);
  document.addEventListener('visibilitychange', () => void check());
}

/** Registers the service worker that makes the game installable. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || APP_VERSION === 'dev') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installability is a nicety; the game runs without it.
    });
  });
}
