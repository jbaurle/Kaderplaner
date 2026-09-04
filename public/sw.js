/*
 * Ein Service Worker, der die App-Daten in Ruhe lässt und nur Bilder hält.
 *
 * Warum er da ist: Chrome auf Android bietet die echte Installation (eigenes
 * Symbol, Start ohne Adressleiste) nur an, wenn die Seite einen Service
 * Worker mit `fetch`-Behandlung hat. Ohne ihn bleibt es bei einer
 * Verknüpfung, die im Browserfenster startet.
 *
 * Kein Cache für die Kickbase-API ist Absicht: die App lebt von ihr, offline
 * hätte sie nichts zu zeigen, und was nichts ablegt, liefert auch nichts
 * Veraltetes aus. Der Preis: Chrome sieht die Seite als nicht offline-fähig
 * und meldet das in den Entwicklerwerkzeugen als Hinweis.
 *
 * Bilder vom CDN (Freisteller, Wappen, Profilbilder) sind anders: sie ändern
 * sich praktisch nie, Kickbase setzt selbst 30 Tage Cache. Der HTTP-Cache
 * hielte sie auch, aber iOS räumt ihn bei einer installierten App früh weg,
 * und dann lädt jede Aufstellung ihre elf Freisteller neu. Deshalb liegen sie
 * hier in der Cache Storage, cache-first.
 *
 * Die Antworten sind opak (kein CORS am CDN), ihr Status ist nicht lesbar:
 * auch ein 403 für einen fehlenden Freisteller landet im Cache. Damit ein
 * nachgereichtes Bild nicht 30 Tage unsichtbar bleibt, gibt es je Woche einen
 * neuen Cache, die alten fallen weg.
 *
 * `skipWaiting` und `clients.claim`: eine neue Fassung übernimmt sofort,
 * statt auf das Schließen aller Fenster zu warten.
 */

const IMAGE_HOST = 'kickbase.b-cdn.net';
const CACHE_PREFIX = 'kb-images-';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function currentCacheName() {
  return CACHE_PREFIX + Math.floor(Date.now() / WEEK_MS);
}

async function dropOldCaches() {
  const keep = currentCacheName();
  for (const name of await caches.keys()) {
    if (name.startsWith(CACHE_PREFIX) && name !== keep) await caches.delete(name);
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([self.clients.claim(), dropOldCaches()]));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Alles andere geht ohne Umweg ins Netz, wie ohne Service Worker.
  if (request.method !== 'GET' || request.destination !== 'image') return;
  if (new URL(request.url).host !== IMAGE_HOST) return;
  event.respondWith(imageResponse(event));
});

let sweptThisRun = false;

async function imageResponse(event) {
  const cache = await caches.open(currentCacheName());
  const cached = await cache.match(event.request);
  if (cached) return cached;

  const response = await fetch(event.request);
  // Opak oder in Ordnung: ablegen. Ein echter Netzwerkfehler wirft vorher und
  // landet als Fehler am `<img>`, das den Wappen-Fallback kennt.
  if (response.type === 'opaque' || response.ok) {
    event.waitUntil(cache.put(event.request, response.clone()));
  }
  if (!sweptThisRun) {
    sweptThisRun = true;
    event.waitUntil(dropOldCaches());
  }
  return response;
}
