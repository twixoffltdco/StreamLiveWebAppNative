<?php
/**
 * Платные игры WebApp.
 * Auth: session cookie ИЛИ X-API-KEY ИЛИ user_id+username (мягко, для WebApp).
 */
$SL_ROOT = dirname(__DIR__);
if (!is_file($SL_ROOT . '/includes/functions.php')) {
  $SL_ROOT = dirname(dirname(__DIR__)); // webapp/api → site root
}
require_once $SL_ROOT . '/includes/functions.php';
require_once $SL_ROOT . '/includes/auth.php';
if (is_file($SL_ROOT . '/includes/api_auth.php')) require_once $SL_ROOT . '/includes/api_auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, X-API-KEY, Cookie');
header('Access-Control-Allow-Credentials: true');
header('Cache-Control: no-store');

function ng_out(array $a, int $code = 200): void {
  http_response_code($code);
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function ng_ensure_table(): void {
  static $done = false;
  if ($done) return;
  $done = true;
  try {
    db()->exec("CREATE TABLE IF NOT EXISTS paid_games (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL DEFAULT 0,
      title VARCHAR(150) NOT NULL,
      description VARCHAR(1000) DEFAULT '',
      url VARCHAR(500) NOT NULL,
      price_sparks INT UNSIGNED NOT NULL DEFAULT 50,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  } catch (Throwable $e) {}
}

function ng_looks_like_game(string $url): array {
  $url = trim($url);
  if (!preg_match('#^https?://#i', $url)) {
    return [false, 'URL должен начинаться с http:// или https://'];
  }
  $p = parse_url($url);
  if (!$p || empty($p['host'])) return [false, 'Некорректный URL'];
  $host = strtolower($p['host']);
  $path = strtolower($p['path'] ?? '/');
  $full = strtolower($url);
  $gameHosts = [
    'itch.io', 'newgrounds.com', 'crazygames.com', 'poki.com', 'gamejolt.com',
    'kongregate.com', 'armor.games', 'miniclip.com', 'y8.com', 'io-games.io',
    'github.io', 'raw.githack.com', 'gamedistribution.com',
    'unityroom.com', 'simmer.io', 'playhop.com', 'gamepix.com', 'gameflare.com',
  ];
  foreach ($gameHosts as $h) {
    if ($host === $h || (function_exists('str_ends_with') && str_ends_with($host, '.' . $h)) || substr($host, -strlen($h)-1) === '.'.$h) {
      return [true, ''];
    }
  }
  $keys = ['game', 'play', 'arcade', 'unity', 'html5', 'wasm', 'phaser', 'construct', 'godot', 'embed', 'swf'];
  foreach ($keys as $k) {
    if (strpos($path, $k) !== false || strpos($full, $k) !== false) return [true, ''];
  }
  if (preg_match('#\.(html?|swf|unityweb|data|wasm)(\?|$)#i', $path)) return [true, ''];
  if ($path === '/' || $path === '' || $path === '/index.html' || $path === '/index.php') {
    return [false, 'Нужна ссылка на игру, а не на главную сайта'];
  }
  $parts = array_values(array_filter(explode('/', $path)));
  if (count($parts) >= 2) return [true, ''];
  return [false, 'Ссылка не похожа на игру'];
}

/** Resolve user: session → api key → posted user_id+username */
function ng_resolve_user(array $input): ?array {
  if (function_exists('current_user')) {
    $u = current_user();
    if ($u && !empty($u['id'])) return $u;
  }
  $key = $_SERVER['HTTP_X_API_KEY'] ?? ($input['api_key'] ?? '');
  $key = trim((string)$key);
  if ($key !== '' && function_exists('api_key_user')) {
    try {
      $u = api_key_user($key);
      if ($u) return $u;
    } catch (Throwable $e) {}
  }
  if ($key !== '') {
    try {
      // common patterns
      if (function_exists('api_auth_user_by_key')) {
        $u = api_auth_user_by_key($key);
        if ($u) return $u;
      }
    } catch (Throwable $e) {}
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

ng_ensure_table();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(204); exit; }

$raw = file_get_contents('php://input') ?: '';
$input = json_decode($raw, true);
if (!is_array($input)) $input = [];
if (!$input) $input = $_POST ?: [];
if (!$input && $raw !== '') { parse_str($raw, $p); if (is_array($p)) $input = $p; }
if ($method === 'GET') {
  foreach ($_GET as $k => $v) { if (!isset($input[$k])) $input[$k] = $v; }
}

$action = strtolower(trim((string)($input['action'] ?? $_GET['action'] ?? 'list')));

if ($action === 'list') {
  try {
    $rows = db()->query(
      "SELECT pg.id, pg.title, pg.description, pg.url, pg.price_sparks, pg.status, u.username
       FROM paid_games pg LEFT JOIN users u ON u.id = pg.user_id
       WHERE pg.status = 'approved' ORDER BY pg.id DESC LIMIT 80"
    )->fetchAll();
  } catch (Throwable $e) {
    $rows = [];
  }
  ng_out(['ok' => true, 'games' => $rows]);
}

if ($method === 'POST' && $action === 'submit') {
  $user = ng_resolve_user($input);
  if (!$user) {
    ng_out(['ok' => false, 'error' => 'Войдите в аккаунт в приложении (Профиль → Войти), затем добавьте игру'], 401);
  }
  $title = trim(mb_substr((string)($input['title'] ?? ''), 0, 150));
  $url = trim(mb_substr((string)($input['url'] ?? ''), 0, 500));
  $desc = trim(mb_substr((string)($input['description'] ?? ''), 0, 1000));
  $price = max(1, min(100000, (int)($input['price_sparks'] ?? 50)));
  if ($title === '' || $url === '') ng_out(['ok' => false, 'error' => 'Укажи название и ссылку'], 400);
  [$ok, $err] = ng_looks_like_game($url);
  if (!$ok) ng_out(['ok' => false, 'error' => $err], 400);
  try {
    db()->prepare('INSERT INTO paid_games (user_id, title, description, url, price_sparks, status) VALUES (?,?,?,?,?,"approved")')
      ->execute([(int)$user['id'], $title, $desc, $url, $price]);
    ng_out(['ok' => true, 'id' => (int)db()->lastInsertId(), 'status' => 'approved', 'user_id' => (int)$user['id']]);
  } catch (Throwable $e) {
    ng_out(['ok' => false, 'error' => 'db: ' . $e->getMessage()], 500);
  }
}

if ($method === 'POST' && $action === 'buy') {
  $id = (int)($input['id'] ?? 0);
  $st = db()->prepare("SELECT id, title, url, price_sparks FROM paid_games WHERE id = ? AND status = 'approved'");
  $st->execute([$id]);
  $g = $st->fetch();
  if (!$g) ng_out(['ok' => false, 'error' => 'Игра недоступна'], 404);
  ng_out(['ok' => true, 'game' => $g]);
}

ng_out(['ok' => false, 'error' => 'method'], 405);
