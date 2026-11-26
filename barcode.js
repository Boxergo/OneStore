/* =====================================================
   Pembaca barcode offline (tanpa library luar)
   Format: EAN-13, UPC-A, EAN-8, Code 128
   Dipakai untuk scan dari gambar/foto & kamera di browser
   yang belum punya BarcodeDetector (mis. Chrome/Edge Windows).
   ===================================================== */
(function (root) {
  'use strict';
  const EAN_L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'].map(s => s.split('').map(Number));
  const EAN_LG = EAN_L.concat(EAN_L.map(p => p.slice().reverse())); // 0-9 = L, 10-19 = G
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
    '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 ' +
    '111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
    '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 ' +
    '141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 ' +
    '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 ' +
    '311141 411131 211412 211214 211232').split(' ').map(s => s.split('').map(Number));
  const C128_STOP = [2, 3, 3, 1, 1, 1, 2];

  // jarak pola: lebar run dinormalisasi ke jumlah modul
  function dist(runs, i, n, pat, total) {
    let s = 0; for (let k = 0; k < n; k++) s += runs[i + k];
    const u = s / total; let d = 0;
    for (let k = 0; k < n; k++) d += Math.abs(runs[i + k] / u - pat[k]);
    return d;
  }
  function best(runs, i, n, pats, total, maxD) {
    let b = -1, bd = maxD;
    for (let p = 0; p < pats.length; p++) { const d = dist(runs, i, n, pats[p], total); if (d < bd) { bd = d; b = p; } }
    return b;
  }
  function eanOk(d) {
    let s = 0; const n = d.length;
    for (let i = 0; i < n - 1; i++) s += d[i] * ((n - 1 - i) % 2 ? 3 : 1);
    return (10 - s % 10) % 10 === d[n - 1];
  }
  function guards(runs, i, idx, m) { for (const k of idx) { const r = runs[i + k]; if (r > m * 2.4 || r < m * 0.25) return false; } return true; }
  function quiet(runs, i, len, m, q) {
    if (i === 0 || runs[i - 1] < m * q) return false;
    if (i + len < runs.length && runs[i + len] < m * q) return false;
    return true;
  }

  function ean13(runs, i) {
    if (i + 59 > runs.length) return null;
    let tot = 0; for (let k = 0; k < 59; k++) tot += runs[i + k];
    const m = tot / 95;
    if (!guards(runs, i, [0, 1, 2, 27, 28, 29, 30, 31, 56, 57, 58], m) || !quiet(runs, i, 59, m, 2.5)) return null;
    const d = []; let par = '';
    for (let k = 0; k < 6; k++) { const b = best(runs, i + 3 + k * 4, 4, EAN_LG, 7, 1.9); if (b < 0) return null; d.push(b % 10); par += b < 10 ? 'L' : 'G'; }
    for (let k = 0; k < 6; k++) { const b = best(runs, i + 32 + k * 4, 4, EAN_L, 7, 1.9); if (b < 0) return null; d.push(b); }
    const first = PARITY.indexOf(par); if (first < 0) return null;
    d.unshift(first);
    return eanOk(d) ? { text: d.join(''), format: first === 0 ? 'upc_a/ean_13' : 'ean_13' } : null;
  }
  function ean8(runs, i) {
    if (i + 43 > runs.length) return null;
    let tot = 0; for (let k = 0; k < 43; k++) tot += runs[i + k];
    const m = tot / 67;
    if (!guards(runs, i, [0, 1, 2, 19, 20, 21, 22, 23, 40, 41, 42], m) || !quiet(runs, i, 43, m, 2.5)) return null;
    const d = [];
    for (let k = 0; k < 4; k++) { const b = best(runs, i + 3 + k * 4, 4, EAN_L, 7, 1.9); if (b < 0) return null; d.push(b); }
    for (let k = 0; k < 4; k++) { const b = best(runs, i + 24 + k * 4, 4, EAN_L, 7, 1.9); if (b < 0) return null; d.push(b); }
    return eanOk(d) ? { text: d.join(''), format: 'ean_8' } : null;
  }
  function c128(runs, i) {
    if (i + 6 + 6 + 7 > runs.length) return null;
    const st = best(runs, i, 6, C128, 11, 2.2);
    if (st < 103) return null;
    let tot = 0; for (let k = 0; k < 6; k++) tot += runs[i + k];
    const m = tot / 11;
    if (i === 0 || runs[i - 1] < m * 4) return null;
    const vals = []; let j = i + 6;
    while (j + 7 <= runs.length && vals.length < 80) {
      if (vals.length >= 2 && dist(runs, j, 7, C128_STOP, 13) < 2.4) {
        const data = vals.slice(0, -1), chk = vals[vals.length - 1]; let s = st;
        data.forEach((v, k) => s += v * (k + 1));
        if (s % 103 === chk) { const text = c128text(st, data); if (text) return { text, format: 'code_128' }; }
        // bukan stop sebenarnya → lanjut baca sebagai data
      }
      const v = best(runs, j, 6, C128.slice(0, 106), 11, 2.2); if (v < 0) return null;
      vals.push(v); j += 6;
    }
    return null;
  }
  function c128text(start, vals) {
    let set = start === 103 ? 'A' : start === 104 ? 'B' : 'C', out = '', shift = false;
    for (const v of vals) {
      const cur = shift ? (set === 'A' ? 'B' : 'A') : set; shift = false;
      if (cur === 'C' && v < 100) { out += (v < 10 ? '0' : '') + v; continue; }
      if (cur !== 'C' && v < 96) { out += String.fromCharCode(cur === 'B' ? v + 32 : (v < 64 ? v + 32 : v - 64)); continue; }
      if (v === 98 && cur !== 'C') { shift = true; continue; }
      if (v === 99) set = 'C';
      else if (v === 100 && cur !== 'B') set = 'B';
      else if (v === 101 && cur !== 'A') set = 'A';
    }
    return out;
  }

  function scanRuns(runs, firstBar) {
    for (let i = 0; i < runs.length; i++) {
      if ((i % 2 === 0) !== firstBar) continue;
      const r = ean13(runs, i) || ean8(runs, i) || c128(runs, i);
      if (r) return r;
    }
    return null;
  }
  function toRuns(bin) {
    const runs = []; let c = bin[0], n = 0;
    for (let x = 0; x < bin.length; x++) { if (bin[x] === c) n++; else { runs.push(n); c = bin[x]; n = 1; } }
    runs.push(n);
    return { runs, firstBar: bin[0] === 1 };
  }
  // 2 cara ambang: global (tengah min-max) & lokal (rata-rata sekitar), agar tahan cahaya tidak rata
  function binarize(line, mode) {
    const n = line.length, out = new Uint8Array(n);
    let mn = 255, mx = 0; for (let x = 0; x < n; x++) { if (line[x] < mn) mn = line[x]; if (line[x] > mx) mx = line[x]; }
    if (mx - mn < 40) return null;
    if (mode === 0) { const t = (mn + mx) / 2; for (let x = 0; x < n; x++) out[x] = line[x] < t ? 1 : 0; return out; }
    const win = Math.max(8, Math.round(n / 14)), pre = new Float64Array(n + 1), k = (mx - mn) * 0.07;
    for (let x = 0; x < n; x++) pre[x + 1] = pre[x] + line[x];
    for (let x = 0; x < n; x++) { const a = Math.max(0, x - win), b = Math.min(n, x + win + 1); out[x] = line[x] < (pre[b] - pre[a]) / (b - a) - k ? 1 : 0; }
    return out;
  }
  // Cara ke-3: posisi tepi dari gradien (sub-piksel), paling tahan gambar buram
  function edgeRuns(line) {
    const n = line.length, d = new Float32Array(n);
    let mn = 255, mx = 0; for (let x = 0; x < n; x++) { if (line[x] < mn) mn = line[x]; if (line[x] > mx) mx = line[x]; }
    if (mx - mn < 40) return null;
    for (let x = 1; x < n - 1; x++) d[x] = line[x + 1] - line[x - 1];
    const thr = (mx - mn) * 0.035, e = [];
    for (let x = 2; x < n - 2; x++) {
      const v = d[x], av = Math.abs(v);
      if (av < thr || av < Math.abs(d[x - 1]) || av <= Math.abs(d[x + 1])) continue;
      const den = d[x - 1] - 2 * v + d[x + 1], pos = x + (den ? (d[x - 1] - d[x + 1]) / (2 * den) : 0);
      const last = e[e.length - 1];
      if (last && (last.v < 0) === (v < 0)) { if (av > Math.abs(last.v)) { last.p = pos; last.v = v; } continue; }
      e.push({ p: pos, v });
    }
    if (e.length < 20) return null;
    const runs = [e[0].p]; for (let k = 1; k < e.length; k++) runs.push(e[k].p - e[k - 1].p); runs.push(n - e[e.length - 1].p);
    return { runs, firstBar: e[0].v > 0 }; // tepi pertama naik = diawali area gelap
  }
  function decodeLine(line, tally) {
    for (const mode of [0, 1, 2]) {
      let rr;
      if (mode === 2) rr = edgeRuns(line);
      else { const bin = binarize(line, mode); if (!bin) return; rr = toRuns(bin); }
      if (!rr || rr.runs.length < 25) continue;
      const { runs, firstBar } = rr;
      let r = scanRuns(runs, firstBar);
      if (!r) { const rv = runs.slice().reverse(); r = scanRuns(rv, (runs.length - 1) % 2 === 0 ? firstBar : !firstBar); }
      if (r) { const key = r.text; tally[key] = tally[key] || Object.assign({ hits: 0 }, r); tally[key].hits++; return; }
    }
  }
  function sampleLine(g, w, h, cx, cy, dx, dy) {
    const L = Math.abs(w * dx) + Math.abs(h * dy), out = [], px = -dy, py = dx;
    const at = (x, y) => { const x0 = x | 0, y0 = y | 0; if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) return -1;
      const fx = x - x0, fy = y - y0, i = y0 * w + x0; return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy; };
    for (let t = -L / 2; t <= L / 2; t++) {
      const x = cx + dx * t, y = cy + dy * t, a = at(x - px, y - py), b = at(x, y), c = at(x + px, y + py);
      if (a < 0 || b < 0 || c < 0) { if (out.length) break; continue; }
      out.push((a + 2 * b + c) / 4);
    }
    return out;
  }
  /** gray: Uint8Array w*h. Kembali {text, format} atau null */
  function decodeGray(gray, w, h, opt) {
    opt = opt || {};
    const lines = opt.lines || 24, need = opt.need || 2, tally = {};
    const angles = opt.angles || [0, 90, -8, 8, -16, 16, 82, 98, 74, 106];
    const done = () => Object.values(tally).find(r => r.hits >= need);
    const order = []; for (let k = 0; k < lines; k++) { const o = Math.ceil(k / 2) * (k % 2 ? 1 : -1); order.push(o / (lines + 1)); }
    for (const deg of angles) {
      const rad = deg * Math.PI / 180, dx = Math.cos(rad), dy = Math.sin(rad), px = -dy, py = dx;
      const span = Math.abs(w * px) + Math.abs(h * py);
      for (const f of order) {
        const line = sampleLine(gray, w, h, w / 2 + px * f * span, h / 2 + py * f * span, dx, dy);
        if (line.length < 60) continue;
        decodeLine(line, tally); const r = done(); if (r) return r;
      }
      if (Object.keys(tally).length && deg !== 0) break; // sudah ketemu (1 kali) — cukup
    }
    if (opt.strict) return null; // mode kamera: wajib terbaca >= need kali agar tidak salah baca
    const all = Object.values(tally).sort((a, b) => b.hits - a.hits);
    return all[0] || null;
  }

  // ---------- helper browser ----------
  function grayOf(src, sw, sh, maxW) {
    const sc = Math.min(1, maxW / sw), w = Math.round(sw * sc), h = Math.round(sh * sc);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(src, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return { g, w, h };
  }
  /** Decode dari elemen gambar/video/canvas */
  function decodeSource(src, sw, sh, opt = {}) {
    const seen = {};
    for (const maxW of opt.sizes || [1600, 900]) {
      const ew = Math.round(Math.min(sw, maxW)); if (seen[ew]) continue; seen[ew] = 1;
      const { g, w, h } = grayOf(src, sw, sh, maxW);
      const r = decodeGray(g, w, h, opt); if (r) return r;
    }
    return null;
  }
  /** Decode dari File/Blob gambar (foto kamera, screenshot, dll.) */
  function decodeFile(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { try { res(decodeSource(img, img.naturalWidth, img.naturalHeight, { lines: 40, need: 1 })); } catch (e) { rej(e); } finally { URL.revokeObjectURL(url); } };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('File bukan gambar yang valid')); };
      img.src = url;
    });
  }
  root.BarcodeReader = { decodeGray, decodeSource, decodeFile, _C128: C128 };
  if (typeof module !== 'undefined') module.exports = root.BarcodeReader;
})(typeof window !== 'undefined' ? window : globalThis);
