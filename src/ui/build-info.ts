/**
 * Build-Stempel für die Fusszeile: welcher Commit steckt drin und wann
 * wurde er gebaut. Beantwortet die Frage "sehe ich gerade den neuen Stand?",
 * ohne den Bundle-Hash im Seitenquelltext nachschlagen zu müssen.
 *
 * Beide Werte setzt `vite.config.ts` zur Buildzeit per `define`. Fehlen sie
 * (fremder Bundler, direkt eingebundene Module), fällt das Label auf "dev"
 * zurück statt zu werfen.
 */

declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;

export function buildLabel(): string {
  const commit = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'dev';
  const time = formatBuildTime(typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '');
  return time ? `Build ${commit} · ${time}` : `Build ${commit}`;
}

function formatBuildTime(iso: string): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const date = dt.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const clock = dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${clock}`;
}
