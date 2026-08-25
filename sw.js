"use strict";

// Development kill switch: GitHub Pages is still changing quickly, so stale
// offline caches are more dangerous than useful. Retire any existing Scratch
// Practice service worker and remove its caches without navigating clients:
// a forced navigation can replace an already-correct UI with a stale shell.
self.addEventListener("install",event=>{
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(
      keys
        .filter(key=>key.startsWith("scratch-practice-"))
        .map(key=>caches.delete(key))
    );

    await self.registration.unregister();

  })());
});

// Intentionally no fetch handler: every request goes directly to the network.
