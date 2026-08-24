/*
 * Ein Service Worker, der nichts tut: jede Anfrage geht ohne Umweg ins Netz,
 * nichts wird zwischengespeichert.
 *
 * Warum er trotzdem da ist: Chrome auf Android bietet die echte Installation
 * (eigenes Symbol, Start ohne Adressleiste) nur an, wenn die Seite einen
 * Service Worker mit `fetch`-Behandlung hat. Ohne ihn bleibt es bei einer
 * Verknüpfung, die im Browserfenster startet.
 *
 * Kein Cache ist hier Absicht. Die App lebt von der Kickbase-API, offline
 * hätte sie nichts zu zeigen, und was nichts ablegt, liefert auch nichts
 * Veraltetes aus. Der Preis: Chrome sieht die Seite als nicht offline-fähig
 * und meldet das in den Entwicklerwerkzeugen als Hinweis.
 *
 * `skipWaiting` und `clients.claim`: eine neue Fassung übernimmt sofort,
 * statt auf das Schließen aller Fenster zu warten. Bei einem Durchreicher ist
 * daran nichts riskant.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Kein respondWith: der Browser holt die Antwort wie ohne Service Worker.
});
