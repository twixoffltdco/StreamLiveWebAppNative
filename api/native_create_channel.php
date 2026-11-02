<?php
/**
 * StreamLive Native — создание ТВ-канала или радио из приложения.
 * Положить в /api/native_create_channel.php на каждом зеркале.
 *
 * POST JSON:
 *  {title, description?, type:"tv"|"radio", logo_url?,
 *   source_type?:"m3u8"|"mp4"|"youtube"|"vk"|"rutube"|"iframe",
 *   source_url?, source_name?}
 *
 * Правила те же, что у new_channel.php + channel_manage.php: лимит раз в 24 часа,
 * проверка ссылки плеера, статус approved/pending по правилам сайта.
 */
require_once dirname(__DIR__) . '/includes/functions.php';
require_once dirname(__DIR__) . '/includes/auth.php';
foreach (['embed_helper.php', 'verified_moderation.php'] as $f) {
  if (is_file(dirname(__DIR__) . '/includes/' . $f)) require_once dirname(__DIR__) . '/includes/' . $f;
}

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, X-API-KEY, Cookie');
header('Cache-Control: no-store');

function ncc_out(array $a, int $code = 200): void {
  http_response_code($code);
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') ncc_out(['ok' => false, 'error' => 'POST only'], 405);
$user = function_exists('current_user') ? current_user() : null;
if (!$user) ncc_out(['ok' => false, 'error' => 'Войдите в аккаунт'], 401);
if (!empty($user['is_banned'])) ncc_out(['ok' => false, 'error' => 'Аккаунт заблокирован'], 403);

$in = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
$title = trim(mb_substr((string)($in['title'] ?? ''), 0, 150));
$description = trim(mb_substr((string)($in['description'] ?? ''), 0, 2000));
$type = (($in['type'] ?? '') === 'radio') ? 'radio' : 'tv';
$logo = trim((string)($in['logo_url'] ?? '')) ?: null;
if ($logo !== null && !preg_match('#^https?://#i', $logo)) $logo = null;
$srcType = strtolower(trim((string)($in['source_type'] ?? '')));
$srcUrl = trim((string)($in['source_url'] ?? ''));
$srcName = trim(mb_substr((string)($in['source_name'] ?? ''), 0, 150));

// Совместимость со старыми формами: если тип не передан, определяем его по URL.
if ($srcType === '' && $srcUrl !== '') {
  $host = strtolower((string)(parse_url($srcUrl, PHP_URL_HOST) ?: ''));
  if (preg_match('/\\.m3u8(?:$|\\?)/i', $srcUrl)) $srcType = 'm3u8';
  elseif (preg_match('/\\.mp4(?:$|\\?)/i', $srcUrl)) $srcType = 'mp4';
  elseif (strpos($host, 'youtube.') !== false || $host === 'youtu.be') $srcType = 'youtube';
  elseif (strpos($host, 'vk.com') !== false || strpos($host, 'vkvideo.ru') !== false) $srcType = 'vk';
  elseif (strpos($host, 'rutube.') !== false) $srcType = 'rutube';
  else $srcType = 'iframe';
}

if ($title === '') ncc_out(['ok' => false, 'error' => 'Укажите название'], 400);
if ($srcUrl === '') ncc_out(['ok' => false, 'error' => 'Добавьте ссылку на поток или плеер'], 400);
if (strlen($srcUrl) > 2048 || !filter_var($srcUrl, FILTER_VALIDATE_URL) || !in_array(strtolower((string)parse_url($srcUrl, PHP_URL_SCHEME)), ['http', 'https'], true)) {
  ncc_out(['ok' => false, 'error' => 'Укажите корректную ссылку http:// или https://'], 400);
}

if ($srcUrl !== '' && !in_array($srcType, ['m3u8', 'mp4', 'youtube', 'vk', 'rutube', 'iframe'], true)) {
  ncc_out(['ok' => false, 'error' => 'Неверный тип источника'], 400);
}

if (function_exists('verified_rate_limit_ok')) {
  $rl = verified_rate_limit_ok($user, 'channel');
  if (empty($rl['ok'])) ncc_out(['ok' => false, 'error' => $rl['error'] ?? 'Лимит: один канал в 24 часа'], 429);
}

// --- источник потока (по правилам channel_manage.php) ---
$sourceId = null;
if ($srcUrl !== '') {
  if (function_exists('ensure_sources_direct_type')) { try { ensure_sources_direct_type(); } catch (Throwable $e) {} }
  $isDirect = in_array($srcType, ['m3u8', 'mp4'], true);
  $result = null;
  if (!empty($user['is_verified']) && $isDirect) {
    $isHttps = stripos($srcUrl, 'https://') === 0 && filter_var($srcUrl, FILTER_VALIDATE_URL);
    if (!$isHttps) ncc_out(['ok' => false, 'error' => 'Нужна ссылка https://'], 400);
    $extracted = function_exists('extract_file_param_url') ? extract_file_param_url($srcUrl) : null;
    if ($extracted) $srcUrl = $extracted;
    $result = function_exists('normalize_embed_url') ? normalize_embed_url($srcType, $srcUrl) : $srcUrl;
  } else {
    if (!function_exists('validate_player_url')) ncc_out(['ok' => false, 'error' => 'Проверка ссылок недоступна на сервере'], 500);
    [$ok, $res] = validate_player_url($srcType, $srcUrl);
    if (!$ok) ncc_out(['ok' => false, 'error' => (string)$res], 400);
    $result = $res;
  }
  db()->prepare('INSERT INTO sources (name, type, url, created_by) VALUES (?, ?, ?, ?)')
      ->execute([$srcName !== '' ? $srcName : $title, $srcType, $result, $user['id']]);
  $sourceId = (int)db()->lastInsertId();
}

// --- канал (по правилам new_channel.php) ---
$slug = function_exists('slugify') ? slugify($title) : preg_replace('/\s+/', '-', mb_strtolower($title));
$slug = trim((string)$slug, '-');
if ($slug === '') $slug = 'channel-' . substr(md5($title . microtime(true)), 0, 8);
$chk = db()->prepare('SELECT id FROM channels WHERE slug = ? LIMIT 1');
$chk->execute([$slug]);
if ($chk->fetch()) $slug .= '-' . substr(md5(uniqid('', true)), 0, 6);

$status = function_exists('verified_channel_status') ? verified_channel_status($user) : 'pending';

try {
  try {
    db()->prepare('INSERT INTO channels (owner_id, slug, title, description, type, logo_url, default_source_id, seo_title, seo_description, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$user['id'], $slug, $title, $description, $type, $logo, $sourceId, $title, mb_substr($description, 0, 380), $status]);
    $newId = (int)db()->lastInsertId();
  } catch (Throwable $e) {
    db()->prepare('INSERT INTO channels (owner_id, slug, title, description, type, logo_url, default_source_id, seo_title, seo_description)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$user['id'], $slug, $title, $description, $type, $logo, $sourceId, $title, mb_substr($description, 0, 380)]);
    $newId = (int)db()->lastInsertId();
    if ($status === 'approved') {
      try { db()->prepare("UPDATE channels SET status='approved' WHERE id=?")->execute([$newId]); } catch (Throwable $e2) {}
    }
  }
  if ($sourceId && function_exists('maybe_auto_approve_channel')) {
    try { maybe_auto_approve_channel($newId); } catch (Throwable $e) {}
  }
} catch (Throwable $e) {
  ncc_out(['ok' => false, 'error' => 'Не удалось создать канал'], 500);
}

ncc_out([
  'ok' => true,
  'id' => $newId,
  'slug' => $slug,
  'status' => $status,
  'message' => $status === 'approved'
    ? 'Канал создан и уже в эфире.'
    : 'Канал создан и отправлен на модерацию. После одобрения он появится в каталоге.',
]);
