/**
 * Ziehen zum Laden.
 *
 * Am oberen Ende der Seite nach unten wischen löst dasselbe aus wie der
 * Knopf "Laden". Wichtig ist das `preventDefault` während der Geste: ohne das
 * übernimmt Safari und lädt die ganze Seite neu, statt nur die Daten.
 * Deshalb hängen die Zuhörer nicht passiv am Dokument.
 *
 * Die Anzeige hängt am Dokument statt in der Seite, damit ein `render()`
 * mitten in der Geste sie nicht wegräumt.
 */

/** Ab hier löst das Loslassen aus. */
const SCHWELLE = 72;

/** Weiter als das lässt sich nicht ziehen, sonst wird das Gummiband endlos. */
const MAX_ZUG = 110;

export interface PullToRefreshOptions {
  /** Wird beim Loslassen jenseits der Schwelle aufgerufen. */
  onRefresh: () => void;
  /** Solange true, bleibt die Geste wirkungslos (es läuft schon etwas). */
  isBusy: () => boolean;
}

export function mountPullToRefresh(options: PullToRefreshOptions): void {
  // Kein Zeigergerät, keine Geste: am Desktop gibt es den Knopf.
  if (!window.matchMedia('(hover: none)').matches) return;

  const anzeige = document.createElement('div');
  anzeige.className = 'pull-hint';
  anzeige.setAttribute('aria-hidden', 'true');
  document.body.appendChild(anzeige);

  let startY: number | null = null;
  let zug = 0;

  const zeige = (text: string, offen: boolean): void => {
    anzeige.textContent = text;
    anzeige.classList.toggle('pull-hint--offen', offen);
    anzeige.style.transform = `translateY(${Math.min(zug, MAX_ZUG)}px)`;
  };

  const beenden = (): void => {
    startY = null;
    zug = 0;
    anzeige.classList.remove('pull-hint--offen');
    anzeige.style.transform = '';
  };

  document.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) return;
      // Nur ganz oben, sonst scrollt man ja bloss.
      if (window.scrollY > 0) return;
      startY = event.touches[0]?.clientY ?? null;
      zug = 0;
    },
    { passive: true },
  );

  document.addEventListener(
    'touchmove',
    (event) => {
      if (startY === null || options.isBusy()) return;
      const y = event.touches[0]?.clientY ?? 0;
      zug = y - startY;
      if (zug <= 0) {
        // Nach oben gewischt: normales Scrollen, Geste abgeben.
        beenden();
        return;
      }
      // Ab hier gehört die Geste uns, sonst lädt Safari die Seite neu.
      if (event.cancelable) event.preventDefault();
      zeige(zug >= SCHWELLE ? 'Loslassen zum Laden' : 'Zum Laden ziehen', zug >= SCHWELLE);
    },
    { passive: false },
  );

  document.addEventListener('touchend', () => {
    if (startY === null) return;
    const ausloesen = zug >= SCHWELLE && !options.isBusy();
    beenden();
    if (ausloesen) options.onRefresh();
  });

  document.addEventListener('touchcancel', beenden);
}
