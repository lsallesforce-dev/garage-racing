/**
 * SERVICE WORKER do painel AutoZap — o mínimo pra o navegador oferecer
 * "Instalar app" (mesmo desenho do Tem Prêmio).
 *
 * Deliberadamente NÃO cacheia nada além dos ícones: painel, API, conversas e
 * estoque vão sempre direto pra rede. Lead e estoque velho na tela seria pior
 * que tela nenhuma — isto não é um app offline.
 */

const CACHE_NAME = "autozap-static-v1";
const STATIC_ASSETS = ["/app/icon-192.png", "/app/icon-512.png", "/app/apple-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !STATIC_ASSETS.includes(url.pathname)) return;
  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
});
