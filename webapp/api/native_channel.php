<?php
/**
 * StreamLive Native — канал + активный источник потока.
 * Положить в /api/native_channel.php.
 * GET ?slug=my-channel
 */
require_once dirname(dirname(__DIR__)) . '/includes/functions.php';
require_once dirname(dirname(__DIR__)) . '/includes/auth.php';
if (is_file(dirname(dirname(__DIR__)) . '/includes/paid_access.php')) require_once dirname(dirname(__DIR__)) . '/includes/paid_access.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

function nc_out(array $a, int $code = 200): void {
  http_response_code($code);
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

$slug = trim((string)($_GET['slug'] ?? $_GET['id'] ?? ''));
if ($slug === '') nc_out(['ok' => false, 'error' => 'slug обязателен'], 400);

// slug or numeric id
if (ctype_digit($slug)) {
  $st = db()->prepare("SELECT * FROM channels WHERE id = ? AND status = 'approved'");
  $st->execute([(int)$slug]);
} else {
  $st = db()->prepare("SELECT * FROM channels WHERE slug = ? AND status = 'approved'");
  $st->execute([$slug]);
}
$ch = $st->fetch();
if (!$ch) nc_out(['ok' => false, 'error' => 'Канал недоступен'], 404);
$slug = (string)$ch['slug'];

$user = function_exists('current_user') ? current_user() : null;
if (function_exists('paid_channel_is_paid') && paid_channel_is_paid($ch)) {
  if (!(function_exists('paid_user_can_watch') && paid_user_can_watch($user, $ch))) {
    nc_out(['ok' => false, 'error' => 'Платный канал — откройте его на сайте'], 403);
  }
}

$src = function_exists('resolve_active_source') ? resolve_active_source($ch) : null;

nc_out([
  'ok' => true,
  'channel' => [
    'id' => (int)$ch['id'],
    'slug' => $ch['slug'],
    'title' => $ch['title'],
    'description' => (string)($ch['description'] ?? ''),
    'logo_url' => (string)($ch['logo_url'] ?? ''),
    'type' => $ch['type'] ?? 'tv',
    'views' => (int)($ch['views'] ?? 0),
  ],
  'source' => $src ? [
    'type' => $src['type'],
    'url' => $src['url'],
    'name' => $src['name'] ?? '',
    'program' => $src['program_title'] ?? '',
  ] : null,
  'embed_url' => '/embed.php?slug=' . rawurlencode($ch['slug']) . '&cinema=0',
]);
