// Contact sheet of screenshots, for reviewing many stage shots at once.
//   npx tsx scripts/stage-sheet.ts out.png cols img1.png img2.png ...
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [out, colsArg, ...files] = process.argv.slice(2);
const cols = Number(colsArg ?? 3);
const W = 640;
const H = 360;
const rows = Math.ceil(files.length / cols);
const imgs = files
  .map((f) => {
    const b64 = readFileSync(f).toString('base64');
    const label = f.split('/').pop();
    return `<figure><img src="data:image/png;base64,${b64}"/><figcaption>${label}</figcaption></figure>`;
  })
  .join('');
const html = `<html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${W}px);gap:0">
<style>figure{margin:0;position:relative;width:${W}px;height:${H}px}img{width:${W}px;height:${H}px;display:block}
figcaption{position:absolute;left:6px;top:4px;color:#fff;font:12px sans-serif;text-shadow:0 0 3px #000}</style>${imgs}</body></html>`;
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: W * cols, height: H * rows } });
await page.setContent(html);
await page.waitForTimeout(200);
await page.screenshot({ path: out });
await browser.close();
console.log('sheet', out);
