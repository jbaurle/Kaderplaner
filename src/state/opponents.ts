/**
 * Wie viele Ansetzungen die Gegner-Spalte zuletzt zeigte, je Liga.
 *
 * Die Zahl steht erst nach dem Score-Lauf fest, die Tabelle steht schon vorher.
 * Ohne den gemerkten Wert müsste der Renderer raten, und läge er daneben,
 * spränge die Spaltenbreite in dem Moment, in dem die Wappen eintreffen: die
 * Spielername-Spalte wächst als einzige mit und schluckt die Differenz.
 */

import type { LeagueId } from '../api/types.js';
import * as storage from '../storage/local.js';

/** Mindestens eine Ansetzung führt der Spielplan fast immer. */
const DEFAULT_COLUMNS = 1;

export function loadOppColumns(leagueId: LeagueId): number {
  const raw = storage.load<number>(`oppcols.${leagueId}`);
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 9) {
    return DEFAULT_COLUMNS;
  }
  return raw;
}

/**
 * 0 heisst: keine einzige Ansetzung bekannt. Das ist kein Stand zum Merken,
 * sonst überschriebe ein Lauf ohne Spielplan den letzten brauchbaren Wert.
 */
export function saveOppColumns(leagueId: LeagueId, columns: number): void {
  if (columns < 1) return;
  storage.save(`oppcols.${leagueId}`, columns);
}
