const cacheName="guc-fieldbook-v2";
self.addEventListener("install",event=>event.waitUntil((async()=>{
  const cache=await caches.open(cacheName);
  const request=await fetch("assets/places.json");
  if(!request.ok) throw Error("missing place index");
  const places=await request.json();
  const assets=["./","index.html","app.js","github-sync.js","style.css","jszip.min.js","app.webmanifest","assets/icons.svg",
    "assets/touch.png","assets/campus.webp","assets/places.json",...new Set(places.map(p=>p.image))];
  await cache.addAll(assets);
  await self.skipWaiting();
})()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
  for(const name of await caches.keys()) if(name.startsWith("guc-fieldbook-") && name!==cacheName) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET" || new URL(event.request.url).origin!==self.location.origin) return;
  event.respondWith((async()=>{
    const cache=await caches.open(cacheName);
    if(event.request.mode==="navigate") {
      try{return await fetch(event.request);}catch{return await cache.match("./") || Response.error();}
    }
    return await cache.match(event.request) || fetch(event.request);
  })());
});
