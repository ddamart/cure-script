// Offline service worker. Workbox's precache downloads files one at a time
// (~5 min for this site), so this one downloads in parallel, resumes after an
// interruption and reports progress to open pages.
const CACHE = 'cure-offline';
const PARALLEL = 16;
const RETRIES = 3;

// Injected at build time: [{ url, revision }]. revision is null for hashed assets.
const keyFor = new Map(self.__WB_MANIFEST.map(({ url, revision }) => {
  const abs = new URL(url, self.registration.scope).href;
  return [abs, revision ? `${abs}?__rev=${revision}` : abs];
}));
const entries = [...keyFor].map(([url, key]) => ({ url, key }));

async function broadcast(msg) {
  for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage(msg);
}

async function download(cache, { url, key }) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await cache.put(key, res);
    } catch (err) {
      if (i >= RETRIES) throw err;
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Files already cached (by an earlier, interrupted install or an older
    // version with the same revision) are skipped: this makes installs resumable
    // and updates download only what changed.
    const have = new Set((await cache.keys()).map(r => r.url));
    const todo = entries.filter(e => !have.has(e.key));
    const total = entries.length;
    let done = total - todo.length;
    let lastSent = 0;
    await broadcast({ type: 'offline-progress', done, total });

    const queue = todo.slice();
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      while (queue.length) {
        await download(cache, queue.shift());
        done++;
        if (Date.now() - lastSent > 250 || done === total) {
          lastSent = Date.now();
          broadcast({ type: 'offline-progress', done, total });
        }
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Drop caches of the previous Workbox-based worker.
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    // Drop files that are no longer part of the site (old revisions, removed pages).
    const keep = new Set(keyFor.values());
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
    await self.clients.claim();
    await broadcast({ type: 'offline-ready' });
  })());
});

function lookup(url) {
  const u = new URL(url);
  u.search = u.hash = '';
  const path = u.href;
  if (path.endsWith('/')) return keyFor.get(path + 'index.html');
  return keyFor.get(path) || keyFor.get(path + '.html');
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  const key = lookup(req.url);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = key && await cache.match(key);
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      // Offline and not cached (e.g. Russian pages): show the site's 404 page.
      if (req.mode === 'navigate') {
        const notFound = await cache.match(keyFor.get(new URL('404.html', self.registration.scope).href));
        if (notFound) return notFound;
      }
      throw err;
    }
  })());
});

// The page asks for the current state when it opens.
self.addEventListener('message', async event => {
  if (event.data !== 'offline-status') return;
  const have = new Set((await (await caches.open(CACHE)).keys()).map(r => r.url));
  const done = entries.filter(e => have.has(e.key)).length;
  event.source.postMessage(self.registration.active === self && done === entries.length
    ? { type: 'offline-ready' }
    : { type: 'offline-progress', done, total: entries.length });
});
