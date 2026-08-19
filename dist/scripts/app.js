/* ------------------------------------------------------------------
   Meia G — viewer + reveal

   The zoom viewer exists because the whole argument of this work is at
   the surface: whether one dark plane separates from the next. A 2500px
   re-encode cannot carry that, so a work page holds the full-resolution
   file and hands it over on demand. Nothing loads it until asked.
   ------------------------------------------------------------------ */

(function () {
  'use strict';

  /* ------------------------- reveal on scroll ------------------------ */

  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && reveals.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.04 }
    );
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  /* ----------------------------- zoom -------------------------------- */

  var trigger = document.querySelector('[data-zoom-src]');
  if (!trigger) return;

  var fullSrc = trigger.getAttribute('data-zoom-src');
  var natW = parseInt(trigger.getAttribute('data-zoom-w'), 10) || 0;
  var natH = parseInt(trigger.getAttribute('data-zoom-h'), 10) || 0;
  var label = trigger.getAttribute('data-zoom-label') || '';

  var overlay, stage, img, statusEl, loadingEl;
  var scale = 1, fit = 1, max = 1, tx = 0, ty = 0;
  var loaded = false;

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'zoom';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    // Focus lands on the dialog itself rather than the Close button: focusing
    // a button programmatically draws a focus ring around it even for someone
    // who arrived by mouse, which reads as a rendering artefact over the work.
    overlay.setAttribute('tabindex', '-1');
    overlay.setAttribute('aria-label', label + ' — full resolution');
    overlay.innerHTML =
      '<div class="zoom-stage"></div>' +
      '<div class="zoom-loading">Loading full resolution…</div>' +
      '<button class="zoom-close" type="button">Close</button>' +
      '<div class="zoom-bar"><span class="zoom-label"></span><span class="zoom-status"></span></div>';

    stage = overlay.querySelector('.zoom-stage');
    loadingEl = overlay.querySelector('.zoom-loading');
    statusEl = overlay.querySelector('.zoom-status');
    overlay.querySelector('.zoom-label').textContent = label;
    overlay.querySelector('.zoom-close').addEventListener('click', close);
    document.body.appendChild(overlay);

    img = new Image();
    img.alt = label;
    img.decoding = 'async';
    img.addEventListener('load', function () {
      natW = img.naturalWidth;
      natH = img.naturalHeight;
      loaded = true;
      loadingEl.style.display = 'none';
      reset();
    });
    stage.appendChild(img);

    bindStage();
  }

  function viewport() {
    return { w: overlay.clientWidth, h: overlay.clientHeight };
  }

  function reset() {
    var v = viewport();
    fit = Math.min(v.w / natW, v.h / natH);
    // 1:1 is the meaningful ceiling — one image pixel per CSS pixel — but
    // allow a little past it on small screens where fit is very small.
    max = Math.max(1, fit * 6);
    scale = fit;
    tx = (v.w - natW * scale) / 2;
    ty = (v.h - natH * scale) / 2;
    apply();
  }

  function clamp() {
    var v = viewport();
    var w = natW * scale, h = natH * scale;
    tx = w <= v.w ? (v.w - w) / 2 : Math.min(0, Math.max(v.w - w, tx));
    ty = h <= v.h ? (v.h - h) / 2 : Math.min(0, Math.max(v.h - h, ty));
  }

  function apply() {
    clamp();
    img.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + scale + ')';
    img.style.width = natW + 'px';
    img.style.height = natH + 'px';
    if (statusEl) {
      statusEl.textContent =
        natW + ' × ' + natH + ' px · ' + Math.round(scale * 100) + '%' +
        (scale >= 0.999 ? ' · actual size' : '');
    }
  }

  /** Zoom about a fixed point so the pixel under the cursor stays put. */
  function zoomAt(px, py, next) {
    next = Math.min(max, Math.max(fit * 0.9, next));
    if (next === scale) return;
    var k = next / scale;
    tx = px - (px - tx) * k;
    ty = py - (py - ty) * k;
    scale = next;
    apply();
  }

  function bindStage() {
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, scale * Math.pow(0.9987, e.deltaY));
    }, { passive: false });

    stage.addEventListener('dblclick', function (e) {
      var r = stage.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, scale > fit * 1.02 ? fit : 1);
    });

    // Pointer drag + two-finger pinch, one code path.
    var pts = new Map();
    var last = null, pinch = null;

    stage.addEventListener('pointerdown', function (e) {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { last = { x: e.clientX, y: e.clientY }; stage.classList.add('dragging'); }
      else if (pts.size === 2) { pinch = pinchState(); }
    });

    stage.addEventListener('pointermove', function (e) {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pts.size === 1 && last) {
        tx += e.clientX - last.x;
        ty += e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        apply();
      } else if (pts.size === 2 && pinch) {
        var now = pinchState();
        var r = stage.getBoundingClientRect();
        zoomAt(now.cx - r.left, now.cy - r.top, scale * (now.d / pinch.d));
        pinch = now;
      }
    });

    function pinchState() {
      var a = Array.from(pts.values());
      var dx = a[0].x - a[1].x, dy = a[0].y - a[1].y;
      return { d: Math.hypot(dx, dy) || 1, cx: (a[0].x + a[1].x) / 2, cy: (a[0].y + a[1].y) / 2 };
    }

    function release(e) {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) { last = null; stage.classList.remove('dragging'); }
      else last = Array.from(pts.values())[0];
    }
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);

    window.addEventListener('resize', function () { if (overlay.classList.contains('open') && loaded) reset(); });
  }

  function open() {
    if (!overlay) build();
    if (!img.src) img.src = fullSrc;      // fetched only on first open
    overlay.classList.add('open');
    document.documentElement.style.overflow = 'hidden';
    overlay.focus({ preventScroll: true });
    if (loaded) reset();
  }

  function close() {
    overlay.classList.remove('open');
    document.documentElement.style.overflow = '';
    trigger.focus();
  }

  trigger.addEventListener('click', open);
  trigger.setAttribute('tabindex', '0');
  trigger.setAttribute('role', 'button');
  trigger.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  document.addEventListener('keydown', function (e) {
    if (!overlay || !overlay.classList.contains('open')) return;
    var v = viewport(), step = 80;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(v.w / 2, v.h / 2, scale * 1.25); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(v.w / 2, v.h / 2, scale / 1.25); }
    else if (e.key === '0') { e.preventDefault(); reset(); }
    else if (e.key === '1') { e.preventDefault(); zoomAt(v.w / 2, v.h / 2, 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); tx += step; apply(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); tx -= step; apply(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); ty += step; apply(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); ty -= step; apply(); }
  });
  /* ------------------------- newsletter signup ----------------------- */
  /* The form submits on its own without this; here it posts in the
     background so the reply appears in place instead of sending the
     visitor to Kit's confirmation page. */
  var signup = document.querySelector('.signup');
  if (signup && window.fetch && window.FormData) {
    signup.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = signup.querySelector('.signup-msg');
      var button = signup.querySelector('button');
      button.disabled = true;
      fetch(signup.action, {
        method: 'POST',
        body: new FormData(signup),
        headers: { Accept: 'application/json' },
      })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function () {
          signup.querySelector('input').value = '';
          msg.textContent = msg.getAttribute('data-ok');
          msg.hidden = false;
        })
        .catch(function () {
          msg.textContent = msg.getAttribute('data-err');
          msg.hidden = false;
        })
        .then(function () { button.disabled = false; });
    });
  }
})();
