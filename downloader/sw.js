/* sw.js — offline app shell for the panel.
   · navigation    → network first, cache fallback (works offline)
   · same-origin   → stale-while-revalidate
   · other origins → never touched (backend API calls must stay live)      */

const VERSION = '1.0.1';
const CACHE = `dlbot-panel-v${VERSION}`;

const SHELL = [
  '',
  'index.html',
  'favicon.svg',
  'manifest.webmanifest',
  'assets/css/app.css',
  'assets/img/logo.svg',
  'assets/img/logo.png',
  'assets/img/hero.svg',
  'assets/img/architecture.svg',
  'assets/js/app.js',
  'assets/js/i18n.js',
  'assets/js/store.js',
  'assets/js/engine.js',
  'assets/js/sites.js',
  'assets/js/sim.js',
  'assets/js/net.js',
  'assets/js/api.js',
  'assets/js/jobs.js',
  'assets/js/logs.js',
  'assets/js/format.js',
  'assets/js/charts.js',
  'assets/js/exporters.js',
  'assets/js/ui/dom.js',
  'assets/js/ui/overlays.js',
  'assets/js/ui/shell.js',
  'assets/js/ui/views/index.js',
  'assets/js/ui/views/dashboard.js',
  'assets/js/ui/views/queue.js',
  'assets/js/ui/views/logs.js',
  'assets/js/ui/views/settings.js',
  'assets/js/ui/views/sites.js',
  'assets/js/ui/views/telegram.js',
  'assets/js/ui/views/help.js',
];

const base = new URL('./', self.registration?.scope || self.location.href).href;
const shellUrls = SHELL.map((p) => base + p);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(shellUrls.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never proxy the backend

  // SPA navigation
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(base + 'index.html', fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(base + 'index.html');
        return cached || new Response('<h1>offline</h1>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // stale-while-revalidate for assets
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: false });
    const network = fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await network) || new Response('', { status: 504 });
  })());
});
