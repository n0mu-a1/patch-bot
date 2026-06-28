const CACHE = "hiragana-v3";
const ASSETS = [
  ".", "index.html", "styles.css",
  "data/kana.js", "game-config.js", "feedback.js", "game.js",
  "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-192.png", "icon-512.png",
  "audio/a.m4a","audio/i.m4a","audio/u.m4a","audio/e.m4a","audio/o.m4a",
  "audio/ka.m4a","audio/ki.m4a","audio/ku.m4a","audio/ke.m4a","audio/ko.m4a",
  "audio/sa.m4a","audio/shi.m4a","audio/su.m4a","audio/se.m4a","audio/so.m4a",
  "audio/ta.m4a","audio/chi.m4a","audio/tsu.m4a","audio/te.m4a","audio/to.m4a",
  "audio/na.m4a","audio/ni.m4a","audio/nu.m4a","audio/ne.m4a","audio/no.m4a",
  "audio/ha.m4a","audio/hi.m4a","audio/fu.m4a","audio/he.m4a","audio/ho.m4a",
  "audio/ma.m4a","audio/mi.m4a","audio/mu.m4a","audio/me.m4a","audio/mo.m4a",
  "audio/ya.m4a","audio/yu.m4a","audio/yo.m4a",
  "audio/ra.m4a","audio/ri.m4a","audio/ru.m4a","audio/re.m4a","audio/ro.m4a",
  "audio/wa.m4a","audio/wo.m4a","audio/n.m4a",
  "audio/seikai.m4a","audio/yoku.m4a","audio/hanamaru.m4a",
  "audio/sugoi.m4a","audio/mouichido.m4a","audio/oshii.m4a"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("hiragana-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.includes("/audio/") && url.pathname.endsWith(".m4a")) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "index.html"));
    return;
  }

  event.respondWith(networkFirst(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  const cache = await caches.open(CACHE);
  cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await caches.match(request)) || (fallbackUrl && await caches.match(fallbackUrl));
  }
}
