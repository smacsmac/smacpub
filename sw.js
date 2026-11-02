/* Service worker : met l'application en cache pour qu'elle fonctionne sans connexion.
   Stratégie : réponse immédiate depuis le cache, mise à jour discrète en arrière-plan.
   L'appli s'ouvre donc tout de suite, même quand le PC qui la sert ne répond pas. */
const CACHE = "smacpub-v15";
const ASSETS = [
  "./",
  "index.html",
  "css/app.css",
  "js/fonts.js",
  "js/zip.js",
  "js/epub.js",
  "js/comic.js",
  "js/unrar.js",
  "js/db.js",
  "js/sync.js",
  "js/reader.js",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
];

/* CE QUI NE DOIT JAMAIS ÊTRE GARDÉ, et c'est la règle la plus importante de
   ce fichier depuis que l'appli a un serveur.

   Le catalogue et les réglages, parce qu'une réponse d'hier serait un
   mensonge : c'est précisément ce que la synchro va chercher. Servie du
   cache, elle fusionnerait avec un état périmé, puis le réécrirait sur le PC.

   Les livres et les couvertures, parce qu'un seul CBZ pèse plus que toute
   l'application : les ranger ici, ce serait garder chaque livre DEUX fois sur
   l'appareil — une dans la bibliothèque, une dans le cache du navigateur.
   noter a appris cette leçon avec son coffre, à ses dépens. */
const JAMAIS = /\/(donnees|health|reglages|passerelle)$|\/(livres|couvertures)(\/|$)/;

self.addEventListener("install", (event) => {
  /* Chacun pour soi, et surtout : on s'installe même s'il en manque un.
     `addAll` est tout ou rien — un seul raté, le Wi-Fi qui hoquette au mauvais
     moment, et l'ANCIEN service worker restait en place. */
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((u) =>
        fetch(u, { cache: "reload" })
          .then((r) => (r && r.ok ? c.put(u, r) : null))
          .catch(() => null))))
      .then(() => self.skipWaiting(), () => self.skipWaiting()),
  );
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
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== location.origin) return;
  if (JAMAIS.test(url.pathname)) return;        // c'est au serveur de répondre, pas à nous
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
