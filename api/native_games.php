<?php
/**
 * Платные игры WebApp — без модерации, сразу approved.
 * Проверка: ссылка должна быть похожа на игру (не просто «сайт»).
 * Искры списываются на клиенте и сгорают.
 *
 * GET  ?action=list
 * POST {action:"submit", title, url, price_sparks, description?}
 * POST {action:"buy", id}
 */
require_once dirname(__DIR__) . '/includes/functions.php';
require_once dirname(__DIR__) . '/includes/auth.php';

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
      user_id INT UNSIGNED NOT NULL,
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

/** Ссылка должна выглядеть как игра, не просто главная сайта. */
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

  // Известные игровые площадки / расширения
  $gameHosts = [
    'itch.io', 'newgrounds.com', 'crazygames.com', 'poki.com', 'gamejolt.com',
    'kongregate.com', 'armor.games', 'miniclip.com', 'y8.com', 'io-games.io',
    'github.io', 'raw.githack.com', 'gamedistribution.com', 'gamedistribution.com',
    'unityroom.com', 'simmer.io', 'playhop.com', 'gamepix.com', 'gameflare.com',
  ];
  foreach ($gameHosts as $h) {
    if ($host === $h || str_ends_with($host, '.' . $h)) return [true, ''];
  }

  // path keywords
  $keys = ['game', 'play', 'arcade', 'unity', 'html5', 'wasm', 'phaser', 'construct', 'godot', 'embed', 'swf'];
  foreach ($keys as $k) {
    if (strpos($path, $k) !== false || strpos($full, $k) !== false) return [true, ''];
  }

  // file-like game ends
  if (preg_match('#\.(html?|swf|unityweb|data|wasm)(\?|$)#i', $path)) return [true, ''];

  // bare domain homepage — reject
  if ($path === '/' || $path === '' || $path === '/index.html' || $path === '/index.php') {
    return [false, 'Нужна ссылка на игру, а не на главную сайта'];
  }

  // deep path with 2+ segments — allow cautiously
  $parts = array_values(array_filter(explode('/', $path)));
  if (count($parts) >= 2) return [true, ''];

  return [false, 'Ссылка не похожа на игру. Укажи прямую ссылку на play/game/html5'];
}

ng_ensure_table();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$user = function_exists('current_user') ? current_user() : null;
$input = [];
if ($method === 'POST') {
  $input = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
}
$action = strtolower(trim((string)($_GET['action'] ?? $input['action'] ?? 'list')));

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
  if (!$user) ng_out(['ok' => false, 'error' => 'Нужно войти'], 401);
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
    ng_out(['ok' => true, 'id' => (int)db()->lastInsertId(), 'status' => 'approved']);
  } catch (Throwable $e) {
    ng_out(['ok' => false, 'error' => 'db'], 500);
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
