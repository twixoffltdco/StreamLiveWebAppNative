<?php
/**
 * JSON-комментарии канала — устойчивый SELECT (с/без is_deleted, role).
 * GET  ?channel_id=1&after=0
 * POST {"channel_id":1,"message":"текст"}
 */
require_once dirname(__DIR__) . '/includes/functions.php';
require_once dirname(__DIR__) . '/includes/auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, X-API-KEY, Cookie');
header('Access-Control-Allow-Credentials: true');
header('Cache-Control: no-store');

function nc_out(array $a, int $code = 200): void {
  http_response_code($code);
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(204); exit; }

if ($method === 'GET') {
  $channelId = (int)($_GET['channel_id'] ?? 0);
  $after = (int)($_GET['after'] ?? 0);
  if ($channelId <= 0) nc_out(['ok' => false, 'messages' => [], 'error' => 'channel_id'], 400);

  $rows = [];
  $err = null;
  // try full query, then simplified fallbacks
  $queries = [
    'SELECT cm.id, cm.message, cm.created_at, cm.user_id, u.username, u.is_verified, u.role
     FROM comments cm JOIN users u ON u.id = cm.user_id
     WHERE cm.channel_id = ? AND COALESCE(cm.is_deleted,0) = 0 AND cm.id > ?
     ORDER BY cm.id ASC LIMIT 80',
    'SELECT cm.id, cm.message, cm.created_at, cm.user_id, u.username, u.is_verified
     FROM comments cm JOIN users u ON u.id = cm.user_id
     WHERE cm.channel_id = ? AND COALESCE(cm.is_deleted,0) = 0 AND cm.id > ?
     ORDER BY cm.id ASC LIMIT 80',
    'SELECT cm.id, cm.message, cm.created_at, cm.user_id, u.username
     FROM comments cm JOIN users u ON u.id = cm.user_id
     WHERE cm.channel_id = ? AND cm.id > ?
     ORDER BY cm.id ASC LIMIT 80',
    'SELECT cm.id, cm.message, cm.created_at, cm.user_id, u.username
     FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
     WHERE cm.channel_id = ? AND cm.id > ?
     ORDER BY cm.id ASC LIMIT 80',
  ];
  foreach ($queries as $sql) {
    try {
      $st = db()->prepare($sql);
      $st->execute([$channelId, $after]);
      $rows = $st->fetchAll();
      $err = null;
      break;
    } catch (Throwable $e) {
      $err = $e->getMessage();
      $rows = [];
    }
  }

  $messages = [];
  foreach ($rows as $r) {
    $role = strtolower((string)($r['role'] ?? 'user'));
    $messages[] = [
      'id' => (int)$r['id'],
      'userId' => (int)($r['user_id'] ?? 0),
      'username' => (string)($r['username'] ?? 'user'),
      'message' => (string)($r['message'] ?? ''),
      'created_at' => $r['created_at'] ?? null,
      'is_verified' => !empty($r['is_verified']),
      'role' => $role,
      'is_mod' => in_array($role, ['admin', 'moderator'], true),
    ];
  }
  nc_out(['ok' => true, 'messages' => $messages, 'comments' => $messages, 'error' => $err]);
}

if ($method === 'POST') {
  $user = function_exists('current_user') ? current_user() : null;
  if (!$user) nc_out(['ok' => false, 'error' => 'Нужно войти'], 401);
  $raw = file_get_contents('php://input') ?: '';
  $input = json_decode($raw, true);
  if (!is_array($input)) $input = [];
  if (!$input) $input = $_POST ?: [];
  if (!$input && $raw !== '') { parse_str($raw, $parsed); if (is_array($parsed)) $input = $parsed; }
  $channelId = (int)($input['channel_id'] ?? 0);
  $message = trim(mb_substr((string)($input['message'] ?? ''), 0, 1000));
  if ($channelId <= 0 || $message === '') nc_out(['ok' => false, 'error' => 'Пустое сообщение'], 400);

  try {
    $st = db()->prepare("SELECT id FROM channels WHERE id = ? LIMIT 1");
    $st->execute([$channelId]);
    if (!$st->fetch()) {
      // try approved only fallback
      $st = db()->prepare("SELECT id FROM channels WHERE id = ? AND status = 'approved'");
      $st->execute([$channelId]);
      if (!$st->fetch()) nc_out(['ok' => false, 'error' => 'Канал не найден'], 404);
    }
  } catch (Throwable $e) {}

  try {
    $b = db()->prepare('SELECT id FROM chat_bans WHERE channel_id = ? AND user_id = ? LIMIT 1');
    $b->execute([$channelId, (int)$user['id']]);
    if ($b->fetch()) nc_out(['ok' => false, 'error' => 'Вас заблокировали в этом канале', 'me_banned' => true], 403);
  } catch (Throwable $e) {}

  try {
    db()->prepare('INSERT INTO comments (channel_id, user_id, message) VALUES (?, ?, ?)')
      ->execute([$channelId, (int)$user['id'], $message]);
    nc_out(['ok' => true, 'id' => (int)db()->lastInsertId()]);
  } catch (Throwable $e) {
    nc_out(['ok' => false, 'error' => 'Не удалось сохранить: ' . $e->getMessage()], 500);
  }
}

nc_out(['ok' => false, 'error' => 'method'], 405);
