<?php
require_once __DIR__ . '/config.php';

function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    if (!is_dir(dirname(DB_FILE))) mkdir(dirname(DB_FILE), 0750, true);
    if (!extension_loaded('pdo_sqlite')) throw new RuntimeException('Ekstensi pdo_sqlite belum aktif. Buka php.ini lalu hapus tanda ; di depan extension=pdo_sqlite, kemudian restart Apache.');
    if (!is_writable(dirname(DB_FILE))) throw new RuntimeException('Folder data/ tidak bisa ditulis oleh server: ' . dirname(DB_FILE));
    $pdo = new PDO('sqlite:' . DB_FILE);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    $has = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")->fetchColumn();
    if (!$has) install($pdo);
    return $pdo;
}

function q(string $sql, array $p = []): array { $s = db()->prepare($sql); $s->execute($p); return $s->fetchAll(); }
function q1(string $sql, array $p = []) { $s = db()->prepare($sql); $s->execute($p); $r = $s->fetch(); return $r ?: null; }
function qv(string $sql, array $p = []) { $s = db()->prepare($sql); $s->execute($p); return $s->fetchColumn(); }
function ex(string $sql, array $p = []): int { $s = db()->prepare($sql); $s->execute($p); return (int)db()->lastInsertId(); }
function setting(string $k, $v = null) {
    if ($v === null) return qv('SELECT v FROM settings WHERE k=?', [$k]);
    ex('INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)', [$k, $v]);
    return $v;
}

