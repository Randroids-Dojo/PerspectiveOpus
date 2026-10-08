// Overlays a page screenshot and a stage screenshot (side view) to check that edges coincide.
//   npx tsx scripts/stage-align.ts page.png stage.png out.png
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [a, b, out] = process.argv.slice(2);
const src = (f: string) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// Plain HTML and an inline script, so no bundler helpers end up in the page.
await page.setContent(`<body style="margin:0"><div style="position:relative;width:1280px;height:720px">
<img src="${src(a)}" style="position:absolute;inset:0">
<img src="${src(b)}" style="position:absolute;inset:0;opacity:0.5">
</div></body>`);
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
console.log('overlay', out);
