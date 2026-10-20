// Renders public/og-image.png (1200×630), the link preview image, with the
// Chromium that Playwright installs for the e2e tests. Run with
// `npm run og-image` after changing the design below, and commit the PNG.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const OUTPUT = fileURLToPath(new URL('../public/og-image.png', import.meta.url));
const logo = await readFile(new URL('../public/tgh-logo.png', import.meta.url));

const html = `<!doctype html>
<html>
<head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&family=JetBrains+Mono:wght@500&family=Oswald:wght@600&display=block">
<style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background: #0d0f10;
    background-image:
      radial-gradient(circle at 300px 315px, rgba(199, 168, 107, 0.14), transparent 340px),
      linear-gradient(rgba(199, 168, 107, 0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(199, 168, 107, 0.05) 1px, transparent 1px);
    background-size: auto, 48px 48px, 48px 48px;
    color: #f3f0e6;
    font-family: "IBM Plex Sans", sans-serif;
    display: flex; align-items: center; gap: 56px; padding: 0 80px 0 72px;
  }
  .frame { position: absolute; inset: 28px; border: 1px solid rgba(199, 168, 107, 0.28); }
  img { width: 380px; height: 380px; flex: 0 0 auto; object-fit: contain; }
  .eyebrow { color: #9a8866; font: 500 20px "JetBrains Mono", monospace; letter-spacing: 0.14em; text-transform: uppercase; }
  h1 { margin-top: 14px; color: #c7a86b; font: 600 84px/0.95 "Oswald", sans-serif; letter-spacing: 0.03em; text-transform: uppercase; }
  p { margin-top: 24px; color: #d6d2c4; font-size: 30px; line-height: 1.3; max-width: 620px; }
  .tags { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
  .tags span { padding: 8px 14px; border: 1px solid rgba(199, 168, 107, 0.45); border-radius: 6px; color: #c7a86b; font: 500 19px "JetBrains Mono", monospace; }
  .url { position: absolute; right: 64px; bottom: 50px; color: #8d938e; font: 500 20px "JetBrains Mono", monospace; }
</style>
</head>
<body>
  <div class="frame"></div>
  <img src="data:image/png;base64,${logo.toString('base64')}" alt="">
  <div>
    <div class="eyebrow">Escape from Tarkov</div>
    <h1>Tarkov Gun<br>Helper</h1>
    <p>Optimal weapon builds with flea market and trader prices</p>
    <div class="tags"><span>Recoil</span><span>Ergonomics</span><span>Budget</span><span>PvP / PvE</span></div>
  </div>
  <div class="url">tarkovgunhelper.com</div>
</body>
</html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUTPUT });
  console.log(`Wrote ${OUTPUT}`);
} finally {
  await browser.close();
}
