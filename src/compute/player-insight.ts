/**
 * Was der Spielerdialog zeigt, als reine Rechnung.
 *
 * Der Unterschied zur Kickbase-App liegt nicht in mehr Daten, sondern im
 * Bezug: hier ist der Kader bekannt, das Konto, die Formation und die beste
 * Elf. Jede Zahl lässt sich damit als Folge für den Nutzer formulieren.
 *
 * Kein DOM, kein Netz, kein localStorage. Alles kommt als Eingabe herein.
 */

import type { MatchSummary, PlayerId } from '../api/types.js';
import { countPositions } from './lineup.js';
import { VALID_FORMATIONS } from './optimizer.js';
import type { PlanningRow, PositionLabel } from './planning.js';
import { bestElevenWithout, trendOfPosition, type Fixture, type LineupInput, type TeamInfo, type Trend } from './score.js';
import type { ScoreDetail } from './optimizer.js';

/**
 * Wie tief man bei Kickbase ins Minus darf: 33 % des Teamwerts. Verkauft man
 * einen Spieler, steigt das Konto um seinen Erlös, der Teamwert fällt aber um
 * seinen Marktwert und mit ihm die Kreditlinie.
 */
export const CREDIT_SHARE = 0.33;

/**
 * Lässt sich aus diesen Spielern überhaupt noch eine gültige Elf stellen?
 *
 * Nicht mit `isReachable` aus `lineup.ts` zu verwechseln: das prüft eine Elf
 * im Aufbau, also ob die bisher gesetzten Spieler noch in eine Formation
 * passen, und scheitert deshalb schon bei sechs Abwehrspielern. Hier geht es
 * um den Kader, aus dem ausgewählt wird: zu viele auf einer Position sind kein
 * Problem, zu wenige schon.
 */
function canFieldEleven(counts: ReturnType<typeof countPositions>): boolean {
  if (counts.TW < 1) return false;
  return VALID_FORMATIONS.some((label) => {
    const parts = label.split('-').map(Number);
    return counts.ABW >= (parts[0] ?? 0)
      && counts.MF >= (parts[1] ?? 0)
      && counts.ANG >= (parts[2] ?? 0);
  });
}

/** Ein gespielter oder kommender Spieltag, beide in derselben Form. */
export interface MatchdayEntry {
  /** Spieltagsnummer, 0 wenn sie sich nicht zuordnen lässt. */
  day: number;
  /** Liegt der Spieltag in der Zukunft? */
  ahead: boolean;
  /** Punkte des Spielers. Nur bei gespielten Spieltagen gesetzt. */
  points: number | null;
  /** War der Spieler im Einsatz? Nur bei gespielten Spieltagen aussagekräftig. */
  played: boolean;
  /** Verein des Gegners, null wenn unbekannt. */
  opponentId: string | null;
  opponentName: string | null;
  /** Tabellenplatz des Gegners, 0 wenn unbekannt. */
  opponentPosition: number;
  /** Einschätzung des Gegners, nur bei kommenden Spieltagen gesetzt. */
  trend: Trend | null;
  /** Heimspiel? null, wenn unbekannt. */
  home: boolean | null;
  /** Ergebnis aus Sicht des eigenen Vereins, null wenn unbekannt. */
  goalsFor: number | null;
  goalsAgainst: number | null;
  /**
   * Anstoss als ISO-Zeitstempel, leer wenn keiner bekannt ist. Kommende
   * Spieltage bringen ihn aus der Ansetzung mit, gespielte aus dem Spielplan:
   * `matchSummary` kennt nur Tore, kein Datum.
   */
  kickoff: string;
}

/** Was ein Verkauf dieses Spielers am Spielraum ändert. */
export interface SaleEffect {
  /** Erlös, also was auf dem Konto landet. */
  proceeds: number;
  /** Wegfallende Kreditlinie, immer negativ oder 0. */
  creditDrop: number;
  /** `proceeds + creditDrop`, der eigentliche Zugewinn an Spielraum. */
  net: number;
  /** Was heute höchstens ausgegeben werden kann. */
  headroomNow: number;
  /** Dasselbe nach dem Verkauf. */
  headroomAfter: number;
}

