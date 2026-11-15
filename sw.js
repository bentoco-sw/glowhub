/**
 * Service Worker — Cache Isolado de Assets Neutros (CTR-PWA-AUTH-WALL-01)
 * - Network Only para script.google.com e oauth2.googleapis.com
 * - Cache First para assets estáticos para operação offline em eventos
 */
const CACHE_NAME = "bento-glow-pdv-shell-v1.5.2";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./data/seed-data.js",
  "./data/migrated-sales.js",
  "./js/domain.js",
  "./js/storage.js",
  "./js/app.js",
  "./js/auth-guard.js",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/bento-logo-bege.png",
  "./assets/bento-logo-verde.png",
  "./assets/glowhub-logo.png",
  "./assets/GlowHub-Oficial.png",
  "./assets/bentoclub-logo.png",
  "./assets/davines-logo.png",
  "./assets/keune-logo.png",
  "./assets/kerastase-logo.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // ROTAS DE API E AUTENTICAÇÃO: NUNCA USAR CACHE (Network Only)
  if (
    url.pathname.indexOf("/api/") === 0 ||
    url.origin.includes("script.google.com") ||
    url.origin.includes("oauth2.googleapis.com") ||
    url.origin.includes("accounts.google.com")
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.method !== "GET") {
    return;
  }

  // ASSETS ESTÁTICOS: Cache First com fallback offline para navegação SPA/PWA
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).catch(() => {
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
        return undefined;
      });
    })
  );
});
