/**
 * Minimal Sahay service worker: displays web-push notifications and opens the
 * deep link on click. Payloads are JSON: { title, body, deepLink }.
 * Registered from Settings → notifications; no offline caching here.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON payload — show a vague notification */
  }
  const title = data.title || 'Sahay';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      data: { deepLink: data.deepLink || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const deepLink = (event.notification.data && event.notification.data.deepLink) || '/';
  const url = new URL(deepLink, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      const existing = clients.find((c) => 'navigate' in c && 'focus' in c);
      if (existing) return existing.navigate(url).then((c) => (c ? c.focus() : undefined));
      return self.clients.openWindow(url);
    }),
  );
});
