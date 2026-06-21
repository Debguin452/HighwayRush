'use strict';

const VERSION_URL = './version.json';
const CACHE_PREFIX = 'hr-';

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

const NET_ONLY = [
  'storegit.pages.dev',
  'api.ipify.org',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

async function getBuildId() {
  try {
    const r = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json();
    return d.build || d.v || null;
  } catch { return null; }
}

async function getCacheName() {
  const id = await getBuildId();
  return id ? CACHE_PREFIX + id : CACHE_PREFIX + 'default';
}

self.addEventListener('install', e => {
  e.waitUntil(
    getCacheName().then(name =>
      caches.open(name)
        .then(c => c.addAll(STATIC))
        .then(() => self.skipWaiting())
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    getCacheName().then(currentName =>
      caches.keys()
        .then(keys => Promise.all(
          keys
            .filter(k => k.startsWith(CACHE_PREFIX) && k !== currentName)
            .map(k => caches.delete(k))
        ))
        .then(() => self.clients.claim())
    )
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (NET_ONLY.includes(url.hostname)) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response('{"error":"offline"}', {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  if (url.pathname.endsWith('version.json')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          getCacheName().then(name => {
            caches.open(name).then(c => c.put(e.request, res.clone()));
          });
        }
        return res;
      }).catch(() => {
        if (e.request.destination === 'document')
          return caches.match('./index.html');
      });
    })
  );
});
