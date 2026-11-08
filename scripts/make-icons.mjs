#!/usr/bin/env node
// Render the PNG icons and the social preview image from SVG/HTML.
// Needs Playwright with Chromium (not a project dependency):
//   npx -y playwright@1 install chromium && node scripts/make-icons.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG = path.join(ROOT, 'assets', 'img');

const glyph = (scale, cx = 256, cy = 256) => `
  <g transform="translate(${cx} ${cy}) scale(${scale}) translate(-256 -256)">
    <path d="M184 136v116M152 136v74a32 32 0 0 0 64 0v-74M184 252v132M338 384V136c-33 18-55 59-55 112v31h55" fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="398" cy="114" r="62" fill="#1E7B4F"/>
    <circle cx="398" cy="114" r="46" fill="#fff"/>
    <circle cx="398" cy="114" r="35" fill="#D99A1C"/>
    <path d="M381 115l12 12 23-23" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

const square = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#1E7B4F"/>${glyph(scale)}</svg>`;

async function main() {
  const icon = await readFile(path.join(IMG, 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const render = async (svg, size, file, transparent = true) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(IMG, file), omitBackground: transparent });
  };
  await render(icon, 192, 'icon-192.png');
  await render(icon, 512, 'icon-512.png');
  await render(square(0.78), 180, 'icon-180.png', false);
  await render(square(0.62), 512, 'icon-maskable-512.png', false);

  // Social preview 1200x630
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<html><body style="margin:0;width:1200px;height:630px;background:#F4F7F6;font-family:system-ui,'Apple SD Gothic Neo','Noto Sans KR','Noto Sans CJK KR',sans-serif;color:#14233F;display:flex;align-items:center;">
    <div style="padding:0 90px;display:flex;flex-direction:column;gap:26px;">
      <div style="display:flex;align-items:center;gap:26px;">${icon.replace('<svg ', '<svg width="128" height="128" ')}
        <span style="font-size:84px;font-weight:800;letter-spacing:-2px;">Muslimfood</span></div>
      <div style="font-size:46px;font-weight:700;line-height:1.25;">Halal food near you, anywhere.<br><span style="color:#1E7B4F">내 주변 할랄 음식점, 한국에서 더 자세히.</span></div>
      <div style="display:flex;gap:16px;font-size:26px;font-weight:600;color:#44526E;">
        <span style="display:flex;align-items:center;gap:10px"><i style="width:22px;height:22px;border-radius:50%;background:#1E7B4F;display:inline-block"></i>Halal</span>
        <span style="display:flex;align-items:center;gap:10px"><i style="width:22px;height:22px;border-radius:50%;background:#138D90;display:inline-block"></i>Muslim-friendly</span>
        <span style="display:flex;align-items:center;gap:10px"><i style="width:22px;height:22px;border-radius:50%;background:#D99A1C;display:inline-block"></i>Some halal</span>
        <span style="display:flex;align-items:center;gap:10px"><i style="width:18px;height:18px;border-radius:50%;border:3px dashed #7A808C;display:inline-block"></i>Not confirmed</span>
      </div>
    </div></body></html>`);
  await page.screenshot({ path: path.join(IMG, 'og.png') });
  await browser.close();
  console.log('icons written to assets/img');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
