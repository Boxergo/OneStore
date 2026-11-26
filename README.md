# SatuToko POS — Aplikasi Kasir Multi Toko (PHP + HTML, Android/PWA)

Aplikasi berbasis web (PHP + SQLite) yang **dipasang di Android sebagai aplikasi** (PWA), bisa dipakai **offline**, dan mendukung **banyak toko/cabang** dari satu server.

## ▶ Menjalankan di Komputer Sendiri (VS Code / Windows)
> Jangan buka `index.html` dengan klik 2x atau "Go Live" (Live Server), karena keduanya **tidak menjalankan PHP**.

**Sekali saja: pasang PHP**
1. Unduh PHP 8.3 untuk Windows di https://windows.php.net/download → pilih **VS16 x64 Thread Safe → Zip**.
2. Extract ke folder **`C:\php`** (sehingga ada `C:\php\php.exe`).
   *Kalau sudah punya XAMPP atau Laragon, langkah ini tidak perlu karena PHP-nya terdeteksi otomatis.*

**Menjalankan aplikasi** (pilih salah satu):
- **VS Code:** buka folder `satutoko` (File → Open Folder), lalu tekan **Ctrl+Shift+B**.
- **Tanpa VS Code:** klik 2x **`start-local.bat`**.

Browser akan terbuka di **http://localhost:8000**. Login pakai `owner / owner123`.
Biarkan jendela terminal tetap terbuka selama aplikasi dipakai. Untuk berhenti, tekan Ctrl+C di jendela itu.

**Coba dari HP Android (WiFi yang sama):** cari IP komputer dengan `ipconfig` (IPv4, mis. 192.168.1.10), lalu buka `http://192.168.1.10:8000` di Chrome HP. Izinkan saat Windows Firewall bertanya.
Lewat alamat IP tanpa HTTPS, aplikasi bisa dipakai penuh, *kecuali* scan kamera & "Instal aplikasi" (Chrome hanya mengizinkan keduanya di HTTPS atau localhost). Untuk itu, pakai scanner USB/Bluetooth atau pasang di hosting ber-HTTPS.

Database lokal tersimpan di `data/pos.sqlite`. Hapus file itu untuk mengulang dari data contoh.

