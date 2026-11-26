/* =====================================================
   SatuToko POS — aplikasi kasir (PWA, bisa offline)
   ===================================================== */
'use strict';

// ---------- util ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = n => 'Rp ' + Math.round(+n || 0).toLocaleString('id-ID');
const nf = n => (+n || 0).toLocaleString('id-ID', { maximumFractionDigits: 3 });
const short = n => { n = +n || 0; const a = Math.abs(n); return a >= 1e9 ? (n / 1e9).toFixed(1).replace('.0', '') + ' M' : a >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' jt' : a >= 1e3 ? Math.round(n / 1e3) + ' rb' : String(Math.round(n)); };
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = d => `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('stk_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('stk_' + k, JSON.stringify(v)); } catch (e) { } },
  del(k) { try { localStorage.removeItem('stk_' + k); } catch (e) { } }
};
const ROLE = { kasir: 1, supervisor: 2, admin: 3, owner: 4 };
const can = r => S.user && ROLE[S.user.role] >= ROLE[r];
const ICON = {
  kasir: '<path d="M3 4h18v4H3zM5 8v12h14V8M9 12h6M9 16h6"/>',
  stok: '<path d="M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10"/>',
  promo: '<path d="M20 12l-8 8-9-9V3h8zM7 7h.01"/>',
  member: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  laporan: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  cam: '<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/>',
};
const svg = (k, w = 22) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

// ---------- state ----------
const S = {
  user: null, stores: [], allStores: [], cfg: {}, storeId: 0,
  products: [], pmap: {}, promos: [], members: [], shift: null,
  cart: [], member: null, manualPct: 0, authPin: null,
  online: navigator.onLine, view: 'kasir', sub: null, tab: {}, report: null,
};

// ---------- API ----------
async function api(a, body, qs = '') {
  let r;
  try {
    r = await fetch(`api.php?a=${a}&store=${S.storeId || ''}${qs}`, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-POS': '1' },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) { setOnline(false); const er = new Error('Tidak ada koneksi ke server'); er.offline = true; throw er; }
  setOnline(true);
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) { }
  if (!j) {
    const plain = txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const er = new Error(txt.trim().startsWith('<?php') || r.status === 404 || r.status === 405
      ? 'PHP tidak berjalan di server ini. Jalankan lewat XAMPP (Apache) atau start-local.bat, jangan Live Server.'
      : 'Server error ' + r.status + (plain ? ': ' + plain.slice(0, 220) : '') + ' — buka cek.php untuk diagnosa.');
    er.noPhp = true; throw er;
  }
  if (!r.ok || !j || j.error) {
    const er = new Error((j && j.error) || 'Server error ' + r.status); er.status = r.status;
    if (r.status === 401 && a !== 'login') showLogin();
    throw er;
  }
  return j;
}
function setOnline(v) {
  if (S.online === v && $('#netPill').dataset.init) return;
  S.online = v; const p = $('#netPill'); p.dataset.init = 1;
  p.textContent = v ? 'Online' : 'Offline'; p.classList.toggle('off', !v);
  if (v) setTimeout(sync, 300);
}
window.addEventListener('online', () => api('me').then(() => sync()).catch(() => { }));
window.addEventListener('offline', () => setOnline(false));

// ---------- UI helpers ----------
let toastT;
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), bad ? 4000 : 2200);
}
let modalClose = null;
function modal(title, html, onClose) {
  $('#mTitle').textContent = title; $('#mBody').innerHTML = html;
  $('#modal').classList.remove('hidden'); modalClose = onClose || null;
  const f = $('#mBody input:not([type=hidden]):not([readonly])'); if (f && !('ontouchstart' in window)) setTimeout(() => f.focus(), 50);
  return $('#mBody');
}
function closeModal() { $('#modal').classList.add('hidden'); $('#mBody').innerHTML = ''; const c = modalClose; modalClose = null; c && c(); }
$('#modal .x').onclick = closeModal;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
const val = (sel, root = document) => { const el = $(sel, root); return el ? (el.type === 'checkbox' ? el.checked : el.value.trim()) : ''; };
function formData(root) { const o = {}; $$('[name]', root).forEach(el => o[el.name] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value.trim()); return o; }
async function run(btn, fn) { if (btn) btn.disabled = true; try { await fn(); } catch (e) { toast(e.message, true); } finally { if (btn) btn.disabled = false; } }

// =====================================================
//  BOOT & LOGIN
// =====================================================
function showLogin() { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; $('#loginErr').classList.add('hidden');
  try { await api('login', { username: f.username.value, password: f.password.value }); f.password.value = ''; await boot(); }
  catch (er) { $('#loginErr').textContent = er.message; $('#loginErr').classList.remove('hidden'); }
});

async function boot() {
  if (location.protocol === 'file:') {
    showLogin(); $('#loginForm button').disabled = true;
    $('#loginErr').innerHTML = '<b>Aplikasi dibuka sebagai file, jadi PHP tidak berjalan.</b><br>Klik 2x <b>start-local.bat</b> di folder aplikasi (atau di VS Code tekan <b>Ctrl+Shift+B</b>), lalu buka <b>http://localhost:8000</b>.';
    $('#loginErr').classList.remove('hidden'); return;
  }
  let me;
  try { me = await api('me'); LS.set('me', me); }
  catch (e) {
    if (e.offline && LS.get('me')) { me = LS.get('me'); toast('Mode offline — memakai data tersimpan'); }
    else if (e.noPhp) { showLogin(); $('#loginErr').textContent = e.message; $('#loginErr').classList.remove('hidden'); return; }
    else if (e.offline) { showLogin(); $('#loginErr').textContent = 'Tidak ada koneksi. Login pertama kali butuh internet.'; $('#loginErr').classList.remove('hidden'); return; }
    else return showLogin();
  }
  S.user = me.user; S.stores = me.stores; S.allStores = me.all_stores; S.cfg = me.cfg;
  const saved = LS.get('store_' + S.user.id);
  S.storeId = S.user.role === 'owner' ? (S.stores.find(s => s.id == saved) ? +saved : +S.stores[0]?.id) : +S.user.store_id;
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  const sel = $('#storeSel');
  if (S.user.role === 'owner' && S.stores.length > 1) {
    sel.innerHTML = S.stores.map(s => `<option value="${s.id}" ${s.id == S.storeId ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    sel.classList.remove('hidden');
    sel.onchange = async () => { S.storeId = +sel.value; LS.set('store_' + S.user.id, S.storeId); S.cart = []; S.member = null; await loadData(); render(); };
  } else sel.classList.add('hidden');
  updateTitle();
  await loadData();
  buildNav(); render(); updateQueuePill(); sync();
}
function updateTitle() { const st = S.stores.find(s => s.id == S.storeId); $('#appTitle').textContent = (S.cfg.app || 'SatuToko') + (st ? ' · ' + st.name : ''); }

async function loadData() {
  updateTitle();
  const key = 'boot_' + S.storeId;
  let b;
  try { b = await api('bootstrap'); LS.set(key, b); }
  catch (e) { b = LS.get(key); if (!b) { toast('Data produk belum tersimpan untuk offline', true); b = { products: [], promos: [], members: [], shift: null }; } }
  S.products = b.products.map(p => ({ ...p, price: +p.price, cost: +p.cost, stock: +p.stock, min_stock: +p.min_stock, units: (p.units || []).map(u => ({ ...u, factor: +u.factor, price: +u.price })) }));
  S.pmap = Object.fromEntries(S.products.map(p => [p.id, p]));
  S.promos = b.promos; S.members = b.members; S.shift = b.shift;
  S.cart = LS.get('cart_' + S.storeId, []).filter(i => S.pmap[i.pid]);
}
function saveLocalBoot() {
  const key = 'boot_' + S.storeId, b = LS.get(key); if (!b) return;
  b.products = S.products; b.shift = S.shift; b.members = S.members; LS.set(key, b);
}
setInterval(() => { if (S.online && S.user && S.view !== 'kasir') loadData().catch(() => { }); }, 5 * 60 * 1000);

// =====================================================
//  OFFLINE QUEUE & SYNC
// =====================================================
let syncing = false;
function updateQueuePill() {
  const n = LS.get('queue', []).length, f = LS.get('failed', []).length, p = $('#queuePill');
  p.textContent = (n ? `⟳ ${n} antre` : '') + (f ? ` ⚠ ${f} gagal` : '');
  p.classList.toggle('hidden', !n && !f);
}
async function sync() {
  if (syncing || !S.user) return; const q = LS.get('queue', []); if (!q.length) return;
  syncing = true; let done = 0;
  try {
    while (true) {
      const queue = LS.get('queue', []); if (!queue.length) break;
      const item = queue[0];
      try { await api('sale_create', item); done++; }
      catch (e) {
        if (e.offline) break;
        const failed = LS.get('failed', []); failed.push({ ...item, _error: e.message }); LS.set('failed', failed);
      }
      LS.set('queue', LS.get('queue', []).filter(x => x.client_uuid !== item.client_uuid));
      updateQueuePill();
    }
  } finally { syncing = false; updateQueuePill(); }
  if (done) { toast(`${done} transaksi offline berhasil disinkronkan`); if (S.view !== 'kasir') loadData(); }
}
setInterval(sync, 30000);

