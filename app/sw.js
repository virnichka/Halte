/* Service worker : application utilisable hors ligne (texte + voix de l'appareil).
   Les tuiles de carte déjà vues sont mises en cache ; aucun téléchargement en masse. */
var VER = 'ta-v3';
var TILES = 'ta-tiles-v1';
var MAX_TILES = 600;
var SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'map.js', 'data/lieux.json',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VER).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VER && k !== TILES; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function trim(cache) {
  return cache.keys().then(function (keys) {
    if (keys.length <= MAX_TILES) return;
    return Promise.all(keys.slice(0, keys.length - MAX_TILES).map(function (k) { return cache.delete(k); }));
  });
}

function tileFetch(req) {
  return caches.open(TILES).then(function (cache) {
    return cache.match(req.url).then(function (hit) {
      if (hit) return hit;
      // mode cors : réponse non opaque (n'écrase pas le quota de stockage)
      return fetch(new Request(req.url, { mode: 'cors', credentials: 'omit' })).then(function (res) {
        if (res.ok) { cache.put(req.url, res.clone()).then(function () { return trim(cache); }); }
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.hostname === 'tile.openstreetmap.org') { e.respondWith(tileFetch(req)); return; }
  if (url.origin !== location.origin) return;
  // Même origine : cache d'abord, mise à jour en arrière-plan
  e.respondWith(caches.open(VER).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
