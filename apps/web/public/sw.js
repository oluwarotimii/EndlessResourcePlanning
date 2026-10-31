// App-shell cache so the till opens offline. API calls are never cached here:
// data offline lives in IndexedDB (catalogue, parked sales, queue).
const CACHE = "erp-shell-v2";

async function precache() {
  const urls = new Set(["/", "/manifest.webmanifest", "/icon.svg"]);
  try {
    // Every built file (including lazy screen chunks), listed by the build.
    const manifest = await (await fetch("/asset-manifest.json", { cache: "no-store" })).json();
    for (const entry of Object.values(manifest)) {
      urls.add("/" + entry.file);
      (entry.css || []).forEach((c) => urls.add("/" + c));
    }
  } catch { /* dev server has no manifest: runtime caching still applies */ }
  const cache = await caches.open(CACHE);
  await Promise.all([...urls].map((u) => cache.add(u).catch(() => undefined)));
}

self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(precache()); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); return r; }).catch(() => caches.match("/")));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; })));
});
