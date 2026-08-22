/**
 * Die Startseite: links, was das Ding ist, rechts die Anmeldung auf einem
 * Bild der laufenden App.
 *
 * Die Bilder sind der Beleg für den Text daneben: die Kadertabelle als Bühne,
 * darauf der Spielerdialog und die Aufstellung als zwei aufgelegte Karten.
 * Wer hier landet, kennt Kickbase und will wissen, was dieses Werkzeug
 * anders macht, bevor er sein Passwort eintippt.
 *
 * Am Handy stehen dieselben Blöcke untereinander, die aufgelegten Karten
 * fallen weg. Jeder Umbruch hängt an der Breite der Seite, nicht am Gerät.
 *
 * Nach aussen zustandslos: der Aufrufer gibt `onSubmit` mit, das E-Mail und
 * Passwort bekommt und einen `KickbaseError` werfen darf. Solange die Anfrage
 * läuft, ist der Knopf gesperrt, bei einem Fehler geht er wieder auf.
 */

import { KickbaseError } from '../api/kickbase.js';
import { escapeHtml } from './format.js';

/** Repo hinter „Der Code liegt offen". Der Link trägt erst, wenn es öffentlich ist. */
const REPO_URL = 'https://github.com/jbaurle/Kaderplaner';

export interface LoginViewProps {
  prefilledEmail: string | null;
  /**
   * Grund für die Rückkehr hierher, etwa eine abgelaufene Sitzung. Steht im
   * Anmeldefeld anstelle der üblichen Zeile darunter und schaltet am Handy
   * gleich auf den Reiter mit dem Formular: wer eben noch drin war, braucht
   * keine Vorstellung der App mehr.
   */
  notice?: string | null;
  onSubmit: (email: string, password: string) => Promise<void>;
}

