<?php
// =====================================================
//  KONFIGURASI APLIKASI — sesuaikan sebelum dipakai
// =====================================================
date_default_timezone_set('Asia/Jakarta');

define('APP_NAME', 'SatuToko POS');

// Lokasi database (SQLite). Folder data/ dilindungi .htaccess
define('DB_FILE', __DIR__ . '/data/pos.sqlite');

// Backup otomatis harian (terenkripsi AES-256)
define('BACKUP_DIR', __DIR__ . '/data/backups');
define('BACKUP_KEEP', 30);                       // simpan 30 backup terakhir
define('BACKUP_KEY', 'GANTI-DENGAN-KUNCI-RAHASIA-PANJANG-ANDA-2026');  // WAJIB diganti!

// Diskon manual di atas persen ini butuh otorisasi PIN supervisor
define('DISCOUNT_AUTH_LIMIT', 10);

// Poin member: 1 poin setiap kelipatan nominal ini
define('POINT_PER', 10000);

// Metode pembayaran yang tersedia
define('PAYMENT_METHODS', ['Tunai', 'QRIS', 'Debit', 'Kartu Kredit', 'Transfer', 'E-Wallet']);

// Batas gagal login sebelum dikunci sementara (10 menit)
define('LOGIN_MAX_FAIL', 5);
