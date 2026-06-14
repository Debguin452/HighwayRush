'use strict';

const VERSION_URL = './version.json';
const CACHE_PREFIX = 'hr-';
let CACHE_NAME = 'hr-v1';

const STATIC = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './version.json',
  './favicon.ico',
  './apple-touch-icon.png',
  './images/car.png',
  './images/road.png',
  './images/traffic.png',
  './images/traffic2.png',
  './images/traffic3.png',
  './images/traffic4.png',
  './images/icon-192.png',
  './images/icon-512.png',
  './sounds/crash.mp3',
  './sounds/drive.mp3',
];

const NET_ONLY_HOSTS = [
  'storegit.pages.dev',
  'api.ipify.org',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

async function getRemoteVersion() {
  try {
    const r = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
    const d = await r.json();
    return d.build || d.v || '1';
  } catch { return null; }
}

self.addEventListener('install', e => {
  e.waitUntil(
    getRemoteVersion().then(v => {
      if (v) CACHE_NAME = CACHE_PREFIX + v;
      return caches.open(CACHE_NAME)
        .then(c => c.addAll(STATIC))
        .then(() => self.skipWaiting());
    })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (NET_ONLY_HOSTS.includes(url.hostname)) {
    e.respondWith(fetch(e.request).catch(() =>
      new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } })
    ));
    return;
  }

  if (url.pathname.endsWith('version.json')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        fetch(e.request).then(fresh => {
          if (fresh && fresh.status === 200)
            caches.open(CACHE_NAME).then(c => c.put(e.request, fresh));
        }).catch(() => {});
        return cached;
      }
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        if (e.request.destination === 'document')
          return caches.match('./index.html');
      });
    })
  );
});

self.addEventListener('message', e => {
  if (e.data === 'CHECK_UPDATE') {
    getRemoteVersion().then(v => {
      const newCache = v ? CACHE_PREFIX + v : CACHE_NAME;
      if (newCache !== CACHE_NAME) {
        self.clients.matchAll().then(clients =>
          clients.forEach(c => c.postMessage({ type: 'UPDATE_AVAILABLE' }))
        );
      }
    });
  }
});
