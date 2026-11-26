<?php
// =====================================================
//  SatuToko POS — REST API (JSON)
// =====================================================
ini_set('display_errors', '0');
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        if (!headers_sent()) { http_response_code(500); header('Content-Type: application/json; charset=utf-8'); }
        echo json_encode(['error' => 'PHP error: ' . $e['message'] . ' (' . basename($e['file']) . ':' . $e['line'] . ')']);
    }
});
require_once __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

if (PHP_VERSION_ID >= 70300) {
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Strict', 'secure' => !empty($_SERVER['HTTPS'])]);
} else {
    session_set_cookie_params(0, '/; samesite=Strict', null, !empty($_SERVER['HTTPS']), true);
}
session_name('SATUTOKO');
session_start();

const ROLES = ['kasir' => 1, 'supervisor' => 2, 'admin' => 3, 'owner' => 4];

function out($d) { echo json_encode($d, JSON_UNESCAPED_UNICODE); exit; }
function fail($m, $c = 400) { http_response_code($c); out(['error' => $m]); }
function body(): array { static $b = null; if ($b === null) $b = json_decode(file_get_contents('php://input'), true) ?: []; return $b; }
function in($k, $d = null) { $b = body(); return $b[$k] ?? ($_GET[$k] ?? $d); }
function now() { return date('Y-m-d H:i:s'); }
function user() { return $_SESSION['uid'] ?? null ? q1('SELECT * FROM users WHERE id=? AND active=1', [$_SESSION['uid']]) : null; }
function need($role = 'kasir') {
    $u = user();
    if (!$u) fail('Sesi berakhir, silakan login kembali', 401);
    if (ROLES[$u['role']] < ROLES[$role]) fail('Akses ditolak untuk peran ' . $u['role'], 403);
    return $u;
}
/** Toko yang boleh diakses user. Owner bebas pilih; lainnya terkunci di tokonya. */
function store_for($u, $sid = null, $allowAll = false) {
    if ($u['role'] === 'owner') {
        $sid = (int)($sid ?? in('store', 0));
        if (!$sid) { if ($allowAll) return 0; $sid = (int)qv('SELECT id FROM stores WHERE active=1 ORDER BY id LIMIT 1'); }
        return $sid;
    }
    return (int)$u['store_id'];
}
function audit($u, $action, $detail = '', $sid = null) {
    ex('INSERT INTO audit(user_id,store_id,action,detail,created_at) VALUES(?,?,?,?,?)',
        [$u['id'] ?? null, $sid ?? ($u['store_id'] ?? null), $action, is_string($detail) ? $detail : json_encode($detail, JSON_UNESCAPED_UNICODE), now()]);
}
/** Otorisasi: cari supervisor/admin/owner dengan PIN ini yang berhak atas toko tsb */
function authorize_pin($pin, $sid) {
    if (!$pin) return null;
    foreach (q("SELECT * FROM users WHERE active=1 AND role IN ('supervisor','admin','owner') AND (store_id=? OR role='owner')", [$sid]) as $s)
        if (password_verify((string)$pin, $s['pin'])) return $s;
    return null;
}

