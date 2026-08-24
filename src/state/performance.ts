/**
 * Cache der Punkte je Spieltag, je Liga und Spieler ein Eintrag.
 *
 * Der Spielerdialog zeigt sie ganz unten. Ohne Cache ginge bei jedem Öffnen
 * eine Anfrage raus, auch beim dritten Blick auf denselben Spieler, und die
 * Antwort trägt immer alle Saisons. Deshalb liegt sie hier und wird erst nach
 * `MAX_AGE_MS` wieder geholt.
 */

import type { LeagueId, PlayerId, PlayerPerformance } from '../api/types.js';
import * as storage from '../storage/local.js';

// v1: erste Fassung.
export const PERFORMANCE_SCHEMA_VERSION = 1;

/**
 * Wie lange ein Eintrag gilt. Sechs Stunden: neue Punkte gibt es nur nach
 * einem Spiel, und ein Spieltag zieht sich über mehrere Tage. Länger wäre
 * riskant, weil die Punkte eines laufenden Spieltags nachträglich noch
 * korrigiert werden.
 */
export const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface PerformanceCacheEntry {
  schemaVersion: number;
  /** Zeitpunkt des Abrufs, `Date.now()`. */
  savedAt: number;
  performance: PlayerPerformance;
}

function key(leagueId: LeagueId, playerId: PlayerId): string {
  return `performance.${leagueId}.${playerId}`;
}

export function loadPerformance(
  leagueId: LeagueId,
  playerId: PlayerId,
): PerformanceCacheEntry | null {
  const raw = storage.load<PerformanceCacheEntry>(key(leagueId, playerId));
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schemaVersion !== PERFORMANCE_SCHEMA_VERSION) return null;
  if (!raw.performance || !Array.isArray(raw.performance.seasons)) return null;
  if (typeof raw.savedAt !== 'number') return null;
  return raw;
}

export function savePerformance(
  leagueId: LeagueId,
  playerId: PlayerId,
  performance: PlayerPerformance,
  now = Date.now(),
): void {
  const entry: PerformanceCacheEntry = {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    savedAt: now,
    performance,
  };
  storage.save(key(leagueId, playerId), entry);
}

/**
 * Ist der Eintrag noch gültig? Ein Eintrag aus der Zukunft gilt als abgelaufen:
 * so eine Uhrzeit kommt von einer verstellten Systemuhr, und ein Eintrag, der
 * nie altert, wäre schlimmer als eine Anfrage zu viel.
 */
export function isFresh(entry: PerformanceCacheEntry, now = Date.now()): boolean {
  const age = now - entry.savedAt;
  return age >= 0 && age < MAX_AGE_MS;
}
