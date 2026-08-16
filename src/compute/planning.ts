/**
 * Pure planning computation — port of `loadPlayerData` from the Apps Script.
 *
 * Inputs (all plain data):
 *   - current budget
 *   - squad players from the API
 *   - the user's S1-S3 toggles persisted in localStorage
 *
 * Output is a fully-materialised view: rows ready for rendering, per-scenario
 * summaries, current formation, lineup count.
 *
 * No DOM access, no fetch, no localStorage — easy to unit-test.
 */

import type { PlayerId, PositionCode, SquadPlayer } from '../api/types.js';
import type { ScenarioFlags, ScenarioSlot, ScenarioState } from '../state/planning.js';

export type ResolvedScenarioSlot = ScenarioSlot | 'S5';

export interface ResolvedScenarioFlags {
  S1: boolean;
  S2: boolean;
  S3: boolean;
  /** S5 is auto-bench: computed as `!isInLineup`. Never persisted. */
  S5: boolean;
}

export type PositionLabel = 'TW' | 'ABW' | 'MF' | 'ANG';

export interface PlanningRow {
  id: PlayerId;
  name: string;
  position: PositionCode;
  positionLabel: PositionLabel;
  marketValue: number;
  /** "G/V seit Kauf" — gain/loss since purchase. */
  mvgl: number;
  isInLineup: boolean;
  /** Team id — nur für das Vereinswappen in der Namensspalte. */
  teamId: string;
  /** Verfügbarkeit laut Kickbase, 0 heisst fit. */
  status: number;
  /** S11-Prognose laut Kickbase, 1 bis 5, 0 heisst keine Angabe. */
  probability: number;
  /** Bildpfad relativ zum CDN, leer wenn Kickbase keins führt. */
  imagePath: string;
  flags: ResolvedScenarioFlags;
}

export interface PositionCounts {
  TW: number;
  ABW: number;
  MF: number;
  ANG: number;
}

export interface ScenarioSummary {
  /** Σ marketValue of players sold in this scenario. */
  transactionSum: number;
  /** budget + transactionSum. */
  newBalance: number;
  /** Count of KEPT players by position (not sold in this scenario). */
  posCounts: PositionCounts;
  /** Total kept = sum across positions. */
  totalKept: number;
  /** True when the kept squad can still form a valid Kickbase lineup. */
  isFormationValid: boolean;
  /** Human-readable reasons when the kept squad cannot form a valid lineup. */
  formationIssues: string[];
}

export interface ScenarioSummaries {
  S1: ScenarioSummary;
  S2: ScenarioSummary;
  S3: ScenarioSummary;
  S5: ScenarioSummary;
}

export interface PlanningView {
  /** Pass-through for convenience. */
  budget: number;
  /** Sorted by position then localised name. */
  rows: PlanningRow[];
  summaries: ScenarioSummaries;
  /**
   * "ABW-MF-ANG" of the CURRENT lineup, e.g. "4-3-3" — same notation as
   * `VALID_FORMATIONS`, the goalkeeper is implied. Independent of scenarios.
   */
  formation: string;
  /** Number of players currently in the lineup (`lo != null`). */
  lineupCount: number;
  /** Total players in the squad. */
  totalPlayers: number;
  /** Total "G/V seit Kauf" across all players. */
  totalMvgl: number;
}

/**
 * Ein Zugang, also ein eigenes offenes Gebot. Die Ansicht rechnet ihn als
 * bekommen: das Gebot geht in jedem Szenario vom Kontostand ab, und der Spieler
 * zählt zum Kader. Die Häkchen bedeuten hier dasselbe wie oben, nämlich
 * verkaufen.
 */
export interface PlanningTransfer {
  id: PlayerId;
  positionLabel: PositionLabel;
  /**
   * Höhe des Gebots. Sie zählt in beide Richtungen: als Preis beim Kauf und
   * als Erlös, wenn er in einem Szenario wieder weg soll. Ein angehaktes
   * Gebot ist damit unterm Strich neutral.
   */
  amount: number;
  /** In welchen Szenarien er wieder verkauft wird. */
  flags: ScenarioFlags;
}

export interface ComputePlanningInput {
  budget: number;
  squad: SquadPlayer[];
  scenarios: ScenarioState;
  /** Geplante Zugänge. Fehlt die Liste, rechnet die Ansicht nur den Kader. */
  transfers?: readonly PlanningTransfer[];
}

const POSITION_LABELS: Record<PositionCode, PositionLabel> = {
  1: 'TW',
  2: 'ABW',
  3: 'MF',
  4: 'ANG',
};

const EMPTY_FLAGS: Readonly<ScenarioFlags> = Object.freeze({
  S1: false,
  S2: false,
  S3: false,
});

