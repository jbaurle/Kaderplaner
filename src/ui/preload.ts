/**
 * Bilder vorladen, bevor jemand sie sehen will.
 *
 * Die Freisteller sind 1100 auf 800 Pixel und rund 200 kB; elf davon beim
 * Öffnen der Aufstellung zu holen, dauert am Handy einen sichtbaren Moment.
 * Steht der Kader, liegt die Zeit bis zum Öffnen brach: also jetzt holen.
 *
 * Die Elemente bleiben hier referenziert, damit der Browser die Bilder im
 * Speicher behält statt sie nur im HTTP-Cache abzulegen. Begrenzt, weil ein
 * dekodierter Freisteller rund 3,5 MB belegt.
 */

const MAX_HELD = 40;

const held = new Map<string, HTMLImageElement>();

export function preloadImages(urls: readonly string[]): void {
  for (const url of urls) {
    if (!url || held.has(url)) continue;
    const img = new Image();
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.src = url;
    // Gleich dekodieren, nicht erst beim Zeichnen: das Laden ist am Handy
    // schnell vorbei, das Dekodieren von elf 1100x800-PNGs ist der Moment,
    // in dem die Kreise leer bleiben.
    if (typeof img.decode === 'function') img.decode().catch(() => {});
    held.set(url, img);
    if (held.size > MAX_HELD) {
      const oldest = held.keys().next().value;
      if (oldest !== undefined) held.delete(oldest);
    }
  }
}

/** Nur für Tests: was gerade gehalten wird. */
export function preloadedUrls(): string[] {
  return [...held.keys()];
}
