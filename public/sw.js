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
  event.respondWith(fetch(request, { cache: 'no-store' }).catch(async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(OFFLINE) || new Response('Nexus braucht eine Internetverbindung. Bitte erneut laden.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});

// This database contains only the current account/device binding, switches and
// short-lived delivery IDs. It never stores auth tokens, chats or task content.
function pushStore(mode, action) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('nexus-push-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('state', mode);
      const result = action(transaction.objectStore('state'));
      transaction.oncomplete = () => { resolve(result?.result); db.close(); };
      transaction.onerror = () => { reject(transaction.error); db.close(); };
      transaction.onabort = () => { reject(transaction.error); db.close(); };
    };
  });
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'NEXUS_PUSH_BINDING' || !event.source?.url?.startsWith(self.registration.scope)) return;
  event.waitUntil((async () => {
    try {
      const value = event.data.binding;
      if (value && (typeof value.userId !== 'string' || typeof value.deviceId !== 'string' || value.enabled !== true)) throw new Error('Invalid binding');
      await pushStore('readwrite', store => value ? store.put(value, 'binding') : store.delete('binding'));
      // Privacy changes and logout also remove old lock-screen previews.
      for (const notification of await self.registration.getNotifications()) notification.close();
      event.ports[0]?.postMessage({ ok: true });
    } catch { event.ports[0]?.postMessage({ ok: false }); }
  })());
});

function pushTarget(path) {
  if (typeof path !== 'string' || !/^\/app\/(chats|groups|business|settings)(\?|$)/.test(path)) return null;
  return new URL('#' + path, self.registration.scope).href;
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    if (!payload || payload.v !== 1 || typeof payload.id !== 'string' || payload.expires < Date.now()) return;
    const current = await pushStore('readonly', store => store.get('binding')).catch(() => null);
    if (!current || !current.enabled || current.userId !== payload.recipient || current.deviceId !== payload.device) return;
    const category = { direct_message: 'messages', group_message: 'messages', task_assigned: 'assignments', task_comment: 'comments', task_reminder_before: 'deadlines', task_reminder_due: 'deadlines' }[payload.kind];
    if (payload.kind !== 'test' && (!category || !current[category])) return;
    const url = pushTarget(payload.path);
    if (!url) return;
    const seen = await pushStore('readonly', store => store.get('seen')) || {};
    if (seen[payload.id]) return;
    const tag = 'nexus-' + payload.id;
    await self.registration.showNotification(current.previews ? String(payload.title).slice(0,100) : 'Nexus', {
      body: String(current.previews ? payload.body : payload.generic).slice(0,160),
      icon: new URL('icons/nexus-192.png', self.registration.scope).href,
      tag, renotify: false,
      data: { url, userId: payload.recipient, deviceId: payload.device },
    });
    const recent = Object.fromEntries(Object.entries(seen).filter(([, time]) => time > Date.now() - 900_000).slice(-99));
    recent[payload.id] = Date.now();
    await pushStore('readwrite', store => store.put(recent, 'seen'));
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data;
    const current = await pushStore('readonly', store => store.get('binding')).catch(() => null);
    if (!current || current.userId !== data?.userId || current.deviceId !== data?.deviceId) return;
    const url = new URL(data.url);
    if (!url.href.startsWith(self.registration.scope) || !pushTarget(url.hash.slice(1))) return;
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find(client => client.url.startsWith(self.registration.scope));
    if (tab) { await tab.navigate(url.href); await tab.focus(); }
    else await self.clients.openWindow(url.href);
  })());
});

self.addEventListener('pushsubscriptionchange', event => {
  // No bearer tokens live in the worker. Re-enrolment is explicit in Settings.
  event.waitUntil(pushStore('readwrite', store => store.delete('binding')));
});
