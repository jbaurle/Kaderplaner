/**
 * Score orchestrator: combines a fresh `squad` snapshot with the per-league
 * optimizer cache and runs the optimizer.
 *
 * Fetches only what's needed:
 *   - Always: competitionTable (1 request, liefert den Spieltagsstand `mc`).
 *   - Dazu die Player-Details jedes Kaderspielers, dessen Cache-Eintrag fehlt
 *     oder älter als `mc` ist (parallel).
 *
 * Returns a {@link ScoreResult} that the page renders directly. Persists the
 * updated cache on success; das Ergebnis selbst wird nicht gecacht.
 */

import type { KickbaseClient } from '../api/kickbase.js';
import type {
  CompetitionMatchdays,
  CompetitionTable,
  LeagueId,
  MarketPlayer,
  PlayerId,
  SquadPlayer,
} from '../api/types.js';
import {
  LineupOptimizer,
  positionLabel,
  type OptimizerPlayer,
  type OptimizerResult,
  type ScoreDetail,
} from './optimizer.js';
import {
  emptyOptimizerCache,
  loadOptimizerCache,
  saveOptimizerCache,
  type OptimizerCacheWeekly,
} from '../state/optimizer.js';

// ---------- Gegner-Spalte ----------

/** Grenzen für die Pfeile: obere und untere Drittel der Tabelle. */
const ARROW_UP = 0.67;
const ARROW_DOWN = 0.33;

export type Trend = 'up' | 'flat' | 'down';

/** Eine kommende Ansetzung, gelesen aus `matchSummary`. */
export interface Fixture {
  opponentId: string;
  home: boolean;
  /** Spieltag, nur für den Tooltip. */
  day: number;
  /** Anstoss als ISO-Zeitstempel, leer wenn Kickbase keinen führt. */
  kickoff: string;
}

/** Was die Gegner-Spalte über einen Verein wissen muss. */
export interface TeamInfo {
  name: string;
  /** Tabellenplatz 1 bis 18. */
  position: number;
}

/** Alles, was die Gegner-Spalte braucht. */
export interface OpponentsView {
  fixtures: Record<string, Fixture[]>;
  teams: Record<string, TeamInfo>;
  /**
   * Wie viele Wappen nebeneinander stehen. Gilt für die ganze Spalte, damit
   * die Wappen untereinander stehen, auch wenn einem Verein eine Ansetzung
   * fehlt. 0 heisst: keine einzige bekannt, die Spalte bleibt leer.
   */
  columns: number;
  /** Vereine in der Tabelle, für die Umrechnung Platz in Pfeil. */
  teamCount: number;
  /**
   * Spieltag der nächsten Ansetzung, für den Spaltentitel. Der kleinste
   * über alle Vereine: bei einem nachgeholten Spiel steht sonst je nach
   * Kader eine andere Zahl im Kopf. 0 heisst unbekannt.
   */
  nextDay: number;
}

const EMPTY_SCHEDULE: CompetitionMatchdays = { currentDay: 0, matches: [] };

export const EMPTY_OPPONENTS: OpponentsView = {
  fixtures: {},
  teams: {},
  columns: 0,
  teamCount: 0,
  nextDay: 0,
};

/**
 * Kommende Ansetzungen je Verein, höchstens `max`, aufsteigend nach Spieltag.
 *
 * Quelle ist der Spielplan des Wettbewerbs, nicht `mdsum` aus dem Spielerdetail.
 * `mdsum` führt nur ein Fenster von drei Spieltagen, hängt am Detail-Cache
 * und war zwischen zwei Saisons wochenlang leer: der Spieltagsstand bleibt
 * dabei auf 0 stehen, damit gilt jeder Cache-Eintrag als aktuell und wird nie
 * erneuert (gesehen 16.08.2026, keine einzige Ansetzung in der Spalte).
 */
export const MAX_FIXTURES = 3;