// =====================================================
//  PROMO ENGINE (sama persis dengan api.php)
// =====================================================
function promoOn(p, d) {
  const ds = `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (p.start_at && ds < p.start_at.replace('T', ' ')) return false;
  if (p.end_at && ds > p.end_at.replace('T', ' ')) return false;
  if (p.days && !String(p.days).split(',').includes(String(d.getDay() || 7))) return false;
  const h = ds.slice(11);
  if (p.hour_start && h < p.hour_start) return false;
  if (p.hour_end && h >= p.hour_end) return false;
  return true;
}
function promoMatch(p, prod) {
  if (p.scope === 'product') return String(p.target || '').split(',').map(s => s.trim()).includes(String(prod.id));
  if (p.scope === 'category') return String(p.target || '').trim().toLowerCase() === String(prod.category || '').toLowerCase();
  return true;
}
function calcCart(cart = S.cart, member = !!S.member, manualPct = S.manualPct) {
  const now = new Date(), promos = S.promos.filter(p => +p.active && promoOn(p, now));
  const lines = []; let sub = 0, ld = 0, cogs = 0;
  for (const it of cart) {
    const p = S.pmap[it.pid]; if (!p) continue;
    let unit = p.unit, factor = 1, price = p.price;
    if (it.unit && it.unit !== p.unit) { const u = p.units.find(x => x.unit === it.unit); if (u) { unit = u.unit; factor = u.factor; price = u.price; } }
    let qty = +it.qty || 0; qty = (+p.decimal_qty && factor == 1) ? Math.round(qty * 1000) / 1000 : Math.floor(qty);
    if (qty <= 0) continue;
    const gross = Math.round(price * qty); let best = 0, pname = null;
    for (const pr of promos) {
      if (!['percent', 'nominal', 'bxgy'].includes(pr.type)) continue;
      if (+pr.member_only && !member) continue;
      if (!promoMatch(pr, p)) continue;
      if (pr.type !== 'bxgy' && +pr.min_qty > 0 && qty < +pr.min_qty) continue;
      let d = 0;
      if (pr.type === 'percent') d = gross * pr.value / 100;
      else if (pr.type === 'nominal') d = Math.min(gross, pr.value * qty);
      else { const g = +pr.min_qty + +pr.free_qty; d = g > 0 ? Math.floor(qty / g) * pr.free_qty * price : 0; }
      if (+pr.max_disc > 0) d = Math.min(d, +pr.max_disc);
      d = Math.round(d); if (d > best) { best = d; pname = pr.name; }
    }
    const cost = Math.round(p.cost * factor * qty * 100) / 100;
    lines.push({ pid: p.id, name: p.name, unit, factor, qty, price, gross, discount: best, promo: pname, total: gross - best, cost });
    sub += gross; ld += best; cogs += cost;
  }
  const after = sub - ld; let td = 0, tname = null;
  for (const pr of promos) {
    if (!['total_percent', 'total_nominal'].includes(pr.type)) continue;
    if (+pr.member_only && !member) continue;
    if (after < +pr.min_total || after <= 0) continue;
    let d = pr.type === 'total_percent' ? after * pr.value / 100 : +pr.value;
    if (+pr.max_disc > 0) d = Math.min(d, +pr.max_disc);
    d = Math.round(Math.min(d, after)); if (d > td) { td = d; tname = pr.name; }
  }
  const md = Math.round((after - td) * Math.max(0, Math.min(100, manualPct)) / 100);
  return { lines, subtotal: sub, line_disc: ld, trx_disc: td, trx_promo: tname, manual_disc: md, total: Math.max(0, after - td - md), cogs };
}

// =====================================================
//  NAVIGASI
// =====================================================
function navItems() {
  const n = [['kasir', 'Kasir'], ['stok', 'Stok']];
  n.push(can('admin') ? ['promo', 'Promo'] : ['promo', 'Member']);
  if (can('supervisor')) n.push(['laporan', 'Laporan']);
  n.push(['more', 'Lainnya']);
  return n;
}
function buildNav() {
  $('#nav').innerHTML = navItems().map(([k, l]) => `<button data-v="${k}">${svg(k === 'promo' && !can('admin') ? 'member' : k)}<span>${l}</span></button>`).join('');
  $$('#nav button').forEach(b => b.onclick = () => { S.view = b.dataset.v; S.sub = null; render(); });
}
function render() {
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  const v = { kasir: viewKasir, stok: viewStok, promo: viewPromo, laporan: viewLaporan, more: viewMore }[S.view] || viewKasir;
  window.scrollTo(0, 0); v();
}
function tabs(key, list, onChange) {
  if (!S.tab[key] || !list.find(t => t[0] === S.tab[key])) S.tab[key] = list[0][0];
  const h = `<div class="tabs">${list.map(([k, l]) => `<button data-t="${k}" class="${S.tab[key] === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  setTimeout(() => $$('.tabs button').forEach(b => b.onclick = () => { S.tab[key] = b.dataset.t; onChange(); }));
  return h;
}

// =====================================================
//  KASIR
// =====================================================
function viewKasir() {
  const noShift = !S.shift;
  $('#view').innerHTML = `
  ${noShift ? `<div class="alert">Shift belum dibuka. Buka shift dulu untuk mulai transaksi. <button class="btn sm" id="openShiftBtn" style="margin-left:.4rem">Buka Shift</button></div>` : ''}
  <div class="pos">
    <div>
      <div class="card">
        <div class="row">
          <input id="scan" class="grow" placeholder="Scan barcode / cari nama / SKU…" autocomplete="off" enterkeyhint="search">
          <button class="icon-btn" id="camBtn" title="Scan dengan kamera">${svg('cam', 20)}</button>
        </div>
        <div class="results" id="results"></div>
      </div>
    </div>
    <div class="cart-col">
      <div class="card">
        <div id="memberBox"></div>
        <div id="cartList"></div>
        <div class="totals" id="totals"></div>
        <div class="grid3" style="margin-top:.6rem">
          <button class="btn sec sm" id="holdBtn">Tunda</button>
          <button class="btn sec sm" id="holdsBtn">Daftar Tunda</button>
          <button class="btn sec sm" id="discBtn">Diskon</button>
        </div>
        <div class="row" style="margin-top:.5rem">
          <button class="btn sec" id="clearBtn">Kosongkan</button>
          <button class="btn grow" id="payBtn">BAYAR</button>
        </div>
      </div>
    </div>
  </div>`;
  const scan = $('#scan');
  scan.addEventListener('input', () => renderResults(scan.value));
  scan.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleCode(scan.value); } });
  $('#camBtn').onclick = () => openScanner(code => handleCode(code));
  $('#openShiftBtn') && ($('#openShiftBtn').onclick = shiftOpenModal);
  $('#holdBtn').onclick = holdCart; $('#holdsBtn').onclick = showHolds; $('#discBtn').onclick = discountModal;
  $('#clearBtn').onclick = () => { if (S.cart.length && confirm('Kosongkan keranjang?')) { resetCart(); } };
  $('#payBtn').onclick = payModal;
  renderResults(''); renderCart();
  if (!('ontouchstart' in window)) scan.focus();
}
function findByCode(code) {
  code = String(code).trim(); if (!code) return null;
  const alt = /^0\d{12}$/.test(code) ? code.slice(1) : /^\d{12}$/.test(code) ? '0' + code : null;
  if (alt) { const f = findByCode1(code) || findByCode1(alt); return f; }
  return findByCode1(code);
}
function findByCode1(code) {
  for (const p of S.products) {
    if (p.barcode && p.barcode === code) return { p, unit: p.unit };
    const u = p.units.find(x => x.barcode && x.barcode === code); if (u) return { p, unit: u.unit };
  }
  const p = S.products.find(p => p.sku && p.sku.toLowerCase() === code.toLowerCase());
  return p ? { p, unit: p.unit } : null;
}
function handleCode(code) {
  const f = findByCode(code), scan = $('#scan');
  if (f) { addToCart(f.p.id, f.unit); if (scan) { scan.value = ''; renderResults(''); } beep(); return; }
  const list = searchProducts(code);
  if (list.length === 1) { addToCart(list[0].id); if (scan) { scan.value = ''; renderResults(''); } return; }
  if (scan) { scan.value = code; renderResults(code); }
  if (!list.length) toast('Produk "' + code + '" tidak ditemukan', true);
}
function searchProducts(q) {
  q = String(q || '').toLowerCase().trim();
  if (!q) return S.products.slice(0, 24);
  return S.products.filter(p => (p.name + ' ' + (p.sku || '') + ' ' + (p.barcode || '') + ' ' + (p.category || '')).toLowerCase().includes(q)).slice(0, 40);
}
function renderResults(q) {
  const el = $('#results'); if (!el) return;
  const list = searchProducts(q);
  el.innerHTML = list.map(p => `<button class="prod" data-id="${p.id}">
      <div class="nm">${esc(p.name)}</div><div class="pr">${rp(p.price)}<span class="small muted">/${esc(p.unit)}</span></div>
      <div class="st ${p.stock <= p.min_stock ? 'low' : ''}">Stok ${nf(p.stock)} ${esc(p.unit)}${p.units.length ? ' · ' + p.units.map(u => esc(u.unit)).join(', ') : ''}</div></button>`).join('')
    || '<p class="muted">Tidak ada produk.</p>';
  $$('.prod', el).forEach(b => b.onclick = () => addToCart(+b.dataset.id));
}
function addToCart(pid, unit) {
  if (!S.shift) { toast('Buka shift terlebih dahulu', true); return; }
  const p = S.pmap[pid]; unit = unit || p.unit;
  const ex = S.cart.find(i => i.pid == pid && i.unit === unit);
  if (ex) ex.qty = +ex.qty + 1; else S.cart.push({ pid: +pid, unit, qty: 1 });
  renderCart();
}
function resetCart() { S.cart = []; S.member = null; S.manualPct = 0; S.authPin = null; renderCart(); }
function renderCart() {
  LS.set('cart_' + S.storeId, S.cart);
  const c = calcCart();
  const mb = $('#memberBox'); if (!mb) return;
  mb.innerHTML = S.member
    ? `<div class="member-chip"><span>★ ${esc(S.member.name)} · ${esc(S.member.code)} · ${nf(S.member.points)} poin</span><button class="btn sec sm" id="mRemove">Lepas</button></div>`
    : `<button class="btn sec block sm" id="mPick">+ Pilih Member (poin & promo member)</button>`;
  $('#mPick') && ($('#mPick').onclick = memberPicker);
  $('#mRemove') && ($('#mRemove').onclick = () => { S.member = null; renderCart(); });
  $('#cartList').innerHTML = S.cart.length ? S.cart.map((it, i) => {
    const p = S.pmap[it.pid], l = c.lines.find(x => x.pid == it.pid && x.unit === (it.unit || p.unit)) || { total: 0, price: p.price, discount: 0 };
    const units = [p.unit, ...p.units.map(u => u.unit)], dec = +p.decimal_qty && it.unit === p.unit;
    const over = it.qty * (l.factor || 1) > p.stock;
    return `<div class="cart-item">
      <div class="row"><div class="grow bold">${esc(p.name)}</div><div class="bold">${rp(l.total)}</div></div>
      <div class="row" style="margin-top:.3rem">
        <div class="qty">
          <button data-i="${i}" data-d="-1">−</button>
          <input data-i="${i}" class="qin" value="${it.qty}" inputmode="${dec ? 'decimal' : 'numeric'}">
          <button data-i="${i}" data-d="1">+</button>
          ${units.length > 1 ? `<select data-i="${i}" class="usel">${units.map(u => `<option ${u === it.unit ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>` : `<span class="small muted">${esc(p.unit)}</span>`}
        </div>
        <div class="grow right small muted">@${rp(l.price)}</div>
      </div>
      ${l.discount ? `<div class="promo">🏷 ${esc(l.promo)} −${rp(l.discount)}</div>` : ''}
      ${over ? `<div class="small" style="color:var(--bad)">Stok tersedia ${nf(p.stock)} ${esc(p.unit)}</div>` : ''}
    </div>`;
  }).join('') : '<p class="muted center">Keranjang kosong. Scan atau pilih produk.</p>';
  $$('.qty button').forEach(b => b.onclick = () => {
    const it = S.cart[b.dataset.i], p = S.pmap[it.pid], step = 1;
    it.qty = Math.round((+it.qty + step * b.dataset.d) * 1000) / 1000;
    if (it.qty <= 0) S.cart.splice(b.dataset.i, 1);
    renderCart();
  });
  $$('.qin').forEach(inp => inp.onchange = () => {
    const v = parseFloat(inp.value.replace(',', '.')); const it = S.cart[inp.dataset.i];
    if (!(v > 0)) S.cart.splice(inp.dataset.i, 1); else it.qty = v; renderCart();
  });
  $$('.usel').forEach(sel => sel.onchange = () => { S.cart[sel.dataset.i].unit = sel.value; S.cart[sel.dataset.i].qty = Math.max(1, Math.floor(S.cart[sel.dataset.i].qty)); renderCart(); });
  $('#totals').innerHTML = `
    <div><span>Subtotal</span><span>${rp(c.subtotal)}</span></div>
    ${c.line_disc ? `<div style="color:var(--ok)"><span>Promo item</span><span>−${rp(c.line_disc)}</span></div>` : ''}
    ${c.trx_disc ? `<div style="color:var(--ok)"><span>${esc(c.trx_promo)}</span><span>−${rp(c.trx_disc)}</span></div>` : ''}
    ${c.manual_disc ? `<div style="color:var(--ok)"><span>Diskon manual ${S.manualPct}%</span><span>−${rp(c.manual_disc)}</span></div>` : ''}
    <div class="grand"><span>TOTAL</span><span>${rp(c.total)}</span></div>`;
  pushDisplay(c);
}
let beepCtx;
function beep() { try { beepCtx = beepCtx || new AudioContext(); const o = beepCtx.createOscillator(), g = beepCtx.createGain(); o.frequency.value = 1200; g.gain.value = .05; o.connect(g); g.connect(beepCtx.destination); o.start(); o.stop(beepCtx.currentTime + .07); } catch (e) { } }

// ---------- Live display push ----------
let dispT;
function pushDisplay(c, extra = {}) {
  clearTimeout(dispT);
  dispT = setTimeout(() => {
    if (!S.online) return;
    const data = { status: 'cart', items: c.lines.map(l => ({ name: l.name, qty: l.qty, unit: l.unit, total: l.total, promo: l.promo, discount: l.discount })),
      subtotal: c.subtotal, discount: c.line_disc + c.trx_disc + c.manual_disc, total: c.total, member: S.member ? S.member.name : null, ...extra };
    api('display_push', { data }).catch(() => { });
  }, 350);
}

// ---------- Member ----------
function memberPicker() {
  const b = modal('Pilih Member', `
    <input id="mq" placeholder="Cari kode / nama / no. HP">
    <div class="list" id="mlist" style="margin-top:.5rem"></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0">
    <h3>Daftar member baru</h3>
    <div class="grid2"><input id="mn" placeholder="Nama"><input id="mp" placeholder="No. HP" inputmode="tel"></div>
    <button class="btn block" id="madd" style="margin-top:.5rem">Simpan & Pilih</button>`);
  const show = list => $('#mlist', b).innerHTML = list.slice(0, 20).map(m => `<div data-id="${m.id}" style="cursor:pointer"><div class="grow"><b>${esc(m.name)}</b><div class="small muted">${esc(m.code)} · ${esc(m.phone || '-')}</div></div><span class="badge ok">${nf(m.points)} poin</span></div>`).join('') || '<p class="muted">Tidak ditemukan.</p>';
  const bind = list => { show(list); $$('#mlist>div[data-id]', b).forEach(d => d.onclick = () => { S.member = list.find(m => m.id == d.dataset.id); closeModal(); renderCart(); }); };
  let t; $('#mq', b).oninput = () => {
    const q = val('#mq', b).toLowerCase();
    const local = S.members.filter(m => (m.code + ' ' + m.name + ' ' + (m.phone || '')).toLowerCase().includes(q)); bind(local);
    clearTimeout(t); if (q.length >= 2 && S.online) t = setTimeout(() => api('members', null, '&q=' + encodeURIComponent(q)).then(r => bind(r.rows)).catch(() => { }), 300);
  };
  bind(S.members);
  $('#madd', b).onclick = e => run(e.target, async () => {
    const r = await api('member_save', { name: val('#mn', b), phone: val('#mp', b) });
    S.members.unshift(r.member); saveLocalBoot(); S.member = r.member; closeModal(); renderCart(); toast('Member ' + r.member.code + ' terdaftar');
  });
}

// ---------- Tunda ----------
function holdCart() {
  if (!S.cart.length) return toast('Keranjang kosong', true);
  const b = modal('Tunda Transaksi', `<label>Keterangan (opsional)</label><input id="hl" placeholder="mis. Ibu baju merah"><button class="btn block" id="hs" style="margin-top:.8rem">Tunda</button>`);
  $('#hs', b).onclick = () => {
    const holds = LS.get('holds_' + S.storeId, []);
    holds.push({ id: uuid(), label: val('#hl', b) || 'Transaksi ' + (holds.length + 1), cart: S.cart, member: S.member, manualPct: S.manualPct, at: stamp(new Date()), total: calcCart().total });
    LS.set('holds_' + S.storeId, holds); resetCart(); closeModal(); toast('Transaksi ditunda');
  };
}
function showHolds() {
  const holds = LS.get('holds_' + S.storeId, []);
  const b = modal('Transaksi Ditunda', holds.length ? `<div class="list">${holds.map(h => `<div><div class="grow"><b>${esc(h.label)}</b><div class="small muted">${esc(h.at)} · ${h.cart.length} item · ${rp(h.total)}</div></div>
      <button class="btn sm" data-take="${h.id}">Ambil</button><button class="btn sec sm" data-del="${h.id}">Hapus</button></div>`).join('')}</div>` : '<p class="muted">Tidak ada transaksi ditunda.</p>');
  $$('[data-take]', b).forEach(x => x.onclick = () => {
    if (S.cart.length) return toast('Tunda atau kosongkan keranjang saat ini dulu', true);
    const h = holds.find(y => y.id === x.dataset.take);
    S.cart = h.cart.filter(i => S.pmap[i.pid]); S.member = h.member; S.manualPct = h.manualPct > S.cfg.disc_limit ? 0 : h.manualPct;
    LS.set('holds_' + S.storeId, holds.filter(y => y.id !== h.id)); closeModal(); renderCart();
  });
  $$('[data-del]', b).forEach(x => x.onclick = () => { if (confirm('Hapus transaksi tunda ini?')) { LS.set('holds_' + S.storeId, holds.filter(y => y.id !== x.dataset.del)); showHolds(); } });
}

// ---------- Diskon manual & otorisasi ----------
function discountModal() {
  const lim = S.cfg.disc_limit;
  const b = modal('Diskon Manual', `<p class="small muted" style="margin-top:0">Diskon di atas ${lim}% membutuhkan PIN supervisor.</p>
    <label>Diskon (%) dari total</label><input id="dp" inputmode="decimal" value="${S.manualPct || ''}">
    <div id="pinBox" class="hidden"><label>PIN Supervisor</label><input id="dpin" type="password" inputmode="numeric" maxlength="6"></div>
    <div class="row" style="margin-top:.8rem"><button class="btn sec" id="d0">Hapus Diskon</button><button class="btn grow" id="dok">Terapkan</button></div>`);
  const chk = () => $('#pinBox', b).classList.toggle('hidden', !(parseFloat(val('#dp', b)) > lim)); $('#dp', b).oninput = chk; chk();
  $('#d0', b).onclick = () => { S.manualPct = 0; S.authPin = null; closeModal(); renderCart(); };
  $('#dok', b).onclick = e => run(e.target, async () => {
    const pct = Math.max(0, Math.min(100, parseFloat(val('#dp', b).replace(',', '.')) || 0));
    if (pct > lim) {
      if (!S.online) throw new Error('Otorisasi diskon besar butuh koneksi online');
      const r = await api('authorize', { pin: val('#dpin', b), reason: 'diskon ' + pct + '%' });
      S.authPin = val('#dpin', b); toast('Disetujui oleh ' + r.by);
    } else S.authPin = null;
    S.manualPct = pct; closeModal(); renderCart();
  });
}

// ---------- Pembayaran ----------
function payModal() {
  if (!S.shift) return toast('Buka shift terlebih dahulu', true);
  const c = calcCart(); if (!c.lines.length) return toast('Keranjang kosong', true);
  const methods = S.cfg.payments || ['Tunai'];
  const quick = [...new Set([c.total, Math.ceil(c.total / 5000) * 5000, Math.ceil(c.total / 10000) * 10000, Math.ceil(c.total / 50000) * 50000, Math.ceil(c.total / 100000) * 100000])].filter(x => x >= c.total).slice(0, 5);
  const b = modal('Pembayaran', `
    <div class="totals"><div class="grand" style="border:0;margin:0"><span>Total</span><span>${rp(c.total)}</span></div></div>
    ${!S.online ? '<div class="alert">Mode offline: transaksi disimpan di perangkat & otomatis dikirim saat online.</div>' : ''}
    <div class="paybox"><div class="row"><b class="grow">Tunai</b><input class="pamt" data-m="Tunai" inputmode="numeric" value="${c.total}" style="width:55%"></div>
      <div class="quick">${quick.map(q => `<button data-q="${q}">${q === c.total ? 'Uang pas' : short(q)}</button>`).join('')}</div></div>
    ${methods.filter(m => m !== 'Tunai').map(m => `<div class="paybox"><div class="row"><b class="grow">${esc(m)}</b><input class="pamt" data-m="${esc(m)}" inputmode="numeric" placeholder="0" style="width:55%"></div>
      <input class="pref" data-m="${esc(m)}" placeholder="No. ref / approval (opsional)" style="margin-top:.35rem;padding:.4rem .6rem;font-size:.85rem"></div>`).join('')}
    <div class="totals" style="margin-top:.5rem"><div><span>Dibayar</span><b id="pPaid"></b></div><div><span>Kembalian</span><b id="pChg"></b></div></div>
    <div id="pErr" class="alert bad hidden" style="margin-top:.5rem"></div>
    <button class="btn block" id="pGo" style="margin-top:.7rem;padding:.9rem">Proses Pembayaran</button>`);
  const read = () => {
    const pays = $$('.pamt', b).map(i => ({ method: i.dataset.m, amount: parseFloat(i.value.replace(/[^\d.,]/g, '').replace(',', '.')) || 0, ref: ($(`.pref[data-m="${i.dataset.m}"]`, b) || {}).value || '' })).filter(p => p.amount > 0);
    const paid = pays.reduce((s, p) => s + p.amount, 0), nonCash = pays.filter(p => p.method !== 'Tunai').reduce((s, p) => s + p.amount, 0);
    $('#pPaid', b).textContent = rp(paid); $('#pChg', b).textContent = rp(Math.max(0, paid - c.total));
    let err = ''; if (paid < c.total) err = 'Kurang ' + rp(c.total - paid); else if (nonCash > c.total) err = 'Non-tunai melebihi total';
    $('#pErr', b).textContent = err; $('#pErr', b).classList.toggle('hidden', !err); $('#pGo', b).disabled = !!err;
    return { pays, paid };
  };
  $$('.pamt', b).forEach(i => i.oninput = read);
  $$('.quick button', b).forEach(q => q.onclick = () => { $('.pamt[data-m="Tunai"]', b).value = q.dataset.q; read(); });
  // isi otomatis: jika memilih non-tunai, kurangi tunai
  $$('.pamt:not([data-m="Tunai"])', b).forEach(i => i.addEventListener('focus', () => {
    if (!i.value) { const others = $$('.pamt', b).filter(x => x !== i && x.dataset.m !== 'Tunai').reduce((s, x) => s + (+x.value || 0), 0); i.value = Math.max(0, c.total - others); $('.pamt[data-m="Tunai"]', b).value = 0; read(); }
  }));
  read();
  $('#pGo', b).onclick = e => run(e.target, () => processSale(c, read()));
}
async function processSale(c, { pays, paid }) {
  const payload = {
    client_uuid: uuid(), items: S.cart.map(i => ({ pid: i.pid, unit: i.unit, qty: i.qty })), member_id: S.member ? S.member.id : null,
    manual_pct: S.manualPct, auth_pin: S.authPin, payments: pays, shift_id: S.shift ? S.shift.id : null, created_at: stamp(new Date()), offline: false
  };
  let sale, offline = false;
  try { const r = await api('sale_create', payload); sale = r.sale; }
  catch (e) {
    if (!e.offline) throw e;
    if (S.manualPct > S.cfg.disc_limit) throw new Error('Diskon besar tidak bisa diproses offline');
    payload.offline = true; offline = true;
    const q = LS.get('queue', []); q.push(payload); LS.set('queue', q); updateQueuePill();
    const st = S.stores.find(s => s.id == S.storeId) || {};
    sale = { invoice: 'OFF-' + payload.client_uuid.slice(0, 8).toUpperCase(), created_at: payload.created_at, store_name: st.name, store_address: st.address, store_phone: st.phone,
      cashier: S.user.name, member_name: S.member?.name, member_code: S.member?.code, subtotal: c.subtotal, line_disc: c.line_disc, trx_disc: c.trx_disc, manual_disc: c.manual_disc,
      total: c.total, paid, change_amt: Math.max(0, paid - c.total), points: S.member ? Math.floor(c.total / S.cfg.point_per) : 0, items: c.lines, payments: pays, offline: 1 };
  }
  // update stok lokal (agar akurat walau offline)
  for (const l of c.lines) { const p = S.pmap[l.pid]; if (p) p.stock = Math.round((p.stock - l.qty * l.factor) * 1000) / 1000; }
  if (S.member && sale.points) { S.member.points = +S.member.points + +sale.points; const m = S.members.find(x => x.id == S.member.id); if (m) m.points = S.member.points; }
  saveLocalBoot();
  pushDisplay(c, { status: 'paid', paid, change: sale.change_amt });
  resetCart(); closeModal(); showReceipt(sale, offline);
  setTimeout(() => api('display_push', { data: { status: 'idle' } }).catch(() => { }), 12000);
}
function receiptHTML(s) {
  const disc = (+s.line_disc || 0) + (+s.trx_disc || 0) + (+s.manual_disc || 0);
  return `<div class="receipt">
    <div class="c"><b>${esc(s.store_name || '')}</b><br>${esc(s.store_address || '')}<br>${esc(s.store_phone || '')}</div><hr>
    <div class="r"><span>${esc(s.invoice)}</span><span>${esc(String(s.created_at).slice(0, 16))}</span></div>
    <div>Kasir: ${esc(s.cashier || '')}</div>${s.member_name ? `<div>Member: ${esc(s.member_name)} (${esc(s.member_code)})</div>` : ''}<hr>
    ${s.items.map(i => `<div>${esc(i.name)}</div><div class="r"><span>${nf(i.qty)} ${esc(i.unit)} x ${nf(i.price)}</span><span>${nf(+i.qty * +i.price)}</span></div>${+i.discount ? `<div class="r"><span>  ${esc(i.promo || 'Diskon')}</span><span>-${nf(i.discount)}</span></div>` : ''}`).join('')}<hr>
    <div class="r"><span>Subtotal</span><span>${nf(s.subtotal)}</span></div>
    ${disc ? `<div class="r"><span>Total diskon</span><span>-${nf(disc)}</span></div>` : ''}
    <div class="r"><b>TOTAL</b><b>${nf(s.total)}</b></div>
    ${s.payments.map(p => `<div class="r"><span>${esc(p.method)}</span><span>${nf(p.amount)}</span></div>`).join('')}
    <div class="r"><span>Kembali</span><span>${nf(s.change_amt)}</span></div>
    ${+s.points ? `<div class="r"><span>Poin didapat</span><span>+${s.points}</span></div>` : ''}
    ${s.status === 'void' ? '<hr><div class="c"><b>*** DIBATALKAN ***</b></div>' : ''}
    ${s.offline ? '<hr><div class="c">Transaksi offline</div>' : ''}
    <hr><div class="c">Terima kasih atas kunjungan Anda</div></div>`;
}
function receiptText(s) {
  return `*${s.store_name}*\n${s.invoice} · ${String(s.created_at).slice(0, 16)}\n` + s.items.map(i => `${i.name}\n  ${nf(i.qty)} ${i.unit} x ${nf(i.price)} = ${nf(+i.qty * +i.price)}${+i.discount ? ` (-${nf(i.discount)})` : ''}`).join('\n') +
    `\nTOTAL: ${rp(s.total)}\nBayar: ${rp(s.paid)}  Kembali: ${rp(s.change_amt)}\nTerima kasih 🙏`;
}
function showReceipt(s, offline) {
  const b = modal(offline ? 'Tersimpan (Offline)' : 'Transaksi Berhasil', `
    <div style="text-align:center;margin-bottom:.6rem"><div class="small muted">Kembalian</div><div style="font-size:2rem;font-weight:800;color:var(--pri)">${rp(s.change_amt)}</div></div>
    <div style="border:1px solid var(--line);border-radius:10px;padding:.7rem;max-height:40vh;overflow:auto">${receiptHTML(s)}</div>
    <div class="grid3" style="margin-top:.7rem"><button class="btn sec" id="rPrint">Cetak</button><button class="btn sec" id="rWa">WhatsApp</button><button class="btn" id="rNew">Baru</button></div>`);
  $('#rPrint', b).onclick = () => printReceipt(s);
  $('#rWa', b).onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(receiptText(s)), '_blank');
  $('#rNew', b).onclick = () => { closeModal(); $('#scan') && $('#scan').focus(); };
}
function printReceipt(s) { $('#printArea').innerHTML = receiptHTML(s); setTimeout(() => window.print(), 50); }

// ---------- Scanner: kamera, foto, gambar, tempel ----------
let nativeDet = null;
const getDet = () => nativeDet || (nativeDet = new BarcodeDetector());
async function detectNative(src) {
  if (!('BarcodeDetector' in window)) return null;
  try { const r = await getDet().detect(src); return r.length ? r[0].rawValue : null; } catch (e) { return null; }
}
async function openScanner(onCode) {
  let stream = null, stop = false;
  const touch = 'ontouchstart' in window;
  const onPaste = e => { const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); fromFile(f); } };
  const b = modal('Scan Barcode', `
    <div id="camWrap"><video id="vid" playsinline muted></video><div class="small muted" id="camMsg">Membuka kamera…</div></div>
    <div class="${touch ? 'grid2' : ''}" style="margin-top:.6rem">
      ${touch ? `<label class="btn sec scan-btn">📷 Foto Barcode<input type="file" accept="image/*" capture="environment" id="fCap" hidden></label>` : ''}
      <label class="btn sec scan-btn">🖼 Pilih Gambar / Foto<input type="file" accept="image/*" id="fPick" hidden></label>
    </div>
    ${touch ? '' : '<div class="drop" id="drop">Tarik & lepas gambar barcode ke sini, atau tempel screenshot dengan <b>Ctrl+V</b></div>'}
    <div id="imgBox" class="hidden" style="margin-top:.5rem;text-align:center"><img id="imgPrev" alt="" style="max-width:100%;max-height:160px;border-radius:8px"></div>
    <div id="imgMsg" class="small" style="margin-top:.4rem"></div>
    <div class="row" style="margin-top:.6rem"><input id="manualCode" class="grow" placeholder="atau ketik kode barcode" inputmode="text"><button class="btn" id="manualGo">OK</button></div>`,
    () => { stop = true; stream && stream.getTracks().forEach(t => t.stop()); document.removeEventListener('paste', onPaste); });
  const msg = (t, bad) => { const m = $('#imgMsg', b); if (m) { m.textContent = t; m.style.color = bad ? 'var(--bad)' : 'var(--ink2)'; } };
  const finish = code => { if (stop) return; closeModal(); beep(); onCode(String(code).trim()); };
  async function fromFile(file) {
    if (!file || !/^image\//.test(file.type)) return msg('File harus berupa gambar (JPG/PNG).', true);
    const url = URL.createObjectURL(file); $('#imgPrev', b).src = url; $('#imgBox', b).classList.remove('hidden');
    msg('Membaca barcode dari gambar…');
    await new Promise(r => setTimeout(r, 30));
    try {
      let code = null;
      try { code = await detectNative(await createImageBitmap(file)); } catch (e) { }
      if (!code) { const r = await BarcodeReader.decodeFile(file); if (r) code = r.text; }
      if (code) finish(code);
      else msg('Barcode tidak terbaca. Pastikan foto tajam (tidak buram), cukup terang, dan seluruh barcode terlihat. Format didukung: EAN-13, UPC-A, EAN-8, Code 128.', true);
    } catch (e) { msg(e.message, true); }
  }
  $$('#fCap, #fPick', b).forEach(inp => inp.onchange = () => { fromFile(inp.files[0]); inp.value = ''; });
  document.addEventListener('paste', onPaste);
  const drop = $('#drop', b);
  if (drop) {
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('on'); };
    drop.ondragleave = () => drop.classList.remove('on');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('on'); fromFile(e.dataTransfer.files[0]); };
  }
  $('#manualGo', b).onclick = () => { const v = val('#manualCode', b); if (v) finish(v); };
  $('#manualCode', b).onkeydown = e => { if (e.key === 'Enter') $('#manualGo', b).click(); };
  // kamera langsung
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error(location.protocol === 'https:' || location.hostname === 'localhost' ? 'browser tidak mendukung kamera' : 'kamera hanya bisa lewat HTTPS / localhost');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
    if (stop) { stream.getTracks().forEach(t => t.stop()); return; }
    const v = $('#vid', b); v.srcObject = stream; await v.play();
    $('#camMsg', b).textContent = 'Arahkan barcode ke kamera — dekatkan sampai garisnya jelas & tidak buram.';
    const native = 'BarcodeDetector' in window;
    const loop = async () => {
      if (stop) return;
      let code = null;
      if (native) code = await detectNative(v);
      if (!code && v.videoWidth) { try { const r = BarcodeReader.decodeSource(v, v.videoWidth, v.videoHeight, { sizes: [960], lines: 14, need: 2, strict: true, angles: [0, 90, -8, 8] }); if (r) code = r.text; } catch (e) { } }
      if (code) return finish(code);
      setTimeout(loop, 180);
    };
    loop();
  } catch (e) {
    const w = $('#camWrap', b); if (w) w.innerHTML = `<div class="alert" style="margin:0">Kamera tidak bisa dibuka (${esc(e.message)}). Gunakan <b>${touch ? 'Foto Barcode' : 'Pilih Gambar'}</b> di bawah.</div>`;
  }
}

