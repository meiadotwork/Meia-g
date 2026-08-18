'use strict';
/**
 * Static build for meia-g.art.
 *
 *   node scripts/build.js            full build (images + pages)
 *   node scripts/build.js --pages    pages only, reuse existing derivatives
 *   node scripts/build.js --force    re-encode every image from the masters
 *
 * Masters are read from ./masters (override with MASTERS_DIR). They are not in
 * the repository — they are 1.3 GB of camera files. The derivatives in
 * dist/img are, because those are the website.
 *
 * The site is built once per language into its own tree (/, /pt, /es) off a
 * single set of images. Translations live in data/i18n.json, data/works.<lang>.json
 * and content/<lang>/; anything untranslated falls back to English rather than
 * rendering blank.
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
const i18n = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n.json'), 'utf8'));
const works = cat.works;
const LANGS = i18n.languages;

/** Per-language content and work-text, with English underneath as fallback. */
function loadLang(code) {
  const dir = path.join(ROOT, 'content', code);
  const content = {};
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.md')) content[f.replace(/\.md$/, '')] = render(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  }
  const wtPath = path.join(ROOT, 'data', `works.${code}.json`);
  const wt = fs.existsSync(wtPath) ? JSON.parse(fs.readFileSync(wtPath, 'utf8')) : {};
  return { content, wt };
}

const EN = loadLang('en');

const CONTEXTS = LANGS.map((l) => {
  const { content, wt } = l.code === 'en' ? EN : loadLang(l.code);
  const pack = i18n[l.code] || i18n.en;
  return {
    ...l,
    t: { ...i18n.en.ui, ...(pack.ui || {}) },
    series: pack.series || i18n.en.series,
    tagline: pack.tagline || i18n.en.tagline,
    description: pack.description || i18n.en.description,
    landingNote: pack.landingNote || i18n.en.landingNote,
    content: { ...EN.content, ...content },
    wt,
  };
});

/* ------------------------------------------------------------------ images */

