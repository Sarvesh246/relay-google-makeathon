/* Relay poster renderer.
 *
 * Every marketing post is drawn by THIS file on a 1080x1350 canvas (4:5), so the
 * layout, fonts, colors and motifs are identical on every post. The AI only
 * supplies words (validated server-side in lib/brand.mjs) and, optionally, a
 * flat abstract background that passed an automated inspection. A real photo can
 * be dropped into the photo slot by an officer; nothing photographic is ever
 * generated.
 *
 * Works in the browser (window.RelayPoster) and in Node tests (module.exports).
 */
(function (root) {
  'use strict';

  var W = 1080, H = 1350, M = 80;
  var BRAND = {
    ink: '#16161D', cream: '#F2EFE7', muted: '#A3A1AD',
    accents: { vermilion: '#FF5A1F', periwinkle: '#8293E7' },
    fonts: { display: "'Bricolage Grotesque', 'Arial Black', sans-serif", mono: "'Geist Mono', ui-monospace, monospace", body: "'Instrument Sans', system-ui, sans-serif" },
  };
  var MOTIFS = ['tracks', 'gears', 'circuit', 'grid', 'bolts', 'arrows'];

  // ---- helpers ---------------------------------------------------------------
  function seedFrom(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var a = seed; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function spacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }
  function rgba(hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }

  function wrap(ctx, text, maxW) {
    var words = String(text).split(/\s+/).filter(Boolean), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  // ---- motifs (the built-in, always-available graphic) -------------------------
  var motifDraw = {
    tracks: function (c, col, r) {
      var lanes = 9, gap = 62, x0 = 330, y0 = 60;
      c.lineWidth = 3; c.strokeStyle = rgba(col, 0.28);
      for (var i = 0; i < lanes; i++) { var y = y0 + i * gap; c.beginPath(); c.moveTo(x0 + i * 18, y); c.lineTo(W, y); c.stroke(); }
      for (var j = 0; j < 3; j++) {
        var by = y0 + (1 + j * 3) * gap, bx = 560 + r() * 300;
        c.save(); c.translate(bx, by); c.transform(1, 0, -0.34, 1, 0, 0); c.fillStyle = j === 0 ? col : rgba(col, 0.5); rr(c, -60, -14, 120, 28, 7); c.fill(); c.restore();
      }
    },
    gears: function (c, col) {
      function gear(cx, cy, rad, teeth, a) {
        c.beginPath();
        for (var i = 0; i < teeth * 2; i++) { var ang = (i / (teeth * 2)) * Math.PI * 2 + a, rr_ = i % 2 ? rad * 0.86 : rad; c.lineTo(cx + Math.cos(ang) * rr_, cy + Math.sin(ang) * rr_); }
        c.closePath(); c.stroke(); c.beginPath(); c.arc(cx, cy, rad * 0.32, 0, Math.PI * 2); c.stroke();
      }
      c.lineWidth = 6; c.strokeStyle = rgba(col, 0.55); gear(820, 280, 200, 14, 0.2); c.strokeStyle = rgba(col, 0.38); gear(560, 130, 110, 10, 0.5); gear(985, 560, 130, 11, 0.1);
    },
    circuit: function (c, col, r) {
      c.lineWidth = 5; c.strokeStyle = rgba(col, 0.5); c.fillStyle = col; var step = 70;
      for (var i = 0; i < 9; i++) {
        var x = 420 + Math.floor(r() * 9) * step, y = 40 + Math.floor(r() * 9) * step; c.beginPath(); c.moveTo(x, y);
        for (var k = 0; k < 3; k++) { if (r() > 0.5) x += (r() > 0.4 ? 1 : -1) * step * (1 + Math.floor(r() * 2)); else y += step * (1 + Math.floor(r() * 2)); x = Math.max(380, Math.min(W - 20, x)); c.lineTo(x, y); }
        c.stroke(); c.beginPath(); c.arc(x, y, 11, 0, Math.PI * 2); c.fill();
      }
    },
    grid: function (c, col, r) {
      for (var y = 50; y < 720; y += 40) for (var x = 400; x < W - 20; x += 40) { c.fillStyle = rgba(col, 0.3); c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = col; for (var i = 0; i < 6; i++) { rr(c, 400 + Math.floor(r() * 16) * 40 - 14, 50 + Math.floor(r() * 16) * 40 - 14, 28, 28, 6); c.fill(); }
    },
    bolts: function (c, col, r) {
      c.lineWidth = 6; c.strokeStyle = rgba(col, 0.5);
      [[840, 250, 150], [560, 120, 80], [990, 600, 100], [640, 470, 70]].forEach(function (p, i) {
        c.beginPath(); for (var k = 0; k < 6; k++) { var a = Math.PI / 3 * k + 0.3 * i; c.lineTo(p[0] + Math.cos(a) * p[2], p[1] + Math.sin(a) * p[2]); } c.closePath(); c.stroke();
        c.beginPath(); c.arc(p[0], p[1], p[2] * 0.4, 0, Math.PI * 2); c.stroke();
      });
    },
    arrows: function (c, col) {
      c.lineWidth = 26; c.lineCap = 'round'; c.lineJoin = 'round';
      for (var row = 0; row < 4; row++) for (var i = 0; i < 6; i++) { c.strokeStyle = rgba(col, 0.14 + i * 0.1); var x = 380 + i * 110 + row * 36, y = 110 + row * 150; c.beginPath(); c.moveTo(x, y - 46); c.lineTo(x + 46, y); c.lineTo(x, y + 46); c.stroke(); }
      c.lineCap = 'butt';
    },
  };

  function drawCover(c, img, x, y, w, h) {
    var s = Math.max(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s;
    c.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  // ---- the renderer --------------------------------------------------------------
  function render(canvas, spec, opts) {
    opts = opts || {};
    canvas.width = W; canvas.height = H;
    var c = canvas.getContext('2d'), F = BRAND.fonts;
    var col = BRAND.accents[spec.accent] || BRAND.accents.vermilion;
    var r = rng(seedFrom(spec.headline || 'relay'));

    // background + brand track lanes
    c.fillStyle = BRAND.ink; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,.045)'; for (var y = 33; y < H; y += 34) c.fillRect(0, y, W, 1);

    // visual layer: real photo > verified AI artwork > built-in motif
    var hasPhoto = !!opts.photo;
    if (hasPhoto) {
      c.save(); rr(c, M, 170, W - M * 2, 540, 28); c.clip(); drawCover(c, opts.photo, M, 170, W - M * 2, 540); c.restore();
      c.lineWidth = 3; c.strokeStyle = 'rgba(242,239,231,.22)'; rr(c, M, 170, W - M * 2, 540, 28); c.stroke();
    } else if (opts.art) {
      c.save(); c.globalAlpha = 0.95; drawCover(c, opts.art, 0, 0, W, 800); c.restore();
      var g = c.createLinearGradient(0, 380, 0, 860); g.addColorStop(0, 'rgba(22,22,29,0)'); g.addColorStop(1, BRAND.ink); c.fillStyle = g; c.fillRect(0, 380, W, 480);
      var g2 = c.createLinearGradient(0, 0, W * 0.7, 0); g2.addColorStop(0, 'rgba(22,22,29,.55)'); g2.addColorStop(1, 'rgba(22,22,29,0)'); c.fillStyle = g2; c.fillRect(0, 0, W, 800);
    } else {
      c.save(); (motifDraw[spec.motif] || motifDraw.tracks)(c, col, r); c.restore();
    }

    // exchange-zone stripes (brand motif)
    c.save(); c.beginPath(); c.rect(W - 230, 0, 230, H); c.clip(); c.strokeStyle = rgba(col, 0.1); c.lineWidth = 2;
    for (var sx = -H; sx < 260; sx += 14) { c.beginPath(); c.moveTo(W - 230 + sx, H); c.lineTo(W - 230 + sx + H * 0.47, 0); c.stroke(); } c.restore();

    // wordmark
    c.fillStyle = col; rr(c, M, 84, 62, 62, 16); c.fill(); c.fillStyle = BRAND.ink;
    c.save(); c.translate(M + 31, 115); c.transform(1, 0, -0.32, 1, 0, 0); rr(c, -13, -17, 9, 34, 3); c.fill(); c.globalAlpha = 0.5; rr(c, 4, -17, 9, 34, 3); c.fill(); c.restore();
    c.fillStyle = BRAND.cream; c.font = '600 28px ' + F.mono; spacing(c, 3); c.textBaseline = 'middle'; c.fillText('AGGIE ROBOTICS', M + 82, 116);

    // ---- text stack, laid out bottom-up so every post ends on the same baseline ----
    var maxW = W - M * 2 - (hasPhoto ? 0 : 120), bottom = H - 150, blocks = [], total = 0, gap = 30;
    var eyebrow = spec.template === 'event' ? [spec.date, spec.time].filter(Boolean).join('  ·  ') : '';
    var placeLine = spec.template === 'event' ? spec.place : '';
    var floor = hasPhoto ? 760 : 520; // photo posts reserve the top for the photo
    var maxHeadH = Math.max(240, bottom - floor - (eyebrow ? 90 : 0) - (placeLine ? 70 : 0) - (spec.subhead ? 120 : 0) - (spec.cta ? 120 : 0));

    var size, lines, lh;
    for (size = spec.template === 'event' ? 168 : 196; size >= 84; size -= 6) {
      c.font = '800 ' + size + 'px ' + F.display; spacing(c, -0.035 * size); lines = wrap(c, spec.headline, maxW); lh = size * 0.94;
      if (lines.length <= 3 && lines.length * lh <= maxHeadH && lines.every(function (l) { return c.measureText(l).width <= maxW; })) break;
    }
    var headH = lines.length * lh;
    if (eyebrow) blocks.push({ h: 52, draw: function (y) { c.font = '500 46px ' + F.mono; spacing(c, 2); c.fillStyle = col; c.fillText(eyebrow, M, y + 26); } });
    blocks.push({ h: headH, draw: function (y) { c.font = '800 ' + size + 'px ' + F.display; spacing(c, -0.035 * size); c.fillStyle = BRAND.cream; c.textBaseline = 'alphabetic'; lines.forEach(function (l, i) { c.fillText(l, M, y + lh * (i + 0.84)); }); c.textBaseline = 'middle'; } });
    if (placeLine) blocks.push({ h: 44, draw: function (y) { c.font = '500 38px ' + F.mono; spacing(c, 2); c.fillStyle = BRAND.cream; c.fillText(placeLine, M, y + 22); } });
    if (spec.subhead) {
      c.font = '500 44px ' + F.body; spacing(c, 0); var sl = wrap(c, spec.subhead, maxW).slice(0, 2);
      blocks.push({ h: sl.length * 58, draw: function (y) { c.font = '500 44px ' + F.body; spacing(c, 0); c.fillStyle = BRAND.muted; sl.forEach(function (l, i) { c.fillText(l, M, y + 29 + i * 58); }); } });
    }
    if (spec.cta) {
      c.font = '700 34px ' + F.mono; spacing(c, 3); var cw = c.measureText(spec.cta).width + 64;
      blocks.push({ h: 76, draw: function (y) { c.fillStyle = col; rr(c, M, y, cw, 76, 38); c.fill(); c.fillStyle = BRAND.ink; c.font = '700 34px ' + F.mono; spacing(c, 3); c.fillText(spec.cta, M + 32, y + 39); } });
    }
    blocks.forEach(function (b) { total += b.h; }); total += gap * (blocks.length - 1);
    var yy = bottom - total; blocks.forEach(function (b) { b.draw(yy); yy += b.h + gap; });

    // footer
    c.fillStyle = 'rgba(242,239,231,.16)'; c.fillRect(M, H - 118, W - M * 2, 2);
    c.fillStyle = BRAND.muted; c.font = '500 28px ' + F.mono; spacing(c, 2); c.textBaseline = 'middle'; c.fillText(spec.hashtags && spec.hashtags[0] || '#AggieRobotics', M, H - 74);
    spacing(c, 0);
    return canvas;
  }

  // ---- async helpers -----------------------------------------------------------------
  function ready() {
    if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
    return Promise.all(["800 100px 'Bricolage Grotesque'", "500 30px 'Geist Mono'", "700 30px 'Geist Mono'", "600 30px 'Geist Mono'", "500 40px 'Instrument Sans'"].map(function (f) { return document.fonts.load(f).catch(function () {}); }));
  }
  function loadImage(src) {
    return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('image failed to load')); }; i.src = src; });
  }
  /** Compose a finished poster and return { full, thumb } PNG/JPEG data URLs. */
  function compose(spec, opts) {
    opts = opts || {};
    return ready().then(function () {
      return Promise.all([opts.artSrc ? loadImage(opts.artSrc) : null, opts.photoSrc ? loadImage(opts.photoSrc) : null]);
    }).then(function (imgs) {
      var cv = document.createElement('canvas'); render(cv, spec, { art: imgs[0], photo: imgs[1] });
      var th = document.createElement('canvas'); th.width = 320; th.height = 400; th.getContext('2d').drawImage(cv, 0, 0, 320, 400);
      return { full: cv.toDataURL('image/png'), thumb: th.toDataURL('image/jpeg', 0.82) };
    });
  }

  // ---- offline fallback (no API key): conservative, only uses what was typed ----------
  var DATE = /\b(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/i;
  var TIME = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i;
  var PLACE = /\b(?:at|in)\s+(?:the\s+)?((?:[A-Z][\w'’-]*|\d+)(?:\s+(?:[A-Z][\w'’-]*|\d+)){0,3})/;
  var CTA = /free pizza|free food|free tacos|all welcome|no experience needed|bring your bot/i;
  var MOTIF_KEYS = [[/solder|circuit|wire|electronic/i, 'circuit'], [/gear|build|machine|mechan/i, 'gears'], [/code|hack|program|data/i, 'grid'], [/bolt|workshop|tool/i, 'bolts'], [/race|rumble|compet|scrim|match/i, 'tracks']];
  function fallbackSpec(prompt, tone) {
    var p = String(prompt || '').replace(/\s+/g, ' ').trim();
    var date = (DATE.exec(p) || [''])[0].replace(/,/g, '').toUpperCase();
    var time = (TIME.exec(p) || [''])[0].replace(/\s/g, '').toUpperCase();
    var place = (PLACE.exec(p) || ['', ''])[1].toUpperCase();
    var cta = (CTA.exec(p) || [''])[0].toUpperCase();
    // Headline = the opening phrase with the date, time and place taken out (they get their own lines).
    var bare = p.replace(DATE, ' ').replace(TIME, ' ').replace(/\s+/g, ' ').trim();
    var lead = bare.split(/[,.;!]/)[0].split(/\s+(?:at|in|on|from)\s/i)[0].trim().split(/\s+/).filter(Boolean).slice(0, 4).join(' ').toUpperCase();
    var first = (p.match(/[^.!?]+[.!?]?/) || [p])[0].trim();
    var caption = tone === 'Short' ? first : tone === 'Info' ? p : p;
    var motif = 'tracks'; MOTIF_KEYS.some(function (m) { if (m[0].test(p)) { motif = m[1]; return true; } });
    return { template: date || time ? 'event' : 'announce', headline: lead || 'NEW POST', subhead: '', date: date, time: time, place: place, cta: cta, caption: caption.slice(0, 240), hashtags: ['#AggieRobotics'], motif: motif, accent: 'vermilion' };
  }

  var api = { W: W, H: H, BRAND: BRAND, MOTIFS: MOTIFS, render: render, ready: ready, compose: compose, loadImage: loadImage, fallbackSpec: fallbackSpec };
  root.RelayPoster = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
