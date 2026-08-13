'use strict';
/** Verifies the built site: every referenced asset resolves, every work page
 *  exists, and no page is missing its full-resolution zoom file.
 *  node scripts/check.js */

const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist');
let errors = 0;
const note = (m) => { console.log('  FAIL  ' + m); errors++; };

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function resolves(ref) {
  if (/^(https?:|mailto:|data:|#)/.test(ref)) return true;
  const clean = ref.split('#')[0].split('?')[0];
  if (!clean.startsWith('/')) return true;              // no relative refs are emitted
  const target = path.join(DIST, clean);
  if (fs.existsSync(target)) {
    return fs.statSync(target).isDirectory() ? fs.existsSync(path.join(target, 'index.html')) : true;
  }
  return false;
}

const pages = htmlFiles(DIST);
console.log(`\n  Checking ${pages.length} pages…\n`);

let assets = 0;
for (const file of pages) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(DIST, file);

  const refs = new Set();
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/srcset="([^"]+)"/g))
    m[1].split(',').forEach((s) => refs.add(s.trim().split(/\s+/)[0]));
  for (const m of html.matchAll(/data-zoom-src="([^"]+)"/g)) refs.add(m[1]);

  for (const r of refs) {
    assets++;
    if (!resolves(r)) note(`${rel} → missing ${r}`);
  }

  if (/<title><\/title>/.test(html)) note(`${rel} has an empty title`);
  for (const m of html.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/g)) note(`${rel} has an img without alt: ${m[0].slice(0, 70)}`);
}

// every work page carries a zoom target
const manifestPath = path.join(__dirname, '..', 'data', 'manifest.json');
if (fs.existsSync(manifestPath)) {
  const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const [id, roles] of Object.entries(man.works)) {
    if (!roles.primary) continue;
    const page = path.join(DIST, 'work', id, 'index.html');
    if (!fs.existsSync(page)) { note(`no page for ${id}`); continue; }
    if (!/data-zoom-src=/.test(fs.readFileSync(page, 'utf8'))) note(`${id} page has no full-resolution viewer`);
    if (!roles.primary.full) note(`${id} has no full-resolution derivative`);
  }
}

console.log(`\n  ${assets} references checked across ${pages.length} pages.`);
console.log(errors ? `\n  ${errors} problem(s).\n` : '\n  All good.\n');
process.exit(errors ? 1 : 0);
