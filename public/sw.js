// Хуягтан service worker (Phase 5: PWA + push).
// Хувийн мэдээлэлтэй хуудсыг КЭШЛЭХГҮЙ: зөвхөн статик файл (JS/CSS/icon) ба офлайн хуудас.
const CACHE = "ht-static-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icon-192.png"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  if (u.pathname.startsWith("/_next/static/") || /^\/(icon-|apple-touch)/.test(u.pathname)) {
    e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); }
      return res;
    })));
  } else if (r.mode === "navigate") {
    e.respondWith(fetch(r).catch(() => caches.match(OFFLINE)));
  }
});

self.addEventListener("push", (e) => {
  e.waitUntil(
    fetch("/api/push/pending", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .catch(() => ({ messages: [] }))
      .then(({ messages }) =>
        messages && messages.length
          ? Promise.all(messages.map((m) => self.registration.showNotification(m.title, { body: m.body, tag: "ht-" + m.id, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: m.url || "/" } })))
          : self.registration.showNotification("Хуягтан", { body: "Танд шинэ мэдэгдэл ирлээ", icon: "/icon-192.png", data: { url: "/me#schedule" } }),
      ),
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const raw = (e.notification.data && e.notification.data.url) || "/";
  const url = new URL(raw, self.location.origin);
  if (url.origin !== self.location.origin) return;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if ("focus" in w) { w.navigate(url.href); return w.focus(); }
    return self.clients.openWindow(url.href);
  }));
});
