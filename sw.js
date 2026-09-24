/* Service worker : met l'application en cache pour qu'elle fonctionne sans connexion.
   Stratégie : réponse immédiate depuis le cache, mise à jour discrète en arrière-plan. */
const CACHE = "smacpub-v3";
const ASSETS = [
  "./",
  "index.html",
  "css/app.css",
  "js/fonts.js",
  "js/zip.js",
  "js/epub.js",
  "js/db.js",
  "js/reader.js",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return (await network) || (req.mode === "navigate" && (await cache.match("index.html"))) || Response.error();
    }),
  );
});