function entryIntact(entry) {
  if (!entry) return false;
  const files = entry.avif.concat(entry.jpeg, entry.full ? [entry.full] : []);
  return files.every((v) => fs.existsSync(path.join(DIST, v.src.replace(/^\//, ''))));
}

async function buildImages() {
  const force = process.argv.includes('--force');
  const previous = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { works: {} };
  const manifest = { works: {} };

  // No masters is normal on a CI builder: they are 1.3 GB of camera files kept
  // in Dropbox, while the derivatives they produce are committed under dist/img.
  // If a manifest is already there, the derivatives are too — fall back to a
  // pages-only build rather than failing the deploy. Only a machine with
  // neither masters nor a manifest has nothing to work from.
  if (!fs.existsSync(MASTERS)) {
    if (fs.existsSync(MANIFEST)) {
      console.warn(`\n  No masters at ${MASTERS} — reusing the committed derivatives.`);
      console.warn('  Run a full build on a machine with the originals to re-encode.\n');
      return previous;
    }
    console.error(`\n  No masters directory at ${MASTERS}, and no data/manifest.json.`);
    console.error('  Put the originals there (see README), or run with --pages to rebuild HTML only.\n');
    process.exit(1);
  }

  for (const w of works) {
    console.log(`\n  ${w.id}`);
    manifest.works[w.id] = {};
    for (const [role, rel] of [['primary', w.master], ['install', w.install], ['room', w.room]]) {
      if (!rel) continue;
      const srcFile = path.join(MASTERS, rel);
      if (!fs.existsSync(srcFile)) { console.warn(`    ! missing ${role}: ${rel}`); continue; }

      const cached = previous.works[w.id] && previous.works[w.id][role];
      if (!force && entryIntact(cached) && cached.source === path.basename(rel)) {
        console.log(`    ${role}  — already encoded, skipping`);
        manifest.works[w.id][role] = cached;
        continue;
      }
      console.log(`    ${role}  <- ${rel}`);
      manifest.works[w.id][role] = await buildImage({
        srcFile, outDir: path.join(DIST, 'img', w.id), slug: `${w.id}-${role}`,
        publicPath: `/img/${w.id}`, zoomable: role === 'primary', log: console.log,
      });
    }
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  }
  return manifest;
}

/* --------------------------------------------------------------- templates */

const srcset = (list) => list.map((v) => `${v.src} ${v.w}w`).join(', ');
const pad = (n) => String(n).padStart(2, '0');

function picture(img, { alt, sizes, className = '', loading = 'lazy', priority = false }) {
  if (!img) return '';
  const jpegFallback = img.jpeg[img.jpeg.length - 1];
  return `<picture>
  <source type="image/avif" srcset="${srcset(img.avif)}" sizes="${sizes}">
  <img src="${jpegFallback.src}" srcset="${srcset(img.jpeg)}" sizes="${sizes}"
       width="${img.width}" height="${img.height}" alt="${esc(alt || '')}"
       class="${className}" ${priority ? 'fetchpriority="high"' : `loading="${loading}"`} decoding="async"
       style="background-image:url(${img.lqip});background-size:cover;">
</picture>`;
}

/** Localised field access — falls back to the English entry when a
 *  translation is absent, so a page is never blank for want of one. */
const wtx = (L, w, field) => (L.wt[w.id] && L.wt[w.id][field]) || w[field] || null;
const medium = (L, w) => (w.medium && i18n.media[w.medium] && i18n.media[w.medium][L.code]) || w.medium;
const dims = (L, w) => (w.dimensions && i18n.dimensions[w.dimensions] && i18n.dimensions[w.dimensions][L.code]) || w.dimensions;
const captionParts = (L, w) => [medium(L, w), dims(L, w), w.year].filter(Boolean);
const url = (L, route) => `${L.prefix}${route}`;

/** `switcherRoute` exists for the 404: it is a single root page, so the
 *  language links must point at each language's home rather than at
 *  /pt/404.html, which is never generated. */
function layout(L, { title, description, body, current, ogImage, route, switcherRoute, ogTitle }) {
  const alt = switcherRoute || route;
  const nav = [
    ['/work/', L.t.work], ['/refletismo/', L.t.refletismo], ['/statement/', L.t.statement],
    ['/bio/', L.t.bio], ['/contact/', L.t.contact],
  ].map(([r, label]) => `<a href="${url(L, r)}"${current === r ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('\n      ');

  // Same page, other language.
  const switcher = LANGS.map((l) =>
    l.code === L.code
      ? `<span class="on" aria-current="true">${l.label}</span>`
      : `<a href="${l.prefix}${alt}" hreflang="${l.code}" lang="${l.code}" title="${esc(l.name)}">${l.label}</a>`
  ).join('');

  const alternates = LANGS.map((l) => `<link rel="alternate" hreflang="${l.code}" href="${site.domain}${l.prefix}${alt}">`).join('\n');

  return `<!doctype html>
<html lang="${L.code}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${site.domain}${url(L, route)}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${site.domain}${alt}">
<meta name="theme-color" content="${site.themeColor || '#ffffff'}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(ogTitle || title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:locale" content="${L.code}">
<meta property="og:url" content="${site.domain}${url(L, route)}">
${ogImage ? `<meta property="og:image" content="${site.domain}${ogImage}">` : ''}
<meta name="twitter:title" content="${esc(ogTitle || title)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/styles/main.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script>document.documentElement.className+=' js'</script>
</head>
<body>
<header>
  <a class="wordmark" href="${url(L, '/')}">${esc(site.wordmark)}</a>
  <div class="head-right">
    <nav>
      ${nav}
    </nav>
    <div class="langs" role="group" aria-label="${esc(L.t.langLabel)}">${switcher}</div>
  </div>
</header>
<main>
${body}
</main>
<script src="/scripts/app.js" defer></script>
</body>
</html>
`;
}

/* -------------------------------------------------------------- page bodies */

/** No sequence number: the id (R-02-06) is already the catalogue number, and
 *  the index runs newest-first, so a second count would read "01" beside it. */
function tile(L, w, img) {
  const parts = captionParts(L, w);
  return `<a class="tile reveal" href="${url(L, `/work/${w.id}/`)}">
  <span class="tile-frame">
    ${picture(img, { alt: wtx(L, w, 'alt') || `${w.id}, ${site.name}`, sizes: '(max-width: 40rem) 100vw, (max-width: 80rem) 50vw, 33vw' })}
  </span>
  <span class="caption"><span class="id">${w.id}</span>${parts.length ? `, ${esc(parts.join(', '))}` : ''}</span>
</a>`;
}

function indexPage(L, m) {
  const hero = works.find((w) => w.id === site.hero) || works[0];
  const heroImg = m.works[hero.id] && m.works[hero.id].primary;
  const st = L.content.statement;

  // The share card is its own choice, not the hero. Messages tints the caption
  // bar with a colour sampled from the image, so a painting carrying warm
  // highlights turns that bar brown. site.shareImage names a work with no such
  // highlights; see the note in data/site.json.
  const share = works.find((w) => w.id === site.shareImage);
  const shareImg = (share && m.works[share.id] && m.works[share.id].primary) || heroImg;

  // The landing page closes with the last paragraph of Refletismo — quoted from
  // that file rather than duplicated, so editing Refletismo edits this too. It
  // used to reprint the whole Statement, which /statement/ already carries word
  // for word. Falls back to the statement if Refletismo is ever missing.
  const ref = L.content.refletismo;
  const closing = ref && ref.paragraphs && ref.paragraphs.length
    ? ref.paragraphs[ref.paragraphs.length - 1] : null;

  // What meia-g.art opens with: one painting, then the statement. Nothing else.
  const body = `
<section class="hero">
  <figure class="reveal in">
    ${picture(heroImg, { alt: wtx(L, hero, 'alt') || hero.id, sizes: '(max-width: 60rem) 92vw, 60vw', priority: true })}
    <figcaption class="caption"><span class="id">${hero.id}</span>${captionParts(L, hero).length ? `, ${esc(captionParts(L, hero).join(', '))}` : ''}</figcaption>
  </figure>
</section>

<section class="section">
  <div class="prose reveal">
    ${closing ? `<p class="creed">${closing}</p>` : `<h1>${esc(st.title || '')}</h1>\n    ${st.html}`}
  </div>
</section>`;

  return layout(L, {
    title: `${site.name} — ${L.tagline}`, ogTitle: site.name,
    description: L.description, body,
    current: '/', route: '/', ogImage: shareImg && shareImg.jpeg[shareImg.jpeg.length - 1].src,
  });
}

/** Work is an index of series, as it is on meia-g.art — the paintings live
 *  one level down, so the page opens as three names rather than fourteen
 *  images. */
function workIndexPage(L, m) {
  const covers = site.seriesCovers || {};
  const entries = Object.keys(L.series)
    .map((id) => ({ id, list: works.filter((w) => w.series === id && m.works[w.id] && m.works[w.id].primary) }))
    .filter((e) => e.list.length);

  const body = `<section class="section series-index">
  ${entries.map((e) => {
    const coverId = covers[e.id] && m.works[covers[e.id]] ? covers[e.id] : e.list[0].id;
    const years = e.list.map((w) => w.year).filter(Boolean);
    const span = years.length ? (Math.min(...years) === Math.max(...years) ? `${Math.min(...years)}` : `${Math.min(...years)}–${Math.max(...years)}`) : null;
    return `<a class="series-card reveal" href="${url(L, `/work/${e.id}/`)}">
    <span class="series-frame">${picture(m.works[coverId].primary, { alt: e.id, sizes: '(max-width: 40rem) 100vw, (max-width: 80rem) 50vw, 33vw' })}</span>
    <span class="series-name">${esc(e.id)}${span ? ` <span class="count">${span}</span>` : ''}</span>
  </a>`;
  }).join('\n  ')}
</section>`;

  return layout(L, { title: `${L.t.work} — ${site.name}`, description: L.description, body, current: '/work/', route: '/work/' });
}

/** One series, its paintings. */
function seriesPage(L, id, m) {
  const list = works.filter((w) => w.series === id && m.works[w.id] && m.works[w.id].primary);
  const years = list.map((w) => w.year).filter(Boolean);
  const span = years.length ? (Math.min(...years) === Math.max(...years) ? `${Math.min(...years)}` : `${Math.min(...years)}–${Math.max(...years)}`) : null;

  const body = `<section class="section">
  <div class="section-head">
    <h2>${esc(id)}${span ? ` <span class="count">${span}</span>` : ''}</h2>
  </div>
  <div class="grid">
    ${list.map((w) => tile(L, w, m.works[w.id].primary)).join('\n    ')}
  </div>
</section>`;

  return layout(L, { title: `${id} — ${site.name}`, description: L.description, body, current: '/work/', route: `/work/${id}/` });
}

function workPage(L, w, m, prev, next) {
  const imgs = m.works[w.id] || {};
  const img = imgs.primary;
  const parts = captionParts(L, w);
  const s = L.series[w.series] || {};
  const siblings = works.filter((x) => x.series === w.series && m.works[x.id] && m.works[x.id].primary);
  const own = Number((w.id.match(/(\d+)$/) || [])[1]);
  const highest = Math.max(...siblings.map((x) => Number((x.id.match(/(\d+)$/) || [])[1]) || 0));
  const position = Number.isFinite(own) ? own : siblings.findIndex((x) => x.id === w.id) + 1;

  // No labels. A painting on a wall does not need to be captioned as such.
  const views = ['install', 'room'].filter((k) => imgs[k]).map((k) => `<figure class="reveal">
    ${picture(imgs[k], { alt: `${w.id} — ${k === 'install' ? L.t.installationView : L.t.galleryView}`, sizes: '(max-width: 60rem) 100vw, 80vw' })}
  </figure>`).join('\n  ');

  const text = [wtx(L, w, 'description'), wtx(L, w, 'text')].filter(Boolean).join('\n\n');

  const thumb = (x, dir) => {
    const t = m.works[x.id].primary, small = t.avif[0];
    return `<a class="${dir}" href="${url(L, `/work/${x.id}/`)}">
      <img src="${small.src}" width="${small.w}" height="${Math.round(small.w / t.aspect)}" alt="" loading="lazy">
      <span class="lab"><span class="dir">${esc(dir === 'prev' ? L.t.previous : L.t.next)}</span><span>${x.id}</span></span>
    </a>`;
  };

  const body = `
<article>
  <div class="runhead">
    <span class="series">${esc(w.series)}</span>
    <span class="pos">${pad(position)} ${esc(L.t.of)} ${pad(highest)}</span>
  </div>

  <section class="plate">
    <figure class="plate-figure reveal in">
      <span data-zoom-src="${img.full.src}" data-zoom-w="${img.full.w}" data-zoom-h="${img.height}"
            data-zoom-label="${esc(w.id)}" aria-label="${esc(w.id)} — ${esc(L.t.clickToEnlarge)}">
        ${picture(img, { alt: wtx(L, w, 'alt') || `${w.id}, ${site.name}`, sizes: '(max-width: 60rem) 100vw, 75vw', priority: true })}
      </span>
      <figcaption class="plate-caption">
        <span class="id">${w.id}${parts.length ? `, ${esc(parts.join(', '))}` : ''}</span>
      </figcaption>
    </figure>
  </section>

  ${views ? `<section class="views section">\n  ${views}\n</section>` : ''}

  <nav class="pager-rich">
    ${prev ? thumb(prev, 'prev') : '<span></span>'}
    <a class="idx" href="${url(L, `/work/${w.series}/`)}">${esc(L.t.index)}</a>
    ${next ? thumb(next, 'next') : '<span></span>'}
  </nav>
</article>`;

  return layout(L, {
    title: `${w.id} — ${site.name}`,
    description: wtx(L, w, 'description') || wtx(L, w, 'alt') || `${w.id}, ${site.name}.`,
    body, current: '/work/', route: `/work/${w.id}/`,
    ogImage: img.jpeg[img.jpeg.length - 1].src,
  });
}

function prosePage(L, { key, route, current }) {
  const c = L.content[key];
  const body = `<section class="section">
  <div class="prose reveal in">
    <h1>${esc(c.title || '')}</h1>
    ${c.html}
  </div>
</section>`;
  return layout(L, { title: `${c.title} — ${site.name}`, description: L.description, body, current, route });
}

function bioPage(L) {
  const body = `<section class="section">
  <div class="prose reveal in">
    <h1>${esc(L.content.biography.title)}</h1>
    ${L.content.biography.html}
    <h2>${esc(L.content.cv.title)}</h2>
    ${L.content.cv.html}
  </div>
</section>`;
  return layout(L, { title: `${L.content.biography.title} — ${site.name}`, description: L.description, body, current: '/bio/', route: '/bio/' });
}

function contactPage(L) {
  const body = `<section class="section">
  <div class="prose reveal in">
    <h1>${esc(L.t.contact)}</h1>
    <dl class="contact-list">
      <div><dt>${esc(L.t.enquiries)}</dt><dd><a href="mailto:${site.email}">${site.email}</a></dd></div>
      <div><dt>${esc(L.t.studio)}</dt><dd>${esc(site.location)}</dd></div>
      <div><dt>${esc(L.t.instagram)}</dt><dd><a href="https://instagram.com/${site.instagram.art}" rel="me noopener">@${site.instagram.art}</a></dd></div>
      <div><dt>${esc(L.t.tattoo)}</dt><dd><a href="https://instagram.com/${site.instagram.tattoo}" rel="noopener">@${site.instagram.tattoo}</a></dd></div>
    </dl>
  </div>
</section>`;
  return layout(L, { title: `${L.t.contact} — ${site.name}`, description: L.description, body, current: '/contact/', route: '/contact/' });
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

  write('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ffffff"/><rect x="0.5" y="0.5" width="31" height="31" fill="none" stroke="#dedad2"/><text x="16" y="22" font-family="American Typewriter,Courier New,Courier,monospace" font-size="16" fill="#111110" text-anchor="middle">M</text></svg>`);
  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${site.domain}/sitemap.xml\n`);

  // Cloudflare Pages / Netlify read this. Pages are re-fetched so an edit goes
  // live immediately; derivatives are cached for a week — long enough to matter,
  // short enough that replacing a painting under the same filename corrects
  // itself without anyone clearing a cache.
  write('_headers', [
    '/*', '  Cache-Control: public, max-age=0, must-revalidate', '',
    '/img/*', '  Cache-Control: public, max-age=604800', '',
    '/styles/*', '  Cache-Control: public, max-age=604800', '',
    '/scripts/*', '  Cache-Control: public, max-age=604800', '',
  ].join('\n') + '\n');

  const seriesIds = [...new Set(built.map((w) => w.series))];
  const routes = ['/', '/work/', '/refletismo/', '/statement/', '/bio/', '/contact/']
    .concat(seriesIds.map((id) => `/work/${id}/`))
    .concat(built.map((w) => `/work/${w.id}/`));
  const urls = [];
  for (const r of routes) {
    const alts = LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${site.domain}${l.prefix}${r}"/>`).join('\n');
    for (const l of LANGS) urls.push(`  <url>\n    <loc>${site.domain}${l.prefix}${r}</loc>\n${alts}\n  </url>`);
  }
  write('sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);

  const cnamePath = path.join(DIST, 'CNAME');
  if (site.customDomain) write('CNAME', site.customDomain + '\n');
  else if (fs.existsSync(cnamePath)) fs.unlinkSync(cnamePath);
}

function gapsReport() {
  const rows = works.filter((w) => (w.needs || []).length);
  if (!rows.length) { console.log('\n  Catalogue complete — no missing fields.\n'); return; }
  console.log(`\n  Catalogue gaps — ${rows.length} of ${works.length} works need details:`);
  for (const w of rows) console.log(`    ${w.id.padEnd(9)} ${w.needs.join(', ')}`);
  const md = `# Catalogue gaps\n\nThese fields are missing from \`data/works.json\`. The site omits them rather than\nguessing, so filling them in is all that is needed — no template changes.\n\n| Work | Missing |\n| --- | --- |\n` +
    rows.map((w) => `| ${w.id} | ${w.needs.join(', ')} |`).join('\n') + '\n';
  fs.writeFileSync(path.join(ROOT, 'CATALOGUE-GAPS.md'), md);
  console.log('\n  Written to CATALOGUE-GAPS.md\n');
}

/* -------------------------------------------------------------------- main */

(async () => {
  let manifest;
  if (PAGES_ONLY) {
    if (!fs.existsSync(MANIFEST)) { console.error('\n  No data/manifest.json yet — run a full build first.\n'); process.exit(1); }
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    console.log('  Reusing existing derivatives.');
  } else {
    console.log('  Building derivatives…');
    manifest = await buildImages();
  }

  const present = works.filter((w) => manifest.works[w.id] && manifest.works[w.id].primary);

  for (const L of CONTEXTS) {
    const p = L.prefix;
    write(`${p}/index.html`.replace(/^\//, ''), indexPage(L, manifest));
    write(`${p}/work/index.html`.replace(/^\//, ''), workIndexPage(L, manifest));
    for (const id of Object.keys(L.series)) {
      const list = present.filter((w) => w.series === id);
      if (!list.length) continue;
      write(`${p}/work/${id}/index.html`.replace(/^\//, ''), seriesPage(L, id, manifest));
      list.forEach((w, i) => write(`${p}/work/${w.id}/index.html`.replace(/^\//, ''), workPage(L, w, manifest, list[i - 1], list[i + 1])));
    }
    write(`${p}/refletismo/index.html`.replace(/^\//, ''), prosePage(L, { key: 'refletismo', route: '/refletismo/', current: '/refletismo/' }));
    write(`${p}/statement/index.html`.replace(/^\//, ''), prosePage(L, { key: 'statement', route: '/statement/', current: '/statement/' }));
    write(`${p}/bio/index.html`.replace(/^\//, ''), bioPage(L));
    write(`${p}/contact/index.html`.replace(/^\//, ''), contactPage(L));
    console.log(`  ${L.name.padEnd(11)} ${present.length + 6} pages -> ${p || '/'}`);
  }

  // One 404 at the root; hosts serve it for any path, so it stays English.
  write('404.html', layout(CONTEXTS[0], {
    title: `${CONTEXTS[0].t.notFound} — ${site.name}`, description: 'Page not found.',
    body: `<section class="section"><div class="prose"><h1>${CONTEXTS[0].t.notFound}</h1><p><a href="/work/">${CONTEXTS[0].t.returnToWork} &rarr;</a></p></div></section>`,
    current: '', route: '/404.html', switcherRoute: '/',
  }));

  copyStatic(present);

  console.log(`\n  Built ${present.length} works in ${CONTEXTS.length} languages`);
  gapsReport();
})().catch((e) => { console.error(e); process.exit(1); });
