/* Анимированный «вайб»-фон (иконки + волны) — аналог widgets/doodles.dart */
(function () {
  var P = {
    videocam: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z',
    favorite: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    chat: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z',
    star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    play: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z',
    tv: 'M21 6h-7.59l3.29-3.29L16 2l-4 4-4-4-.71.71L10.59 6H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 14H3V8h18v12zM9 10v8l7-4z',
    music: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
    bolt: 'M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z',
    smile: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-10c.83 0 1.5-.67 1.5-1.5S16.33 7 15.5 7 14 7.67 14 8.5s.67 1.5 1.5 1.5zm-7 0C9.33 10 10 9.33 10 8.5S9.33 7 8.5 7 7 7.67 7 8.5 7.67 10 8.5 10zm3.5 7.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z',
    phones: 'M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z'
  };
  var ITEMS = [['videocam', .08, .07, 44, 0], ['favorite', .82, .05, 36, 1.3], ['chat', .70, .20, 40, 2.1], ['star', .14, .24, 34, 3.0],
    ['play', .88, .38, 46, 4.2], ['tv', .05, .46, 42, 5.0], ['music', .78, .60, 34, .7], ['bolt', .12, .70, 38, 2.6],
    ['smile', .84, .82, 40, 3.8], ['phones', .30, .90, 36, 1.9]];
  function wavePath(i) {
    var d = 'M0 30', amp = 18, k = 2 + i;
    for (var x = 0; x <= 1200; x += 12) d += ' L' + x + ' ' + (30 + Math.sin(x / 600 * Math.PI * k) * amp).toFixed(1);
    return d;
  }
  window.slDoodles = function (host) {
    host = host || document.body;
    var w = document.createElement('div'); w.className = 'v-doodles';
    var cols = ['#FF4F9A', '#22D3EE', '#7C4DFF'], html = '';
    for (var i = 0; i < 3; i++) {
      html += '<svg class="wave" viewBox="0 0 1200 60" preserveAspectRatio="none" style="top:' + (22 + i * 28) + '%;stroke:' + cols[i] + ';--t:' + (11 + i * 3) + 's"><path d="' + wavePath(i) + '"/></svg>';
    }
    ITEMS.forEach(function (it, n) {
      html += '<svg class="ic" viewBox="0 0 24 24" style="left:' + (it[1] * 100) + '%;top:' + (it[2] * 100) + '%;width:' + it[3] + 'px;height:' + it[3] + 'px;--d:-' + it[4] + 's;--t:' + (8 + (n % 4)) + 's"><path d="' + P[it[0]] + '"/></svg>';
    });
    w.innerHTML = html;
    host.insertBefore(w, host.firstChild);
    return w;
  };
  window.SL_LOGO_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';

  /* ripple (InkWell) для кнопок отдельных экранов */
  document.addEventListener('pointerdown', function (e) {
    var t = e.target.closest && e.target.closest('.v-btn,.v-link,.m3-seg button,.gitem,.gbar button,.gbar a,.cell,.mem-c,.hkb button,.dpad button');
    if (!t) return;
    if (getComputedStyle(t).position === 'static') t.style.position = 'relative';
    t.style.overflow = t.style.overflow || 'hidden';
    var r = t.getBoundingClientRect(), n = Math.max(r.width, r.height) * 2.1, s = document.createElement('span');
    s.className = 'sl-rip'; s.style.cssText = 'width:' + n + 'px;height:' + n + 'px;left:' + (e.clientX - r.left - n / 2) + 'px;top:' + (e.clientY - r.top - n / 2) + 'px';
    t.appendChild(s);
    var off = function () { s.classList.add('end'); setTimeout(function () { s.remove(); }, 650); t.removeEventListener('pointerup', off); t.removeEventListener('pointercancel', off); t.removeEventListener('pointerleave', off); };
    t.addEventListener('pointerup', off); t.addEventListener('pointercancel', off); t.addEventListener('pointerleave', off); setTimeout(off, 900);
  }, {passive: true});
})();
