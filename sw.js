/* =====================================================================
   CON ATTENDANCE — SERVICE WORKER
   Makes the site installable and usable offline.

   Strategies:
   • Precache the full app shell (pages, css, js, icons, CDN libs) so the
     app opens instantly, even with no network.
   • Navigations: network-first, falling back to the cached page.
   • Static assets (same-origin + known CDNs): stale-while-revalidate.
   • Firestore / Firebase backend traffic: NEVER cached — always live.
   Bump VERSION whenever you ship changes to force a cache refresh.
   ===================================================================== */

const VERSION = 'v1.9.0';
const CACHE_NAME = `con-attendance-${VERSION}`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './register.html',
  './scanner.html',
  './css/style.css',
  './js/firebase-config.js',
  './js/app-shell.js',
  './js/admin.js',
  './js/register.js',
  './js/scanner.js',
  './manifest.webmanifest',
  './images/favicon.png',
  './images/icon-96.png',
  './images/icon-192.png',
  './images/icon-512.png',
  './images/maskable-512.png',
  /* CDN libraries */
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Sora:wght@400;700;800&family=Inter:wght@400;600;900&display=swap',
  /* Firebase SDK modules */
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
];

/* Hosts whose static files we're happy to serve from cache */
const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

/* Live-backend hosts we must NEVER intercept */
const isLiveBackend = (url) =>
  url.hostname.endsWith('googleapis.com') ||
  url.hostname.endsWith('firebaseio.com');

/* ---------------- install: precache the shell ---------------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // add each independently — one bad URL must not break the whole install
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        console.warn('[SW] precache miss:', url);
      }
    }));
    self.skipWaiting();
  })());
});

/* ---------------- activate: clean old versions ---------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('con-attendance-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ---------------- fetch strategies ---------------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Live backend data (Firestore etc.) — always the network, never the SW.
  if (isLiveBackend(url)) return;

  // Page navigations: network-first with offline fallback to cache.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        putInCache(request, fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await caches.match(request);
        return cached || caches.match('./index.html');
      }
    })());
    return;
  }

  // Everything else from our origin or trusted CDNs: stale-while-revalidate.
  if (url.origin === self.location.origin ||
      CDN_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request).then(response => {
    if (response && (response.ok || response.type === 'opaque')) {
      putInCache(request, response.clone());
    }
    return response;
  }).catch(() => undefined);
  return cached || (await network) || Response.error();
}

function putInCache(request, response) {
  if (!response || !response.url || !response.url.startsWith('http')) return;
  caches.open(CACHE_NAME).then(cache => cache.put(request, response)).catch(() => {});
}
