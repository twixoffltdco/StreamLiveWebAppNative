<?php
/**
 * Комментарии канала + модерация чата (как на сайте).
 * GET  ?channel_id=&after=
 * POST send | delete | ban
 * delete/ban: is_deleted + chat_bans, сообщения автора сгорают
 */
$SL_ROOT = dirname(__DIR__);
if (!is_file($SL_ROOT . '/includes/functions.php')) {
  $SL_ROOT = dirname(dirname(__DIR__));
}
require_once $SL_ROOT . '/includes/functions.php';
require_once $SL_ROOT . '/includes/auth.php';

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

function nc_input(): array {
  $raw = file_get_contents('php://input') ?: '';
  $in = json_decode($raw, true);
  if (!is_array($in)) $in = [];
  if (!$in) $in = $_POST ?: [];
  if (!$in && $raw !== '') { parse_str($raw, $p); if (is_array($p)) $in = $p; }
  foreach ($_GET as $k => $v) { if (!isset($in[$k])) $in[$k] = $v; }
  return $in;
}

function nc_is_mod(int $channelId, array $user): bool {
  if (function_exists('is_channel_moderator')) {
    try { if (is_channel_moderator($channelId, (int)$user['id'])) return true; } catch (Throwable $e) {}
  }
  $role = strtolower((string)($user['role'] ?? ''));
  if (in_array($role, ['admin', 'moderator'], true)) return true;
  try {
    $st = db()->prepare('SELECT owner_id FROM channels WHERE id = ? LIMIT 1');
    $st->execute([$channelId]);
    $ch = $st->fetch();
    if ($ch && (int)$ch['owner_id'] === (int)$user['id']) return true;
  } catch (Throwable $e) {}
  return false;
}

function nc_banned(int $channelId, int $userId): bool {
  try {
    $st = db()->prepare('SELECT id FROM chat_bans WHERE channel_id = ? AND user_id = ? LIMIT 1');
    $st->execute([$channelId, $userId]);
    return (bool)$st->fetch();
  } catch (Throwable $e) { return false; }
}

function nc_resolve_user(array $input): ?array {
  if (function_exists('current_user')) {
    $u = current_user();
    if ($u && !empty($u['id'])) return $u;
  }
  $key = trim((string)($_SERVER['HTTP_X_API_KEY'] ?? $input['api_key'] ?? ''));
  if ($key !== '') {
    try {
      $st = db()->prepare('SELECT u.* FROM users u INNER JOIN api_keys k ON k.user_id = u.id WHERE k.api_key = ? LIMIT 1');
      $st->execute([$key]);
      $u = $st->fetch();
      if ($u) return $u;
    } catch (Throwable $e) {}
  }
  $uid = (int)($input['user_id'] ?? 0);
  $uname = trim((string)($input['username'] ?? ''));
  if ($uid > 0 && $uname !== '') {
    try {
      $st = db()->prepare('SELECT * FROM users WHERE id = ? AND username = ? LIMIT 1');
      $st->execute([$uid, $uname]);
      $u = $st->fetch();
      if ($u) return $u;
    } catch (Throwable $e) {}
  }
  return null;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(204); exit; }
$input = nc_input();

if ($method === 'GET' || (($input['action'] ?? '') === '' && $method === 'GET')) {
  $channelId = (int)($input['channel_id'] ?? $_GET['channel_id'] ?? 0);
  $after = (int)($input['after'] ?? $_GET['after'] ?? 0);
  if ($channelId <= 0) nc_out(['ok' => false, 'messages' => []], 400);

  $user = nc_resolve_user($input);
  $meBanned = $user ? nc_banned($channelId, (int)$user['id']) : false;
  $canMod = $user ? nc_is_mod($channelId, $user) : false;

  $rows = [];
  $queries = [
    'SELECT cm.id, cm.message, cm.created_at, cm.user_id, u.username, u.is_verified, u.role
     FROM comments cm JOIN users u ON u.id = cm.user_id
     WHERE cm.channel_id = ? AND COALESCE(cm.is_deleted,0) = 0 AND cm.id > ?
     ORDER BY cm.id ASC LIMIT 80',
    'SELECT cm.id, cm.message, cm.created_at, cm.user_id, u.username, u.is_verified
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
      break;
    } catch (Throwable $e) { $rows = []; }
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
  nc_out([
    'ok' => true,
    'messages' => $messages,
    'comments' => $messages,
    'me_banned' => $meBanned,
    'can_moderate' => $canMod,
  ]);
}