export function renderLogin(host: HTMLElement, props: LoginViewProps): void {
  const notice = props.notice ?? '';
  const startTab = notice ? 'login' : 'info';
  const tab = (target: string) => ({
    active: target === startTab ? ' is-active' : '',
    selected: String(target === startTab),
    index: target === startTab ? '0' : '-1',
  });
  const infoTab = tab('info');
  const loginTab = tab('login');

  host.innerHTML = `
    <main class="lp-page">
      <div class="lp-hero" data-tab="${startTab}">

        <header class="lp-head">
          <h1 class="lp-title">
            <img class="lp-mark" src="/favicon.svg" alt="" width="40" height="40">
            Kickbase Kaderplaner
          </h1>
        </header>

        <!--
          Nur am Handy sichtbar: dort ist neben dem Formular kein Platz für
          Bilder und Text, ab 720px zeigt die Bühne beides zugleich und die
          Reiter bleiben aus. "Was die App kann" steht zuerst und aktiv: wer
          neu hier ist, sieht erst den Beleg, bevor er sein Passwort eintippt.
          Kommt jemand mit einem Hinweis zurück, etwa nach abgelaufener
          Sitzung, steht stattdessen das Formular vorne.
        -->
        <div class="lp-tabs" role="tablist">
          <button type="button" class="lp-tab${infoTab.active}" role="tab" id="lp-tab-info"
                  aria-selected="${infoTab.selected}" aria-controls="lp-panel-info" data-tab-target="info" tabindex="${infoTab.index}">
            Was die App kann
          </button>
          <button type="button" class="lp-tab${loginTab.active}" role="tab" id="lp-tab-login"
                  aria-selected="${loginTab.selected}" aria-controls="login-form" data-tab-target="login" tabindex="${loginTab.index}">
            Anmelden
          </button>
        </div>

        <div class="lp-showcase">
          <form class="lp-panel" id="login-form" role="tabpanel" aria-labelledby="lp-tab-login" novalidate>
            <h2 class="lp-panel-title">Anmelden</h2>
            <p class="lp-panel-note"${notice ? ' role="status"' : ''}>${
              notice
                ? escapeHtml(notice)
                : 'Kostenlos, mit deinem Kickbase-Konto. Ein eigenes brauchst du hier nicht.'
            }</p>
            <label class="field">
              <span class="field-label">E-Mail</span>
              <input type="email" name="email" class="field-input" required autocomplete="username" autofocus
                     value="${escapeHtml(props.prefilledEmail ?? '')}">
            </label>
            <label class="field">
              <span class="field-label">Passwort</span>
              <input type="password" name="password" class="field-input" required autocomplete="current-password">
            </label>
            <button type="submit" class="lp-submit" id="login-submit">Anmelden</button>
            <p class="auth-error" id="login-error" role="alert"></p>
            <hr class="lp-rule">
            <ul class="auth-proof">
              <li>
                <span class="tick" aria-hidden="true">✓</span>
                <span>Dein Passwort geht direkt an Kickbase. Kein Server dazwischen, der mitliest.</span>
              </li>
              <li>
                <span class="tick" aria-hidden="true">✓</span>
                <span>Kein Tracking, keine Cookies, keine Werbung.</span>
              </li>
              <li>
                <span class="tick" aria-hidden="true">✓</span>
                <span>Der Code liegt offen auf <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>.</span>
              </li>
            </ul>
          </form>

          <div class="lp-shot">
            <img class="lp-shot-img" src="/images/table-desktop.webp"
                 width="2451" height="1636" decoding="async"
                 alt="Die Kadertabelle: je Spieler ein Score und vier Spalten zum Durchspielen.">
          </div>

          <!--
            Am Handy eine Zeile unter der Tabelle, auf der breiten Seite zwei
            Karten, die auf dem Bild liegen. Dieselben zwei Bilder, nur anders
            gesetzt: die Zeile darum löst sich dort auf.
          -->
          <div class="lp-cards">
            <div class="lp-inset lp-inset--player">
              <img class="lp-inset-img" src="/images/player-dialog.webp"
                   width="582" height="615" loading="lazy" decoding="async"
                   alt="Der Spielerdialog: Score, Spieltage und was ein Verkauf aufs Konto bringt.">
            </div>

            <div class="lp-inset lp-inset--lineup">
              <img class="lp-inset-img" src="/images/lineup.webp"
                   width="528" height="818" loading="lazy" decoding="async"
                   alt="Die Aufstellung auf dem Spielfeld, je Spieler sein Score.">
            </div>
          </div>
        </div>

        <div class="lp-intro">
          <!--
            Nur am Handy sichtbar, siehe die @container-Regel in base.css:
            ersetzt dort die drei Absätze durch vier Karten zum Durchwischen,
            mit denselben Bildern wie oben auf der breiten Seite bzw. aus
            den Funktionsseiten.
          -->
          <div class="lp-carousel-wrap" role="tabpanel" id="lp-panel-info" aria-labelledby="lp-tab-info">
            <p class="lp-carousel-sub">Einblicke in die App</p>
            <!--
              Pfeile nur mit Maus, siehe (hover: hover) in base.css: am
              Touch-Gerät wischt man ohnehin, ein Pfeil darüber wäre nur
              ein weiteres Ziel zum Treffen.
            -->
            <div class="lp-carousel-frame">
            <div class="lp-carousel" role="region" aria-roledescription="Karussell" aria-label="Screenshots der App">
              <div class="lp-slide lp-slide--wide" role="group" aria-roledescription="Folie" aria-label="1 von 4">
                <span class="lp-badge">Score 0–100 %</span>
                <div class="lp-slide-media">
                  <img class="lp-slide-img" src="/images/table-desktop.webp"
                       width="2451" height="1636" loading="lazy" decoding="async"
                       alt="Die Kadertabelle: je Spieler ein Score und vier Spalten zum Durchspielen.">
                </div>
                <h3 class="lp-slide-title">Kadertabelle</h3>
                <p class="lp-slide-text">Score je Spieler, vier Spalten zum Durchspielen.</p>
              </div>
              <div class="lp-slide lp-slide--offers" role="group" aria-roledescription="Folie" aria-label="2 von 4">
                <span class="lp-badge">Gebote</span>
                <div class="lp-slide-media">
                  <img class="lp-slide-img" src="/images/offers-dialog.webp"
                       width="560" height="453" loading="lazy" decoding="async"
                       alt="Der Gebotsdialog: das höchste Gebot groß, darunter alle Gebote mit Manager und Betrag.">
                </div>
                <h3 class="lp-slide-title">Gebote</h3>
                <p class="lp-slide-text">Alle Gebote auf einen Blick, das höchste zuerst.</p>
              </div>
              <div class="lp-slide lp-slide--tall" role="group" aria-roledescription="Folie" aria-label="3 von 4">
                <span class="lp-badge lp-badge--gold">Marktwert</span>
                <div class="lp-slide-media">
                  <img class="lp-slide-img" src="/images/player-dialog.webp"
                       width="582" height="615" loading="lazy" decoding="async"
                       alt="Der Spielerdialog: Score, Spieltage und was ein Verkauf aufs Konto bringt.">
                </div>
                <h3 class="lp-slide-title">Spielerdialog</h3>
                <p class="lp-slide-text">Score, Spieltage, was ein Verkauf am Spielraum ändert.</p>
              </div>
              <div class="lp-slide lp-slide--tall" role="group" aria-roledescription="Folie" aria-label="4 von 4">
                <span class="lp-badge">Aufstellung</span>
                <div class="lp-slide-media">
                  <img class="lp-slide-img" src="/images/lineup.webp"
                       width="528" height="818" loading="lazy" decoding="async"
                       alt="Die Aufstellung auf dem Spielfeld, je Spieler sein Score.">
                </div>
                <h3 class="lp-slide-title">Aufstellung</h3>
                <p class="lp-slide-text">Auf dem Feld zusammengestellt, an Kickbase zurück.</p>
              </div>
            </div>
            <button type="button" class="lp-carousel-nav lp-carousel-nav--prev" id="lp-carousel-prev" aria-label="Vorheriges Bild" disabled>
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button type="button" class="lp-carousel-nav lp-carousel-nav--next" id="lp-carousel-next" aria-label="Nächstes Bild">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            </div>
            <p class="lp-swipe-hint" id="lp-swipe-hint"><span class="lp-swipe-arrow" aria-hidden="true">→</span> wischen für mehr</p>
            <div class="lp-dots" id="lp-dots">
              <button type="button" class="lp-dot is-active" aria-label="Bild 1 von 4 zeigen"></button>
              <button type="button" class="lp-dot" aria-label="Bild 2 von 4 zeigen"></button>
              <button type="button" class="lp-dot" aria-label="Bild 3 von 4 zeigen"></button>
              <button type="button" class="lp-dot" aria-label="Bild 4 von 4 zeigen"></button>
            </div>
            <button type="button" class="lp-carousel-cta" id="lp-carousel-cta">Jetzt anmelden</button>
          </div>

          <p class="lp-body">
            Jeder Spieler bekommt einen Score für den nächsten Spieltag, 0 bis 100 %.
          </p>
          <p class="lp-body">
            Verkäufe spielst du vorher durch: Konto, Kreditlinie und die Aufstellung
            rechnen sofort mit. In vier Spalten hakst du ab, wen du abgeben würdest,
            und siehst den neuen Kontostand, bevor du etwas anfasst.
          </p>
          <p class="lp-body">
            Ein Klick auf den Spielernamen öffnet seinen Dialog: Score, die letzten
            Spieltage, die nächsten Gegner und was ein Verkauf am Spielraum ändert.
            Dazu die Aufstellung auf dem Spielfeld, die sich an Kickbase
            zurückschicken lässt.
          </p>
          <a class="lp-more" href="/functions.html">
            Was die App kann
            <span class="lp-more-arrow" aria-hidden="true">→</span>
          </a>
          <p class="lp-legal">Inoffizielles Fan-Tool, keine Verbindung zu Kickbase.
            Verwendete Bilder gehören der Bundesliga bzw. der DFL.</p>
        </div>

      </div>

      <footer class="lp-foot">
        <a href="/legal-notice.html">Impressum</a><span aria-hidden="true">·</span>
        <a href="/privacy.html">Datenschutz</a><span aria-hidden="true">·</span>
        <a href="/terms.html">Nutzungsbedingungen</a><span aria-hidden="true">·</span>
        <a href="${REPO_URL}" target="_blank" rel="noopener">Quellcode</a>
      </footer>
    </main>
  `;

  const form = host.querySelector<HTMLFormElement>('#login-form');
  const errorEl = host.querySelector<HTMLElement>('#login-error');
  const submitButton = host.querySelector<HTMLButtonElement>('#login-submit');
  if (!form || !errorEl || !submitButton) {
    throw new Error('renderLogin: required elements missing after innerHTML.');
  }

  const hero = host.querySelector<HTMLElement>('.lp-hero');
  const tabButtons = host.querySelectorAll<HTMLButtonElement>('.lp-tab');

  function activateTab(target: string): void {
    if (!hero) return;
    hero.dataset.tab = target;
    tabButtons.forEach((b) => {
      const selected = b.dataset.tabTarget === target;
      b.classList.toggle('is-active', selected);
      b.setAttribute('aria-selected', String(selected));
      b.setAttribute('tabindex', selected ? '0' : '-1');
    });
  }
  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.tabTarget) activateTab(button.dataset.tabTarget);
    });
  });

  // Pfeiltasten zwischen den Reitern, wie es role="tab" verspricht — sonst
  // kündigt der Screenreader "Tab" an, ohne die erwartete Bedienung zu
  // liefern. Home/End springen an den Anfang bzw. das Ende.
  const tabList = [...tabButtons];
  tabList.forEach((tab, idx) => {
    tab.addEventListener('keydown', (event) => {
      let nextIdx: number | null = null;
      if (event.key === 'ArrowRight') nextIdx = (idx + 1) % tabList.length;
      else if (event.key === 'ArrowLeft') nextIdx = (idx - 1 + tabList.length) % tabList.length;
      else if (event.key === 'Home') nextIdx = 0;
      else if (event.key === 'End') nextIdx = tabList.length - 1;
      if (nextIdx === null) return;
      event.preventDefault();
      const next = tabList[nextIdx];
      if (!next) return;
      next.focus();
      if (next.dataset.tabTarget) activateTab(next.dataset.tabTarget);
    });
  });

  // "Jetzt anmelden" sitzt im Info-Reiter, der beim Wechsel display:none
  // bekommt — waehrend der Knopf selbst noch den Fokus haelt. Ohne diesen
  // Sprung faellt der Tastatur-Fokus zurueck auf <body>.
  host.querySelector<HTMLButtonElement>('#lp-carousel-cta')?.addEventListener('click', () => {
    activateTab('login');
    host.querySelector<HTMLButtonElement>('#lp-tab-login')?.focus();
  });

  // Karussell: Punkte folgen der sichtbaren Karte. Wisch-Hinweis UND
  // Rand-Fade verschwinden auf der letzten Karte, auch für Screenreader
  // (aria-hidden, nicht nur opacity) — sie versprechen sonst mehr, als da
  // noch kommt. Punkte und Pfeile springen dieselbe Distanz, die auch das
  // Wischen ergibt: eine Kartenbreite plus Abstand.
  const carousel = host.querySelector<HTMLElement>('.lp-carousel');
  const dots = host.querySelectorAll<HTMLButtonElement>('.lp-dot');
  const swipeHint = host.querySelector<HTMLElement>('#lp-swipe-hint');
  const prevButton = host.querySelector<HTMLButtonElement>('#lp-carousel-prev');
  const nextButton = host.querySelector<HTMLButtonElement>('#lp-carousel-next');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function slideWidth(): number {
    const first = carousel?.firstElementChild as HTMLElement | null;
    return first ? first.getBoundingClientRect().width + 12 : 0;
  }

  function scrollToIndex(i: number): void {
    if (!carousel) return;
    const clamped = Math.max(0, Math.min(dots.length - 1, i));
    carousel.scrollTo({ left: clamped * slideWidth(), behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  carousel?.addEventListener(
    'scroll',
    () => {
      const width = slideWidth();
      if (!width) return;
      const i = Math.round(carousel.scrollLeft / width);
      const atEnd = i >= dots.length - 1;
      dots.forEach((d, idx) => d.classList.toggle('is-active', idx === i));
      if (swipeHint) {
        swipeHint.style.opacity = atEnd ? '0' : '1';
        swipeHint.setAttribute('aria-hidden', String(atEnd));
      }
      carousel.classList.toggle('is-at-end', atEnd);
      if (prevButton) prevButton.disabled = i <= 0;
      if (nextButton) nextButton.disabled = atEnd;
    },
    { passive: true },
  );

  dots.forEach((dot, idx) => dot.addEventListener('click', () => scrollToIndex(idx)));
  prevButton?.addEventListener('click', () => {
    const width = slideWidth();
    if (carousel && width) scrollToIndex(Math.round(carousel.scrollLeft / width) - 1);
  });
  nextButton?.addEventListener('click', () => {
    const width = slideWidth();
    if (carousel && width) scrollToIndex(Math.round(carousel.scrollLeft / width) + 1);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.textContent = '';
    submitButton.disabled = true;
    submitButton.textContent = 'Bitte warten…';

    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    try {
      await props.onSubmit(email, password);
    } catch (err) {
      submitButton.disabled = false;
      submitButton.textContent = 'Anmelden';
      errorEl.textContent = friendlyMessage(err);
    }
  });
}

function friendlyMessage(err: unknown): string {
  if (err instanceof KickbaseError) {
    if (err.isUnauthorized) return 'E-Mail oder Passwort falsch.';
    if (err.status === 0) return 'Netzwerkfehler — bitte später erneut versuchen.';
    return `Login fehlgeschlagen (${err.status}).`;
  }
  if (err instanceof Error) return err.message;
  return 'Login fehlgeschlagen.';
}
