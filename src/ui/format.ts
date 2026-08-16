/**
 * Locale-aware formatting + small string-safety helpers used by every view.
 */

const EUR_FULL = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const EUR_COMPACT = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 2,
});

const RELATIVE_TIME = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });

/** "2.882.734 €" */
export function formatEur(value: number): string {
  return EUR_FULL.format(value);
}

/** "21,72 Mio. €" — for tight mobile layouts. */
export function formatEurCompact(value: number): string {
  return EUR_COMPACT.format(value);
}

const MIO = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * "21,72" — Millionen ohne Einheit, für schmale Spalten. Die Einheit steht
 * einmal in der Legende unter der Tabelle statt in jeder Zelle.
 */
export function formatMio(value: number): string {
  return MIO.format(value / 1_000_000);
}

/** "+21,72" / "-2,33" — wie `formatMio`, mit Vorzeichen. */
export function formatSignedMio(value: number): string {
  return value > 0 ? '+' + formatMio(value) : formatMio(value);
}

/** "+774.771 €" / "−2.330.388 €". Negative values already carry a minus from `Intl`. */
export function formatSignedEur(value: number, compact = false): string {
  const formatter = compact ? formatEurCompact : formatEur;
  if (value > 0) return '+' + formatter(value);
  return formatter(value);
}

/** "vor 2 Stunden", "gestern", "vor 5 Minuten" — for snapshot age display. */
export function formatRelativeTime(timestamp: number): string {
  const diffMs = timestamp - Date.now();
  const seconds = Math.round(diffMs / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return RELATIVE_TIME.format(seconds, 'second');
  if (abs < 3600) return RELATIVE_TIME.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return RELATIVE_TIME.format(Math.round(seconds / 3600), 'hour');
  return RELATIVE_TIME.format(Math.round(seconds / 86400), 'day');
}

/**
 * Vereinswappen zur Team-Id, rund 4 kB als PNG. Kickbase liefert die Bilder
 * ohne Token vom eigenen CDN und setzt 30 Tage Cache; ein `<img>` braucht dafür
 * keine CORS-Header. Fehlt ein Wappen, antwortet das CDN mit 403 und der
 * Browser zeigt nichts an, was hier genau richtig ist.
 */
export function teamLogoUrl(teamId: string): string {
  return `https://kickbase.b-cdn.net/pool/teams/${encodeURIComponent(teamId)}.png`;
}

/**
 * Freisteller des Spielers, transparentes PNG, 1100x800 und 120 bis 180 kB.
 * Verkleinern lässt es sich nicht: das CDN ignoriert Größenparameter, und
 * ohne CORS-Header kann auch der Browser das Bild nicht selbst umrechnen.
 * Ein Bild von der Größe belegt dekodiert rund 3,5 MB. Deshalb nur für die
 * elf auf dem Feld, nicht für jede Liste.
 *
 * Nicht jeder Spieler hat eins, das CDN antwortet dann mit 403. Der Aufrufer
 * fängt das ab und zeigt stattdessen das Vereinswappen.
 */
export function playerPhotoUrl(playerId: string): string {
  return `https://kickbase.b-cdn.net/pool/playersbig/${encodeURIComponent(playerId)}.png`;
}

/**
 * Bild aus dem Feld `pim` des Squad-Response, etwa
 * `content/file/<hash>.png`. Das ist der verlässliche Weg: den Pfad über die
 * Spieler-Id gibt es nicht für jeden, Neuzugänge fehlen dort.
 */
export function playerImageUrl(imagePath: string): string {
  return `https://kickbase.b-cdn.net/${imagePath.replace(/^\/+/, '')}`;
}

/** XSS-safe escape for use inside `innerHTML` template literals. */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