if ($method === 'POST') {
  $user = nc_resolve_user($input);
  if (!$user) nc_out(['ok' => false, 'error' => 'Нужно войти'], 401);
  $action = strtolower(trim((string)($input['action'] ?? 'send')));
  $channelId = (int)($input['channel_id'] ?? 0);
  if ($channelId <= 0) nc_out(['ok' => false, 'error' => 'channel_id'], 400);

  if ($action === 'send' || $action === '') {
    if (nc_banned($channelId, (int)$user['id'])) {
      nc_out(['ok' => false, 'error' => 'Вас заблокировали в этом канале', 'me_banned' => true], 403);
    }
    $message = trim(mb_substr((string)($input['message'] ?? ''), 0, 1000));
    if ($message === '') nc_out(['ok' => false, 'error' => 'Пустое сообщение'], 400);
    try {
      db()->prepare('INSERT INTO comments (channel_id, user_id, message) VALUES (?, ?, ?)')
        ->execute([$channelId, (int)$user['id'], $message]);
      nc_out(['ok' => true, 'id' => (int)db()->lastInsertId()]);
    } catch (Throwable $e) {
      nc_out(['ok' => false, 'error' => 'Не удалось сохранить'], 500);
    }
  }

  if ($action === 'delete' || $action === 'ban') {
    if (!nc_is_mod($channelId, $user)) nc_out(['ok' => false, 'error' => 'Нет прав модератора'], 403);

    $targetUserId = (int)($input['user_id'] ?? 0);
    $commentId = (int)($input['comment_id'] ?? 0);

    if ($commentId > 0 && $targetUserId <= 0) {
      try {
        $st = db()->prepare('SELECT user_id FROM comments WHERE id = ? AND channel_id = ?');
        $st->execute([$commentId, $channelId]);
        $row = $st->fetch();
        if ($row) $targetUserId = (int)$row['user_id'];
      } catch (Throwable $e) {}
    }
    if ($targetUserId <= 0) nc_out(['ok' => false, 'error' => 'user_id'], 400);

    // не баним себя и владельца канала
    try {
      $st = db()->prepare('SELECT owner_id FROM channels WHERE id = ?');
      $st->execute([$channelId]);
      $ch = $st->fetch();
      if ($ch && (int)$ch['owner_id'] === $targetUserId) {
        nc_out(['ok' => false, 'error' => 'Нельзя блокировать владельца канала'], 400);
      }
    } catch (Throwable $e) {}
    if ($targetUserId === (int)$user['id']) {
      nc_out(['ok' => false, 'error' => 'Нельзя блокировать себя'], 400);
    }

    try {
      db()->prepare('INSERT IGNORE INTO chat_bans (channel_id, user_id) VALUES (?, ?)')
        ->execute([$channelId, $targetUserId]);
    } catch (Throwable $e) {}

    // сообщения «сгорают» — soft delete все сообщения автора в канале
    try {
      db()->prepare('UPDATE comments SET is_deleted = 1 WHERE channel_id = ? AND user_id = ?')
        ->execute([$channelId, $targetUserId]);
    } catch (Throwable $e) {
      // если нет is_deleted — hard delete
      try {
        db()->prepare('DELETE FROM comments WHERE channel_id = ? AND user_id = ?')
          ->execute([$channelId, $targetUserId]);
      } catch (Throwable $e2) {}
    }

    if ($commentId > 0) {
      try {
        db()->prepare('UPDATE comments SET is_deleted = 1 WHERE id = ? AND channel_id = ?')
          ->execute([$commentId, $channelId]);
      } catch (Throwable $e) {
        try {
          db()->prepare('DELETE FROM comments WHERE id = ? AND channel_id = ?')
            ->execute([$commentId, $channelId]);
        } catch (Throwable $e2) {}
      }
    }

    nc_out(['ok' => true, 'banned_user_id' => $targetUserId]);
  }

  nc_out(['ok' => false, 'error' => 'unknown action'], 400);
}

nc_out(['ok' => false, 'error' => 'method'], 405);
