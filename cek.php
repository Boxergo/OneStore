<?php
// Halaman cek kesiapan server. Buka: http://localhost/.../cek.php
require __DIR__ . '/config.php';
$ok = function ($b) { return $b ? '<b style="color:#1b7f3b">✔ OK</b>' : '<b style="color:#c62828">✘ MASALAH</b>'; };
$dataDir = dirname(DB_FILE);
if (!is_dir($dataDir)) @mkdir($dataDir, 0750, true);
$sqliteVer = '-';
if (extension_loaded('pdo_sqlite')) { try { $sqliteVer = (new PDO('sqlite::memory:'))->query('select sqlite_version()')->fetchColumn(); } catch (Throwable $e) { $sqliteVer = $e->getMessage(); } }
$ini = php_ini_loaded_file() ?: '(tidak ada php.ini)';
$rows = [
  ['Versi PHP (minimal 7.1)', PHP_VERSION, PHP_VERSION_ID >= 70100],
  ['Ekstensi pdo_sqlite', extension_loaded('pdo_sqlite') ? 'aktif' : 'BELUM aktif: di php.ini hapus ; pada baris extension=pdo_sqlite, lalu restart Apache', extension_loaded('pdo_sqlite')],
  ['Ekstensi openssl (backup terenkripsi)', extension_loaded('openssl') ? 'aktif' : 'BELUM aktif: di php.ini hapus ; pada baris extension=openssl', extension_loaded('openssl')],
  ['Ekstensi zlib (kompres backup)', function_exists('gzencode') ? 'aktif' : 'BELUM aktif', function_exists('gzencode')],
  ['Versi SQLite', $sqliteVer, $sqliteVer !== '-'],
  ['Folder data/ bisa ditulis', $dataDir, is_writable($dataDir)],
  ['php.ini yang dipakai', $ini, true],
];
$all = true; foreach ($rows as $r) $all = $all && $r[2];
?><!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cek Server SatuToko</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem}td,th{padding:.5rem;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}table{border-collapse:collapse;width:100%}.box{padding:1rem;border-radius:10px;margin:1rem 0}</style></head><body>
<h2>Cek Server SatuToko POS</h2>
<table><?php foreach ($rows as $r): ?><tr><th><?= htmlspecialchars($r[0]) ?></th><td><?= htmlspecialchars($r[1]) ?></td><td><?= $ok($r[2]) ?></td></tr><?php endforeach; ?></table>
<div class="box" style="background:<?= $all ? '#e3f3ee' : '#fdecec' ?>"><?= $all ? 'Server siap. <a href="index.html">Buka aplikasi →</a>' : 'Perbaiki item bertanda MASALAH di atas, restart Apache, lalu muat ulang halaman ini.' ?></div>
</body></html>
