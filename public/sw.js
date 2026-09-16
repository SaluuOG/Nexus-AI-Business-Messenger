// Only the public offline notice is cached. Chats, API responses, credentials,
// app HTML and JS never enter this service worker's cache.
const CACHE = 'nexus-mobile-offline-v1';
const OFFLINE = new URL('offline.html', self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request(OFFLINE, { cache: 'reload' }))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('nexus-mobile-offline-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.mode !== 'navigate' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(OFFLINE) || new Response('Nexus braucht eine Internetverbindung. Bitte erneut laden.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});
