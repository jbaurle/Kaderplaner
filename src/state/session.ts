/**
 * Persisted session state — token, email, league list — and the
 * "remembered league selection" between visits.
 *
 * Password is **never** stored. On token expiry (401/403), the session is
 * cleared and the login form is shown with the email pre-filled.
 */

import type { League } from '../api/types.js';
import * as storage from '../storage/local.js';

export interface Session {
  token: string;
  email: string;
  userName: string | null;
  leagues: League[];
  savedAt: number;
}

const SESSION_KEY = 'session';
const LAST_LEAGUE_KEY = 'lastLeagueId';

export function loadSession(): Session | null {
  const session = storage.load<Session>(SESSION_KEY);
  if (!session || typeof session.token !== 'string' || !Array.isArray(session.leagues)) {
    return null;
  }
  return session;
}

export function saveSession(session: Session): void {
  storage.save(SESSION_KEY, session);
}

export function clearSession(): void {
  storage.remove(SESSION_KEY);
  storage.remove(LAST_LEAGUE_KEY);
}

export function loadLastLeagueId(): string | null {
  return storage.load<string>(LAST_LEAGUE_KEY);
}

export function saveLastLeagueId(leagueId: string): void {
  storage.save(LAST_LEAGUE_KEY, leagueId);
}

export function clearLastLeagueId(): void {
  storage.remove(LAST_LEAGUE_KEY);
}
