// The project's Vite config with live reload switched off, for the audio test
// scripts, so edits elsewhere in the tree cannot reload a page mid-measurement.
//   npx vite --config scripts/audio-vite.config.ts
//   AUDIO_BENCH_BUILD=1 npx vite build --config scripts/audio-vite.config.ts   (then vite preview)
import { defineConfig, mergeConfig, type UserConfig } from 'vite';
import base from '../vite.config';

export default defineConfig((env) => {
  const b = (typeof base === 'function' ? base(env) : base) as UserConfig;
  return mergeConfig(b, {
    server: { port: 5243, strictPort: true, hmr: false },
    preview: { port: 5244, strictPort: true },
    // AUDIO_BENCH_BUILD=1: build the audio bench page alone, to check the worker bundles.
    build: process.env.AUDIO_BENCH_BUILD
      ? { outDir: '/tmp/opus-audio-build', emptyOutDir: true, rollupOptions: { input: { bench: 'src/audio/dev/index.html' } } }
      : {},
  });
});