const COLLATOR = new Intl.Collator('de-DE');

export function computePlanning(input: ComputePlanningInput): PlanningView {
  const { budget, squad, scenarios } = input;

  // Sort by position, then by localised name. Matches the Apps Script:
  //   a.pos == b.pos ? a.n.localeCompare(b.n) : a.pos < b.pos ? -1 : 1
  const sorted = [...squad].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return COLLATOR.compare(a.name, b.name);
  });

  const rows: PlanningRow[] = sorted.map((p) => buildRow(p, scenarios));
  const totalMvgl = rows.reduce((sum, row) => sum + row.mvgl, 0);

  const transfers = input.transfers ?? [];
  const summaries: ScenarioSummaries = {
    S1: summarize(rows, transfers, 'S1', budget),
    S2: summarize(rows, transfers, 'S2', budget),
    S3: summarize(rows, transfers, 'S3', budget),
    S5: summarize(rows, transfers, 'S5', budget),
  };

  // Formation + lineupCount are based on CURRENT lineup (not post-sale).
  // This matches the Apps Script's lineup.{TW,ABW,MF,ANG} aggregation.
  const lineupCounts: PositionCounts = { TW: 0, ABW: 0, MF: 0, ANG: 0 };
  let lineupCount = 0;
  for (const row of rows) {
    if (row.isInLineup) {
      lineupCounts[row.positionLabel]++;
      lineupCount++;
    }
  }
  const formation = `${lineupCounts.ABW}-${lineupCounts.MF}-${lineupCounts.ANG}`;

  return {
    budget,
    rows,
    summaries,
    formation,
    lineupCount,
    totalPlayers: rows.length,
    totalMvgl,
  };
}

function buildRow(player: SquadPlayer, scenarios: ScenarioState): PlanningRow {
  const userFlags = scenarios.byPlayer[player.id] ?? EMPTY_FLAGS;

  return {
    id: player.id,
    name: player.name,
    position: player.position,
    positionLabel: POSITION_LABELS[player.position],
    marketValue: player.marketValue,
    mvgl: player.mvgl,
    isInLineup: player.isInLineup,
    teamId: player.teamId,
    status: player.status,
    probability: player.probability,
    imagePath: player.imagePath,
    flags: {
      S1: userFlags.S1,
      S2: userFlags.S2,
      S3: userFlags.S3,
      S5: !player.isInLineup,
    },
  };
}

/**
 * Eine Szenariospalte durchrechnen. `transactionSum` ist die Summe unterm
 * Strich: Verkäufe plus, Gebote minus.
 *
 * Ein Zugang gilt als bekommen. Sein Gebot geht in jeder Spalte ab, auch in
 * FIX, denn den Kauf entscheidet kein Szenario. Danach ist er ein Kaderspieler
 * wie jeder andere: ohne Häkchen bleibt er und zählt bei der Formation mit,
 * mit Häkchen geht er wieder weg und bringt das Gebot zurück. In FIX steht
 * kein Häkchen, die Spalte zeigt den Bestand, wie er ist.
 */
function summarize(
  rows: PlanningRow[],
  transfers: readonly PlanningTransfer[],
  slot: ResolvedScenarioSlot,
  budget: number,
): ScenarioSummary {
  const posCounts: PositionCounts = { TW: 0, ABW: 0, MF: 0, ANG: 0 };
  let transactionSum = 0;
  for (const row of rows) {
    if (row.flags[slot]) {
      transactionSum += row.marketValue;
    } else {
      posCounts[row.positionLabel]++;
    }
  }
  for (const transfer of transfers) {
    transactionSum -= transfer.amount;
    if (slot !== 'S5' && transfer.flags[slot]) {
      transactionSum += transfer.amount;
    } else {
      posCounts[transfer.positionLabel]++;
    }
  }
  const totalKept = posCounts.TW + posCounts.ABW + posCounts.MF + posCounts.ANG;
  const formationIssues = getFormationIssues(posCounts, totalKept);
  return {
    transactionSum,
    newBalance: budget + transactionSum,
    posCounts,
    totalKept,
    isFormationValid: formationIssues.length === 0,
    formationIssues,
  };
}

function getFormationIssues(posCounts: PositionCounts, totalKept: number): string[] {
  const issues: string[] = [];
  if (totalKept < 11) issues.push(`nur ${totalKept}/11 Spieler`);
  if (posCounts.TW < 1) issues.push(`TW ${posCounts.TW}/1`);
  if (posCounts.ABW < 3) issues.push(`ABW ${posCounts.ABW}/3`);
  if (posCounts.MF < 2) issues.push(`MF ${posCounts.MF}/2`);
  if (posCounts.ANG < 1) issues.push(`ANG ${posCounts.ANG}/1`);
  return issues;
}