export function buildFixtures(
  schedule: CompetitionMatchdays,
  max = MAX_FIXTURES,
): Record<string, Fixture[]> {
  const out: Record<string, Fixture[]> = {};
  const open = schedule.matches
    .filter((m) => m.state === 0 && m.day >= schedule.currentDay)
    .sort((a, b) => a.day - b.day || a.kickoff.localeCompare(b.kickoff));

  for (const match of open) {
    for (const home of [true, false]) {
      const teamId = home ? match.team1Id : match.team2Id;
      const list = (out[teamId] ??= []);
      if (list.length >= max) continue;
      list.push({
        opponentId: home ? match.team2Id : match.team1Id,
        home,
        day: match.day,
        kickoff: match.kickoff,
      });
    }
  }
  return out;
}

/**
 * Anstosszeiten je Verein und Spieltag, aus dem Spielplan des Wettbewerbs.
 *
 * Der Spielerdialog stellt gespielte und kommende Spieltage nebeneinander und
 * schreibt unter jede Kachel das Datum. Für gespielte gibt es dafür sonst
 * keine Quelle: `mdsum` aus dem Spielerdetail führt nur Tore. Der Spielplan
 * kennt jede Begegnung der Saison und damit auch ihren Anstoss.
 */
export function buildKickoffs(schedule: CompetitionMatchdays): Record<string, Record<number, string>> {
  const out: Record<string, Record<number, string>> = {};
  for (const match of schedule.matches) {
    if (!match.kickoff || match.day <= 0) continue;
    for (const teamId of [match.team1Id, match.team2Id]) {
      (out[teamId] ??= {})[match.day] = match.kickoff;
    }
  }
  return out;
}

/** Tabellenplatz und Name je Verein, aus der Wettbewerbstabelle. */
export function buildTeamInfo(table: CompetitionTable): Record<string, TeamInfo> {
  const out: Record<string, TeamInfo> = {};
  for (const t of table.teams) out[t.id] = { name: t.name, position: t.position };
  return out;
}

/**
 * Tendenz allein aus dem Tabellenplatz. Dieselbe Rechnung wie im Optimizer
 * (`computeMatchup`), damit Pfeil und Score nicht auseinanderlaufen.
 */
export function trendOfPosition(position: number, teamCount: number): Trend {
  if (!position || teamCount < 2) return 'flat';
  const matchup = (position - 1) / (teamCount - 1);
  if (matchup >= ARROW_UP) return 'up';
  if (matchup <= ARROW_DOWN) return 'down';
  return 'flat';
}

export function buildOpponents(
  schedule: CompetitionMatchdays,
  table: CompetitionTable,
  max = MAX_FIXTURES,
): OpponentsView {
  const fixtures = buildFixtures(schedule, max);
  const lists = Object.values(fixtures);
  const firstDays = lists.map((f) => f[0]?.day ?? 0).filter((day) => day > 0);
  return {
    fixtures,
    teams: buildTeamInfo(table),
    columns: lists.length === 0 ? 0 : Math.min(max, Math.max(...lists.map((f) => f.length))),
    teamCount: table.teams.length,
    nextDay: firstDays.length === 0 ? 0 : Math.min(...firstDays),
  };
}

/** Fields that change daily and should NOT be cached — pulled from squad. */
export interface SquadFreshFields {
  averagePoints: number;
  status: number;
  probability: number;
  teamId: string;
}