## Cara Pasang (Hosting / Server)
1. Upload seluruh folder ke hosting PHP (PHP 8.0+ dengan ekstensi `pdo_sqlite` & `openssl`; hampir semua shared hosting sudah punya).
2. **Wajib pakai HTTPS** (SSL gratis Let's Encrypt/cPanel). Tanpa HTTPS, aplikasi tidak bisa di-install di Android dan kamera scan barcode tidak jalan.
3. Buka `config.php` → **ganti `BACKUP_KEY`** dengan kunci rahasia panjang. Simpan kunci ini, karena tanpa kunci itu backup tidak bisa dibuka.
4. Pastikan folder `data/` bisa ditulis oleh server (chmod 750/755). Database dibuat otomatis saat aplikasi pertama dibuka.
5. Buka `https://domain-anda/` → login → **segera ganti semua password & PIN demo** (menu Lainnya → User & Hak Akses).

Server Apache memakai `.htaccess` yang sudah disertakan untuk melindungi `data/`, `config.php`, dan `db.php`. Kalau servernya Nginx, blok folder itu secara manual:
`location ~ ^/(data|tools)/ { deny all; } location ~ ^/(config|db)\.php$ { deny all; }`


## Pasang di HP Android
Buka alamat aplikasi di **Chrome** → menu ⋮ → **Instal aplikasi / Tambahkan ke layar utama**. Ikon SatuToko akan muncul seperti aplikasi biasa.
Kalau butuh file **APK** (untuk Play Store/MDM), bungkus URL HTTPS Anda dengan **PWABuilder.com** (gratis, hasilnya Trusted Web Activity) atau WebView di Android Studio.

## Akun Demo
| Peran | Username | Password | PIN otorisasi |
|---|---|---|---|
| Owner (semua toko) | owner | owner123 | 1234 |
| Admin Toko Pusat | admin | admin123 | 5678 |
| Supervisor Toko Pusat | spv | spv123 | 9999 |
| Kasir Toko Pusat | kasir | kasir123 | 1111 |
| Kasir Cabang Kota | kasir2 | kasir123 | 2222 |

## Pemetaan Fitur
| Kebutuhan | Di aplikasi |
|---|---|
| **Multi toko & cabang**, tambah toko tanpa ganggu operasional | Lainnya → Toko & Cabang. Toko baru langsung memakai master produk pusat. Owner berpindah toko lewat pilihan di header. |
| Manajemen data terpusat | Satu database: produk, harga, promo, member, user dipakai bersama semua cabang. |
| Laporan terintegrasi & real-time | Laporan → filter "Semua toko" atau per toko, data langsung dari transaksi terakhir. |
| **Sinkronisasi stok otomatis** | Setiap penjualan/void/opname/transfer langsung mengubah stok dan tercatat di *Mutasi*. |
| Multi satuan & desimal | Produk bisa punya satuan tambahan (dus = 24 pcs, karung = 25 kg) dengan harga & barcode sendiri; qty desimal untuk kg/liter. |
| Mobile stock opname | Stok → Stock Opname: scan kamera HP, isi jumlah fisik, selisih tercatat otomatis. |
| Laporan monitoring | Laporan → Analisa: stok menipis semua cabang, nilai persediaan, mutasi. |
| Collaborative item sales | Cek stok produk di semua cabang (ketuk produk di Daftar Stok) + **Transfer Stok Antar Cabang**. |
| **Multi payment** | Tunai, QRIS, Debit, Kartu Kredit, Transfer, E-Wallet, dan bayar campuran (split). Atur daftarnya di `config.php`. |
| Scan barcode otomatis | Scanner USB/Bluetooth (langsung ketik + Enter) atau kamera HP (Chrome Android). |
| Tunda sementara | Tombol *Tunda* / *Daftar Tunda* di layar kasir. |
| Transaksi offline/online | Saat sinyal putus, transaksi tersimpan di HP dan otomatis terkirim saat online lagi, tanpa dobel (ID unik). |
| **Sales dashboard** | Omzet, transaksi, rata-rata struk, laba kotor, perbandingan dengan periode sebelumnya, grafik harian & jam sibuk. |
| Analisa toko, produk & pelanggan | Performa per toko, tren produk (naik/turun), kategori, metode bayar, kasir, member teratas, porsi omzet member. |
| Integrasi akuntansi | Ekspor CSV: Penjualan, Item, dan **Jurnal** (Kas/Bank, Penjualan, Potongan, HPP, Persediaan). Bisa diimpor ke Accurate/Jurnal.id/Zahir; sesuaikan kode akun. |
| **Promo terjadwal otomatis** | Tanggal mulai/berakhir, hari tertentu, dan jam tertentu (happy hour). Promo menyala dan mati sendiri. |
| Membership | Poin otomatis (1 poin / Rp10.000, atur di config), promo khusus member, riwayat belanja. |
| Ragam promosi | Diskon % item, potongan Rp item, Beli X Gratis Y, diskon % total belanja, potongan Rp total belanja (dengan minimal belanja & batas maksimal). |
| Live display panel | `display.html` untuk tablet/TV di depan pelanggan: isi belanja, total, hemat, kembalian, promo aktif. Link ada di menu Lainnya (admin/owner). |
| **User role & keamanan akses** | 4 peran: kasir, supervisor, admin, owner. Password & PIN di-hash (bcrypt), login dikunci setelah 5 kali gagal, sesi aman, proteksi CSRF. |
| Manajemen shift | Buka shift dengan modal awal, tutup shift dengan rekap per metode bayar & selisih kas. |
| Otorisasi transaksi | Void dan diskon manual di atas 10% wajib memakai PIN supervisor. Semua tercatat di Log Aktivitas. |
| Backup otomatis & terjadwal | Backup harian otomatis, terenkripsi AES-256 + HMAC, menyimpan 30 backup terakhir, bisa diunduh. Pulihkan dengan `php tools/restore_backup.php file.enc hasil.sqlite`. |

## Struktur File
```
index.html, app.js, style.css   → aplikasi kasir (PWA)
display.html                    → layar pelanggan (live display)
api.php                         → seluruh API JSON + logika promo, stok, laporan
db.php                          → skema database & data contoh
config.php                      → pengaturan
sw.js, manifest.json, icon-*    → agar bisa di-install & offline
tools/restore_backup.php        → dekripsi backup
start-local.bat / .sh, router.php, .vscode/ → menjalankan di komputer lokal
data/                           → database & backup (dibuat otomatis, terlindungi)
```

## Catatan
- Logika promo ada di dua tempat yang identik: `api.php` (sumber kebenaran) dan `app.js` (untuk offline). Kalau menambah jenis promo, ubah keduanya.
- SQLite cukup untuk puluhan cabang dengan transaksi normal. Kalau sudah sangat ramai, database bisa dipindah ke MySQL.
- Data tunda transaksi disimpan per perangkat kasir.
- **Scan barcode**: kamera langsung, foto, pilih gambar, tarik-lepas, atau tempel (Ctrl+V). Pembaca bawaan (`barcode.js`, offline) mendukung EAN-13, UPC-A, EAN-8, Code 128. QR code hanya terbaca di browser yang punya pembaca bawaan (Chrome Android). `contoh-barcode-demo.png` berisi barcode produk demo untuk uji coba.
# OneStore