// ---------- Pemilih produk (dipakai di Stok) ----------
function productPicker(root, onPick) {
  root.innerHTML = `<div class="row"><input class="grow pp-q" placeholder="Cari / scan produk…" autocomplete="off"><button class="icon-btn pp-cam" type="button">${svg('cam', 20)}</button></div><div class="list pp-list"></div>`;
  const q = $('.pp-q', root), list = $('.pp-list', root);
  const show = () => {
    const f = findByCode(q.value); const items = f ? [f.p] : (q.value ? searchProducts(q.value).slice(0, 8) : []);
    list.innerHTML = items.map(p => `<div data-id="${p.id}" style="cursor:pointer"><div class="grow"><b>${esc(p.name)}</b><div class="small muted">${esc(p.sku || '')} ${esc(p.barcode || '')}</div></div><span class="small">${nf(p.stock)} ${esc(p.unit)}</span></div>`).join('');
    $$('[data-id]', list).forEach(d => d.onclick = () => { q.value = S.pmap[d.dataset.id].name; list.innerHTML = ''; onPick(S.pmap[d.dataset.id]); });
  };
  q.oninput = show;
  q.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const f = findByCode(q.value); if (f) { q.value = f.p.name; list.innerHTML = ''; onPick(f.p, f.unit); } else show(); } };
  $('.pp-cam', root).onclick = () => openScanner(code => { const f = findByCode(code); if (f) { q.value = f.p.name; onPick(f.p, f.unit); } else toast('Barcode ' + code + ' tidak terdaftar', true); });
}

