/**
 * Service Worker — Sri Rejeki
 * https://sri-rejeki-roti.github.io/srirejeki/
 * v6 — fix layout/zoom index.html (viewport lock + form font-size 16px)
 * v7 — tambah push notification (stok menipis/habis)
 * v8 — bump cache: kasir.html (gate password + fix sync/keyboard/HPP),
 *      payroll.html (unifikasi topbar/radius), index.html (session flag
 *      login kasir) berubah; tambah absen-scan.html & qr-generator.html
 *      ke pre-cache.
 */

const CACHE_NAME = 'sri-rejeki-v1.1.0';
const SUPABASE_ORIGIN = 'supabase.co';
const CDN_ORIGINS = ['cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

// ─── INSTALL: pre-cache semua HTML lokal ─────────────────────
self.addEventListener('install', event => {
  const base = self.location.pathname.replace('sw.js', '');
  const urls = [
    base + 'index.html',
    base + 'kasir.html',
    base + 'master.html',
    base + 'owner.html',
    base + 'payroll.html',
    base + 'absen-scan.html',
    base + 'qr-generator.html',
    base + 'manifest.json',
    base + 'icon-192.png',
    base + 'icon-512.png',
  ];
  console.log('[SW] Pre-caching:', urls);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(urls.map(u => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE: hapus cache lama ──────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[SW] Hapus cache lama:', k);
        return caches.delete(k);
      })))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Supabase → bypass, selalu dari network
  if (url.hostname.includes(SUPABASE_ORIGIN)) return;

  // CDN (JS libs, fonts) → Cache First
  if (CDN_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // File lokal → Network First, fallback cache
  event.respondWith(networkFirst(event.request));
});

// Cache First: cek cache dulu → jika miss, fetch & simpan
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('/* offline */', { headers: { 'Content-Type': 'application/javascript' } });
  }
}

// Network First: fetch dulu → jika gagal, cek cache
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline — koneksi tidak tersedia', { status: 503 });
  }
}

// ─── PUSH NOTIFICATION — Stok Menipis/Habis ──────────────────
// Terima push dari server (dikirim oleh Edge Function send-stock-alert)
self.addEventListener('push', (event) => {
  let data = { title: 'Notifikasi', body: '' };
  try { data = event.data ? event.data.json() : data; } catch (e) { /* ignore */ }

  const options = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: data.tag || 'stok-alert',
    data: { url: data.url || './owner.html' },
    vibrate: [120, 60, 120],
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Notifikasi', options));
});

// Saat notifikasi di-tap: fokus ke tab owner.html yang sudah terbuka,
// atau buka tab baru kalau belum ada yang terbuka
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './owner.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('owner.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// Kalau browser rotate push subscription secara otomatis (jarang terjadi,
// tapi bisa muncul), re-subscribe dan simpan ulang ke Supabase supaya
// device tidak "tuli" diam-diam
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true })
      .then((newSub) => {
        return self.clients.matchAll().then((clientList) => {
          clientList.forEach((client) => {
            client.postMessage({ type: 'PUSH_SUBSCRIPTION_RENEWED', subscription: newSub.toJSON() });
          });
        });
      })
  );
});
