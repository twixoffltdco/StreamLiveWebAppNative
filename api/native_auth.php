<?php
/**
 * StreamLive Native Auth — вход / регистрация / 2FA (как на сайте v28.53).
 *
 * POST JSON:
 *   {action:"login", login, password, code?}     — пароль, при 2FA нужен code
 *   {action:"login_2fa", login, code}            — ТОЛЬКО логин + код 2FA (без пароля)
 *   {action:"register", email, username, password, phone?}
 *   {action:"me"}
 *   {action:"logout"}
 */
require_once dirname(__DIR__) . '/includes/functions.php';
require_once dirname(__DIR__) . '/includes/auth.php';
if (is_file(dirname(__DIR__) . '/includes/api_auth.php')) require_once dirname(__DIR__) . '/includes/api_auth.php';
if (is_file(dirname(__DIR__) . '/includes/totp.php')) require_once dirname(__DIR__) . '/includes/totp.php';
if (is_file(dirname(__DIR__) . '/includes/contacts.php')) {
  try { require_once dirname(__DIR__) . '/includes/contacts.php'; } catch (Throwable $e) {}
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function na_out(array $a, int $code = 200): void {
  http_response_code($code);
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function na_user_payload(array $u): array {
  return [
    'id' => (int)$u['id'],
    'username' => (string)($u['username'] ?? ''),
    'email' => (string)($u['email'] ?? ''),
    'avatar_url' => (string)($u['avatar_url'] ?? ''),
    'role' => (string)($u['role'] ?? 'user'),
  ];
}

function na_session_payload(int $userId, array $u): array {
  $key = '';
  if (function_exists('api_key_get_or_rotate')) {
    try { $key = (string)api_key_get_or_rotate($userId); } catch (Throwable $e) {}
  }
  return [
    'ok' => true,
    'user' => na_user_payload($u),
    'api_key' => $key,
    'session_name' => session_name(),
    'session_id' => session_id(),
  ];
}

function na_find_user(string $login): ?array {
  $login = trim($login);
  if ($login === '') return null;
  $user = null;

  if (function_exists('normalize_phone')) {
    $np = normalize_phone($login);
    if ($np) {
      try {
        $st = db()->prepare('SELECT * FROM users WHERE phone = ? LIMIT 1');
        $st->execute([$np]);
        $user = $st->fetch() ?: null;
        if ($user) return $user;
      } catch (Throwable $e) {}
    }
  }

  if (filter_var($login, FILTER_VALIDATE_EMAIL)) {
    try {
      $st = db()->prepare('SELECT * FROM users WHERE email = ? OR LOWER(email) = LOWER(?) LIMIT 1');
      $st->execute([$login, $login]);
      $user = $st->fetch() ?: null;
      if ($user) return $user;
    } catch (Throwable $e) {}
  }

  foreach (['username', 'email', 'phone'] as $col) {
    try {
      $st = db()->prepare("SELECT * FROM users WHERE {$col} = ? LIMIT 1");
      $st->execute([$login]);
      $user = $st->fetch() ?: null;
      if ($user) return $user;
    } catch (Throwable $e) {}
  }

  try {
    $st = db()->prepare('SELECT * FROM users WHERE LOWER(email)=LOWER(?) OR username=? LIMIT 1');
    $st->execute([$login, $login]);
    $user = $st->fetch() ?: null;
  } catch (Throwable $e) {}

  return $user ?: null;
}

function na_check_ban(array &$user): ?string {
  if (!empty($user['is_banned']) && function_exists('contacts_maybe_unban')) {
    try {
      contacts_maybe_unban((int)$user['id']);
      $st = db()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
      $st->execute([(int)$user['id']]);
      $fresh = $st->fetch();
      if ($fresh) $user = $fresh;
    } catch (Throwable $e) {}
  }
  if (!empty($user['is_banned'])) {
    $until = !empty($user['banned_until']) ? (' (до ' . $user['banned_until'] . ')') : '';
    return 'Аккаунт временно заблокирован' . $until;
  }
  return null;
}

// GET me для прогрева (обход части anti-bot) + POST login/register
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
  $action = (string)($_GET['action'] ?? 'ping');
  if ($action === 'ping') {
    na_out(['ok' => true, 'ping' => 1, 'path' => 'auth']);
  }
  if ($action === 'me') {
    $u = function_exists('current_user') ? current_user() : null;
    if (!$u) na_out(['ok' => false, 'error' => 'Не авторизован'], 401);
    na_out(['ok' => true, 'user' => na_user_payload($u)]);
  }
  na_out(['ok' => false, 'error' => 'GET: action=ping|me'], 400);
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') na_out(['ok' => false, 'error' => 'POST only'], 405);
// JSON или application/x-www-form-urlencoded (WAF часто режет только JSON)
$raw = file_get_contents('php://input') ?: '';
$in = json_decode($raw, true);
if (!is_array($in)) $in = [];
if (!$in) {
  $in = $_POST ?: [];
}
if (!$in && $raw !== '') {
  parse_str($raw, $parsed);
  if (is_array($parsed)) $in = $parsed;
}
$action = (string)($in['action'] ?? $_GET['action'] ?? '');

/* ---- me ---- */
if ($action === 'me') {
  $u = current_user();
  if (!$u) na_out(['ok' => false, 'error' => 'Не авторизован'], 401);
  na_out(['ok' => true, 'user' => na_user_payload($u)]);
}

/* ---- logout ---- */
if ($action === 'logout') {
  $_SESSION = [];
  if (session_status() === PHP_SESSION_ACTIVE) @session_destroy();
  na_out(['ok' => true]);
}

/* ---- login: password (+ optional 2FA) ---- */
if ($action === 'login') {
  $login = trim((string)($in['login'] ?? $in['email'] ?? ''));
  $password = (string)($in['password'] ?? '');
  $code = preg_replace('/\s+/', '', (string)($in['code'] ?? ''));
  if ($login === '' || $password === '') {
    na_out(['ok' => false, 'error' => 'Введите логин и пароль'], 400);
  }

  $user = na_find_user($login);
  if (!$user || empty($user['password_hash']) || !password_verify($password, $user['password_hash'])) {
    na_out(['ok' => false, 'error' => 'Неверный логин или пароль'], 401);
  }

  $ban = na_check_ban($user);
  if ($ban) na_out(['ok' => false, 'error' => $ban], 403);

  $user2fa = !empty($user['totp_enabled']) && !empty($user['totp_secret']);
  $force2fa = function_exists('get_setting') && get_setting('force_2fa_enabled', '0') === '1';

  if ($user2fa) {
    if ($code === '') {
      na_out(['ok' => false, 'need_2fa' => true, 'error' => 'Введите код из приложения-аутентификатора']);
    }
    if (!class_exists('Totp') || !Totp::verify($user['totp_secret'], $code)) {
      na_out(['ok' => false, 'need_2fa' => true, 'error' => 'Неверный код 2FA. Проверьте время на телефоне.'], 401);
    }
  } elseif ($force2fa) {
    // На сайте уводят на настройку 2FA — в приложении просим включить на сайте
    na_out(['ok' => false, 'error' => 'На сайте включена обязательная 2FA. Включите её в профиле на сайте, затем войдите.'], 403);
  }

  login_user((int)$user['id']);
  try { db()->prepare('UPDATE users SET last_seen=NOW() WHERE id=?')->execute([(int)$user['id']]); } catch (Throwable $e) {}
  na_out(na_session_payload((int)$user['id'], $user));
}

/* ---- login_2fa: логин + код БЕЗ пароля (как mode=totp_only на сайте) ---- */
if ($action === 'login_2fa' || $action === 'totp_only') {
  $login = trim((string)($in['login'] ?? $in['email'] ?? ''));
  $code = preg_replace('/\s+/', '', (string)($in['code'] ?? ''));
  if ($login === '' || $code === '') {
    na_out(['ok' => false, 'error' => 'Введите логин и код 2FA'], 400);
  }

  $user = na_find_user($login);
  if (!$user || empty($user['totp_enabled']) || empty($user['totp_secret'])) {
    na_out(['ok' => false, 'error' => 'Нужен аккаунт с включённой 2FA, либо войдите паролем.'], 401);
  }

  $ban = na_check_ban($user);
  if ($ban) na_out(['ok' => false, 'error' => $ban], 403);

  if (!class_exists('Totp') || !Totp::verify($user['totp_secret'], $code)) {
    na_out(['ok' => false, 'error' => 'Неверный код 2FA. Проверьте время на телефоне.'], 401);
  }

  login_user((int)$user['id']);
  try { db()->prepare('UPDATE users SET last_seen=NOW() WHERE id=?')->execute([(int)$user['id']]); } catch (Throwable $e) {}
  na_out(na_session_payload((int)$user['id'], $user));
}

/* ---- register ---- */
if ($action === 'register') {
  $email = trim((string)($in['email'] ?? ''));
  $username = trim((string)($in['username'] ?? $in['login'] ?? ''));
  $password = (string)($in['password'] ?? '');
  $phoneRaw = trim((string)($in['phone'] ?? ''));

  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    na_out(['ok' => false, 'error' => 'Укажите корректный email'], 400);
  }
  if (mb_strlen($username) < 3 || mb_strlen($username) > 30) {
    na_out(['ok' => false, 'error' => 'Логин: от 3 до 30 символов'], 400);
  }
  if (mb_strlen($password) < 6) {
    na_out(['ok' => false, 'error' => 'Пароль: минимум 6 символов'], 400);
  }

  $phone = null;
  if ($phoneRaw !== '') {
    if (function_exists('normalize_phone')) {
      $phone = normalize_phone($phoneRaw);
      if (!$phone) {
        na_out(['ok' => false, 'error' => 'Телефон в формате +79991234567 или оставьте пустым'], 400);
      }
    } else {
      $phone = $phoneRaw;
    }
  }

  try {
    if ($phone) {
      $st = db()->prepare('SELECT id FROM users WHERE email = ? OR username = ? OR phone = ?');
      $st->execute([$email, $username, $phone]);
    } else {
      $st = db()->prepare('SELECT id FROM users WHERE email = ? OR username = ?');
      $st->execute([$email, $username]);
    }
    if ($st->fetch()) {
      na_out(['ok' => false, 'error' => 'Такой email, логин или номер уже используется'], 409);
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    if ($phone) {
      $st = db()->prepare('INSERT INTO users (email, username, password_hash, phone) VALUES (?, ?, ?, ?)');
      $st->execute([$email, $username, $hash, $phone]);
    } else {
      $st = db()->prepare('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)');
      $st->execute([$email, $username, $hash]);
    }
    $id = (int)db()->lastInsertId();
    if ($id > 0 && function_exists('partners_capture_referral')) {
      try { partners_capture_referral($id); } catch (Throwable $e) {}
    }
    $st = db()->prepare('SELECT * FROM users WHERE id = ?');
    $st->execute([$id]);
    $user = $st->fetch();
    login_user($id);
    na_out(na_session_payload($id, $user));
  } catch (Throwable $e) {
    na_out(['ok' => false, 'error' => 'Ошибка регистрации. Попробуйте другой логин/email.'], 500);
  }
}

na_out(['ok' => false, 'error' => 'Неизвестное действие: ' . $action], 400);
