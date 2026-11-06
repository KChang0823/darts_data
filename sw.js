/**
 * Home Darts Arcade Tracker — Offline-Capable Service Worker (v4)
 * - NetworkFirst for ALL same-origin GET requests so UI/CSS/JS updates appear immediately when online
 * - Falls back to CacheStorage only when offline
 */

const CACHE_NAME = "darts-tracker-v4";
const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css?v=4",
  "./js/bundle.js?v=4",
  "./assets/icon.svg",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // NetworkFirst for all same-origin assets so updates are never stuck in cache
  event.respondWith(
    fetch(request, { cache: "no-cache" })
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(request, { ignoreSearch: true })
          .then((cached) => cached || caches.match("./index.html"))
      )
  );
});
