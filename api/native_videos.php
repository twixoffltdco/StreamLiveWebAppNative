<?php
/**
 * StreamLive Native — раздел «Видео» (из твоей таблицы videos).
 * Положить в /api/native_videos.php на каждом зеркале.
 *
 * GET  ?action=list&limit=30&q=поиск
 * GET  ?action=detail&slug=abc123
 * POST {"action":"comment","video_id":1,"message":"..."}
 */
require_once dirname(__DIR__) . '/includes/functions.php';
require_once dirname(__DIR__) . '/includes/auth.php';
foreach (['paid_access.php', 'video_url_fix.php'] as $f) {
  if (is_file(dirname(__DIR__) . '/includes/' . $f)) require_once dirname(__DIR__) . '/includes/' . $f;
}

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, X-API-KEY, Cookie');
header('Cache-Control: no-store');

function nv_out(array $a, int $code = 200): void {
  http_response_code($code);
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

$user = function_exists('current_user') ? current_user() : null;
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$input = [];
$action = (string)($_GET['action'] ?? 'list');
if ($method === 'POST') {
  $input = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
  $action = (string)($input['action'] ?? $action);
}

if ($action === 'list') {
  $limit = min(60, max(1, (int)($_GET['limit'] ?? 30)));
  $offset = max(0, (int)($_GET['offset'] ?? 0));
  $q = trim((string)($_GET['q'] ?? ''));
  $sql = "SELECT v.id, v.slug, v.title, v.platform, v.thumbnail_url, v.views_count, v.duration_sec,
                 v.created_at, c.title AS channel_title
          FROM videos v JOIN channels c ON c.id = v.channel_id
          WHERE v.status = 'published'";
  $params = [];
  if ($q !== '') { $sql .= ' AND v.title LIKE ?'; $params[] = '%' . $q . '%'; }
  $sql .= ' ORDER BY v.created_at DESC LIMIT ' . (int)$limit . ' OFFSET ' . (int)$offset;
  $st = db()->prepare($sql);
  $st->execute($params);
  $rows = $st->fetchAll();
  $out = [];
  foreach ($rows as $r) {
    if (function_exists('video_row_fix_urls')) $r = video_row_fix_urls($r);
    $out[] = [
      'id' => (int)$r['id'],
      'slug' => (string)$r['slug'],
      'title' => (string)$r['title'],
      'platform' => (string)$r['platform'],
      'thumbnail_url' => (string)($r['thumbnail_url'] ?? ''),
      'views_count' => (int)($r['views_count'] ?? 0),
      'duration_sec' => (int)($r['duration_sec'] ?? 0),
      'channel_title' => (string)($r['channel_title'] ?? ''),
    ];
  }
  nv_out(['ok' => true, 'videos' => $out]);
}

if ($action === 'detail') {
  $slug = trim((string)($_GET['slug'] ?? $_GET['id'] ?? ''));
  if ($slug === '') { header('Content-Type: application/json'); echo json_encode(['ok'=>false,'error'=>'slug обязателен'], JSON_UNESCAPED_UNICODE); exit; }
  if (ctype_digit($slug)) {
    $st = db()->prepare("SELECT v.*, c.title AS channel_title, c.slug AS channel_slug
                         FROM videos v JOIN channels c ON c.id = v.channel_id
                         WHERE v.id = ? LIMIT 1");
    $st->execute([(int)$slug]);
  } else {
    $st = db()->prepare("SELECT v.*, c.title AS channel_title, c.slug AS channel_slug
                         FROM videos v JOIN channels c ON c.id = v.channel_id
                         WHERE v.slug = ? LIMIT 1");
    $st->execute([$slug]);
  }
  $v = $st->fetch();
  if (!$v) nv_out(['ok' => false, 'error' => 'Видео не найдено'], 404);
  $slug = (string)$v['slug'];

  $own = $user && (int)($v['user_id'] ?? 0) === (int)$user['id'];
  $staff = $user && in_array((string)($user['role'] ?? ''), ['admin', 'moderator'], true);
  if (strtolower((string)$v['status']) !== 'published' && !$own && !$staff) {
    nv_out(['ok' => false, 'error' => 'Видео недоступно'], 404);
  }
  if (function_exists('paid_user_can_watch_video') && !paid_user_can_watch_video($user, $v)) {
    nv_out(['ok' => false, 'error' => 'Платное видео — откройте его на сайте'], 403);
  }
  if (function_exists('video_row_fix_urls')) $v = video_row_fix_urls($v);

  try { db()->prepare('UPDATE videos SET views_count = COALESCE(views_count,0) + 1 WHERE id = ?')->execute([$v['id']]); } catch (Throwable $e) {}

  $platform = (string)$v['platform'];
  $play = '';
  if (in_array($platform, ['mp4', 'm3u8'], true)) {
    $src = (string)($v['source_url'] ?? '');
    $play = preg_match('#^https?://#i', $src) ? $src : (string)$v['embed_url'];
  }

  $cs = db()->prepare('SELECT vc.id, vc.message, vc.created_at, u.username
                       FROM video_comments vc JOIN users u ON u.id = vc.user_id
                       WHERE vc.video_id = ? ORDER BY vc.created_at DESC LIMIT 100');
  $cs->execute([$v['id']]);
  $comments = array_map(static function ($c) {
    return ['id' => (int)$c['id'], 'author' => (string)$c['username'],
            'message' => (string)$c['message'], 'created_at' => (string)$c['created_at']];
  }, $cs->fetchAll());

  nv_out([
    'ok' => true,
    'video' => [
      'id' => (int)$v['id'],
      'slug' => (string)$v['slug'],
      'title' => (string)$v['title'],
      'description' => (string)($v['description'] ?? ''),
      'platform' => $platform,
      'thumbnail_url' => (string)($v['thumbnail_url'] ?? ''),
      'views_count' => (int)($v['views_count'] ?? 0),
      'channel_title' => (string)($v['channel_title'] ?? ''),
      'play_url' => $play,
      'watch_url' => '/video.php?slug=' . rawurlencode((string)$v['slug']),
    ],
    'comments' => $comments,
  ]);
}

if ($action === 'comment') {
  if ($method !== 'POST') nv_out(['ok' => false, 'error' => 'POST only'], 405);
  if (!$user) nv_out(['ok' => false, 'error' => 'Войдите в аккаунт'], 401);
  $videoId = (int)($input['video_id'] ?? 0);
  $message = trim(mb_substr((string)($input['message'] ?? ''), 0, 1000));
  if ($message === '') nv_out(['ok' => false, 'error' => 'Пустой комментарий'], 400);
  $st = db()->prepare('SELECT id FROM videos WHERE id = ?');
  $st->execute([$videoId]);
  if (!$st->fetch()) nv_out(['ok' => false, 'error' => 'Видео не найдено'], 404);
  db()->prepare('INSERT INTO video_comments (video_id, user_id, message) VALUES (?, ?, ?)')
      ->execute([$videoId, $user['id'], $message]);
  try { db()->prepare('UPDATE videos SET comments_count = comments_count + 1 WHERE id = ?')->execute([$videoId]); } catch (Throwable $e) {}
  nv_out(['ok' => true]);
}

nv_out(['ok' => false, 'error' => 'Неизвестное действие'], 400);
