'use strict';
/**
 * Static build for meia-g.art.
 *
 *   node scripts/build.js            full build (images + pages)
 *   node scripts/build.js --pages    pages only, reuse existing derivatives
 *
 * Masters are read from ./masters (override with MASTERS_DIR). They are not in
 * the repository — they are 1.3 GB of camera files. The derivatives in
 * dist/img are, because those are the website.
 */

const fs = require('fs');
const path = require('path');
const { buildImage } = require('./images');
const { render, esc } = require('./md');

const ROOT = path.resolve(__dirname, '..');
const MASTERS = process.env.MASTERS_DIR || path.join(ROOT, 'masters');
const DIST = path.join(ROOT, 'dist');
const MANIFEST = path.join(ROOT, 'data', 'manifest.json');
const PAGES_ONLY = process.argv.includes('--pages');

const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site.json'), 'utf8'));
const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'works.json'), 'utf8'));
const works = cat.works;
const seriesList = cat.series;

const content = {};
for (const f of fs.readdirSync(path.join(ROOT, 'content'))) {
  if (f.endsWith('.md')) content[f.replace(/\.md$/, '')] = render(fs.readFileSync(path.join(ROOT, 'content', f), 'utf8'));
}

/* ------------------------------------------------------------------ images */

/** True when every file a manifest entry claims is actually on disk, so a
 *  re-run can skip work that is already encoded. */
