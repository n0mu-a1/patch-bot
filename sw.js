// シンプルなオフラインキャッシュ。配信のたびに CACHE 名を上げると更新される。
const CACHE = "reflexlab-v1";
const ASSETS = [
  ".", "index.html", "styles.css",
  "game-config.js", "feedback.js", "game.js",
  "manifest.webmanifest", "icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// network-first: 更新を取りに行き、失敗時のみキャッシュ（パッチ反映を速くするため）
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
