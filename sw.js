const CACHE = "asobi-hub-v1";
const CACHE_PREFIX = "asobi-hub-";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "icon.svg",
];
const SHELL_PATHS = new Set(["/", "/index.html", "/styles.css", "/manifest.webmanifest", "/icon.svg"]);
const GAME_PREFIXES = ["/reflex/", "/hiragana/"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (GAME_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;
  if (!SHELL_PATHS.has(url.pathname)) return;

  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return caches.match(request);
  }
}