// =====================================================
//  STOK
// =====================================================
function viewStok() {
  const t = [['list', 'Daftar Stok'], ['opname', 'Stock Opname']];
  if (can('supervisor')) t.push(['in', 'Stok Masuk'], ['transfer', 'Transfer Cabang']);
  t.push(['moves', 'Mutasi']);
  $('#view').innerHTML = tabs('stok', t, viewStok) + '<div id="sv"></div>';
  ({ list: stokList, opname: stokOpname, in: stokIn, transfer: stokTransfer, moves: stokMoves })[S.tab.stok]();
}
async function stokList() {
  const el = $('#sv');
  el.innerHTML = `<div class="card"><div class="row"><input id="sq" class="grow" placeholder="Cari produk…"><label class="check" style="margin:0"><input type="checkbox" id="slow"> Menipis</label></div><div id="st" class="scroll-x" style="margin-top:.5rem">Memuat…</div></div>`;
  let rows;
  try { rows = (await api('stock_list')).rows.map(r => ({ ...r, qty: +r.qty, min_stock: +r.min_stock })); rows.forEach(r => { if (S.pmap[r.id]) S.pmap[r.id].stock = r.qty; }); saveLocalBoot(); }
  catch (e) { rows = S.products.map(p => ({ ...p, qty: p.stock })); }
  const draw = () => {
    const q = val('#sq').toLowerCase(), low = val('#slow');
    const f = rows.filter(r => (r.name + ' ' + (r.sku || '') + ' ' + (r.barcode || '')).toLowerCase().includes(q) && (!low || r.qty <= r.min_stock));
    $('#st').innerHTML = `<table><tr><th>Produk</th><th class="n">Stok</th><th class="n">Min</th><th class="n">Nilai</th></tr>${f.map(r => `<tr data-id="${r.id}" style="cursor:pointer">
      <td>${esc(r.name)}<div class="small muted">${esc(r.category || '')} ${esc(r.sku || '')}</div></td>
      <td class="n">${r.qty <= r.min_stock ? '<span class="badge bad">' + nf(r.qty) + '</span>' : nf(r.qty)} ${esc(r.unit)}</td><td class="n">${nf(r.min_stock)}</td><td class="n">${short(r.qty * r.cost)}</td></tr>`).join('')}</table>
      <p class="small muted">${f.length} produk · Nilai persediaan ${rp(f.reduce((s, r) => s + r.qty * r.cost, 0))} · Ketuk produk untuk cek stok di cabang lain.</p>`;
    $$('#st tr[data-id]').forEach(tr => tr.onclick = () => stockDetail(+tr.dataset.id));
  };
  $('#sq').oninput = draw; $('#slow').onchange = draw; draw();
}
async function stockDetail(pid) {
  const p = S.pmap[pid] || {}; const b = modal(p.name || 'Produk', 'Memuat…');
  try {
    const [o, m] = await Promise.all([api('stock_other', null, '&pid=' + pid), api('stock_moves', null, '&pid=' + pid)]);
    b.innerHTML = `<h3>Stok di semua cabang</h3><table>${o.rows.map(r => `<tr><td>${esc(r.name)}${r.id == S.storeId ? ' <span class="badge ok">toko ini</span>' : ''}</td><td class="n">${nf(r.qty)} ${esc(p.unit || '')}</td></tr>`).join('')}</table>
      <h3 style="margin-top:1rem">Riwayat mutasi</h3><div class="scroll-x"><table><tr><th>Waktu</th><th>Jenis</th><th class="n">Qty</th><th>Ref</th></tr>${m.rows.slice(0, 30).map(r => `<tr><td class="small">${esc(r.created_at.slice(0, 16))}</td><td>${esc(r.type)}</td><td class="n">${+r.qty > 0 ? '+' : ''}${nf(r.qty)}</td><td class="small">${esc(r.ref || '')}</td></tr>`).join('')}</table></div>`;
  } catch (e) { b.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }
}
function stokOpname() {
  const done = S._opname || (S._opname = []);
  $('#sv').innerHTML = `<div class="card"><h3>Stock Opname (hitung fisik)</h3><p class="small muted" style="margin-top:0">Scan / cari produk, masukkan jumlah fisik. Selisih tercatat otomatis.</p>
    <div id="pp"></div><div id="ob" class="hidden" style="margin-top:.6rem">
      <div class="grid2"><div><label>Stok sistem</label><input id="osys" readonly></div><div><label>Jumlah fisik</label><input id="ocnt" inputmode="decimal"></div></div>
      <label>Catatan</label><input id="onote" placeholder="opsional"><button class="btn block" id="osave" style="margin-top:.6rem">Simpan Opname</button></div></div>
    <div class="card"><h3>Hasil sesi ini</h3><div id="olist">${done.length ? '' : '<p class="muted small">Belum ada.</p>'}</div></div>`;
  let cur = null;
  const drawDone = () => { if (done.length) $('#olist').innerHTML = `<table><tr><th>Produk</th><th class="n">Sistem</th><th class="n">Fisik</th><th class="n">Selisih</th></tr>${done.map(d => `<tr><td>${esc(d.name)}</td><td class="n">${nf(d.system)}</td><td class="n">${nf(d.counted)}</td><td class="n ${d.diff < 0 ? 'down' : d.diff > 0 ? 'up' : ''}">${d.diff > 0 ? '+' : ''}${nf(d.diff)}</td></tr>`).join('')}</table>`; };
  drawDone();
  productPicker($('#pp'), async p => {
    cur = p; $('#ob').classList.remove('hidden'); $('#osys').value = nf(p.stock) + ' ' + p.unit + ' (memuat…)';
    try { const r = await api('stock_other', null, '&pid=' + p.id); const mine = r.rows.find(x => x.id == S.storeId); p.stock = +mine.qty; } catch (e) { }
    $('#osys').value = nf(p.stock) + ' ' + p.unit; $('#ocnt').value = ''; $('#ocnt').focus();
  });
  $('#osave').onclick = e => run(e.target, async () => {
    if (!cur) throw new Error('Pilih produk');
    const cnt = parseFloat(val('#ocnt').replace(',', '.')); if (isNaN(cnt) || cnt < 0) throw new Error('Isi jumlah fisik');
    const r = await api('opname', { pid: cur.id, counted: cnt, note: val('#onote') });
    cur.stock = cnt; saveLocalBoot(); done.unshift({ name: cur.name, ...r }); drawDone();
    toast('Opname tersimpan, selisih ' + nf(r.diff)); $('#ob').classList.add('hidden'); $('.pp-q').value = ''; $('.pp-q').focus(); cur = null;
  });
}
function stokIn() {
  $('#sv').innerHTML = `<div class="card"><h3>Stok Masuk / Penerimaan Barang</h3><div id="pp"></div>
    <div class="grid2"><div><label>Satuan</label><select id="iu"></select></div><div><label>Jumlah</label><input id="iq" inputmode="decimal"></div></div>
    <div class="grid2"><div><label>Harga beli per satuan (opsional)</label><input id="ic" inputmode="numeric"></div><div><label>No. faktur / surat jalan</label><input id="ir"></div></div>
    <label>Catatan / supplier</label><input id="in"><button class="btn block" id="isave" style="margin-top:.7rem">Simpan Stok Masuk</button></div>`;
  let cur = null;
  productPicker($('#pp'), (p, unit) => { cur = p; $('#iu').innerHTML = [p.unit, ...p.units.map(u => u.unit)].map(u => `<option ${u === unit ? 'selected' : ''}>${esc(u)}</option>`).join(''); $('#iq').focus(); });
  $('#isave').onclick = e => run(e.target, async () => {
    if (!cur) throw new Error('Pilih produk');
    await api('stock_in', { pid: cur.id, unit: val('#iu'), qty: parseFloat(val('#iq').replace(',', '.')), cost: parseFloat(val('#ic')) || 0, ref: val('#ir'), note: val('#in') });
    toast('Stok masuk tersimpan'); await loadData(); stokIn();
  });
}
function stokTransfer() {
  const others = S.allStores.filter(s => s.id != S.storeId);
  $('#sv').innerHTML = `<div class="card"><h3>Transfer Stok Antar Cabang</h3><p class="small muted" style="margin-top:0">Pindahkan barang ke cabang lain yang kehabisan stok. Stok kedua toko langsung ter-update.</p>
    <div id="pp"></div><div id="tinfo" class="small muted"></div>
    <div class="grid2"><div><label>Ke toko</label><select id="tto">${others.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div><div><label>Jumlah (satuan dasar)</label><input id="tq" inputmode="decimal"></div></div>
    <label>Catatan</label><input id="tn"><button class="btn block" id="tsave" style="margin-top:.7rem" ${others.length ? '' : 'disabled'}>Transfer</button></div>`;
  let cur = null;
  productPicker($('#pp'), async p => {
    cur = p; $('#tinfo').textContent = 'Memuat stok cabang…';
    try { const r = await api('stock_other', null, '&pid=' + p.id); $('#tinfo').innerHTML = r.rows.map(x => `${esc(x.name)}: <b>${nf(x.qty)}</b> ${esc(p.unit)}`).join(' · '); } catch (e) { $('#tinfo').textContent = ''; }
  });
  $('#tsave').onclick = e => run(e.target, async () => {
    if (!cur) throw new Error('Pilih produk');
    const r = await api('transfer', { pid: cur.id, to: +val('#tto'), qty: parseFloat(val('#tq').replace(',', '.')), note: val('#tn') });
    toast('Transfer berhasil: ' + r.ref); await loadData(); stokTransfer();
  });
}
async function stokMoves() {
  $('#sv').innerHTML = '<div class="card scroll-x" id="mv">Memuat…</div>';
  try {
    const r = await api('stock_moves');
    $('#mv').innerHTML = `<table><tr><th>Waktu</th><th>Produk</th><th>Jenis</th><th class="n">Qty</th><th>Ref / Catatan</th><th>Oleh</th></tr>${r.rows.map(m => `<tr><td class="small">${esc(m.created_at.slice(0, 16))}</td><td>${esc(m.name)}</td><td><span class="badge">${esc(m.type)}</span></td>
      <td class="n ${+m.qty < 0 ? 'down' : 'up'}">${+m.qty > 0 ? '+' : ''}${nf(m.qty)} ${esc(m.unit)}</td><td class="small">${esc(m.ref || '')} ${esc(m.note || '')}</td><td class="small">${esc(m.user || '')}</td></tr>`).join('')}</table>`;
  } catch (e) { $('#mv').textContent = e.message; }
}

