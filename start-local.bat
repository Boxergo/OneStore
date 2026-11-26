@echo off
setlocal EnableDelayedExpansion
title SatuToko POS - Server Lokal
cd /d "%~dp0"
set PORT=8000

REM ---- Cari PHP: PATH, XAMPP, C:\php, Laragon, atau folder php\ di sini ----
set "PHP="
where php >nul 2>nul && set "PHP=php"
if not defined PHP if exist "%~dp0php\php.exe" set "PHP=%~dp0php\php.exe"
if not defined PHP if exist "C:\xampp\php\php.exe" set "PHP=C:\xampp\php\php.exe"
if not defined PHP if exist "C:\php\php.exe" set "PHP=C:\php\php.exe"
if not defined PHP for /d %%d in ("C:\laragon\bin\php\php-*") do if exist "%%d\php.exe" set "PHP=%%d\php.exe"
if not defined PHP (
  echo.
  echo  [!] PHP belum terpasang di komputer ini.
  echo.
  echo  Cara paling mudah:
  echo   1. Buka https://windows.php.net/download  ^(pilih PHP 8.3 "VS16 x64 Thread Safe" - Zip^)
  echo   2. Extract isinya ke folder C:\php   ^(sehingga ada C:\php\php.exe^)
  echo   3. Jalankan file ini lagi.
  echo.
  echo  Atau jika sudah punya XAMPP, file ini otomatis memakai C:\xampp\php.
  echo.
  pause
  exit /b 1
)

REM ---- Aktifkan ekstensi yang dibutuhkan bila belum aktif ----
for /f "delims=" %%i in ('call "%PHP%" -r "echo dirname(PHP_BINARY);"') do set "PHPDIR=%%i"
set "EXT="
"%PHP%" -m | findstr /i /x "pdo_sqlite" >nul || set "EXT=!EXT! -d extension=pdo_sqlite"
"%PHP%" -m | findstr /i /x "openssl" >nul || set "EXT=!EXT! -d extension=openssl"
if defined EXT set "EXT=-d extension_dir="%PHPDIR%\ext" !EXT!"
"%PHP%" %EXT% -r "exit(extension_loaded('pdo_sqlite') && extension_loaded('openssl') ? 0 : 1);"
if errorlevel 1 (
  echo  [!] Ekstensi pdo_sqlite / openssl tidak bisa diaktifkan.
  echo      Buka php.ini di %PHPDIR% lalu hapus tanda ; di depan:
  echo      extension=pdo_sqlite   dan   extension=openssl
  pause
  exit /b 1
)

echo.
echo  =====================================================
echo   SatuToko POS berjalan di:  http://localhost:%PORT%
echo   Dari HP (WiFi yang sama):   http://IP-KOMPUTER:%PORT%
echo   ^(lihat IP dengan perintah ipconfig, bagian IPv4^)
echo   Tutup jendela ini / tekan Ctrl+C untuk berhenti.
echo  =====================================================
echo.
start "" "http://localhost:%PORT%/"
"%PHP%" %EXT% -S 0.0.0.0:%PORT% -t "%~dp0." "%~dp0router.php"
pause
