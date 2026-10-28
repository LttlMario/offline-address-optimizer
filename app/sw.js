const CACHE = 'offline-address-optimizer-v11';
const ASSETS = ['./','./index.html','./search.html','./search.js','./styles.css','./app.js','./offline.mjs','./leaflet.js','./leaflet.css','./manifest.webmanifest','./offline-data/devon-map.json.gz','./offline-data/devon-road-graph.json.gz','./offline-data/devon-postcodes.json.gz'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(response => { const copy = response.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return response; }))));
