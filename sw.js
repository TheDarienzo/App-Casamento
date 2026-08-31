/* Service worker — Nosso Casamento
   Estratégia: o "corpo" do app (página, estilos, script) vem SEMPRE da rede
   quando há internet, para abrir já na versão mais nova. O cache fica como
   reserva para funcionar offline. Ícones e fontes seguem vindo do cache. */

const VERSAO = "26";
const CACHE = "nosso-casamento-v" + VERSAO;

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

// página, estilos e script: precisam estar sempre atualizados
const ehCorpoDoApp = (url) =>
  url.pathname === "/" ||
  url.pathname.endsWith("/") ||
  /\/(index\.html|manifest\.webmanifest)$/.test(url.pathname) ||
  /\.(css|js)$/.test(url.pathname);

async function daRede(request) {
  try {
    return await fetch(request, { cache: "no-store" });
  } catch {
    // alguns navegadores recusam a opção acima em certos pedidos
    return await fetch(request);
  }
}

async function redePrimeiro(request) {
  try {
    const resposta = await daRede(request);
    if (resposta && resposta.ok) {
      const copia = resposta.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copia));
    }
    return resposta;
  } catch {
    const guardado = await caches.match(request);
    if (guardado) return guardado;
    if (request.mode === "navigate") {
      const inicio = await caches.match("./index.html");
      if (inicio) return inicio;
    }
    throw new Error("sem internet e sem cópia guardada");
  }
}

async function cachePrimeiro(request) {
  const guardado = await caches.match(request);
  if (guardado) return guardado;
  const resposta = await fetch(request);
  if (resposta && resposta.ok) {
    const copia = resposta.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copia));
  }
  return resposta;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // a API de sincronização nunca passa pelo cache
  if (url.pathname.endsWith("/api")) return;

  // fontes do Google: cache-first com preenchimento dinâmico
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cachePrimeiro(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(ehCorpoDoApp(url) ? redePrimeiro(request) : cachePrimeiro(request));
});
