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

export interface LoginViewProps {
  prefilledEmail: string | null;
  onSubmit: (email: string, password: string) => Promise<void>;
}

export function renderLogin(host: HTMLElement, props: LoginViewProps): void {
  host.innerHTML = `
    <main class="auth-shell">
      <form class="auth-card" id="login-form" novalidate>
        <h1 class="auth-title">Kickbase Kaderplaner</h1>
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
        <p class="auth-hint">Deine Zugangsdaten bleiben in deinem Browser. Das Passwort wird nicht gespeichert.</p>
      </form>
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
