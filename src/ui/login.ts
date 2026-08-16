/**
 * Login view — email + password, posts to Kickbase, surfaces errors.
 *
 * The view is stateless from the outside: callers pass `onSubmit` which
 * receives email + password and may throw a `KickbaseError`. The view
 * disables the submit button while the request is in flight and re-enables
 * it on failure.
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
    <main class="auth-shell">
      <div class="auth-stack">
        <form class="auth-card" id="login-form" novalidate>
          <h1 class="auth-title">Kickbase Kaderplaner</h1>
          <p class="auth-kicker"><b>Inoffizielles Fan-Tool.</b> Kein Angebot von Kickbase.</p>
          <label class="field">
            <span class="field-label">E-Mail</span>
            <input type="email" name="email" class="field-input" required autocomplete="username" autofocus
                   value="${escapeHtml(props.prefilledEmail ?? '')}">
          </label>
          <label class="field">
            <span class="field-label">Passwort</span>
            <input type="password" name="password" class="field-input" required autocomplete="current-password">
          </label>
          <button type="submit" class="auth-submit">Anmelden</button>
          <p class="auth-error" id="login-error" role="alert"></p>
          <hr class="auth-rule">
          <ul class="auth-proof">
            <li>
              <span class="tick" aria-hidden="true">✓</span>
              <span>Dein Passwort geht direkt an Kickbase. Wir haben keinen Server, der es sehen könnte.</span>
            </li>
            <li>
              <span class="tick" aria-hidden="true">✓</span>
              <span>Der Code liegt offen auf <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>.
                Du kannst nachlesen, dass das stimmt.</span>
            </li>
            <li>
              <span class="tick" aria-hidden="true">✓</span>
              <span>Kein Tracking, keine Cookies, keine Werbung.</span>
            </li>
          </ul>
          <p class="auth-small">Kaderplaner steht in keiner Verbindung zu Kickbase.
            Verwendete Bilder gehören der Bundesliga bzw. der DFL.</p>
        </form>
        <p class="auth-legal">
          <a href="/impressum.html">Impressum</a><span aria-hidden="true">·</span>
          <a href="/datenschutz.html">Datenschutz</a><span aria-hidden="true">·</span>
          <a href="/nutzungsbedingungen.html">Nutzungsbedingungen</a><span aria-hidden="true">·</span>
          <a href="${REPO_URL}" target="_blank" rel="noopener">Quellcode</a>
        </p>
      </div>
    </main>
  `;

  const form = host.querySelector<HTMLFormElement>('#login-form');
  const errorEl = host.querySelector<HTMLElement>('#login-error');
  const submitButton = host.querySelector<HTMLButtonElement>('.auth-submit');
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
