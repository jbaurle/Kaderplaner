/**
 * Per-league optimizer cache: competition table snapshot, slow-changing
 * player details (`weeklyDetails`), and the last computed scores. Volatile
 * fields (status, probability, averagePoints, teamId) are NOT cached here;
 * they come fresh from the squad endpoint on every Laden and are merged at
 * score-calculation time.
 */

import type { LeagueId, MatchSummary, PlayerId, TeamRow } from '../api/types.js';
import * as storage from '../storage/local.js';

// v4: `mc` pro weeklyDetails-Eintrag (statt nur global auf der Tabelle), und
// das nie gelesene `scores`-Feld ist raus. Schema-Bump verwirft ältere
// Caches einmalig beim nächsten Score-Klick.
export const OPTIMIZER_SCHEMA_VERSION = 4;

export interface OptimizerCacheTable {
  takenAt: number;
  mc: number;
  teams: TeamRow[];
}

export interface OptimizerCacheWeekly {
  /** Stand: höchster `matchesPlayed` der Tabelle beim Abruf dieses Eintrags. */
  mc: number;
  matchSummary: MatchSummary[];
  lastMatchdayPoints: number[];
  hasPlayedFlags: boolean[];
}

export interface OptimizerCache {
  schemaVersion: number;
  table: OptimizerCacheTable | null;
  weeklyDetails: Record<PlayerId, OptimizerCacheWeekly>;
}

export function emptyOptimizerCache(): OptimizerCache {
  return {
    schemaVersion: OPTIMIZER_SCHEMA_VERSION,
    table: null,
    weeklyDetails: {},
  };
}

export function loadOptimizerCache(leagueId: LeagueId): OptimizerCache | null {
  const raw = storage.load<OptimizerCache>(`optimizer.${leagueId}`);
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schemaVersion !== OPTIMIZER_SCHEMA_VERSION) return null;
  if (typeof raw.weeklyDetails !== 'object') return null;
  return raw;
}

export function saveOptimizerCache(leagueId: LeagueId, cache: OptimizerCache): void {
  const safe: OptimizerCache = { ...cache, schemaVersion: OPTIMIZER_SCHEMA_VERSION };
  storage.save(`optimizer.${leagueId}`, safe);
}
