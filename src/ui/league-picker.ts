/**
 * League picker — shown after login when the user belongs to multiple leagues
 * and has no remembered selection. Clicking a league triggers `onSelect`.
 */

import type { League, LeagueId } from '../api/types.js';
import { escapeHtml } from './format.js';

export interface LeaguePickerProps {
  leagues: League[];
  onSelect: (leagueId: LeagueId) => void;
  onLogout: () => void;
}

export function renderLeaguePicker(host: HTMLElement, props: LeaguePickerProps): void {
  host.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card">
        <h1 class="auth-title">Liga auswählen</h1>
        <p class="auth-hint">Du bist Mitglied in mehreren Ligen. Wähle eine aus.</p>
        <ul class="league-list">
          ${props.leagues
            .map(
              (league) => `
            <li class="league-item">
              <button type="button" class="league-button" data-league-id="${escapeHtml(league.id)}">
                ${escapeHtml(league.name)}
              </button>
            </li>`,
            )
            .join('')}
        </ul>
        <button type="button" class="auth-link" id="logout-btn">Abmelden</button>
      </section>
    </main>
  `;

  // Am frisch gerenderten Kind, nicht am dauerhaften Host: dort stapelte
  // sich der Listener bei jedem Anzeigen der Ligaauswahl und feuerte später
  // auch auf #logout-btn und [data-league-id] der Planungsseite mit.
  const shell = host.querySelector<HTMLElement>('.auth-shell');
  if (!shell) {
    throw new Error('renderLeaguePicker: shell missing after innerHTML.');
  }
  shell.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const logoutBtn = target.closest<HTMLButtonElement>('#logout-btn');
    if (logoutBtn) {
      props.onLogout();
      return;
    }

    const leagueBtn = target.closest<HTMLButtonElement>('[data-league-id]');
    const leagueId = leagueBtn?.dataset['leagueId'];
    if (leagueId) {
      props.onSelect(leagueId);
    }
  });
}