export interface ScoreResult {
  takenAt: number;
  formation: string;
  totalScore: number;
  byPlayer: Record<PlayerId, { score: number; detail: ScoreDetail }>;
  top11Ids: PlayerId[];
  /** True when no formation was viable (not enough available players). */
  formationFallback: boolean;
  /**
   * False heisst: der Verkauf aller übrigen Spieler bringt den Kontostand
   * nicht ins Plus, und zwar bei keiner der zehn Formationen. Der Optimizer
   * liefert dann trotzdem die beste Elf, die Fusszeile sagt es dazu.
   */
  budgetPlusOk: boolean;
  /** Die nächsten Ansetzungen je Verein, für die Gegner-Spalte. */
  opponents: OpponentsView;
  /**
   * Scores der übergebenen Marktspieler, auf derselben Skala wie der Kader.
   * Sie zählen nicht in die Elf: die Formation bleibt der bestehende Kader,
   * der Wert sagt nur, was der Zugang wert wäre.
   */
  marketByPlayer: Record<PlayerId, { score: number; detail: ScoreDetail }>;
  /**
   * Dieselben Details wie `weeklyDetails` im Kader-Cache, nur für
   * Marktspieler und nicht gespeichert: der Kader-Cache räumt alles weg, was
   * nicht im Kader steht (siehe `ComputeScoresInput.market`). Ohne dieses
   * Feld bliebe der Spielerdialog eines Transferkandidaten bei "Noch keine
   * Spieltage", obwohl der Score-Lauf die Daten längst abgerufen hat, nur
   * eben nicht dauerhaft ablegt.
   */
  marketWeeklyByPlayer: Record<PlayerId, OptimizerCacheWeekly>;
  /**
   * Die nächsten drei Ansetzungen je Verein, für den Spielerdialog. Die
   * Gegner-Spalte der Tabelle bleibt davon unberührt und zeigt weiter nur die
   * kommende, siehe `opponents.columns`.
   */
  fixturesAhead: Record<string, Fixture[]>;
  /**
   * Anstoss je Verein und Spieltag, für das Datum unter den Kacheln im
   * Spielerdialog. Deckt die ganze Saison ab, gespielt wie kommend.
   */
  kickoffs: Record<string, Record<number, string>>;
  /**
   * Zutaten für einen zweiten Optimizer-Lauf im Speicher, etwa "beste Elf ohne
   * diesen Spieler". Steht nur im Arbeitsspeicher, nichts davon wird
   * gespeichert.
   */
  lineupInput: LineupInput;
}

/** Was ein Optimizer-Lauf braucht, ohne dass dafür etwas geholt werden muss. */
export interface LineupInput {
  players: OptimizerPlayer[];
  table: CompetitionTable;
  budget: number;
}

/**
 * Die beste Elf noch einmal rechnen, diesmal ohne einen bestimmten Spieler.
 * Läuft rein lokal auf den Zutaten des letzten Laufs, ohne eine einzige
 * Abfrage. Sein Erlös liegt dabei auf dem Konto, sonst wäre die Rechnung für
 * den Kontostand danach falsch.
 */
export function bestElevenWithout(
  input: LineupInput,
  excludedId: PlayerId,
  saleValue = 0,
): OptimizerResult | null {
  const players = input.players.filter((p) => p.playerId !== excludedId);
  if (players.length === 0) return null;
  return new LineupOptimizer(players, input.table, input.budget + saleValue).optimize();
}

export interface ComputeScoresInput {
  client: Pick<
    KickbaseClient,
    'getCompetitionTable' | 'getCompetitionMatchdays' | 'getPlayerDetailsBatch'
  >;
  leagueId: LeagueId;
  squad: SquadPlayer[];
  squadFreshFields: Record<PlayerId, SquadFreshFields>;
  budget: number;
  /**
   * Marktspieler, die zusätzlich bewertet werden sollen, etwa die eigenen
   * offenen Gebote. Ihre Details kommen frisch, nicht aus dem Kader-Cache:
   * der räumt alles weg, was nicht im Kader steht.
   */
  market?: readonly MarketPlayer[];
}

