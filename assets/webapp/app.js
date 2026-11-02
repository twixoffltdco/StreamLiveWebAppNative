/* StreamLive WebApp — standalone SPA (Flutter Starter parity) */
(function () {
  'use strict';
  window.onerror = function(m,s,l,c,e){ try{ var d=document.getElementById('app'); if(d) d.innerHTML='<div style="padding:20px;color:#FF8AA8;font:14px system-ui">Ошибка JS:<br>'+m+'</div>'; }catch(x){} };

  const MIRRORS = [
    location.origin,
    'https://streamlivetv.freedev.app',
    'https://domtv.blyz.ru',
    'https://streamliveru.web1337.net'
  ].filter((v, i, a) => a.indexOf(v) === i);

  const state = {
    base: localStorage.getItem('sl_base') || location.origin,
    apiKey: localStorage.getItem('sl_api_key') || '',
    user: null,
    settings: (function(){
      try { return JSON.parse(localStorage.getItem('sl_settings') || '{}'); } catch(e){ return {}; }
    })(),
    version: '1.4.4-F22',
    build: 1464,
    devTap: 0,

    tab: 0,
    filter: 'all',
    channels: [],
    videos: [],
    forumCats: [],
    forumThreads: [],
    conversations: [],
    route: { name: 'splash' },
    busy: false
  };

  try {
    const u = localStorage.getItem('sl_user');
    if (u) state.user = JSON.parse(u);
  } catch (e) {}

  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, attrs, html) => {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'style') e.style.cssText = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    if (html != null) e.innerHTML = html;
    return e;
  };

  function toast(msg) {
    const t = el('div', { class: 'toast' }, msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  // 24-hour local data cache. API requests remain network-only; this cache is
  // an offline/stale-data fallback and never delays writes or live polling.
  const DATA_CACHE_TTL = 24 * 60 * 60 * 1000;
  const DATA_CACHE_PREFIX = 'sl_data_v1:';
  function dataCacheKey(key) {
    return DATA_CACHE_PREFIX + encodeURIComponent(state.base || location.origin) + ':' + key;
  }
  function readDataCache(key) {
    try {
      const raw = localStorage.getItem(dataCacheKey(key));
      if (!raw) return null;
      const item = JSON.parse(raw);
      if (!item || !item.savedAt || Date.now() - item.savedAt > DATA_CACHE_TTL) {
        localStorage.removeItem(dataCacheKey(key));
        return null;
      }
      return item.data;
    } catch (_) { return null; }
  }
  function writeDataCache(key, data) {
    try {
      localStorage.setItem(dataCacheKey(key), JSON.stringify({ savedAt: Date.now(), data }));
    } catch (_) {
      // If storage is full, evict expired StreamLive data and retry once.
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.indexOf(DATA_CACHE_PREFIX) === 0) {
            try {
              const v = JSON.parse(localStorage.getItem(k) || 'null');
              if (!v || !v.savedAt || Date.now() - v.savedAt > DATA_CACHE_TTL) localStorage.removeItem(k);
            } catch (_) { localStorage.removeItem(k); }
          }
        });
        localStorage.setItem(dataCacheKey(key), JSON.stringify({ savedAt: Date.now(), data }));
      } catch (__) {}
    }
  }
  function appendCachedMessages(key, messages) {
    const old = readDataCache(key) || [];
    const map = new Map();
    old.concat(messages || []).forEach(m => {
      const id = String(m && (m.id || m.message_id) || '');
      const sig = id || [m.username || '', m.created_at || '', m.body || m.message || ''].join('|');
      map.set(sig, m);
    });
    const merged = Array.from(map.values()).slice(-300);
    writeDataCache(key, merged);
    return merged;
  }
  function showUpdateBanner(version, build) {
    const key = 'sl_update_dismiss_' + String(build);
    try { if (sessionStorage.getItem(key) === '1') return; } catch (_) {}
    var old = document.getElementById('sl-update-banner');
    if (old) old.remove();
    const banner = el('div', { id: 'sl-update-banner', class: 'sl-update-banner' });
    banner.innerHTML = '';
    const info = el('div', { class: 'sl-update-info' });
    info.innerHTML = '<b>Доступно обновление</b><small>Сейчас: ' + state.version + ' · ' + state.build + '<br>Новое: ' + String(version) + ' · build ' + String(build) + '</small>';
    const btn = el('button', { type: 'button', class: 'sl-update-btn' }, 'Обновить');
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = '…';
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) {
            try { await reg.update(); if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
          }
        }
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
      } catch (_) {}
      location.replace('/webapp/?v=' + encodeURIComponent(String(build)) + '&sl_refresh=' + Date.now());
    };
    const x = el('button', { type: 'button', class: 'sl-update-x', title: 'Скрыть' }, '×');
    x.onclick = function() {
      try { sessionStorage.setItem(key, '1'); } catch (_) {}
      banner.remove();
    };
    banner.append(info, btn, x);
    document.body.appendChild(banner);
  }


  const playerScriptCache = {};
  function loadPlayerScript(key, url) {
    if (window[key]) return Promise.resolve(window[key]);
    if (playerScriptCache[url]) return playerScriptCache[url];
    playerScriptCache[url] = new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = function() {
        if (window[key]) resolve(window[key]);
        else reject(new Error('Библиотека загрузилась, но API не найдено: ' + key));
      };
      script.onerror = function() { reject(new Error('Не удалось загрузить библиотеку ' + key)); };
      document.head.appendChild(script);
    });
    return playerScriptCache[url];
  }
  function loadPlayerCss(id, url) {
    if (document.getElementById(id)) return;
    var link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet'; link.href = url;
    document.head.appendChild(link);
  }
  function playerError(videoEl, message) {
    var host = videoEl && videoEl.parentNode;
    if (!host) return;
    var old = host.querySelector('.sl-player-error');
    if (old) old.remove();
    var box = document.createElement('div');
    box.className = 'sl-player-error';
    box.style.cssText = 'position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(4,10,25,.94);color:#fff;text-align:center;font:14px/1.5 system-ui';
    box.textContent = message;
    host.style.position = 'relative';
    host.appendChild(box);
  }


  // Client-only previews (no extra PHP hits on InfinityFree)
  function bindMediaPreview(card, opts) {
    opts = opts || {};
    var imgUrl = opts.image ? absUrl(opts.image) : '';
    var streamUrl = opts.stream ? absUrl(opts.stream) : '';
    var title = opts.title || '';
    var longTimer = null;
    var overlay = null;
    var previewVideo = null;
    var moved = false;

    function closePreview() {
      if (longTimer) { clearTimeout(longTimer); longTimer = null; }
      if (previewVideo) {
        try { previewVideo.pause(); previewVideo.removeAttribute('src'); previewVideo.load(); } catch (e) {}
        previewVideo = null;
      }
      if (overlay) { overlay.remove(); overlay = null; }
      document.body.classList.remove('sl-preview-open');
    }

    function openPreview(fromPointer) {
      if (overlay) return;
      // Only use data already on the card — never fetch /api for preview
      if (!imgUrl && !streamUrl) {
        toast('Нет превью');
        return;
      }
      overlay = document.createElement('div');
      overlay.className = 'preview-overlay';
      overlay.innerHTML = '<div class="preview-sheet glass-panel">' +
        '<div class="preview-media"></div>' +
        '<div class="preview-title"></div>' +
        '<div class="preview-hint">Отпустите · открыть карточку обычным нажатием</div>' +
        '</div>';
      overlay.querySelector('.preview-title').textContent = title;
      var media = overlay.querySelector('.preview-media');
      // Prefer static image (0 host hits beyond already-loaded thumb)
      if (imgUrl) {
        var im = document.createElement('img');
        im.src = imgUrl;
        im.alt = '';
        im.decoding = 'async';
        media.appendChild(im);
      }
      // Optional muted stream preview ONLY if URL already known (no API call)
      // Disabled by default on save_hits / low_hits to protect InfinityFree bandwidth to origin streams is ok (not our PHP)
      var allowLive = streamUrl && !getSetting('save_hits', true) && getSetting('live_preview', false);
      if (allowLive && streamUrl && /\.(m3u8|mp4)(\?|$)/i.test(streamUrl)) {
        try {
          previewVideo = document.createElement('video');
          previewVideo.muted = true;
          previewVideo.playsInline = true;
          previewVideo.setAttribute('playsinline', '');
          previewVideo.loop = true;
          previewVideo.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0';
          media.appendChild(previewVideo);
          if (/\.m3u8(\?|$)/i.test(streamUrl) && window.Hls && Hls.isSupported()) {
            var hls = new Hls({ maxBufferLength: 8, maxMaxBufferLength: 12 });
            hls.loadSource(streamUrl);
            hls.attachMedia(previewVideo);
            previewVideo._hls = hls;
          } else {
            previewVideo.src = streamUrl;
          }
          previewVideo.play().catch(function(){});
        } catch (e) {}
      }
      document.body.appendChild(overlay);
      document.body.classList.add('sl-preview-open');
      overlay.addEventListener('click', closePreview);
      overlay.addEventListener('pointerup', closePreview);
    }

    // Desktop / TV: long hover ~450ms
    card.addEventListener('pointerenter', function(e) {
      if (e.pointerType === 'touch') return;
      moved = false;
      longTimer = setTimeout(function(){ openPreview(true); }, 480);
    });
    card.addEventListener('pointerleave', function() {
      if (longTimer) { clearTimeout(longTimer); longTimer = null; }
      closePreview();
    });
    // Touch: long-press ~420ms (YouTube-like)
    card.addEventListener('pointerdown', function(e) {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      moved = false;
      longTimer = setTimeout(function(){ openPreview(true); }, 420);
    });
    card.addEventListener('pointermove', function(e) {
      if (!longTimer) return;
      // cancel if finger moves too much
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 12) {
        moved = true;
        clearTimeout(longTimer); longTimer = null;
      }
    });
    card.addEventListener('pointerup', function() {
      if (longTimer) { clearTimeout(longTimer); longTimer = null; }
      // short tap opens as usual via onclick
      setTimeout(closePreview, 50);
    });
    card.addEventListener('pointercancel', function() {
      if (longTimer) { clearTimeout(longTimer); longTimer = null; }
      closePreview();
    });
    // TV / keyboard: focus long-hold via key Enter hold not needed — use key "i" or contextmenu
    card.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      openPreview(false);
    });
    card.tabIndex = 0;
  }


  function getVideoEl(videoEl) {
    if (!videoEl) return null;
    if (videoEl.tagName === 'VIDEO') return videoEl;
    var v = videoEl.querySelector && videoEl.querySelector('video');
    return v || videoEl;
  }

  function attachPlayerChrome(videoEl) {
    if (!videoEl) return;
    var host = videoEl.parentElement;
    if (!host) return;
    // Custom bar OFF by default — use native player controls; enable in settings
    if (!getSetting('player_chrome', false)) {
      try { videoEl.setAttribute('controls', ''); videoEl.controls = true; } catch (e) {}
      return;
    }
    if (host.querySelector('.player-chrome')) return;
    host.classList.add('player-box');
    if (!host.style.position) host.style.position = 'relative';
    var bar = document.createElement('div');
    bar.className = 'player-chrome glass-panel';
    bar.style.cssText = 'pointer-events:auto;z-index:20;';
    var sec0 = parseInt(getSetting('seek_sec', 20), 10) || 20;
    bar.innerHTML =
      '<button type="button" data-a="back">−' + sec0 + 's</button>' +
      '<button type="button" data-a="play">▶/❚❚</button>' +
      '<button type="button" data-a="fwd">+' + sec0 + 's</button>' +
      '<button type="button" data-a="rate">1×</button>' +
      '<button type="button" data-a="pip">PiP</button>' +
      '<button type="button" data-a="fs">⛶</button>';
    host.appendChild(bar);
    var rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    var ri = 2;
    function findVid() {
      // Always re-query — HLS/players may replace node
      var v = host.querySelector('video');
      if (v) return v;
      if (videoEl && videoEl.tagName === 'VIDEO') return videoEl;
      return null;
    }
    function seekBy(delta) {
      var v = findVid();
      if (!v) { toast('Нет видеоэлемента'); return; }
      try {
        var t = v.currentTime;
        if (!isFinite(t) || t < 0) t = 0;
        var next = t + delta;
        // Live / DVR: clamp to seekable
        if (v.seekable && v.seekable.length) {
          var a = v.seekable.start(0);
          var b = v.seekable.end(v.seekable.length - 1);
          if (isFinite(a) && isFinite(b) && b > a) {
            next = Math.max(a, Math.min(b, next));
          }
        } else if (isFinite(v.duration) && v.duration > 0) {
          next = Math.max(0, Math.min(v.duration - 0.25, next));
        } else {
          next = Math.max(0, next);
        }
        v.currentTime = next;
        toast((delta < 0 ? '−' : '+') + Math.abs(delta) + 's');
      } catch (e) {
        toast('Перемотка недоступна');
      }
    }
    bar.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var btn = ev.target.closest('button');
      if (!btn) return;
      var a = btn.getAttribute('data-a');
      var v = findVid();
      var sec = parseInt(getSetting('seek_sec', 20), 10) || 20;
      try {
        if (a === 'back') { seekBy(-sec); return; }
        if (a === 'fwd') { seekBy(sec); return; }
        if (a === 'play') {
          if (!v) { toast('Нет видео'); return; }
          if (v.paused) {
            var p = v.play();
            if (p && p.catch) p.catch(function(){ toast('Play заблокирован'); });
            else toast('Play');
          } else {
            v.pause();
            toast('Пауза');
          }
          return;
        }
        if (a === 'rate') {
          if (!v) { toast('Нет видео'); return; }
          ri = (ri + 1) % rates.length;
          try {
            v.playbackRate = rates[ri];
            btn.textContent = rates[ri] + '×';
            toast('Скорость ' + rates[ri] + '×');
          } catch (e) { toast('Скорость не поддерживается'); }
          return;
        }
        if (a === 'pip') {
          if (!v || !document.pictureInPictureEnabled || !v.requestPictureInPicture) {
            toast('PiP недоступен');
            return;
          }
          if (document.pictureInPictureElement) document.exitPictureInPicture().catch(function(){});
          else v.requestPictureInPicture().catch(function(){ toast('PiP ошибка'); });
          return;
        }
        if (a === 'fs') {
          var el = host;
          var req = el.requestFullscreen || el.webkitRequestFullscreen;
          var exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (document.fullscreenElement || document.webkitFullscreenElement) {
            if (exit) exit.call(document);
          } else if (req) {
            req.call(el).catch(function(){
              if (v && v.webkitEnterFullscreen) v.webkitEnterFullscreen();
              else toast('Fullscreen недоступен');
            });
          } else if (v && v.webkitEnterFullscreen) {
            v.webkitEnterFullscreen();
          } else toast('Fullscreen недоступен');
        }
      } catch (e) {
        toast((e && e.message) || 'Ошибка');
      }
    });
  }

  function playMedia(videoEl, url, forceHls) {
    url = absUrl(url);
    try { if (videoEl._hls) { videoEl._hls.destroy(); videoEl._hls = null; } } catch (e) {}
    try { if (videoEl._shaka) { videoEl._shaka.destroy(); videoEl._shaka = null; } } catch (e) {}
    try { if (videoEl._videojs && videoEl._videojs.dispose) videoEl._videojs.dispose(); } catch (e) {}
    try { if (videoEl._dashjs && videoEl._dashjs.reset) videoEl._dashjs.reset(); } catch (e) {}
    var mode = getSetting('player', 'auto');
    var isHls = !!forceHls || /\.m3u8($|\?)/i.test(url);
    var isDash = /\.mpd($|\?)/i.test(url);
    var type = isHls ? 'application/x-mpegURL' : (isDash ? 'application/dash+xml' : 'video/mp4');

    function nativePlay() {
      if (isHls && !(videoEl.canPlayType('application/vnd.apple.mpegurl') || videoEl.canPlayType('application/x-mpegURL'))) {
        throw new Error('Этот браузер не поддерживает нативный HLS. Выбери HLS.js, Shaka или Auto.');
      }
      videoEl.src = url;
      attachPlayerChrome(videoEl);
      var p = videoEl.play();
      if (p && p.catch) p.catch(function(){});
    }
    function hlsPlay() {
      if (!isHls) throw new Error('HLS.js предназначен для потоков .m3u8. Для MP4/DASH выбери другой плеер.');
      if (window.Hls && Hls.isSupported()) {
        var hls = new Hls({ enableWorker: true, maxBufferLength: 30, backBufferLength: 30 });
        hls.loadSource(url); hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, function(){ videoEl.play().catch(function(){}); });
        hls.on(Hls.Events.ERROR, function(_, data) {
          if (data && data.fatal) playerError(videoEl, 'HLS.js: ошибка потока (' + (data.details || data.type || 'unknown') + '). Проверь ссылку и CORS источника.');
        });
        videoEl._hls = hls;
        attachPlayerChrome(videoEl);
        return;
      }
      if (videoEl.canPlayType('application/vnd.apple.mpegurl')) { nativePlay(); return; }
      throw new Error('HLS.js недоступен в этом браузере. Проверь загрузку CDN или выбери Auto.');
    }
    function shakaPlay() {
      return loadPlayerScript('shaka', 'https://cdn.jsdelivr.net/npm/shaka-player@4.15.19/dist/shaka-player.compiled.js').then(async function(shaka) {
        if (!shaka.Player.isBrowserSupported()) throw new Error('Shaka Player не поддерживается этим браузером.');
        var instance = new shaka.Player();
        await instance.attach(videoEl);
        videoEl._shaka = instance;
        instance.addEventListener('error', function(ev) {
          var d = ev.detail || {};
          playerError(videoEl, 'Shaka Player: ошибка ' + (d.code || '') + ' ' + (d.message || 'поток недоступен'));
        });
        await instance.load(url);
        return videoEl.play().catch(function(){});
      });
    }
    function videoJsPlay() {
      if (isDash) throw new Error('В этой сборке Video.js настроен для HLS и MP4. Для DASH используй Shaka Player.');
      loadPlayerCss('sl-videojs-css', 'https://cdn.jsdelivr.net/npm/video.js@8.23.4/dist/video-js.min.css');
      return loadPlayerScript('videojs', 'https://cdn.jsdelivr.net/npm/video.js@8.23.4/dist/video.min.js').then(function(videojs) {
        videoEl.classList.add('video-js', 'vjs-big-play-centered');
        videoEl.style.width = '100%'; videoEl.style.height = '100%';
        var instance = videojs(videoEl, {
          controls: true, autoplay: false, preload: 'auto', fluid: false,
          responsive: true, liveui: true, controlBar: { volumePanel: { inline: false } }
        });
        videoEl._videojs = instance;
        instance.src({ src: url, type: type });
        instance.ready(function(){ instance.play().catch(function(){}); });
      });
    }
    function dashJsPlay() {
      if (!isDash) throw new Error('dash.js предназначен для MPEG-DASH (.mpd). Для HLS выбери HLS.js или Auto.');
      return loadPlayerScript('dashjs', 'https://cdn.dashjs.org/latest/modern/umd/dash.all.min.js').then(function(dashjs) {
        var instance = dashjs.MediaPlayer().create();
        videoEl._dashjs = instance;
        instance.initialize(videoEl, url, false);
        instance.on(dashjs.MediaPlayer.events.ERROR, function(e) {
          playerError(videoEl, 'dash.js: ошибка воспроизведения DASH' + (e && e.error ? ' (' + (e.error.message || e.error.code || 'unknown') + ')' : ''));
        });
      });
    }
    function clapprPlay() {
      if (isDash) throw new Error('Clappr в этой сборке выбран для MP4 и нативного HLS. Для MPEG-DASH выбери dash.js или Shaka.');
      if (isHls && !(videoEl.canPlayType('application/vnd.apple.mpegurl') || videoEl.canPlayType('application/x-mpegURL'))) throw new Error('В этой конфигурации Clappr использует нативный HLS браузера. Для .m3u8 выбери HLS.js или Auto.');
      return loadPlayerScript('Clappr', 'https://cdn.jsdelivr.net/npm/@clappr/player@latest/dist/clappr.plainhtml5.min.js').then(function(Clappr) {
        var parent = videoEl.parentNode;
        var host = document.createElement('div');
        host.className = 'sl-clappr-host';
        host.id = 'sl-clappr-' + Math.random().toString(36).slice(2);
        host.style.cssText = 'width:100%;height:100%;min-height:240px;background:#000;position:relative';
        parent.replaceChild(host, videoEl);
        var instance = new Clappr.Player({
          source: url,
          parentId: '#' + host.id,
          width: '100%', height: '100%',
          autoPlay: false, mute: false,
          playback: { playInline: true }
        });
        host._clappr = instance;
        instance.on(Clappr.Events.ERROR, function(e) {
          var msg = e && e.message ? e.message : 'источник недоступен';
          playerError(host, 'Clappr: ' + msg + '. Проверь формат потока, CORS и доступность источника.');
        });
      });
    }

    function artPlay() {
      loadPlayerCss('sl-artplayer-css', 'https://cdn.jsdelivr.net/npm/artplayer@5.2.5/dist/artplayer.css');
      return loadPlayerScript('Artplayer', 'https://cdn.jsdelivr.net/npm/artplayer@5.2.5/dist/artplayer.js').then(function(Artplayer) {
        var parent = videoEl.parentNode;
        var host = document.createElement('div');
        host.className = 'sl-artplayer-host';
        host.style.cssText = 'width:100%;height:100%;min-height:240px;background:#000';
        parent.replaceChild(host, videoEl);
        var options = {
          container: host, url: url, autoplay: false, muted: false, pip: true,
          setting: true, playbackRate: true, aspectRatio: true, fullscreen: true,
          theme: '#8b5cf6', volume: 0.7,
          type: isHls ? 'm3u8' : (isDash ? 'mpd' : 'mp4'),
          customType: {
            m3u8: function(video, src) {
              if (window.Hls && Hls.isSupported()) {
                var hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
                hls.loadSource(src); hls.attachMedia(video);
                video._artHls = hls;
              } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = src;
              else throw new Error('HLS не поддерживается этим браузером');
            },
            mpd: function(video, src) {
              throw new Error('ArtPlayer в этой конфигурации не подключён к DASH. Используй Shaka Player.');
            }
          }
        };
        var instance = new Artplayer(options);
        host._artplayer = instance;
      });
    }

    var task;
    try {
      if (mode === 'native') task = Promise.resolve(nativePlay());
      else if (mode === 'hlsjs') task = Promise.resolve(hlsPlay());
      else if (mode === 'shaka') task = shakaPlay();
      else if (mode === 'videojs') task = videoJsPlay();
      else if (mode === 'dashjs') task = dashJsPlay();
      else if (mode === 'clappr') task = clapprPlay();
      else if (mode === 'artplayer') {
        if (isDash) throw new Error('Для DASH выбери Shaka Player.');
        task = artPlay();

      } else if (mode === 'plyr') {
        loadPlayerCss('sl-plyr-css', 'https://cdn.jsdelivr.net/npm/plyr@3.7.8/dist/plyr.css');
        task = loadPlayerScript('Plyr', 'https://cdn.jsdelivr.net/npm/plyr@3.7.8/dist/plyr.polyfilled.min.js').then(function(Plyr) {
          videoEl.setAttribute('controls', '');
          videoEl.style.width = '100%'; videoEl.style.height = '100%';
          if (isHls && window.Hls && Hls.isSupported()) {
            var hls = new Hls({ enableWorker: true });
            hls.loadSource(url); hls.attachMedia(videoEl);
            videoEl._hls = hls;
          } else { videoEl.src = url; }
          try { videoEl._plyr = new Plyr(videoEl, { controls: ['play','progress','current-time','mute','volume','settings','fullscreen'] }); } catch (e) {}
          attachPlayerChrome(videoEl);
          return videoEl.play().catch(function(){});
        });
      } else if (mode === 'mediaelement') {
        loadPlayerCss('sl-mejs-css', 'https://cdn.jsdelivr.net/npm/mediaelement@7.0.5/build/mediaelementplayer.min.css');
        task = loadPlayerScript('mejs', 'https://cdn.jsdelivr.net/npm/mediaelement@7.0.5/build/mediaelement-and-player.min.js').then(function() {
          videoEl.setAttribute('controls', '');
          videoEl.style.width = '100%'; videoEl.style.height = '100%';
          videoEl.src = url;
          if (window.MediaElementPlayer) {
            try { videoEl._mejs = new MediaElementPlayer(videoEl, { stretching: 'responsive' }); } catch (e) {}
          }
          attachPlayerChrome(videoEl);
          return videoEl.play().catch(function(){});
        });
      } else if (mode === 'dplayer') {
        loadPlayerCss('sl-dp-css', 'https://cdn.jsdelivr.net/npm/dplayer@1.27.1/dist/DPlayer.min.css');
        task = loadPlayerScript('DPlayer', 'https://cdn.jsdelivr.net/npm/dplayer@1.27.1/dist/DPlayer.min.js').then(function(DPlayer) {
          var host = videoEl.parentElement || videoEl;
          try { videoEl.style.display = 'none'; } catch (e) {}
          var box = document.createElement('div');
          box.style.cssText = 'width:100%;height:100%';
          host.appendChild(box);
          var opts = { container: box, autoplay: false, video: { url: url } };
          if (isHls) opts.video.type = 'hls';
          try { videoEl._dplayer = new DPlayer(opts); } catch (e) { videoEl.style.display = ''; videoEl.src = url; }
          attachPlayerChrome(videoEl);
        });

      } else if (mode === 'jwplayer') {
        // Бывший JW CDN часто валит вкладку — безопасный fallback: HLS.js / native + controls
        task = Promise.resolve((function(){
          try { videoEl.setAttribute('controls', ''); videoEl.controls = true; } catch (e) {}
          videoEl.style.width = '100%'; videoEl.style.height = '100%';
          if (isHls && window.Hls && Hls.isSupported()) {
            var hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
            hls.loadSource(url); hls.attachMedia(videoEl);
            videoEl._hls = hls;
            hls.on(Hls.Events.MANIFEST_PARSED, function(){ videoEl.play().catch(function(){}); });
          } else {
            videoEl.src = url;
            videoEl.play().catch(function(){});
          }
          toast('JW: безопасный режим (HLS/native)');
        })());
      } else if (mode === 'pegasus') {
        // Plyr UI + HLS.js engine
        loadPlayerCss('sl-plyr-css', 'https://cdn.jsdelivr.net/npm/plyr@3.7.8/dist/plyr.css');
        task = loadPlayerScript('Plyr', 'https://cdn.jsdelivr.net/npm/plyr@3.7.8/dist/plyr.polyfilled.min.js').then(function(Plyr) {
          videoEl.setAttribute('controls', '');
          videoEl.style.width = '100%'; videoEl.style.height = '100%';
          if (isHls && window.Hls && Hls.isSupported()) {
            var hls = new Hls({ enableWorker: true });
            hls.loadSource(url); hls.attachMedia(videoEl);
            videoEl._hls = hls;
          } else { videoEl.src = url; }
          try { videoEl._plyr = new Plyr(videoEl); } catch (e) {}
          return videoEl.play().catch(function(){});
        });
      } else if (mode === 'vidstack') {
        loadPlayerCss('sl-vidstack-css', 'https://cdn.vidstack.io/player/theme.css');
        task = loadPlayerScript('vidstack', 'https://cdn.vidstack.io/player').then(function() {
          videoEl.setAttribute('controls', '');
          videoEl.style.width = '100%'; videoEl.style.height = '100%';
          if (isHls && window.Hls && Hls.isSupported()) {
            var hls = new Hls({ enableWorker: true });
            hls.loadSource(url); hls.attachMedia(videoEl);
            videoEl._hls = hls;
          } else { videoEl.src = url; }
          return videoEl.play().catch(function(){});
        }).catch(function() {
          videoEl.setAttribute('controls', '');
          videoEl.src = url;
          return videoEl.play().catch(function(){});
        });
      } else if (mode === 'fluid') {
        loadPlayerCss('sl-fluid-css', 'https://cdn.fluidplayer.com/v3/current/fluidplayer.min.css');
        task = loadPlayerScript('fluidPlayer', 'https://cdn.fluidplayer.com/v3/current/fluidplayer.min.js').then(function(fluidPlayer) {
          videoEl.setAttribute('controls', '');
          videoEl.style.width = '100%'; videoEl.style.height = '100%';
          if (isHls && window.Hls && Hls.isSupported()) {
            var hls = new Hls({ enableWorker: true });
            hls.loadSource(url); hls.attachMedia(videoEl);
            videoEl._hls = hls;
          } else { videoEl.src = url; }
          try { videoEl._fluid = fluidPlayer(videoEl, { layoutControls: { fillToContainer: true, primaryColor: '#7C4DFF' } }); } catch (e) {}
          return videoEl.play().catch(function(){});
        });
      } else if (mode === 'openplayer') {
        loadPlayerCss('sl-openplayer-css', 'https://cdn.jsdelivr.net/npm/openplayerjs@2.14.3/dist/openplayer.min.css');
        task = loadPlayerScript('OpenPlayerJS', 'https://cdn.jsdelivr.net/npm/openplayerjs@2.14.3/dist/openplayer.min.js').then(function(OpenPlayerJS) {
          videoEl.style.width = '100%'; videoEl.style.height = '100%';
          if (isHls && window.Hls && Hls.isSupported()) {
            var hls = new Hls({ enableWorker: true });
            hls.loadSource(url); hls.attachMedia(videoEl);
            videoEl._hls = hls;
          } else { videoEl.src = url; }
          try { var op = new OpenPlayerJS(videoEl); op.init(); videoEl._openplayer = op; } catch (e) {}
          return videoEl.play().catch(function(){});
        });
      } else if (mode === 'cdnplayer' || mode === 'liveplayer') {
        task = Promise.resolve((function(){
          var host = videoEl.parentElement || videoEl;
          try { videoEl.style.display = 'none'; videoEl.removeAttribute('src'); } catch (e) {}
          var old = host && host.querySelector && host.querySelector('.sl-tatnet-embed');
          if (old) old.remove();
          var wrap = document.createElement('div');
          wrap.className = 'sl-tatnet-embed';
          wrap.style.cssText = 'position:absolute;inset:0;z-index:4;background:#000;';
          var iframe = document.createElement('iframe');
          iframe.setAttribute('frameborder', '0');
          iframe.setAttribute('allowfullscreen', '');
          iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
          iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000';
          if (mode === 'cdnplayer') {
            iframe.src = 'https://cdnplayerjs.tatnet.app/?src=' + encodeURIComponent(url);
          } else {
            var name = (videoEl.getAttribute('data-title') || 'StreamLive').slice(0, 80);
            iframe.src = 'https://live.tatnet.app/live/embed.html?url=' + encodeURIComponent(url)
              + '&name=' + encodeURIComponent(name) + '&logo=';
          }
          wrap.appendChild(iframe);
          if (host && host.style) {
            if (!host.style.position || host.style.position === 'static') host.style.position = 'relative';
          }
          if (host) host.appendChild(wrap);
        })());

      } else if (mode === 'xgplayer') {
        loadPlayerCss('sl-xg-css', 'https://cdn.jsdelivr.net/npm/xgplayer@3.0.20/dist/index.min.css');
        task = loadPlayerScript('Player', 'https://cdn.jsdelivr.net/npm/xgplayer@3.0.20/dist/index.min.js').then(function() {
          var host = videoEl.parentElement || videoEl;
          try { videoEl.style.display = 'none'; } catch (e) {}
          var box = document.createElement('div');
          box.style.cssText = 'width:100%;height:100%;min-height:200px';
          host.appendChild(box);
          try {
            var conf = { el: box, url: url, fluid: true, autoplay: false };
            if (window.Player) videoEl._xg = new window.Player(conf);
            else { videoEl.style.display = ''; videoEl.src = url; videoEl.controls = true; }
          } catch (e) {
            videoEl.style.display = ''; videoEl.setAttribute('controls',''); videoEl.src = url;
          }
        }).catch(function() {
          videoEl.setAttribute('controls',''); videoEl.src = url;
          return videoEl.play().catch(function(){});
        });
      } else if (mode === 'ckplayer' || mode === 'tcplayer' || mode === 'lightgallery') {
        // Classic/light HTML5 (+ HLS.js when needed)
        task = Promise.resolve((function(){
          try { videoEl.setAttribute('controls',''); videoEl.controls = true; } catch (e) {}
          videoEl.style.width = '100%'; videoEl.style.height = '100%';
          if (isHls && window.Hls && Hls.isSupported()) {
            var hls = new Hls({ enableWorker: true });
            hls.loadSource(url); hls.attachMedia(videoEl);
            videoEl._hls = hls;
            hls.on(Hls.Events.MANIFEST_PARSED, function(){ videoEl.play().catch(function(){}); });
          } else {
            videoEl.src = url;
            videoEl.play().catch(function(){});
          }
        })());
      } else if (mode === 'flowplayer') {
        loadPlayerCss('sl-fp-css', 'https://cdnjs.cloudflare.com/ajax/libs/flowplayer/7.2.7/skin/skin.min.css');
        task = loadPlayerScript('flowplayer', 'https://cdnjs.cloudflare.com/ajax/libs/flowplayer/7.2.7/flowplayer.min.js').then(function(fp) {
          var host = videoEl.parentElement || videoEl;
          try { videoEl.style.display = 'none'; } catch (e) {}
          var box = document.createElement('div');
          box.className = 'flowplayer';
          box.style.cssText = 'width:100%;height:100%';
          host.appendChild(box);
          try {
            if (window.flowplayer) {
              videoEl._fp = window.flowplayer(box, { clip: { sources: [{ type: isHls ? 'application/x-mpegurl' : 'video/mp4', src: url }] } });
            } else {
              videoEl.style.display = ''; videoEl.controls = true; videoEl.src = url;
            }
          } catch (e) {
            videoEl.style.display = ''; videoEl.controls = true; videoEl.src = url;
          }
        }).catch(function() {
          videoEl.setAttribute('controls',''); videoEl.src = url;
          return videoEl.play().catch(function(){});
        });
      } else if (mode === 'afterglow') {
        task = loadPlayerScript('afterglow', 'https://cdn.jsdelivr.net/npm/afterglowplayer@1.1.0/dist/afterglow.min.js').then(function() {
          videoEl.setAttribute('controls','');
          videoEl.classList.add('afterglow');
          videoEl.style.width = '100%'; videoEl.style.height = '100%';
          if (isHls && window.Hls && Hls.isSupported()) {
            var hls = new Hls({ enableWorker: true });
            hls.loadSource(url); hls.attachMedia(videoEl);
            videoEl._hls = hls;
          } else videoEl.src = url;
          try { if (window.afterglow && afterglow.init) afterglow.init(); } catch (e) {}
          return videoEl.play().catch(function(){});
        }).catch(function() {
          videoEl.setAttribute('controls',''); videoEl.src = url;
          return videoEl.play().catch(function(){});
        });

      } else if (mode === 'html5hls' || mode === 'html5only') {
        task = Promise.resolve((function(){
          try { videoEl.setAttribute('controls',''); videoEl.controls = true; } catch (e) {}
          videoEl.style.width = '100%'; videoEl.style.height = '100%';
          if (mode === 'html5hls' && isHls && window.Hls && Hls.isSupported()) {
            var hls = new Hls({ enableWorker: true });
            hls.loadSource(url); hls.attachMedia(videoEl);
            videoEl._hls = hls;
            hls.on(Hls.Events.MANIFEST_PARSED, function(){ videoEl.play().catch(function(){}); });
          } else {
            videoEl.src = url;
            videoEl.play().catch(function(){});
          }
        })());
      } else if (mode === 'embedvideo') {
        task = Promise.resolve((function(){
          var host = videoEl.parentElement || videoEl;
          try { videoEl.style.display = 'none'; } catch (e) {}
          var slugGuess = '';
          try {
            var m = String(url||'').match(/slug=([^&]+)/);
            if (m) slugGuess = decodeURIComponent(m[1]);
          } catch (e) {}
          var ifr = document.createElement('iframe');
          ifr.setAttribute('allowfullscreen','');
          ifr.setAttribute('allow','autoplay; encrypted-media; fullscreen; picture-in-picture');
          ifr.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000';
          ifr.src = absUrl('/embed_video.php?slug=' + encodeURIComponent(slugGuess || (videoEl.getAttribute('data-slug')||'')));
          host.appendChild(ifr);
        })());

      } else if (mode === 'cloudflare' || mode === 'bitmovin' || mode === 'theo' || mode === 'radiant' || mode === 'vjs_old') {
        // Working lightweight engines (HTML5 + optional HLS.js) — no broken proprietary SDKs
        task = Promise.resolve((function(){
          try { videoEl.setAttribute('controls',''); videoEl.controls = true; } catch (e) {}
          videoEl.style.width = '100%'; videoEl.style.height = '100%';
          if (isHls && window.Hls && Hls.isSupported()) {
            var hls = new Hls({ enableWorker: true });
            hls.loadSource(url); hls.attachMedia(videoEl);
            videoEl._hls = hls;
            hls.on(Hls.Events.MANIFEST_PARSED, function(){ videoEl.play().catch(function(){}); });
          } else {
            videoEl.src = url;
            videoEl.play().catch(function(){});
          }
        })());

      } else if (mode === 'hls_lite' || mode === 'mp4_force') {
        task = Promise.resolve((function(){
          try { videoEl.setAttribute('controls',''); videoEl.controls = true; } catch (e) {}
          if (mode === 'hls_lite' && isHls && window.Hls && Hls.isSupported()) {
            var hls = new Hls({ enableWorker: true, maxBufferLength: 20 });
            hls.loadSource(url); hls.attachMedia(videoEl);
            videoEl._hls = hls;
            hls.on(Hls.Events.MANIFEST_PARSED, function(){ videoEl.play().catch(function(){}); });
          } else {
            videoEl.src = url;
            videoEl.play().catch(function(){});
          }
        })());

      } else if (mode === 'android_exo' || mode === 'android_vlc' || mode === 'webview_native') {
        // Android-like stacks in browser: reliable HTML5 + optional HLS.js
        task = Promise.resolve((function(){
          try { videoEl.setAttribute('controls',''); videoEl.controls = true; videoEl.setAttribute('playsinline',''); } catch (e) {}
          videoEl.style.width = '100%'; videoEl.style.height = '100%';
          if (isHls && window.Hls && Hls.isSupported()) {
            var hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
            hls.loadSource(url); hls.attachMedia(videoEl);
            videoEl._hls = hls;
            hls.on(Hls.Events.MANIFEST_PARSED, function(){ videoEl.play().catch(function(){}); });
          } else {
            videoEl.src = url;
            videoEl.play().catch(function(){});
          }
        })());
      } else if (mode === 'auto') {
        // Каскад: первый рабочий движок (без смены URL)
        task = (async function() {
          var errors = [];
          async function tryOne(name, fn) {
            try {
              await Promise.resolve(fn());
              // wait briefly for error
              await new Promise(function(r){ setTimeout(r, 400); });
              if (videoEl.error) throw videoEl.error;
              return true;
            } catch (e) {
              errors.push(name + ': ' + ((e && e.message) || e));
              return false;
            }
          }
          if (isHls && window.Hls && Hls.isSupported()) {
            if (await tryOne('hlsjs', hlsPlay)) return;
          }
          if (isHls && videoEl.canPlayType && videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            if (await tryOne('safari-hls', nativePlay)) return;
          }
          if (isDash) {
            try { await shakaPlay(); return; } catch (e) { errors.push('shaka'); }
          }
          if (await tryOne('native', nativePlay)) return;
          // last resort: set src
          videoEl.src = url;
          try { await videoEl.play(); } catch (e) {}
          if (errors.length) console.warn('auto player fallbacks', errors);
        })();
      } else {
        task = Promise.resolve(nativePlay());
      }
    } catch (e) {
      playerError(videoEl, e.message || 'Не удалось запустить выбранный плеер.');
      return;
    }
    Promise.resolve(task).catch(function(err) {
      playerError(videoEl, (err && err.message) || 'Не удалось запустить выбранный плеер. Проверь формат потока и доступность CDN.');
    });
  }


  function parseEpisodeInfo(title) {
    var t = String(title || '');
    var season = null, episode = null, show = t, kind = 'episode';
    var m;
    // S01E01 / s1e2
    m = t.match(/\b[Ss](\d{1,2})\s*[Ee](\d{1,3})\b/);
    if (m) { season = +m[1]; episode = +m[2]; show = t.replace(m[0], ' '); }
    // 1x03
    if (episode == null) {
      m = t.match(/\b(\d{1,2})\s*[x×]\s*(\d{1,3})\b/i);
      if (m) { season = +m[1]; episode = +m[2]; show = t.replace(m[0], ' '); }
    }
    // Сезон 1 Серия 3
    if (episode == null) {
      m = t.match(/[Сс]езон\s*(\d{1,2}).{0,24}[Сс]ери[яи]\s*(\d{1,3})/);
      if (m) { season = +m[1]; episode = +m[2]; show = t.replace(m[0], ' '); }
    }
    // Серия 5 / Episode 5 / Ep. 5 / E5
    if (episode == null) {
      m = t.match(/(?:[Сс]ери[яи]|[Ee]pisode|[Ee]p\.?)\s*(\d{1,3})\b/);
      if (m) { season = season || 1; episode = +m[1]; show = t.replace(m[0], ' '); }
    }
    // Part 1 / Pt.2 / P.3 / Часть 1 / Ч.2 / часть1
    if (episode == null) {
      m = t.match(/(?:^|[\s\-–—|:(])(?:[Pp]arts?|[Pp]t\.?|[Pp]\.?|[Чч]асть|[Чч]\.?)\s*(\d{1,3})(?:\b|$)/);
      if (m) {
        season = 1; episode = +m[1]; kind = 'part';
        show = t.replace(m[0], ' ').replace(/(?:^|[\s\-–—|:(])(?:[Pp]arts?|[Pp]t\.?|[Pp]\.?|[Чч]асть|[Чч]\.?)\s*$/,' ');
      }
    }
    // trailing " 1/2" or " (2/2)" or " #2"
    if (episode == null) {
      m = t.match(/[\s\-–—|(]+(\d{1,2})\s*\/\s*(\d{1,2})\s*\)?\s*$/);
      if (m) {
        season = 1; episode = +m[1]; kind = 'part';
        show = t.replace(m[0], ' ');
      }
    }
    if (episode == null) {
      m = t.match(/[\s\-–—|#(]+(?:#|№)?\s*(\d{1,2})\s*$/);
      // only if title has another sibling-like structure later; weak — require word part nearby already handled
    }
    show = show.replace(/[\-–—|:()#]+$/g, '').replace(/^[\-–—|:()#]+/g, '').replace(/\s+/g, ' ').trim();
    if (!show || episode == null) return null;
    if (show.length < 2) return null;
    return { show: show, season: season || 1, episode: episode, kind: kind || 'episode', raw: t };
  }


  function normalizeShowKey(name) {
    return String(name || '').toLowerCase()
      .replace(/(?:part|pt|часть|сери[яи]|episode|ep)\s*\d+/gi, ' ')
      .replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  function findRelatedEpisodes(currentTitle, allVideos, channelTitle) {
    var info = parseEpisodeInfo(currentTitle);
    if (!info) return null;
    var key = normalizeShowKey(info.show);
    if (key.length < 2) return null;
    var items = [];
    var chKey = normalizeShowKey(channelTitle || '');
    (allVideos || []).forEach(function(v) {
      var title = v.title || v.name || '';
      var ep = parseEpisodeInfo(title);
      if (!ep) return;
      var sameShow = normalizeShowKey(ep.show) === key;
      // also allow same channel + episode pattern if show keys share prefix
      var chOk = chKey && normalizeShowKey(v.channel_title || '') === chKey;
      var soft = sameShow || (chOk && normalizeShowKey(ep.show).indexOf(key.slice(0, Math.min(8, key.length))) === 0);
      if (!soft && !sameShow) return;
      if (!sameShow && !chOk) return;
      items.push({ video: v, season: ep.season, episode: ep.episode, title: title, kind: ep.kind || 'episode' });
    });
    // Always include current as synthetic if missing
    var hasCur = items.some(function(it){ return normalizeShowKey(it.title) === normalizeShowKey(currentTitle); });
    if (!hasCur) {
      items.push({ video: { slug: '', title: currentTitle }, season: info.season, episode: info.episode, title: currentTitle, kind: info.kind || 'episode', _current: true });
    }
    items.sort(function(a, b) {
      if (a.season !== b.season) return a.season - b.season;
      return a.episode - b.episode;
    });
    // Show block even for 1 episode (user sees SxxExx)
    return { show: info.show, season: info.season, episode: info.episode, items: items };
  }

  function renderEpisodesBlock(container, series, currentSlug) {
    if (!series || !series.items || !series.items.length) return;
    var wrap = el('div', { class: 'episodes glass-panel' });
    wrap.innerHTML = '<div class="sec-head"><h3>Эпизоды · ' + (series.show || '') + '</h3></div>';
    var bySeason = {};
    series.items.forEach(function(it) {
      bySeason[it.season] = bySeason[it.season] || [];
      bySeason[it.season].push(it);
    });
    Object.keys(bySeason).sort(function(a,b){return +a-+b;}).forEach(function(s) {
      wrap.appendChild(el('p', { class: 'set-sec', style: 'margin:8px 0 6px' }, 'Сезон ' + s));
      var list = el('div', { class: 'list' });
      bySeason[s].forEach(function(it) {
        var slug = it.video.slug || it.video.id;
        var row = el('button', { type: 'button', class: 'row' + (String(slug) === String(currentSlug) ? ' on' : '') });
        var isPart = it.kind === 'part' || (series && series.items && series.items.some(function(x){ return x.kind === 'part'; }));
        var lab = isPart
          ? ('Часть ' + it.episode)
          : ('S' + String(it.season).padStart(2,'0') + 'E' + String(it.episode).padStart(2,'0'));
        row.innerHTML = '<div class="tx"><b>' + lab + ' · ' + (it.title || '') + '</b></div>';
        row.onclick = function(){ const s = String(slug || '').trim(); if (!s) { toast('Нет slug серии'); return; } go('video', { slug: s }); };
        list.appendChild(row);
      });
      wrap.appendChild(list);
    });
    // next episode
    var idx = -1;
    for (var i = 0; i < series.items.length; i++) {
      if (String(series.items[i].video.slug || series.items[i].video.id) === String(currentSlug)) { idx = i; break; }
    }
    if (idx >= 0 && idx < series.items.length - 1) {
      var next = series.items[idx + 1];
      var nb = el('button', { type: 'button', class: 'btn', style: 'margin-top:10px' }, (series.items[0] && series.items[0].kind === 'part') ? 'Следующая часть →' : 'Следующая серия →');
      nb.onclick = function(){ const s = String(next.video.slug || next.video.id || '').trim(); if (!s) { toast('Нет следующей серии'); return; } go('video', { slug: s }); };
      wrap.appendChild(nb);
      state._nextEpisodeSlug = next.video.slug || next.video.id;
    } else {
      state._nextEpisodeSlug = null;
    }
    container.appendChild(wrap);
  }


  function absUrl(u) {
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('//')) return 'https:' + u;
    return state.base + (u.startsWith('/') ? u : '/' + u);
  }


  /** POST/GET with form+JSON fallbacks, multiple paths — против anti-bot HTML. */
  async function softFetchJson(paths, method, data) {
    var origin = state.base || location.origin;
    method = (method || 'GET').toUpperCase();
    data = data || {};
    function formBody(obj) {
      var sp = new URLSearchParams();
      Object.keys(obj).forEach(function(k) {
        if (obj[k] != null && obj[k] !== '') sp.append(k, String(obj[k]));
      });
      return sp.toString();
    }
    function parseMaybeJson(text) {
      text = (text || '').replace(/^\uFEFF/, '').trim();
      try { return JSON.parse(text); } catch (e) {}
      var m = text.match(/\{[\s\S]*"ok"[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
      return null;
    }
    var lastErr = null;
    for (var i = 0; i < paths.length; i++) {
      var base = origin + paths[i];
      var attempts = [];
      if (method === 'GET') {
        var q = formBody(data);
        attempts.push({ url: base + (base.indexOf('?') >= 0 ? '&' : '?') + q, body: null, ct: null, method: 'GET' });
      } else {
        attempts.push({ url: base, body: formBody(data), ct: 'application/x-www-form-urlencoded;charset=UTF-8', method: 'POST' });
        attempts.push({ url: base, body: JSON.stringify(data), ct: 'application/json', method: 'POST' });
        attempts.push({ url: base, body: formBody(data), ct: null, method: 'POST' });
      }
      for (var a = 0; a < attempts.length; a++) {
        try {
          var at = attempts[a];
          var headers = { 'Accept': 'application/json, text/plain, */*', 'X-SL-App': '1' };
          if (at.ct) headers['Content-Type'] = at.ct;
          if (state.apiKey) headers['X-API-KEY'] = state.apiKey;
          var res = await fetch(at.url, {
            method: at.method,
            credentials: 'include',
            headers: headers,
            cache: 'no-store',
            body: at.method === 'GET' ? undefined : at.body,
            mode: 'same-origin'
          });
          var text = await res.text();
          var dataJ = parseMaybeJson(text);
          if (dataJ) return dataJ;
          lastErr = 'not-json HTTP ' + res.status;
        } catch (e) {
          lastErr = e.message || String(e);
        }
      }
    }
    throw new Error(lastErr || 'Нет JSON от сервера');
  }

  async function api(method, path, { query, body, failover = false } = {}) {
    if (path.indexOf('/api/') === 0) path = '/webapp' + path;
    const hosts = failover
      ? [state.base, ...MIRRORS.filter(m => m !== state.base)]
      : [state.base];
    let lastErr = null;
    for (const host of hosts) {
      try {
        let url = host + path;
        if (query) {
          const qs = new URLSearchParams(query).toString();
          if (qs) url += (url.includes('?') ? '&' : '?') + qs;
        }
        const opts = {
          method,
          credentials: 'include',
          headers: { 'Accept': 'application/json', 'X-SL-App': '1' },
          cache: 'no-store'
        };
        if (state.apiKey) opts.headers['X-API-KEY'] = state.apiKey;
        if (method === 'POST') {
          opts.headers['Content-Type'] = 'application/json';
          opts.body = JSON.stringify(body || {});
        }
        const res = await fetch(url, opts);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch (_) {
          if (/проверка браузера|ddos_pow|Проверка браузера|proof-of-work|Идёт проверка/i.test(text) || res.status === 503) {
            // НЕ делаем location.reload() — это сбрасывало форму входа
            lastErr = 'Защита сайта блокирует API. Открой /webapp/api/native_auth.php вручную или отключи anti-bot для /webapp/api/';
          } else if (res.status === 403 || res.status === 429) {
            lastErr = 'Доступ ограничен (HTTP ' + res.status + '). Гео-фильтр или лимит хостинга.';
          } else {
            lastErr = 'Сервер вернул не JSON (HTTP ' + res.status + '). Залит ли /api/native_auth.php?';
          }
          if (res.status >= 500) continue;
          throw new Error(lastErr);
        }
        if (host !== state.base) {
          state.base = host;
          localStorage.setItem('sl_base', host);
        }
        return data;
      } catch (e) {
        lastErr = e.message || String(e);
      }
    }
    throw new Error(lastErr || 'Нет связи с сервером');
  }

  function authViaIframe(action, payload) {
    return new Promise(function(resolve, reject) {
      var done = false;
      var iframe = document.createElement('iframe');
      iframe.name = 'sl_auth_iframe_' + Date.now();
      iframe.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;opacity:0;border:0';
      var form = document.createElement('form');
      form.method = 'POST';
      form.action = (state.base || location.origin) + '/webapp/auth_bridge.php';
      form.target = iframe.name;
      form.acceptCharset = 'UTF-8';
      form.style.display = 'none';
      var data = Object.assign({ action: action }, payload || {});
      Object.keys(data).forEach(function(k) {
        if (data[k] == null || data[k] === '') return;
        var inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = k;
        inp.value = String(data[k]);
        form.appendChild(inp);
      });
      function cleanup() {
        try { window.removeEventListener('message', onMsg); } catch (e) {}
        try { iframe.remove(); form.remove(); } catch (e) {}
      }
      function finish(ok, val) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        if (ok) resolve(val);
        else reject(val instanceof Error ? val : new Error(String(val)));
      }
      function onMsg(ev) {
        try {
          var d = ev.data;
          if (!d || d.type !== 'sl_auth') return;
          finish(true, d.data);
        } catch (e) {}
      }
      window.addEventListener('message', onMsg);
      var timer = setTimeout(function() {
        // try read iframe content if same-origin
        try {
          var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
          if (doc && doc.body) {
            var pre = doc.body.innerText || doc.body.textContent || '';
            var m = pre.match(/\{[\s\S]*\}/);
            if (m) {
              try { finish(true, JSON.parse(m[0])); return; } catch (e) {}
            }
          }
        } catch (e) {}
        finish(false, new Error('Таймаут входа (защита хостинга). Открой /webapp/auth_bridge.php в браузере — если HTML-проверка, нужен whitelist /webapp/'));
      }, 12000);
      document.body.appendChild(iframe);
      document.body.appendChild(form);
      form.submit();
    });
  }

  async function auth(action, payload) {
    var bodyObj = Object.assign({ action: action }, payload || {});
    var origin = state.base || location.origin;

    // 1) iframe form POST — главный обход anti-bot
    try {
      var viaFrame = await authViaIframe(action, payload || {});
      if (viaFrame && typeof viaFrame === 'object') return viaFrame;
    } catch (eFrame) {
      // fall through
    }

    // 2) softFetch form/json on multiple paths
    try {
      return await softFetchJson(
        ['/webapp/auth_bridge.php', '/webapp/sl_auth.php', '/webapp/api/native_auth.php', '/api/native_auth.php'],
        'POST',
        bodyObj
      );
    } catch (eSoft) {}

    // 3) last resort: relative path fetch form
    try {
      var res = await fetch('/webapp/auth_bridge.php', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'Accept': 'application/json' },
        body: new URLSearchParams(bodyObj).toString()
      });
      var text = await res.text();
      try { return JSON.parse(text); } catch (e) {
        var m = text.match(/\{[\s\S]*"ok"[\s\S]*\}/);
        if (m) return JSON.parse(m[0]);
      }
    } catch (e3) {}

    throw new Error('Защита хостинга блокирует вход. Залей webapp/auth_bridge.php и в anti-bot исключи /webapp/ (или отключи проверку для POST форм).');
  }

  function getSetting(k, def) {
    var s = state.settings || {};
    return s[k] != null ? s[k] : def;
  }
  function setSetting(k, v) {
    state.settings = state.settings || {};
    state.settings[k] = v;
    try { localStorage.setItem('sl_settings', JSON.stringify(state.settings)); } catch (e) {}
  }

  function saveUser(u, meta) {
    state.user = u;
    if (u) {
      localStorage.setItem('sl_user', JSON.stringify(u));
      if (meta && meta.api_key) {
        state.apiKey = String(meta.api_key);
        localStorage.setItem('sl_api_key', state.apiKey);
      }
    } else {
      localStorage.removeItem('sl_user');
      localStorage.removeItem('sl_api_key');
      state.apiKey = '';
    }
  }

  /* ---------- routing ---------- */
  function go(name, params) {
    state.route = { name, params: params || {} };
    render();
  }

  /* ---------- screens ---------- */

  // --- Soft notifications (max 1 / 30 min, minimal host hits) ---
  var SL_NOTIF_GAP = 30 * 60 * 1000;
  function notifEnabled() {
    return getSetting('notify', true) !== false;
  }
  function notifCanSend() {
    if (!notifEnabled()) return false;
    if (!('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
    try {
      var last = parseInt(localStorage.getItem('sl_notif_last') || '0', 10) || 0;
      if (Date.now() - last < SL_NOTIF_GAP) return false;
    } catch (e) {}
    return true;
  }
  function notifMarkSent() {
    try { localStorage.setItem('sl_notif_last', String(Date.now())); } catch (e) {}
  }
  function notifShow(title, body, tag) {
    if (!notifCanSend()) return false;
    try {
      var n = new Notification(title || 'StreamLive', {
        body: body || '',
        tag: tag || 'streamlive',
        renotify: false,
        silent: false
      });
      notifMarkSent();
      n.onclick = function() { try { window.focus(); } catch (e) {} n.close(); };
      return true;
    } catch (e) { return false; }
  }
  function notifRequestPermission() {
    if (!('Notification' in window)) {
      toast('Уведомления не поддерживаются');
      return Promise.resolve('denied');
    }
    if (Notification.permission === 'granted') return Promise.resolve('granted');
    if (Notification.permission === 'denied') {
      toast('Разреши уведомления в настройках браузера');
      return Promise.resolve('denied');
    }
    return Notification.requestPermission();
  }
  function showNotifBanner() {
    if (!notifEnabled()) return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return;
    try { if (sessionStorage.getItem('sl_notif_banner') === '1') return; } catch (e) {}
    if (document.getElementById('sl-notif-banner')) return;
    var bar = el('div', { id: 'sl-notif-banner', class: 'sl-notif-banner' });
    bar.innerHTML = '';
    var tx = el('div', { class: 'sl-notif-tx' });
    tx.innerHTML = '<b>Уведомления StreamLive</b><small>Раз в 30 минут — одно: новый контент или сообщение. Без флуда, почти без хитов.</small>';
    var ok = el('button', { type: 'button', class: 'sl-notif-ok' }, 'Разрешить');
    var no = el('button', { type: 'button', class: 'sl-notif-no' }, 'Не сейчас');
    ok.onclick = function() {
      notifRequestPermission().then(function(p) {
        try { sessionStorage.setItem('sl_notif_banner', '1'); } catch (e) {}
        bar.remove();
        if (p === 'granted') {
          toast('Уведомления включены');
          setSetting('notify', true);
          scheduleNotifWorker(true);
        }
      });
    };
    no.onclick = function() {
      try { sessionStorage.setItem('sl_notif_banner', '1'); } catch (e) {}
      bar.remove();
    };
    bar.append(tx, ok, no);
    document.body.appendChild(bar);
  }
  // Fingerprint of catalog from already-loaded data (0 extra hits when using memory)
  function contentFingerprint(channels, videos) {
    var a = (channels || []).slice(0, 20).map(function(c){ return c.slug || c.id || ''; }).join(',');
    var b = (videos || []).slice(0, 20).map(function(v){ return v.slug || v.id || ''; }).join(',');
    return a + '|' + b;
  }
  async function notifCheckOnce() {
    if (!notifEnabled() || !notifCanSend()) return;
    if (document.visibilityState === 'visible' && document.hasFocus && document.hasFocus()) {
      // пока пользователь в приложении — не шумим, только копим fingerprint
    }
    try {
      // 1) messages — rare poll only if logged in
      if (state.user && state.user.id) {
        try {
          var mr = await api('GET', '/api/native_messenger.php', { query: { action: 'conversations' }, failover: false });
          var list = (mr && (mr.conversations || mr.data)) || [];
          var unread = 0;
          var title = '';
          list.forEach(function(cv) {
            var u = parseInt(cv.unread || cv.unread_count || 0, 10) || 0;
            if (u > 0) { unread += u; if (!title) title = cv.title || cv.username || 'Сообщение'; }
          });
          var prevU = parseInt(localStorage.getItem('sl_notif_unread') || '0', 10) || 0;
          localStorage.setItem('sl_notif_unread', String(unread));
          if (unread > prevU) {
            if (notifShow('StreamLive · сообщение', title + (unread > 1 ? (' · ещё ' + (unread - 1)) : ''), 'sl-msg')) return;
          }
        } catch (e) {}
      }
      // 2) content — compare fingerprint; refresh at most with existing cache age
      var prevFp = localStorage.getItem('sl_notif_fp') || '';
      var ch = state.channels || readDataCache('channels:all') || readDataCache('channels:' + (state.filter || 'all')) || [];
      var vid = state.videos || state._videosCache || [];
      // One light request only if we have nothing in memory/cache
      if ((!ch || !ch.length) && notifCanSend()) {
        try {
          var cr = await api('GET', '/api/native_home.php', { query: { type: 'channels', limit: '20' }, failover: false });
          ch = (cr && (cr.channels || cr.data)) || [];
        } catch (e) {}
      }
      if ((!vid || !vid.length) && notifCanSend()) {
        try {
          var vr = await api('GET', '/api/native_videos.php', { query: { action: 'list', limit: '12' }, failover: false });
          vid = (vr && (vr.videos || vr.data)) || [];
          state._videosCache = vid;
        } catch (e) {}
      }
      var fp = contentFingerprint(ch, vid);
      if (prevFp && fp && fp !== prevFp) {
        localStorage.setItem('sl_notif_fp', fp);
        notifShow('StreamLive · новый контент', 'Каталог обновился. Загляни в эфир.', 'sl-content');
        return;
      }
      if (fp) localStorage.setItem('sl_notif_fp', fp);
    } catch (e) {}
  }
  function scheduleNotifWorker(force) {
    if (window.__slNotifTimer) clearInterval(window.__slNotifTimer);
    if (!notifEnabled()) return;
    // First check after 45s (not immediately — save hits on open)
    if (force) setTimeout(notifCheckOnce, 8000);
    else setTimeout(notifCheckOnce, 45000);
    // Then every 30 minutes only
    window.__slNotifTimer = setInterval(notifCheckOnce, SL_NOTIF_GAP);
  }



  // ===== StreamLive «Искры» + ежедневная рулетка (клиент, 0 хитов PHP) =====
  function moscowDayKey() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch (e) {
      var d = new Date(); return d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0');
    }
  }
  function ecoLoad() {
    try {
      var raw = JSON.parse(localStorage.getItem('sl_eco_v1') || '{}');
      return {
        sparks: parseInt(raw.sparks, 10) || 0,
        day: raw.day || '',
        freeLeft: raw.freeLeft != null ? parseInt(raw.freeLeft, 10) : 7,
        lastClaim: parseInt(raw.lastClaim, 10) || 0,
        lastBanner: parseInt(raw.lastBanner, 10) || 0,
        inventory: Array.isArray(raw.inventory) ? raw.inventory : []
      };
    } catch (e) {
      return { sparks: 0, day: '', freeLeft: 7, lastClaim: 0, lastBanner: 0, inventory: [] };
    }
  }
  function ecoSave(eco) {
    try { localStorage.setItem('sl_eco_v1', JSON.stringify(eco)); } catch (e) {}
  }
  function ecoEnsureDay() {
    var eco = ecoLoad();
    var day = moscowDayKey();
    if (eco.day !== day) {
      eco.day = day;
      eco.freeLeft = 7;
      ecoSave(eco);
    }
    return eco;
  }
  function ecoAddSparks(n, reason) {
    var eco = ecoEnsureDay();
    eco.sparks = Math.max(0, (eco.sparks || 0) + (n | 0));
    ecoSave(eco);
    return eco.sparks;
  }
  // Призы рулетки (виртуальные, без внешних API)
  var SL_WHEEL_PRIZES = [
    { id: 's5',  label: '+5 искр',  w: 28, sparks: 5 },
    { id: 's15', label: '+15 искр', w: 22, sparks: 15 },
    { id: 's40', label: '+40 искр', w: 12, sparks: 40 },
    { id: 's100',label: '+100 искр',w: 4,  sparks: 100 },
    { id: 'badge', label: 'Значок «Эфир»', w: 10, item: 'badge_efir' },
    { id: 'frame', label: 'Рамка профиля', w: 8, item: 'frame_neon' },
    { id: 'boost', label: 'Буст удачи ×1', w: 8, item: 'luck_boost' },
    { id: 'ticket',label: 'Билет розыгрыша', w: 6, item: 'draw_ticket' },
    { id: 'empty', label: 'Пусто', w: 2, sparks: 0 }
  ];
  function wheelPick() {
    var sum = 0; SL_WHEEL_PRIZES.forEach(function(p){ sum += p.w; });
    var r = Math.random() * sum, acc = 0;
    for (var i = 0; i < SL_WHEEL_PRIZES.length; i++) {
      acc += SL_WHEEL_PRIZES[i].w;
      if (r <= acc) return SL_WHEEL_PRIZES[i];
    }
    return SL_WHEEL_PRIZES[0];
  }
  function showWheelModal(force) {
    if (document.getElementById('sl-wheel-modal')) return;
    var eco = ecoEnsureDay();
    // если уже крутил сегодня все бесплатные — не спамим, кроме force из меню
    if (!force && eco.freeLeft <= 0) {
      var day = moscowDayKey();
      if (eco.day === day) return;
    }
    if (!force) {
      var gap = 30 * 60 * 1000;
      if (eco.lastBanner && Date.now() - eco.lastBanner < gap && eco.freeLeft < 7) {
        // уже показывали недавно и пользователь мог пропустить — ок показывать раз в 30 мин
      }
      if (eco.lastBanner && Date.now() - eco.lastBanner < gap && eco.freeLeft === 7 && eco.lastClaim) {
        // claimed today partially
      }
    }
    eco.lastBanner = Date.now();
    ecoSave(eco);

    var overlay = el('div', { id: 'sl-wheel-modal', class: 'sl-wheel-overlay' });
    var card = el('div', { class: 'sl-wheel-card glass-panel' });
    card.innerHTML = '';
    var head = el('div', { class: 'sl-wheel-head' });
    head.innerHTML = '<b>Колесо Эфира</b><span class="sl-spark-bal">✦ ' + eco.sparks + '</span>';
    var close = el('button', { type: 'button', class: 'sl-wheel-x' }, '×');
    close.onclick = function(){ overlay.remove(); };
    head.appendChild(close);
    card.appendChild(head);
    card.appendChild(el('p', { class: 'sl-wheel-sub' }, 'Бесплатных круток сегодня: ' + eco.freeLeft + ' / 7 · МСК'));
    var wheel = el('div', { class: 'sl-wheel-disc' }, '✦');
    card.appendChild(wheel);
    var result = el('p', { class: 'sl-wheel-result' }, 'Крути и лови искры');
    card.appendChild(result);
    var spinBtn = el('button', { type: 'button', class: 'sl-wheel-spin grad-btn' }, eco.freeLeft > 0 ? 'Крутить бесплатно' : 'Нет бесплатных · завтра');
    var spinning = false;
    spinBtn.onclick = function() {
      if (spinning) return;
      var e2 = ecoEnsureDay();
      if (e2.freeLeft <= 0) {
        result.textContent = 'Бесплатные крутки завтра (по Москве)';
        return;
      }
      spinning = true;
      spinBtn.disabled = true;
      wheel.classList.add('spinning');
      setTimeout(function() {
        wheel.classList.remove('spinning');
        var prize = wheelPick();
        e2 = ecoEnsureDay();
        e2.freeLeft = Math.max(0, e2.freeLeft - 1);
        e2.lastClaim = Date.now();
        if (prize.sparks) e2.sparks += prize.sparks;
        if (prize.item) e2.inventory.push({ id: prize.item, label: prize.label, at: Date.now() });
        ecoSave(e2);
        result.textContent = 'Приз: ' + prize.label;
        head.querySelector('.sl-spark-bal').textContent = '✦ ' + e2.sparks;
        spinBtn.textContent = e2.freeLeft > 0 ? ('Ещё ' + e2.freeLeft + ' бесплатно') : 'На сегодня всё';
        spinBtn.disabled = false;
        spinning = false;
        card.querySelector('.sl-wheel-sub').textContent = 'Бесплатных круток сегодня: ' + e2.freeLeft + ' / 7 · МСК';
      }, 2200);
    };
    card.appendChild(spinBtn);
    card.appendChild(el('p', { class: 'sl-wheel-hint' }, 'Искры — внутри приложения. Платные игры/призы через модерацию на сайте позже.'));
    overlay.appendChild(card);
    overlay.addEventListener('click', function(ev){ if (ev.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }
  function scheduleWheelBanner() {
    setTimeout(function(){ showWheelModal(false); }, 4000);
    setInterval(function() {
      var eco = ecoEnsureDay();
      if (eco.freeLeft > 0) showWheelModal(false);
    }, 30 * 60 * 1000);
  }


  function screenSplash(root) {
    root.innerHTML = '';
    root.className = 'bg-vibe';
    if (window.slDoodles) try { window.slDoodles(root); } catch (e) {}
    const s = el('div', { class: 'splash' });
    s.appendChild(el('div', { class: 'logo-mark' }, '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'));
    s.appendChild(el('h1', null, 'StreamLive'));
    s.appendChild(el('p', null, 'смотри. общайся. кайфуй.'));
    root.appendChild(s);

    (async () => {
      try {
        const r = await auth('me');
        if (r && r.ok && r.user) {
          saveUser(r.user, r);
          go('home');
          return;
        }
      } catch (_) {}
      // если есть сохранённый аккаунт — пускаем в приложение (как Starter)
      if (state.user && state.user.username) {
        go('home');
        return;
      }
      go('auth');
    })();
  }

  function screenAuth(root) {
    root.innerHTML = '';
    root.className = 'bg-vibe';
    if (window.slDoodles) try { window.slDoodles(root); } catch (e) {}

    const screen = el('div', { class: 'auth-screen' });
    const inner = el('div', { class: 'auth-inner' });

    const logo = el('div', { class: 'logo-mark' }, '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>');
    inner.appendChild(logo);
    inner.appendChild(el('h1', null, 'StreamLive'));
    const sub = el('p', { class: 'sub' }, 'С возвращением! Заходи в эфир');
    inner.appendChild(sub);

    // mode: password | register | totp
    let mode = 'password';
    let need2fa = false;
    let busy = false;

    const tabs = el('div', { class: 'mode-tabs' });
    const tPass = el('button', { class: 'on', type: 'button' }, 'Пароль');
    const t2fa = el('button', { type: 'button' }, 'Только 2FA');
    const tReg = el('button', { type: 'button' }, 'Регистрация');
    tabs.append(tPass, t2fa, tReg);
    inner.appendChild(tabs);

    const card = el('form', { class: 'auth-card', action: 'javascript:void(0)', onsubmit: function(e){ e.preventDefault(); return false; } });
    const err = el('div', { class: 'err-txt' });

    function field(id, type, placeholder, icon, extra) {
      const w = el('div', { class: 'field' });
      w.innerHTML = '<span class="prefix">' + icon + '</span><input id="' + id + '" type="' + type + '" placeholder="' + placeholder + '"' + (extra || '') + '>';
      return w;
    }

    const fEmail = field('email', 'email', 'Email', '✉️', ' autocomplete="email"');
    const fLogin = field('login', 'text', 'Email, логин или телефон', '👤', ' autocomplete="username" autocapitalize="off"');
    const fPass = field('pass', 'password', 'Пароль', '🔒', ' autocomplete="current-password"');
    const fCode = field('code', 'text', 'Код 2FA', '🛡️', ' inputmode="numeric" maxlength="8" autocomplete="one-time-code"');
    const fPhone = field('phone', 'tel', 'Телефон (необязательно)', '📱', ' placeholder="+79991234567"');

    const goBtn = el('button', { class: 'grad-btn', type: 'button' }, 'Войти');
    card.append(fEmail, fLogin, fPass, fCode, fPhone, err, goBtn);
    inner.appendChild(card);

    const switchLink = el('button', { class: 'link-btn', type: 'button' }, 'Нет аккаунта? Регистрация');
    inner.appendChild(switchLink);


        inner.appendChild(el('p', { class: 'auth-hint' }, 'Аккаунт общий с сайтом. Можно войти паролем (и 2FA, если включена) или только кодом 2FA без пароля.'));

    screen.appendChild(inner);
    root.appendChild(screen);

    function showErr(m) { err.textContent = m || ''; }

    function applyMode(m) {
      mode = m;
      need2fa = false;
      showErr('');
      tPass.className = m === 'password' ? 'on' : '';
      t2fa.className = m === 'totp' ? 'on' : '';
      tReg.className = m === 'register' ? 'on' : '';
      fEmail.style.display = m === 'register' ? '' : 'none';
      fPhone.style.display = m === 'register' ? '' : 'none';
      fPass.style.display = m === 'totp' ? 'none' : '';
      fCode.style.display = (m === 'totp' || need2fa) ? '' : 'none';
      fLogin.querySelector('input').placeholder = m === 'register' ? 'Логин (3–30 символов)' : (m === 'totp' ? 'Логин или email' : 'Email, логин или телефон');
      goBtn.textContent = m === 'register' ? 'Зарегистрироваться' : 'Войти';
      sub.textContent = m === 'register' ? 'Создай аккаунт и залетай в эфир' : (m === 'totp' ? 'Логин + код из Authenticator' : 'С возвращением! Заходи в эфир');
      switchLink.textContent = m === 'register' ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Регистрация';
    }

    tPass.onclick = () => applyMode('password');
    t2fa.onclick = () => applyMode('totp');
    tReg.onclick = () => applyMode('register');
    switchLink.onclick = () => applyMode(mode === 'register' ? 'password' : 'register');
    applyMode('password');

    async function submit() {
      if (busy) return;
      showErr('');
      const login = (card.querySelector('#login').value || '').trim();
      const password = card.querySelector('#pass').value || '';
      const email = (card.querySelector('#email').value || '').trim();
      const code = (card.querySelector('#code').value || '').replace(/\s+/g, '');
      const phone = (card.querySelector('#phone').value || '').trim();

      busy = true;
      goBtn.disabled = true;
      const prev = goBtn.textContent;
      goBtn.innerHTML = '<span class="spin"></span>';

      try {
        if (mode === 'totp') {
          if (!login || !code) throw new Error('Введите логин и код 2FA');
          const r = await auth('login_2fa', { login, code });
          if (!r.ok) throw new Error(r.error || 'Ошибка входа');
          saveUser(r.user, r);
          toast('Добро пожаловать, ' + (r.user.username || ''));
          root.className = '';
          go('home');
          return;
        }
        if (mode === 'register') {
          if (!email || !login || password.length < 6) throw new Error('Email, логин (мин. 3) и пароль (мин. 6)');
          const body = { email, username: login, password };
          if (phone) body.phone = phone;
          const r = await auth('register', body);
          if (!r.ok) throw new Error(r.error || 'Ошибка регистрации');
          saveUser(r.user, r);
          toast('Аккаунт создан');
          root.className = '';
          go('home');
          return;
        }
        // password mode
        if (!login || !password) throw new Error('Введите логин и пароль');
        const body = { login, password };
        if (need2fa || code) body.code = code;
        const r = await auth('login', body);
        if (r.need_2fa) {
          need2fa = true;
          fCode.style.display = '';
          showErr(r.error || 'Введите код из приложения-аутентификатора');
          goBtn.textContent = 'Подтвердить 2FA';
          return;
        }
        if (!r.ok) throw new Error(r.error || 'Ошибка входа');
        saveUser(r.user, r);
        toast('Добро пожаловать, ' + (r.user.username || ''));
        root.className = '';
        go('home');
      } catch (e) {
        showErr(e.message || 'Ошибка');
        goBtn.textContent = need2fa ? 'Подтвердить 2FA' : prev;
      } finally {
        busy = false;
        goBtn.disabled = false;
        if (goBtn.querySelector('.spin')) goBtn.textContent = need2fa ? 'Подтвердить 2FA' : (mode === 'register' ? 'Зарегистрироваться' : 'Войти');
      }
    }

    goBtn.onclick = function(ev) {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      submit();
    };
    card.querySelectorAll('input').forEach(function(inp) {
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          submit();
        }
      });
    });
    // Блокируем любой нативный submit, если браузер обернул в form
    card.addEventListener('submit', function(e) {
      e.preventDefault();
      e.stopPropagation();
      submit();
    });
  }

  function shell(root, title, bodyFn, { fab, back } = {}) {
    root.innerHTML = '';
    const sh = el('div', { class: 'shell nav-' + (getSetting('nav_layout', 'bottom') || 'bottom') });
    const side = el('aside', { class: 'desktop-side' });
    side.innerHTML = '<div class="brand"><span class="brand-mark">▶</span><span>Stream<span>Live</span></span></div><div class="side-caption">МЕНЮ</div>';
    const top = el('div', { class: 'topbar' });
    top.appendChild(el('div', { class: 'mobile-brand' }, '<span class="brand-mark">▶</span> StreamLive'));
    if (back) {
      const b = el('button', { class: 'icon-btn glass-oval', type: 'button', onClick: back, 'aria-label': 'Назад' }, '‹');
      top.appendChild(b);
    }
    top.appendChild(el('h1', null, title));
    // Desktop: full search field
    const searchTop = el('button', { class: 'top-search', type: 'button', onClick: () => go('search') }, '⌕  Поиск фильмов, каналов, видео…');
    top.appendChild(searchTop);
    // Mobile: oval glass buttons (Telegram-style) — search + create
    const topActions = el('div', { class: 'top-actions' });
    const searchOval = el('button', { class: 'glass-oval', type: 'button', 'aria-label': 'Поиск', onClick: () => go('search') }, '⌕');
    const createOval = el('button', { class: 'glass-oval glass-oval-accent', type: 'button', 'aria-label': 'Создать канал', onClick: () => go('create') }, '＋');
    topActions.append(searchOval, createOval);
    top.appendChild(topActions);
    sh.appendChild(top);

    const content = el('div', { class: 'content' });
    sh.appendChild(content);
    bodyFn(content);

    const nav = el('div', { class: 'nav' });
    const tabs = [
      { i: '📡', l: 'Эфир' },
      { i: '▶', l: 'Видео' },
      { i: '💭', l: 'Форум' },
      { i: '💬', l: 'Чат' },
      { i: '🎮', l: 'Игры' },
      { i: '👤', l: 'Профиль' }
    ];
    tabs.forEach((t, idx) => {
      const b = el('button', { class: state.tab === idx ? 'on' : '', type: 'button' });
      b.innerHTML = '<span class="ic">' + t.i + '</span>' + t.l;
      b.onclick = () => { state.tab = idx; go('home'); };
      nav.appendChild(b);
      const sb = el('button', { class: state.tab === idx ? 'on' : '', type: 'button' });
      sb.innerHTML = '<span class="ic">' + t.i + '</span><span>' + t.l + '</span>';
      sb.onclick = () => { state.tab = idx; go('home'); };
      side.appendChild(sb);
    });
    side.appendChild(el('div', { class: 'side-bottom' }, '<span>StreamLive</span><small>Смотри. Играй. Общайся.</small>'));
    sh.appendChild(side);
    sh.appendChild(nav);

    if (fab) {
      const fw = el('div', { class: 'fab-wrap' });
      fab.forEach(f => {
        const b = el('button', { class: 'fab' + (f.sm ? ' sm' : ''), type: 'button', onClick: f.onClick }, f.label);
        fw.appendChild(b);
      });
      sh.appendChild(fw);
    }

    content.addEventListener('scroll', () => {
      top.classList.toggle('scrolled', content.scrollTop > 4);
    }, { passive: true });


    if (getSetting('nav_layout', 'bottom') === 'hamburger') {
      const fab = el('button', { type: 'button', class: 'hamburger-fab', 'aria-label': 'Меню' }, '☰');
      fab.onclick = function() {
        const overlay = el('div', { class: 'ham-menu' });
        const sheet = el('div', { class: 'sheet' });
        sheet.innerHTML = '<b style="display:block;margin-bottom:12px">Меню</b>';
        const tabs = [
          { i: '📡', l: 'Эфир', t: 0 },
          { i: '▶', l: 'Видео', t: 1 },
          { i: '💭', l: 'Форум', t: 2 },
          { i: '💬', l: 'Чат', t: 3 },
          { i: '🎮', l: 'Игры', t: 4 },
          { i: '👤', l: 'Профиль', t: 5 }
        ];
        tabs.forEach(function(t) {
          const b = el('button', { type: 'button', class: 'row' + (state.tab === t.t ? ' on' : '') });
          b.innerHTML = '<div class="tx"><b>' + t.i + ' ' + t.l + '</b></div>';
          b.onclick = function() { state.tab = t.t; overlay.remove(); go('home'); };
          sheet.appendChild(b);
        });
        overlay.appendChild(sheet);
        overlay.onclick = function(e){ if (e.target === overlay) overlay.remove(); };
        sh.appendChild(overlay);
      };
      sh.appendChild(fab);
    }
    root.appendChild(sh);
  }

  function screenHome(root) {
    if (state.tab === 0) return tabChannels(root);
    if (state.tab === 1) return tabVideos(root);
    if (state.tab === 2) return tabForum(root);
    if (state.tab === 3) return tabChat(root);
    if (state.tab === 4) return tabGames(root);
    return tabProfile(root);
  }


  function channelThumbSrc(ch) {
    var logo = ch && (ch.logo_url || ch.image || ch.thumb || ch.cover || ch.icon);
    if (logo) return absUrl(logo);
    // Client-side placeholder — no InfinityFree hits
    var title = String((ch && (ch.title || ch.name)) || '?');
    var letter = title.charAt(0).toUpperCase() || '?';
    var h = 0;
    for (var i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
    var c1 = '#' + ((h & 0xffffff) | 0x4040a0).toString(16).slice(-6);
    var c2 = '#' + (((h * 7) & 0xffffff) | 0x203060).toString(16).slice(-6);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/>' +
      '</linearGradient></defs>' +
      '<rect width="320" height="180" fill="url(#g)"/>' +
      '<text x="160" y="100" text-anchor="middle" font-size="72" font-family="system-ui,sans-serif" fill="rgba(255,255,255,.9)" font-weight="700">' + letter + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function renderChannelCards(box, list) {
    box.className = list && list.length ? 'grid' : 'empty';
    box.innerHTML = '';
    if (!list || !list.length) {
      box.innerHTML = '<b>Пока пусто</b>Каналы появятся здесь';
      return;
    }
    list.forEach(ch => {
      const card = el('div', { class: 'card' });
      const thumb = el('div', { class: 'thumb' });
      const src = channelThumbSrc(ch);
      const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' });
      img.src = src;
      img.onerror = () => {
        // fallback pure letter without network
        img.src = channelThumbSrc({ title: ch.title || ch.name || '?', logo_url: '' });
      };
      thumb.appendChild(img);
      thumb.appendChild(el('div', { class: 'play' }, '▶'));
      const meta = el('div', { class: 'meta' });
      meta.innerHTML = '<b></b><small></small>';
      meta.querySelector('b').textContent = ch.title || ch.name || 'Канал';
      meta.querySelector('small').textContent = (ch.type === 'radio' ? 'Радио' : 'ТВ') + (ch.is_live ? ' · эфир' : '');
      card.append(thumb, meta);
      card.onclick = () => { const s = String(ch.slug || ch.id || '').trim(); if (!s) { toast('Нет slug канала'); return; } go('channel', { slug: s }); };
      // Preview from already-loaded logo only — zero extra API hits
      bindMediaPreview(card, {
        image: src.startsWith('data:') ? src : (ch.logo_url || ch.image || ''),
        stream: '', // never pull streams for channel grid — 0 extra hits
        title: ch.title || ch.name || 'Канал'
      });
      box.appendChild(card);
    });
  }


  function currentSeasonInfo() {
    var m = (new Date()).getMonth(); // 0-11
    if (m >= 2 && m <= 4) return { id: 'spring', title: 'Весна', hint: 'Что посмотреть весной', keys: ['весна','spring','май','апрель','март','цве','роман','прогул'] };
    if (m >= 5 && m <= 7) return { id: 'summer', title: 'Лето', hint: 'Что посмотреть летом', keys: ['лето','summer','июнь','июль','август','море','отпуск','пляж','солн'] };
    if (m >= 8 && m <= 10) return { id: 'autumn', title: 'Осень', hint: 'Что посмотреть осенью', keys: ['осень','autumn','fall','сентябрь','октябрь','ноябрь','дожд','уют'] };
    return { id: 'winter', title: 'Зима', hint: 'Что посмотреть зимой', keys: ['зима','winter','декабрь','январь','февраль','новый год','снег','мороз','праздн'] };
  }

  function scoreSeasonItem(item, keys) {
    var t = ((item.title || item.name || '') + ' ' + (item.description || '') + ' ' + (item.channel_title || '')).toLowerCase();
    var s = 0;
    keys.forEach(function(k){ if (t.indexOf(k) >= 0) s += 2; });
    // light boost for live / popular fields if present
    if (item.is_live) s += 1;
    if (item.views_count) s += Math.min(3, Math.log10((item.views_count||0)+1));
    return s;
  }

  function pickSeasonal(list, limit) {
    var info = currentSeasonInfo();
    var scored = (list || []).map(function(it){
      return { it: it, s: scoreSeasonItem(it, info.keys) };
    }).filter(function(x){ return x.s > 0; });
    scored.sort(function(a,b){ return b.s - a.s; });
    var out = scored.slice(0, limit).map(function(x){ return x.it; });
    // if not enough keyword matches — fill with first items so shelf never empty
    if (out.length < Math.min(4, (list||[]).length)) {
      (list || []).forEach(function(it){
        if (out.length >= limit) return;
        if (out.indexOf(it) < 0) out.push(it);
      });
    }
    return { info: info, items: out.slice(0, limit) };
  }

  function tabChannels(root) {
    shell(root, 'StreamLive', async (c) => {
      const hero = el('section', { class: 'home-hero' });
      hero.innerHTML = '<div class="hero-copy"><span class="eyebrow">ТВОЯ ПЛАТФОРМА РАЗВЛЕЧЕНИЙ</span><h2>Твой мир развлечений<br><em>в одном приложении</em></h2><p>Фильмы, сериалы, ТВ, прямые эфиры, игры и общение — всё, что ты любишь, всегда под рукой.</p><button class="hero-cta" type="button">Смотреть эфиры <b>→</b></button></div><div class="hero-art"><div class="orb orb-a"></div><div class="orb orb-b"></div><div class="hero-play">▶</div><span class="hero-art-label">STREAM LIVE</span></div>';
      hero.querySelector('.hero-cta').onclick = () => { document.querySelector('.chip-row')?.scrollIntoView({behavior:'smooth',block:'start'}); };
      c.appendChild(hero);

      // Continue watching: lightweight local history, no extra server polling.
      try {
        if (getSetting('watch_history', true)) {
          const history = JSON.parse(localStorage.getItem('sl_watch_history_v1') || '[]');
          if (history.length) {
            const section = el('section', { class: 'home-shelf' });
            section.innerHTML = '<div class="shelf-head"><b>Продолжить просмотр</b><span>Недавно открытые</span></div>';
            const rail = el('div', { class: 'shelf-rail' });
            history.slice(0, 8).forEach(item => {
              const card = el('button', { type:'button', class:'shelf-card' });
              const art = el('div', { class:'shelf-art' });
              if (item.thumbnail_url) {
                const img = el('img', { src:absUrl(item.thumbnail_url), alt:'' });
                img.onerror = () => { img.remove(); art.textContent = '▶'; };
                art.appendChild(img);
              } else art.textContent = '▶';
              const title = el('b', null, item.title || 'Видео');
              const sub = el('small', null, item.channel_title || 'Продолжить');
              card.append(art,title,sub);
              card.onclick = () => { const s = String(item.slug || item.id || '').trim(); if (!s) return; if (item.type === 'channel') go('channel',{slug:s}); else go('video',{slug:s}); };
              rail.appendChild(card);
            });
            section.appendChild(rail);
            c.appendChild(section);
          }
        }
      } catch (_) {}

      // Seasonal recommendations (client-side from loaded lists)
      const seasonBox = el('section', { class: 'home-shelf' });
      c.appendChild(seasonBox);
      (async function(){
        try {
          let vids = state._videosCache || state.videos || [];
          let chans = state.channels || [];
          if (!vids.length) {
            try {
              const vr = await api('GET', '/api/native_videos.php', { query: { action: 'list', limit: '40' } });
              vids = (vr && (vr.videos || vr.data)) || [];
              state._videosCache = vids;
            } catch (e) {}
          }
          if (!chans.length) {
            try {
              const cr = await api('GET', '/api/native_home.php', { query: { type: 'channels', limit: '40' } });
              chans = (cr && (cr.channels || cr.data)) || [];
            } catch (e) {}
          }
          const packV = pickSeasonal(vids, 8);
          const packC = pickSeasonal(chans, 6);
          const info = packV.info;
          seasonBox.innerHTML = '';
          const head = el('div', { class: 'shelf-head' });
          head.innerHTML = '<b></b><span></span>';
          head.querySelector('b').textContent = info.hint;
          head.querySelector('span').textContent = info.title + ' · подборка';
          seasonBox.appendChild(head);
          const rail = el('div', { class: 'shelf-rail' });
          packV.items.forEach(function(item){
            const card = el('button', { type: 'button', class: 'shelf-card' });
            const art = el('div', { class: 'shelf-art' });
            const th = item.thumbnail_url || item.logo_url || '';
            if (th) {
              const img = el('img', { src: absUrl(th), alt: '', loading: 'lazy' });
              img.onerror = function(){ img.remove(); art.textContent = '▶'; };
              art.appendChild(img);
            } else art.textContent = '▶';
            card.append(art, el('b', null, item.title || 'Видео'), el('small', null, item.channel_title || info.title));
            card.onclick = function(){ const s = String(item.slug || item.id || '').trim(); if (!s) return; go('video', { slug: s }); };
            rail.appendChild(card);
          });
          packC.items.forEach(function(ch){
            const card = el('button', { type: 'button', class: 'shelf-card' });
            const art = el('div', { class: 'shelf-art' });
            const src = (typeof channelThumbSrc === 'function') ? channelThumbSrc(ch) : (ch.logo_url || '');
            if (src) {
              const img = el('img', { src: src, alt: '', loading: 'lazy' });
              art.appendChild(img);
            } else art.textContent = '📺';
            card.append(art, el('b', null, ch.title || ch.name || 'Канал'), el('small', null, 'Канал · ' + info.title));
            card.onclick = function(){ const s = String(ch.slug || ch.id || '').trim(); if (!s) { toast('Нет slug'); return; } go('channel', { slug: s }); };
            rail.appendChild(card);
          });
          if (rail.children.length) seasonBox.appendChild(rail);
          else seasonBox.remove();
        } catch (e) { try { seasonBox.remove(); } catch (e2) {} }
      })();

      // Popular shelf uses the existing video API once; it does not run repeated polling.
      const popularShelf = el('section', { class:'home-shelf' });
      popularShelf.innerHTML = '<div class="shelf-head"><b>Популярное</b><span>Видео StreamLive</span></div>';
      const popularRail = el('div', { class:'shelf-rail' });
      popularRail.innerHTML = '<div class="shelf-loading">Загружаем подборку…</div>';
      popularShelf.appendChild(popularRail);
      c.appendChild(popularShelf);
      api('GET','/api/native_videos.php',{query:{action:'list',limit:'8'}}).then(r => {
        const items = (r && r.videos) || [];
        popularRail.innerHTML = '';
        if (!items.length) {
          popularShelf.remove();
          return;
        }
        items.slice(0,8).forEach(item => {
          const card = el('button',{type:'button',class:'shelf-card'});
          const art = el('div',{class:'shelf-art'});
          if (item.thumbnail_url) {
            const img=el('img',{src:absUrl(item.thumbnail_url),alt:''});
            img.onerror=()=>{img.remove();art.textContent='🎬';};
            art.appendChild(img);
          } else art.textContent='🎬';
          card.append(art,el('b',null,item.title||'Видео'),el('small',null,item.channel_title||'StreamLive'));
          card.onclick=()=>{ const s=String(item.slug||item.id||'').trim(); if(!s)return; go('video',{slug:s}); };
          popularRail.appendChild(card);
        });
      }).catch(() => popularShelf.remove());

      const chips = el('div', { class: 'chip-row' });
      [['all', 'Все'], ['tv', 'ТВ'], ['radio', 'Радио']].forEach(([k, l]) => {
        const b = el('button', { class: 'chip' + (state.filter === k ? ' on' : ''), type: 'button' }, l);
        b.onclick = () => { state.filter = k; go('home'); };
        chips.appendChild(b);
      });
      const refreshRow = el('button', { type: 'button', class: 'ghost', style: 'margin:0 0 10px;font-size:13px' }, '↻ Обновить список (сброс кэша каналов)');
      refreshRow.onclick = function(){
        try { Object.keys(localStorage).forEach(function(k){ if(k.indexOf('sl_data_v1:')===0 && k.indexOf('channels')>=0) localStorage.removeItem(k); }); } catch(e){}
        state.channels = []; go('home');
      };
      c.appendChild(refreshRow);
      c.appendChild(chips);
      const box = el('div', { class: 'loading' }, 'Загрузка…');
      c.appendChild(box);
      const cachedChannels = readDataCache('channels:' + state.filter);
      if (cachedChannels && cachedChannels.length) {
        state.channels = cachedChannels;
        renderChannelCards(box, cachedChannels);
        box.insertAdjacentHTML('afterbegin', '<div class="hint" style="grid-column:1/-1">Показаны сохранённые данные · обновляем…</div>');
      }
      try {
        const q = { type: 'channels', limit: '60' };
        if (state.filter === 'tv' || state.filter === 'radio') q.type_filter = state.filter;
        let r;
        try {
          r = await api('GET', '/api/native_home.php', { query: q });
        } catch (_) {
          r = await api('GET', '/api.php', { query: { type: 'channels', limit: '60' } });
        }
        const list = (r && (r.channels || r.data)) || [];
        state.channels = list;
        writeDataCache('channels:' + state.filter, list);
        renderChannelCards(box, list);
      } catch (e) {
        box.className = 'empty';
        box.innerHTML = '<b>Нет ответа от сервера</b>' + (e.message || 'Проверь интернет') + '<br><br><button type="button" class="btn" id="retryCh">Повторить</button><br><button type="button" class="btn ghost" id="chgMirror" style="margin-top:8px">Сменить зеркало</button>'; setTimeout(function(){ var r=document.getElementById('retryCh'); if(r)r.onclick=function(){go('home')}; var m=document.getElementById('chgMirror'); if(m)m.onclick=function(){go('settings')}; },0);
      }
    }, {
      fab: []
    });
  }

  function tabVideos(root) {
    shell(root, 'Видео', async (c) => {
      const box = el('div', { class: 'loading' }, 'Загрузка…');
      c.appendChild(box);
      try {
        const r = await api('GET', '/api/native_videos.php', { query: { action: 'list', limit: '40' } });
        const list = (r && r.videos) || [];
        state.videos = list;
        box.className = 'list';
        box.innerHTML = '';
        if (!list.length) {
          box.className = 'empty';
          box.innerHTML = '<b>Нет видео</b>Когда появятся — будут здесь';
          return;
        }
        list.forEach(v => {
          const row = el('div', { class: 'row' });
          const av = el('div', { class: 'av' });
          const thumb = v.thumbnail_url || v.cover || '';
          if (thumb) {
            const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' });
            img.src = absUrl(thumb);
            img.onerror = () => { av.textContent = '🎬'; };
            av.appendChild(img);
          } else av.textContent = '🎬';
          const tx = el('div', { class: 'tx' });
          tx.innerHTML = '<b></b><small></small>';
          tx.querySelector('b').textContent = v.title || 'Видео';
          tx.querySelector('small').textContent = (v.channel_title || '') + (v.views_count ? ' · ' + v.views_count + ' просм.' : '');
          row.append(av, tx);
          row.onclick = () => { const s = String(v.slug || v.id || '').trim(); if (!s) { toast('Нет slug видео'); return; } go('video', { slug: s }); };
          bindMediaPreview(row, {
            image: thumb,
            stream: v.play_url || v.stream_url || v.url || '',
            title: v.title || 'Видео'
          });
          box.appendChild(row);
        });
      } catch (e) {
        box.className = 'empty';
        box.innerHTML = '<b>Ошибка</b>' + (e.message || '');
      }
    });
  }

  function renderForumCategories(box, cats) {
    box.className = 'list';
    box.innerHTML = '';
    (cats || []).forEach(cat => {
      const row = el('div', { class: 'row' });
      row.innerHTML = '<div class="av">📁</div><div class="tx"><b></b><small></small></div>';
      row.querySelector('b').textContent = cat.title || cat.name;
      const cnt = cat.thread_count || cat.threads_count || 0;
      row.querySelector('small').textContent = cat.description || (cnt + ' тем');
      row.onclick = () => go('forumCat', { id: cat.id, title: cat.title || cat.name });
      box.appendChild(row);
    });
  }

  function tabForum(root) {
    shell(root, 'Форум', async (c) => {
      const box = el('div', { class: 'loading' }, 'Загрузка…');
      c.appendChild(box);
      const cachedCats = readDataCache('forum:categories');
      if (cachedCats && cachedCats.length) {
        state.forumCats = cachedCats;
        renderForumCategories(box, cachedCats);
        box.insertAdjacentHTML('afterbegin', '<div class="hint">Сохранённые разделы · обновляем…</div>');
      }
      try {
        let cats = [];
        try {
          const r = await api('GET', '/api/native_forum.php', { query: { action: 'categories' } });
          if (r && r.ok && (r.categories || r.sections)) cats = r.categories || r.sections;
        } catch (_) {}
        if (!cats.length) {
          try {
            const r = await api('GET', '/api_forum.php');
            if (r && r.ok && r.categories) cats = r.categories;
          } catch (_) {}
        }
        if (!cats.length) {
          // last resort: show recent threads
          try {
            const r = await api('GET', '/api/native_forum.php', { query: { action: 'threads', limit: '30' } });
            if (r && r.threads && r.threads.length) {
              box.className = 'list';
              box.innerHTML = '';
              r.threads.forEach(th => {
                const row = el('div', { class: 'row' });
                row.innerHTML = '<div class="av">🧵</div><div class="tx"><b></b><small></small></div>';
                row.querySelector('b').textContent = th.title || 'Тема';
                row.querySelector('small').textContent = th.username || th.author || '';
                row.onclick = () => go('thread', { id: th.id, title: th.title });
                box.appendChild(row);
              });
              return;
            }
          } catch (_) {}
          box.className = 'empty';
          box.innerHTML = '<b>Форум пуст</b>Разделы появятся после настройки на сервере';
          return;
        }
        state.forumCats = cats;
        writeDataCache('forum:categories', cats);
        renderForumCategories(box, cats);
      } catch (e) {
        box.className = 'empty';
        box.innerHTML = '<b>Ошибка форума</b>' + (e.message || '') + '<br><small>Проверь /api/native_forum.php</small>';
      }
    });
  }

  function renderConversationList(box, list) {
    box.className = list && list.length ? 'list' : 'empty';
    box.innerHTML = '';
    if (!list || !list.length) {
      box.innerHTML = '<b>Нет диалогов</b>Сообщения с сайта появятся здесь';
      return;
    }
    list.forEach(cv => {
      const row = el('div', { class: 'row' });
      const unread = cv.unread ? ' · ' + cv.unread + ' новых' : '';
      row.innerHTML = '<div class="av">💬</div><div class="tx"><b></b><small></small></div>';
      row.querySelector('b').textContent = cv.title || cv.username || 'Диалог';
      row.querySelector('small').textContent = (cv.last_message || cv.preview || '') + unread;
      row.onclick = () => go('dm', { id: cv.id, title: cv.title || cv.username });
      box.appendChild(row);
    });
  }

  function tabChat(root) {
    shell(root, 'Чат', async (c) => {
      const box = el('div', { class: 'loading' }, 'Загрузка…');
      c.appendChild(box);
      const cachedConversations = readDataCache('chat:conversations');
      if (cachedConversations && cachedConversations.length) {
        renderConversationList(box, cachedConversations);
        box.insertAdjacentHTML('afterbegin', '<div class="hint">Сохранённые диалоги · обновляем…</div>');
      }
      try {
        const r = await api('GET', '/api/native_messenger.php', { query: { action: 'conversations' } });
        if (r && r.ok === false) throw new Error(r.error || 'Нужно войти');
        const list = (r && (r.conversations || r.data)) || [];
        writeDataCache('chat:conversations', list);
        renderConversationList(box, list);
      } catch (e) {
        box.className = 'empty';
        box.innerHTML = '<b>Чат</b>' + (e.message || 'Ошибка') + '<br><small>Нужен вход и /api/native_messenger.php</small>';
      }
    });
  }

  function tabGames(root) {
    shell(root, 'Игры', (c) => {
      const eco = ecoEnsureDay();
      const ecoBar = el('div', { class: 'glass-panel', style: 'padding:12px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px' });
      ecoBar.innerHTML = '<div><b>✦ ' + eco.sparks + ' искр</b><small style="display:block;opacity:.7">Валюта StreamLive</small></div>';
      const wbtn = el('button', { type: 'button', class: 'btn', style: 'margin:0;padding:10px 14px' }, 'Колесо');
      wbtn.onclick = function(){ showWheelModal(true); };
      ecoBar.appendChild(wbtn);
      c.appendChild(ecoBar);

      // Платные игры (искры сгорают)
      const paidBox = el('div', { class: 'glass-panel', style: 'padding:12px;margin-bottom:12px' });
      paidBox.innerHTML = '<b>Платные игры</b><small style="display:block;opacity:.7;margin:4px 0 8px">Искры списываются и сгорают</small>';
      const paidList = el('div', { class: 'list' });
      paidBox.appendChild(paidList);
      c.appendChild(paidBox);
      (async function(){
        try {
          const r = await api('GET', '/api/native_games.php', { query: { action: 'list' }, failover: false });
          const games = (r && r.games) || [];
          if (!games.length) {
            paidList.innerHTML = '<div class="hint">Пока нет одобренных игр</div>';
          } else {
            games.forEach(function(g) {
              if (g.status && g.status !== 'approved') return;
              const row = el('div', { class: 'row' });
              row.innerHTML = '<div class="tx"><b></b><small></small></div>';
              row.querySelector('b').textContent = g.title || 'Игра';
              row.querySelector('small').textContent = '✦ ' + (g.price_sparks || 0) + (g.username ? (' · ' + g.username) : '');
              row.onclick = function() {
                const price = parseInt(g.price_sparks, 10) || 0;
                const eco = ecoEnsureDay();
                if (eco.sparks < price) { toast('Недостаточно искр'); return; }
                if (!confirm('Купить «' + (g.title||'') + '» за ✦' + price + '? Искры сгорят.')) return;
                ecoAddSparks(-price, 'buy_game');
                toast('Куплено · искры списаны');
                if (g.url) window.open(g.url, '_blank', 'noopener');
              };
              paidList.appendChild(row);
            });
          }
        } catch (e) {
          paidList.innerHTML = '<div class="hint">Платные игры пока недоступны</div>';
        }
      })();
      const subGame = el('button', { type: 'button', class: 'row' });
      subGame.innerHTML = '<div class="tx"><b>Добавить платную игру</b><small>ссылка на игру, не на сайт</small></div>';
      subGame.onclick = async function() {
        if (!state.user || !state.user.id) {
          toast('Сначала войди: Профиль → Войти');
          go('auth');
          return;
        }
        const title = prompt('Название игры');
        if (!title) return;
        const url = prompt('Ссылка на ИГРУ (itch.io / play / html5…), не главная сайта');
        if (!url) return;
        const price = parseInt(prompt('Цена в искрах', '50') || '50', 10) || 50;
        if (!/^https?:\/\//i.test(url)) { toast('Нужен http(s) URL'); return; }
        var ul = url.toLowerCase();
        var looks = /itch\.io|crazygames|poki|gamejolt|newgrounds|github\.io|\/play|\/game|html5|unity|phaser|wasm|arcade/.test(ul);
        var pathOnly = false;
        try { var uo = new URL(url); pathOnly = (uo.pathname === '/' || uo.pathname === ''); } catch(e) {}
        if (pathOnly && !looks) { toast('Это похоже на сайт, а не на игру'); return; }
        var payload = {
          action: 'submit',
          title: title,
          url: url,
          price_sparks: price,
          user_id: state.user.id,
          username: state.user.username || '',
          api_key: state.apiKey || ''
        };
        try {
          var r = null;
          try {
            r = await softFetchJson(
              ['/webapp/sl_games.php', '/webapp/api/native_games.php', '/api/native_games.php'],
              'POST', payload
            );
          } catch (e1) {
            // iframe form fallback
            r = await authViaIframe('submit', payload).catch(function(){ return null; });
          }
          // if authViaIframe wrong endpoint — direct form to games
          if (!r || r.ok === false) {
            r = await new Promise(function(resolve, reject) {
              var iframe = document.createElement('iframe');
              iframe.name = 'sl_game_' + Date.now();
              iframe.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;opacity:0';
              var form = document.createElement('form');
              form.method = 'POST';
              form.action = (state.base || location.origin) + '/webapp/sl_games.php';
              form.target = iframe.name;
              form.style.display = 'none';
              Object.keys(payload).forEach(function(k) {
                var inp = document.createElement('input');
                inp.type = 'hidden'; inp.name = k; inp.value = String(payload[k]);
                form.appendChild(inp);
              });
              document.body.appendChild(iframe);
              document.body.appendChild(form);
              var t = setTimeout(function() {
                try {
                  var tx = (iframe.contentDocument && iframe.contentDocument.body && iframe.contentDocument.body.innerText) || '';
                  var m = tx.match(/\{[\s\S]*\}/);
                  if (m) resolve(JSON.parse(m[0]));
                  else reject(new Error('Нет ответа'));
                } catch (e) { reject(e); }
                try { iframe.remove(); form.remove(); } catch (e2) {}
              }, 5000);
              form.submit();
            }).catch(function(e){ return { ok: false, error: e.message }; });
          }
          if (r && r.ok) {
            toast('Игра добавлена');
            go('home');
            state.tab = 4;
            setTimeout(function(){ go('home'); }, 50);
          } else {
            toast((r && r.error) || 'Не удалось добавить игру');
          }
        } catch (e) { toast(e.message || 'Ошибка'); }
      };
      c.appendChild(subGame);

      const games = (window.SLGames && SLGames.list) || [];
      const fallback = [
        {id:'2048',t:'2048',s:'Сложи плитки до 2048',i:'🔢',c:'#FF5722'},
        {id:'ttt',t:'Крестики-нолики',s:'Классика 3×3',i:'✖️',c:'#009688'},
        {id:'guess',t:'Угадай число',s:'От 1 до 100',i:'🎲',c:'#3F51B5'},
        {id:'snake',t:'Змейка',s:'Собирай еду',i:'🐍',c:'#4CAF50'},
        {id:'mines',t:'Сапёр',s:'Разминирование',i:'🚩',c:'#607D8B'},
        {id:'memory',t:'Память',s:'Найди пары',i:'🃏',c:'#9C27B0'},
        {id:'react',t:'Реакция',s:'Нажми быстрее',i:'⚡',c:'#FF8F00'},
        {id:'pong',t:'Понг',s:'Отражай мяч',i:'🏓',c:'#0097A7'},
        {id:'hang',t:'Виселица',s:'Угадай слово',i:'🔤',c:'#795548'},
        {id:'24',t:'Калькулятор 24',s:'Собери 24',i:'🧮',c:'#C2185B'},
        {id:'flappy',t:'Flappy',s:'Тапай и лети',i:'🐤',c:'#FFD54F'},
        {id:'breakout',t:'Аркада',s:'Разбей блоки',i:'🧱',c:'#E91E63'},
        {id:'flowgta',t:'Flow GTA',s:'Vice Roulette 3D',i:'🚗',c:'#9C27B0'},
        {id:'clicker',t:'Кликер',s:'Тапай за очки',i:'👆',c:'#00BCD4'},
        {id:'dice',t:'Кости',s:'Два кубика',i:'🎲',c:'#8BC34A'},
        {id:'rps',t:'КНБ',s:'Камень-ножницы-бумага',i:'✊',c:'#FF5722'}
      ];
      const list = games.length ? games : fallback;
      const box = el('div', { class: 'glist' });
      list.forEach(g => {
        const row = el('button', { type: 'button', class: 'gitem', style: 'width:100%;text-align:left;cursor:pointer' });
        row.innerHTML = '<span class="gic" style="background:' + (g.c || '#333') + '">' + (g.i || '🎮') + '</span>' +
          '<span class="gtx"><b></b><small></small></span><span class="gch">Играть ›</span>';
        row.querySelector('b').textContent = g.t || g.title || g.id;
        row.querySelector('small').textContent = g.s || g.subtitle || 'Офлайн';
        row.onclick = function () {
          go('game', { id: g.id, title: g.t || g.title || g.id });
        };
        box.appendChild(row);
      });
      c.appendChild(box);
      c.appendChild(el('p', { class: 'auth-hint' }, 'Игры офлайн · без расхода хитов'));
    });
  }

  function tabProfile(root) {
    shell(root, 'Профиль', (c) => {
      const u = state.user || {};
      const head = el('div', { class: 'profile-hero' });
      const av = el('div', { class: 'profile-avatar' }, (u.username || 'G').toString().charAt(0).toUpperCase());
      head.appendChild(av);
      head.appendChild(el('h2', null, u.username || 'Гость'));
      head.appendChild(el('p', { class: 'profile-mail' }, u.email || ('v' + state.version + ' · build ' + state.build)));
      const eco = ecoEnsureDay();
      head.appendChild(el('p', { class: 'profile-mail', style: 'color:#FBBF24' }, '✦ Искры: ' + eco.sparks + ' · круток сегодня: ' + eco.freeLeft));

      c.appendChild(head);

      const menu = el('div', { class: 'profile-menu' });
      function addRow(icon, label, sub, fn, danger) {
        const b = el('button', { type: 'button', class: 'profile-row' + (danger ? ' danger' : '') });
        b.innerHTML = '<span class="pr-ic">' + icon + '</span><span class="pr-tx"><b></b><small></small></span><span class="pr-chev">›</span>';
        b.querySelector('b').textContent = label;
        b.querySelector('small').textContent = sub || '';
        b.onclick = fn;
        menu.appendChild(b);
      }
      if (!state.user) {
        addRow('👤', 'Войти / Регистрация', 'Общий аккаунт с сайтом', () => go('auth'));
      } else {
        addRow('👤', 'Аккаунт', u.username || '', () => toast(u.email || u.username || ''));
      }
      addRow('⚙️', 'Настройки', 'Тема, плеер, кэш', () => go('settings'));
      addRow('🔔', 'Уведомления', getSetting('notify', true) ? 'Включены' : 'Выключены', () => {
        setSetting('notify', !getSetting('notify', true));
        go('home'); state.tab = 5; go('home');
      });
      addRow('🎮', 'Игры', 'Офлайн', () => { state.tab = 4; go('home'); });
      addRow('📡', 'Зеркало / API', state.base || '', () => go('settings'));
      addRow('➕', 'На экран «Домой»', 'Ярлык PWA', () => go('install'));
      addRow('🌐', 'Открыть сайт', 'Каталог', () => { window.open((state.base || '') + '/catalog', '_blank'); });
      if (state.user) {
        addRow('🚪', 'Выйти', 'Сбросить сессию', async () => {
          try { await auth('logout'); } catch (_) {}
          saveUser(null);
          go('auth');
        }, true);
      }
      c.appendChild(menu);

      const ver = el('p', { class: 'profile-ver' }, 'StreamLive ' + state.version + ' · build ' + state.build);
      ver.onclick = function() {
        state.devTap = (state.devTap || 0) + 1;
        if (state.devTap >= 3 && state.devTap < 7) toast('Ещё ' + (7 - state.devTap) + ' для dev');
        if (state.devTap >= 7) {
          setSetting('dev_mode', true);
          toast('Режим разработчика');
          state.devTap = 0;
          go('settings');
        }
      };
      c.appendChild(ver);
    });
  }

  function screenChannel(root) {
    const slug = String((state.route.params && (state.route.params.slug || state.route.params.id)) || '').trim();
    shell(root, 'Канал', async (c) => {
      const box = el('div', { class: 'loading' }, 'Загрузка…');
      c.appendChild(box);
      try {
        if (!slug) throw new Error('Нет slug канала');
        const r = await api('GET', '/api/native_channel.php', { query: { slug } });
        if (!r || !r.ok) throw new Error((r && r.error) || 'Канал недоступен');
        const ch = r.channel || {};
        const src = r.source;
        box.className = '';
        box.innerHTML = '';
        if (getSetting('watch_history', true)) {
          try {
            const key = 'sl_watch_history_v1';
            const old = JSON.parse(localStorage.getItem(key) || '[]');
            const entry = { type: 'channel', slug: ch.slug || slug, title: ch.title || slug, thumbnail_url: ch.logo_url || '', channel_title: 'Канал', watched_at: Date.now() };
            const next = [entry].concat(old.filter(x => !(x && x.slug === entry.slug && (x.type||'video') === 'channel'))).slice(0, 40);
            localStorage.setItem(key, JSON.stringify(next));
          } catch (e) {}
        }
        const title = el('h2', { style: 'margin:0 0 8px;font-size:20px' }, ch.title || slug);
        box.appendChild(title);
        if (ch.description) box.appendChild(el('p', { style: 'color:var(--muted);font-size:13px;margin:0 0 12px' }, ch.description));

        const player = el('div', { class: 'player-box' });
        const srcUrl = src && src.url ? String(src.url) : '';
        const srcType = src && src.type ? String(src.type).toLowerCase() : '';
        const playerMode = getSetting('player', 'auto');
        const channelEmbed = r.embed_url || r.player_url || '';
        function mountChannelEmbed(url) {
          const ifr = el('iframe', { src: absUrl(url), allowfullscreen: 'true', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen' });
          ifr.setAttribute('allowfullscreen', '');
          ifr.style.width = '100%'; ifr.style.height = '100%';
          player.appendChild(ifr);
        }
        if (playerMode === 'iframe' && channelEmbed) {
          mountChannelEmbed(channelEmbed);
        } else if (srcUrl) {
          const v = el('video', { controls: 'true', playsinline: 'true', webkitplaysinline: 'true' });
          v.setAttribute('playsinline', '');
          v.setAttribute('controls', '');
          v.style.width = '100%'; v.style.height = '100%';
          player.appendChild(v);
          playMedia(v, srcUrl, srcType === 'hls' || srcType === 'm3u8');
          if (playerMode === 'iframe' && !channelEmbed) {
            toast('У канала нет embed-плеера — включён прямой поток');
          }
        } else if (channelEmbed) {
          mountChannelEmbed(channelEmbed);
        } else {
          player.innerHTML = '<div style="display:grid;place-items:center;height:100%;color:#888;padding:16px;text-align:center">Нет прямого потока<br><small>Открой канал на сайте</small></div>';
        }
        const engineLabel = ({ auto: 'Авто', hlsjs: 'HLS.js', shaka: 'Shaka', videojs: 'Video.js', artplayer: 'ArtPlayer', clappr: 'Clappr', dashjs: 'dash.js', fluid: 'Fluid', openplayer: 'OpenPlayer', plyr: 'Plyr', mediaelement: 'MEJS', dplayer: 'DPlayer', jwplayer: 'JW', pegasus: 'Pegasus', vidstack: 'Vidstack', xgplayer: 'XG', ckplayer: 'CK', tcplayer: 'TC', flowplayer: 'Flow', afterglow: 'Afterglow', lightgallery: 'Light', cdnplayer: 'CDN', liveplayer: 'Live', native: 'Native', iframe: 'Embed' })[playerMode] || 'Авто';
        const engineBadge = el('div', { style: 'position:absolute;right:12px;top:12px;z-index:3;padding:5px 9px;border-radius:20px;background:rgba(5,12,30,.78);color:#dbeafe;font:11px system-ui;pointer-events:none' }, engineLabel);
        player.appendChild(engineBadge);
        box.appendChild(player);
        const chActions = el('div', { class: 'player-actions' });
        chActions.appendChild(el('a', { class: 'ghost', href: absUrl('/channel?slug=' + encodeURIComponent(ch.slug || slug)), target: '_blank', rel: 'noopener' }, 'На сайте'));
        box.appendChild(chActions);

        // chat
        const chat = el('div', { class: 'chat-box' });
        const msgs = el('div', { class: 'chat-msgs' }, '<div class="m" style="color:var(--muted)">Чат канала…</div>');
        const inpRow = el('div', { class: 'chat-in' });
        const inp = el('input', { type: 'text', placeholder: 'Сообщение…', maxlength: '500' });
        const send = el('button', { type: 'button' }, '→');
        inpRow.append(inp, send);
        chat.append(msgs, inpRow);
        box.appendChild(chat);

        let after = 0;
        let chatBooted = false;
        const channelId = ch.id || ch.channel_id || 0;
        async function poll() {
          if (!channelId) {
            msgs.innerHTML = '<div class="m" style="color:var(--muted)">Нет id канала — чат недоступен</div>';
            return;
          }
          try {
            const pr = await softFetchJson(
              ['/webapp/sl_comments.php', '/webapp/api/native_comments.php', '/api/native_comments.php'],
              'GET',
              {
                channel_id: String(channelId),
                after: String(after),
                user_id: state.user && state.user.id,
                username: state.user && state.user.username,
                api_key: state.apiKey || ''
              }
            );
            if (!pr || pr.ok === false) {
              if (!chatBooted) {
                msgs.innerHTML = '<div class="m" style="color:#f88">' + ((pr && pr.error) || 'Чат временно недоступен') + '</div>';
              }
              return;
            }
            const list = (pr.comments || pr.messages || pr.data || []);
            if (!chatBooted) {
              msgs.innerHTML = '';
              chatBooted = true;
              if (!list.length) {
                msgs.innerHTML = '<div class="m" style="color:var(--muted)">Пока нет сообщений — напиши первым</div>';
              }
            }
            if (list.length) {
              // remove empty placeholder
              const ph = msgs.querySelector('.m[style]');
              if (ph && /Пока нет|Чат канала|недоступен/.test(ph.textContent || '')) ph.remove();
              if (pr.me_banned) {
                msgs.innerHTML = '<div class="m" style="color:var(--muted)">Вас заблокировали в этом канале. Сообщения недоступны.</div>';
                if (inpRow) inpRow.style.display = 'none';
                return;
              }
              window.__slCanMod = !!pr.can_moderate;
              list.forEach(m => {
                const id = m.id || 0;
                if (id > after) after = id;
                const line = el('div', { class: 'm' });
                const role = (m.role || '').toLowerCase();
                const isMod = m.is_mod || role === 'moderator' || role === 'admin';
                const name = m.username || m.user || 'anon';
                const text = m.message || m.text || m.body || '';
                const uid = m.userId || m.user_id || 0;
                line.innerHTML = '<b></b> <span></span>';
                const bEl = line.querySelector('b');
                bEl.textContent = name;
                if (isMod) {
                  const badge = document.createElement('span');
                  badge.className = 'mod-badge';
                  badge.textContent = 'MOD';
                  bEl.appendChild(document.createTextNode(' '));
                  bEl.appendChild(badge);
                } else if (m.is_verified) {
                  bEl.appendChild(document.createTextNode(' ✓'));
                }
                line.querySelector('span').textContent = text;
                if (window.__slCanMod && uid && !(state.user && String(state.user.id) === String(uid))) {
                  const banBtn = el('button', { type: 'button', class: 'mod-btn', title: 'Заблокировать' }, '🚫');
                  banBtn.onclick = async function(ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (!confirm('Заблокировать «' + name + '» в этом канале? Его сообщения сгорят.')) return;
                    try {
                      const br = await softFetchJson(
                        ['/webapp/sl_comments.php', '/webapp/api/native_comments.php', '/api/native_comments.php'],
                        'POST',
                        {
                          action: 'ban',
                          channel_id: channelId,
                          user_id: uid,
                          comment_id: id,
                          user_id_mod: state.user && state.user.id,
                          username: state.user && state.user.username,
                          api_key: state.apiKey || ''
                        }
                      );
                      if (br && br.ok === false) throw new Error(br.error || 'Ошибка');
                      // убрать все сообщения этого юзера из UI
                      Array.from(msgs.querySelectorAll('.m')).forEach(function(node) {
                        var bn = node.querySelector('b');
                        if (bn && bn.childNodes[0] && bn.childNodes[0].textContent === name) node.remove();
                      });
                      toast('Заблокирован · сообщения удалены');
                    } catch (e) { toast(e.message || 'Не удалось'); }
                  };
                  line.appendChild(banBtn);
                }
                msgs.appendChild(line);
              });
              msgs.scrollTop = msgs.scrollHeight;
            }
          } catch (e) {
            if (!chatBooted) {
              msgs.innerHTML = '<div class="m" style="color:#f88">' + (e.message || 'Ошибка чата') + '</div>';
            }
          }
        }
        poll();
        // пока на канале — чаще (1–2 мин), настройка «экономия» не ниже 1 мин
        var chMin = parseInt(getSetting('chat_poll_min', 30), 10) || 30;
        var pollMs = Math.min(Math.max(1, chMin), 30) * 60 * 1000;
        // first minutes: every 45s so chat feels alive without hammering
        var timer = setInterval(function(){ if (!document.hidden) poll(); }, 45000);
        // after 3 min switch to user setting
        setTimeout(function(){
          clearInterval(timer);
          timer = setInterval(function(){ if (!document.hidden) poll(); }, pollMs);
          root._chatTimer = timer;
        }, 180000);
        root._chatTimer = timer;
        // clear on next render roughly
        root._chatTimer = timer;
        // Лёгкая проверка смены потока раз в 3 мин (1 запрос) — без reload страницы
        (function softSourceWatch(){
          var lastFp = (src && src.url) ? String(src.url) : '';
          var t = setInterval(async function(){
            if (document.hidden) return;
            try {
              const rr = await api('GET', '/api/native_channel.php', { query: { slug: ch.slug || slug }, failover: false });
              const nu = rr && rr.source && rr.source.url ? String(rr.source.url) : '';
              if (nu && lastFp && nu !== lastFp) {
                lastFp = nu;
                toast('Поток обновился');
                // remount player without full page reload
                try {
                  player.innerHTML = '';
                  const vv = el('video', { controls: 'true', playsinline: 'true' });
                  vv.style.width = '100%'; vv.style.height = '100%';
                  player.appendChild(vv);
                  playMedia(vv, nu, /\.m3u8/i.test(nu));
                } catch (e) {}
              } else if (nu) lastFp = nu;
            } catch (e) {}
          }, 3 * 60 * 1000);
          root._srcTimer = t;
        })();

        send.onclick = async () => {
          const text = (inp.value || '').trim();
          if (!text) return;
          try {
            if (!channelId) { toast('Нет id канала'); return; }
            const sr = await softFetchJson(
              ['/webapp/sl_comments.php', '/webapp/api/native_comments.php', '/api/native_comments.php'],
              'POST',
              {
                action: 'send',
                channel_id: channelId,
                message: text,
                user_id: state.user && state.user.id,
                username: state.user && state.user.username,
                api_key: state.apiKey || ''
              }
            );
            if (sr && sr.ok === false) throw new Error(sr.error || 'Не отправилось');
            inp.value = '';
            // optimistic line
            const line = el('div', { class: 'm' });
            line.innerHTML = '<b></b> <span></span>';
            line.querySelector('b').textContent = (state.user && state.user.username) || 'я';
            line.querySelector('span').textContent = text;
            if (chatBooted && msgs.querySelector('.m[style]')) msgs.innerHTML = '';
            msgs.appendChild(line);
            msgs.scrollTop = msgs.scrollHeight;
            poll();
          } catch (e) {
            toast(e.message || 'Не отправилось');
          }
        };
      } catch (e) {
        box.className = 'empty';
        box.innerHTML = '<b>Ошибка</b>' + (e.message || '');
      }
    }, { back: () => { if (root._chatTimer) clearInterval(root._chatTimer); if (root._srcTimer) clearInterval(root._srcTimer); state.tab = 0; go('home'); } });
  }

  function screenVideo(root) {
    const slug = String((state.route.params && (state.route.params.slug || state.route.params.id)) || '').trim();
    shell(root, 'Видео', async (c) => {
      const box = el('div', { class: 'loading' }, 'Загрузка…');
      c.appendChild(box);
      try {
        if (!slug) throw new Error('Нет slug видео');
        const r = await api('GET', '/api/native_videos.php', { query: { action: 'detail', slug } });
        if (!r || !r.ok) throw new Error((r && r.error) || 'Нет видео');
        const v = r.video || r;
        const comments = r.comments || [];
        if (getSetting('watch_history', true)) {
          try {
            const key = 'sl_watch_history_v1';
            const old = JSON.parse(localStorage.getItem(key) || '[]');
            const entry = { slug: v.slug || slug, title: v.title || 'Видео', thumbnail_url: v.thumbnail_url || '', channel_title: v.channel_title || '', watched_at: Date.now() };
            const next = [entry].concat(old.filter(x => x && x.slug !== entry.slug)).slice(0, 30);
            localStorage.setItem(key, JSON.stringify(next));
          } catch (_) {}
        }
        box.className = 'safe-bottom';
        box.innerHTML = '';

        const player = el('div', { class: 'player-box' });
        const playUrl = (v.play_url || v.stream_url || v.url || '').toString();
        const embedUrl = (v.embed_url || v.player_url || '').toString();
        const watchUrl = (v.watch_url || ('/video.php?slug=' + encodeURIComponent(v.slug || slug))).toString();
        const platform = (v.platform || '').toString().toLowerCase();

        function mountDirect(url) {
          const isHls = /\.m3u8($|\?)/i.test(url) || platform === 'm3u8' || platform === 'hls';
          const isMp4 = /\.mp4($|\?)/i.test(url) || platform === 'mp4';
          if (isMp4 || (!isHls && url)) {
            const vid = el('video', { controls: 'true', playsinline: 'true', webkitplaysinline: 'true' });
            vid.setAttribute('playsinline', '');
            vid.setAttribute('controls', '');
            vid.style.width = '100%';
            vid.style.height = '100%';
            player.appendChild(vid);
            playMedia(vid, url, isHls);
            return true;
          }
          if (isHls) {
            const vid = el('video', { controls: 'true', playsinline: 'true' });
            vid.setAttribute('playsinline', '');
            vid.style.width = '100%';
            vid.style.height = '100%';
            player.appendChild(vid);
            // native HLS (Safari) or progressive fallback
            playMedia(vid, url, isHls);
            return true;
          }
          return false;
        }

        function mountEmbed(url) {
          const ifr = el('iframe', {
            src: absUrl(url),
            allowfullscreen: 'true',
            allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen'
          });
          ifr.setAttribute('allowfullscreen', '');
          ifr.style.width = '100%';
          ifr.style.height = '100%';
          player.appendChild(ifr);
        }

        const selectedPlayer = getSetting('player', 'auto');
        const videoSlug = String(v.slug || slug || '').trim();
        // Единственный правильный URL embed на сайте StreamLive
        const embedVideoUrl = '/embed_video.php?slug=' + encodeURIComponent(videoSlug);

        function mountSiteEmbed() {
          player.innerHTML = '';
          const ifr = el('iframe', {
            src: absUrl(embedVideoUrl),
            allowfullscreen: 'true',
            allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen'
          });
          ifr.setAttribute('allowfullscreen', '');
          ifr.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
          ifr.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000';
          player.appendChild(ifr);
          return true;
        }

        function mountOpenFallback() {
          player.innerHTML = '';
          player.style.position = 'relative';
          const thumb = (v.thumbnail_url || '').toString();
          if (thumb) {
            const img = el('img', { src: absUrl(thumb), alt: '' });
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;opacity:.45';
            player.appendChild(img);
          }
          const overlay = el('div', { style: 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;text-align:center' });
          overlay.appendChild(el('div', { style: 'opacity:.85' }, v.title || 'Видео'));
          const openBtn = el('a', {
            class: 'btn',
            href: absUrl(embedVideoUrl),
            target: '_blank',
            rel: 'noopener',
            style: 'max-width:240px;text-decoration:none'
          }, '▶ Открыть видео');
          overlay.appendChild(openBtn);
          const openSite = el('a', {
            class: 'ghost',
            href: absUrl(watchUrl),
            target: '_blank',
            rel: 'noopener',
            style: 'text-decoration:none'
          }, 'На сайте');
          overlay.appendChild(openSite);
          player.appendChild(overlay);
        }

        let played = false;
        // Прямой поток только если есть play_url и плеер не iframe
        if (selectedPlayer !== 'iframe' && playUrl) {
          try { played = !!mountDirect(playUrl); } catch (e) { played = false; }
        }
        // Иначе — всегда официальный embed_video.php?slug=
        if (!played && videoSlug) {
          played = mountSiteEmbed();
        }
        if (!played) {
          mountOpenFallback();
        }

        const videoEngine = ({ auto: 'Авто', hlsjs: 'HLS.js', shaka: 'Shaka Player', videojs: 'Video.js', artplayer: 'ArtPlayer', native: 'Native HTML5', iframe: 'Embed' })[selectedPlayer] || 'Авто';
        player.appendChild(el('div', { style: 'position:absolute;right:12px;top:12px;z-index:3;padding:5px 9px;border-radius:20px;background:rgba(5,12,30,.78);color:#dbeafe;font:11px system-ui;pointer-events:none' }, videoEngine));
        box.appendChild(player);

        // Episodes group (client-side from titles, high confidence only)
        try {
          const epBox = el('div', { class: 'ep-mount' });
          box.appendChild(epBox);
          (async function(){
            let list = state._videosCache || [];
            if (!list.length) {
              try {
                const vr = await api('GET', '/api/native_videos.php', { query: { action: 'list', limit: '80' } });
                list = (vr && (vr.videos || vr.data)) || [];
                state._videosCache = list;
              } catch (_) {}
            }
            const series = findRelatedEpisodes(v.title || v.name || '', list, v.channel_title || '');
            renderEpisodesBlock(epBox, series, v.slug || slug);
            // auto-next on ended
            const vidEl = box.querySelector('video');
            if (vidEl && getSetting('autonext', false)) {
              vidEl.addEventListener('ended', function() {
                if (state._nextEpisodeSlug) go('video', { slug: state._nextEpisodeSlug });
              }, { once: true });
            }
          })();
        } catch (_) {}


        const actions = el('div', { class: 'player-actions' });
        const openEmbed = el('a', { class: 'btn', href: absUrl(embedVideoUrl), target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, '▶ Открыть видео');
        const openSite = el('a', { class: 'ghost', href: absUrl(watchUrl), target: '_blank', rel: 'noopener' }, 'На сайте');
        actions.append(openEmbed, openSite);
        box.appendChild(actions);

        const meta = el('div', { class: 'vid-meta' });
        meta.appendChild(el('h2', null, v.title || slug));
        meta.appendChild(el('p', { class: 'sub' }, (v.channel_title || '') + (v.views_count != null ? ' · ' + v.views_count + ' просм.' : '') + (platform ? ' · ' + platform : '')));
        if (v.description) meta.appendChild(el('p', { style: 'font-size:14px;line-height:1.45;color:var(--muted);margin:0' }, v.description));
        box.appendChild(meta);

        const com = el('div', { class: 'comments' });
        com.appendChild(el('h3', null, 'Комментарии'));
        if (!comments.length) com.appendChild(el('p', { style: 'color:var(--muted);font-size:14px' }, 'Пока нет комментариев'));
        comments.forEach(function (cm) {
          const item = el('div', { class: 'c-item' });
          item.innerHTML = '<b></b><span></span>';
          item.querySelector('b').textContent = (cm.author || cm.username || 'user') + ':';
          item.querySelector('span').textContent = cm.message || cm.text || '';
          com.appendChild(item);
        });
        const row = el('div', { class: 'chat-in', style: 'margin-top:12px;background:var(--card);border-radius:14px' });
        const inp = el('input', { type: 'text', placeholder: 'Комментарий…', maxlength: '1000' });
        const send = el('button', { type: 'button' }, '→');
        row.append(inp, send);
        com.appendChild(row);
        send.onclick = async function () {
          const text = (inp.value || '').trim();
          if (!text) return;
          try {
            await api('POST', '/api/native_videos.php', {
              body: { action: 'comment', video_id: v.id, message: text },
              failover: false
            });
            inp.value = '';
            toast('Комментарий отправлен');
            go('video', { slug: slug });
          } catch (e) { toast(e.message || 'Ошибка'); }
        };
        box.appendChild(com);
      } catch (e) {
        box.className = 'empty';
        box.innerHTML = '<b>Ошибка</b>' + (e.message || '');
      }
    }, { back: () => { state.tab = 1; go('home'); } });
  }

  function renderForumThreads(box, threads) {
    box.className = threads && threads.length ? 'list' : 'empty';
    box.innerHTML = '';
    if (!threads || !threads.length) box.innerHTML = '<b>Нет тем</b>Создай первую';
    (threads || []).forEach(th => {
      const row = el('div', { class: 'row' });
      row.innerHTML = '<div class="av">🧵</div><div class="tx"><b></b><small></small></div>';
      row.querySelector('b').textContent = th.title || 'Тема';
      row.querySelector('small').textContent = th.username || th.author || '';
      row.onclick = () => go('thread', { id: th.id, title: th.title });
      box.appendChild(row);
    });
  }

  function screenForumCat(root) {
    const { id, title } = state.route.params;
    shell(root, title || 'Раздел', async (c) => {
      const box = el('div', { class: 'loading' }, 'Загрузка…');
      c.appendChild(box);
      const cachedThreads = readDataCache('forum:threads:' + id);
      if (cachedThreads && cachedThreads.length) {
        renderForumThreads(box, cachedThreads);
        box.insertAdjacentHTML('afterbegin', '<div class="hint">Сохранённые темы · обновляем…</div>');
      }
      try {
        let threads = [];
        try {
          const r = await api('GET', '/api/native_forum.php', {
            query: { action: 'threads', category_id: String(id), limit: '40' }
          });
          if (r && r.threads) threads = r.threads;
        } catch (_) {}
        if (!threads.length) {
          try {
            const r = await api('GET', '/api_forum.php', { query: { category_id: String(id), limit: '40' } });
            if (r && (r.threads || r.data)) threads = r.threads || r.data;
          } catch (_) {}
        }
        writeDataCache('forum:threads:' + id, threads);
        renderForumThreads(box, threads);
        const nb = el('button', { class: 'btn', type: 'button', style: 'margin-top:12px' }, 'Новая тема');
        nb.onclick = async () => {
          const t = prompt('Заголовок темы');
          if (!t) return;
          const body = prompt('Текст');
          if (!body) return;
          try {
            const r = await api('POST', '/api/native_forum.php', {
              body: { action: 'new_thread', category_id: id, title: t, message: body },
              failover: false
            });
            toast((r && r.message) || 'Тема создана');
            go('forumCat', { id, title });
          } catch (e) { toast(e.message || 'Ошибка'); }
        };
        c.appendChild(nb);
      } catch (e) {
        box.className = 'empty';
        box.innerHTML = '<b>Ошибка</b>' + (e.message || '');
      }
    }, { back: () => { state.tab = 2; go('home'); } });
  }

  function screenThread(root) {
    const { id, title } = state.route.params;
    shell(root, title || 'Тема', async (c) => {
      const box = el('div', { class: 'loading' }, 'Загрузка…');
      c.appendChild(box);
      try {
        const r = await api('GET', '/api/native_forum.php', { query: { action: 'thread', id: String(id) } });
        const posts = (r && (r.posts || r.replies)) || [];
        box.className = 'list';
        box.innerHTML = '';
        if (r && r.thread) {
          const head = el('div', { class: 'row' });
          head.innerHTML = '<div class="tx"><b></b><small></small></div>';
          head.querySelector('b').textContent = r.thread.title || title;
          head.querySelector('small').textContent = r.thread.username || '';
          box.appendChild(head);
        }
        posts.forEach(p => {
          const row = el('div', { class: 'row' });
          row.innerHTML = '<div class="av">💬</div><div class="tx"><b></b><small style="white-space:normal"></small></div>';
          row.querySelector('b').textContent = p.username || p.author || 'user';
          row.querySelector('small').textContent = p.message || p.body || p.text || '';
          box.appendChild(row);
        });
        const inp = el('textarea', { style: 'width:100%;min-height:80px;border-radius:14px;border:0;background:rgba(255,255,255,.07);padding:12px;margin-top:12px;resize:vertical', placeholder: 'Ответ…' });
        const send = el('button', { class: 'btn', type: 'button', style: 'margin-top:8px' }, 'Ответить');
        send.onclick = async () => {
          const text = (inp.value || '').trim();
          if (!text) return;
          try {
            await api('POST', '/api/native_forum.php', {
              body: { action: 'reply', thread_id: id, message: text },
              failover: false
            });
            toast('Ответ отправлен');
            go('thread', { id, title });
          } catch (e) { toast(e.message || 'Ошибка'); }
        };
        c.append(inp, send);
      } catch (e) {
        box.className = 'empty';
        box.innerHTML = '<b>Ошибка</b>' + (e.message || '');
      }
    }, { back: () => history.back ? go('home') : go('home') });
  }

  function screenSearch(root) {
    shell(root, 'Поиск', (c) => {
      const wrap = el('div', { class: 'search-glass' });
      wrap.innerHTML = '<span class="search-glass-icon">⌕</span><input id="q" type="search" placeholder="Фильмы, каналы, видео…" autocomplete="off" aria-label="Поиск StreamLive"><button type="button" class="search-clear" aria-label="Очистить">×</button>';
      c.appendChild(wrap);
      const tabs = el('div', { class: 'search-tabs' });
      [['all','Всё'],['channels','Каналы'],['videos','Видео']].forEach(([id,label],i) => {
        const b = el('button', { type:'button', class:i===0?'on':'' }, label);
        b.onclick = () => { tabs.querySelectorAll('button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); runSearch(); };
        b.dataset.kind = id;
        tabs.appendChild(b);
      });
      c.appendChild(tabs);
      const box = el('div', { class: 'list search-results' });
      c.appendChild(box);
      let timer = null, videoItems = [], activeKind = 'all', requestId = 0;
      function currentKind(){ const b=tabs.querySelector('button.on'); return b ? b.dataset.kind : 'all'; }
      function render(items, q) {
        box.innerHTML = '';
        if (!q) { box.innerHTML = '<div class="empty"><b>Найди своё</b>Ищи каналы и видео StreamLive</div>'; return; }
        if (!items.length) { box.innerHTML = '<div class="empty"><b>Ничего не найдено</b>Попробуй изменить запрос</div>'; return; }
        items.forEach(item => {
          const isVideo = item.kind === 'video';
          const row = el('button', { type:'button', class:'row search-result' });
          const av = el('div', { class:'av' });
          const imageUrl = isVideo ? item.thumbnail_url : item.logo_url;
          if (imageUrl) {
            const img = el('img', { src:absUrl(imageUrl), alt:'' });
            img.onerror = () => { img.remove(); av.textContent = isVideo ? '🎬' : '📺'; };
            av.appendChild(img);
          } else av.textContent = isVideo ? '🎬' : (item.type === 'radio' ? '📻' : '📺');
          const tx = el('div', { class:'tx' });
          tx.innerHTML = '<b></b><small></small>';
          tx.querySelector('b').textContent = item.title || item.name || (isVideo?'Видео':'Канал');
          tx.querySelector('small').textContent = isVideo ? ('Видео' + (item.channel_title ? ' · '+item.channel_title : '')) : (item.type === 'radio' ? 'Радио' : 'ТВ');
          row.append(av,tx);
          row.onclick = () => isVideo ? go('video',{slug:item.slug}) : go('channel',{slug:item.slug});
          box.appendChild(row);
        });
      }
      async function runSearch() {
        const q = ($('#q',wrap).value || '').trim();
        const id = ++requestId;
        activeKind = currentKind();
        if (q.length < 2) { render([], ''); return; }
        box.innerHTML = '<div class="loading">Ищем…</div>';
        try {
          let channels = state.channels || [];
          if (!channels.length) {
            const r = await api('GET','/api/native_home.php',{query:{limit:'100'}});
            channels = r.channels || r.data || [];
          }
          let videos = videoItems;
          if (!videos.length && activeKind !== 'channels') {
            const r = await api('GET','/api/native_videos.php',{query:{action:'list',limit:'100'}});
            videos = r.videos || [];
            videoItems = videos;
          }
          if (id !== requestId) return;
          const ql = q.toLocaleLowerCase();
          const chHits = channels.filter(x => ((x.title||x.name||'')+' '+(x.description||'')).toLocaleLowerCase().includes(ql)).map(x=>Object.assign({kind:'channel'},x));
          const vHits = videos.filter(x => ((x.title||'')+' '+(x.description||'')+' '+(x.channel_title||'')).toLocaleLowerCase().includes(ql)).map(x=>Object.assign({kind:'video'},x));
          render(activeKind === 'channels' ? chHits : activeKind === 'videos' ? vHits : chHits.concat(vHits), q);
        } catch(e) {
          if (id === requestId) box.innerHTML = '<div class="empty"><b>Не удалось выполнить поиск</b>' + (e.message || 'Проверь соединение') + '</div>';
        }
      }
      $('#q', wrap).oninput = () => { clearTimeout(timer); timer = setTimeout(runSearch, 250); };
      $('.search-clear',wrap).onclick = () => { $('#q',wrap).value=''; runSearch(); $('#q',wrap).focus(); };
      tabs.querySelectorAll('button').forEach(b => b.addEventListener('click', runSearch));
      render([], '');
      setTimeout(() => $('#q', wrap).focus(), 100);
    }, { back: () => { state.tab = 0; go('home'); } });
  }

  function screenCreate(root) {
    shell(root, 'Создать канал', (c) => {
      c.innerHTML = `
        <div class="glass-panel create-panel">
          <div class="field"><input id="ct" type="text" placeholder=" " maxlength="150" autocomplete="off"><label for="ct">Название канала</label></div>
          <div class="field"><textarea id="cdesc" placeholder=" " maxlength="2000" rows="3"></textarea><label for="cdesc">Описание (необязательно)</label></div>
          <div class="seg" style="margin-bottom:14px"><button type="button" class="on" id="tv">ТВ</button><button type="button" id="rd">Радио</button></div>
          <label class="form-caption" for="csource">Тип источника</label>
          <select id="csource" class="glass-select">
            <option value="m3u8">HLS — .m3u8</option>
            <option value="mp4">MP4 — видеофайл</option>
            <option value="youtube">YouTube</option>
            <option value="vk">VK Видео</option>
            <option value="rutube">Rutube</option>
            <option value="iframe">Встроенный плеер / iframe</option>
          </select>
          <div class="field stream-url-field"><input id="curl" type="url" placeholder=" " autocomplete="url" inputmode="url"><label for="curl">Ссылка на поток или плеер</label></div>
          <div class="field"><input id="clogo" type="url" placeholder=" " inputmode="url"><label for="clogo">Ссылка на логотип (необязательно)</label></div>
          <div class="err" id="cerr" role="alert"></div>
          <button class="btn" type="button" id="cgo">Создать канал</button>
          <p class="hint">Ссылка проверяется сервером. Лимиты и модерация остаются такими же, как на основном сайте.</p>
        </div>`;
      let type = 'tv';
      $('#tv', c).onclick = () => { type = 'tv'; $('#tv', c).className = 'on'; $('#rd', c).className = ''; };
      $('#rd', c).onclick = () => { type = 'radio'; $('#rd', c).className = 'on'; $('#tv', c).className = ''; };
      $('#cgo', c).onclick = async () => {
        const title = ($('#ct', c).value || '').trim();
        const description = ($('#cdesc', c).value || '').trim();
        const url = ($('#curl', c).value || '').trim();
        const source_type = ($('#csource', c).value || 'm3u8').trim();
        const logo_url = ($('#clogo', c).value || '').trim();
        const err = $('#cerr', c);
        const btn = $('#cgo', c);
        err.classList.remove('show');
        if (!title) {
          err.textContent = 'Укажи название канала';
          err.classList.add('show');
          return;
        }
        if (!url) {
          err.textContent = 'Добавь ссылку на поток или страницу плеера';
          err.classList.add('show');
          $('#curl', c).focus();
          return;
        }
        try {
          new URL(url);
        } catch (_) {
          err.textContent = 'Проверь формат ссылки — нужен полный адрес с https://';
          err.classList.add('show');
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Отправляем…';
        try {
          const r = await api('POST', '/api/native_create_channel.php', {
            body: { title, description, type, source_type, source_url: url, source_name: title, logo_url },
            failover: false
          });
          if (!r || !r.ok) throw new Error((r && r.error) || 'Не удалось создать канал');
          toast(r.message || 'Канал отправлен на модерацию');
          state.tab = 0;
          go('home');
        } catch (e) {
          err.textContent = e.message || 'Ошибка создания канала';
          err.classList.add('show');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Создать канал';
        }
      };
    }, { back: () => { state.tab = 0; go('home'); } });
  }

  function screenInstall(root) {
    shell(root, 'Установить', (c) => {
      c.innerHTML = `
        <div class="empty" style="text-align:left">
          <b>Добавь StreamLive на экран «Домой»</b>
          <p style="margin:12px 0;color:var(--muted);font-size:14px;line-height:1.5">
            <b>Android (Chrome):</b> меню ⋮ → «Установить приложение» или «Добавить на главный экран».<br><br>
            <b>iPhone (Safari):</b> Поделиться → «На экран „Домой“».<br><br>
            После этого ярлык откроет это приложение со своей иконкой, без адресной строки.
          </p>
        </div>`;
      if (window.__slInstallPrompt) {
        const b = el('button', { class: 'btn', type: 'button' }, 'Установить');
        b.onclick = async () => {
          window.__slInstallPrompt.prompt();
          try { await window.__slInstallPrompt.userChoice; } catch (_) {}
          window.__slInstallPrompt = null;
        };
        c.appendChild(b);
      }
    }, { back: () => { state.tab = 5; go('home'); } });
  }

  function screenDm(root) {
    const { id, title } = state.route.params;
    shell(root, title || 'Диалог', async (c) => {
      const msgs = el('div', { class: 'chat-msgs', style: 'max-height:none;min-height:200px;background:var(--card);border-radius:14px' });
      const dmCacheKey = 'chat:messages:' + id;
      const cachedMessages = readDataCache(dmCacheKey) || [];
      const renderedMessageIds = new Set();
      function renderMessage(m) {
        const mid = String(m && (m.id || m.message_id) || '');
        const sig = mid || [m.username || '', m.created_at || '', m.body || m.message || ''].join('|');
        if (renderedMessageIds.has(sig)) return;
        renderedMessageIds.add(sig);
        const line = el('div', { class: 'm' });
        line.innerHTML = '<b></b><span></span>';
        line.querySelector('b').textContent = m.username || 'user';
        line.querySelector('span').textContent = m.body || m.message || '';
        msgs.appendChild(line);
      }
      cachedMessages.forEach(renderMessage);
      c.appendChild(msgs);
      const inpRow = el('div', { class: 'chat-in', style: 'margin-top:8px;background:var(--card);border-radius:14px' });
      const inp = el('input', { type: 'text', placeholder: 'Сообщение…' });
      const send = el('button', { type: 'button' }, '→');
      inpRow.append(inp, send);
      c.appendChild(inpRow);
      let after = 0;
      let timer = null;
      let loading = false;

      async function load() {
        if (loading) return;
        if (document.hidden) return; // экономия хитов InfinityFree
        loading = true;
        try {
          let list = [];
          try {
            const r = await api('GET', '/api/native_messenger.php', {
              query: { action: 'messages', conversation_id: String(id), after: String(after) }
            });
            list = (r && (r.messages || r.data)) || [];
          } catch (_) {
            try {
              const r = await api('GET', '/message_poll.php', {
                query: { conversation_id: String(id), after: String(after) }
              });
              list = (r && r.messages) || [];
            } catch (__) {}
          }
          list.forEach(m => {
            const mid = Number(m.id || m.message_id || 0);
            if (mid > after) after = mid;
            renderMessage(m);
          });
          if (list.length) {
            appendCachedMessages(dmCacheKey, list);
            msgs.scrollTop = msgs.scrollHeight;
          }
        } catch (_) {}
        loading = false;
      }
      await load();
      // редкий опрос: 12 сек, только на этом экране и когда вкладка видна
      var chatMin = parseInt(getSetting('chat_poll_min', 12), 10) || 12;
      timer = setInterval(load, Math.max(5, Math.min(chatMin, 300)) * 1000);
      root._chatTimer = timer;
        // Лёгкая проверка смены потока раз в 3 мин (1 запрос) — без reload страницы
        (function softSourceWatch(){
          var lastFp = (src && src.url) ? String(src.url) : '';
          var t = setInterval(async function(){
            if (document.hidden) return;
            try {
              const rr = await api('GET', '/api/native_channel.php', { query: { slug: ch.slug || slug }, failover: false });
              const nu = rr && rr.source && rr.source.url ? String(rr.source.url) : '';
              if (nu && lastFp && nu !== lastFp) {
                lastFp = nu;
                toast('Поток обновился');
                // remount player without full page reload
                try {
                  player.innerHTML = '';
                  const vv = el('video', { controls: 'true', playsinline: 'true' });
                  vv.style.width = '100%'; vv.style.height = '100%';
                  player.appendChild(vv);
                  playMedia(vv, nu, /\.m3u8/i.test(nu));
                } catch (e) {}
              } else if (nu) lastFp = nu;
            } catch (e) {}
          }, 3 * 60 * 1000);
          root._srcTimer = t;
        })();

      send.onclick = async () => {
        const text = (inp.value || '').trim();
        if (!text) return;
        try {
          try {
            await api('POST', '/api/native_messenger.php', {
              body: { action: 'send', conversation_id: id, message: text },
              failover: false
            });
          } catch (_) {
            await api('POST', '/message_send.php', {
              body: { conversation_id: id, body: text },
              failover: false
            });
          }
          inp.value = '';
          await load();
        } catch (e) { toast(e.message || 'Ошибка'); }
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') send.onclick(); });
    }, { back: () => { if (root._chatTimer) clearInterval(root._chatTimer); state.tab = 3; go('home'); } });
  }


  function screenSettings(root) {
    shell(root, 'Настройки', (c) => {
      function rowSwitch(label, key, def, hint) {
        const wrap = el('div', { class: 'row', style: 'cursor:default' });
        const on = !!getSetting(key, def);
        wrap.innerHTML = '<div class="tx"><b></b><small></small></div>';
        wrap.querySelector('b').textContent = label;
        wrap.querySelector('small').textContent = hint || '';
        const btn = el('button', {
          type: 'button',
          class: 'chip' + (on ? ' on' : ''),
          style: 'margin:0'
        }, on ? 'Вкл' : 'Выкл');
        btn.onclick = () => {
          const v = !getSetting(key, def);
          setSetting(key, v);
          btn.textContent = v ? 'Вкл' : 'Выкл';
          btn.className = 'chip' + (v ? ' on' : '');
          toast(label + ': ' + (v ? 'вкл' : 'выкл'));
        };
        wrap.appendChild(btn);
        c.appendChild(wrap);
      }

      c.appendChild(el('p', { class: 'set-sec', style: 'margin:0 0 8px' }, 'Основные'));
      c.appendChild(el('p', { style: 'color:var(--muted);font-size:12px;margin:14px 0 8px' }, 'Зеркало сайта'));
      var mirrors = (typeof MIRRORS !== 'undefined' ? MIRRORS : [state.base]);
      mirrors.forEach(function (m) {
        var b = el('button', { type: 'button', class: 'row' });
        var host = String(m).replace(/^https?:\/\//, '');
        var cur = (state.base || '').replace(/\/$/, '') === m.replace(/\/$/, '');
        b.innerHTML = '<div class="tx"><b></b><small></small></div>';
        b.querySelector('b').textContent = host;
        b.querySelector('small').textContent = cur ? '✓ текущее' : 'переключить';
        b.onclick = function () {
          state.base = m;
          try { localStorage.setItem('sl_base', m); } catch (e) {}
          toast('Зеркало: ' + host);
          go('settings');
        };
        c.appendChild(b);
      });

      rowSwitch('Уведомления', 'notify', true, 'Браузерные, раз в 30 мин максимум одно');
      const nbtn = el('button', { type: 'button', class: 'row' });
      nbtn.innerHTML = '<div class="tx"><b>Разрешить уведомления браузера</b><small>' + (('Notification' in window) ? Notification.permission : 'нет API') + '</small></div>';
      nbtn.onclick = function(){ notifRequestPermission().then(function(p){ toast('Статус: ' + p); if(p==='granted'){ setSetting('notify', true); scheduleNotifWorker(true);} go('settings'); }); };
      c.appendChild(nbtn);

      rowSwitch('Экономия хитов', 'save_hits', true, 'Редкий опрос чата, меньше запросов');
      rowSwitch('Автопереход к следующему видео', 'autonext', false, 'Если в подборке есть следующее видео');
      rowSwitch('Запоминать просмотр', 'watch_history', true, 'Локальная история на этом устройстве');
      rowSwitch('Анимации интерфейса', 'motion', true, 'Плавные переходы и эффекты');
      rowSwitch('Компактные карточки', 'compact_cards', false, 'Больше контента на экране');

      c.appendChild(el('p', { class: 'set-sec' }, 'Внешний вид'));
      [['dark','Тёмная'],['light','Светлая'],['system','Системная']].forEach(function(pair){
        var id=pair[0], lab=pair[1];
        var cur=getSetting('theme','dark');
        var b=el('button',{type:'button',class:'row'});
        b.innerHTML='<div class="tx"><b>'+lab+'</b><small>'+(cur===id?'✓ тема':'тема интерфейса')+'</small></div>';
        b.onclick=function(){
          setSetting('theme', id);
          var t=id;
          if(id==='system') t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';
          document.documentElement.setAttribute('data-theme', t==='light'?'light':'dark');
          toast('Тема: '+lab); go('settings');
        };
        c.appendChild(b);
      });
      [['soft','Мягкое стекло'],['normal','Обычное'],['strong','Сильное размытие']].forEach(function(pair){
        var id=pair[0], lab=pair[1];
        var cur=getSetting('glass','normal');
        var b=el('button',{type:'button',class:'row'});
        b.innerHTML='<div class="tx"><b>'+lab+'</b><small>'+(cur===id?'✓ glass':'интенсивность Liquid Glass')+'</small></div>';
        b.onclick=function(){ setSetting('glass', id); document.documentElement.setAttribute('data-glass', id); toast(lab); go('settings'); };
        c.appendChild(b);
      });

      c.appendChild(el('p', { class: 'set-sec' }, 'Воспроизведение · перемотка'));
      [['10','10 секунд'],['20','20 секунд']].forEach(function(pair){
        var id=pair[0], lab=pair[1];
        var cur=String(getSetting('seek_sec',20));
        var b=el('button',{type:'button',class:'row'});
        b.innerHTML='<div class="tx"><b>'+lab+'</b><small>'+(cur===id?'✓ интервал':'кнопки ± на плеере')+'</small></div>';
        b.onclick=function(){ setSetting('seek_sec', parseInt(id,10)); toast('Перемотка: '+lab); go('settings'); };
        c.appendChild(b);
      });

      c.appendChild(el('p', { class: 'set-sec' }, 'Уведомления и чат'));
      const pollBox = el('div', { class: 'list' });
      [[5, '5 мин'], [15, '15 мин'], [30, '30 мин'], [60, '60 мин']].forEach(([m, lab]) => {
        const cur = parseInt(getSetting('chat_poll_min', 30), 10) || 30;
        const b = el('button', {
          type: 'button',
          class: 'row',
          style: cur === m ? 'border-color:var(--violet)' : ''
        });
        b.innerHTML = '<div class="tx"><b>' + lab + '</b><small>Опрос сообщений</small></div>';
        b.onclick = () => { setSetting('chat_poll_min', m); toast('Чат: раз в ' + lab); go('settings'); };
        pollBox.appendChild(b);
      });
      c.appendChild(pollBox);

      c.appendChild(el('p', { class: 'set-sec' }, 'Плеер'));
      rowSwitch('Своя панель −/+ / скорость', 'player_chrome', false, 'Выкл = только кнопки самого плеера');
      c.appendChild(el('p', { class: 'set-sec' }, 'Навигация'));
      ;(() => {
        const cur = getSetting('nav_layout', 'bottom');
        const row = el('div', { class: 'seg', style: 'margin-bottom:10px;flex-wrap:wrap' });
        [['bottom','Низ'],['hamburger','☰ Круг'],['side','Бок']].forEach(function(pair){
          const b = el('button', { type: 'button', class: cur === pair[0] ? 'on' : '' }, pair[1]);
          b.onclick = function(){ setSetting('nav_layout', pair[0]); toast('Навигация: ' + pair[1]); go('settings'); };
          row.appendChild(b);
        });
        c.appendChild(row);
      })();
      rowSwitch('Компактный список', 'compact_cards', false, 'Меньше карточки');
      rowSwitch('Показывать часы в шапке', 'top_clock', false, 'Локальное время');


      const players = [
        ['auto', 'Авто — каскад рабочих'],
        ['hlsjs', 'HLS.js'],
        ['shaka', 'Shaka Player'],
        ['videojs', 'Video.js'],
        ['artplayer', 'ArtPlayer'],
        ['clappr', 'Clappr'],
        ['dashjs', 'dash.js'],
        ['fluid', 'Fluid Player'],
        ['openplayer', 'OpenPlayerJS'],
        ['plyr', 'Plyr'],
        ['mediaelement', 'MediaElement.js'],
        ['dplayer', 'DPlayer'],
        ['jwplayer', 'JW-safe'],
        ['pegasus', 'Plyr + HLS'],
        ['vidstack', 'Vidstack'],
        ['xgplayer', 'XGPlayer'],
        ['ckplayer', 'CKPlayer-style'],
        ['tcplayer', 'TCPlayer-light'],
        ['flowplayer', 'Flowplayer 7'],
        ['afterglow', 'Afterglow'],
        ['lightgallery', 'Light HTML5+HLS'],
        ['html5hls', 'HTML5 + HLS.js'],
        ['html5only', 'Native HTML5 only'],
        ['cloudflare', 'CF-light'],
        ['bitmovin', 'Bitmovin-light'],
        ['theo', 'Theo-light'],
        ['radiant', 'Radiant-light'],
        ['vjs_old', 'Video.js classic'],
        ['hls_lite', 'HLS.js lite'],
        ['mp4_force', 'MP4 / progressive'],
        ['cdnplayer', 'CDN Player (tatnet)'],
        ['liveplayer', 'Live Player (tatnet)'],
        ['native', 'Native HTML5'],
        ['android_exo', 'Exo-style (HTML5+HLS)'],
        ['android_vlc', 'VLC-style (HTML5)'],
        ['webview_native', 'WebView native'],
        ['iframe', 'Embed iframe']
      ];
      const curP = getSetting('player'  , 'auto');
      players.forEach(([id, lab]) => {
        const b = el('button', { type: 'button', class: 'row' });
        b.innerHTML = '<div class="tx"><b>' + lab + '</b><small>' + (curP === id ? '✓ выбран' : id) + '</small></div>';
        b.onclick = () => { setSetting('player', id); toast('Плеер: ' + lab); go('settings'); };
        c.appendChild(b);
      });

      c.appendChild(el('p', { class: 'set-sec' }, 'Кэш и обновление'));
      const updateBtn = el('button', { type: 'button', class: 'row', style: 'border-color:var(--violet)' });
      updateBtn.innerHTML = '<div class="tx"><b>↻ Обновить StreamLive</b><small>Проверить и установить актуальную версию</small></div>';
      updateBtn.onclick = async function () {
        if (updateBtn.disabled) return;
        updateBtn.disabled = true;
        updateBtn.querySelector('small').textContent = 'Подготавливаем обновление…';
        try {
          // Update an existing registration if the hosting environment has one.
          if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.filter(r => r.scope.indexOf(location.origin + '/webapp/') === 0).map(r => r.update().catch(() => null)));
          }
        } catch (e) { /* A missing/blocked service worker must not prevent refresh. */ }
        // A unique URL bypasses cached HTML; the build query also gives the browser
        // a fresh navigation while versioned asset URLs are refreshed by each release.
        const target = new URL(location.href);
        target.searchParams.set('sl_refresh', String(Date.now()));
        target.searchParams.set('build', String(state.build));
        location.replace(target.toString());
      };
      c.appendChild(updateBtn);

      c.appendChild(el('p', { class: 'set-sec' }, 'О приложении · 7× тап по версии = dev'));
      const about = el('div', { class: 'row', style: 'cursor:default;flex-direction:column;align-items:flex-start;gap:4px' });
      about.innerHTML = '<b>StreamLive WebApp</b><small>Версия ' + state.version + ' · build ' + state.build + ' · F10</small><small>Для WebView / ярлыка · InfinityFree-friendly</small>';
      c.appendChild(about);
      about.style.cursor = 'pointer';
      about.onclick = function() {
        state.devTap = (state.devTap || 0) + 1;
        if (state.devTap >= 7) {
          setSetting('dev_mode', true);
          toast('Режим разработчика включён');
          state.devTap = 0;
          go('settings');
        } else if (state.devTap >= 3) {
          toast('Ещё ' + (7 - state.devTap) + ' для режима разработчика');
        }
      };


      if (getSetting('dev_mode', false)) {
        c.appendChild(el('p', { class: 'set-sec' }, 'Режим разработчика'));
        rowSwitch('Режим разработчика', 'dev_mode', true, 'Служебные опции');
        rowSwitch('Отладка API', 'debug_api', false, 'Показывать сырые ошибки в toast');
        rowSwitch('Логи в console', 'console_log', true, 'Маршруты и ответы');
        rowSwitch('Принудительный failover зеркал', 'force_failover', false, 'Всегда перебирать mirrors');
        rowSwitch('Экономия хитов', 'low_hits', true, 'Реже опросы, больше кэша');
        rowSwitch('Автовоспроизведение', 'autoplay', false, 'Стартовать поток сразу');
        rowSwitch('Бейдж версии', 'show_build_badge', true, 'v' + state.version + ' в углу');
        const clr = el('button', { type: 'button', class: 'row' });
        clr.innerHTML = '<div class="tx"><b>Очистить кэш данных</b><small>Каналы, форум, история чата</small></div>';
        clr.onclick = () => {
          Object.keys(localStorage).forEach(k => { if (k.indexOf(DATA_CACHE_PREFIX) === 0) localStorage.removeItem(k); });
          toast('Кэш данных очищен');
          go('settings');
        };
        c.appendChild(clr);
        const clrAll = el('button', { type: 'button', class: 'row' });
        clrAll.innerHTML = '<div class="tx"><b>Сбросить настройки</b><small>localStorage sl_settings</small></div>';
        clrAll.onclick = () => {
          state.settings = {};
          localStorage.removeItem('sl_settings');
          toast('Настройки сброшены');
          go('settings');
        };
        c.appendChild(clrAll);
        const ping = el('button', { type: 'button', class: 'row' });
        ping.innerHTML = '<div class="tx"><b>Проверить API</b><small>native_auth me</small></div>';
        ping.onclick = async () => {
          try {
            const r = await auth('me');
            toast(r && r.ok ? ('OK: ' + (r.user && r.user.username)) : JSON.stringify(r));
          } catch (e) { toast(e.message || 'fail'); }
        };
        c.appendChild(ping);
        const swKill = el('button', { type: 'button', class: 'row' });
        swKill.innerHTML = '<div class="tx"><b>Сбросить Service Worker</b><small>PWA cache</small></div>';
        swKill.onclick = async () => {
          try {
            if ('serviceWorker' in navigator) {
              const regs = await navigator.serviceWorker.getRegistrations();
              for (const r of regs) await r.unregister();
            }
            if (window.caches) {
              const keys = await caches.keys();
              await Promise.all(keys.map(k => caches.delete(k)));
            }
            toast('SW сброшен — обнови страницу');
          } catch (e) { toast(e.message || 'fail'); }
        };
        c.appendChild(swKill);
        const hard = el('button', { type: 'button', class: 'row' });
        hard.innerHTML = '<div class="tx"><b>Жёсткое обновление</b><small>/webapp/?v=' + state.build + '</small></div>';
        hard.onclick = () => { location.href = '/webapp/?v=' + state.build + '&t=' + Date.now(); };
        c.appendChild(hard);
        const info = el('div', { class: 'row', style: 'cursor:default;flex-direction:column;align-items:flex-start;gap:4px' });
        c.appendChild(el('p', { class: 'set-sec' }, 'Инструменты F14'));
      const addSp = el('button', { type: 'button', class: 'row' });
      addSp.innerHTML = '<div class="tx"><b>Добавить 50 искр</b><small>только dev</small></div>';
      addSp.onclick = function(){ toast('Искры: ' + ecoAddSparks(50)); };
      c.appendChild(addSp);
      const resetSp = el('button', { type: 'button', class: 'row' });
      resetSp.innerHTML = '<div class="tx"><b>Сброс экономики</b><small>sl_eco_v1</small></div>';
      resetSp.onclick = function(){ localStorage.removeItem('sl_eco_v1'); toast('Экономика сброшена'); };
      c.appendChild(resetSp);
      const openW = el('button', { type: 'button', class: 'row' });
      openW.innerHTML = '<div class="tx"><b>Открыть Колесо Эфира</b></div>';
      openW.onclick = function(){ showWheelModal(true); };
      c.appendChild(openW);
      const exp = el('button', { type: 'button', class: 'row' });
      exp.innerHTML = '<div class="tx"><b>Экспорт настроек</b><small>JSON в буфер</small></div>';
      exp.onclick = function(){ try { navigator.clipboard.writeText(JSON.stringify(state.settings||{},null,2)); toast('Скопировано'); } catch(e){ toast('Не удалось'); } };
      c.appendChild(exp);
      const imp = el('button', { type: 'button', class: 'row' });
      imp.innerHTML = '<div class="tx"><b>Сброс fingerprint уведомлений</b><small>sl_notif_*</small></div>';
      imp.onclick = function(){ try { ['sl_notif_last','sl_notif_fp','sl_notif_unread'].forEach(function(k){ localStorage.removeItem(k); }); toast('Сброшено'); } catch(e){} };
      c.appendChild(imp);
      const soft = el('button', { type: 'button', class: 'row' });
      soft.innerHTML = '<div class="tx"><b>Сбросить только кэш каналов</b><small>новый канал появится сразу</small></div>';
      soft.onclick = function(){
        try { Object.keys(localStorage).forEach(function(k){ if(k.indexOf('sl_data_v1:')===0 && k.indexOf('channels')>=0) localStorage.removeItem(k); }); state.channels=[]; toast('Кэш каналов очищен'); } catch(e){}
      };
      c.appendChild(soft);
      info.innerHTML = '<b>Сборка</b><small>' + state.version + ' · build ' + state.build + '</small><small>base: ' + (state.base || '') + '</small><small>UA: ' + (navigator.userAgent || '').slice(0, 80) + '</small>';
        c.appendChild(info);
      } else {
        c.appendChild(el('p', { class: 'auth-hint', style: 'margin-top:16px' }, 'Тапни 7 раз по версии в профиле — режим разработчика'));
      }
    }, { back: () => { state.tab = 5; go('home'); } });
  }



  function screenGame(root) {
    const { id, title } = state.route.params || {};
    shell(root, title || 'Игра', (c) => {
      const box = el('div', { class: 'gbox' });
      c.appendChild(box);
      const list = (window.SLGames && SLGames.list) || [];
      let g = list.filter(function (x) { return x.id === id; })[0];
      if (g && typeof g.f === 'function') {
        try { g.f(box); } catch (e) {
          box.innerHTML = '<div class="empty"><b>Ошибка игры</b>' + (e.message || '') + '</div>';
        }
        return;
      }
      // try open external games page
      box.innerHTML = '<div class="empty"><b>' + (title || id) + '</b>Открыть на странице игр</div>';
      const a = el('a', { class: 'v-btn', href: '/webapp/games.html#' + encodeURIComponent(id || ''), style: 'text-decoration:none' }, '▶ Играть');
      box.appendChild(a);
    }, { back: () => { state.tab = 4; go('home'); } });
  }


  function initTvKeys() {
    if (window.__slTvKeys) return;
    window.__slTvKeys = true;
    document.addEventListener('keydown', function(e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      var key = e.key;
      if (key === 'Escape' || key === 'Backspace') {
        if (state.route && state.route.name !== 'home' && state.route.name !== 'auth' && state.route.name !== 'splash') {
          e.preventDefault();
          go('home');
        }
      }
      if (key === 'MediaPlayPause' || key === ' ') {
        var v = document.querySelector('.player-box video');
        if (v) { e.preventDefault(); if (v.paused) v.play(); else v.pause(); }
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        var v2 = document.querySelector('.player-box video');
        if (v2 && !v2.paused) {
          e.preventDefault();
          var sec = parseInt(getSetting('seek_sec', 20), 10) || 10;
          v2.currentTime = Math.max(0, (v2.currentTime || 0) + (key === 'ArrowLeft' ? -sec : sec));
        }
      }
    });
  }

  function render() {
    const root = $('#app');
    if (!root) return;
    initTvKeys();
    (function(){ var t=getSetting('theme','dark'); if(t==='system') t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark'; document.documentElement.setAttribute('data-theme', t==='light'?'light':'dark'); document.documentElement.setAttribute('data-glass', getSetting('glass','normal'));
      document.documentElement.setAttribute('data-nav', getSetting('nav_layout','bottom'));
      document.documentElement.setAttribute('data-compact', getSetting('compact_cards', false) ? '1' : '0');
    })();
    if (root._chatTimer) { clearInterval(root._chatTimer); root._chatTimer = null; }
    const n = state.route.name;
    if (n === 'splash') return screenSplash(root);
    if (n === 'auth') return screenAuth(root);
    if (n === 'home') { root.className = ''; return screenHome(root); }
    if (n === 'channel') return screenChannel(root);
    if (n === 'video') return screenVideo(root);
    if (n === 'forumCat') return screenForumCat(root);
    if (n === 'thread') return screenThread(root);
    if (n === 'search') return screenSearch(root);
    if (n === 'create') return screenCreate(root);
    if (n === 'install') return screenInstall(root);
    if (n === 'settings') return screenSettings(root);
    if (n === 'game') return screenGame(root);
    if (n === 'dm') return screenDm(root);
    go('home');
  }

  // PWA install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__slInstallPrompt = e;
  });

  async function registerAppWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('/webapp/sw.js?v=1464', { scope: '/webapp/' });
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner('новая версия', 'доступна');
          }
        });
      });
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner('новая версия', 'доступна');
    } catch (e) { /* PWA cache is optional on hosts that block service workers. */ }
  }

  function forceCheckUpdate() {
    checkRemoteBuild();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration('/webapp/').then(function(reg) {
        if (reg) reg.update().catch(function(){});
      }).catch(function(){});
    }
  }
  async function checkRemoteBuild() {
    try {
      const res = await fetch('/webapp/build.json?ts=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) return;
      const info = await res.json();
      const remoteBuild = Number(info.build) || 0;
      const remoteVer = String(info.version || '');
      const localBuild = Number(state.build) || Number(window.SL_BUILD) || 0;
      if (remoteBuild > localBuild) {
        showUpdateBanner(remoteVer || 'новая версия', remoteBuild);
      }
    } catch (_) {}
  }
  document.addEventListener('DOMContentLoaded', () => {
    registerAppWorker();
    checkRemoteBuild();
    setInterval(checkRemoteBuild, 5 * 60 * 1000);
    scheduleNotifWorker(false);
    setTimeout(showNotifBanner, 2500);
    scheduleWheelBanner();
    go('splash');
  });
})();
