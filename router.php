<?php
// Router untuk server lokal (php -S). Server bawaan PHP tidak membaca .htaccess,
// jadi file sensitif diblokir di sini.
$p = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
if (preg_match('#^/(data|tools)(/|$)|^/(config|db|router)\.php$|/\.#i', $p)) {
    http_response_code(403); exit('Forbidden');
}
return false; // file lain dilayani normal
