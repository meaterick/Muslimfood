#!/usr/bin/env node
// Copy the public files of the site into an output folder for deployment.
//   node scripts/assemble.mjs <outDir> [baseUrl] [--data <dataDir>]
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_LANGS } from '../assets/js/core/normalize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dataIdx = args.indexOf('--data');
const dataDir = dataIdx >= 0 ? path.resolve(ROOT, args[dataIdx + 1]) : path.join(ROOT, 'data');
const positional = args.filter((a, i) => !a.startsWith('--') && !(dataIdx >= 0 && i === dataIdx + 1));
const out = path.resolve(ROOT, positional[0] || '_site');
let base = positional[1] || '';
if (base && !base.endsWith('/')) base += '/';

const FILES = ['index.html', '404.html', 'sw.js', 'manifest.webmanifest', '.nojekyll'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const f of FILES) if (existsSync(path.join(ROOT, f))) await cp(path.join(ROOT, f), path.join(out, f));
await cp(path.join(ROOT, 'assets'), path.join(out, 'assets'), { recursive: true });
await mkdir(path.join(out, 'data'), { recursive: true });
await cp(path.join(dataDir, 'index.json'), path.join(out, 'data', 'index.json'));
await cp(path.join(dataDir, 'search.json'), path.join(out, 'data', 'search.json'));
await cp(path.join(dataDir, 'cells'), path.join(out, 'data', 'cells'), { recursive: true });
for (const layer of ['sea', 'dish']) {
  if (existsSync(path.join(dataDir, layer))) await cp(path.join(dataDir, layer), path.join(out, 'data', layer), { recursive: true });
}
if (existsSync(path.join(dataDir, 'stations.json'))) await cp(path.join(dataDir, 'stations.json'), path.join(out, 'data', 'stations.json'));

const robots = ['User-agent: *', 'Allow: /'];
if (base) {
  robots.push(`Sitemap: ${base}sitemap.xml`);
  const langs = UI_LANGS;
  const alt = langs.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${base}?lang=${l}"/>`).join('\n');
  await writeFile(
    path.join(out, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${langs
  .map((l) => `  <url>\n    <loc>${base}?lang=${l}</loc>\n${alt}\n    <changefreq>daily</changefreq>\n  </url>`)
  .join('\n')}
</urlset>
`,
  );
  // Absolute URL for the social preview image (some crawlers ignore relative ones).
  const html = await readFile(path.join(out, 'index.html'), 'utf8');
  await writeFile(
    path.join(out, 'index.html'),
    html
      .replace('content="assets/img/og.png"', `content="${base}assets/img/og.png"`)
      .replace('<link rel="manifest"', `<link rel="canonical" href="${base}">\n  <meta property="og:url" content="${base}">\n  <link rel="manifest"`),
  );
}
await writeFile(path.join(out, 'robots.txt'), robots.join('\n') + '\n');
console.log(`assembled site in ${path.relative(ROOT, out)}${base ? ` for ${base}` : ''}`);
