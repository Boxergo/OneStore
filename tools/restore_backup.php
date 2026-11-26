<?php
// Dekripsi file backup .enc menjadi database SQLite.
// Jalankan lewat terminal:  php tools/restore_backup.php data/backups/backup_xxx.enc hasil.sqlite
// Lalu ganti data/pos.sqlite dengan hasil.sqlite (matikan aplikasi dulu).
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require __DIR__ . '/../config.php';
[$_, $in, $out] = $argv + [null, null, null];
if (!$in || !$out) exit("Pakai: php tools/restore_backup.php <file.enc> <output.sqlite>\n");
$raw = file_get_contents($in);
if (substr($raw, 0, 4) !== 'STK1') exit("Bukan file backup SatuToko\n");
$iv = substr($raw, 4, 16); $mac = substr($raw, 20, 32); $enc = substr($raw, 52);
$key = hash('sha256', BACKUP_KEY, true);
if (!hash_equals($mac, hash_hmac('sha256', $enc, $key, true))) exit("Kunci salah atau file rusak\n");
file_put_contents($out, gzdecode(openssl_decrypt($enc, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv)));
echo "Berhasil: $out\n";