// ---------- Backup otomatis harian (terenkripsi) ----------
function make_backup($label = 'auto') {
    if (!is_dir(BACKUP_DIR)) mkdir(BACKUP_DIR, 0750, true);
    $tmp = BACKUP_DIR . '/tmp_' . bin2hex(random_bytes(4)) . '.sqlite';
    try { db()->exec('VACUUM INTO ' . db()->quote($tmp)); }
    catch (Throwable $e) { db()->exec('PRAGMA wal_checkpoint(TRUNCATE)'); copy(DB_FILE, $tmp); } // SQLite lama
    $raw = file_get_contents($tmp); unlink($tmp);
    $iv = random_bytes(16);
    $key = hash('sha256', BACKUP_KEY, true);
    $enc = openssl_encrypt(gzencode($raw, 6), 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
    $name = 'backup_' . date('Ymd_His') . "_$label.enc";
    file_put_contents(BACKUP_DIR . "/$name", 'STK1' . $iv . hash_hmac('sha256', $enc, $key, true) . $enc);
    $files = glob(BACKUP_DIR . '/backup_*.enc'); sort($files);
    while (count($files) > BACKUP_KEEP) unlink(array_shift($files));
    setting('last_backup', date('Y-m-d'));
    return $name;
}
function auto_backup() { if (setting('last_backup') !== date('Y-m-d')) { try { make_backup('auto'); } catch (Throwable $e) { error_log($e->getMessage()); } } }

// ---------- Promo engine (logika sama dengan app.js) ----------
function promo_on($p, $ts) {
    $d = date('Y-m-d H:i', $ts);
    if ($p['start_at'] && $d < str_replace('T', ' ', $p['start_at'])) return false;
    if ($p['end_at'] && $d > str_replace('T', ' ', $p['end_at'])) return false;
    if ($p['days'] && !in_array(date('N', $ts), explode(',', $p['days']))) return false;
    $h = date('H:i', $ts);
    if ($p['hour_start'] && $h < $p['hour_start']) return false;
    if ($p['hour_end'] && $h >= $p['hour_end']) return false;
    return true;
}
function active_promos($sid, $ts) {
    return array_values(array_filter(q('SELECT * FROM promos WHERE active=1 AND (store_id IS NULL OR store_id=?)', [$sid]), function ($p) use ($ts) { return promo_on($p, $ts); }));
}
function promo_match($p, $prod) {
    if ($p['scope'] === 'product') return in_array((string)$prod['id'], array_map('trim', explode(',', (string)$p['target'])));
    if ($p['scope'] === 'category') return strcasecmp(trim($p['target']), (string)$prod['category']) === 0;
    return true;
}
function calc_cart(array $items, bool $member, int $sid, int $ts, float $manualPct = 0): array {
    $promos = active_promos($sid, $ts);
    $lines = []; $sub = 0; $ld = 0; $cogs = 0;
    foreach ($items as $it) {
        $p = q1('SELECT * FROM products WHERE id=?', [(int)($it['pid'] ?? 0)]);
        if (!$p) fail('Produk tidak ditemukan (id ' . ($it['pid'] ?? '?') . ')');
        $unit = $p['unit']; $factor = 1; $price = (float)$p['price'];
        if (!empty($it['unit']) && $it['unit'] !== $p['unit']) {
            $pu = q1('SELECT * FROM product_units WHERE product_id=? AND unit=?', [$p['id'], $it['unit']]);
            if (!$pu) fail('Satuan ' . $it['unit'] . ' tidak ada untuk ' . $p['name']);
            $unit = $pu['unit']; $factor = (float)$pu['factor']; $price = (float)$pu['price'];
        }
        $qty = (float)($it['qty'] ?? 0);
        $qty = ($p['decimal_qty'] && $factor == 1) ? round($qty, 3) : floor($qty);
        if ($qty <= 0) continue;
        $gross = round($price * $qty);
        $best = 0; $pname = null;
        foreach ($promos as $pr) {
            if (!in_array($pr['type'], ['percent', 'nominal', 'bxgy'])) continue;
            if ($pr['member_only'] && !$member) continue;
            if (!promo_match($pr, $p)) continue;
            if ($pr['type'] !== 'bxgy' && $pr['min_qty'] > 0 && $qty < $pr['min_qty']) continue;
            $d = 0;
            if ($pr['type'] === 'percent') $d = $gross * $pr['value'] / 100;
            elseif ($pr['type'] === 'nominal') $d = min($gross, $pr['value'] * $qty);
            else { $g = $pr['min_qty'] + $pr['free_qty']; $d = $g > 0 ? floor($qty / $g) * $pr['free_qty'] * $price : 0; }
            if ($pr['max_disc'] > 0) $d = min($d, $pr['max_disc']);
            $d = round($d);
            if ($d > $best) { $best = $d; $pname = $pr['name']; }
        }
        $cost = round($p['cost'] * $factor * $qty, 2);
        $lines[] = ['pid' => (int)$p['id'], 'name' => $p['name'], 'unit' => $unit, 'factor' => $factor, 'qty' => $qty,
            'price' => $price, 'gross' => $gross, 'discount' => $best, 'promo' => $pname, 'total' => $gross - $best, 'cost' => $cost];
        $sub += $gross; $ld += $best; $cogs += $cost;
    }
    $after = $sub - $ld; $td = 0; $tname = null;
    foreach ($promos as $pr) {
        if (!in_array($pr['type'], ['total_percent', 'total_nominal'])) continue;
        if ($pr['member_only'] && !$member) continue;
        if ($after < $pr['min_total'] || $after <= 0) continue;
        $d = $pr['type'] === 'total_percent' ? $after * $pr['value'] / 100 : $pr['value'];
        if ($pr['max_disc'] > 0) $d = min($d, $pr['max_disc']);
        $d = round(min($d, $after));
        if ($d > $td) { $td = $d; $tname = $pr['name']; }
    }
    $md = round(($after - $td) * max(0, min(100, $manualPct)) / 100);
    $total = max(0, $after - $td - $md);
    return ['lines' => $lines, 'subtotal' => $sub, 'line_disc' => $ld, 'trx_disc' => $td, 'trx_promo' => $tname,
        'manual_disc' => $md, 'total' => $total, 'cogs' => $cogs];
}

function stock_add($sid, $pid, $qty, $type, $ref, $note, $uid, $at = null) {
    ex('INSERT OR IGNORE INTO stock(store_id,product_id,qty) VALUES(?,?,0)', [$sid, $pid]);
    ex('UPDATE stock SET qty=qty+? WHERE store_id=? AND product_id=?', [$qty, $sid, $pid]);
    ex('INSERT INTO stock_moves(store_id,product_id,qty,type,ref,note,user_id,created_at) VALUES(?,?,?,?,?,?,?,?)', [$sid, $pid, $qty, $type, $ref, $note, $uid, $at ?? now()]);
}
function sale_full($id) {
    $s = q1('SELECT s.*, st.name store_name, st.address store_address, st.phone store_phone, u.name cashier, m.name member_name, m.code member_code, m.points member_points
             FROM sales s JOIN stores st ON st.id=s.store_id LEFT JOIN users u ON u.id=s.user_id LEFT JOIN members m ON m.id=s.member_id WHERE s.id=?', [$id]);
    if (!$s) return null;
    $s['items'] = q('SELECT * FROM sale_items WHERE sale_id=?', [$id]);
    $s['payments'] = q('SELECT * FROM sale_payments WHERE sale_id=?', [$id]);
    return $s;
}
function date_range() {
    $from = in('from', date('Y-m-d')); $to = in('to', date('Y-m-d'));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) fail('Format tanggal salah');
    return [$from . ' 00:00:00', $to . ' 23:59:59', $from, $to];
}
function csv_out($name, $rows) {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $name . '"');
    $f = fopen('php://output', 'w'); fwrite($f, "\xEF\xBB\xBF");
    foreach ($rows as $r) fputcsv($f, $r, ';');
    exit;
}

// =====================================================
//  ROUTER
// =====================================================
$a = $_GET['a'] ?? '';
// Proteksi CSRF: semua request wajib header X-POS (kecuali display & download)
if (!in_array($a, ['display_get', 'export', 'backup_download']) && ($_SERVER['HTTP_X_POS'] ?? '') !== '1') fail('Request tidak sah', 400);

