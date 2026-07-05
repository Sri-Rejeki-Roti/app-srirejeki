/**
 * Service Worker — Sri Rejeki
 * https://sri-rejeki-roti.github.io/srirejeki/
 * v6  — fix layout/zoom index.html (viewport lock + form font-size 16px)
 * v7  — tambah push notification (stok menipis/habis)
 * v8  — fix: fetch file lokal (html/js) pakai cache:'no-store' supaya
 *       Network First benar-benar selalu ambil versi terbaru dari server,
 *       tidak diam-diam disajikan dari cache HTTP browser/CDN yang basi.
 *       Naikkan APP_VERSION tiap ganti sw.js supaya cache lama di HP
 *       langsung dibersihkan (lihat listener 'activate').
 * v9  — tambah notifikasi "update tersedia" ke halaman (postMessage saat
 *       activate).
 * v10 — PERBAIKAN BESAR sistem update PWA:
 *       - skipWaiting() TIDAK lagi otomatis dipanggil saat install.
 *         SW baru sengaja "menunggu" (state: waiting) sampai user
 *         menekan tombol "Update Sekarang" di popup pada halaman.
 *         Popup mengirim pesan {type:'SKIP_WAITING'} ke SW yang masih
 *         waiting → baru SW itu memanggil self.skipWaiting().
 *       - Ini mencegah PWA yang sudah ter-install "diam-diam" pindah
 *         versi di tengah pemakaian (misalnya lagi transaksi di kasir),
 *         tapi tetap menjamin begitu user klik update, versi terbaru
 *         langsung aktif tanpa perlu uninstall/clear cache.
 *       - Versioning disederhanakan lewat konstanta APP_VERSION di
 *         bawah ini — cukup ganti angka ini tiap deploy, CACHE_NAME
 *         otomatis ikut berubah dan cache lama otomatis terhapus saat
 *         'activate'.
 *       - Lihat juga cuplikan client-side yang menyertai file ini
 *         (dipasang di index.html, kasir.html, master.html, owner.html,
 *         payroll.html) untuk logic registrasi + popup update.
 */

// ─── VERSI APLIKASI — GANTI INI SETIAP DEPLOY VERSI BARU ─────
// Cukup naikkan angka ini. CACHE_NAME akan otomatis berubah, sehingga
// browser menganggap ini Service Worker "baru" dan seluruh cache lama
// (CACHE_NAME versi sebelumnya) otomatis dihapus di event 'activate'.
const APP_VERSION = '1.0.4';
const CACHE_NAME = `sri-rejeki-v${APP_VERSION}`;

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
    base + 'manifest.json',
    base + 'version.json',
    base + 'icon-192.png',
    base + 'icon-512.png',
  ];
  console.log('[SW] Pre-caching:', urls, '— versi', APP_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(urls.map(u =>
        // cache:'no-store' supaya pre-cache awal ini juga ambil versi
        // paling baru dari server, bukan ikut cache HTTP yang basi.
        fetch(u, { cache: 'no-store' }).then(res => {
          if (res.ok) return cache.put(u, res);
        })
      )))
    // CATATAN: self.skipWaiting() SENGAJA TIDAK dipanggil di sini.
    // SW baru akan berhenti di state "installed/waiting" sampai
    // halaman mengirim pesan {type:'SKIP_WAITING'} — lihat listener
    // 'message' di bawah. Itu terjadi saat user menekan tombol
    // "Update Sekarang" pada popup. Dengan begitu update tidak
    // memutus proses yang sedang berjalan di tab yang sudah terbuka.
  );
});

// ─── MESSAGE: terima perintah dari halaman untuk aktifkan SW baru ──
// Dikirim oleh popup "Update Sekarang" (lihat script registrasi SW di
// index.html/kasir.html/master.html/owner.html/payroll.html).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clientList => {
        // Beritahu semua tab yang sedang terbuka bahwa SW baru sudah aktif.
        // Tab-tab ini MASIH menjalankan JS versi lama (SW baru cuma
        // mengontrol fetch berikutnya, bukan me-reload halaman), jadi
        // halaman perlu menawarkan reload ke user sendiri.
        clientList.forEach(client => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
        });
      })
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
// PENTING: cache:'no-store' supaya request ini benar-benar tembus ke
// server tiap kali (skip cache HTTP browser/CDN), bukan cuma tembus
// layer Cache Storage milik Service Worker ini saja. Tanpa ini, file
// seperti config.js/owner.html bisa diam-diam disajikan dari cache
// HTTP yang basi walau kode di sini sudah "coba network dulu".
async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
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
