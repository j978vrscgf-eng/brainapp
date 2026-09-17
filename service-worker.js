const CACHE_NAME = "brainapp-20260917-112557";

// Rdzen aplikacji: zawsze najpierw siec, zeby nowa wersja wchodzila od razu.
// Cache jest tylko zapasem na tryb offline.
const CORE = ["", "index.html", "app.js", "style.css", "content.json", "manifest.json"];

const ASSETS = [
  "./",
  "index.html",
  "app.js",
  "style.css",
  "content.json",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-180.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
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

function isCore(url) {
  if (url.origin !== self.location.origin) return false;
  return CORE.includes(url.pathname.replace(/^.*\//, ""));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  if (req.mode === "navigate" || isCore(new URL(req.url))) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return resp;
      });
    })
  );
});
