/* StreamLive — оффлайн-игры (порт из StreamLiveStarter/lib/screens/games.dart). Без сети, без библиотек. */
(function () {
  'use strict';

  /* ---------- утилиты ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function h(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'style') e.style.cssText = attrs[k]; else e[k] = attrs[k]; }
    if (html != null) e.innerHTML = html;
    return e;
  }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem('slg_' + k); localStorage.setItem('slg_' + k, String(v)); } catch (e) {} return null; }
  function onSwipe(el, cb) {
    var sx = 0, sy = 0, on = false;
    el.addEventListener('touchstart', function (e) { var t = e.touches[0]; sx = t.clientX; sy = t.clientY; on = true; }, {passive: true});
    el.addEventListener('touchmove', function (e) { if (on) e.preventDefault(); }, {passive: false});
    el.addEventListener('touchend', function (e) {
      if (!on) return; on = false;
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      cb(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }, {passive: true});
  }
  var KEYDIR = {ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down'};

  /* ---------- 2048 ---------- */
  function slide2048(row) {
    var a = row.filter(Boolean), out = [], sc = 0;
    for (var i = 0; i < a.length; i++) {
      if (a[i] === a[i + 1]) { out.push(a[i] * 2); sc += a[i] * 2; i++; } else out.push(a[i]);
    }
    while (out.length < 4) out.push(0);
    return [out, sc];
  }
  function g2048(el, ui) {
    var b, score, best = +store('2048best') || 0, over, won;
    var colors = {0: '#2a2342', 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e'};
    var info = h('div', {class: 'g-info'}), grid = h('div', {class: 'g-grid g2048'}), msg = h('div', {class: 'g-msg'});
    var nb = h('button', {class: 'v-btn ghost g-small', type: 'button'}, 'Новая игра');
    el.appendChild(info); el.appendChild(grid); el.appendChild(msg); el.appendChild(nb);
    function add() { var e = []; for (var i = 0; i < 16; i++) if (!b[i]) e.push(i); if (e.length) b[e[rnd(e.length)]] = Math.random() < .9 ? 2 : 4; }
    function reset() { b = new Array(16).fill(0); score = 0; over = false; won = false; add(); add(); draw(); }
    function get(r, c) { return b[r * 4 + c]; }
    function move(dir) {
      if (over) return;
      var moved = false, gain = 0, nbd = b.slice();
      for (var i = 0; i < 4; i++) {
        var line = [];
        for (var j = 0; j < 4; j++) {
          var r = dir === 'up' ? j : dir === 'down' ? 3 - j : i, c = dir === 'left' ? j : dir === 'right' ? 3 - j : i;
          line.push(get(r, c));
        }
        var res = slide2048(line); gain += res[1];
        for (j = 0; j < 4; j++) {
          r = dir === 'up' ? j : dir === 'down' ? 3 - j : i; c = dir === 'left' ? j : dir === 'right' ? 3 - j : i;
          nbd[r * 4 + c] = res[0][j];
        }
      }
      for (i = 0; i < 16; i++) if (nbd[i] !== b[i]) moved = true;
      if (!moved) return;
      b = nbd; score += gain; add();
      if (score > best) { best = score; store('2048best', best); }
      if (b.indexOf(2048) >= 0 && !won) won = true;
      if (!canMove()) over = true;
      draw();
    }
    function canMove() {
      for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
        var v = get(r, c); if (!v) return true;
        if (c < 3 && get(r, c + 1) === v) return true;
        if (r < 3 && get(r + 1, c) === v) return true;
      }
      return false;
    }
    function draw() {
      info.innerHTML = '<b>Счёт: ' + score + '</b><span>Рекорд: ' + best + '</span>';
      grid.innerHTML = '';
      b.forEach(function (v) {
        var t = h('div', {class: 'tile'}, v ? v : '');
        t.style.background = colors[v] || '#3c3a32'; t.style.color = v <= 4 ? '#6b5b4b' : '#fff';
        t.style.fontSize = v >= 1024 ? '20px' : v >= 128 ? '26px' : '32px';
        grid.appendChild(t);
      });
      msg.textContent = over ? 'Ходов больше нет 😢' : won ? '2048! Можно играть дальше 🎉' : 'Свайпай по полю';
    }
    onSwipe(grid, move);
    function key(e) { var d = KEYDIR[e.key]; if (d) { e.preventDefault(); move(d); } }
    document.addEventListener('keydown', key);
    nb.onclick = reset; reset();
    return function () { document.removeEventListener('keydown', key); };
  }

  /* ---------- Крестики-нолики ---------- */
  function gTTT(el) {
    var LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    var board, turn, winner, bot = false;
    var modes = h('div', {class: 'g-row'}), st = h('div', {class: 'g-msg big'}), grid = h('div', {class: 'g-grid ttt'});
    var b1 = h('button', {class: 'v-btn g-small', type: 'button'}, '2 игрока'), b2 = h('button', {class: 'v-btn ghost g-small', type: 'button'}, 'Против бота');
    modes.appendChild(b1); modes.appendChild(b2);
    var nb = h('button', {class: 'v-btn ghost g-small', type: 'button'}, 'Заново');
    el.appendChild(modes); el.appendChild(st); el.appendChild(grid); el.appendChild(nb);
    function check(bd) {
      for (var i = 0; i < LINES.length; i++) { var l = LINES[i]; if (bd[l[0]] && bd[l[0]] === bd[l[1]] && bd[l[1]] === bd[l[2]]) return bd[l[0]]; }
      return bd.every(Boolean) ? 'draw' : null;
    }
    function minimax(bd, p) {
      var w = check(bd); if (w === 'O') return 1; if (w === 'X') return -1; if (w === 'draw') return 0;
      var best = p === 'O' ? -2 : 2;
      for (var i = 0; i < 9; i++) if (!bd[i]) {
        bd[i] = p; var s = minimax(bd, p === 'O' ? 'X' : 'O'); bd[i] = '';
        best = p === 'O' ? Math.max(best, s) : Math.min(best, s);
      }
      return best;
    }
    function botMove() {
      var bi = -1, bs = -2;
      for (var i = 0; i < 9; i++) if (!board[i]) { board[i] = 'O'; var s = minimax(board, 'X'); board[i] = ''; if (s > bs || (s === bs && Math.random() < .3)) { bs = s; bi = i; } }
      if (bi >= 0) { board[bi] = 'O'; winner = check(board); if (!winner) turn = 'X'; }
    }
    function tap(i) {
      if (winner || board[i]) return;
      board[i] = turn; winner = check(board);
      if (!winner) turn = turn === 'X' ? 'O' : 'X';
      if (!winner && bot && turn === 'O') botMove();
      draw();
    }
    function draw() {
      st.textContent = winner ? (winner === 'draw' ? 'Ничья' : 'Победили ' + winner + ' 🎉') : 'Ходит ' + turn;
      grid.innerHTML = '';
      board.forEach(function (v, i) {
        var c = h('button', {class: 'cell ' + (v === 'X' ? 'x' : 'o'), type: 'button'}, v); c.onclick = function () { tap(i); }; grid.appendChild(c);
      });
      b1.className = 'v-btn g-small' + (bot ? ' ghost' : ''); b2.className = 'v-btn g-small' + (bot ? '' : ' ghost');
    }
    function reset() { board = new Array(9).fill(''); turn = 'X'; winner = null; draw(); }
    b1.onclick = function () { bot = false; reset(); }; b2.onclick = function () { bot = true; reset(); }; nb.onclick = reset;
    reset();
  }

  /* ---------- Угадай число ---------- */
  function gGuess(el) {
    var n, tries, done;
    var msg = h('div', {class: 'g-msg big'}), inp = h('input', {class: 'v-input', type: 'number', inputMode: 'numeric', placeholder: 'Твоё число'});
    var ok = h('button', {class: 'v-btn', type: 'button'}, 'Проверить'), nb = h('button', {class: 'v-btn ghost g-small', type: 'button', style: 'margin-top:12px'}, 'Новая игра');
    el.appendChild(msg); el.appendChild(inp); el.appendChild(ok); el.appendChild(nb);
    function reset() { n = 1 + rnd(100); tries = 0; done = false; inp.value = ''; msg.textContent = 'Я загадал число от 1 до 100'; }
    function go() {
      if (done) return;
      var v = parseInt(inp.value, 10);
      if (!(v >= 1 && v <= 100)) { msg.textContent = 'Введи число от 1 до 100'; return; }
      tries++;
      if (v === n) { done = true; msg.textContent = 'Верно! Попыток: ' + tries + ' 🎉'; var b = +store('guessbest') || 999; if (tries < b) store('guessbest', tries); }
      else msg.textContent = (v < n ? 'Больше ↑' : 'Меньше ↓') + ' (попыток: ' + tries + ')';
      inp.value = '';
    }
    ok.onclick = go; inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); }); nb.onclick = reset; reset();
  }

  /* ---------- Змейка ---------- */
  function gSnake(el) {
    var N = 20, snake, dir, nd, food, score, dead, timer;
    var info = h('div', {class: 'g-info'}), cv = h('canvas', {class: 'g-canvas'}), nb = h('button', {class: 'v-btn ghost g-small', type: 'button'}, 'Заново');
    var pad = h('div', {class: 'dpad'}, '<button data-d="up">▲</button><div><button data-d="left">◀</button><button data-d="down">▼</button><button data-d="right">▶</button></div>');
    el.appendChild(info); el.appendChild(cv); el.appendChild(pad); el.appendChild(nb);
    var S = Math.min(360, Math.floor(Math.min(window.innerWidth - 32, window.innerHeight - 330) / N) * N);
    if (S < 200) S = 200;
    cv.width = cv.height = S; var cs = S / N, ctx = cv.getContext('2d');
    function placeFood() { do { food = {x: rnd(N), y: rnd(N)}; } while (snake.some(function (s) { return s.x === food.x && s.y === food.y; })); }
    function reset() { snake = [{x: 10, y: 10}, {x: 9, y: 10}, {x: 8, y: 10}]; dir = nd = 'right'; score = 0; dead = false; placeFood(); clearInterval(timer); timer = setInterval(tick, 120); draw(); }
    var V = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]}, OPP = {up: 'down', down: 'up', left: 'right', right: 'left'};
    function setDir(d) { if (d && OPP[d] !== dir) nd = d; }
    function tick() {
      if (dead) return; dir = nd;
      var hd = {x: snake[0].x + V[dir][0], y: snake[0].y + V[dir][1]};
      if (hd.x < 0 || hd.y < 0 || hd.x >= N || hd.y >= N || snake.some(function (s) { return s.x === hd.x && s.y === hd.y; })) { dead = true; clearInterval(timer); var b = +store('snakebest') || 0; if (score > b) store('snakebest', score); draw(); return; }
      snake.unshift(hd);
      if (hd.x === food.x && hd.y === food.y) { score++; placeFood(); } else snake.pop();
      draw();
    }
    function draw() {
      info.innerHTML = '<b>' + (dead ? 'Конец · ' : '') + 'Счёт: ' + score + '</b><span>Рекорд: ' + (+store('snakebest') || 0) + '</span>';
      ctx.fillStyle = '#17112B'; ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = '#FF4F9A'; ctx.beginPath(); ctx.arc(food.x * cs + cs / 2, food.y * cs + cs / 2, cs * .38, 0, 7); ctx.fill();
      snake.forEach(function (s, i) { ctx.fillStyle = i ? '#22D3EE' : '#7C4DFF'; ctx.fillRect(s.x * cs + 1, s.y * cs + 1, cs - 2, cs - 2); });
    }
    onSwipe(cv, setDir);
    pad.addEventListener('click', function (e) { var d = e.target.getAttribute && e.target.getAttribute('data-d'); if (d) setDir(d); });
    function key(e) { var d = KEYDIR[e.key]; if (d) { e.preventDefault(); setDir(d); } }
    document.addEventListener('keydown', key); nb.onclick = reset; reset();
    return function () { clearInterval(timer); document.removeEventListener('keydown', key); };
  }

  /* ---------- Сапёр ---------- */
  function gMines(el) {
    var R = 9, C = 9, M = 10, cells, started, over, win, flagMode = false, flags;
    var info = h('div', {class: 'g-info'}), grid = h('div', {class: 'g-grid mines'});
    var row = h('div', {class: 'g-row'}), fm = h('button', {class: 'v-btn ghost g-small', type: 'button'}, '🚩 Флажок: выкл'), nb = h('button', {class: 'v-btn ghost g-small', type: 'button'}, 'Заново');
    row.appendChild(fm); row.appendChild(nb); el.appendChild(info); el.appendChild(grid); el.appendChild(row);
    function idx(r, c) { return r * C + c; }
    function nbrs(r, c) { var o = []; for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) { if ((a || b) && r + a >= 0 && r + a < R && c + b >= 0 && c + b < C) o.push([r + a, c + b]); } return o; }
    function reset() {
      cells = []; for (var i = 0; i < R * C; i++) cells.push({m: false, o: false, f: false, n: 0});
      started = false; over = false; win = false; flags = 0; draw();
    }
    function plant(sr, sc) {
      var pos = []; for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) if (!(Math.abs(r - sr) <= 1 && Math.abs(c - sc) <= 1)) pos.push([r, c]);
      shuffle(pos).slice(0, M).forEach(function (p) { cells[idx(p[0], p[1])].m = true; });
      for (r = 0; r < R; r++) for (c = 0; c < C; c++) cells[idx(r, c)].n = nbrs(r, c).filter(function (p) { return cells[idx(p[0], p[1])].m; }).length;
    }
    function open(r, c) {
      var st = [[r, c]];
      while (st.length) {
        var p = st.pop(), cl = cells[idx(p[0], p[1])];
        if (cl.o || cl.f) continue; cl.o = true;
        if (!cl.n && !cl.m) nbrs(p[0], p[1]).forEach(function (q) { st.push(q); });
      }
    }
    function tap(r, c) {
      if (over) return; var cl = cells[idx(r, c)];
      if (flagMode) { if (!cl.o) { cl.f = !cl.f; flags += cl.f ? 1 : -1; } draw(); return; }
      if (cl.f || cl.o) return;
      if (!started) { plant(r, c); started = true; }
      if (cl.m) { over = true; cells.forEach(function (x) { if (x.m) x.o = true; }); draw(); return; }
      open(r, c);
      if (cells.every(function (x) { return x.m || x.o; })) { over = true; win = true; }
      draw();
    }
    function draw() {
      info.innerHTML = '<b>' + (win ? 'Победа! 🎉' : over ? 'Бум! 💥' : 'Мин осталось: ' + (M - flags)) + '</b>';
      fm.textContent = '🚩 Флажок: ' + (flagMode ? 'вкл' : 'выкл'); fm.className = 'v-btn g-small' + (flagMode ? '' : ' ghost');
      grid.innerHTML = '';
      var colors = ['', '#4da3ff', '#3ddc84', '#ff6b6b', '#b388ff', '#ffb74d', '#22D3EE', '#fff', '#aaa'];
      for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) {
        (function (r, c) {
          var cl = cells[idx(r, c)], b = h('button', {class: 'mc' + (cl.o ? ' open' : ''), type: 'button'});
          if (cl.o) { if (cl.m) b.textContent = '💣'; else if (cl.n) { b.textContent = cl.n; b.style.color = colors[cl.n]; } }
          else if (cl.f) b.textContent = '🚩';
          var lp;
          b.addEventListener('touchstart', function () { lp = setTimeout(function () { lp = 'done'; var old = flagMode; flagMode = true; tap(r, c); flagMode = old; draw(); }, 420); }, {passive: true});
          b.addEventListener('touchend', function (e) { if (lp === 'done') { e.preventDefault(); lp = null; return; } clearTimeout(lp); }, {passive: false});
          b.onclick = function () { tap(r, c); };
          b.oncontextmenu = function (e) { e.preventDefault(); var old = flagMode; flagMode = true; tap(r, c); flagMode = old; draw(); };
          grid.appendChild(b);
        })(r, c);
      }
    }
    fm.onclick = function () { flagMode = !flagMode; draw(); }; nb.onclick = reset; reset();
  }

  /* ---------- Память ---------- */
  function gMemory(el) {
    var cards, open, moves, matched, lock;
    var info = h('div', {class: 'g-info'}), grid = h('div', {class: 'g-grid mem'}), nb = h('button', {class: 'v-btn ghost g-small', type: 'button'}, 'Заново');
    el.appendChild(info); el.appendChild(grid); el.appendChild(nb);
    function reset() {
      var e = ['🍕', '🎧', '🚀', '🎮', '🐱', '⭐', '🔥', '🎬']; cards = shuffle(e.concat(e)); open = []; moves = 0; matched = {}; lock = false; draw();
    }
    function flip(i) {
      if (lock || matched[i] || open.indexOf(i) >= 0) return;
      open.push(i);
      if (open.length === 2) {
        moves++; lock = true;
        if (cards[open[0]] === cards[open[1]]) { matched[open[0]] = matched[open[1]] = true; open = []; lock = false; }
        else setTimeout(function () { open = []; lock = false; draw(); }, 750);
      }
      draw();
    }
    function draw() {
      var done = Object.keys(matched).length === 16;
      info.innerHTML = '<b>' + (done ? 'Готово! ' : '') + 'Ходов: ' + moves + '</b>';
      grid.innerHTML = '';
      cards.forEach(function (v, i) {
        var up = matched[i] || open.indexOf(i) >= 0, c = h('button', {class: 'mem-c' + (up ? ' up' : '') + (matched[i] ? ' ok' : ''), type: 'button'}, up ? v : '?');
        c.onclick = function () { flip(i); }; grid.appendChild(c);
      });
    }
    nb.onclick = reset; reset();
  }

  /* ---------- Реакция ---------- */
  function gReaction(el) {
    var phase = 'idle', t0, timer, best = +store('reactbest') || 0;
    var pad = h('button', {class: 'react', type: 'button'}), info = h('div', {class: 'g-info'});
    el.appendChild(info); el.appendChild(pad);
    function set(cls, txt) { pad.className = 'react ' + cls; pad.innerHTML = txt; info.innerHTML = '<b>' + (best ? 'Лучший: ' + best + ' мс' : 'Нажми «Старт», жди зелёный') + '</b>'; }
    function start() { clearTimeout(timer); phase = 'wait'; set('wait', 'Жди…'); timer = setTimeout(function () { phase = 'go'; t0 = Date.now(); set('go', 'ЖМИ!'); }, 1200 + rnd(2500)); }
    pad.onclick = function () {
      if (phase === 'idle' || phase === 'result') return start();
      if (phase === 'wait') { clearTimeout(timer); phase = 'result'; set('idle', 'Рано! 😅<br><small>Нажми, чтобы повторить</small>'); return; }
      var ms = Date.now() - t0; phase = 'result'; if (!best || ms < best) { best = ms; store('reactbest', ms); }
      set('idle', ms + ' мс<br><small>Нажми, чтобы повторить</small>');
    };
    set('idle', 'Старт');
    return function () { clearTimeout(timer); };
  }

  /* ---------- Понг ---------- */
  function gPong(el) {
    var W = Math.min(360, window.innerWidth - 32), H = Math.min(520, window.innerHeight - 230); if (H < 260) H = 260;
    var cv = h('canvas', {class: 'g-canvas', width: W, height: H}), info = h('div', {class: 'g-info'}), nb = h('button', {class: 'v-btn ghost g-small', type: 'button'}, 'Старт');
    el.appendChild(info); el.appendChild(cv); el.appendChild(nb);
    var ctx = cv.getContext('2d'), raf, last, px, score, live, ball, started = false, PW = 70, PH = 10, R = 8;
    function reset() { px = W / 2; score = 0; ball = {x: W / 2, y: H / 3, vx: 150 * (Math.random() < .5 ? -1 : 1), vy: 200}; live = true; started = true; last = performance.now(); cancelAnimationFrame(raf); loop(last); nb.textContent = 'Заново'; }
    function loop(now) {
      var dt = Math.min(.04, (now - last) / 1000); last = now;
      if (live) {
        ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        if (ball.x < R) { ball.x = R; ball.vx = Math.abs(ball.vx); } if (ball.x > W - R) { ball.x = W - R; ball.vx = -Math.abs(ball.vx); }
        if (ball.y < R) { ball.y = R; ball.vy = Math.abs(ball.vy); }
        var py = H - 30;
        if (ball.vy > 0 && ball.y + R >= py && ball.y + R <= py + PH + 10 && Math.abs(ball.x - px) <= PW / 2 + R) {
          ball.vy = -Math.abs(ball.vy) * 1.05; ball.vx += (ball.x - px) * 3; score++;
        }
        if (ball.y > H + R) { live = false; var b = +store('pongbest') || 0; if (score > b) store('pongbest', score); }
      }
      ctx.fillStyle = '#17112B'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#22D3EE'; ctx.fillRect(px - PW / 2, H - 30, PW, PH);
      ctx.fillStyle = '#FF4F9A'; ctx.beginPath(); ctx.arc(ball.x, ball.y, R, 0, 7); ctx.fill();
      info.innerHTML = '<b>' + (live ? 'Понг · ' + score : (started ? 'Конец · счёт ' + score : 'Понг · готов')) + '</b><span>Рекорд: ' + (+store('pongbest') || 0) + '</span>';
      raf = requestAnimationFrame(loop);
    }
    function mv(x) { var r = cv.getBoundingClientRect(); px = Math.max(PW / 2, Math.min(W - PW / 2, (x - r.left) * (W / r.width))); }
    cv.addEventListener('touchmove', function (e) { e.preventDefault(); mv(e.touches[0].clientX); }, {passive: false});
    cv.addEventListener('touchstart', function (e) { mv(e.touches[0].clientX); }, {passive: true});
    cv.addEventListener('mousemove', function (e) { mv(e.clientX); });
    px = W / 2; score = 0; live = false; ball = {x: W / 2, y: H / 3, vx: 0, vy: 0}; last = performance.now(); loop(last);
    nb.onclick = reset;
    return function () { cancelAnimationFrame(raf); };
  }

  /* ---------- Виселица ---------- */
  function gHangman(el) {
    var WORDS = ['СТРИМ', 'КАНАЛ', 'ВИДЕО', 'ПЛЕЕР', 'ФОРУМ', 'ЧАТ', 'ПРИЛОЖЕНИЕ', 'ЭФИР', 'ЗЕРКАЛО', 'ПОИСК', 'ИГРА', 'СЕРВЕР', 'КЛИЕНТ', 'ТЕЛЕФОН'];
    var ABC = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'.split(''), word, guessed, wrong;
    var info = h('div', {class: 'g-info'}), art = h('div', {class: 'hang'}), wd = h('div', {class: 'hword'}), kb = h('div', {class: 'hkb'}), nb = h('button', {class: 'v-btn ghost g-small', type: 'button', style: 'margin-top:12px'}, 'Новое слово');
    el.appendChild(info); el.appendChild(art); el.appendChild(wd); el.appendChild(kb); el.appendChild(nb);
    function won() { return word.split('').every(function (l) { return guessed[l]; }); }
    function reset() { word = WORDS[rnd(WORDS.length)]; guessed = {}; wrong = 0; draw(); }
    function pick(l) { if (guessed[l] || won() || wrong >= 6) return; guessed[l] = true; if (word.indexOf(l) < 0) wrong++; draw(); }
    function draw() {
      var lost = wrong >= 6;
      info.innerHTML = '<b>' + (won() ? 'Победа! 🎉' : lost ? 'Проигрыш 😢' : 'Ошибок: ' + wrong + '/6') + '</b>';
      var p = ['<circle cx="150" cy="60" r="18"/>', '<line x1="150" y1="78" x2="150" y2="125"/>', '<line x1="150" y1="90" x2="125" y2="110"/>', '<line x1="150" y1="90" x2="175" y2="110"/>', '<line x1="150" y1="125" x2="130" y2="155"/>', '<line x1="150" y1="125" x2="170" y2="155"/>'];
      art.innerHTML = '<svg viewBox="0 0 220 180" width="220" height="180" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"><path d="M20 170h110M50 170V15h100v30" stroke="#7C4DFF"/>' + p.slice(0, wrong).join('') + '</svg>';
      wd.textContent = word.split('').map(function (l) { return guessed[l] || lost ? l : '_'; }).join(' ');
      kb.innerHTML = '';
      ABC.forEach(function (l) { var b = h('button', {type: 'button', class: guessed[l] ? (word.indexOf(l) >= 0 ? 'ok' : 'bad') : ''}, l); b.onclick = function () { pick(l); }; kb.appendChild(b); });
    }
    nb.onclick = reset; reset();
  }

  /* ---------- Калькулятор 24 ---------- */
  function parse24(s) {
    var i = 0;
    function ws() { while (s[i] === ' ') i++; }
    function num() { ws(); var st = i; while (i < s.length && /[0-9.]/.test(s[i])) i++; if (st === i) throw new Error('bad'); return parseFloat(s.slice(st, i)); }
    function atom() { ws(); if (s[i] === '(') { i++; var v = expr(); ws(); if (s[i] !== ')') throw new Error('bad'); i++; return v; } if (s[i] === '-') { i++; return -atom(); } return num(); }
    function term() { var v = atom(); for (;;) { ws(); if (s[i] === '*') { i++; v *= atom(); } else if (s[i] === '/') { i++; var d = atom(); if (d === 0) throw new Error('div0'); v /= d; } else return v; } }
    function expr() { var v = term(); for (;;) { ws(); if (s[i] === '+') { i++; v += term(); } else if (s[i] === '-') { i++; v -= term(); } else return v; } }
    var r = expr(); ws(); if (i !== s.length) throw new Error('bad'); return r;
  }
  function solve24(nums) {
    var res = null;
    function go(items) {
      if (res) return;
      if (items.length === 1) { if (Math.abs(items[0].v - 24) < 1e-6) res = items[0].e; return; }
      for (var i = 0; i < items.length; i++) for (var j = 0; j < items.length; j++) {
        if (i === j) continue;
        var a = items[i], b = items[j], rest = items.filter(function (_, k) { return k !== i && k !== j; });
        var ops = [[a.v + b.v, '(' + a.e + '+' + b.e + ')'], [a.v - b.v, '(' + a.e + '-' + b.e + ')'], [a.v * b.v, '(' + a.e + '*' + b.e + ')']];
        if (b.v !== 0) ops.push([a.v / b.v, '(' + a.e + '/' + b.e + ')']);
        for (var k = 0; k < ops.length; k++) go(rest.concat([{v: ops[k][0], e: ops[k][1]}]));
      }
    }
    go(nums.map(function (n) { return {v: n, e: String(n)}; }));
    return res;
  }
  function g24(el) {
    var nums;
    var msg = h('div', {class: 'g-msg big'}), nm = h('div', {class: 'nums24'}), inp = h('input', {class: 'v-input', placeholder: 'Например (8-2)*(1+3)', autocapitalize: 'off', autocomplete: 'off', inputMode: 'text'});
    var ok = h('button', {class: 'v-btn', type: 'button'}, 'Проверить'), row = h('div', {class: 'g-row', style: 'margin-top:12px'});
    var nb = h('button', {class: 'v-btn ghost g-small', type: 'button'}, 'Новые числа'), hint = h('button', {class: 'v-btn ghost g-small', type: 'button'}, 'Подсказка');
    row.appendChild(nb); row.appendChild(hint);
    el.appendChild(msg); el.appendChild(nm); el.appendChild(inp); el.appendChild(ok); el.appendChild(row);
    function deal() {
      do { nums = [1, 2, 3, 4].map(function () { return 1 + rnd(9); }); } while (!solve24(nums));
      nm.innerHTML = nums.map(function (n) { return '<span>' + n + '</span>'; }).join(''); inp.value = ''; msg.textContent = 'Собери 24, используя все 4 числа по разу';
    }
    function check() {
      var ex = inp.value.replace(/\s+/g, '').replace(/[×х]/g, '*').replace(/[÷:]/g, '/').replace(/,/g, '.');
      if (!/^[0-9+\-*\/().]+$/.test(ex)) { msg.textContent = 'Только цифры и + − * / ( )'; return; }
      var used = (ex.match(/\d+/g) || []).map(Number).sort(function (a, b) { return a - b; }), need = nums.slice().sort(function (a, b) { return a - b; });
      if (used.join() !== need.join()) { msg.textContent = 'Нужно использовать каждое число ровно один раз'; return; }
      try { var v = parse24(ex); msg.textContent = Math.abs(v - 24) < 1e-6 ? 'Верно! 🎉' : 'Получилось ' + (Math.round(v * 100) / 100) + ', нужно 24'; }
      catch (e) { msg.textContent = 'Не удалось вычислить'; }
    }
    ok.onclick = check; inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') check(); });
    nb.onclick = deal; hint.onclick = function () { msg.textContent = 'Одно из решений: ' + solve24(nums) + ' = 24'; };
    deal();
  }


  /* ---------- Flappy ---------- */
  function gFlappy(el) {
    var canvas = h('canvas', { width: 320, height: 420, style: 'width:100%;max-width:320px;border-radius:16px;background:#1a1030;display:block;margin:0 auto;touch-action:none' });
    el.appendChild(canvas);
    var ctx = canvas.getContext('2d'), bird = { y: 200, v: 0 }, pipes = [], score = 0, live = false, over = false, best = +store('flappybest') || 0;
    var info = h('div', { class: 'g-info' }); el.insertBefore(info, canvas);
    function reset() { bird = { y: 200, v: 0 }; pipes = []; score = 0; live = false; over = false; spawn(); draw(); }
    function spawn() {
      var gap = 120, top = 40 + rnd(200);
      pipes.push({ x: 320, top: top, bot: top + gap });
    }
    function flap() { if (over) { reset(); return; } live = true; bird.v = -6.2; }
    canvas.addEventListener('pointerdown', flap);
    function tick() {
      if (live && !over) {
        bird.v += 0.35; bird.y += bird.v;
        pipes.forEach(function (p) { p.x -= 2.2; });
        if (pipes.length && pipes[0].x < -50) { pipes.shift(); score++; if (score > best) { best = score; store('flappybest', best); } }
        if (!pipes.length || pipes[pipes.length - 1].x < 160) spawn();
        var hit = bird.y < 0 || bird.y > 420;
        pipes.forEach(function (p) {
          if (p.x < 50 && p.x > 10) {
            if (bird.y < p.top || bird.y > p.bot) hit = true;
          }
        });
        if (hit) over = true;
      }
      draw();
      requestAnimationFrame(tick);
    }
    function draw() {
      info.innerHTML = '<b>' + (over ? 'Конец · ' + score : (live ? 'Счёт: ' + score : 'Тап = взлёт')) + '</b><span>Рекорд: ' + best + '</span>';
      ctx.fillStyle = '#1a1030'; ctx.fillRect(0, 0, 320, 420);
      ctx.fillStyle = '#4CAF50';
      pipes.forEach(function (p) {
        ctx.fillRect(p.x, 0, 40, p.top);
        ctx.fillRect(p.x, p.bot, 40, 420 - p.bot);
      });
      ctx.fillStyle = '#FFD54F'; ctx.beginPath(); ctx.arc(40, bird.y, 12, 0, Math.PI * 2); ctx.fill();
    }
    reset(); tick();
  }

  /* ---------- Breakout ---------- */
  function gBreakout(el) {
    var canvas = h('canvas', { width: 320, height: 400, style: 'width:100%;max-width:320px;border-radius:16px;background:#120a24;display:block;margin:0 auto;touch-action:none' });
    el.appendChild(canvas);
    var ctx = canvas.getContext('2d'), info = h('div', { class: 'g-info' }); el.insertBefore(info, canvas);
    var pad = { x: 120, w: 70 }, ball, bricks, score, live, best = +store('brkbest') || 0;
    function reset() {
      ball = { x: 160, y: 300, vx: 2.5, vy: -3.2 }; score = 0; live = true;
      bricks = []; for (var r = 0; r < 5; r++) for (var c = 0; c < 8; c++) bricks.push({ x: 8 + c * 39, y: 30 + r * 18, alive: true });
    }
    function move(x) { pad.x = Math.max(0, Math.min(250, x - pad.w / 2)); }
    canvas.addEventListener('pointermove', function (e) { var r = canvas.getBoundingClientRect(); move((e.clientX - r.left) * (320 / r.width)); });
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); var t = e.touches[0], r = canvas.getBoundingClientRect(); move((t.clientX - r.left) * (320 / r.width)); }, { passive: false });
    function tick() {
      if (live) {
        ball.x += ball.vx; ball.y += ball.vy;
        if (ball.x < 6 || ball.x > 314) ball.vx *= -1;
        if (ball.y < 6) ball.vy *= -1;
        if (ball.y > 390) { live = false; if (score > best) { best = score; store('brkbest', best); } }
        if (ball.y > 370 && ball.x > pad.x && ball.x < pad.x + pad.w) { ball.vy = -Math.abs(ball.vy); ball.vx += (ball.x - (pad.x + pad.w / 2)) * 0.08; }
        bricks.forEach(function (b) {
          if (!b.alive) return;
          if (ball.x > b.x && ball.x < b.x + 36 && ball.y > b.y && ball.y < b.y + 14) { b.alive = false; ball.vy *= -1; score += 10; }
        });
        if (bricks.every(function (b) { return !b.alive; })) { live = false; if (score > best) { best = score; store('brkbest', best); } }
      }
      info.innerHTML = '<b>' + (live ? 'Счёт: ' + score : 'Конец · ' + score + ' (тап = снова)') + '</b><span>Рекорд: ' + best + '</span>';
      ctx.fillStyle = '#120a24'; ctx.fillRect(0, 0, 320, 400);
      ctx.fillStyle = '#7C4DFF'; ctx.fillRect(pad.x, 380, pad.w, 10);
      ctx.fillStyle = '#FF4F9A'; ctx.beginPath(); ctx.arc(ball.x, ball.y, 6, 0, Math.PI * 2); ctx.fill();
      bricks.forEach(function (b) { if (!b.alive) return; ctx.fillStyle = '#22D3EE'; ctx.fillRect(b.x, b.y, 34, 12); });
      requestAnimationFrame(tick);
    }
    canvas.addEventListener('pointerdown', function () { if (!live) reset(); });
    reset(); tick();
  }

  /* ---------- Flow GTA (внешняя игра) ---------- */
  function gFlowGta(el) {
    var wrap = h('div', { style: 'display:flex;flex-direction:column;gap:12px;padding:8px 0' });
    wrap.innerHTML = '<div style="border-radius:16px;overflow:hidden;background:linear-gradient(160deg,#2a1050,#160a30);padding:28px 16px;text-align:center">' +
      '<div style="font-size:48px;margin-bottom:8px">🚗</div>' +
      '<b style="font-size:18px;display:block;margin-bottom:6px">Flow GTA — Vice Roulette</b>' +
      '<p style="color:rgba(255,255,255,.65);font-size:13px;margin:0 0 16px;line-height:1.4">3D фан-демо. В iframe часто блокируется — открывай в браузере.</p>' +
      '<a href="https://flowgta.tatnet.app/" target="_blank" rel="noopener" style="display:inline-block;padding:14px 22px;border-radius:14px;background:linear-gradient(135deg,#7C4DFF,#FF4F9A);color:#fff;font-weight:700;text-decoration:none">▶ Открыть Flow GTA</a>' +
      '</div>';
    el.appendChild(wrap);
    // auto-open once
    try {
      var w = window.open('https://flowgta.tatnet.app/', '_blank');
      if (!w) {
        var tip = h('p', { style: 'color:#FF8AA8;font-size:12px;text-align:center;margin:8px 0 0' }, 'Разреши всплывающие окна или нажми кнопку выше');
        wrap.appendChild(tip);
      }
    } catch (e) {}
  }



  function gClicker(el) {
    var score = +(store('clicker') || 0), info = h('div', { class: 'g-info' }), btn = h('button', { class: 'v-btn', type: 'button', style: 'height:120px;font-size:22px;border-radius:20px' }, 'TAP');
    el.appendChild(info); el.appendChild(btn);
    function draw() { info.innerHTML = '<b>Очки: ' + score + '</b>'; }
    btn.onclick = function () { score++; store('clicker', score); draw(); };
    draw();
  }
  function gDice(el) {
    var info = h('div', { class: 'g-msg big' }, '🎲'), btn = h('button', { class: 'v-btn', type: 'button' }, 'Бросить');
    el.appendChild(info); el.appendChild(btn);
    btn.onclick = function () {
      var a = 1 + rnd(6), b = 1 + rnd(6);
      info.textContent = '🎲 ' + a + ' + ' + b + ' = ' + (a + b);
    };
  }
  function gRPS(el) {
    var msg = h('div', { class: 'g-msg big' }, 'Выбери'), row = h('div', { class: 'g-row' });
    ['✊', '✋', '✌️'].forEach(function (x, i) {
      var b = h('button', { class: 'v-btn ghost', type: 'button', style: 'font-size:28px;flex:1' }, x);
      b.onclick = function () {
        var cpu = rnd(3), names = ['Камень', 'Бумага', 'Ножницы'];
        var res = (i === cpu) ? 'Ничья' : ((i - cpu + 3) % 3 === 1 ? 'Победа!' : 'Поражение');
        msg.textContent = names[i] + ' vs ' + names[cpu] + ' — ' + res;
      };
      row.appendChild(b);
    });
    el.appendChild(msg); el.appendChild(row);
  }

  /* ---------- реестр + роутер ---------- */

  function gWhack(box) {
    var score = 0, time = 20, timer, active = -1;
    var st = document.createElement('p'); st.style.textAlign='center'; st.textContent='Счёт: 0 · 20с';
    var grid = document.createElement('div'); grid.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:280px;margin:12px auto';
    var cells = [];
    for (var i=0;i<9;i++){
      var b=document.createElement('button'); b.style.cssText='aspect-ratio:1;font-size:28px;border:0;border-radius:12px;background:#1a1430;color:#fff';
      b.textContent='🕳️'; cells.push(b); grid.appendChild(b);
      (function(i,b){ b.onclick=function(){ if(i===active){ score++; active=-1; b.textContent='🕳️'; st.textContent='Счёт: '+score+' · '+time+'с'; } }; })(i,b);
    }
    function tick(){
      if (time<=0){ clearInterval(timer); st.textContent='Финиш: '+score; cells.forEach(function(c){c.textContent='🕳️';}); return; }
      time--; if(active>=0) cells[active].textContent='🕳️';
      active=Math.floor(Math.random()*9); cells[active].textContent='🐹';
      st.textContent='Счёт: '+score+' · '+time+'с';
    }
    timer=setInterval(tick, 700); tick();
    box.append(st, grid);
  }
  function gColor(box) {
    var colors=['#e11','#1a1','#11e','#e91','#1ee','#e1e'], names=['Красный','Зелёный','Синий','Оранжевый','Голубой','Розовый'];
    var score=0, left=15;
    var st=document.createElement('p'); st.style.cssText='text-align:center;font-size:22px;font-weight:800';
    var sub=document.createElement('p'); sub.style.textAlign='center';
    var row=document.createElement('div'); row.style.cssText='display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:12px';
    function next(){
      if(left<=0){ st.textContent='Счёт '+score; row.innerHTML=''; return; }
      left--; var ci=Math.floor(Math.random()*6), ni=Math.floor(Math.random()*6);
      st.textContent=names[ni]; st.style.color=colors[ci];
      sub.textContent='Осталось: '+left+' · Счёт: '+score;
      row.innerHTML='';
      colors.forEach(function(c,i){
        var b=document.createElement('button'); b.style.cssText='width:48px;height:48px;border-radius:12px;border:2px solid #fff3;background:'+c;
        b.onclick=function(){ if(i===ci) score++; next(); };
        row.appendChild(b);
      });
    }
    box.append(st, sub, row); next();
  }
  function gSimon(box) {
    var seq=[], step=0, play=false, score=0;
    var st=document.createElement('p'); st.style.textAlign='center'; st.textContent='Simon · старт';
    var row=document.createElement('div'); row.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:220px;margin:16px auto';
    var cols=['#e11','#1a1','#11e','#e91'];
    var btns=[];
    function flash(i){ return new Promise(function(res){ btns[i].style.opacity='1'; setTimeout(function(){ btns[i].style.opacity='.45'; res(); }, 320); }); }
    async function showSeq(){ play=false; for(var i=0;i<seq.length;i++){ await flash(seq[i]); await new Promise(function(r){setTimeout(r,120);}); } play=true; step=0; }
    function add(){ seq.push(Math.floor(Math.random()*4)); st.textContent='Уровень '+seq.length; showSeq(); }
    cols.forEach(function(c,i){
      var b=document.createElement('button'); b.style.cssText='aspect-ratio:1;border:0;border-radius:16px;background:'+c+';opacity:.45';
      b.onclick=function(){ if(!play)return; if(i===seq[step]){ step++; if(step>=seq.length){ score++; setTimeout(add,400);} } else { st.textContent='Мимо · счёт '+score; play=false; seq=[]; setTimeout(add,800);} };
      btns.push(b); row.appendChild(b);
    });
    var start=document.createElement('button'); start.textContent='Старт'; start.style.cssText='display:block;margin:8px auto;padding:10px 20px;border:0;border-radius:10px;background:#7C4DFF;color:#fff;font-weight:700';
    start.onclick=function(){ seq=[]; score=0; add(); };
    box.append(st, row, start);
  }


  function gBasket(box) {
    var score=0,x=50,ball=50,vy=0,run=true;
    var st=document.createElement('p'); st.style.textAlign='center';
    var cv=document.createElement('canvas'); cv.width=300; cv.height=220; cv.style.cssText='display:block;margin:8px auto;background:#0a0a18;border-radius:12px;width:100%;max-width:300px';
    var ctx=cv.getContext('2d');
    function draw(){ if(!run)return; ctx.clearRect(0,0,300,220); ctx.fillStyle='#7C4DFF'; ctx.fillRect(x-25,200,50,12); ctx.beginPath(); ctx.arc(ball,vy,10,0,6.3); ctx.fillStyle='#fbbf24'; ctx.fill(); vy+=3; if(vy>210){ if(ball>x-25&&ball<x+25){score++;ball=20+Math.random()*260;vy=0;} else {run=false;st.textContent='Счёт '+score+' · тап = снова';} } st.textContent='Счёт: '+score; requestAnimationFrame(draw); }
    cv.addEventListener('pointermove',function(e){ var r=cv.getBoundingClientRect(); x=(e.clientX-r.left)/r.width*300; });
    cv.addEventListener('click',function(){ if(!run){score=0;vy=0;ball=150;run=true;draw();} });
    box.append(st,cv); draw();
  }
  function gRacer(box) {
    var y=0, car=1, score=0, dead=false;
    var st=document.createElement('p'); st.style.textAlign='center';
    var row=document.createElement('div'); row.style.cssText='display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;max-width:240px;margin:12px auto';
    var cells=[]; for(var i=0;i<9;i++){ var d=document.createElement('div'); d.style.cssText='height:48px;border-radius:10px;background:#1a1430;display:grid;place-items:center;font-size:22px'; cells.push(d); row.appendChild(d); }
    function paint(){ cells.forEach(function(c,i){ c.textContent=''; c.style.background='#1a1430'; }); cells[6+car].textContent='🚗'; var o=Math.floor(Math.random()*3); if(Math.random()>0.4){ cells[o].textContent='🚧'; if(o===car){ dead=true; st.textContent='Crash · '+score; return;} } score++; st.textContent='Очки: '+score; }
    var t=setInterval(function(){ if(!dead)paint(); }, 500);
    row.addEventListener('click',function(e){ var i=[].indexOf.call(cells,e.target); if(i>=6) car=i-6; });
    box.append(st,row);
  }
  function gMath(box) {
    var score=0,a,b,op,ans;
    var st=document.createElement('p'); st.style.cssText='text-align:center;font-size:22px;font-weight:700';
    var sub=document.createElement('p'); sub.style.textAlign='center';
    var row=document.createElement('div'); row.style.cssText='display:flex;flex-wrap:wrap;gap:8px;justify-content:center';
    function next(){ a=1+Math.floor(Math.random()*12); b=1+Math.floor(Math.random()*12); op=Math.random()>0.5?'+':'×'; ans=op==='+'?(a+b):(a*b); st.textContent=a+' '+op+' '+b+' = ?'; sub.textContent='Счёт: '+score; row.innerHTML=''; var opts=[ans,ans+1+Math.floor(Math.random()*3),Math.max(1,ans-1-Math.floor(Math.random()*3)),ans+4]; opts.sort(function(){return Math.random()-0.5;}); opts.forEach(function(n){ var btn=document.createElement('button'); btn.textContent=n; btn.style.cssText='min-width:64px;padding:12px;border:0;border-radius:12px;background:#7C4DFF;color:#fff;font-weight:700'; btn.onclick=function(){ if(n===ans)score++; next(); }; row.appendChild(btn); }); }
    box.append(st,sub,row); next();
  }

  var GAMES = [
    {id: '2048', t: '2048', s: 'Сложи плитки до 2048', i: '🔢', c: '#FF5722', f: g2048},
    {id: 'ttt', t: 'Крестики-нолики', s: 'Классика 3×3', i: '✖️', c: '#009688', f: gTTT},
    {id: 'guess', t: 'Угадай число', s: 'От 1 до 100', i: '🎲', c: '#3F51B5', f: gGuess},
    {id: 'snake', t: 'Змейка', s: 'Собирай еду, не врежься', i: '🐍', c: '#4CAF50', f: gSnake},
    {id: 'mines', t: 'Сапёр', s: 'Классическое разминирование', i: '🚩', c: '#607D8B', f: gMines},
    
  function gTicTac(box) {
    var board = Array(9).fill(''), turn = 'X', over = false;
    var st = document.createElement('p'); st.style.textAlign='center'; st.textContent='Ход: X';
    var grid = document.createElement('div'); grid.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-width:240px;margin:12px auto';
    function win(p){ return [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]].some(function(l){return l.every(function(i){return board[i]===p;});}); }
    for (var i=0;i<9;i++){(function(i){
      var b=document.createElement('button'); b.style.cssText='aspect-ratio:1;font-size:32px;border-radius:12px;border:0;background:#1a1430;color:#fff;font-weight:800';
      b.onclick=function(){ if(over||board[i])return; board[i]=turn; b.textContent=turn; if(win(turn)){st.textContent=turn+' победил!';over=true;return;} if(board.every(Boolean)){st.textContent='Ничья';over=true;return;} turn=turn==='X'?'O':'X'; st.textContent='Ход: '+turn; };
      grid.appendChild(b);
    })(i);}
    box.append(st, grid);
  }
  function gReaction(box) {
    var st=document.createElement('p'); st.style.cssText='text-align:center;font-size:16px'; st.textContent='Жди зелёный, потом тап';
    var btn=document.createElement('button'); btn.style.cssText='display:block;width:100%;max-width:280px;margin:20px auto;height:120px;border:0;border-radius:16px;background:#333;color:#fff;font-size:18px;font-weight:700'; btn.textContent='Готов';
    var t0=0, phase='idle';
    btn.onclick=function(){ if(phase==='idle'){ phase='wait'; btn.style.background='#b91c1c'; btn.textContent='Жди…'; setTimeout(function(){ if(phase!=='wait')return; phase='go'; t0=Date.now(); btn.style.background='#16a34a'; btn.textContent='ЖМИ!'; },1200+Math.floor(Math.random()*2500)); } else if(phase==='wait'){ phase='idle'; btn.style.background='#333'; btn.textContent='Рано! Ещё'; } else if(phase==='go'){ var ms=Date.now()-t0; phase='idle'; btn.style.background='#333'; btn.textContent=ms+' мс · ещё'; st.textContent='Реакция: '+ms+' мс'; } };
    box.append(st, btn);
  }
  function gGuess(box) {
    var n=1+Math.floor(Math.random()*50), tries=0;
    var st=document.createElement('p'); st.style.textAlign='center'; st.textContent='Угадай число 1–50';
    var inp=document.createElement('input'); inp.type='number'; inp.style.cssText='width:100%;max-width:200px;margin:8px auto;display:block;padding:10px;border-radius:10px;border:1px solid #333;background:#121;color:#fff';
    var btn=document.createElement('button'); btn.style.cssText='display:block;margin:8px auto;padding:10px 20px;border:0;border-radius:10px;background:#7C4DFF;color:#fff;font-weight:700'; btn.textContent='Проверить';
    btn.onclick=function(){ tries++; var g=parseInt(inp.value,10); st.textContent=g===n?('Да! За '+tries+' попыток'):(g>n?'Меньше':'Больше'); };
    box.append(st, inp, btn);
  }
    {id: 'tictac', t: 'Крестики-нолики', s: '3×3', i: '⭕', c: '#2196F3', f: gTicTac},
    {id: 'reaction', t: 'Реакция', s: 'Кто быстрее', i: '⚡', c: '#FFC107', f: gReaction},
    {id: 'guess', t: 'Угадай число', s: '1–50', i: '🔢', c: '#4CAF50', f: gGuess},
    {id: 'memory', t: 'Память', s: 'Найди пары карт', i: '🃏', c: '#9C27B0', f: gMemory},
    {id: 'react', t: 'Реакция', s: 'Нажми как можно быстрее', i: '⚡', c: '#FF8F00', f: gReaction},
    {id: 'pong', t: 'Понг', s: 'Отражай мяч платформой', i: '🏓', c: '#0097A7', f: gPong},
    {id: 'hang', t: 'Виселица', s: 'Угадай слово по буквам', i: '🔤', c: '#795548', f: gHangman},
    {id: '24', t: 'Калькулятор 24', s: 'Собери 24 из четырёх чисел', i: '🧮', c: '#C2185B', f: g24},
    {id: 'flappy', t: 'Flappy', s: 'Тапай и лети', i: '🐤', c: '#FFD54F', f: gFlappy},
    {id: 'breakout', t: 'Аркада', s: 'Разбей блоки', i: '🧱', c: '#E91E63', f: gBreakout},
    {id: 'flowgta', t: 'Flow GTA', s: 'Vice Roulette 3D', i: '🚗', c: '#9C27B0', f: gFlowGta},
    {id: 'clicker', t: 'Кликер', s: 'Тапай за очки', i: '👆', c: '#00BCD4', f: gClicker},
    {id: 'dice', t: 'Кости', s: 'Брось два кубика', i: '🎲', c: '#8BC34A', f: gDice},
    {id: 'whack', t: 'Крот', s: 'Поймай хомяка', i: '🐹', c: '#FF7043', f: gWhack},
    {id: 'color', t: 'Цвета', s: 'Не цвет, а слово', i: '🎨', c: '#AB47BC', f: gColor},
    {id: 'simon', t: 'Simon', s: 'Повтори последовательность', i: '🎵', c: '#26A69A', f: gSimon},
    {id: 'basket', t: 'Корзина', s: 'Лови мяч', i: '🏀', c: '#FF6F00', f: gBasket},
    {id: 'racer', t: 'Гонка', s: 'Увернись от конусов', i: '🏎️', c: '#546E7A', f: gRacer},
    {id: 'math', t: 'Математика', s: 'Быстрый счёт', i: '➕', c: '#43A047', f: gMath},
    {id: 'rps', t: 'КНБ', s: 'Камень, ножницы, бумага', i: '✊', c: '#FF5722', f: gRPS}
  ];

  function boot() {
    var view = $('#view'), ttl = $('#ttl'), back = $('#back'), cleanup = null;
    function route() {
      if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
      view.innerHTML = ''; window.scrollTo(0, 0);
      var id = decodeURIComponent((location.hash || '').replace('#', '')), g = GAMES.filter(function (x) { return x.id === id; })[0];
      if (!g) {
        ttl.textContent = 'Игры оффлайн'; back.style.visibility = 'hidden';
        var list = h('div', {class: 'glist v-fade'});
        GAMES.forEach(function (x) {
          var a = h('a', {class: 'gitem', href: '#' + x.id}, '<span class="gic" style="background:' + x.c + '">' + x.i + '</span><span class="gtx"><b>' + x.t + '</b><small>' + x.s + '</small></span><span class="gch">›</span>');
          list.appendChild(a);
        });
        view.appendChild(list); return;
      }
      ttl.textContent = g.t; back.style.visibility = 'visible';
      var box = h('div', {class: 'gbox v-fade'}); view.appendChild(box);
      cleanup = g.f(box) || null;
    }
    window.addEventListener('hashchange', route);
    back.onclick = function () { location.hash = ''; };
    route();
  }

  window.SLGames = {
    mount: function (host) {
      host.innerHTML = '';
      var list = document.createElement('div');
      list.className = 'list';
      GAMES.forEach(function (x) {
        var row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = '<div class="av" style="background:' + x.c + '">' + x.i + '</div><div class="tx"><b>' + x.t + '</b><small>' + x.s + '</small></div>';
        row.onclick = function () { location.href = '/webapp/games.html#' + x.id; };
        list.appendChild(row);
      });
      host.appendChild(list);
    },
    list: GAMES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = {slide2048: slide2048, solve24: solve24, parse24: parse24};
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
