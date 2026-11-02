<?php
/**
 * StreamLive Native — главная: список каналов (ТВ/радио).
 * GET ?type=channels&limit=50&type_filter=tv|radio
 * GET ?action=ping
 */
require_once dirname(dirname(__DIR__)) . '/includes/functions.php';
require_once dirname(dirname(__DIR__)) . '/includes/auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function nh_out(array $a, int $code = 200): void {
  http_response_code($code);
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

$action = (string)($_GET['action'] ?? '');
if ($action === 'ping') nh_out(['ok' => true, 't' => time()]);

$type = (string)($_GET['type'] ?? 'channels');
$limit = min(100, max(1, (int)($_GET['limit'] ?? 50)));
$filter = strtolower(trim((string)($_GET['type_filter'] ?? '')));

try {
  $sql = "SELECT id, slug, title, description, logo_url, type, views, status, created_at
          FROM channels WHERE status = 'approved'";
  $params = [];
  if ($filter === 'tv' || $filter === 'radio') {
    $sql .= ' AND type = ?';
    $params[] = $filter;
  }
  $sql .= ' ORDER BY views DESC, id DESC LIMIT ' . (int)$limit;
  $st = db()->prepare($sql);
  $st->execute($params);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
  $out = [];
  foreach ($rows as $r) {
    $logo = (string)($r['logo_url'] ?? '');
    if ($logo !== '' && $logo[0] === '/') {
      // relative ok for client
    }
    $out[] = [
      'id' => (int)$r['id'],
      'slug' => (string)$r['slug'],
      'title' => (string)$r['title'],
      'name' => (string)$r['title'],
      'description' => (string)($r['description'] ?? ''),
      'logo_url' => $logo,
      'type' => (string)($r['type'] ?? 'tv'),
      'views' => (int)($r['views'] ?? 0),
    ];
  }
  nh_out(['ok' => true, 'channels' => $out, 'data' => $out]);
} catch (Throwable $e) {
  nh_out(['ok' => false, 'error' => 'Ошибка загрузки каналов'], 500);
}
