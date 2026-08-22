/* Service worker — Nosso Casamento
   Estratégia: cache-first para o app shell, com atualização em segundo plano. */

const CACHE = "nosso-casamento-v12";

const SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // um arquivo indisponível não pode impedir o app de funcionar offline
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // a API de sincronização nunca passa pelo cache
  if (url.pathname.endsWith("/api")) return;

  // fontes do Google: cache-first com preenchimento dinâmico
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((resp) => {
            const clone = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
            return resp;
          })
      )
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // app shell: cache-first, atualizando o cache em segundo plano
  event.respondWith(
    caches.match(request).then((hit) => {
      const rede = fetch(request)
        .then((resp) => {
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return resp;
        })
        .catch(() => hit);
      return hit || rede;
    })
  );
});
