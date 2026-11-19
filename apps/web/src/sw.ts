/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { notificationPayloadSchema, notificationText, safeOrderTarget } from '@office-service/shared';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
  allowlist: [/^\/(?:orders|work|profile|users|menu)?(?:\?.*)?$/],
}));
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let value: unknown;
    try { value = event.data?.json(); } catch { return; }
    const parsed = notificationPayloadSchema.safeParse(value);
    if (!parsed.success) return;
    const payload = parsed.data;
    const text = notificationText(payload);
    await self.registration.showNotification(text.title, {
      body: text.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
      lang: payload.language, tag: payload.target, data: { target: payload.target },
    });
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const value: unknown = event.notification.data;
  if (!value || typeof value !== 'object' || !('target' in value) || typeof value.target !== 'string') return;
  const target = safeOrderTarget(value.target);
  if (!target) return;
  const url = new URL(target, self.location.origin);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      const navigated = await existing.navigate(url.href);
      if (navigated) await navigated.focus();
    } else await self.clients.openWindow(url.href);
  })());
});
