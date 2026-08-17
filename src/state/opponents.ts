/**
 * Wie die Gegner-Spalte beim letzten Score-Lauf aussah, je Liga.
 *
 * Beides steht erst nach dem Lauf fest, die Tabelle steht schon vorher. Ohne
 * den gemerkten Stand müsste der Renderer raten: läge er bei der Spaltenzahl
 * daneben, spränge die Breite in dem Moment, in dem die Wappen eintreffen (die
 * Spielername-Spalte wächst als einzige mit und schluckt die Differenz), und
 * ohne Spieltag wechselte der Spaltenkopf von `ST` auf `ST 1`.
 */

import type { LeagueId } from '../api/types.js';
import * as storage from '../storage/local.js';

export interface OppLayout {
  /** Wie viele Wappen nebeneinander stehen. Mindestens 1. */
  columns: number;
  /** Spieltag im Spaltenkopf. 0 heisst: keiner bekannt, dann steht nur `ST`. */
  nextDay: number;
}

/** Mindestens eine Ansetzung führt der Spielplan fast immer. */
const DEFAULT_LAYOUT: OppLayout = { columns: 1, nextDay: 0 };

export function loadOppLayout(leagueId: LeagueId): OppLayout {
  const raw = storage.load<OppLayout>(`oppview.${leagueId}`);
  if (!raw || typeof raw !== 'object') return DEFAULT_LAYOUT;
  if (!isCount(raw.columns) || raw.columns < 1 || raw.columns > 9) return DEFAULT_LAYOUT;
  if (!isCount(raw.nextDay) || raw.nextDay < 0) return DEFAULT_LAYOUT;
  return { columns: raw.columns, nextDay: raw.nextDay };
}

/**
 * `columns: 0` heisst: keine einzige Ansetzung bekannt. Das ist kein Stand zum
 * Merken, sonst überschriebe ein Lauf ohne Spielplan den letzten brauchbaren.
 */
export function saveOppLayout(leagueId: LeagueId, layout: OppLayout): void {
  if (layout.columns < 1) return;
  storage.save(`oppview.${leagueId}`, layout);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}
