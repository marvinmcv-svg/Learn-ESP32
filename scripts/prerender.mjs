// Runs after `vite build`. Writes a static HTML page per route with its own
// title, description, canonical URL and social tags, plus the page's readable
// content inside <main> (search engines and no-JS visitors see the lesson;
// the app replaces it on load). Also writes sitemap.xml and 404.html.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LESSONS, PLAYGROUND, TRACKS } from '../src/lessons.js';
import { LEFT, RIGHT, FACTS } from '../src/pins.js';
import { pageMeta, routes } from '../src/meta.js';

const SITE = (process.env.SITE_URL ?? 'https://learn-esp32-ten.vercel.app').replace(/\/$/, '');
const DIST = new URL('../dist/', import.meta.url).pathname;
const template = readFileSync(join(DIST, 'index.html'), 'utf8');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function body(path) {
  const [, page, id] = path.split('/');
  if (!page) {
    return `<section class="prerender"><h1>Learn the ESP32 by building it in 3D</h1>
<p>${esc(pageMeta('/').description)}</p>
${TRACKS.map((t) => `<h2>${esc(t.title)}</h2><ul>${LESSONS.filter((l) => l.track === t.id).map((l) => `<li><a href="/learn/${l.id}">${esc(l.title)}</a>: ${esc(l.summary)}</li>`).join('')}</ul>`).join('\n')}
<p><a href="/playground">Playground</a> · <a href="/pinout">ESP32 pinout</a></p></section>`;
  }
  if (page === 'learn' || page === 'playground') {
    const l = page === 'playground' ? PLAYGROUND : LESSONS.find((x) => x.id === id);
    const i = LESSONS.indexOf(l);
    const next = LESSONS[i + 1];
    return `<article class="prerender"><h1>${esc(l.title)}</h1><p>${esc(l.summary)}</p>
${l.goal ? `<p><strong>Goal:</strong> ${esc(l.goal.text)}</p>` : ''}
${l.body}
<h2>Starter code</h2><pre><code>${esc(l.code)}</code></pre>
${next ? `<p>Next: <a href="/learn/${next.id}">${esc(next.title)}</a></p>` : ''}</article>`;
  }
  if (page === 'pinout') {
    const row = (p) => `<li><strong>${esc(p.label)}</strong>: ${esc(p.detail)} ${esc(p.note)}</li>`;
    return `<article class="prerender"><h1>ESP32 DevKit pinout</h1><h2>Left header</h2><ul>${LEFT.map(row).join('')}</ul>
<h2>Right header</h2><ul>${RIGHT.map(row).join('')}</ul>
<h2>Chip at a glance</h2><ul>${FACTS.map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join('')}</ul></article>`;
  }
  return '<div class="notfound"><h1>404</h1><p>That page is not on the breadboard.</p><a href="/">Back home</a></div>';
}

function render(path, { canonical = true } = {}) {
  const { title, description } = pageMeta(path);
  const url = `${SITE}${path}`;
  const ld = path.startsWith('/learn/')
    ? `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'LearningResource', name: title.split(' · ')[0], description, url,
      learningResourceType: 'Interactive lesson', educationalLevel: 'Beginner', inLanguage: 'en', isAccessibleForFree: true,
      isPartOf: { '@type': 'Course', name: 'Learn ESP32', url: SITE },
    })}</script>`
    : '';
  return template
    .replace(/<title>.*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(description)}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(title)}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(description)}" />\n  <meta property="og:url" content="${url}" />`)
    .replace('<meta property="og:image" content="/og-image.png" />', `<meta property="og:image" content="${SITE}/og-image.png" />`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, canonical ? `<link rel="canonical" href="${url}" />${ld}` : '<meta name="robots" content="noindex" />')
    .replace('<main id="main" tabindex="-1"></main>', `<main id="main" tabindex="-1">${body(path)}</main>`);
}

for (const path of routes()) {
  // `cleanUrls` in vercel.json serves /learn/blink from learn/blink.html
  const file = path === '/' ? join(DIST, 'index.html') : join(DIST, `${path}.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(path));
}
writeFileSync(join(DIST, '404.html'), render('/404', { canonical: false }));
const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes().map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);
writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`prerendered ${routes().length} pages + 404.html, sitemap.xml`);
