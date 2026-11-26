#!/bin/sh
# Server lokal untuk macOS / Linux
cd "$(dirname "$0")"
PORT=${PORT:-8000}
command -v php >/dev/null || { echo "PHP belum terpasang (mac: brew install php, Ubuntu: sudo apt install php-cli php-sqlite3)"; exit 1; }
echo "SatuToko POS: http://localhost:$PORT  (Ctrl+C untuk berhenti)"
php -S 0.0.0.0:$PORT -t . router.php
