/**
 * Cache der Manager-Rangliste, je Liga ein Eintrag: die Liste aus `ranking`,
 * die Punkte je Spieltag aller Manager und die eigene Nutzer-Id.
 *
 * Ohne Cache gingen bei jedem Öffnen der Statistik eine Anfrage für die Liste
 * und eine je Manager raus. Eine Stunde reicht: Punkte ändern sich nur
 * während eines Spieltags, und dann darf die Ebene ruhig eine Stunde
 * hinterher sein; wer es genau wissen will, lädt neu.
 */

import type { LeagueId, LeagueRanking, ManagerPerformance } from '../api/types.js';
import * as storage from '../storage/local.js';

// v1: erste Fassung.
export const STATS_SCHEMA_VERSION = 1;

export const MAX_AGE_MS = 60 * 60 * 1000;

export interface StatsCacheEntry {
  schemaVersion: number;
  /** Zeitpunkt des Abrufs, `Date.now()`. */
  savedAt: number;
  /** Eigene Nutzer-Id aus `user/me`, markiert "ich" in der Rangliste. */
  userId: string;
  ranking: LeagueRanking;
  /** Je Manager-Id die Punkte je Spieltag. */
  performances: Record<string, ManagerPerformance>;
}

function key(leagueId: LeagueId): string {
  return `stats.${leagueId}`;
}

export function loadStats(leagueId: LeagueId): StatsCacheEntry | null {
  const raw = storage.load<StatsCacheEntry>(key(leagueId));
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schemaVersion !== STATS_SCHEMA_VERSION) return null;
  if (typeof raw.savedAt !== 'number' || typeof raw.userId !== 'string') return null;
  if (!raw.ranking || !Array.isArray(raw.ranking.managers)) return null;
  if (!raw.performances || typeof raw.performances !== 'object') return null;
  return raw;
}

export function saveStats(
  leagueId: LeagueId,
  data: Omit<StatsCacheEntry, 'schemaVersion' | 'savedAt'>,
  now = Date.now(),
): void {
  const entry: StatsCacheEntry = {
    schemaVersion: STATS_SCHEMA_VERSION,
    savedAt: now,
    ...data,
  };
  storage.save(key(leagueId), entry);
}

/** Ein Eintrag aus der Zukunft gilt als abgelaufen, wie in `state/performance.ts`. */
export function isFresh(entry: StatsCacheEntry, now = Date.now()): boolean {
  const age = now - entry.savedAt;
  return age >= 0 && age < MAX_AGE_MS;
}
