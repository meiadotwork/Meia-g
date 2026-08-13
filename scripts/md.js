'use strict';
/** The smallest markdown subset the content files actually use:
 *  headings, paragraphs, bold, italic, links. No dependency worth adding. */

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>');
}

/** Returns { title, html } — the leading `# Heading` is lifted out as the
 *  title so templates can place it themselves. */
function render(src) {
  const blocks = src.trim().split(/\n{2,}/);
  let title = null;
  const out = [];

  for (const raw of blocks) {
    const b = raw.trim();
    if (!b) continue;
    const h = b.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      if (level === 1 && title === null) { title = h[2]; continue; }
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    // single newlines inside a block become <br> (used by the CV address block)
    out.push('<p>' + b.split('\n').map(inline).join('<br>') + '</p>');
  }
  return { title, html: out.join('\n') };
}

module.exports = { render, esc, inline };
