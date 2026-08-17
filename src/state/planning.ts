/**
 * Per-league persisted planning state: the user's S1-S3 scenario toggles.
 *
 * Keyed by league id, so a user can have several leagues with independent
 * scenarios in the same browser. S4 (auto-bench) is computed on every
 * render from the current lineup — never stored — so it stays correct
 * when Kickbase moves players in or out.
 */

import type { LeagueId, PlayerId } from '../api/types.js';
import * as storage from '../storage/local.js';

export type ScenarioSlot = 'S1' | 'S2' | 'S3';

export interface ScenarioFlags {
  S1: boolean;
  S2: boolean;
  S3: boolean;
}

export interface ScenarioState {
  byPlayer: Record<PlayerId, ScenarioFlags>;
}

const EMPTY_FLAGS: Readonly<ScenarioFlags> = Object.freeze({
  S1: false,
  S2: false,
  S3: false,
});

const EMPTY_STATE: ScenarioState = { byPlayer: {} };

// ---------- Scenarios ----------

export function loadScenarios(leagueId: LeagueId): ScenarioState {
  const state = storage.load<ScenarioState>(`scenarios.${leagueId}`);
  if (!state || typeof state.byPlayer !== 'object') return { byPlayer: {} };
  return state;
}

export function saveScenarios(leagueId: LeagueId, state: ScenarioState): void {
  storage.save(`scenarios.${leagueId}`, state);
}

export function getFlags(state: ScenarioState, playerId: PlayerId): ScenarioFlags {
  return state.byPlayer[playerId] ?? EMPTY_FLAGS;
}

/**
 * Returns a new ScenarioState with `slot` for `playerId` set to `value`.
 * If a player ends up with all-false flags, their entry is removed from
 * the map so we don't bloat localStorage with empty objects.
 */
export function setFlag(
  state: ScenarioState,
  playerId: PlayerId,
  slot: ScenarioSlot,
  value: boolean,
): ScenarioState {
  const current = getFlags(state, playerId);
  const next: ScenarioFlags = { ...current, [slot]: value };

  const allFalse = !next.S1 && !next.S2 && !next.S3;
  const byPlayer = { ...state.byPlayer };
  if (allFalse) {
    delete byPlayer[playerId];
  } else {
    byPlayer[playerId] = next;
  }
  return { byPlayer };
}

export function emptyScenarioState(): ScenarioState {
  return EMPTY_STATE;
}

/**
 * Returns a new ScenarioState with `slot` set to false for every player.
 * Players who end up all-false are pruned from the map.
 */
export function clearSlot(state: ScenarioState, slot: ScenarioSlot): ScenarioState {
  const byPlayer: Record<PlayerId, ScenarioFlags> = {};
  for (const [playerId, flags] of Object.entries(state.byPlayer)) {
    const next: ScenarioFlags = { ...flags, [slot]: false };
    if (next.S1 || next.S2 || next.S3) {
      byPlayer[playerId] = next;
    }
  }
  return { byPlayer };
}
