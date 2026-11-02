/* StreamLive PWA service worker — build 1458 */
'use strict';
const CACHE_NAME = 'streamlive-static-v1458';
const APP_SCOPE = '/webapp/';
const PRECACHE = ['/webapp/','/webapp/index.html','/webapp/manifest.webmanifest','/assets/webapp/app.css?v=1458','/assets/webapp/app.js?v=1458','/assets/webapp/doodles.js?v=1458','/assets/webapp/games.js?v=1458'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(PRECACHE.map(url => cache.add(url).catch(() => null)));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith('streamlive-static-') && k !== CACHE_NAME).map(k => caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || /\\/(message_poll|message_send)\\.php$/.test(url.pathname) || url.searchParams.has('action')) return;
  if (url.pathname.startsWith('/assets/webapp/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME), cached = await cache.match(req);
      const network = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
      return cached || await network || new Response('', {status:504,statusText:'Offline'});
    })());
  } else if (url.pathname.startsWith(APP_SCOPE)) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req, {cache:'no-store'});
        if (res && res.ok && (req.mode === 'navigate' || url.pathname.endsWith('.html'))) {
          const cache = await caches.open(CACHE_NAME); cache.put('/webapp/index.html', res.clone());
        }
        return res;
      } catch (_) {
        const cache = await caches.open(CACHE_NAME);
        return await cache.match('/webapp/index.html') || await cache.match('/webapp/') || new Response('Offline', {status:503});
      }
    })());
  }
});
