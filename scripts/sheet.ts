// Contact sheets from a folder of PNGs.  npx tsx scripts/sheet.ts <dir> <prefix-filter> <out.png> [cols]
import { readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const dir = resolve(process.argv[2]);
const filter = process.argv[3] ?? '';
const outPath = process.argv[4] ?? join(dir, 'sheet.png');
const cols = Number(process.argv[5] ?? 4);
const files = readdirSync(dir).filter((f) => f.endsWith('.png') && f.startsWith(filter) && !f.startsWith('sheet')).sort();
const W = 480;
const H = 270;
const html = `<html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${W}px);gap:2px">${files
  .map((f) => `<div style="position:relative"><img src="${f}" width="${W}" height="${H}" style="display:block"><span style="position:absolute;left:4px;top:2px;color:#fff;font:11px sans-serif;text-shadow:0 0 3px #000">${f}</span></div>`)
  .join('')}</body></html>`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: cols * (W + 2), height: Math.ceil(files.length / cols) * (H + 2) } });
const htmlPath = join(dir, '_sheet.html');
writeFileSync(htmlPath, html);
await page.goto(`file://${htmlPath}`);
await page.waitForTimeout(500);
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();
console.log(outPath, files.length);
