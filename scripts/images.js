'use strict';
/**
 * Derivative builder.
 *
 * The work is near-black: large areas of the canvas sit under 48/255, and the
 * whole subject of the painting is the *subtle* separation between those dark
 * planes. That is precisely what ordinary web encoding throws away first, so
 * the settings here are chosen against measurements on R-02-06 (the darkest
 * work), scoring mean absolute error in the shadow region rather than overall
 * PSNR. Numbers quoted in ENCODE below are from that test at 2000px wide.
 *
 * Two decisions matter more than the quality number itself:
 *
 *   pipelineColourspace('rgb16')  resize in 16-bit, so the resampling maths
 *                                 does not quantise the dark gradients before
 *                                 the encoder ever sees them.
 *   bitdepth: 10                  10-bit AVIF has finer steps near black, which
 *                                 is where every visible band in this work is.
 *
 * Chroma subsampling is off (4:4:4) throughout. 4:2:0 is what produces the
 * blocky shadow mush in the reference screenshot.
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Let sharp use plenty of memory for the 16-bit pipeline on 20MP masters.
sharp.cache({ items: 0, memory: 512 });
sharp.concurrency(Math.max(1, require('os').cpus().length - 1));

const ENCODE = {
  // Display tiers. q82 10-bit measured better than JPEG q92 4:4:4
  // (PSNR 45.26 vs 45.10, shadow MAE 1.033 vs 1.016) at 60% of the bytes.
  display: { quality: 82, effort: 5, bitdepth: 10, chromaSubsampling: '4:4:4' },
  // Zoom tier — what you see when inspecting the surface. q88 10-bit:
  // PSNR 46.94, shadow MAE 0.835, worst-case error 24/255.
  // effort 4 rather than 6: at 15–20MP the higher setting costs minutes per
  // file for a few percent of size, and quality is set by `quality`, not effort.
  zoom: { quality: 88, effort: 4, bitdepth: 10, chromaSubsampling: '4:4:4' },
  // Fallback for the handful of browsers without AVIF. Full chroma, mozjpeg.
  jpeg: { quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true },
};

const WIDTHS = [640, 1024, 1600, 2200, 3000];
const JPEG_FALLBACK_WIDTHS = [1024, 2200];

/** Gentle compensation for resampling loss on small tiers only. The zoom and
 *  full-resolution images are never sharpened — those must stay untouched. */
const SHARPEN_BELOW = 1600;

async function loadMaster(file) {
  const meta = await sharp(file).metadata();
  return { meta };
}

function base(file) {
  return sharp(file, { limitInputPixels: 512 * 1024 * 1024 })
    .pipelineColourspace('rgb16')   // 16-bit internal pipeline
    .toColourspace('srgb');
}

async function encodeVariant(file, width, native, kind) {
  let p = base(file);
  if (width < native) {
    p = p.resize({ width, kernel: 'lanczos3', fastShrinkOnLoad: false });
    if (width <= SHARPEN_BELOW) p = p.sharpen({ sigma: 0.5, m1: 0.4, m2: 0.6 });
  }
  return p.avif(ENCODE[kind]).withMetadata({ icc: 'srgb' }).toBuffer();
}

async function encodeJpeg(file, width, native) {
  let p = base(file);
  if (width < native) {
    p = p.resize({ width, kernel: 'lanczos3', fastShrinkOnLoad: false });
    if (width <= SHARPEN_BELOW) p = p.sharpen({ sigma: 0.5, m1: 0.4, m2: 0.6 });
  }
  return p.jpeg(ENCODE.jpeg).withMetadata({ icc: 'srgb' }).toBuffer();
}

/** Tiny blurred placeholder, inlined as a data URI so nothing flashes white
 *  before a black painting loads. */
async function lqip(file) {
  const buf = await base(file)
    .resize({ width: 20 })
    .blur(1.2)
    .webp({ quality: 60 })
    .toBuffer();
  return 'data:image/webp;base64,' + buf.toString('base64');
}

/**
 * Build every derivative for one source image.
 * Returns a manifest entry describing what exists on disk.
 */
async function buildImage({ srcFile, outDir, slug, publicPath, zoomable = true, log = () => {} }) {
  const { meta } = await loadMaster(srcFile);
  const native = meta.width;
  fs.mkdirSync(outDir, { recursive: true });

  const widths = WIDTHS.filter((w) => w < native);
  const entry = {
    width: native,
    height: meta.height,
    aspect: +(meta.width / meta.height).toFixed(6),
    avif: [],
    jpeg: [],
    lqip: await lqip(srcFile),
    source: path.basename(srcFile),
  };

  for (const w of widths) {
    const name = `${slug}-${w}.avif`;
    const buf = await encodeVariant(srcFile, w, native, 'display');
    fs.writeFileSync(path.join(outDir, name), buf);
    entry.avif.push({ w, src: `${publicPath}/${name}`, bytes: buf.length });
    log(`      ${String(w).padStart(5)}px avif  ${(buf.length / 1024).toFixed(0)}KB`);
  }

  // Full native resolution, higher quality — the reason this site exists.
  if (zoomable) {
    const name = `${slug}-full.avif`;
    const buf = await encodeVariant(srcFile, native, native, 'zoom');
    fs.writeFileSync(path.join(outDir, name), buf);
    // Deliberately kept out of `entry.avif`: the srcset must never offer this
    // to a browser laying out a thumbnail. It is fetched only by the viewer.
    entry.full = { w: native, src: `${publicPath}/${name}`, bytes: buf.length };
    log(`      ${String(native).padStart(5)}px avif  ${(buf.length / 1024).toFixed(0)}KB  (full resolution)`);
  }

  for (const w of JPEG_FALLBACK_WIDTHS) {
    const ww = Math.min(w, native);
    const name = `${slug}-${ww}.jpg`;
    const buf = await encodeJpeg(srcFile, ww, native);
    fs.writeFileSync(path.join(outDir, name), buf);
    entry.jpeg.push({ w: ww, src: `${publicPath}/${name}`, bytes: buf.length });
  }

  entry.avif.sort((a, b) => a.w - b.w);
  entry.jpeg.sort((a, b) => a.w - b.w);
  return entry;
}

module.exports = { buildImage, ENCODE, WIDTHS };
