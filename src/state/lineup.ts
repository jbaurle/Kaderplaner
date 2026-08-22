/**
 * Der Aufstellungsentwurf je Liga, damit ein halbfertiger Stand den Reload
 * überlebt.
 *
 * Bewusst getrennt von `kb.scenarios.<leagueId>`: die Szenarien sagen "diesen
 * Spieler verkaufe ich", der Entwurf sagt "dieser Spieler spielt". Beides in
 * einen Eintrag zu legen, wäre nur billiger, nicht klarer.
 *
 * Der Entwurf ist keine Kopie der echten Aufstellung. Solange nichts an
 * Kickbase geschickt wurde, weiß nur der Browser davon.
 */

import type { LeagueId, PlayerId } from '../api/types.js';
import * as storage from '../storage/local.js';

interface StoredLineup {
  ids: PlayerId[];
}

/**
 * Gibt den gespeicherten Entwurf zurück, ohne Spieler, die es im Kader nicht
 * mehr gibt. `null` heißt: es gibt keinen Entwurf, der Aufrufer soll aus der
 * laufenden Aufstellung vorbelegen.
 */
export function loadLineup(
  leagueId: LeagueId,
  knownIds: ReadonlySet<PlayerId>,
): PlayerId[] | null {
  const stored = storage.load<StoredLineup>(`lineup.${leagueId}`);
  if (!stored || !Array.isArray(stored.ids)) return null;
  return stored.ids.filter((id) => knownIds.has(id));
}

export function saveLineup(leagueId: LeagueId, ids: readonly PlayerId[]): void {
  storage.save<StoredLineup>(`lineup.${leagueId}`, { ids: [...ids] });
}
