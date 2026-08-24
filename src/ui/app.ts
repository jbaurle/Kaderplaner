/**
 * Top-level view router. Tiny state machine — no router library.
 *
 *   login        ← no session, or 401/403 from any subsequent call
 *   leagues      ← logged in, > 1 league, no remembered selection
 *   planning     ← logged in + league chosen
 */

import { KickbaseClient } from '../api/kickbase.js';
import type { League, LeagueId } from '../api/types.js';
import * as session from '../state/session.js';
import { renderLogin } from './login.js';
import { renderLeaguePicker } from './league-picker.js';
import { PlanningPage } from './planning-page.js';

export interface AppOptions {
  host: HTMLElement;
  client?: KickbaseClient;
}

type View =
  | { kind: 'login'; prefilledEmail: string | null; notice?: string }
  | { kind: 'leagues'; leagues: League[] }
  | { kind: 'planning'; leagueId: LeagueId };

export class App {
  private readonly host: HTMLElement;
  private readonly client: KickbaseClient;
  private view: View;
  /** Die aktive Planungsseite, damit `render()` sie vor dem Wechsel abräumt. */
  private page: PlanningPage | null = null;

  constructor(options: AppOptions) {
    this.host = options.host;
    this.client = options.client ?? new KickbaseClient();
    this.view = this.computeInitialView();
  }

  start(): void {
    this.render();
  }

  private computeInitialView(): View {
    const persisted = session.loadSession();
    if (!persisted) {
      return { kind: 'login', prefilledEmail: null };
    }

    this.client.setToken(persisted.token);

    const lastLeague = session.loadLastLeagueId();
    if (lastLeague && persisted.leagues.some((l) => l.id === lastLeague)) {
      return { kind: 'planning', leagueId: lastLeague };
    }
    if (persisted.leagues.length === 1) {
      const only = persisted.leagues[0];
      if (only) {
        session.saveLastLeagueId(only.id);
        return { kind: 'planning', leagueId: only.id };
      }
    }
    return { kind: 'leagues', leagues: persisted.leagues };
  }

  private render(): void {
    // Die alte Seite hängt sonst mit ihren window/document-Listenern weiter
    // am Dokument und rendert auf Escape ihre veralteten Daten in den Host.
    this.page?.dispose();
    this.page = null;

    switch (this.view.kind) {
      case 'login':
        renderLogin(this.host, {
          prefilledEmail: this.view.prefilledEmail,
          notice: this.view.notice ?? null,
          onSubmit: (email, password) => this.handleLogin(email, password),
        });
        break;

      case 'leagues':
        renderLeaguePicker(this.host, {
          leagues: this.view.leagues,
          onSelect: (id) => this.handleLeagueSelected(id),
          onLogout: () => this.handleLogout(),
        });
        break;

      case 'planning': {
        const leagueId = this.view.leagueId;
        const persisted = session.loadSession();
        const leagueName = persisted?.leagues.find((l) => l.id === leagueId)?.name ?? leagueId;
        const userLabel = persisted?.userName ?? persisted?.email ?? '';

        this.page = new PlanningPage({
          host: this.host,
          client: this.client,
          leagueId,
          leagueName,
          leagues: persisted?.leagues ?? [],
          userLabel,
          onSelectLeague: (id) => this.handleLeagueSelected(id),
          onLogout: () => this.handleLogout(),
          onUnauthorized: () => this.handleUnauthorized(),
        });
        this.page.start();
        break;
      }
    }
  }

  private async handleLogin(email: string, password: string): Promise<void> {
    const result = await this.client.login(email, password);
    session.saveSession({
      token: result.token,
      email: result.email,
      userName: result.userName,
      leagues: result.leagues,
      savedAt: Date.now(),
    });

    const lastLeague = session.loadLastLeagueId();
    if (lastLeague && result.leagues.some((l) => l.id === lastLeague)) {
      this.view = { kind: 'planning', leagueId: lastLeague };
    } else if (result.leagues.length === 1) {
      const only = result.leagues[0];
      if (!only) throw new Error('Login response leagues array unexpectedly empty.');
      session.saveLastLeagueId(only.id);
      this.view = { kind: 'planning', leagueId: only.id };
    } else {
      this.view = { kind: 'leagues', leagues: result.leagues };
    }
    this.render();
  }

  private handleLeagueSelected(leagueId: LeagueId): void {
    session.saveLastLeagueId(leagueId);
    this.view = { kind: 'planning', leagueId };
    this.render();
  }

  private handleLogout(): void {
    const lastEmail = session.loadSession()?.email ?? null;
    session.clearSession();
    this.client.setToken(null);
    this.view = { kind: 'login', prefilledEmail: lastEmail };
    this.render();
  }

  /**
   * Kickbase hat das Token verworfen. Zurück zur Anmeldung, aber mit einem
   * Satz dazu: ohne ihn wirkt der Sprung mitten aus der Arbeit wie ein
   * Absturz. Kein Fehler in Rot, denn niemand hat etwas falsch gemacht, das
   * Token gilt nur begrenzt.
   */
  private handleUnauthorized(): void {
    const lastEmail = session.loadSession()?.email ?? null;
    session.clearSession();
    this.client.setToken(null);
    this.view = {
      kind: 'login',
      prefilledEmail: lastEmail,
      notice: 'Deine Sitzung ist abgelaufen. Bitte melde dich neu an.',
    };
    this.render();
  }
}
