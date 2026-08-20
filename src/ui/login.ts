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
  onSubmit: (email: string, password: string) => Promise<void>;
}

export function renderLogin(host: HTMLElement, props: LoginViewProps): void {
  host.innerHTML = `
    <main class="lp-page">
      <div class="lp-hero">

        <header class="lp-head">
          <h1 class="lp-title">
            <img class="lp-mark" src="/favicon.svg" alt="" width="40" height="40">
            Kickbase Kaderplaner
          </h1>
          <p class="lp-kicker"><b>Inoffizielles Fan-Tool.</b> Kein Angebot von Kickbase.</p>
        </header>

        <div class="lp-showcase">
          <form class="lp-panel" id="login-form" novalidate>
            <h2 class="lp-panel-title">Anmelden</h2>
            <p class="lp-panel-note">Mit deinem Kickbase-Konto, ohne eigenes Konto hier.</p>
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
                <span>Dein Passwort geht direkt an Kickbase. Wir haben keinen Server, der es sehen könnte.</span>
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
            <p class="auth-small">Kaderplaner steht in keiner Verbindung zu Kickbase.
              Verwendete Bilder gehören der Bundesliga bzw. der DFL.</p>
          </form>

          <!--
            Ein Bild für beide Breiten, deshalb ein einziges img: das schmale
            Gerät lädt nur den Handy-Schnitt, das breite nur den Desktop-Schnitt.
            Zwei img-Elemente mit display:none holten beide.
          -->
          <div class="lp-shot">
            <picture>
              <source media="(min-width: 720px)" srcset="/images/table-desktop.webp">
              <img class="lp-shot-img" src="/images/table-mobile.webp"
                   width="724" height="1568" decoding="async"
                   alt="Die Kadertabelle: je Spieler ein Score und vier Spalten zum Durchspielen.">
            </picture>
          </div>

          <!--
            Am Handy eine Zeile unter der Tabelle, auf der breiten Seite zwei
            Karten, die auf dem Bild liegen. Dieselben zwei Bilder, nur anders
            gesetzt: die Zeile darum löst sich dort auf.
          -->
          <div class="lp-cards">
            <div class="lp-inset lp-inset--player">
              <img class="lp-inset-img" src="/images/player-dialog.webp"
                   width="946" height="1140" loading="lazy" decoding="async"
                   alt="Der Spielerdialog: Score, Spieltage und was ein Verkauf aufs Konto bringt.">
            </div>

            <div class="lp-inset lp-inset--lineup">
              <img class="lp-inset-img" src="/images/lineup.webp"
                   width="531" height="1086" loading="lazy" decoding="async"
                   alt="Die Aufstellung auf dem Spielfeld, je Spieler sein Score.">
            </div>
          </div>
        </div>

        <div class="lp-intro">
          <p class="lp-body">
            Jeder Spieler bekommt einen Score für den nächsten Spieltag, 0 bis 100 %.
          </p>
          <p class="lp-body">
            Verkäufe spielst du vorher durch: Konto, Kreditlinie und die Aufstellung
            rechnen sofort mit. In vier Spalten hakst du ab, wen du abgeben würdest,
            und siehst den neuen Kontostand, bevor du etwas anfasst.
          </p>
          <p class="lp-body">
            Ein Tipp auf einen Namen öffnet seinen Dialog: Score, die letzten
            Spieltage, die nächsten Gegner und was ein Verkauf am Spielraum ändert.
            Dazu die Aufstellung auf dem Spielfeld, die sich an Kickbase
            zurückschicken lässt.
          </p>
          <a class="lp-more" href="/functions.html">
            Was die App kann
            <span class="lp-more-arrow" aria-hidden="true">→</span>
          </a>
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
