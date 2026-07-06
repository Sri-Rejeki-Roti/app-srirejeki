// Service Worker untuk notifikasi push "Stok Menipis"
// Taruh file ini di ROOT aplikasi, sejajar dengan kasir.html
// (misal: https://sri-rejeki-roti.github.io/app-srirejeki/sw.js)

// Auto-update: begitu ada versi baru sw.js, langsung aktif tanpa perlu clear cache manual
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Notifikasi', body: 'Ada pembaruan stok.' };
  try {
    data = event.data.json();
  } catch (e) {
    // fallback kalau payload bukan JSON
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Stok Menipis', {
      body: data.body || '',
      icon: data.icon || undefined,
      badge: data.badge || undefined
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