export async function computeScores(input: ComputeScoresInput): Promise<ScoreResult> {
  const { client, leagueId, squad, squadFreshFields, budget } = input;

  // Der Spielplan darf den Score nicht aufhalten: fällt der Abruf aus, bleibt
  // die Gegner-Spalte leer und alles andere rechnet weiter.
  const [tableResult, schedule] = await Promise.all([
    client.getCompetitionTable(1),
    client.getCompetitionMatchdays(1).catch(() => EMPTY_SCHEDULE),
  ]);
  const tableMc = tableResult.teams.length === 0
    ? 0
    : Math.max(...tableResult.teams.map((t) => t.matchesPlayed));

  const cache = loadOptimizerCache(leagueId) ?? emptyOptimizerCache();

  // Pro Eintrag entscheiden, nicht global: ein Spieler, der beim letzten
  // Spieltagswechsel nicht im Kader war, behält sonst dauerhaft seinen
  // veralteten Eintrag, weil das globale `mc` längst hochgezählt ist.
  //
  // Ungleich, nicht kleiner: zur neuen Saison fällt `mc` von 34 auf 0. Mit
  // `<` gilt dann jeder Eintrag vom Saisonende weiter, und `mdsum` hätte
  // dauerhaft kein offenes Spiel mehr.
  const squadIds = squad.map((p) => p.id);
  const missing = squadIds.filter((id) => {
    const entry = cache.weeklyDetails[id];
    return !entry || entry.mc !== tableMc;
  });

  if (missing.length > 0) {
    const details = await client.getPlayerDetailsBatch(leagueId, missing);
    for (let i = 0; i < missing.length; i++) {
      const id = missing[i]!;
      const d = details[i]!;
      cache.weeklyDetails[id] = {
        mc: tableMc,
        firstName: d.firstName,
        statusText: d.statusText,
        matchSummary: d.matchSummary,
        lastMatchdayPoints: d.lastMatchdayPoints,
        hasPlayedFlags: d.hasPlayedFlags,
      };
    }
  }

  // Verkaufte Spieler räumen, sonst wächst der Eintrag über die Saison.
  const inSquad = new Set(squadIds);
  for (const id of Object.keys(cache.weeklyDetails)) {
    if (!inSquad.has(id)) delete cache.weeklyDetails[id];
  }

  cache.table = { takenAt: Date.now(), mc: tableMc, teams: tableResult.teams };

  const optimizerPlayers: OptimizerPlayer[] = squad.map((sp) => {
    const weekly = cache.weeklyDetails[sp.id];
    const fresh = squadFreshFields[sp.id]!;
    return {
      playerId: sp.id,
      name: sp.name,
      position: positionLabel(sp.position),
      positionCode: sp.position,
      marketValue: sp.marketValue,
      averagePoints: fresh.averagePoints,
      status: fresh.status,
      teamId: fresh.teamId,
      probability: fresh.probability,
      lastMatchdayPoints: weekly?.lastMatchdayPoints ?? [],
      hasPlayedFlags: weekly?.hasPlayedFlags ?? [],
      matchSummary: weekly?.matchSummary ?? [],
    };
  });

  const optimizer = new LineupOptimizer(optimizerPlayers, tableResult, budget);
  const result = optimizer.optimize();
  const takenAt = Date.now();
  const opponents = buildOpponents(schedule, tableResult, 1);
  // Zweite, längere Liste nur für den Spielerdialog. Nicht über `max` der
  // Gegner-Spalte lösen: die würde damit auf drei Wappen wachsen.
  const fixturesAhead = buildFixtures(schedule, MAX_FIXTURES);
  const kickoffs = buildKickoffs(schedule);
  const lineupInput: LineupInput = {
    players: optimizerPlayers,
    table: tableResult,
    budget,
  };
  const { byPlayer: marketByPlayer, weeklyByPlayer: marketWeeklyByPlayer } = await scoreMarketPlayers(
    optimizer,
    client,
    leagueId,
    input.market ?? [],
    tableMc,
  );

  let scoreResult: ScoreResult;
  if (result) {
    const byPlayer = mapByPlayerId(result);
    scoreResult = {
      takenAt,
      formation: result.formation,
      totalScore: result.totalScore,
      byPlayer,
      top11Ids: result.start11.map((p) => p.playerId),
      formationFallback: false,
      budgetPlusOk: result.budgetPlusOk,
      opponents,
      marketByPlayer,
      marketWeeklyByPlayer,
      fixturesAhead,
      kickoffs,
      lineupInput,
    };
  } else {
    // Fallback: optimize() returned null — score every player individually,
    // skip the formation search.
    const byPlayer: Record<PlayerId, { score: number; detail: ScoreDetail }> = {};
    for (const p of optimizerPlayers) {
      const detail = optimizer.scorePlayer(p);
      byPlayer[p.playerId] = { score: detail.score, detail };
    }
    scoreResult = {
      takenAt,
      formation: '',
      totalScore: 0,
      byPlayer,
      top11Ids: [],
      formationFallback: true,
      budgetPlusOk: true,
      opponents,
      marketByPlayer,
      marketWeeklyByPlayer,
      fixturesAhead,
      kickoffs,
      lineupInput,
    };
  }

  saveOptimizerCache(leagueId, cache);

  return scoreResult;
}

