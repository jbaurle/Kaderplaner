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

import type { MarketPlayer, PlayerId, PositionCode, SquadPlayer } from '../api/types.js';
import { squadFormationGap } from './lineup.js';
import { positionLabel } from './optimizer.js';
import type { ScenarioFlags, ScenarioSlot, ScenarioState } from '../state/planning.js';

export type ResolvedScenarioSlot = ScenarioSlot | 'S4';

export interface ResolvedScenarioFlags {
  S1: boolean;
  S2: boolean;
  S3: boolean;
  /** S4 is auto-bench: computed as `!isInLineup`. Never persisted. */
  S4: boolean;
}

export type PositionLabel = 'TW' | 'ABW' | 'MF' | 'ANG';

/**
 * Ein eigenes Angebot im Transfermarkt. Es steht nur an Kaderspielern: fremde
 * Spieler auf dem Markt kommen im Kader nicht vor, ein Kaderspieler dort ist
 * also einer, den man selbst eingestellt hat.
 */
export interface MarketListing {
  /** Aufgerufener Preis. Gleich dem Marktwert, wenn keiner gesetzt wurde. */
  price: number;
  /** Restlaufzeit in Sekunden, Stand der letzten Marktabfrage. */
  expiresInSeconds: number;
  /** Zahl der fremden Gebote, das eigene zählt hier nie mit. */
  offerCount: number;
}

export interface PlanningRow {
  id: PlayerId;
  name: string;
  position: PositionCode;
  positionLabel: PositionLabel;
  marketValue: number;
  /**
   * Was ein Verkauf bringt: das höchste fremde Gebot, sonst der Marktwert.
   * Ein Gebot unter Marktwert zählt nicht, an Kickbase verkaufen geht immer.
   */
  saleValue: number;
  /** Das höchste fremde Gebot, 0 wenn keins vorliegt. Nur für die Anzeige. */
  bestOffer: number;
  /** "G/V seit Kauf" laut Kickbase, gerechnet gegen den Marktwert. */
  mvgl: number;
  /** Marktwertänderung 24 Stunden, in Euro. 0 bei einem Marktspieler. */
  mvChange1d: number;
  /** Marktwertänderung sieben Tage, in Euro. 0 bei einem Marktspieler. */
  mvChange7d: number;
  /**
   * G/V gegen `saleValue`. Ohne Gebot identisch mit `mvgl`, sonst um die
   * Differenz besser: der Kaufpreis steckt schon in `marketValue - mvgl`.
   */
  gainLoss: number;
  isInLineup: boolean;
  /** Platz in der Aufstellung laut Kickbase, null wenn nicht aufgestellt. */
  lineupOrder: number | null;
  /** Team id — nur für das Vereinswappen in der Namensspalte. */
  teamId: string;
  /** Verfügbarkeit laut Kickbase, 0 heißt fit. */
  status: number;
  /** S11-Prognose laut Kickbase, 1 bis 5, 0 heißt keine Angabe. */
  probability: number;
  /** Bildpfad relativ zum CDN, leer wenn Kickbase keins führt. */
  imagePath: string;
  /** Das eigene Angebot im Transfermarkt, null wenn er nicht drin steht. */
  listing: MarketListing | null;
  flags: ResolvedScenarioFlags;
}

export interface PositionCounts {
  TW: number;
  ABW: number;
  MF: number;
  ANG: number;
}

export interface ScenarioSummary {
  /** Σ saleValue der in diesem Szenario verkauften Spieler. */
  salesSum: number;
  /**
   * Σ der offenen Gebote, immer negativ oder 0. Steht in jeder Spalte gleich:
   * den Kauf entscheidet kein Szenario.
   */
  bidsSum: number;
  /** `salesSum + bidsSum`, also die Summe unterm Strich. */
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
  S4: ScenarioSummary;
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
  /** Summe von `gainLoss` über alle Spieler. */
  totalGainLoss: number;
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
  /** Höhe des Gebots, also der Preis beim Kauf. */
  amount: number;
  /**
   * Marktwert, also was der Verkauf bringt. Nicht das Gebot: Kickbase zahlt
   * beim Verkauf den Marktwert, und wer über Marktwert bietet, verliert die
   * Differenz.
   */
  marketValue: number;
  /** In welchen Szenarien er wieder verkauft wird. */
  flags: ScenarioFlags;
}

