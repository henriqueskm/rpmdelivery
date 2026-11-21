// Service worker for the customer's tracking page (/acompanhar/<token>), registered with that scope.
// It only shows the notifications the server sends (web push) and opens the order when one is tapped.
// Nothing is cached: the page always loads from the network.

const ORDER_PATH = /^\/acompanhar\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const text = (value, max, fallback) => (typeof value === "string" && value ? value.slice(0, max) : fallback);
  const url = typeof data.url === "string" && ORDER_PATH.test(data.url) ? data.url : null;
  event.waitUntil(self.registration.showNotification(text(data.title, 80, "Seu pedido"), {
    body: text(data.body, 200, ""),
    icon: "/courier/notify-192.png",
    badge: "/courier/badge-96.png",
    // One notification per order: each new one replaces the last and still rings.
    tag: text(data.tag, 60, "rpm-pedido"),
    renotify: true,
    vibrate: [120, 60, 120],
    lang: "pt-BR",
    data: { url },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (!url) return;
  event.waitUntil((async () => {
    const target = new URL(url, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find(client => client.url === target);
    if (open) return open.focus();
    return self.clients.openWindow(target);
  })());
});
