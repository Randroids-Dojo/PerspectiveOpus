// Stage performance: frame times, draw calls and triangles while running through a level,
// plus load() timings when the level is restarted.
//   npx tsx scripts/stage-perf.ts [level] [quality] [seconds]
// Env: URL (dev server), DPR (device scale factor, default 1), PALETTE
import { chromium } from 'playwright-core';

const level = process.argv[2] ?? '0';
const quality = process.argv[3] ?? 'high';
const seconds = Number(process.argv[4] ?? 8);
const base = process.env.URL ?? 'http://localhost:5241/';
const pal = process.env.PALETTE ? `&palette=${process.env.PALETTE}` : '';

const browser = await chromium.launch({
  channel: process.env.CHANNEL ?? 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}?level=${level}&mode=3d${pal}`);
await page.waitForTimeout(1500);

const gpu = await page.evaluate(() => {
  const gl = (window as any).__opus.stage.renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});
console.log('gpu', gpu);

// Load timings: restart the level a few times.
const loads = await page.evaluate(async (lv) => {
  const a = (window as any).__opus;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    a.startLevel(/^\d+$/.test(lv) ? Number(lv) : lv, '3d');
    out.push((window as any).__stageLoadMs);
    await new Promise((r) => setTimeout(r, 50));
  }
  return out;
}, level);
console.log('load ms', loads.map((x: number) => x.toFixed(1)).join(', '));

await page.evaluate((q) => {
  (window as any).__opus.quality = q;
}, quality);
await page.waitForTimeout(500);

// Run right, jumping now and then, and sample frame times and renderer info.
await page.keyboard.down('ArrowRight');
// A plain string so the bundler's helpers never leak into the page.
const stats = await page.evaluate(`(async () => {
  const secs = ${seconds};
  const a = window.__opus;
  const r = a.stage.renderer;
  const gl = r.getContext();
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const gpuMs = [];
  const times = [];
  let calls = 0, tris = 0, n = 0;
  let last = performance.now();
  const end = last + secs * 1000;
  // GPU time of the stage's own render, measured with a timer query around it when available.
  if (tq) {
    const orig = a.stage.render.bind(a.stage);
    let pending = [];
    a.stage.render = (g, v, f) => {
      const q = gl.createQuery();
      gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
      orig(g, v, f);
      gl.endQuery(tq.TIME_ELAPSED_EXT);
      pending.push(q);
      pending = pending.filter((qq) => {
        if (!gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE)) return true;
        if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) gpuMs.push(gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(qq);
        return false;
      });
    };
  }
  r.info.autoReset = false;
  r.info.reset();
  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      times.push(now - last);
      last = now;
      calls += r.info.render.calls;
      tris += r.info.render.triangles;
      r.info.reset();
      n++;
      if (now < end) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  times.sort((x, y) => x - y);
  gpuMs.sort((x, y) => x - y);
  const avg = times.reduce((s, x) => s + x, 0) / times.length;
  return {
    frames: times.length,
    avgMs: +avg.toFixed(2),
    fps: +(1000 / avg).toFixed(1),
    p95: +times[Math.floor(times.length * 0.95)].toFixed(2),
    gpuMedianMs: gpuMs.length ? +gpuMs[Math.floor(gpuMs.length / 2)].toFixed(2) : null,
    gpuP95Ms: gpuMs.length ? +gpuMs[Math.floor(gpuMs.length * 0.95)].toFixed(2) : null,
    calls: Math.round(calls / n),
    tris: Math.round(tris / n),
    programs: r.info.programs.length,
    geometries: r.info.memory.geometries,
    textures: r.info.memory.textures,
    pixelRatio: r.getPixelRatio(),
  };
})()`);
await page.keyboard.up('ArrowRight');
console.log(JSON.stringify(stats, null, 1));
await browser.close();