/**
 * Bewertet Marktspieler mit demselben Optimizer wie den Kader, damit die Zahl
 * neben einem Gebot mit den Zahlen darüber vergleichbar ist. Sie gehen nicht
 * in die Formation ein: `scorePlayer` rechnet einen einzelnen Spieler, ohne die
 * Elf neu zu suchen.
 *
 * Fällt der Detailabruf aus, bleibt die Spalte leer statt den ganzen Lauf
 * mitzureissen: die Gebote sind Beiwerk, der Kader ist die Hauptsache.
 *
 * Liefert die abgerufenen Spieltag-Details gleich mit zurück (`weeklyByPlayer`):
 * der Spielerdialog eines Transferkandidaten braucht sie, und ein zweiter
 * Abruf beim Öffnen des Dialogs wäre dieselbe Anfrage noch einmal.
 */
async function scoreMarketPlayers(
  optimizer: LineupOptimizer,
  client: ComputeScoresInput['client'],
  leagueId: LeagueId,
  market: readonly MarketPlayer[],
  tableMc: number,
): Promise<{
  byPlayer: Record<PlayerId, { score: number; detail: ScoreDetail }>;
  weeklyByPlayer: Record<PlayerId, OptimizerCacheWeekly>;
}> {
  const byPlayer: Record<PlayerId, { score: number; detail: ScoreDetail }> = {};
  const weeklyByPlayer: Record<PlayerId, OptimizerCacheWeekly> = {};
  if (market.length === 0) return { byPlayer, weeklyByPlayer };

  const details = await client
    .getPlayerDetailsBatch(
      leagueId,
      market.map((p) => p.id),
    )
    .catch(() => null);
  if (!details) return { byPlayer, weeklyByPlayer };

  for (let i = 0; i < market.length; i++) {
    const p = market[i]!;
    const d = details[i]!;
    const detail = optimizer.scorePlayer({
      playerId: p.id,
      name: p.name,
      position: positionLabel(p.position),
      positionCode: p.position,
      marketValue: p.marketValue,
      averagePoints: p.averagePoints || d.averagePoints,
      status: p.status,
      teamId: p.teamId || d.teamId,
      probability: p.probability || d.probability,
      lastMatchdayPoints: d.lastMatchdayPoints,
      hasPlayedFlags: d.hasPlayedFlags,
      matchSummary: d.matchSummary,
    });
    byPlayer[p.id] = { score: detail.score, detail };
    weeklyByPlayer[p.id] = {
      mc: tableMc,
      firstName: d.firstName,
      statusText: d.statusText,
      matchSummary: d.matchSummary,
      lastMatchdayPoints: d.lastMatchdayPoints,
      hasPlayedFlags: d.hasPlayedFlags,
    };
  }
  return { byPlayer, weeklyByPlayer };
}

function mapByPlayerId(
  result: OptimizerResult,
): Record<PlayerId, { score: number; detail: ScoreDetail }> {
  const out: Record<PlayerId, { score: number; detail: ScoreDetail }> = {};
  for (const p of [...result.start11, ...result.bench]) {
    out[p.playerId] = { score: p.score, detail: p.scoreDetail };
  }
  return out;
}
