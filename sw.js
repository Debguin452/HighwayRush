const CACHE='hr-v3';
const FILES=['.','index.html','style.css','script.js','manifest.json',
  'images/car.png','images/road.png','images/traffic.png','images/traffic2.png',
  'images/traffic3.png','images/traffic4.png','sounds/crash.mp3','sounds/drive.mp3'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
    if(res&&res.status===200&&res.type==='basic'){
      const clone=res.clone();
      caches.open(CACHE).then(c=>c.put(e.request,clone));
    }
    return res;
  })));
});