export interface ComputePlanningInput {
  budget: number;
  squad: SquadPlayer[];
  scenarios: ScenarioState;
  /** Geplante Zugänge. Fehlt die Liste, rechnet die Ansicht nur den Kader. */
  transfers?: readonly PlanningTransfer[];
  /**
   * Das höchste fremde Gebot je Spieler, aus dem Transfermarkt. Fehlt ein
   * Eintrag, zählt der Marktwert.
   */
  bestOffers?: Readonly<Record<PlayerId, number>>;
  /**
   * Die eigenen Angebote im Transfermarkt, je Spieler eins. Fehlt ein
   * Eintrag, steht er nicht im Markt.
   */
  listings?: Readonly<Record<PlayerId, MarketListing>>;
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

  const bestOffers = input.bestOffers ?? {};
  const listings = input.listings ?? {};
  const rows: PlanningRow[] = sorted.map((p) =>
    buildRow(p, scenarios, bestOffers[p.id] ?? 0, listings[p.id] ?? null),
  );
  const totalGainLoss = rows.reduce((sum, row) => sum + row.gainLoss, 0);

  const transfers = input.transfers ?? [];
  const summaries: ScenarioSummaries = {
    S1: summarize(rows, transfers, 'S1', budget),
    S2: summarize(rows, transfers, 'S2', budget),
    S3: summarize(rows, transfers, 'S3', budget),
    S4: summarize(rows, transfers, 'S4', budget),
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
    totalGainLoss,
  };
}

/**
 * Baut eine kaderförmige Zeile aus einem Marktspieler, für den Spielerdialog
 * aus dem Transferblock — auf einen Kandidaten, auf den nur ein eigenes
 * Gebot liegt, nicht auf einen Kaderspieler.
 *
 * Nur Score und Spieltage stammen von so einer Zeile: `saleValue`, `mvgl`
 * und die anderen Verkaufsfelder sind Platzhalter und dürfen nicht gerendert
 * werden, der Spieler gehört ja noch niemandem. Der Aufrufer blendet "Wenn
 * du verkaufst" für einen Nicht-Kader-Spieler entsprechend aus.
 */
export function planningRowFromMarketPlayer(player: MarketPlayer): PlanningRow {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    positionLabel: positionLabel(player.position),
    marketValue: player.marketValue,
    saleValue: player.marketValue,
    bestOffer: 0,
    mvgl: 0,
    // Der Transfermarkt liefert keine Trendwerte, nur das Pfeil-Flag.
    mvChange1d: 0,
    mvChange7d: 0,
    gainLoss: 0,
    isInLineup: false,
    lineupOrder: null,
    teamId: player.teamId,
    status: player.status,
    probability: player.probability,
    imagePath: player.imagePath,
    listing: null,
    flags: { S1: false, S2: false, S3: false, S4: false },
  };
}

/**
 * Eine Kaderzeile. `bestOffer` ist das höchste Gebot eines Mitspielers, 0 wenn
 * keins vorliegt. Es zählt nur, solange es über dem Marktwert liegt: darunter
 * ist der Verkauf an Kickbase besser, und den gibt es immer.
 */
function buildRow(
  player: SquadPlayer,
  scenarios: ScenarioState,
  bestOffer: number,
  listing: MarketListing | null,
): PlanningRow {
  const userFlags = scenarios.byPlayer[player.id] ?? EMPTY_FLAGS;
  const saleValue = Math.max(player.marketValue, bestOffer);

  return {
    id: player.id,
    name: player.name,
    position: player.position,
    positionLabel: POSITION_LABELS[player.position],
    marketValue: player.marketValue,
    saleValue,
    bestOffer,
    mvgl: player.mvgl,
    mvChange1d: player.mvChange1d,
    mvChange7d: player.mvChange7d,
    // Kaufpreis = Marktwert - G/V. Beides kommt von Kickbase, der Rest folgt.
    gainLoss: saleValue - (player.marketValue - player.mvgl),
    isInLineup: player.isInLineup,
    lineupOrder: player.lineupOrder,
    teamId: player.teamId,
    status: player.status,
    probability: player.probability,
    imagePath: player.imagePath,
    listing,
    flags: {
      S1: userFlags.S1,
      S2: userFlags.S2,
      S3: userFlags.S3,
      S4: !player.isInLineup,
    },
  };
}