// =====================================================
//  PROMO & MEMBER
// =====================================================
const PTYPE = { percent: 'Diskon % per item', nominal: 'Potongan Rp per item', bxgy: 'Beli X Gratis Y', total_percent: 'Diskon % total belanja', total_nominal: 'Potongan Rp total belanja' };
const DAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
function viewPromo() {
  const t = can('admin') ? [['promo', 'Promo'], ['member', 'Member']] : [['member', 'Member']];
  $('#view').innerHTML = tabs('promo', t, viewPromo) + '<div id="pv"></div>';
  S.tab.promo === 'promo' ? promoList() : memberList();
}
async function promoList() {
  $('#pv').innerHTML = `<div class="card"><div class="row"><h3 class="grow" style="margin:0">Daftar Promo</h3><button class="btn sm" id="padd">+ Promo Baru</button></div><div id="pl" style="margin-top:.5rem">Memuat…</div></div>`;
  $('#padd').onclick = () => promoForm({});
  try {
    const r = await api('promos');
    $('#pl').innerHTML = r.rows.length ? `<div class="list">${r.rows.map(p => {
      const now = stamp(new Date()).slice(0, 16), st = !+p.active ? ['Nonaktif', ''] : p.running ? ['Berjalan', 'ok'] : (p.end_at && now > p.end_at.replace('T', ' ')) ? ['Berakhir', 'bad'] : ['Terjadwal', 'warn'];
      return `<div data-id="${p.id}" style="cursor:pointer"><div class="grow"><b>${esc(p.name)}</b><div class="small muted">${PTYPE[p.type]} · ${p.store ? esc(p.store) : 'Semua toko'}${+p.member_only ? ' · khusus member' : ''}
        ${p.start_at || p.end_at ? '<br>' + esc((p.start_at || '…').replace('T', ' ')) + ' s/d ' + esc((p.end_at || '…').replace('T', ' ')) : ''}${p.hour_start ? ' · jam ' + p.hour_start + '–' + p.hour_end : ''}${p.days ? ' · ' + p.days.split(',').map(d => DAYS[d - 1]).join(',') : ''}</div></div>
        <span class="badge ${st[1]}">${st[0]}</span></div>`;
    }).join('')}</div>` : '<p class="muted">Belum ada promo.</p>';
    $$('#pl [data-id]').forEach(d => d.onclick = () => promoForm(r.rows.find(p => p.id == d.dataset.id)));
  } catch (e) { $('#pl').textContent = e.message; }
}
function promoForm(p) {
  const days = String(p.days || '').split(',').filter(Boolean);
  const b = modal(p.id ? 'Ubah Promo' : 'Promo Baru', `
    <label>Nama promo</label><input name="name" value="${esc(p.name || '')}">
    <label>Jenis</label><select name="type">${Object.entries(PTYPE).map(([k, l]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <div id="fScope"><label>Berlaku untuk</label><select name="scope"><option value="all">Semua produk</option><option value="category" ${p.scope === 'category' ? 'selected' : ''}>Kategori</option><option value="product" ${p.scope === 'product' ? 'selected' : ''}>Produk tertentu</option></select>
      <div id="fTarget"></div></div>
    <div class="grid2">
      <div id="fVal"><label id="lVal">Nilai</label><input name="value" inputmode="decimal" value="${p.value ?? ''}"></div>
      <div id="fMin"><label id="lMin">Min. qty</label><input name="min_qty" inputmode="decimal" value="${p.min_qty ?? ''}"></div>
      <div id="fFree"><label>Gratis (qty)</label><input name="free_qty" inputmode="decimal" value="${p.free_qty ?? ''}"></div>
      <div id="fMinT"><label>Min. belanja (Rp)</label><input name="min_total" inputmode="numeric" value="${p.min_total ?? ''}"></div>
      <div id="fMax"><label>Maks. potongan (Rp, 0=tanpa batas)</label><input name="max_disc" inputmode="numeric" value="${p.max_disc ?? ''}"></div>
    </div>
    ${S.user.role === 'owner' ? `<label>Toko</label><select name="store_id"><option value="">Semua toko</option>${S.allStores.map(s => `<option value="${s.id}" ${p.store_id == s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
    <h3 style="margin-top:1rem">Jadwal otomatis</h3>
    <div class="grid2"><div><label>Mulai</label><input type="datetime-local" name="start_at" value="${esc(p.start_at || '')}"></div><div><label>Berakhir</label><input type="datetime-local" name="end_at" value="${esc(p.end_at || '')}"></div>
      <div><label>Jam mulai (harian)</label><input type="time" name="hour_start" value="${esc(p.hour_start || '')}"></div><div><label>Jam selesai</label><input type="time" name="hour_end" value="${esc(p.hour_end || '')}"></div></div>
    <label>Hari berlaku (kosong = setiap hari)</label><div class="row wrap">${DAYS.map((d, i) => `<label class="check" style="margin:0"><input type="checkbox" class="pday" value="${i + 1}" ${days.includes(String(i + 1)) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
    <div class="row wrap" style="margin-top:.6rem"><label class="check"><input type="checkbox" name="member_only" ${+p.member_only ? 'checked' : ''}> Khusus member</label>
      <label class="check"><input type="checkbox" name="active" ${p.id ? (+p.active ? 'checked' : '') : 'checked'}> Aktif</label></div>
    <div class="row" style="margin-top:.8rem">${p.id ? '<button class="btn bad" id="pdel">Hapus</button>' : ''}<button class="btn grow" id="psave">Simpan</button></div>`);
  const tgt = () => {
    const sc = $('[name=scope]', b).value, box = $('#fTarget', b), cats = [...new Set(S.products.map(x => x.category).filter(Boolean))];
    const cur = box.dataset.init ? '' : (p.target || ''); box.dataset.init = 1;
    box.innerHTML = sc === 'category' ? `<label>Kategori</label><select name="target">${cats.map(c => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`
      : sc === 'product' ? `<label>Produk (bisa pilih lebih dari satu)</label><select name="target" multiple size="5">${S.products.map(x => `<option value="${x.id}" ${String(cur).split(',').includes(String(x.id)) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : '';
  };
  const typ = () => {
    const t = $('[name=type]', b).value, isT = t.startsWith('total');
    $('#fScope', b).classList.toggle('hidden', isT); $('#fFree', b).classList.toggle('hidden', t !== 'bxgy');
    $('#fMinT', b).classList.toggle('hidden', !isT); $('#fVal', b).classList.toggle('hidden', t === 'bxgy'); $('#fMin', b).classList.toggle('hidden', isT);
    $('#lVal', b).textContent = t.includes('percent') ? 'Diskon (%)' : 'Potongan (Rp)'; $('#lMin', b).textContent = t === 'bxgy' ? 'Beli (qty)' : 'Min. qty';
  };
  $('[name=scope]', b).onchange = tgt; $('[name=type]', b).onchange = typ; tgt(); typ();
  $('#psave', b).onclick = e => run(e.target, async () => {
    const d = formData(b); d.id = p.id; d.days = $$('.pday:checked', b).map(x => x.value).join(',');
    const ts = $('[name=target]', b); d.target = ts ? (ts.multiple ? [...ts.selectedOptions].map(o => o.value).join(',') : ts.value) : '';
    if (d.type.startsWith('total')) d.scope = 'all';
    await api('promo_save', d); closeModal(); toast('Promo tersimpan'); loadData(); promoList();
  });
  $('#pdel', b) && ($('#pdel', b).onclick = e => { if (confirm('Hapus promo ini?')) run(e.target, async () => { await api('promo_delete', { id: p.id }); closeModal(); loadData(); promoList(); }); });
}
async function memberList() {
  $('#pv').innerHTML = `<div class="card"><div class="row"><input id="mq2" class="grow" placeholder="Cari member…"><button class="btn sm" id="madd2">+ Member</button></div><div id="ml" style="margin-top:.5rem"></div></div>`;
  const draw = async () => {
    let rows; try { rows = (await api('members', null, '&q=' + encodeURIComponent(val('#mq2')))).rows; } catch (e) { rows = S.members; }
    $('#ml').innerHTML = `<div class="scroll-x"><table><tr><th>Kode</th><th>Nama</th><th>HP</th><th class="n">Poin</th><th class="n">Total belanja</th></tr>${rows.map(m => `<tr data-id="${m.id}" style="cursor:pointer"><td>${esc(m.code)}</td><td>${esc(m.name)}</td><td>${esc(m.phone || '')}</td><td class="n">${nf(m.points)}</td><td class="n">${m.total_spent != null ? short(m.total_spent) : '-'}</td></tr>`).join('')}</table></div>`;
    $$('#ml tr[data-id]').forEach(tr => tr.onclick = () => memberForm(rows.find(m => m.id == tr.dataset.id), draw));
  };
  let t; $('#mq2').oninput = () => { clearTimeout(t); t = setTimeout(draw, 300); };
  $('#madd2').onclick = () => memberForm({}, draw); draw();
}
function memberForm(m, after) {
  const b = modal(m.id ? 'Ubah Member ' + m.code : 'Member Baru', `<label>Nama</label><input name="name" value="${esc(m.name || '')}"><label>No. HP</label><input name="phone" inputmode="tel" value="${esc(m.phone || '')}">
    <label>Email</label><input name="email" type="email" value="${esc(m.email || '')}">${m.id ? `<p class="small muted">Poin: ${nf(m.points)} · Bergabung ${esc(m.created_at || '')}</p>` : ''}<button class="btn block" id="msave" style="margin-top:.7rem">Simpan</button>`);
  $('#msave', b).onclick = e => run(e.target, async () => { const r = await api('member_save', { ...formData(b), id: m.id }); if (!m.id) S.members.unshift(r.member); closeModal(); toast('Member tersimpan'); after && after(); });
}

// =====================================================
//  LAPORAN & ANALISA
// =====================================================
function rangeOf(k) {
  const t = new Date(), d = n => { const x = new Date(); x.setDate(x.getDate() - n); return ymd(x); };
  return { today: [ymd(t), ymd(t)], yday: [d(1), d(1)], d7: [d(6), ymd(t)], d30: [d(29), ymd(t)], month: [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)] }[k];
}
function viewLaporan() {
  const R = S.rf || (S.rf = { preset: 'd7', from: rangeOf('d7')[0], to: rangeOf('d7')[1], store: S.user.role === 'owner' ? 0 : S.storeId });
  const t = [['dash', 'Dashboard'], ['analisa', 'Analisa'], ['trx', 'Transaksi'], ['shift', 'Shift']];
  $('#view').innerHTML = `${tabs('lap', t, viewLaporan)}
    <div class="card"><div class="row wrap">
      <select id="rp" style="width:auto">${[['today', 'Hari ini'], ['yday', 'Kemarin'], ['d7', '7 hari'], ['d30', '30 hari'], ['month', 'Bulan ini'], ['custom', 'Pilih tanggal']].map(([k, l]) => `<option value="${k}" ${R.preset === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input type="date" id="rf" value="${R.from}" style="width:auto"><input type="date" id="rt" value="${R.to}" style="width:auto">
      ${S.user.role === 'owner' ? `<select id="rs" style="width:auto"><option value="0">Semua toko</option>${S.allStores.map(s => `<option value="${s.id}" ${R.store == s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
      ${can('admin') && S.tab.lap !== 'shift' ? `<div class="row" style="margin-left:auto"><span class="small muted">Ekspor:</span><button class="btn sec sm" data-ex="sales">Penjualan</button><button class="btn sec sm" data-ex="items">Item</button><button class="btn sec sm" data-ex="journal">Jurnal Akuntansi</button></div>` : ''}
    </div></div><div id="lv">Memuat…</div>`;
  const upd = () => { R.from = $('#rf').value; R.to = $('#rt').value; R.store = $('#rs') ? +$('#rs').value : S.storeId; loadLap(); };
  $('#rp').onchange = () => { R.preset = $('#rp').value; if (R.preset !== 'custom') { [R.from, R.to] = rangeOf(R.preset); $('#rf').value = R.from; $('#rt').value = R.to; } upd(); };
  $('#rf').onchange = $('#rt').onchange = () => { R.preset = 'custom'; $('#rp').value = 'custom'; upd(); };
  $('#rs') && ($('#rs').onchange = upd);
  $$('[data-ex]').forEach(b => b.onclick = () => { location.href = `api.php?a=export&type=${b.dataset.ex}&from=${R.from}&to=${R.to}&store=${R.store}`; });
  loadLap();
}
async function loadLap() {
  const R = S.rf, el = $('#lv'), qs = `&from=${R.from}&to=${R.to}`, body = { store: R.store };
  el.innerHTML = '<p class="muted">Memuat…</p>';
  try {
    if (S.tab.lap === 'trx') return lapTrx(el, (await api('sales_list', body, qs)).rows);
    if (S.tab.lap === 'shift') return lapShift(el, (await api('shift_list', body)).rows);
    const r = await api('report', body, qs);
    S.tab.lap === 'dash' ? lapDash(el, r) : lapAnalisa(el, r);
  } catch (e) { el.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; }
}
function delta(cur, prev) { if (!+prev) return ''; const g = (cur - prev) / prev * 100; return `<div class="d ${g >= 0 ? 'up' : 'down'}">${g >= 0 ? '▲' : '▼'} ${Math.abs(g).toFixed(1)}% vs periode lalu</div>`; }
function lapDash(el, r) {
  const s = r.summary;
  // lengkapi tanggal kosong agar sumbu waktu tidak melompat
  const days = [], map = Object.fromEntries(r.daily.map(d => [d.d, d]));
  for (let d = new Date(r.range[0] + 'T00:00'); ymd(d) <= r.range[1]; d.setDate(d.getDate() + 1)) { const k = ymd(d); days.push({ label: k.slice(8) + '/' + k.slice(5, 7), value: +(map[k]?.omzet || 0), tip: `${k}: ${rp(map[k]?.omzet || 0)} · ${map[k]?.trx || 0} trx` }); }
  const hmap = Object.fromEntries(r.hourly.map(h => [h.h, h])), hours = [];
  for (let h = 6; h <= 23; h++) hours.push({ label: pad(h), value: +(hmap[h]?.omzet || 0), tip: `Jam ${pad(h)}:00 · ${rp(hmap[h]?.omzet || 0)} · ${hmap[h]?.trx || 0} trx` });
  el.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="k">Omzet</div><div class="v">${rp(s.omzet)}</div>${delta(s.omzet, r.prev.omzet)}</div>
      <div class="stat"><div class="k">Transaksi</div><div class="v">${nf(s.trx)}</div>${delta(s.trx, r.prev.trx)}</div>
      <div class="stat"><div class="k">Rata-rata / struk</div><div class="v">${rp(s.avg)}</div></div>
      <div class="stat"><div class="k">Laba kotor</div><div class="v">${rp(s.profit)}</div><div class="d muted">Margin ${s.omzet ? (s.profit / s.omzet * 100).toFixed(1) : 0}%</div></div>
      <div class="stat"><div class="k">Total diskon/promo</div><div class="v">${rp(s.disc)}</div></div>
      <div class="stat"><div class="k">Void</div><div class="v">${nf(s.voids)}</div><div class="d muted">${r.low_stock.length} produk stok menipis</div></div>
    </div>
    <div class="card"><h3>Omzet harian</h3>${barChart(days)}</div>
    <div class="card"><h3>Omzet per jam (jam sibuk)</h3>${barChart(hours)}</div>
    <div class="card"><h3>Performa toko</h3><div class="scroll-x"><table><tr><th>Toko</th><th class="n">Trx</th><th class="n">Omzet</th><th class="n">Laba kotor</th><th class="n">Kontribusi</th></tr>
      ${r.stores.map(x => `<tr><td>${esc(x.name)}</td><td class="n">${nf(x.trx)}</td><td class="n">${rp(x.omzet)}</td><td class="n">${rp(x.profit)}</td><td class="n">${s.omzet ? (x.omzet / s.omzet * 100).toFixed(1) : 0}%</td></tr>`).join('')}</table></div></div>`;
  bindTips(el);
}
function lapAnalisa(el, r) {
  const s = r.summary;
  el.innerHTML = `
    <div class="card"><h3>Tren produk (dibanding periode sebelumnya)</h3><div class="scroll-x"><table><tr><th>Produk</th><th class="n">Qty</th><th class="n">Omzet</th><th class="n">Laba</th><th class="n">Tren</th></tr>
      ${r.products.map(p => `<tr><td>${esc(p.name)}<div class="small muted">${esc(p.category || '')}</div></td><td class="n">${nf(p.qty)} ${esc(p.unit)}</td><td class="n">${rp(p.omzet)}</td><td class="n">${rp(p.profit)}</td>
        <td class="n">${p.growth === null ? '<span class="badge">baru</span>' : `<span class="${p.growth >= 0 ? 'up' : 'down'}">${p.growth >= 0 ? '▲' : '▼'} ${Math.abs(p.growth)}%</span>`}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Belum ada penjualan.</td></tr>'}</table></div></div>
    <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
      <div class="card"><h3>Omzet per kategori</h3>${hbars(r.categories.map(c => ({ label: c.name, value: +c.omzet })))}</div>
      <div class="card"><h3>Metode pembayaran</h3>${hbars(r.payments.map(p => ({ label: p.name + ' (' + p.n + ')', value: +p.amt })))}</div>
      <div class="card"><h3>Performa kasir</h3>${hbars(r.cashiers.map(c => ({ label: c.name + ' (' + c.trx + ')', value: +c.omzet })))}</div>
      <div class="card"><h3>Pelanggan & member</h3>
        <p class="small" style="margin-top:0">Porsi omzet member: <b>${s.omzet ? (s.member_omzet / s.omzet * 100).toFixed(1) : 0}%</b> · Member baru: <b>${r.new_members}</b></p>
        <table><tr><th>Member teratas</th><th class="n">Trx</th><th class="n">Belanja</th></tr>${r.members.map(m => `<tr><td>${esc(m.name)} <span class="small muted">${esc(m.code)}</span></td><td class="n">${m.trx}</td><td class="n">${short(m.omzet)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">-</td></tr>'}</table></div>
    </div>
    <div class="card"><h3>Monitoring stok menipis</h3><div class="scroll-x"><table><tr><th>Produk</th><th>Toko</th><th class="n">Stok</th><th class="n">Min</th></tr>
      ${r.low_stock.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.store)}</td><td class="n"><span class="badge bad">${nf(x.qty)} ${esc(x.unit)}</span></td><td class="n">${nf(x.min_stock)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Semua stok aman ✓</td></tr>'}</table></div></div>`;
}
function lapTrx(el, rows) {
  el.innerHTML = `<div class="card scroll-x"><table><tr><th>Waktu</th><th>Invoice</th><th>Toko</th><th>Kasir</th><th class="n">Total</th><th>Status</th></tr>${rows.map(s => `<tr data-id="${s.id}" style="cursor:pointer">
    <td class="small">${esc(s.created_at.slice(5, 16))}</td><td>${esc(s.invoice)}${+s.offline ? ' <span class="badge warn">offline</span>' : ''}</td><td class="small">${esc(s.store)}</td><td class="small">${esc(s.cashier || '')}</td>
    <td class="n">${rp(s.total)}</td><td>${s.status === 'void' ? '<span class="badge bad">void</span>' : '<span class="badge ok">lunas</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Tidak ada transaksi.</td></tr>'}</table></div>`;
  $$('tr[data-id]', el).forEach(tr => tr.onclick = () => saleDetail(+tr.dataset.id));
}
async function saleDetail(id) {
  const b = modal('Detail Transaksi', 'Memuat…');
  try {
    const s = (await api('sale_detail', null, '&id=' + id)).sale;
    b.innerHTML = `<div style="border:1px solid var(--line);border-radius:10px;padding:.7rem">${receiptHTML(s)}</div>
      ${s.status === 'void' ? `<p class="small" style="color:var(--bad)">Dibatalkan ${esc(s.void_at)} — ${esc(s.void_reason)}</p>` : ''}
      <div class="row" style="margin-top:.7rem"><button class="btn sec grow" id="sp">Cetak Ulang</button>${s.status !== 'void' ? '<button class="btn bad grow" id="sv2">Batalkan (Void)</button>' : ''}</div>`;
    $('#sp', b).onclick = () => printReceipt(s);
    $('#sv2', b) && ($('#sv2', b).onclick = () => {
      const v = modal('Void ' + s.invoice, `<p class="small muted" style="margin-top:0">Stok akan dikembalikan & poin member dikurangi. Butuh PIN supervisor.</p>
        <label>Alasan</label><input id="vr"><label>PIN Supervisor</label><input id="vp" type="password" inputmode="numeric" maxlength="6"><button class="btn bad block" id="vgo" style="margin-top:.7rem">Batalkan Transaksi</button>`);
      $('#vgo', v).onclick = e => run(e.target, async () => { await api('sale_void', { id: s.id, reason: val('#vr', v), auth_pin: val('#vp', v) }); closeModal(); toast('Transaksi dibatalkan'); loadData(); loadLap(); });
    });
  } catch (e) { b.innerHTML = esc(e.message); }
}
function lapShift(el, rows) {
  el.innerHTML = `<div class="card scroll-x"><table><tr><th>Kasir</th><th>Toko</th><th>Buka</th><th>Tutup</th><th class="n">Modal</th><th class="n">Seharusnya</th><th class="n">Fisik</th><th class="n">Selisih</th></tr>
    ${rows.map(s => { const df = s.closed_at ? s.closing_cash - s.expected_cash : null; return `<tr><td>${esc(s.cashier)}</td><td class="small">${esc(s.store)}</td><td class="small">${esc(s.opened_at.slice(5, 16))}</td><td class="small">${s.closed_at ? esc(s.closed_at.slice(5, 16)) : '<span class="badge ok">aktif</span>'}</td>
      <td class="n">${short(s.opening_cash)}</td><td class="n">${s.closed_at ? rp(s.expected_cash) : '-'}</td><td class="n">${s.closed_at ? rp(s.closing_cash) : '-'}</td><td class="n ${df < 0 ? 'down' : df > 0 ? 'up' : ''}">${df === null ? '-' : rp(df)}</td></tr>`; }).join('')}</table></div>`;
}
// ---- chart sederhana (1 seri, batang tipis, sudut atas membulat, tooltip saat hover) ----
function barChart(data, H = 170) {
  if (!data.length || !data.some(d => d.value)) return '<p class="muted small">Belum ada data pada periode ini.</p>';
  const W = 400, L = 36, B = 22, T = 8, max = Math.max(...data.map(d => d.value)) || 1;
  const nice = (() => { const e = Math.pow(10, Math.floor(Math.log10(max))), f = max / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; })();
  const cw = (W - L) / data.length, bw = Math.max(2, Math.min(28, cw - 2)), y = v => T + (H - T - B) * (1 - v / nice);
  const every = Math.ceil(data.length / 12);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = nice * i / 4, yy = y(v); g += `<line class="grid" x1="${L}" x2="${W}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy + 3}" text-anchor="end">${short(v)}</text>`; }
  const bars = data.map((d, i) => {
    const x = L + i * cw + (cw - bw) / 2, top = y(d.value), h = H - B - top, r = Math.min(4, bw / 2, h);
    const path = h > 0 ? `M${x},${H - B}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${H - B}Z` : '';
    return `<rect class="hit" data-tip="${esc(d.tip)}" x="${L + i * cw}" y="${T}" width="${cw}" height="${H - T - B}" fill="transparent"/>${path ? `<path class="bar" d="${path}" pointer-events="none"/>` : ''}
      ${i % every === 0 ? `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>` : ''}`;
  }).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${g}<line class="axis" x1="${L}" x2="${W}" y1="${H - B}" y2="${H - B}"/>${bars}</svg></div>`;
}
function bindTips(root) {
  $$('.chart', root).forEach(c => {
    const tip = document.createElement('div'); tip.className = 'tip hidden'; c.appendChild(tip);
    c.addEventListener('pointermove', e => {
      const t = e.target.closest('[data-tip]'); if (!t) { tip.classList.add('hidden'); return; }
      const r = c.getBoundingClientRect(); tip.textContent = t.dataset.tip; tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (e.clientY - r.top) + 'px'; tip.classList.remove('hidden');
    });
    c.addEventListener('pointerleave', () => tip.classList.add('hidden'));
  });
}
function hbars(list) {
  if (!list.length) return '<p class="muted small">Belum ada data.</p>';
  const max = Math.max(...list.map(x => x.value)) || 1;
  return list.map(x => `<div class="hbar"><span class="lbl" title="${esc(x.label)}">${esc(x.label)}</span><span class="trk"><span class="fil" style="width:${(x.value / max * 100).toFixed(1)}%;display:block"></span></span><span class="val">${short(x.value)}</span></div>`).join('');
}

// =====================================================
//  LAINNYA: shift, sinkron, produk, toko, user, backup, audit
// =====================================================
function viewMore() {
  if (S.sub) return ({ produk: admProduk, toko: admToko, user: admUser, backup: admBackup, audit: admAudit })[S.sub]();
  const q = LS.get('queue', []).length, f = LS.get('failed', []);
  $('#view').innerHTML = `
    <div class="card"><div class="row"><div class="grow"><b>${esc(S.user.name)}</b><div class="small muted">${esc(S.user.username)} · ${esc(S.user.role)}</div></div><button class="btn sec sm" id="pw">Ganti Password</button><button class="btn bad sm" id="lo">Keluar</button></div></div>
    <div class="card"><h3>Shift Kasir</h3><div id="shiftBox">${S.shift ? `<p style="margin:0">Shift aktif sejak <b>${esc(S.shift.opened_at.slice(0, 16))}</b>, modal awal ${rp(S.shift.opening_cash)}</p>
      <button class="btn warn" id="shClose" style="margin-top:.6rem">Tutup Shift & Rekap Kas</button>` : '<p class="muted" style="margin:0">Belum ada shift terbuka.</p><button class="btn" id="shOpen" style="margin-top:.6rem">Buka Shift</button>'}</div></div>
    <div class="card"><h3>Sinkronisasi Offline</h3><p style="margin:0">${q} transaksi menunggu dikirim${f.length ? ` · <b style="color:var(--bad)">${f.length} gagal</b>` : ''}.</p>
      ${f.map((x, i) => `<div class="alert bad small" style="margin:.5rem 0 0">${esc(x.created_at)} · ${x.items.length} item — ${esc(x._error)} <button class="btn sec sm" data-fi="${i}">Hapus</button></div>`).join('')}
      <div class="row" style="margin-top:.6rem"><button class="btn sec" id="syn">Sinkronkan Sekarang</button><button class="btn sec" id="rel">Muat Ulang Data</button></div></div>
    <div class="card" id="instCard"><h3>Pasang di Android</h3><p class="small muted" style="margin-top:0">Pasang sebagai aplikasi di layar utama agar bisa dibuka tanpa browser & tetap jalan saat offline.</p>
      <button class="btn" id="inst">${deferredInstall ? 'Pasang Aplikasi' : 'Cara Pasang'}</button></div>
    ${can('admin') ? `<div class="card"><h3>Live Display Panel</h3><p class="small muted" style="margin-top:0">Buka di tablet/TV yang menghadap pelanggan: menampilkan isi belanja, total, dan promo yang sedang berjalan.</p>
      <div class="row"><input readonly id="dlink" value="${esc(dispLink())}"><button class="btn sec" id="dcopy">Salin</button><a class="btn" href="${esc(dispLink())}" target="_blank">Buka</a></div></div>` : ''}
    ${can('admin') ? `<div class="card"><h3>Pengaturan</h3><div class="list">
      <div data-sub="produk" style="cursor:pointer"><span class="grow">📦 Master Produk & Multi Satuan</span>›</div>
      ${S.user.role === 'owner' ? `<div data-sub="toko" style="cursor:pointer"><span class="grow">🏬 Toko & Cabang</span>›</div>
      <div data-sub="user" style="cursor:pointer"><span class="grow">👥 User & Hak Akses</span>›</div>
      <div data-sub="backup" style="cursor:pointer"><span class="grow">🔒 Backup Data</span>›</div>` : ''}
      <div data-sub="audit" style="cursor:pointer"><span class="grow">📝 Log Aktivitas (Audit)</span>›</div></div></div>` : ''}`;
  $('#lo').onclick = async () => { try { await api('logout', {}); } catch (e) { } LS.del('me'); location.reload(); };
  $('#pw').onclick = () => { const b = modal('Ganti Password', '<label>Password lama</label><input type="password" id="po"><label>Password baru (min. 6)</label><input type="password" id="pn"><button class="btn block" id="pgo" style="margin-top:.7rem">Simpan</button>'); $('#pgo', b).onclick = e => run(e.target, async () => { await api('change_password', { old: val('#po', b), new: val('#pn', b) }); closeModal(); toast('Password diganti'); }); };
  $('#shOpen') && ($('#shOpen').onclick = shiftOpenModal);
  $('#shClose') && ($('#shClose').onclick = shiftCloseModal);
  $('#syn').onclick = e => run(e.target, async () => { await sync(); viewMore(); });
  $('#rel').onclick = e => run(e.target, async () => { await loadData(); toast('Data diperbarui'); viewMore(); });
  $$('[data-fi]').forEach(x => x.onclick = () => { if (confirm('Hapus transaksi gagal ini dari antrean?')) { const a = LS.get('failed', []); a.splice(+x.dataset.fi, 1); LS.set('failed', a); updateQueuePill(); viewMore(); } });
  $('#inst').onclick = () => { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } else modal('Pasang di Android', '<ol><li>Buka aplikasi ini di <b>Chrome</b> Android.</li><li>Ketuk menu ⋮ di kanan atas.</li><li>Pilih <b>Tambahkan ke Layar Utama</b> / <b>Instal aplikasi</b>.</li></ol><p class="small muted">Wajib diakses lewat HTTPS agar bisa dipasang & memakai kamera.</p>'); };
  $('#dcopy') && ($('#dcopy').onclick = () => { navigator.clipboard?.writeText($('#dlink').value); toast('Link disalin'); });
  $$('[data-sub]').forEach(d => d.onclick = () => { S.sub = d.dataset.sub; viewMore(); });
}
function dispLink() { return new URL(`display.html?store=${S.storeId}&key=${LS.get('me', {}).display_key || ''}`, location.href).href; }
function backBar(t) { return `<div class="row" style="margin-bottom:.6rem"><button class="btn sec sm" id="back">‹ Kembali</button><h2 style="margin:0">${t}</h2></div>`; }
function bindBack() { $('#back').onclick = () => { S.sub = null; viewMore(); }; }

function shiftOpenModal() {
  const b = modal('Buka Shift', '<label>Modal kas awal (uang di laci)</label><input id="oc" inputmode="numeric" value="0"><button class="btn block" id="ogo" style="margin-top:.7rem">Buka Shift</button>');
  $('#ogo', b).onclick = e => run(e.target, async () => { const r = await api('shift_open', { opening_cash: parseFloat(val('#oc', b)) || 0 }); S.shift = r.shift; saveLocalBoot(); closeModal(); toast('Shift dibuka'); render(); });
}
async function shiftCloseModal() {
  if (LS.get('queue', []).length) return toast('Sinkronkan transaksi offline dulu sebelum tutup shift', true);
  const b = modal('Tutup Shift', 'Memuat rekap…');
  try {
    const s = await api('shift_summary');
    b.innerHTML = `<table><tr><td>Jumlah transaksi</td><td class="n">${s.trx}</td></tr><tr><td>Omzet</td><td class="n">${rp(s.omzet)}</td></tr><tr><td>Void</td><td class="n">${s.voids}</td></tr>
      ${s.payments.map(p => `<tr><td>${esc(p.method)}</td><td class="n">${rp(p.amt)}</td></tr>`).join('')}
      <tr><td>Modal awal</td><td class="n">${rp(s.shift.opening_cash)}</td></tr><tr><td><b>Kas seharusnya di laci</b></td><td class="n"><b>${rp(s.expected_cash)}</b></td></tr></table>
      <label>Uang fisik di laci (hitung)</label><input id="cc" inputmode="numeric"><div id="cdiff" class="small" style="margin-top:.3rem"></div>
      <label>Catatan</label><input id="cn"><button class="btn warn block" id="cgo" style="margin-top:.7rem">Tutup Shift</button>`;
    $('#cc', b).oninput = () => { const d = (parseFloat(val('#cc', b)) || 0) - s.expected_cash; $('#cdiff', b).innerHTML = `Selisih: <b class="${d < 0 ? 'down' : d > 0 ? 'up' : ''}">${rp(d)}</b>`; };
    $('#cgo', b).onclick = e => run(e.target, async () => {
      const r = await api('shift_close', { closing_cash: parseFloat(val('#cc', b)) || 0, note: val('#cn', b) });
      S.shift = null; saveLocalBoot(); closeModal(); toast('Shift ditutup. Selisih ' + rp(r.diff), r.diff < 0); render();
    });
  } catch (e) { b.innerHTML = esc(e.message); }
}

async function admProduk() {
  $('#view').innerHTML = backBar('Master Produk') + `<div class="card"><div class="row"><input id="aq" class="grow" placeholder="Cari…"><button class="btn sm" id="aadd">+ Produk</button></div><div id="al" class="scroll-x" style="margin-top:.5rem">Memuat…</div></div>`;
  bindBack();
  let rows = [];
  const draw = () => { const q = val('#aq').toLowerCase(); $('#al').innerHTML = `<table><tr><th>Produk</th><th>Satuan</th><th class="n">HPP</th><th class="n">Harga</th></tr>${rows.filter(p => (p.name + p.sku + p.barcode).toLowerCase().includes(q)).map(p => `<tr data-id="${p.id}" style="cursor:pointer${+p.active ? '' : ';opacity:.5'}">
    <td>${esc(p.name)}<div class="small muted">${esc(p.sku || '')} · ${esc(p.barcode || '')} · ${esc(p.category || '')}</div></td><td>${esc(p.unit)}${p.units.map(u => `<div class="small muted">${esc(u.unit)} = ${nf(u.factor)} ${esc(p.unit)} · ${short(u.price)}</div>`).join('')}</td><td class="n">${nf(p.cost)}</td><td class="n">${nf(p.price)}</td></tr>`).join('')}</table>`;
    $$('#al tr[data-id]').forEach(tr => tr.onclick = () => prodForm(rows.find(p => p.id == tr.dataset.id))); };
  const load = async () => { rows = (await api('products')).rows; draw(); };
  $('#aq').oninput = draw; $('#aadd').onclick = () => prodForm({ units: [], active: 1 });
  window._reloadProd = load; load().catch(e => $('#al').textContent = e.message);
}
function prodForm(p) {
  const cats = [...new Set(S.products.map(x => x.category).filter(Boolean))];
  const b = modal(p.id ? 'Ubah Produk' : 'Produk Baru', `
    <label>Nama produk</label><input name="name" value="${esc(p.name || '')}">
    <div class="grid2"><div><label>SKU</label><input name="sku" value="${esc(p.sku || '')}"></div><div><label>Barcode</label><div class="row"><input name="barcode" value="${esc(p.barcode || '')}"><button class="icon-btn" type="button" id="bcam">${svg('cam', 18)}</button></div></div>
      <div><label>Kategori</label><input name="category" list="cats" value="${esc(p.category || '')}"><datalist id="cats">${cats.map(c => `<option>${esc(c)}</option>`).join('')}</datalist></div>
      <div><label>Satuan dasar</label><input name="unit" value="${esc(p.unit || 'pcs')}"></div>
      <div><label>Harga pokok (HPP)</label><input name="cost" inputmode="decimal" value="${p.cost ?? ''}"></div><div><label>Harga jual</label><input name="price" inputmode="decimal" value="${p.price ?? ''}"></div>
      <div><label>Stok minimum</label><input name="min_stock" inputmode="decimal" value="${p.min_stock ?? ''}"></div></div>
    <div class="row wrap" style="margin-top:.5rem"><label class="check"><input type="checkbox" name="decimal_qty" ${+p.decimal_qty ? 'checked' : ''}> Qty desimal (kg, liter, meter)</label><label class="check"><input type="checkbox" name="active" ${+p.active ? 'checked' : ''}> Aktif</label></div>
    <h3 style="margin-top:1rem">Multi satuan</h3><p class="small muted" style="margin-top:0">Contoh: 1 dus = 24 pcs. Stok selalu dihitung dalam satuan dasar.</p>
    <div id="ulist"></div><button class="btn sec sm" id="uadd" type="button">+ Satuan</button>
    <button class="btn block" id="psv" style="margin-top:.9rem">Simpan Produk</button>`);
  const units = (p.units || []).map(u => ({ ...u }));
  const drawU = () => { $('#ulist', b).innerHTML = units.map((u, i) => `<div class="row" style="margin-bottom:.35rem"><input placeholder="Satuan" data-k="unit" data-i="${i}" value="${esc(u.unit || '')}"><input placeholder="Isi" inputmode="decimal" data-k="factor" data-i="${i}" value="${u.factor ?? ''}"><input placeholder="Harga" inputmode="decimal" data-k="price" data-i="${i}" value="${u.price ?? ''}"><input placeholder="Barcode" data-k="barcode" data-i="${i}" value="${esc(u.barcode || '')}"><button class="btn bad sm" data-rm="${i}" type="button">×</button></div>`).join('');
    $$('#ulist input', b).forEach(i => i.oninput = () => units[i.dataset.i][i.dataset.k] = i.value); $$('[data-rm]', b).forEach(x => x.onclick = () => { units.splice(+x.dataset.rm, 1); drawU(); }); };
  drawU(); $('#uadd', b).onclick = () => { units.push({}); drawU(); };
  $('#bcam', b).onclick = () => { const keep = formData(b); openScanner(code => { prodForm({ ...p, ...keep, barcode: code, units }); }); };
  $('#psv', b).onclick = e => run(e.target, async () => { await api('product_save', { ...formData(b), id: p.id, units }); closeModal(); toast('Produk tersimpan'); await loadData(); window._reloadProd && window._reloadProd(); });
}
async function admToko() {
  $('#view').innerHTML = backBar('Toko & Cabang') + `<div class="card"><button class="btn sm" id="tadd">+ Tambah Toko / Cabang</button><div id="tl" style="margin-top:.5rem">Memuat…</div></div>`;
  bindBack();
  const r = await api('stores');
  $('#tl').innerHTML = `<div class="list">${r.rows.map(s => `<div data-id="${s.id}" style="cursor:pointer"><div class="grow"><b>${esc(s.code)} · ${esc(s.name)}</b><div class="small muted">${esc(s.address || '')} ${esc(s.phone || '')}</div></div>${+s.active ? '<span class="badge ok">aktif</span>' : '<span class="badge">nonaktif</span>'}</div>`).join('')}</div>`;
  const form = s => {
    const b = modal(s.id ? 'Ubah Toko' : 'Toko Baru', `<div class="grid2"><div><label>Kode</label><input name="code" value="${esc(s.code || '')}" maxlength="6"></div><div><label>Nama</label><input name="name" value="${esc(s.name || '')}"></div></div>
      <label>Alamat</label><input name="address" value="${esc(s.address || '')}"><label>Telepon</label><input name="phone" value="${esc(s.phone || '')}">
      ${s.id ? `<label class="check" style="margin-top:.6rem"><input type="checkbox" name="active" ${+s.active ? 'checked' : ''}> Aktif</label>` : '<p class="small muted">Toko baru langsung memakai master produk pusat, tanpa mengganggu toko lain.</p>'}
      <button class="btn block" id="tsv" style="margin-top:.7rem">Simpan</button>`);
    $('#tsv', b).onclick = e => run(e.target, async () => { await api('store_save', { ...formData(b), id: s.id }); closeModal(); toast('Toko tersimpan — muat ulang untuk melihat di daftar toko'); const me = await api('me'); LS.set('me', me); S.stores = me.stores; S.allStores = me.all_stores; admToko(); });
  };
  $('#tadd').onclick = () => form({}); $$('#tl [data-id]').forEach(d => d.onclick = () => form(r.rows.find(s => s.id == d.dataset.id)));
}
async function admUser() {
  $('#view').innerHTML = backBar('User & Hak Akses') + `<div class="card"><button class="btn sm" id="uadd2">+ User</button>
    <p class="small muted">Kasir: transaksi, shift, opname · Supervisor: + stok masuk, transfer, void, laporan toko · Admin: + produk, promo, ekspor · Owner: semua toko, user, backup.</p><div id="ul" class="scroll-x">Memuat…</div></div>`;
  bindBack();
  const r = await api('users');
  $('#ul').innerHTML = `<table><tr><th>Nama</th><th>Username</th><th>Peran</th><th>Toko</th><th></th></tr>${r.rows.map(u => `<tr data-id="${u.id}" style="cursor:pointer${+u.active ? '' : ';opacity:.5'}"><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td><span class="badge">${esc(u.role)}</span></td><td>${esc(u.store || 'Semua')}</td><td>›</td></tr>`).join('')}</table>`;
  const form = u => {
    const b = modal(u.id ? 'Ubah User' : 'User Baru', `<label>Nama</label><input name="name" value="${esc(u.name || '')}"><label>Username</label><input name="username" value="${esc(u.username || '')}" autocapitalize="off">
      <div class="grid2"><div><label>Peran</label><select name="role">${Object.keys(ROLE).map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div><label>Toko</label><select name="store_id"><option value="">—</option>${S.allStores.map(s => `<option value="${s.id}" ${u.store_id == s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div><label>${u.id ? 'Password baru (kosongkan)' : 'Password'}</label><input name="password" type="password"></div><div><label>PIN otorisasi 4–6 digit${u.id ? ' (kosongkan)' : ''}</label><input name="pin" type="password" inputmode="numeric" maxlength="6"></div></div>
      <label class="check" style="margin-top:.6rem"><input type="checkbox" name="active" ${u.id ? (+u.active ? 'checked' : '') : 'checked'}> Aktif</label>
      <button class="btn block" id="usv" style="margin-top:.7rem">Simpan</button>`);
    $('#usv', b).onclick = e => run(e.target, async () => { await api('user_save', { ...formData(b), id: u.id }); closeModal(); toast('User tersimpan'); admUser(); });
  };
  $('#uadd2').onclick = () => form({}); $$('#ul tr[data-id]').forEach(t => t.onclick = () => form(r.rows.find(u => u.id == t.dataset.id)));
}
async function admBackup() {
  $('#view').innerHTML = backBar('Backup Data') + `<div class="card"><p class="small muted" style="margin-top:0">Backup otomatis dibuat setiap hari (saat aplikasi pertama dipakai hari itu), terenkripsi AES-256. Disimpan ${'30'} backup terakhir.</p>
    <button class="btn" id="bnow">Backup Sekarang</button><div id="bl" style="margin-top:.6rem">Memuat…</div></div>`;
  bindBack();
  const draw = async () => { const r = await api('backup_list'); $('#bl').innerHTML = `<div class="list">${r.rows.map(f => `<div><div class="grow">${esc(f.name)}<div class="small muted">${esc(f.time)} · ${(f.size / 1024).toFixed(0)} KB</div></div><a class="btn sec sm" href="api.php?a=backup_download&file=${encodeURIComponent(f.name)}">Unduh</a></div>`).join('') || '<p class="muted">Belum ada backup.</p>'}</div>`; };
  $('#bnow').onclick = e => run(e.target, async () => { await api('backup_now', {}); toast('Backup dibuat'); draw(); });
  draw().catch(e => $('#bl').textContent = e.message);
}
async function admAudit() {
  $('#view').innerHTML = backBar('Log Aktivitas') + '<div class="card scroll-x" id="au">Memuat…</div>'; bindBack();
  const r = await api('audit', { store: S.user.role === 'owner' ? 0 : S.storeId });
  $('#au').innerHTML = `<table><tr><th>Waktu</th><th>User</th><th>Aksi</th><th>Detail</th></tr>${r.rows.map(a => `<tr><td class="small">${esc(a.created_at.slice(5, 16))}</td><td>${esc(a.user || '')}</td><td><span class="badge ${/gagal|void/.test(a.action) ? 'bad' : ''}">${esc(a.action)}</span></td><td class="small">${esc(a.detail || '')}</td></tr>`).join('')}</table>`;
}

// =====================================================
//  PWA: service worker & install
// =====================================================
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));

boot();
