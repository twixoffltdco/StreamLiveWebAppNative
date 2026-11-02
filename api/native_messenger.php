<?php
/**
 * StreamLive Native — мессенджер (диалоги + broadcast-каналы).
 * Положить в /api/native_messenger.php на каждом зеркале.
 *
 * GET  ?action=conversations
 * GET  ?action=broadcast_channels&q=
 * GET  ?action=broadcast_channel&slug=
 * POST {"action":"start","user_id":123}  — открыть/создать диалог
 */
require_once dirname(__DIR__) . '/includes/functions.php';
require_once dirname(__DIR__) . '/includes/auth.php';
if (is_file(dirname(__DIR__) . '/includes/contacts.php')) {
  require_once dirname(__DIR__) . '/includes/contacts.php';
  if (function_exists('contacts_ensure_schema')) contacts_ensure_schema();
}

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, X-API-KEY, Cookie');
header('Cache-Control: no-store');

function nm_out(array $a, int $code = 200): void {
  http_response_code($code);
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

$user = function_exists('current_user') ? current_user() : null;
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = '';
$input = [];

if ($method === 'POST') {
  $raw = file_get_contents('php://input');
  $input = json_decode($raw ?: '{}', true) ?: [];
  $action = (string)($input['action'] ?? ($_GET['action'] ?? ''));
} else {
  $action = (string)($_GET['action'] ?? 'conversations');
}

// ---------- Список личных диалогов (messages.php) ----------
if ($action === 'conversations') {
  if (!$user) nm_out(['ok' => false, 'error' => 'Нужно войти'], 401);

  $stmt = db()->prepare(
    "SELECT c.id AS conv_id,
            CASE WHEN c.user_a_id = ? THEN c.user_b_id ELSE c.user_a_id END AS peer_id,
            (SELECT body FROM messages WHERE conversation_id = c.id AND is_deleted = 0 ORDER BY id DESC LIMIT 1) AS last_body,
            (SELECT created_at FROM messages WHERE conversation_id = c.id AND is_deleted = 0 ORDER BY id DESC LIMIT 1) AS last_at,
            (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != ? AND read_at IS NULL AND is_deleted = 0) AS unread
     FROM conversations c
     WHERE c.user_a_id = ? OR c.user_b_id = ?
     ORDER BY c.updated_at DESC
     LIMIT 100"
  );
  $stmt->execute([(int)$user['id'], (int)$user['id'], (int)$user['id'], (int)$user['id']]);
  $conversations = $stmt->fetchAll();

  $peerIds = array_values(array_filter(array_map(function ($r) {
    return (int)$r['peer_id'];
  }, $conversations)));
  $peers = [];
  if ($peerIds) {
    $in = implode(',', array_fill(0, count($peerIds), '?'));
    $st = db()->prepare("SELECT id, username, avatar FROM users WHERE id IN ($in)");
    $st->execute($peerIds);
    foreach ($st->fetchAll() as $p) {
      $peers[(int)$p['id']] = $p;
    }
  }

  $list = [];
  foreach ($conversations as $c) {
    $pid = (int)$c['peer_id'];
    $peer = $peers[$pid] ?? null;
    $list[] = [
      'id' => (int)$c['conv_id'],
      'type' => 'dm',
      'peer_id' => $pid,
      'title' => $peer['username'] ?? ('user#' . $pid),
      'avatar' => $peer['avatar'] ?? null,
      'last_message' => $c['last_body'],
      'last_at' => $c['last_at'],
      'unread' => (int)$c['unread'],
    ];
  }
  nm_out(['ok' => true, 'conversations' => $list]);
}

// ---------- Открыть/создать диалог с пользователем ----------
if ($action === 'start') {
  if (!$user) nm_out(['ok' => false, 'error' => 'Нужно войти'], 401);
  $withId = (int)($input['user_id'] ?? 0);
  if ($withId <= 0 || $withId === (int)$user['id']) {
    nm_out(['ok' => false, 'error' => 'user_id обязателен'], 400);
  }
  if (!function_exists('get_or_create_conversation')) {
    nm_out(['ok' => false, 'error' => 'get_or_create_conversation недоступна'], 500);
  }
  $convId = (int)get_or_create_conversation((int)$user['id'], $withId);
  nm_out(['ok' => true, 'conversation_id' => $convId]);
}

// ---------- Broadcast-каналы (broadcast_channels.php) ----------
if ($action === 'broadcast_channels') {
  $q = trim((string)($_GET['q'] ?? $input['q'] ?? ''));
  if ($q !== '') {
    $stmt = db()->prepare(
      "SELECT bc.id, bc.slug, bc.title, bc.description, bc.avatar_url,
              (SELECT COUNT(*) FROM broadcast_subscribers WHERE channel_id = bc.id) AS subs
       FROM broadcast_channels bc WHERE bc.title LIKE ? ORDER BY subs DESC LIMIT 50"
    );
    $stmt->execute(['%' . $q . '%']);
  } else {
    $stmt = db()->query(
      "SELECT bc.id, bc.slug, bc.title, bc.description, bc.avatar_url,
              (SELECT COUNT(*) FROM broadcast_subscribers WHERE channel_id = bc.id) AS subs
       FROM broadcast_channels bc ORDER BY subs DESC, bc.id DESC LIMIT 50"
    );
  }
  $rows = $stmt->fetchAll();
  $list = array_map(function ($r) {
    return [
      'id' => (int)$r['id'],
      'type' => 'broadcast',
      'slug' => $r['slug'],
      'title' => $r['title'],
      'description' => $r['description'],
      'avatar' => $r['avatar_url'],
      'subs' => (int)$r['subs'],
      'last_message' => null,
      'unread' => 0,
    ];
  }, $rows);
  nm_out(['ok' => true, 'channels' => $list]);
}

if ($action === 'broadcast_channel') {
  $slug = trim((string)($_GET['slug'] ?? $input['slug'] ?? ''));
  if ($slug === '') nm_out(['ok' => false, 'error' => 'slug обязателен'], 400);
  $stmt = db()->prepare('SELECT * FROM broadcast_channels WHERE slug = ? LIMIT 1');
  $stmt->execute([$slug]);
  $ch = $stmt->fetch();
  if (!$ch) nm_out(['ok' => false, 'error' => 'Канал не найден'], 404);
  $subCount = 0;
  try {
    $st = db()->prepare('SELECT COUNT(*) FROM broadcast_subscribers WHERE channel_id = ?');
    $st->execute([(int)$ch['id']]);
    $subCount = (int)$st->fetchColumn();
  } catch (Throwable $e) {}
  nm_out([
    'ok' => true,
    'channel' => [
      'id' => (int)$ch['id'],
      'slug' => $ch['slug'],
      'title' => $ch['title'],
      'description' => $ch['description'] ?? '',
      'avatar' => $ch['avatar_url'] ?? null,
      'owner_id' => (int)$ch['owner_id'],
      'subs' => $subCount,
    ],
  ]);
}


// ---------- Сообщения диалога ----------
if ($action === 'messages') {
  if (!$user) nm_out(['ok' => false, 'error' => 'Нужно войти'], 401);
  $convId = (int)($_GET['conversation_id'] ?? $input['conversation_id'] ?? 0);
  $after = (int)($_GET['after'] ?? $input['after'] ?? 0);
  if ($convId <= 0) nm_out(['ok' => false, 'error' => 'conversation_id обязателен'], 400);

  // доступ только участникам
  $st = db()->prepare('SELECT id FROM conversations WHERE id = ? AND (user_a_id = ? OR user_b_id = ?) LIMIT 1');
  $st->execute([$convId, (int)$user['id'], (int)$user['id']]);
  if (!$st->fetch()) nm_out(['ok' => false, 'error' => 'Диалог недоступен'], 403);

  try {
    if ($after > 0) {
      $st = db()->prepare(
        'SELECT m.id, m.body, m.sender_id, m.created_at, u.username
         FROM messages m LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ? AND m.is_deleted = 0 AND m.id > ?
         ORDER BY m.id ASC LIMIT 100'
      );
      $st->execute([$convId, $after]);
    } else {
      $st = db()->prepare(
        'SELECT m.id, m.body, m.sender_id, m.created_at, u.username
         FROM messages m LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ? AND m.is_deleted = 0
         ORDER BY m.id DESC LIMIT 50'
      );
      $st->execute([$convId]);
    }
    $rows = $st->fetchAll();
    if ($after <= 0) $rows = array_reverse($rows);
  } catch (Throwable $e) {
    // без is_deleted
    try {
      $st = db()->prepare(
        'SELECT m.id, m.body, m.sender_id, m.created_at, u.username
         FROM messages m LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ?' . ($after > 0 ? ' AND m.id > ?' : '') . '
         ORDER BY m.id ASC LIMIT 100'
      );
      $st->execute($after > 0 ? [$convId, $after] : [$convId]);
      $rows = $st->fetchAll();
    } catch (Throwable $e2) {
      nm_out(['ok' => false, 'error' => 'Ошибка чтения сообщений'], 500);
    }
  }

  $list = [];
  foreach ($rows as $m) {
    $list[] = [
      'id' => (int)$m['id'],
      'senderId' => (int)$m['sender_id'],
      'userId' => (int)$m['sender_id'],
      'username' => (string)($m['username'] ?? ''),
      'body' => (string)($m['body'] ?? ''),
      'message' => (string)($m['body'] ?? ''),
      'created_at' => (string)($m['created_at'] ?? ''),
    ];
  }
  // mark read
  try {
    db()->prepare('UPDATE messages SET read_at = NOW() WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL')
      ->execute([$convId, (int)$user['id']]);
  } catch (Throwable $e) {}
  nm_out(['ok' => true, 'messages' => $list]);
}

if ($action === 'send') {
  if (!$user) nm_out(['ok' => false, 'error' => 'Нужно войти'], 401);
  if ($method !== 'POST') nm_out(['ok' => false, 'error' => 'POST only'], 405);
  $convId = (int)($input['conversation_id'] ?? 0);
  $body = trim(mb_substr((string)($input['message'] ?? $input['body'] ?? ''), 0, 4000));
  if ($convId <= 0 || $body === '') nm_out(['ok' => false, 'error' => 'Пустое сообщение'], 400);

  $st = db()->prepare('SELECT id FROM conversations WHERE id = ? AND (user_a_id = ? OR user_b_id = ?) LIMIT 1');
  $st->execute([$convId, (int)$user['id'], (int)$user['id']]);
  if (!$st->fetch()) nm_out(['ok' => false, 'error' => 'Диалог недоступен'], 403);

  try {
    db()->prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)')
      ->execute([$convId, (int)$user['id'], $body]);
    $id = (int)db()->lastInsertId();
    try {
      db()->prepare('UPDATE conversations SET updated_at = NOW() WHERE id = ?')->execute([$convId]);
    } catch (Throwable $e) {}
    nm_out(['ok' => true, 'id' => $id]);
  } catch (Throwable $e) {
    nm_out(['ok' => false, 'error' => 'Не удалось отправить'], 500);
  }
}


nm_out(['ok' => false, 'error' => 'Неизвестное action'], 400);