/** Was ein Verkauf an der Elf ändert. */
export interface LineupEffect {
  /** Schnitt der besten Elf heute, 0..1. Null, solange kein Lauf vorliegt. */
  bestElevenNow: number | null;
  /** Derselbe Schnitt ohne diesen Spieler. */
  bestElevenAfter: number | null;
  /** Wer statt seiner in die Elf rückt, samt Score 0..1. */
  successor: { name: string; score: number } | null;
  /** Steht er heute in der besten Elf? */
  inBestEleven: boolean;
  /** Geht nach dem Verkauf noch eine gültige Formation auf? */
  formationHolds: boolean;
  position: PositionLabel;
  /** Spieler auf seiner Position, vor und nach dem Verkauf. */
  countNow: number;
  countAfter: number;
}

export interface PlayerInsightInput {
  row: PlanningRow;
  /** Der ganze Kader, für Teamwert und Formationsprüfung. */
  squad: readonly PlanningRow[];
  budget: number;
  /** Score und Teilwerte, null solange kein Lauf durch ist. */
  score: { score: number; detail: ScoreDetail } | null;
  /** Scores aller Kaderspieler, für den Schnitt der besten Elf. */
  scoreByPlayer: Record<PlayerId, { score: number }>;
  top11Ids: readonly PlayerId[];
  /** Zutaten für den zweiten Optimizer-Lauf. Null heißt: kein Vergleich. */
  lineupInput: LineupInput | null;
  /** Die nächsten Ansetzungen seines Vereins. */
  fixtures: readonly Fixture[];
  /** Anstoss je Spieltag für seinen Verein, aus dem Spielplan der Saison. */
  kickoffs: Record<number, string>;
  teams: Record<string, TeamInfo>;
  teamCount: number;
  /** Aus dem Optimizer-Cache: Punkte, Einsätze, Spielplan-Ausschnitt. */
  weekly: {
    mc: number;
    lastMatchdayPoints: readonly number[];
    hasPlayedFlags: readonly boolean[];
    matchSummary: readonly MatchSummary[];
  } | null;
}

export interface PlayerInsight {
  teamValue: number;
  sale: SaleEffect;
  lineup: LineupEffect;
  /** Gespielte und kommende Spieltage, ältester zuerst. */
  matchdays: MatchdayEntry[];
}

/**
 * Spieltage in einer Reihe: erst die gespielten, dann die kommenden.
 *
 * Die Punkte kommen ohne Spieltagsnummer, jüngster zuerst. Die Nummer wird
 * vom Stand `mc` heruntergezählt. Das trifft nicht, wenn ein Spiel nachgeholt
 * wurde, deshalb steht bei day 0 in der Anzeige keine Nummer statt einer
 * falschen. Gegner und Ergebnis kommen aus `matchSummary`, das nur ein Fenster
 * von rund drei Spieltagen führt: was darüber hinausgeht, zeigt nur Punkte.
 */
export function buildMatchdays(input: PlayerInsightInput): MatchdayEntry[] {
  const { row, weekly, fixtures, kickoffs, teams, teamCount } = input;
  const played: MatchdayEntry[] = [];

  if (weekly) {
    const points = weekly.lastMatchdayPoints;
    for (let i = points.length - 1; i >= 0; i--) {
      const day = weekly.mc > i ? weekly.mc - i : 0;
      const match = day === 0
        ? undefined
        : weekly.matchSummary.find((m) => m.day === day && m.state !== 0);
      const home = match ? match.team1Id === row.teamId : null;
      const opponentId = match ? (home ? match.team2Id : match.team1Id) : null;
      played.push({
        day,
        ahead: false,
        points: points[i] ?? 0,
        played: weekly.hasPlayedFlags[i] ?? false,
        opponentId,
        opponentName: opponentId ? teams[opponentId]?.name ?? null : null,
        opponentPosition: opponentId ? teams[opponentId]?.position ?? 0 : 0,
        trend: null,
        home,
        goalsFor: match ? (home ? match.team1Goals : match.team2Goals) : null,
        goalsAgainst: match ? (home ? match.team2Goals : match.team1Goals) : null,
        kickoff: kickoffs[day] ?? '',
      });
    }
  }

  const ahead: MatchdayEntry[] = fixtures.map((fixture) => {
    const info = teams[fixture.opponentId];
    return {
      day: fixture.day,
      ahead: true,
      points: null,
      played: false,
      opponentId: fixture.opponentId,
      opponentName: info?.name ?? null,
      opponentPosition: info?.position ?? 0,
      trend: trendOfPosition(info?.position ?? 0, teamCount),
      home: fixture.home,
      goalsFor: null,
      goalsAgainst: null,
      kickoff: fixture.kickoff,
    };
  });

  // Nur Spieltage dieser Saison. Ohne Nummer ließe sich der Eintrag nirgends
  // verorten: zur neuen Saison stehen dort noch die Punkte der alten, und die
  // gehören nicht in eine Achse, die bei Spieltag 1 anfängt.
  const inSeason = played.filter((day) => day.day > 0);
  return [...inSeason, ...ahead];
}