try {
switch ($a) {

// ---------------- AUTH ----------------
case 'login':
    $un = trim((string)in('username')); $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    ex('DELETE FROM login_fail WHERE at<?', [time() - 600]);
    if (qv('SELECT COUNT(*) FROM login_fail WHERE username=?', [$un]) >= LOGIN_MAX_FAIL) fail('Terlalu banyak percobaan. Coba lagi 10 menit.', 429);
    $u = q1('SELECT * FROM users WHERE username=? AND active=1', [$un]);
    if (!$u || !password_verify((string)in('password'), $u['pass'])) {
        ex('INSERT INTO login_fail VALUES(?,?,?)', [$un, $ip, time()]); fail('Username atau password salah', 401);
    }
    session_regenerate_id(true);
    $_SESSION['uid'] = $u['id'];
    audit($u, 'login', $ip);
    auto_backup();
    out(['ok' => 1]);

case 'logout':
    $u = user(); if ($u) audit($u, 'logout');
    session_destroy(); out(['ok' => 1]);

case 'me':
    $u = need(); auto_backup();
    $stores = $u['role'] === 'owner' ? q('SELECT * FROM stores WHERE active=1 ORDER BY id') : q('SELECT * FROM stores WHERE id=?', [$u['store_id']]);
    out(['user' => ['id' => $u['id'], 'name' => $u['name'], 'username' => $u['username'], 'role' => $u['role'], 'store_id' => $u['store_id']],
        'stores' => $stores, 'all_stores' => q('SELECT id,code,name FROM stores WHERE active=1 ORDER BY id'),
        'cfg' => ['app' => APP_NAME, 'payments' => PAYMENT_METHODS, 'disc_limit' => DISCOUNT_AUTH_LIMIT, 'point_per' => POINT_PER],
        'display_key' => ROLES[$u['role']] >= ROLES['admin'] ? setting('display_key') : null]);

case 'authorize':
    $u = need(); $sid = store_for($u);
    $s = authorize_pin(in('pin'), $sid);
    if (!$s) { audit($u, 'otorisasi_gagal', in('reason', '')); fail('PIN otorisasi salah', 403); }
    out(['ok' => 1, 'by' => $s['name']]);

// ---------------- DATA UNTUK KASIR (di-cache utk offline) ----------------
case 'bootstrap':
    $u = need(); $sid = store_for($u);
    $prods = q('SELECT p.*, COALESCE(s.qty,0) stock FROM products p LEFT JOIN stock s ON s.product_id=p.id AND s.store_id=? WHERE p.active=1 ORDER BY p.name', [$sid]);
    $units = q('SELECT * FROM product_units');
    $byP = []; foreach ($units as $x) $byP[$x['product_id']][] = $x;
    foreach ($prods as &$p) $p['units'] = $byP[$p['id']] ?? [];
    $shift = q1('SELECT * FROM shifts WHERE user_id=? AND store_id=? AND closed_at IS NULL ORDER BY id DESC LIMIT 1', [$u['id'], $sid]);
    out(['store_id' => $sid, 'products' => $prods,
        'promos' => q('SELECT * FROM promos WHERE active=1 AND (store_id IS NULL OR store_id=?)', [$sid]),
        'members' => q('SELECT id,code,name,phone,points FROM members ORDER BY id DESC LIMIT 2000'),
        'shift' => $shift, 'at' => now()]);

case 'calc':
    $u = need(); $sid = store_for($u);
    out(calc_cart(in('items', []), (bool)in('member_id'), $sid, time(), (float)in('manual_pct', 0)));

// ---------------- TRANSAKSI ----------------
case 'sale_create':
    $u = need(); $sid = store_for($u);
    $uuid = (string)in('client_uuid');
    if (!$uuid) fail('client_uuid wajib');
    if ($ex = qv('SELECT id FROM sales WHERE client_uuid=?', [$uuid])) out(['sale' => sale_full($ex), 'duplicate' => 1]);
    $offline = (int)!!in('offline');
    $ts = time();
    if ($offline && ($c = strtotime((string)in('created_at')))) $ts = min($c, time());
    // Shift wajib dibuka
    $shift = q1('SELECT * FROM shifts WHERE id=? AND user_id=? AND store_id=?', [(int)in('shift_id'), $u['id'], $sid])
        ?: q1('SELECT * FROM shifts WHERE user_id=? AND store_id=? AND closed_at IS NULL ORDER BY id DESC LIMIT 1', [$u['id'], $sid]);
    if (!$shift) fail('Buka shift terlebih dahulu');
    $memberId = (int)in('member_id') ?: null;
    if ($memberId && !qv('SELECT id FROM members WHERE id=?', [$memberId])) $memberId = null;
    $mp = (float)in('manual_pct', 0); $authBy = null;
    if ($mp > DISCOUNT_AUTH_LIMIT) {
        $sv = authorize_pin(in('auth_pin'), $sid);
        if (!$sv) fail('Diskon manual > ' . DISCOUNT_AUTH_LIMIT . '% butuh otorisasi PIN supervisor', 403);
        $authBy = $sv['id'];
    }
    $c = calc_cart(in('items', []), (bool)$memberId, $sid, $ts, $mp);
    if (!$c['lines']) fail('Keranjang kosong');
    $pays = array_values(array_filter(in('payments', []), function ($p) { return (float)($p['amount'] ?? 0) > 0 && in_array($p['method'] ?? '', PAYMENT_METHODS); }));
    $paid = array_sum(array_map(function ($p) { return (float)$p['amount']; }, $pays));
    $nonCash = array_sum(array_map(function ($p) { return $p['method'] !== 'Tunai' ? (float)$p['amount'] : 0; }, $pays));
    if (!$offline && $paid + 0.001 < $c['total']) fail('Pembayaran kurang ' . number_format($c['total'] - $paid, 0, ',', '.'));
    if (!$offline && $nonCash > $c['total'] + 0.001) fail('Pembayaran non-tunai melebihi total');
    // Cek stok (online). Transaksi offline tetap diterima walau stok minus (dicatat).
    if (!$offline) {
        $need = []; foreach ($c['lines'] as $l) $need[$l['pid']] = ($need[$l['pid']] ?? 0) + $l['qty'] * $l['factor'];
        foreach ($need as $pid => $n) {
            $have = (float)qv('SELECT qty FROM stock WHERE store_id=? AND product_id=?', [$sid, $pid]);
            if ($have + 1e-9 < $n) fail('Stok ' . qv('SELECT name FROM products WHERE id=?', [$pid]) . ' tidak cukup (sisa ' . $have . ')');
        }
    }
    db()->exec('BEGIN IMMEDIATE');
    $at = date('Y-m-d H:i:s', $ts);
    $code = qv('SELECT code FROM stores WHERE id=?', [$sid]) ?: $sid;
    $seq = (int)qv("SELECT COUNT(*) FROM sales WHERE store_id=? AND substr(created_at,1,10)=?", [$sid, date('Y-m-d', $ts)]) + 1;
    do { $inv = sprintf('%s-%s-%04d', $code, date('ymd', $ts), $seq++); } while (qv('SELECT 1 FROM sales WHERE invoice=?', [$inv]));
    $points = $memberId ? (int)floor($c['total'] / POINT_PER) : 0;
    $id = ex('INSERT INTO sales(invoice,client_uuid,store_id,user_id,shift_id,member_id,subtotal,line_disc,trx_disc,manual_disc,total,paid,change_amt,cogs,points,offline,authorized_by,created_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [$inv, $uuid, $sid, $u['id'], $shift['id'], $memberId, $c['subtotal'], $c['line_disc'], $c['trx_disc'], $c['manual_disc'], $c['total'], $paid, max(0, $paid - $c['total']), $c['cogs'], $points, $offline, $authBy, $at]);
    foreach ($c['lines'] as $l) {
        ex('INSERT INTO sale_items(sale_id,product_id,name,unit,factor,qty,price,discount,promo,total,cost) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            [$id, $l['pid'], $l['name'], $l['unit'], $l['factor'], $l['qty'], $l['price'], $l['discount'], $l['promo'], $l['total'], $l['cost']]);
        stock_add($sid, $l['pid'], -$l['qty'] * $l['factor'], 'jual', $inv, '', $u['id'], $at);
    }
    foreach ($pays as $p) ex('INSERT INTO sale_payments(sale_id,method,amount,ref) VALUES(?,?,?,?)', [$id, $p['method'], (float)$p['amount'], substr((string)($p['ref'] ?? ''), 0, 60)]);
    if ($memberId) ex('UPDATE members SET points=points+?, total_spent=total_spent+? WHERE id=?', [$points, $c['total'], $memberId]);
    if ($authBy) audit($u, 'diskon_manual', "$inv {$mp}% disetujui user#$authBy", $sid);
    db()->exec('COMMIT');
    out(['sale' => sale_full($id), 'calc' => $c]);

case 'sales_list':
    $u = need('supervisor'); $sid = store_for($u, null, true);
    [$f, $t] = date_range();
    $w = $sid ? 'AND s.store_id=' . (int)$sid : '';
    out(['rows' => q("SELECT s.id,s.invoice,s.created_at,s.total,s.status,s.offline,st.name store,u.name cashier,m.name member
        FROM sales s JOIN stores st ON st.id=s.store_id LEFT JOIN users u ON u.id=s.user_id LEFT JOIN members m ON m.id=s.member_id
        WHERE s.created_at BETWEEN ? AND ? $w ORDER BY s.id DESC LIMIT 500", [$f, $t])]);

case 'sale_detail':
    $u = need(); $s = sale_full((int)in('id'));
    if (!$s || ($u['role'] !== 'owner' && $s['store_id'] != $u['store_id'])) fail('Tidak ditemukan', 404);
    out(['sale' => $s]);

case 'sale_void':
    $u = need(); $s = q1('SELECT * FROM sales WHERE id=?', [(int)in('id')]);
    if (!$s || ($u['role'] !== 'owner' && $s['store_id'] != $u['store_id'])) fail('Tidak ditemukan', 404);
    if ($s['status'] === 'void') fail('Transaksi sudah dibatalkan');
    $sv = authorize_pin(in('auth_pin'), $s['store_id']);
    if (!$sv) { audit($u, 'void_gagal', $s['invoice'], $s['store_id']); fail('PIN otorisasi salah', 403); }
    $reason = trim((string)in('reason')); if (!$reason) fail('Alasan pembatalan wajib diisi');
    db()->exec('BEGIN IMMEDIATE');
    foreach (q('SELECT * FROM sale_items WHERE sale_id=?', [$s['id']]) as $it)
        stock_add($s['store_id'], $it['product_id'], $it['qty'] * $it['factor'], 'void', $s['invoice'], $reason, $u['id']);
    if ($s['member_id']) ex('UPDATE members SET points=MAX(0,points-?), total_spent=total_spent-? WHERE id=?', [$s['points'], $s['total'], $s['member_id']]);
    ex("UPDATE sales SET status='void', void_by=?, void_reason=?, void_at=? WHERE id=?", [$sv['id'], $reason, now(), $s['id']]);
    audit($u, 'void', "{$s['invoice']} oleh {$sv['name']}: $reason", $s['store_id']);
    db()->exec('COMMIT');
    out(['ok' => 1]);

// ---------------- SHIFT ----------------
case 'shift_open':
    $u = need(); $sid = store_for($u);
    if ($s = q1('SELECT * FROM shifts WHERE user_id=? AND store_id=? AND closed_at IS NULL', [$u['id'], $sid])) out(['shift' => $s]);
    $id = ex('INSERT INTO shifts(store_id,user_id,opened_at,opening_cash) VALUES(?,?,?,?)', [$sid, $u['id'], now(), (float)in('opening_cash', 0)]);
    audit($u, 'buka_shift', 'Modal ' . in('opening_cash', 0), $sid);
    out(['shift' => q1('SELECT * FROM shifts WHERE id=?', [$id])]);

case 'shift_summary':
case 'shift_close':
    $u = need(); $sid = store_for($u);
    $s = q1('SELECT * FROM shifts WHERE user_id=? AND store_id=? AND closed_at IS NULL ORDER BY id DESC LIMIT 1', [$u['id'], $sid]);
    if (!$s) fail('Tidak ada shift terbuka');
    $pays = q("SELECT p.method, SUM(p.amount) amt FROM sale_payments p JOIN sales s ON s.id=p.sale_id WHERE s.shift_id=? AND s.status='paid' GROUP BY p.method", [$s['id']]);
    $agg = q1("SELECT COUNT(*) trx, COALESCE(SUM(total),0) omzet, COALESCE(SUM(change_amt),0) chg FROM sales WHERE shift_id=? AND status='paid'", [$s['id']]);
    $voids = (int)qv("SELECT COUNT(*) FROM sales WHERE shift_id=? AND status='void'", [$s['id']]);
    $cash = 0; foreach ($pays as $p) if ($p['method'] === 'Tunai') $cash = (float)$p['amt'];
    $expected = $s['opening_cash'] + $cash - $agg['chg'];
    $sum = ['shift' => $s, 'payments' => $pays, 'trx' => (int)$agg['trx'], 'omzet' => (float)$agg['omzet'], 'voids' => $voids, 'expected_cash' => $expected];
    if ($a === 'shift_close') {
        $closing = (float)in('closing_cash', 0);
        ex('UPDATE shifts SET closed_at=?, closing_cash=?, expected_cash=?, note=? WHERE id=?', [now(), $closing, $expected, (string)in('note', ''), $s['id']]);
        audit($u, 'tutup_shift', "Harus $expected, fisik $closing, selisih " . ($closing - $expected), $sid);
        $sum['closing_cash'] = $closing; $sum['diff'] = $closing - $expected;
    }
    out($sum);

case 'shift_list':
    $u = need('supervisor'); $sid = store_for($u, null, true);
    out(['rows' => q('SELECT sh.*, u.name cashier, st.name store FROM shifts sh JOIN users u ON u.id=sh.user_id JOIN stores st ON st.id=sh.store_id '
        . ($sid ? 'WHERE sh.store_id=' . (int)$sid : '') . ' ORDER BY sh.id DESC LIMIT 100')]);

// ---------------- STOK ----------------
case 'stock_list':
    $u = need(); $sid = store_for($u);
    out(['rows' => q('SELECT p.id,p.sku,p.barcode,p.name,p.category,p.unit,p.min_stock,p.cost,COALESCE(s.qty,0) qty FROM products p
        LEFT JOIN stock s ON s.product_id=p.id AND s.store_id=? WHERE p.active=1 ORDER BY p.name', [$sid])]);

case 'stock_other': // Cek stok di semua cabang (kolaborasi antar toko)
    need();
    out(['rows' => q('SELECT st.id, st.name, COALESCE(s.qty,0) qty FROM stores st LEFT JOIN stock s ON s.store_id=st.id AND s.product_id=? WHERE st.active=1', [(int)in('pid')])]);

case 'stock_in':
    $u = need('supervisor'); $sid = store_for($u);
    $p = q1('SELECT * FROM products WHERE id=?', [(int)in('pid')]); if (!$p) fail('Produk tidak ditemukan');
    $factor = 1; if (in('unit') && in('unit') !== $p['unit']) $factor = (float)qv('SELECT factor FROM product_units WHERE product_id=? AND unit=?', [$p['id'], in('unit')]) ?: 1;
    $qty = (float)in('qty') * $factor; if ($qty <= 0) fail('Jumlah harus > 0');
    db()->exec('BEGIN IMMEDIATE');
    stock_add($sid, $p['id'], $qty, 'masuk', (string)in('ref', ''), (string)in('note', ''), $u['id']);
    if ((float)in('cost') > 0) ex('UPDATE products SET cost=? WHERE id=?', [(float)in('cost') / $factor, $p['id']]);
    db()->exec('COMMIT');
    out(['ok' => 1]);

case 'opname':
    $u = need(); $sid = store_for($u);
    $pid = (int)in('pid'); $counted = (float)in('counted');
    if (!qv('SELECT id FROM products WHERE id=?', [$pid])) fail('Produk tidak ditemukan');
    db()->exec('BEGIN IMMEDIATE');
    $sys = (float)qv('SELECT qty FROM stock WHERE store_id=? AND product_id=?', [$sid, $pid]);
    $diff = round($counted - $sys, 3);
    if ($diff != 0) stock_add($sid, $pid, $diff, 'opname', 'SO-' . date('ymd'), 'Sistem ' . $sys . ' → fisik ' . $counted . ' ' . in('note', ''), $u['id']);
    db()->exec('COMMIT');
    out(['ok' => 1, 'system' => $sys, 'counted' => $counted, 'diff' => $diff]);

case 'transfer':
    $u = need('supervisor'); $from = store_for($u); $to = (int)in('to');
    if ($to === $from || !qv('SELECT id FROM stores WHERE id=?', [$to])) fail('Toko tujuan tidak valid');
    $pid = (int)in('pid'); $qty = (float)in('qty'); if ($qty <= 0) fail('Jumlah harus > 0');
    $have = (float)qv('SELECT qty FROM stock WHERE store_id=? AND product_id=?', [$from, $pid]);
    if ($have < $qty) fail("Stok tidak cukup (sisa $have)");
    $ref = 'TRF-' . date('ymdHis');
    db()->exec('BEGIN IMMEDIATE');
    stock_add($from, $pid, -$qty, 'transfer_keluar', $ref, 'Ke toko #' . $to . ' ' . in('note', ''), $u['id']);
    stock_add($to, $pid, $qty, 'transfer_masuk', $ref, 'Dari toko #' . $from . ' ' . in('note', ''), $u['id']);
    db()->exec('COMMIT');
    audit($u, 'transfer', "$ref produk#$pid qty $qty ke toko#$to", $from);
    out(['ok' => 1, 'ref' => $ref]);

case 'stock_moves':
    $u = need(); $sid = store_for($u);
    $w = (int)in('pid') ? ' AND m.product_id=' . (int)in('pid') : '';
    out(['rows' => q("SELECT m.*, p.name, p.unit, u.name user FROM stock_moves m JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.user_id
        WHERE m.store_id=? $w ORDER BY m.id DESC LIMIT 300", [$sid])]);

// ---------------- PRODUK (data terpusat) ----------------
case 'products':
    need('admin');
    $rows = q('SELECT * FROM products ORDER BY active DESC, name');
    $units = q('SELECT * FROM product_units'); $byP = [];
    foreach ($units as $x) $byP[$x['product_id']][] = $x;
    foreach ($rows as &$r) $r['units'] = $byP[$r['id']] ?? [];
    out(['rows' => $rows]);

case 'product_save':
    $u = need('admin'); $d = body();
    if (!trim($d['name'] ?? '')) fail('Nama produk wajib');
    $f = [trim($d['sku'] ?? ''), trim($d['barcode'] ?? ''), trim($d['name']), trim($d['category'] ?? ''), trim($d['unit'] ?? 'pcs') ?: 'pcs',
        (float)($d['cost'] ?? 0), (float)($d['price'] ?? 0), (float)($d['min_stock'] ?? 0), (int)!empty($d['decimal_qty']), (int)($d['active'] ?? 1)];
    if ($f[1] && qv('SELECT id FROM products WHERE barcode=? AND id<>?', [$f[1], (int)($d['id'] ?? 0)])) fail('Barcode sudah dipakai produk lain');
    db()->exec('BEGIN IMMEDIATE');
    if (!empty($d['id'])) { $id = (int)$d['id']; ex('UPDATE products SET sku=?,barcode=?,name=?,category=?,unit=?,cost=?,price=?,min_stock=?,decimal_qty=?,active=? WHERE id=?', array_merge($f, [$id])); }
    else $id = ex('INSERT INTO products(sku,barcode,name,category,unit,cost,price,min_stock,decimal_qty,active) VALUES(?,?,?,?,?,?,?,?,?,?)', $f);
    ex('DELETE FROM product_units WHERE product_id=?', [$id]);
    foreach (($d['units'] ?? []) as $x) if (trim($x['unit'] ?? '') && (float)($x['factor'] ?? 0) > 0)
        ex('INSERT INTO product_units(product_id,unit,factor,price,barcode) VALUES(?,?,?,?,?)', [$id, trim($x['unit']), (float)$x['factor'], (float)($x['price'] ?? 0), trim($x['barcode'] ?? '')]);
    db()->exec('COMMIT');
    audit($u, 'produk_simpan', $f[2]);
    out(['ok' => 1, 'id' => $id]);

// ---------------- MEMBER ----------------
case 'members':
    need(); $s = '%' . in('q', '') . '%';
    out(['rows' => q('SELECT * FROM members WHERE code LIKE ? OR name LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 200', [$s, $s, $s])]);

case 'member_save':
    $u = need(); $d = body();
    if (!trim($d['name'] ?? '')) fail('Nama member wajib');
    if (!empty($d['id'])) {
        ex('UPDATE members SET name=?,phone=?,email=? WHERE id=?', [trim($d['name']), trim($d['phone'] ?? ''), trim($d['email'] ?? ''), (int)$d['id']]);
        $id = (int)$d['id'];
    } else {
        if ($d['phone'] ?? '') if ($x = qv('SELECT id FROM members WHERE phone=?', [trim($d['phone'])])) fail('No. HP sudah terdaftar');
        $code = 'M' . str_pad((string)((int)qv('SELECT COALESCE(MAX(id),0) FROM members') + 1), 4, '0', STR_PAD_LEFT);
        $id = ex('INSERT INTO members(code,name,phone,email) VALUES(?,?,?,?)', [$code, trim($d['name']), trim($d['phone'] ?? ''), trim($d['email'] ?? '')]);
    }
    out(['member' => q1('SELECT * FROM members WHERE id=?', [$id])]);

// ---------------- PROMO ----------------
case 'promos':
    $u = need('admin');
    $rows = q('SELECT p.*, s.name store FROM promos p LEFT JOIN stores s ON s.id=p.store_id ORDER BY p.id DESC');
    foreach ($rows as &$r) $r['running'] = $r['active'] && promo_on($r, time());
    out(['rows' => $rows]);

case 'promo_save':
    $u = need('admin'); $d = body();
    if (!trim($d['name'] ?? '')) fail('Nama promo wajib');
    if (!in_array($d['type'] ?? '', ['percent', 'nominal', 'bxgy', 'total_percent', 'total_nominal'])) fail('Jenis promo tidak valid');
    $sid = $u['role'] === 'owner' ? ((int)($d['store_id'] ?? 0) ?: null) : (int)$u['store_id'];
    $f = [trim($d['name']), $d['type'], $d['scope'] ?? 'all', trim((string)($d['target'] ?? '')), (float)($d['value'] ?? 0), (float)($d['min_qty'] ?? 0),
        (float)($d['free_qty'] ?? 0), (float)($d['min_total'] ?? 0), (float)($d['max_disc'] ?? 0), (int)!empty($d['member_only']), $sid,
        ($d['start_at'] ?? '') ?: null, ($d['end_at'] ?? '') ?: null, $d['days'] ?? '', $d['hour_start'] ?? '', $d['hour_end'] ?? '', (int)($d['active'] ?? 1)];
    $cols = 'name=?,type=?,scope=?,target=?,value=?,min_qty=?,free_qty=?,min_total=?,max_disc=?,member_only=?,store_id=?,start_at=?,end_at=?,days=?,hour_start=?,hour_end=?,active=?';
    if (!empty($d['id'])) ex("UPDATE promos SET $cols WHERE id=?", array_merge($f, [(int)$d['id']]));
    else ex('INSERT INTO promos(name,type,scope,target,value,min_qty,free_qty,min_total,max_disc,member_only,store_id,start_at,end_at,days,hour_start,hour_end,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', $f);
    audit($u, 'promo_simpan', $f[0]);
    out(['ok' => 1]);

case 'promo_delete':
    $u = need('admin'); ex('DELETE FROM promos WHERE id=?', [(int)in('id')]); audit($u, 'promo_hapus', in('id')); out(['ok' => 1]);

// ---------------- LIVE DISPLAY PANEL ----------------
case 'display_push':
    $u = need(); $sid = store_for($u);
    ex('INSERT OR REPLACE INTO display_state(store_id,user_id,data,updated_at) VALUES(?,?,?,?)',
        [$sid, $u['id'], json_encode(in('data', []), JSON_UNESCAPED_UNICODE), time()]);
    out(['ok' => 1]);

case 'display_get': // dipakai layar pelanggan / TV, pakai kunci display (tanpa login)
    if (!hash_equals((string)setting('display_key'), (string)($_GET['key'] ?? ''))) fail('Kunci display salah', 403);
    $sid = (int)($_GET['store'] ?? 1);
    $st = q1('SELECT name,address FROM stores WHERE id=?', [$sid]);
    $ds = q1('SELECT * FROM display_state WHERE store_id=?', [$sid]);
    $promos = array_map(function ($p) { return ['name' => $p['name'], 'member_only' => $p['member_only']]; }, active_promos($sid, time()));
    out(['store' => $st, 'state' => $ds ? json_decode($ds['data'], true) : null, 'updated' => $ds['updated_at'] ?? 0, 'promos' => $promos, 'now' => time()]);

// ---------------- LAPORAN & ANALISA ----------------
case 'report':
    $u = need('supervisor'); $sid = store_for($u, null, true);
    [$f, $t, $fd, $td] = date_range();
    $w = "s.status='paid' AND s.created_at BETWEEN ? AND ?" . ($sid ? ' AND s.store_id=' . (int)$sid : '');
    $P = [$f, $t];
    $sum = q1("SELECT COUNT(*) trx, COALESCE(SUM(total),0) omzet, COALESCE(SUM(cogs),0) cogs, COALESCE(SUM(line_disc+trx_disc+manual_disc),0) disc,
        COALESCE(SUM(CASE WHEN member_id IS NOT NULL THEN total END),0) member_omzet FROM sales s WHERE $w", $P);
    $sum['profit'] = $sum['omzet'] - $sum['cogs'];
    $sum['avg'] = $sum['trx'] ? $sum['omzet'] / $sum['trx'] : 0;
    $sum['voids'] = (int)qv("SELECT COUNT(*) FROM sales s WHERE s.status='void' AND s.created_at BETWEEN ? AND ?" . ($sid ? ' AND s.store_id=' . (int)$sid : ''), $P);
    // periode sebelumnya (panjang sama) untuk tren
    $days = (strtotime($td) - strtotime($fd)) / 86400 + 1;
    $pf = date('Y-m-d 00:00:00', strtotime($fd) - $days * 86400); $pt = date('Y-m-d 23:59:59', strtotime($fd) - 86400);
    $wPrev = "s.status='paid' AND s.created_at BETWEEN ? AND ?" . ($sid ? ' AND s.store_id=' . (int)$sid : '');
    $prev = q1("SELECT COUNT(*) trx, COALESCE(SUM(total),0) omzet FROM sales s WHERE $wPrev", [$pf, $pt]);
    $prevProd = []; foreach (q("SELECT i.product_id, SUM(i.qty*i.factor) q FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE $wPrev GROUP BY i.product_id", [$pf, $pt]) as $r) $prevProd[$r['product_id']] = (float)$r['q'];
    $top = q("SELECT i.product_id, p.name, p.unit, p.category, SUM(i.qty*i.factor) qty, SUM(i.total) omzet, SUM(i.total-i.cost) profit
        FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN products p ON p.id=i.product_id WHERE $w GROUP BY i.product_id ORDER BY omzet DESC LIMIT 15", $P);
    foreach ($top as &$x) { $pv = $prevProd[$x['product_id']] ?? 0; $x['prev_qty'] = $pv; $x['growth'] = $pv ? round(($x['qty'] - $pv) / $pv * 100, 1) : null; }
    unset($x);
    out([
        'range' => [$fd, $td], 'summary' => $sum, 'prev' => $prev,
        'daily' => q("SELECT substr(created_at,1,10) d, COUNT(*) trx, SUM(total) omzet FROM sales s WHERE $w GROUP BY d ORDER BY d", $P),
        'hourly' => q("SELECT CAST(substr(created_at,12,2) AS INTEGER) h, COUNT(*) trx, SUM(total) omzet FROM sales s WHERE $w GROUP BY h ORDER BY h", $P),
        'stores' => q("SELECT st.name, COUNT(s.id) trx, COALESCE(SUM(s.total),0) omzet, COALESCE(SUM(s.total-s.cogs),0) profit FROM stores st
            LEFT JOIN sales s ON s.store_id=st.id AND s.status='paid' AND s.created_at BETWEEN ? AND ? WHERE st.active=1 " . ($sid ? 'AND st.id=' . (int)$sid : '') . ' GROUP BY st.id ORDER BY omzet DESC', $P),
        'products' => $top,
        'categories' => q("SELECT COALESCE(p.category,'-') name, SUM(i.total) omzet FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN products p ON p.id=i.product_id WHERE $w GROUP BY p.category ORDER BY omzet DESC", $P),
        'payments' => q("SELECT p.method name, SUM(p.amount) amt, COUNT(*) n FROM sale_payments p JOIN sales s ON s.id=p.sale_id WHERE $w GROUP BY p.method ORDER BY amt DESC", $P),
        'cashiers' => q("SELECT u.name, COUNT(*) trx, SUM(s.total) omzet FROM sales s JOIN users u ON u.id=s.user_id WHERE $w GROUP BY s.user_id ORDER BY omzet DESC", $P),
        'members' => q("SELECT m.code, m.name, COUNT(*) trx, SUM(s.total) omzet, m.points FROM sales s JOIN members m ON m.id=s.member_id WHERE $w GROUP BY s.member_id ORDER BY omzet DESC LIMIT 10", $P),
        'new_members' => (int)qv('SELECT COUNT(*) FROM members WHERE created_at BETWEEN ? AND ?', $P),
        'low_stock' => q('SELECT p.name, p.unit, p.min_stock, COALESCE(s.qty,0) qty, st.name store FROM products p CROSS JOIN stores st
            LEFT JOIN stock s ON s.product_id=p.id AND s.store_id=st.id WHERE p.active=1 AND st.active=1 ' . ($sid ? 'AND st.id=' . (int)$sid : '') . ' AND COALESCE(s.qty,0)<=p.min_stock ORDER BY qty LIMIT 50'),
    ]);

case 'export': // CSV untuk integrasi sistem akuntansi
    $u = need('admin'); $sid = store_for($u, null, true);
    [$f, $t, $fd, $td] = date_range(); $type = $_GET['type'] ?? 'sales';
    $w = "s.created_at BETWEEN ? AND ?" . ($sid ? ' AND s.store_id=' . (int)$sid : '');
    if ($type === 'items') {
        $rows = [['Tanggal', 'Invoice', 'Toko', 'Status', 'SKU', 'Produk', 'Satuan', 'Qty', 'Harga', 'Diskon', 'Promo', 'Total', 'HPP']];
        foreach (q("SELECT s.created_at,s.invoice,st.name store,s.status,p.sku,i.name,i.unit,i.qty,i.price,i.discount,i.promo,i.total,i.cost FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN stores st ON st.id=s.store_id JOIN products p ON p.id=i.product_id WHERE $w ORDER BY s.id", [$f, $t]) as $r) $rows[] = array_values($r);
        csv_out("item_penjualan_{$fd}_{$td}.csv", $rows);
    }
    if ($type === 'journal') { // Jurnal umum siap impor (Accurate/Jurnal.id/Zahir: sesuaikan kode akun)
        $rows = [['Tanggal', 'No Bukti', 'Toko', 'Akun', 'Keterangan', 'Debit', 'Kredit']];
        foreach (q("SELECT s.*, st.name store FROM sales s JOIN stores st ON st.id=s.store_id WHERE $w AND s.status='paid' ORDER BY s.id", [$f, $t]) as $s) {
            $d = substr($s['created_at'], 0, 10);
            foreach (q('SELECT method, SUM(amount) amt FROM sale_payments WHERE sale_id=? GROUP BY method', [$s['id']]) as $p) {
                $amt = $p['method'] === 'Tunai' ? $p['amt'] - $s['change_amt'] : $p['amt'];
                if ($amt > 0) $rows[] = [$d, $s['invoice'], $s['store'], $p['method'] === 'Tunai' ? 'Kas' : 'Bank/Piutang ' . $p['method'], 'Penerimaan penjualan', $amt, 0];
            }
            $disc = $s['line_disc'] + $s['trx_disc'] + $s['manual_disc'];
            if ($disc > 0) $rows[] = [$d, $s['invoice'], $s['store'], 'Potongan Penjualan', 'Diskon/promo', $disc, 0];
            $rows[] = [$d, $s['invoice'], $s['store'], 'Penjualan', 'Penjualan barang', 0, $s['subtotal']];
            if ($s['cogs'] > 0) { $rows[] = [$d, $s['invoice'], $s['store'], 'HPP', 'Harga pokok', $s['cogs'], 0]; $rows[] = [$d, $s['invoice'], $s['store'], 'Persediaan', 'Harga pokok', 0, $s['cogs']]; }
        }
        csv_out("jurnal_{$fd}_{$td}.csv", $rows);
    }
    $rows = [array_merge(['Tanggal', 'Invoice', 'Toko', 'Kasir', 'Member', 'Status', 'Subtotal', 'Diskon', 'Total', 'HPP', 'Laba Kotor'], PAYMENT_METHODS, ['Offline'])];
    foreach (q("SELECT s.*, st.name store, u.name cashier, m.name member FROM sales s JOIN stores st ON st.id=s.store_id LEFT JOIN users u ON u.id=s.user_id LEFT JOIN members m ON m.id=s.member_id WHERE $w ORDER BY s.id", [$f, $t]) as $s) {
        $pm = []; foreach (q('SELECT method, SUM(amount) a FROM sale_payments WHERE sale_id=? GROUP BY method', [$s['id']]) as $p) $pm[$p['method']] = $p['a'];
        if (isset($pm['Tunai'])) $pm['Tunai'] -= $s['change_amt'];
        $rows[] = array_merge([$s['created_at'], $s['invoice'], $s['store'], $s['cashier'], $s['member'], $s['status'], $s['subtotal'], $s['line_disc'] + $s['trx_disc'] + $s['manual_disc'],
            $s['total'], $s['cogs'], $s['total'] - $s['cogs']], array_map(function ($m) use ($pm) { return $pm[$m] ?? 0; }, PAYMENT_METHODS), [$s['offline'] ? 'Ya' : '']);
    }
    csv_out("penjualan_{$fd}_{$td}.csv", $rows);

// ---------------- TOKO & USER (owner) ----------------
case 'stores':
    need('owner'); out(['rows' => q('SELECT * FROM stores ORDER BY id')]);

case 'store_save':
    $u = need('owner'); $d = body();
    if (!trim($d['name'] ?? '') || !trim($d['code'] ?? '')) fail('Kode & nama toko wajib');
    if (!empty($d['id'])) ex('UPDATE stores SET code=?,name=?,address=?,phone=?,active=? WHERE id=?', [strtoupper(trim($d['code'])), trim($d['name']), $d['address'] ?? '', $d['phone'] ?? '', (int)($d['active'] ?? 1), (int)$d['id']]);
    else {
        db()->exec('BEGIN IMMEDIATE');
        $id = ex('INSERT INTO stores(code,name,address,phone) VALUES(?,?,?,?)', [strtoupper(trim($d['code'])), trim($d['name']), $d['address'] ?? '', $d['phone'] ?? '']);
        ex('INSERT INTO stock(store_id,product_id,qty) SELECT ?, id, 0 FROM products', [$id]); // langsung siap pakai
        db()->exec('COMMIT');
    }
    audit($u, 'toko_simpan', $d['name']);
    out(['ok' => 1]);

case 'users':
    need('owner'); out(['rows' => q('SELECT u.id,u.name,u.username,u.role,u.store_id,u.active,s.name store FROM users u LEFT JOIN stores s ON s.id=u.store_id ORDER BY u.id')]);

case 'user_save':
    $u = need('owner'); $d = body();
    if (!trim($d['name'] ?? '') || !trim($d['username'] ?? '')) fail('Nama & username wajib');
    if (!isset(ROLES[$d['role'] ?? ''])) fail('Peran tidak valid');
    $sid = $d['role'] === 'owner' ? null : ((int)($d['store_id'] ?? 0) ?: fail('Pilih toko untuk user ini'));
    if (qv('SELECT id FROM users WHERE username=? AND id<>?', [trim($d['username']), (int)($d['id'] ?? 0)])) fail('Username sudah dipakai');
    if (!empty($d['pin']) && !preg_match('/^\d{4,6}$/', $d['pin'])) fail('PIN harus 4–6 digit angka');
    if (!empty($d['id'])) {
        $id = (int)$d['id'];
        if ($id == $u['id'] && empty($d['active'])) fail('Tidak bisa menonaktifkan akun sendiri');
        ex('UPDATE users SET name=?,username=?,role=?,store_id=?,active=? WHERE id=?', [trim($d['name']), trim($d['username']), $d['role'], $sid, (int)!empty($d['active']), $id]);
    } else {
        if (strlen($d['password'] ?? '') < 6) fail('Password minimal 6 karakter');
        if (empty($d['pin'])) fail('PIN wajib untuk user baru');
        $id = ex('INSERT INTO users(name,username,role,store_id,pass,pin) VALUES(?,?,?,?,?,?)', [trim($d['name']), trim($d['username']), $d['role'], $sid, '', '']);
    }
    if (!empty($d['password'])) { if (strlen($d['password']) < 6) fail('Password minimal 6 karakter'); ex('UPDATE users SET pass=? WHERE id=?', [password_hash($d['password'], PASSWORD_DEFAULT), $id]); }
    if (!empty($d['pin'])) ex('UPDATE users SET pin=? WHERE id=?', [password_hash($d['pin'], PASSWORD_DEFAULT), $id]);
    audit($u, 'user_simpan', $d['username']);
    out(['ok' => 1]);

case 'change_password':
    $u = need();
    if (!password_verify((string)in('old'), $u['pass'])) fail('Password lama salah');
    if (strlen((string)in('new')) < 6) fail('Password baru minimal 6 karakter');
    ex('UPDATE users SET pass=? WHERE id=?', [password_hash((string)in('new'), PASSWORD_DEFAULT), $u['id']]);
    audit($u, 'ganti_password'); out(['ok' => 1]);

// ---------------- BACKUP & AUDIT (owner) ----------------
case 'backup_now':
    $u = need('owner'); $n = make_backup('manual'); audit($u, 'backup', $n); out(['ok' => 1, 'file' => $n]);

case 'backup_list':
    need('owner');
    $files = glob(BACKUP_DIR . '/backup_*.enc') ?: []; rsort($files);
    out(['rows' => array_map(function ($f) { return ['name' => basename($f), 'size' => filesize($f), 'time' => date('Y-m-d H:i', filemtime($f))]; }, $files),
        'display_key' => setting('display_key')]);

case 'backup_download':
    $u = need('owner'); $n = basename((string)($_GET['file'] ?? ''));
    $p = BACKUP_DIR . '/' . $n;
    if (!preg_match('/^backup_[\w]+\.enc$/', $n) || !is_file($p)) fail('File tidak ada', 404);
    audit($u, 'backup_unduh', $n);
    header('Content-Type: application/octet-stream'); header('Content-Disposition: attachment; filename="' . $n . '"');
    readfile($p); exit;

case 'audit':
    $u = need('admin'); $sid = store_for($u, null, true);
    out(['rows' => q('SELECT a.*, u.name user FROM audit a LEFT JOIN users u ON u.id=a.user_id ' . ($sid ? 'WHERE a.store_id=' . (int)$sid : '') . ' ORDER BY a.id DESC LIMIT 300')]);

default:
    fail('Aksi tidak dikenal', 404);
}
} catch (Throwable $e) {
    try { db()->exec('ROLLBACK'); } catch (Throwable $x) {}
    error_log('[SatuToko] ' . $e->getMessage() . ' @' . $e->getFile() . ':' . $e->getLine());
    fail('Terjadi kesalahan server: ' . $e->getMessage(), 500);
}