/**
 * Eine Szenariospalte durchrechnen. Verkäufe und Gebote bleiben getrennt,
 * `transactionSum` ist die Summe unterm Strich. Getrennt, weil die Gebote in
 * keiner Spalte der Tabelle stehen: stünden sie mit in einer Summe, ließe sich
 * die Zeile mit den sichtbaren Beträgen nicht nachrechnen.
 *
 * Ein Zugang gilt als bekommen. Sein Gebot geht in jeder Spalte ab, auch in
 * BANK, denn den Kauf entscheidet kein Szenario. Danach ist er ein Kaderspieler
 * wie jeder andere: ohne Häkchen bleibt er und zählt bei der Formation mit,
 * mit Häkchen geht er wieder weg und bringt seinen Marktwert.
 *
 * In BANK gibt es kein Häkchen zum Setzen, die Spalte verkauft alles, was nicht
 * in der Aufstellung steht. Ein Zugang steht dort nie, also geht er in BANK
 * immer wieder weg. Die Tabelle zeigt seinen Marktwert in der BANK-Spalte
 * ohnehin schon an; zählte die Summe ihn nicht mit, ließe sich die Spalte nicht
 * nachrechnen.
 */
function summarize(
  rows: PlanningRow[],
  transfers: readonly PlanningTransfer[],
  slot: ResolvedScenarioSlot,
  budget: number,
): ScenarioSummary {
  const posCounts: PositionCounts = { TW: 0, ABW: 0, MF: 0, ANG: 0 };
  let salesSum = 0;
  let bidsSum = 0;
  for (const row of rows) {
    if (row.flags[slot]) {
      salesSum += row.saleValue;
    } else {
      posCounts[row.positionLabel]++;
    }
  }
  for (const transfer of transfers) {
    bidsSum -= transfer.amount;
    if (slot === 'S4' || transfer.flags[slot]) {
      salesSum += transfer.marketValue;
    } else {
      posCounts[transfer.positionLabel]++;
    }
  }
  const transactionSum = salesSum + bidsSum;
  const totalKept = posCounts.TW + posCounts.ABW + posCounts.MF + posCounts.ANG;
  const formationIssues = getFormationIssues(posCounts, totalKept);
  return {
    salesSum,
    bidsSum,
    transactionSum,
    newBalance: budget + transactionSum,
    posCounts,
    totalKept,
    isFormationValid: formationIssues.length === 0,
    formationIssues,
  };
}

/**
 * Was der übrig gebliebene Kader für eine gültige Elf noch braucht.
 *
 * Zuerst die Untergrenzen, die für jede Formation gelten: elf Spieler, ein
 * Torwart, 3 ABW, 2 MF, 1 ANG. Sie treffen die häufigen Fälle und sagen als
 * Meldung genau, was fehlt.
 *
 * Erfüllt der Kader sie alle, ist die Frage damit noch nicht beantwortet: die
 * zehn Formationen sind kein Produkt aus Ober- und Untergrenzen. 6 ABW, 3 MF
 * und 1 ANG hält jede Grenze ein, und trotzdem passt keine einzige. Deshalb
 * zum Schluss die Prüfung gegen die Liste selbst.
 */
function getFormationIssues(posCounts: PositionCounts, totalKept: number): string[] {
  const issues: string[] = [];
  if (totalKept < 11) issues.push(`nur ${totalKept}/11 Spieler`);
  if (posCounts.TW < 1) issues.push(`TW ${posCounts.TW}/1`);
  if (posCounts.ABW < 3) issues.push(`ABW ${posCounts.ABW}/3`);
  if (posCounts.MF < 2) issues.push(`MF ${posCounts.MF}/2`);
  if (posCounts.ANG < 1) issues.push(`ANG ${posCounts.ANG}/1`);
  if (issues.length > 0) return issues;
  return squadFormationGap(posCounts);
}