/** Schnitt der Scores einer Elf, 0..1. Null bei leerer Liste. */
function averageScore(ids: readonly PlayerId[], byPlayer: Record<PlayerId, { score: number }>): number | null {
  if (ids.length === 0) return null;
  const sum = ids.reduce((total, id) => total + (byPlayer[id]?.score ?? 0), 0);
  return sum / ids.length;
}

export function computeSaleEffect(input: PlayerInsightInput, teamValue: number): SaleEffect {
  const { row, budget } = input;
  const proceeds = row.saleValue;
  // Der Marktwert trägt die Kreditlinie, nicht der Erlös: ein fremdes Gebot
  // über Marktwert zahlt zwar mehr aufs Konto, hebt aber den Teamwert nicht.
  const creditDrop = -CREDIT_SHARE * row.marketValue;
  const headroomNow = budget + CREDIT_SHARE * teamValue;
  const headroomAfter = budget + proceeds + CREDIT_SHARE * (teamValue - row.marketValue);
  return {
    proceeds,
    creditDrop,
    net: proceeds + creditDrop,
    headroomNow,
    headroomAfter,
  };
}

export function computeLineupEffect(input: PlayerInsightInput): LineupEffect {
  const { row, squad, scoreByPlayer, top11Ids, lineupInput } = input;

  const rest = squad.filter((player) => player.id !== row.id);
  const countNow = squad.filter((player) => player.positionLabel === row.positionLabel).length;
  const countAfter = countNow - 1;
  const formationHolds = canFieldEleven(countPositions(rest.map((player) => player.positionLabel)));

  const bestElevenNow = averageScore(top11Ids, scoreByPlayer);
  const inBestEleven = top11Ids.includes(row.id);

  let bestElevenAfter: number | null = null;
  let successor: LineupEffect['successor'] = null;

  if (lineupInput) {
    const result = bestElevenWithout(lineupInput, row.id, row.saleValue);
    if (result) {
      bestElevenAfter = result.start11.reduce((sum, p) => sum + p.score, 0) / result.start11.length;
      // Wer neu in der Elf steht, war vorher nicht drin. Bei mehreren nimmt
      // der beste den Platz, denn er ist der Grund für den kleineren Verlust.
      const before = new Set(top11Ids);
      const added = result.start11
        .filter((p) => !before.has(p.playerId))
        .sort((a, b) => b.score - a.score);
      const first = added[0];
      if (first) successor = { name: first.name, score: first.score };
    }
  }

  return {
    bestElevenNow,
    bestElevenAfter,
    successor,
    inBestEleven,
    formationHolds,
    position: row.positionLabel,
    countNow,
    countAfter,
  };
}

export function computePlayerInsight(input: PlayerInsightInput): PlayerInsight {
  const teamValue = input.squad.reduce((sum, player) => sum + player.marketValue, 0);
  return {
    teamValue,
    sale: computeSaleEffect(input, teamValue),
    lineup: computeLineupEffect(input),
    matchdays: buildMatchdays(input),
  };
}