function install(PDO $pdo) {
    $pdo->exec("
CREATE TABLE settings(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE stores(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT NOT NULL, address TEXT, phone TEXT,
  active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, username TEXT UNIQUE, pass TEXT, pin TEXT,
  role TEXT, store_id INTEGER, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE login_fail(username TEXT, ip TEXT, at INTEGER);
CREATE TABLE products(id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT, barcode TEXT, name TEXT NOT NULL, category TEXT,
  unit TEXT DEFAULT 'pcs', cost REAL DEFAULT 0, price REAL DEFAULT 0, min_stock REAL DEFAULT 0, decimal_qty INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1);
CREATE INDEX ix_prod_bc ON products(barcode);
CREATE TABLE product_units(id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, unit TEXT, factor REAL, price REAL, barcode TEXT);
CREATE TABLE stock(store_id INTEGER, product_id INTEGER, qty REAL DEFAULT 0, PRIMARY KEY(store_id, product_id));
CREATE TABLE stock_moves(id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER, product_id INTEGER, qty REAL, type TEXT,
  ref TEXT, note TEXT, user_id INTEGER, created_at TEXT);
CREATE INDEX ix_moves ON stock_moves(store_id, created_at);
CREATE TABLE members(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT, phone TEXT, email TEXT,
  points INTEGER DEFAULT 0, total_spent REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE promos(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, scope TEXT DEFAULT 'all', target TEXT,
  value REAL DEFAULT 0, min_qty REAL DEFAULT 0, free_qty REAL DEFAULT 0, min_total REAL DEFAULT 0, max_disc REAL DEFAULT 0,
  member_only INTEGER DEFAULT 0, store_id INTEGER, start_at TEXT, end_at TEXT, days TEXT, hour_start TEXT, hour_end TEXT,
  active INTEGER DEFAULT 1);
CREATE TABLE shifts(id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER, user_id INTEGER, opened_at TEXT, opening_cash REAL,
  closed_at TEXT, closing_cash REAL, expected_cash REAL, note TEXT);
CREATE TABLE sales(id INTEGER PRIMARY KEY AUTOINCREMENT, invoice TEXT UNIQUE, client_uuid TEXT UNIQUE, store_id INTEGER,
  user_id INTEGER, shift_id INTEGER, member_id INTEGER, subtotal REAL, line_disc REAL, trx_disc REAL, manual_disc REAL,
  total REAL, paid REAL, change_amt REAL, cogs REAL, points INTEGER DEFAULT 0, status TEXT DEFAULT 'paid',
  offline INTEGER DEFAULT 0, authorized_by INTEGER, void_by INTEGER, void_reason TEXT, void_at TEXT, created_at TEXT);
CREATE INDEX ix_sales ON sales(store_id, created_at);
CREATE TABLE sale_items(id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, product_id INTEGER, name TEXT, unit TEXT,
  factor REAL, qty REAL, price REAL, discount REAL, promo TEXT, total REAL, cost REAL);
CREATE INDEX ix_items ON sale_items(sale_id);
CREATE TABLE sale_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, method TEXT, amount REAL, ref TEXT);
CREATE TABLE display_state(store_id INTEGER PRIMARY KEY, user_id INTEGER, data TEXT, updated_at INTEGER);
CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, store_id INTEGER, action TEXT, detail TEXT, created_at TEXT);
");

    // ---------- Data awal (contoh) ----------
    $now = date('Y-m-d H:i:s');
    $s = function ($sql, $p) use ($pdo) { return $pdo->prepare($sql)->execute($p); };
    $s('INSERT INTO settings(k,v) VALUES(?,?)', ['display_key', bin2hex(random_bytes(8))]);
    $s('INSERT INTO stores(code,name,address,phone) VALUES(?,?,?,?)', ['PST', 'Toko Pusat', 'Jl. Utama No. 1', '0266-000001']);
    $s('INSERT INTO stores(code,name,address,phone) VALUES(?,?,?,?)', ['CB2', 'Cabang Kota', 'Jl. Kota No. 2', '0266-000002']);
    $u = 'INSERT INTO users(name,username,pass,pin,role,store_id) VALUES(?,?,?,?,?,?)';
    $s($u, ['Pemilik', 'owner', password_hash('owner123', PASSWORD_DEFAULT), password_hash('1234', PASSWORD_DEFAULT), 'owner', null]);
    $s($u, ['Admin Pusat', 'admin', password_hash('admin123', PASSWORD_DEFAULT), password_hash('5678', PASSWORD_DEFAULT), 'admin', 1]);
    $s($u, ['Supervisor Pusat', 'spv', password_hash('spv123', PASSWORD_DEFAULT), password_hash('9999', PASSWORD_DEFAULT), 'supervisor', 1]);
    $s($u, ['Kasir Pusat', 'kasir', password_hash('kasir123', PASSWORD_DEFAULT), password_hash('1111', PASSWORD_DEFAULT), 'kasir', 1]);
    $s($u, ['Kasir Cabang', 'kasir2', password_hash('kasir123', PASSWORD_DEFAULT), password_hash('2222', PASSWORD_DEFAULT), 'kasir', 2]);

    $prods = [
        // sku, barcode, name, category, unit, cost, price, min, decimal
        ['AM600', '8990000000013', 'Air Mineral 600ml', 'Minuman', 'pcs', 2500, 4000, 24, 0],
        ['KP200', '8990000000020', 'Kopi Susu Botol 200ml', 'Minuman', 'pcs', 5000, 8000, 12, 0],
        ['MI001', '8990000000037', 'Mi Instan Goreng', 'Makanan', 'pcs', 2700, 3500, 40, 0],
        ['RT001', '8990000000044', 'Roti Tawar', 'Makanan', 'pcs', 11000, 15000, 5, 0],
        ['BR001', '2000000000015', 'Beras Premium (curah)', 'Sembako', 'kg', 12500, 15000, 20, 1],
        ['GL001', '2000000000022', 'Gula Pasir (curah)', 'Sembako', 'kg', 15000, 18000, 10, 1],
        ['MG001', '8990000000051', 'Minyak Goreng 1L', 'Sembako', 'pcs', 15500, 19000, 12, 0],
        ['SB001', '8990000000068', 'Sabun Mandi Batang', 'Kebutuhan Rumah', 'pcs', 3000, 4500, 10, 0],
    ];
    foreach ($prods as $p) {
        $s('INSERT INTO products(sku,barcode,name,category,unit,cost,price,min_stock,decimal_qty) VALUES(?,?,?,?,?,?,?,?,?)', $p);
    }
    // Multi satuan
    $s('INSERT INTO product_units(product_id,unit,factor,price,barcode) VALUES(?,?,?,?,?)', [1, 'dus', 24, 85000, '18990000000010']);
    $s('INSERT INTO product_units(product_id,unit,factor,price,barcode) VALUES(?,?,?,?,?)', [3, 'dus', 40, 132000, '18990000000034']);
    $s('INSERT INTO product_units(product_id,unit,factor,price,barcode) VALUES(?,?,?,?,?)', [5, 'karung 25kg', 25, 360000, '22000000000019']);
    // Stok awal
    foreach ([1, 2] as $st) foreach (range(1, count($prods)) as $pid) {
        $qty = $pid == 5 || $pid == 6 ? 100.5 : ($st == 1 ? 120 : 60);
        $s('INSERT INTO stock(store_id,product_id,qty) VALUES(?,?,?)', [$st, $pid, $qty]);
        $s('INSERT INTO stock_moves(store_id,product_id,qty,type,ref,note,user_id,created_at) VALUES(?,?,?,?,?,?,?,?)',
            [$st, $pid, $qty, 'awal', 'INSTALL', 'Stok awal', 1, $now]);
    }
    $s('INSERT INTO members(code,name,phone) VALUES(?,?,?)', ['M0001', 'Budi Santoso', '081200000001']);
    $s('INSERT INTO members(code,name,phone) VALUES(?,?,?)', ['M0002', 'Siti Aminah', '081200000002']);
    // Promo contoh
    $p = 'INSERT INTO promos(name,type,scope,target,value,min_qty,free_qty,min_total,max_disc,member_only,start_at,end_at,days,hour_start,hour_end) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
    $s($p, ['Beli 2 Gratis 1 Kopi Susu', 'bxgy', 'product', '2', 0, 2, 1, 0, 0, 0, null, null, '', '', '']);
    $s($p, ['Diskon Sembako 5% (Member)', 'percent', 'category', 'Sembako', 5, 0, 0, 0, 0, 1, null, null, '', '', '']);
    $s($p, ['Belanja ≥100rb diskon 10rb', 'total_nominal', 'all', '', 10000, 0, 0, 100000, 0, 0, null, null, '', '', '']);
    $s($p, ['Happy Hour Roti 20% (19:00-21:00)', 'percent', 'product', '4', 20, 0, 0, 0, 0, 0, null, null, '', '19:00', '21:00']);
}
