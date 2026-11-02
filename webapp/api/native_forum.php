<?php
/**
 * StreamLive Native — форум: тема с ответами, ответ, новая тема.
 * Положить в /api/native_forum.php на каждом зеркале.
 *
 * GET  ?action=thread&id=123
 * POST {"action":"reply","thread_id":123,"message":"..."}
 * POST {"action":"new_thread","category_id":1,"title":"...","message":"..."}
 *
 * Модерация такая же, как на сайте: новые темы/ответы идут через cmod_enqueue
 * и пока не одобрены видны только автору и модераторам.
 */
require_once dirname(dirname(__DIR__)) . '/includes/functions.php';
require_once dirname(dirname(__DIR__)) . '/includes/auth.php';
foreach (['content_moderation.php', 'forum_visibility.php', 'verified_moderation.php'] as $f) {
  if (is_file(dirname(dirname(__DIR__)) . '/includes/' . $f)) require_once dirname(dirname(__DIR__)) . '/includes/' . $f;
}

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, X-API-KEY, Cookie');
header('Cache-Control: no-store');

function nf_out(array $a, int $code = 200): void {
  http_response_code($code);
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

$user = function_exists('current_user') ? current_user() : null;
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$input = [];
$action = (string)($_GET['action'] ?? 'thread');
if ($method === 'POST') {
  $input = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
  $action = (string)($input['action'] ?? $action);
}

if ($action === 'thread') {
  $id = (int)($_GET['id'] ?? 0);
  $st = db()->prepare('SELECT t.*, fc.title AS category_title FROM forum_threads t
                       JOIN forum_categories fc ON fc.id = t.category_id
                       WHERE t.id = ? AND t.is_deleted = 0');
  $st->execute([$id]);
  $thread = $st->fetch();
  if (!$thread) nf_out(['ok' => false, 'error' => 'Тема не найдена'], 404);
  if (function_exists('forum_row_visible') && !forum_row_visible($thread, $user)) {
    nf_out(['ok' => false, 'error' => 'Тема на модерации'], 403);
  }
  $st = db()->prepare('SELECT fp.*, u.username FROM forum_posts fp
                       JOIN users u ON u.id = fp.user_id
                       WHERE fp.thread_id = ? AND fp.is_deleted = 0
                       ORDER BY fp.created_at ASC, fp.id ASC LIMIT 300');
  $st->execute([$id]);
  $rows = $st->fetchAll();
  if (function_exists('forum_filter_rows')) $rows = forum_filter_rows($rows, $user);
  $posts = array_map(static function ($r) {
    return [
      'id' => (int)$r['id'],
      'author' => (string)$r['username'],
      'message' => (string)$r['message'],
      'created_at' => (string)($r['created_at'] ?? ''),
    ];
  }, $rows);
  nf_out([
    'ok' => true,
    'thread' => [
      'id' => (int)$thread['id'],
      'title' => (string)$thread['title'],
      'category' => (string)$thread['category_title'],
      'is_locked' => !empty($thread['is_locked']),
    ],
    'posts' => $posts,
  ]);
}


/* ---- categories list ---- */
if ($action === 'categories' || $action === 'sections') {
  try {
    $rows = db()->query('SELECT id, title, description,
      (SELECT COUNT(*) FROM forum_threads t WHERE t.category_id = forum_categories.id AND t.is_deleted = 0) AS thread_count
      FROM forum_categories ORDER BY id ASC')->fetchAll();
  } catch (Throwable $e) {
    try {
      $rows = db()->query('SELECT id, title, description FROM forum_categories ORDER BY id ASC')->fetchAll();
    } catch (Throwable $e2) {
      nf_out(['ok' => false, 'error' => 'Нет таблицы форума'], 500);
    }
  }
  $out = [];
  foreach ($rows as $r) {
    $out[] = [
      'id' => (int)$r['id'],
      'title' => (string)$r['title'],
      'name' => (string)$r['title'],
      'description' => (string)($r['description'] ?? ''),
      'threads_count' => (int)($r['thread_count'] ?? 0),
      'thread_count' => (int)($r['thread_count'] ?? 0),
    ];
  }
  nf_out(['ok' => true, 'categories' => $out, 'sections' => $out]);
}

/* ---- threads in category ---- */
if ($action === 'threads') {
  $catId = (int)($_GET['category_id'] ?? $_GET['section_id'] ?? 0);
  $limit = min(50, max(1, (int)($_GET['limit'] ?? 30)));
  try {
    if ($catId > 0) {
      $st = db()->prepare('SELECT t.id, t.title, t.created_at, t.replies_count, u.username
        FROM forum_threads t LEFT JOIN users u ON u.id = t.user_id
        WHERE t.category_id = ? AND t.is_deleted = 0
        ORDER BY t.id DESC LIMIT ' . (int)$limit);
      $st->execute([$catId]);
    } else {
      $st = db()->query('SELECT t.id, t.title, t.created_at, t.replies_count, u.username
        FROM forum_threads t LEFT JOIN users u ON u.id = t.user_id
        WHERE t.is_deleted = 0 ORDER BY t.id DESC LIMIT ' . (int)$limit);
    }
    $rows = $st->fetchAll();
  } catch (Throwable $e) {
    // fallback without replies_count
    try {
      if ($catId > 0) {
        $st = db()->prepare('SELECT t.id, t.title, t.created_at, u.username
          FROM forum_threads t LEFT JOIN users u ON u.id = t.user_id
          WHERE t.category_id = ? AND COALESCE(t.is_deleted,0) = 0
          ORDER BY t.id DESC LIMIT ' . (int)$limit);
        $st->execute([$catId]);
      } else {
        $st = db()->query('SELECT t.id, t.title, t.created_at, u.username
          FROM forum_threads t LEFT JOIN users u ON u.id = t.user_id
          WHERE COALESCE(t.is_deleted,0) = 0 ORDER BY t.id DESC LIMIT ' . (int)$limit);
      }
      $rows = $st->fetchAll();
    } catch (Throwable $e2) {
      nf_out(['ok' => false, 'error' => 'Ошибка загрузки тем'], 500);
    }
  }
  if (function_exists('forum_filter_rows')) {
    try { $rows = forum_filter_rows($rows, $user); } catch (Throwable $e) {}
  }
  $out = [];
  foreach ($rows as $r) {
    $out[] = [
      'id' => (int)$r['id'],
      'title' => (string)$r['title'],
      'username' => (string)($r['username'] ?? ''),
      'author' => (string)($r['username'] ?? ''),
      'replies' => (int)($r['replies_count'] ?? 0),
      'created_at' => (string)($r['created_at'] ?? ''),
    ];
  }
  nf_out(['ok' => true, 'threads' => $out]);
}


if ($method !== 'POST') nf_out(['ok' => false, 'error' => 'POST only'], 405);
if (!$user) nf_out(['ok' => false, 'error' => 'Войдите в аккаунт'], 401);
if (!empty($user['is_banned'])) nf_out(['ok' => false, 'error' => 'Аккаунт заблокирован'], 403);

if ($action === 'reply') {
  $threadId = (int)($input['thread_id'] ?? 0);
  $message = trim(mb_substr((string)($input['message'] ?? ''), 0, 20000));
  if ($message === '') nf_out(['ok' => false, 'error' => 'Пустое сообщение'], 400);
  $st = db()->prepare('SELECT * FROM forum_threads WHERE id = ? AND is_deleted = 0');
  $st->execute([$threadId]);
  $thread = $st->fetch();
  if (!$thread) nf_out(['ok' => false, 'error' => 'Тема не найдена'], 404);
  if (!empty($thread['is_locked'])) nf_out(['ok' => false, 'error' => 'Тема закрыта'], 403);

  db()->prepare('INSERT INTO forum_posts (thread_id, user_id, message) VALUES (?, ?, ?)')
    ->execute([$threadId, $user['id'], $message]);
  $postId = (int)db()->lastInsertId();
  $pending = false;
  if (function_exists('cmod_enqueue') && $postId > 0) {
    try {
      cmod_enqueue('post', $postId, (int)$user['id'], (string)$thread['title'], mb_substr($message, 0, 300));
      $pending = true;
    } catch (Throwable $e) {}
  }
  if (!$pending) {
    if (function_exists('forum_bump_reply_stats')) { try { forum_bump_reply_stats($threadId, (int)$user['id']); } catch (Throwable $e) {} }
    if (function_exists('forum_bump_last_post')) { try { forum_bump_last_post($threadId); } catch (Throwable $e) {} }
  }
  nf_out(['ok' => true, 'id' => $postId, 'pending' => $pending,
    'message' => $pending ? 'Ответ отправлен на модерацию. Вы видите его у себя, остальные — после одобрения.' : 'Ответ опубликован']);
}

if ($action === 'new_thread') {
  $categoryId = (int)($input['category_id'] ?? 0);
  $title = trim(mb_substr((string)($input['title'] ?? ''), 0, 200));
  $message = trim(mb_substr((string)($input['message'] ?? ''), 0, 20000));
  if ($title === '' || $message === '') nf_out(['ok' => false, 'error' => 'Укажите заголовок и текст'], 400);
  $st = db()->prepare('SELECT id FROM forum_categories WHERE id = ?');
  $st->execute([$categoryId]);
  if (!$st->fetch()) nf_out(['ok' => false, 'error' => 'Раздел не найден'], 404);

  if (function_exists('verified_rate_limit_ok')) {
    $rl = verified_rate_limit_ok($user, 'forum_thread');
    if (empty($rl['ok'])) nf_out(['ok' => false, 'error' => $rl['error'] ?? 'Лимит создания тем (раз в 24 часа)'], 429);
  }

  $pdo = db();
  $pdo->beginTransaction();
  try {
    $pdo->prepare('INSERT INTO forum_threads (category_id, user_id, title) VALUES (?, ?, ?)')
        ->execute([$categoryId, $user['id'], $title]);
    $threadId = (int)$pdo->lastInsertId();
    $pdo->prepare('INSERT INTO forum_posts (thread_id, user_id, message) VALUES (?, ?, ?)')
        ->execute([$threadId, $user['id'], $message]);
    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    nf_out(['ok' => false, 'error' => 'Не удалось создать тему'], 500);
  }

  $pending = false;
  if (function_exists('cmod_enqueue') && $threadId > 0) {
    try {
      cmod_enqueue('thread', $threadId, (int)$user['id'], $title, mb_substr($message, 0, 300));
      db()->prepare("UPDATE forum_threads SET mod_status='pending' WHERE id=?")->execute([$threadId]);
      $pending = true;
    } catch (Throwable $e) {}
    try {
      $pid = (int)db()->query('SELECT id FROM forum_posts WHERE thread_id=' . (int)$threadId . ' ORDER BY id ASC LIMIT 1')->fetchColumn();
      if ($pid > 0) {
        cmod_enqueue('post', $pid, (int)$user['id'], $title, mb_substr($message, 0, 300));
        db()->prepare("UPDATE forum_posts SET mod_status='pending' WHERE id=?")->execute([$pid]);
      }
    } catch (Throwable $e) {}
  }
  nf_out(['ok' => true, 'id' => $threadId, 'pending' => $pending,
    'message' => $pending ? 'Тема отправлена на модерацию. Вы видите её у себя, остальные — после одобрения.' : 'Тема создана']);
}

nf_out(['ok' => false, 'error' => 'Неизвестное действие'], 400);