function entryIntact(entry) {
  if (!entry) return false;
  const files = entry.avif.concat(entry.jpeg, entry.full ? [entry.full] : []);
  return files.every((v) => fs.existsSync(path.join(DIST, v.src.replace(/^\//, ''))));
}

async function buildImages() {
  // Re-encoding fourteen 16MP masters takes the better part of an hour, and
  // adding one painting should not cost that. Anything already on disk is
  // reused unless --force says otherwise.
  const force = process.argv.includes('--force');
  const previous = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { works: {} };
  const manifest = { works: {} };

  if (!fs.existsSync(MASTERS)) {
    console.error(`\n  No masters directory at ${MASTERS}`);
    console.error('  Put the originals there (see README), or run with --pages to rebuild HTML only.\n');
    process.exit(1);
  }

  for (const w of works) {
    console.log(`\n  ${w.id}`);
    manifest.works[w.id] = {};
    for (const [role, rel] of [['primary', w.master], ['install', w.install], ['room', w.room]]) {
      if (!rel) continue;
      const srcFile = path.join(MASTERS, rel);
      if (!fs.existsSync(srcFile)) {
        console.warn(`    ! missing ${role}: ${rel}`);
        continue;
      }

      const cached = previous.works[w.id] && previous.works[w.id][role];
      if (!force && entryIntact(cached) && cached.source === path.basename(rel)) {
        console.log(`    ${role}  — already encoded, skipping`);
        manifest.works[w.id][role] = cached;
        continue;
      }

      console.log(`    ${role}  <- ${rel}`);
      manifest.works[w.id][role] = await buildImage({
        srcFile,
        outDir: path.join(DIST, 'img', w.id),
        slug: `${w.id}-${role}`,
        publicPath: `/img/${w.id}`,
        zoomable: role === 'primary',
        log: console.log,
      });
    }
    // Written after every work, not at the end: a long build that is
    // interrupted keeps everything it has already done.
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  }
  return manifest;
}

/* --------------------------------------------------------------- templates */

const srcset = (list) => list.map((v) => `${v.src} ${v.w}w`).join(', ');

/**
 * A <picture> with AVIF first and a JPEG fallback. The LQIP sits behind as a
 * background so a black painting never arrives on a white flash.
 */
function picture(img, { alt, sizes, className = '', loading = 'lazy', priority = false, style = '' }) {
  if (!img) return '';
  const jpegFallback = img.jpeg[img.jpeg.length - 1];
  return `<picture>
  <source type="image/avif" srcset="${srcset(img.avif)}" sizes="${sizes}">
  <img src="${jpegFallback.src}" srcset="${srcset(img.jpeg)}" sizes="${sizes}"
       width="${img.width}" height="${img.height}" alt="${esc(alt || '')}"
       class="${className}" ${priority ? 'fetchpriority="high"' : `loading="${loading}"`} decoding="async"
       style="background-image:url(${img.lqip});background-size:cover;${style}">
</picture>`;
}

/** "R-01-01, Oil and acrylic on canvas, 30 × 40 in, 2025" — omitting whatever
 *  is not yet known rather than printing a placeholder. */
function captionParts(w) {
  return [w.medium, w.dimensions, w.year].filter(Boolean);
}

function layout({ title, description, body, current, ogImage, canonical }) {
  const nav = site.nav
    .map((n) => `<a href="${n.href}"${current === n.href ? ' aria-current="page"' : ''}>${n.label}</a>`)
    .join('\n      ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${site.domain}${canonical}">
<meta name="theme-color" content="${site.themeColor || '#ffffff'}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${site.domain}${canonical}">
${ogImage ? `<meta property="og:image" content="${site.domain}${ogImage}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/styles/main.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
<header>
  <a class="wordmark" href="/">${esc(site.wordmark)}</a>
  <nav>
      ${nav}
  </nav>
</header>
<main>
${body}
</main>
<footer>
  <span>© ${new Date().getFullYear()} ${esc(site.name)}</span>
  <span><a href="mailto:${site.email}">${site.email}</a></span>
  <span><a href="https://instagram.com/${site.instagram.art}" rel="me noopener">Instagram</a></span>
</footer>
<script src="/scripts/app.js" defer></script>
</body>
</html>
`;
}

/* -------------------------------------------------------------- page bodies */

function tile(w, img) {
  const parts = captionParts(w);
  return `<a class="tile reveal" href="/work/${w.id}/">
  <span class="tile-frame">
    ${picture(img, {
      alt: w.alt || `${w.id}, painting by ${site.name}`,
      sizes: '(max-width: 40rem) 100vw, (max-width: 80rem) 50vw, 33vw',
    })}
  </span>
  <span class="caption"><span class="id">${w.id}</span>${parts.length ? `<span>${esc(parts.join(', '))}</span>` : ''}</span>
</a>`;
}

function indexPage(m) {
  const hero = works.find((w) => w.id === site.hero) || works[0];
  const heroImg = m.works[hero.id] && m.works[hero.id].primary;
  const selected = (site.selected || [])
    .map((id) => works.find((w) => w.id === id))
    .filter((w) => w && m.works[w.id] && m.works[w.id].primary);

  const body = `
<section class="hero">
  <figure class="reveal in">
    ${picture(heroImg, {
      alt: hero.alt || `${hero.id}, painting by ${site.name}`,
      sizes: '(max-width: 60rem) 92vw, 60vw',
      priority: true,
    })}
    <figcaption class="caption"><span class="id">${hero.id}</span></figcaption>
  </figure>
</section>

<section class="section">
  <div class="section-head">
    <h2>${esc(site.tagline)}</h2>
    <p>Meia rejects painting as image. These paintings do not depict; they operate. What appears is not an image but the result of a system in which visibility is produced, destabilized, and made contingent.</p>
  </div>
  <div class="grid">
    ${selected.map((w) => tile(w, m.works[w.id] && m.works[w.id].primary)).join('\n    ')}
  </div>
  <p class="prose" style="margin-top:clamp(3rem,8vh,6rem)"><a href="/work/">All work →</a></p>
</section>`;

  return layout({
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    body,
    current: '/',
    canonical: '/',
    ogImage: heroImg && heroImg.jpeg[heroImg.jpeg.length - 1].src,
  });
}

function workIndexPage(m) {
  const sections = seriesList
    .map((s) => {
      // Only works that actually have a built image — otherwise the index
      // links to a page that was never generated.
      const inSeries = works.filter((w) => w.series === s.id && m.works[w.id] && m.works[w.id].primary);
      if (!inSeries.length) return '';
      return `<section class="section">
  <div class="section-head">
    <h2>${esc(s.id)} · ${esc(s.title)}</h2>
    <p>${esc(s.note)}</p>
  </div>
  <div class="grid">
    ${inSeries.map((w) => tile(w, m.works[w.id] && m.works[w.id].primary)).join('\n    ')}
  </div>
</section>`;
    })
    .join('\n');

  return layout({
    title: `Work — ${site.name}`,
    description: `Paintings by ${site.name}. ${site.description}`,
    body: sections,
    current: '/work/',
    canonical: '/work/',
  });
}

function workPage(w, m, prev, next) {
  const imgs = m.works[w.id] || {};
  const img = imgs.primary;
  const parts = captionParts(w);

  const views = ['install', 'room']
    .filter((k) => imgs[k])
    .map(
      (k) => `<figure class="reveal">
    ${picture(imgs[k], {
      alt: k === 'install' ? `${w.id} installed` : `${w.id} in the gallery`,
      sizes: '(max-width: 60rem) 100vw, 80vw',
    })}
    <figcaption class="caption">${k === 'install' ? 'Installation view' : 'Gallery view'}</figcaption>
  </figure>`
    )
    .join('\n  ');

  const text = [w.description, w.text].filter(Boolean).join('\n\n');

  const body = `
<article>
  <section class="plate">
    <figure class="plate-figure reveal in">
      <span data-zoom-src="${img.full.src}" data-zoom-w="${img.full.w}" data-zoom-h="${img.height}"
            data-zoom-label="${esc(w.id)}" aria-label="View ${esc(w.id)} at full resolution">
        ${picture(img, {
          alt: w.alt || `${w.id}, painting by ${site.name}`,
          sizes: '(max-width: 60rem) 100vw, 75vw',
          priority: true,
        })}
      </span>
      <figcaption class="plate-caption">
        <span class="id">${w.id}</span>
        ${parts.length ? `<span class="meta" style="text-transform:none;letter-spacing:0">${esc(parts.join(', '))}</span>` : ''}
        <span class="zoom-hint">Click to view at ${img.full.w} × ${img.height} px</span>
      </figcaption>
    </figure>
  </section>

  ${text ? `<div class="work-text reveal">${text.split('\n\n').map((p) => `<p>${esc(p)}</p>`).join('\n')}</div>` : ''}

  ${views ? `<section class="views section">\n  ${views}\n</section>` : ''}

  <nav class="pager">
    ${prev ? `<a href="/work/${prev.id}/">← ${prev.id}</a>` : '<span></span>'}
    <a href="/work/">Index</a>
    ${next ? `<a href="/work/${next.id}/">${next.id} →</a>` : '<span></span>'}
  </nav>
</article>`;

  return layout({
    title: `${w.id} — ${site.name}`,
    description: w.description || w.alt || `${w.id}, painting by ${site.name}.`,
    body,
    current: '/work/',
    canonical: `/work/${w.id}/`,
    ogImage: img.jpeg[img.jpeg.length - 1].src,
  });
}

function prosePage({ key, title, current, lede }) {
  const c = content[key];
  const body = `<section class="section">
  <div class="prose reveal in">
    <h1>${esc(c.title || title)}</h1>
    ${lede ? `<p class="lede">${esc(lede)}</p>` : ''}
    ${c.html}
  </div>
</section>`;
  return layout({
    title: `${c.title || title} — ${site.name}`,
    description: site.description,
    body,
    current,
    canonical: current,
  });
}

function bioPage() {
  const body = `<section class="section">
  <div class="prose reveal in">
    <h1>${esc(content.biography.title)}</h1>
    ${content.biography.html}
    <h2>${esc(content.cv.title)}</h2>
    ${content.cv.html}
  </div>
</section>`;
  return layout({
    title: `Bio — ${site.name}`,
    description: `Biography and CV of ${site.name}, artist, New York.`,
    body,
    current: '/bio/',
    canonical: '/bio/',
  });
}

function contactPage() {
  const body = `<section class="section">
  <div class="prose reveal in">
    <h1>Contact</h1>
    <dl class="contact-list">
      <div><dt>Enquiries</dt><dd><a href="mailto:${site.email}">${site.email}</a></dd></div>
      <div><dt>Studio</dt><dd>${esc(site.location)}</dd></div>
      <div><dt>Instagram</dt><dd><a href="https://instagram.com/${site.instagram.art}" rel="me noopener">@${site.instagram.art}</a></dd></div>
      <div><dt>Tattoo</dt><dd><a href="https://instagram.com/${site.instagram.tattoo}" rel="me noopener">@${site.instagram.tattoo}</a></dd></div>
    </dl>
    <p style="margin-top:3rem;color:var(--muted)">For availability, price lists, or high-resolution files for press, please write. Works are photographed and catalogued at full resolution.</p>
  </div>
</section>`;
  return layout({ title: `Contact — ${site.name}`, description: `Contact ${site.name}.`, body, current: '/contact/', canonical: '/contact/' });
}

/* ------------------------------------------------------------------- write */

function write(rel, html) {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

function copyStatic(built) {
  const copyDir = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const s = path.join(from, e.name), d = path.join(to, e.name);
      e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
    }
  };
  copyDir(path.join(ROOT, 'site', 'styles'), path.join(DIST, 'styles'));
  copyDir(path.join(ROOT, 'site', 'scripts'), path.join(DIST, 'scripts'));

  // A wordmark favicon — no binary asset to keep in sync.
  write('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ffffff"/><rect x="0.5" y="0.5" width="31" height="31" fill="none" stroke="#dedad2"/><text x="16" y="22" font-family="American Typewriter,Courier New,Courier,monospace" font-size="16" fill="#111110" text-anchor="middle">M</text></svg>`);

  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${site.domain}/sitemap.xml\n`);

  const urls = ['/', '/work/', '/refletismo/', '/statement/', '/bio/', '/contact/'].concat(built.map((w) => `/work/${w.id}/`));
  write(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => `  <url><loc>${site.domain}${u}</loc></url>`).join('\n') +
      `\n</urlset>\n`
  );

  // GitHub Pages custom domain. Off by default and deliberately so: with a
  // CNAME present, Pages serves the custom domain only and redirects the
  // github.io URL to it. While meia-g.art still points at Squarespace that
  // makes the new site look broken instead of previewable. Set customDomain
  // in data/site.json once DNS is ready to switch.
  const cnamePath = path.join(DIST, 'CNAME');
  if (site.customDomain) write('CNAME', site.customDomain + '\n');
  else if (fs.existsSync(cnamePath)) fs.unlinkSync(cnamePath);   // clear a stale one
}

/** What still needs Meia's input, so it is visible rather than silently absent. */
function gapsReport() {
  const rows = works.filter((w) => (w.needs || []).length);
  if (!rows.length) return console.log('\n  Catalogue complete — no missing fields.\n');
  console.log(`\n  Catalogue gaps — ${rows.length} of ${works.length} works need details:`);
  for (const w of rows) console.log(`    ${w.id.padEnd(9)} ${w.needs.join(', ')}`);
  const md =
    `# Catalogue gaps\n\nThese fields are missing from \`data/works.json\`. The site omits them rather than\nguessing, so filling them in is all that is needed — no template changes.\n\n| Work | Missing |\n| --- | --- |\n` +
    rows.map((w) => `| ${w.id} | ${w.needs.join(', ')} |`).join('\n') +
    '\n';
  fs.writeFileSync(path.join(ROOT, 'CATALOGUE-GAPS.md'), md);
  console.log('\n  Written to CATALOGUE-GAPS.md\n');
}

/* -------------------------------------------------------------------- main */

(async () => {
  let manifest;
  if (PAGES_ONLY) {
    if (!fs.existsSync(MANIFEST)) {
      console.error('\n  No data/manifest.json yet — run a full build first.\n');
      process.exit(1);
    }
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    console.log('  Reusing existing derivatives.');
  } else {
    console.log('  Building derivatives…');
    manifest = await buildImages();
  }

  const present = works.filter((w) => manifest.works[w.id] && manifest.works[w.id].primary);

  write('index.html', indexPage(manifest));
  write('work/index.html', workIndexPage(manifest));
  present.forEach((w, i) => {
    write(`work/${w.id}/index.html`, workPage(w, manifest, present[i - 1], present[i + 1]));
  });
  write('refletismo/index.html', prosePage({ key: 'refletismo', title: 'Refletismo', current: '/refletismo/' }));
  write('statement/index.html', prosePage({ key: 'statement', title: 'Statement', current: '/statement/' }));
  write('bio/index.html', bioPage());
  write('contact/index.html', contactPage());
  write('404.html', layout({
    title: `Not found — ${site.name}`,
    description: 'Page not found.',
    body: `<section class="section"><div class="prose"><h1>Not found</h1><p><a href="/work/">Return to the work →</a></p></div></section>`,
    current: '', canonical: '/404.html',
  }));

  copyStatic(present);

  const totalBytes = present.reduce((n, w) => {
    const e = manifest.works[w.id].primary;
    return n + e.avif.reduce((a, v) => a + v.bytes, 0) + (e.full ? e.full.bytes : 0);
  }, 0);

  console.log(`\n  Built ${present.length} works → ${path.relative(process.cwd(), DIST)}`);
  console.log(`  Primary image derivatives: ${(totalBytes / 1e6).toFixed(1)} MB`);
  gapsReport();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
