const CACHE_NAME = 'stereofix-v1-shell';
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(['./', './manifest.webmanifest', './favicon.svg']))
      .catch(() => {})
  );
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  ]));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const putCache = response => {
    if (response.ok && response.type === 'basic') {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(() => {});
    }
    return response;
  };
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(putCache).catch(() => caches.match(event.request)));
  } else {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(putCache)));
  }
});
