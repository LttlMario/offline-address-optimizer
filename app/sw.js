const CACHE = 'offline-address-optimizer-v1';
const ASSETS = ['./','./index.html','./styles.css','./app.js','./manifest.webmanifest'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(response => { const copy = response.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return response; }))));
