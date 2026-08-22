/**
 * LineupOptimizer — TypeScript port of `apps-script/LineupOptimizer.js`.
 *
 * Pure: no DOM, no fetch, no localStorage. Picks the strongest legal Kickbase
 * starting eleven from the user's squad over all 10 valid formations, with
 * optional pair effects (synergies/conflicts) between own players.
 *
 * Formationssuche, Budget-Rettung und Paar-Effekte sind unverändert aus dem
 * Apps Script übernommen. Die Spieler-Bewertung ist es nicht mehr: gestufte
 * Verfügbarkeit als Faktor, geknickte Wahrscheinlichkeits-Leiter,
 * Form-Fenster 50..170 und Matchup ohne Positionsabhängigkeit weichen
 * bewusst ab. Gleiche Eingaben liefern in beiden Implementierungen deshalb
 * verschiedene Scores.
 *
 * Zwei Sätze Gewichte: {@link DISPLAY_WEIGHTS} für die Zahl in der Tabelle,
 * {@link SELECTION_WEIGHTS} für die Elf. Der Unterschied ist der Gegner.
 */

import type {
  CompetitionTable,
  MatchSummary,
  PlayerId,
  PositionCode,
} from '../api/types.js';

export type PositionLabel = 'TW' | 'ABW' | 'MF' | 'ANG';

const POSITION_LABEL: Record<PositionCode, PositionLabel> = {
  1: 'TW',
  2: 'ABW',
  3: 'MF',
  4: 'ANG',
};

export interface OptimizerPlayer {
  playerId: PlayerId;
  name: string;
  position: PositionLabel;
  positionCode: PositionCode;
  marketValue: number;
  averagePoints: number;
  status: number;
  teamId: string;
  probability: number;
  lastMatchdayPoints: number[];
  hasPlayedFlags: boolean[];
  matchSummary: MatchSummary[];
}

export interface ScoreDetail {
  /** Overall composite score 0..1 (or 0 if availability=0). */
  score: number;
  /** Form factor 0..1 (decay-blended). */
  form: number;
  /** Raw form value (geblendet, NOT the season average) — for the tooltip. */
  formRaw: number;
  /** Start probability factor 0..1. */
  startProb: number;
  /** Matchup factor 0..1. */
  matchup: number;
  /** Availability factor: 1 (fit) or 0 (anything else). */
  availability: number;
}

export interface ScoredPlayer extends OptimizerPlayer {
  score: number;
  /**
   * Score, mit dem ausgewählt wird: derselbe Wert plus Gegner-Anteil.
   * Angezeigt wird ohne Gegner, entschieden wird bei fast gleichem Stand mit
   * ihm. Nur wenn Anzeige- und Auswahlgewichte identisch sind, sind auch die
   * beiden Zahlen gleich.
   */
  selScore: number;
  scoreDetail: ScoreDetail;
}

export interface PairEffect {
  type: 'synergy' | 'conflict';
  a: ScoredPlayer;
  b: ScoredPlayer;
  /** Signed contribution (positive for synergy, negative for conflict). */
  adj: number;
}

export interface OptimizerResult {
  formation: string;
  budgetPlusOk: boolean;
  projectedBalance: number;
  /** baseScore + pairDelta. */
  totalScore: number;
  baseScore: number;
  /** Sum of pair contributions (already capped). */
  pairDelta: number;
  pairs: PairEffect[];
  start11: ScoredPlayer[];
  bench: ScoredPlayer[];
}

export interface OptimizerWeights {
  form: number;
  startProb: number;
  matchup: number;
  availability: number;
}

/**
 * Anzeigegewichte, ohne Gegner. Der Score sagt, wie gut der Spieler selbst
 * gerade ist. Wer sein nächster Gegner ist, steht daneben in der eigenen
 * Spalte. Sonst schwankte die Zahl mit der Tabelle, ohne dass sich am Spieler
 * etwas geändert hätte, und zwei gleich starke Spieler wären nur wegen ihrer
 * Ansetzung verschieden hoch.
 */
export const DISPLAY_WEIGHTS: OptimizerWeights = {
  form: 0.35,
  startProb: 0.55,
  matchup: 0,
  availability: 0.10,
};

/**
 * Auswahlgewichte, mit Gegner. Wer in die Elf kommt, entscheidet er bei fast
 * gleichem Stand mit; die angezeigte Zahl verschiebt er nicht.
 */
export const SELECTION_WEIGHTS: OptimizerWeights = {
  form: 0.30,
  startProb: 0.45,
  matchup: 0.15,
  availability: 0.10,
};

export const VALID_FORMATIONS = [
  '4-4-2', '4-2-4', '3-4-3', '4-3-3', '5-3-2',
  '3-5-2', '5-4-1', '4-5-1', '3-6-1', '5-2-3',
] as const;

interface PositionWeightMatrix {
  1: { 1: number; 2: number; 3: number; 4: number };
  2: { 1: number; 2: number; 3: number; 4: number };
  3: { 1: number; 2: number; 3: number; 4: number };
  4: { 1: number; 2: number; 3: number; 4: number };
}

interface TeamStrength {
  teamName: string;
  position: number;
  points: number;
  matchesPlayed: number;
  goalDifference: number;
  /** 1 = Tabellenführer, 0 = Letzter. Einzige Stärke-Kennzahl. */
  overall: number;
}

/**
 * Unter so vielen gespielten Spielen sagt der Tabellenplatz nichts (in der
 * Vorbereitung steht die ganze Liga auf 0 Punkten). Bis dahin liefert
 * {@link computeMatchup} neutrale 0.5 statt Rauschen.
 */
const MIN_TABLE_MATCHES = 3;

export class LineupOptimizer {
  private readonly players: OptimizerPlayer[];
  private readonly budget: number;
  private readonly weights: OptimizerWeights;
  private readonly selectionWeights: OptimizerWeights;
  private readonly pairEffectsEnabled: boolean;
  private readonly pairStrength = 0.03;
  private readonly pairSafetyCap = 0.10;
  private readonly teamStrengths: Record<string, TeamStrength>;
  private readonly nextOpponents: Record<string, string>;
  private readonly conflictWeights: PositionWeightMatrix;
  private readonly synergyWeights: PositionWeightMatrix;

  constructor(
    players: OptimizerPlayer[],
    competitionTable: CompetitionTable | null,
    budget: number,
    weights: OptimizerWeights = DISPLAY_WEIGHTS,
    pairEffects = true,
    /**
     * Gewichte für die Auswahl. Standard ist der Satz mit Gegner, die Anzeige
     * bleibt ohne. Wer beides gleich haben will, gibt hier dieselben Gewichte
     * mit wie oben.
     */
    selectionWeights: OptimizerWeights = SELECTION_WEIGHTS,
  ) {
    this.players = players;
    this.budget = budget;
    this.weights = weights;
    this.selectionWeights = selectionWeights;
    this.pairEffectsEnabled = pairEffects;
    this.teamStrengths = buildTeamStrengths(competitionTable);
    this.nextOpponents = buildNextOpponents(players);
    this.conflictWeights = this.buildSymmetricMatrix({
      1: { 2: 0.0, 3: 0.6, 4: 0.9 },
      2: {         3: 0.5, 4: 0.8 },
      3: {                 4: 0.4 },
      4: {},
      diag: { 1: 0.0, 2: 0.2, 3: 0.3, 4: 0.2 },
    });
    this.synergyWeights = this.buildSymmetricMatrix({
      1: { 2: 0.5, 3: 0.2, 4: 0.1 },
      2: {         3: 0.2, 4: 0.2 },
      3: {                 4: 0.5 },
      4: {},
      diag: { 1: 0.0, 2: 0.3, 3: 0.2, 4: 0.2 },
    });
  }

  // -- Symmetric matrix builder --
  private buildSymmetricMatrix(spec: {
    1: Partial<{ 2: number; 3: number; 4: number }>;
    2: Partial<{ 3: number; 4: number }>;
    3: Partial<{ 4: number }>;
    4: Record<string, never>;
    diag: { 1: number; 2: number; 3: number; 4: number };
  }): PositionWeightMatrix {
    const m: PositionWeightMatrix = {
      1: { 1: 0, 2: 0, 3: 0, 4: 0 },
      2: { 1: 0, 2: 0, 3: 0, 4: 0 },
      3: { 1: 0, 2: 0, 3: 0, 4: 0 },
      4: { 1: 0, 2: 0, 3: 0, 4: 0 },
    };
    m[1][1] = spec.diag[1];
    m[2][2] = spec.diag[2];
    m[3][3] = spec.diag[3];
    m[4][4] = spec.diag[4];
    for (const [j, v] of Object.entries(spec[1])) {
      const k = Number(j) as 2 | 3 | 4;
      m[1][k] = v as number;
      m[k][1] = v as number;
    }
    for (const [j, v] of Object.entries(spec[2])) {
      const k = Number(j) as 3 | 4;
      m[2][k] = v as number;
      m[k][2] = v as number;
    }
    for (const [j, v] of Object.entries(spec[3])) {
      const k = Number(j) as 4;
      m[3][k] = v as number;
      m[k][3] = v as number;
    }
    return m;
  }

  // -- Per-player score --
  scorePlayer(player: OptimizerPlayer, weights: OptimizerWeights = this.weights): ScoreDetail {
    const availability = computeAvailability(player.status);
    if (availability === 0) {
      return { score: 0, form: 0, formRaw: 0, startProb: 0, matchup: 0, availability: 0 };
    }
    const formResult = computeForm(
      player.averagePoints,
      player.lastMatchdayPoints,
      player.hasPlayedFlags,
    );
    const startProb = computeStartProbability(player.hasPlayedFlags, player.probability);
    const matchup = computeMatchup(player.teamId, this.nextOpponents, this.teamStrengths);
    const w = weights;
    // availability skaliert den Gesamtscore, statt als eigener Summand nur
    // w.availability zu verschieben. Für fitte Spieler (1.0) ändert das
    // nichts; eine 0.7 kostet jetzt 30 % des Scores statt 3 Punkten.
    const score =
      (w.form * formResult.value +
        w.startProb * startProb +
        w.matchup * matchup +
        w.availability) *
      availability;
    return {
      score,
      form: formResult.value,
      formRaw: formResult.raw,
      startProb,
      matchup,
      availability,
    };
  }

  // -- Pair effects (synergies + conflicts) --
  pairAdjustment(lineup: ScoredPlayer[]): { delta: number; pairs: PairEffect[] } {
    const result: { delta: number; pairs: PairEffect[] } = { delta: 0, pairs: [] };
    if (!this.pairEffectsEnabled || lineup.length === 0) return result;
    let baseTotal = 0;
    for (const p of lineup) baseTotal += p.score;
    let delta = 0;
    const pairs: PairEffect[] = [];
    for (let i = 0; i < lineup.length; i++) {
      for (let j = i + 1; j < lineup.length; j++) {
        const a = lineup[i]!;
        const b = lineup[j]!;
        if (!a.teamId || !b.teamId) continue;
        const pa = a.positionCode;
        const pb = b.positionCode;
        const base = this.pairStrength * Math.min(a.score, b.score);
        if (base <= 0) continue;
        if (a.teamId === b.teamId) {
          const ws = this.synergyWeights[pa][pb];
          if (ws > 0) {
            const adj = base * ws;
            delta += adj;
            pairs.push({ type: 'synergy', a, b, adj });
          }
        } else if (this.nextOpponents[a.teamId] === b.teamId) {
          const wc = this.conflictWeights[pa][pb];
          if (wc > 0) {
            const adj = base * wc;
            delta -= adj;
            pairs.push({ type: 'conflict', a, b, adj: -adj });
          }
        }
      }
    }
    const cap = baseTotal * this.pairSafetyCap;
    if (delta > cap) delta = cap;
    if (delta < -cap) delta = -cap;
    result.delta = delta;
    result.pairs = pairs;
    return result;
  }

  // -- Local search: swap starter ↔ bencher of same position when total improves --
  refineWithPairEffects(
    start11: ScoredPlayer[],
    bench: ScoredPlayer[],
    baseSum: number,
    pairDelta: number,
    benchValue: number,
  ): {
    start11: ScoredPlayer[];
    bench: ScoredPlayer[];
    baseSum: number;
    pairDelta: number;
    benchValue: number;
  } {
    let curStart = [...start11];
    let curBench = [...bench];
    let curBase = baseSum;
    let curPair = pairDelta;
    let curBenchValue = benchValue;
    let improved = true;
    let passes = 3;
    while (improved && passes > 0) {
      improved = false;
      passes--;
      outer: for (let i = 0; i < curStart.length; i++) {
        const starter = curStart[i]!;
        for (let j = 0; j < curBench.length; j++) {
          const benchP = curBench[j]!;
          if (benchP.position !== starter.position) continue;
          if (benchP.score <= 0) continue;
          const trialBenchValue = curBenchValue - benchP.marketValue + starter.marketValue;
          if (this.budget + trialBenchValue < 0) continue;
          const trial = [...curStart];
          trial[i] = benchP;
          const trialBase = curBase - starter.selScore + benchP.selScore;
          const trialPairDelta = this.pairAdjustment(trial).delta;
          const currentTotal = curBase + curPair;
          const trialTotal = trialBase + trialPairDelta;
          if (trialTotal > currentTotal + 1e-9) {
            curStart = trial;
            const newBench = [...curBench];
            newBench[j] = starter;
            curBench = newBench;
            curBase = trialBase;
            curPair = trialPairDelta;
            curBenchValue = trialBenchValue;
            improved = true;
            break outer;
          }
        }
      }
    }
    return {
      start11: curStart,
      bench: curBench,
      baseSum: curBase,
      pairDelta: curPair,
      benchValue: curBenchValue,
    };
  }

  /**
   * Budget-Rettung: teure Starter gegen günstigere Bankspieler gleicher
   * Position tauschen, bis `budget + Bankwert >= 0` ist.
   *
   * Zwei Punkte gegenüber der Apps-Script-Vorlage: es wird so lange
   * nachgetauscht, wie nötig und möglich, statt genau einmal. Und wenn das
   * Konto danach immer noch im Minus steht, gibt die Methode `null` zurück
   * statt eines halb getauschten Kaders. Ein Tausch, der die Lücke nicht
   * schließt, ist reiner Score-Verlust ohne Gegenwert: `budgetPlusOk` bleibt
   * so oder so false.
   *
   * Terminiert, weil jeder Tausch den Bankwert echt erhöht und die
   * Rückrichtung durch die Score-Bedingung ausgeschlossen ist.
   */
  fixBudget(
    start11: ScoredPlayer[],
    bench: ScoredPlayer[],
  ): {
    start11: ScoredPlayer[];
    bench: ScoredPlayer[];
    totalScore: number;
    benchValue: number;
  } | null {
    let curStart = start11;
    let curBench = bench;
    let benchValue = curBench.reduce((s, p) => s + p.marketValue, 0);
    let swapped = false;

    for (let pass = 0; pass < start11.length && this.budget + benchValue < 0; pass++) {
      const best = this.bestBudgetSwap(curStart, curBench);
      if (!best) break;
      const out = curStart[best.starterIdx]!;
      const incoming = curBench[best.benchIdx]!;
      curStart = [...curStart];
      curBench = [...curBench];
      curStart[best.starterIdx] = incoming;
      curBench[best.benchIdx] = out;
      benchValue += out.marketValue - incoming.marketValue;
      swapped = true;
    }

    if (!swapped || this.budget + benchValue < 0) return null;
    return {
      start11: curStart,
      bench: curBench,
      totalScore: curStart.reduce((s, p) => s + p.score, 0),
      benchValue,
    };
  }

  /** Tausch mit dem meisten freigesetzten Marktwert je verlorenem Score-Punkt. */
  private bestBudgetSwap(
    start11: ScoredPlayer[],
    bench: ScoredPlayer[],
  ): { starterIdx: number; benchIdx: number; ratio: number } | null {
    let bestSwap: { starterIdx: number; benchIdx: number; ratio: number } | null = null;
    for (let i = 0; i < start11.length; i++) {
      const starter = start11[i]!;
      for (let j = 0; j < bench.length; j++) {
        const benchP = bench[j]!;
        if (benchP.position !== starter.position) continue;
        // Score 0 heißt Ausfall. Die Greedy-Auswahl lässt solche Spieler
        // nicht in die Elf, die Budget-Rettung darf sie nicht hintenrum
        // hineinschieben.
        if (benchP.score <= 0) continue;
        if (benchP.selScore >= starter.selScore) continue;
        const valueDiff = starter.marketValue - benchP.marketValue;
        if (valueDiff <= 0) continue;
        const scoreLoss = starter.selScore - benchP.selScore;
        const ratio = valueDiff / (scoreLoss + 0.001);
        if (!bestSwap || ratio > bestSwap.ratio) {
          bestSwap = { starterIdx: i, benchIdx: j, ratio };
        }
      }
    }
    return bestSwap;
  }

  // -- Evaluate one specific formation --
  evaluateFormation(formation: string): OptimizerResult | null {
    const sameWeights = this.selectionWeights === this.weights;
    const scored: ScoredPlayer[] = this.players.map((p) => {
      const detail = this.scorePlayer(p);
      // Ausgewählt wird nach `selScore`, angezeigt und summiert wird `score`.
      const selScore = sameWeights
        ? detail.score
        : this.scorePlayer(p, this.selectionWeights).score;
      return { ...p, score: detail.score, selScore, scoreDetail: detail };
    });

    const byPosition: Record<PositionLabel, ScoredPlayer[]> = {
      TW: [],
      ABW: [],
      MF: [],
      ANG: [],
    };
    for (const sp of scored) {
      byPosition[sp.position].push(sp);
    }
    for (const pos of ['TW', 'ABW', 'MF', 'ANG'] as const) {
      byPosition[pos].sort((a, b) => b.selScore - a.selScore);
    }

    const parts = formation.split('-');
    const required: Record<PositionLabel, number> = {
      TW: 1,
      ABW: parseInt(parts[0] ?? '0', 10),
      MF: parseInt(parts[1] ?? '0', 10),
      ANG: parseInt(parts[2] ?? '0', 10),
    };

    let start11: ScoredPlayer[] = [];
    for (const pos of ['TW', 'ABW', 'MF', 'ANG'] as const) {
      const available = byPosition[pos].filter((p) => p.score > 0);
      if (available.length < required[pos]) return null;
      for (let i = 0; i < required[pos]; i++) start11.push(available[i]!);
    }
    const start11Ids = new Set(start11.map((p) => p.playerId));
    let bench: ScoredPlayer[] = scored.filter((p) => !start11Ids.has(p.playerId));
    let benchValue = bench.reduce((s, p) => s + p.marketValue, 0);
    let projectedBalance = this.budget + benchValue;
    let budgetPlusOk = projectedBalance >= 0;
    let totalScore = start11.reduce((s, p) => s + p.score, 0);

    if (!budgetPlusOk) {
      const fix = this.fixBudget(start11, bench);
      if (fix) {
        start11 = fix.start11;
        bench = fix.bench;
        totalScore = fix.totalScore;
        benchValue = fix.benchValue;
        projectedBalance = this.budget + benchValue;
        budgetPlusOk = projectedBalance >= 0;
      }
    }

    let pairResult = this.pairAdjustment(start11);
    if (this.pairEffectsEnabled && budgetPlusOk) {
      // Getauscht wird nach den Auswahl-Werten, sonst dreht die Nachbesserung
      // den Stichentscheid gleich wieder zurück.
      const refined = this.refineWithPairEffects(
        start11,
        bench,
        start11.reduce((s, p) => s + p.selScore, 0),
        pairResult.delta,
        benchValue,
      );
      start11 = refined.start11;
      bench = refined.bench;
      // Berichtet wird immer die Summe der reinen Scores.
      totalScore = start11.reduce((s, p) => s + p.score, 0);
      benchValue = refined.benchValue;
      projectedBalance = this.budget + benchValue;
      pairResult = this.pairAdjustment(start11);
    }

    return {
      formation,
      budgetPlusOk,
      projectedBalance,
      totalScore: totalScore + pairResult.delta,
      baseScore: totalScore,
      pairDelta: pairResult.delta,
      pairs: pairResult.pairs,
      start11,
      bench,
    };
  }

  // -- Top-level: try all formations, pick the best --
  optimize(): OptimizerResult | null {
    let best: OptimizerResult | null = null;
    for (const formation of VALID_FORMATIONS) {
      const candidate = this.evaluateFormation(formation);
      if (!candidate) continue;
      if (!best) {
        best = candidate;
        continue;
      }
      // Prefer budget-valid; then higher totalScore; then higher projectedBalance.
      if (candidate.budgetPlusOk && !best.budgetPlusOk) {
        best = candidate;
      } else if (candidate.budgetPlusOk === best.budgetPlusOk) {
        if (candidate.totalScore > best.totalScore) {
          best = candidate;
        } else if (
          candidate.totalScore === best.totalScore &&
          candidate.projectedBalance > best.projectedBalance
        ) {
          best = candidate;
        }
      }
    }
    return best;
  }
}

// ===== Free-function helpers (also exposed via _internal for tests) =====

/**
 * Verfügbarkeit (gestuft), wirkt als Faktor auf den Gesamtscore. Status 0
 * (fit) zählt voll, 1 mit 70 %, alles andere ist Knockout.
 *
 * Belegt sind aus echten Responses nur 0 (fit) und 2 (Ausfall, `stxt` z. B.
 * "Back problems - misses the friendly"). Was Kickbase unter 1 führt, ist
 * ungeklärt; die 70-%-Stufe ist bis dahin unbenutzt.
 */
function computeAvailability(status: number): number {
  if (status === 0) return 1.0;
  if (status === 1) return 0.7;
  return 0.0;
}

/**
 * Form: recency-gewichteter Durchschnitt der letzten gespielten Spieltage
 * (Decay 0.7), 70/30 mit dem Saison-Schnitt geblendet, normalisiert auf
 * 50..170 Punkte. Untere Grenze 50, weil selbst Reservisten rund 50
 * Saisonschnitt machen; 30 wäre unrealistisch und würde das Mittelfeld
 * zusammenstauchen.
 *
 * `lastMatchdayPoints` und `hasPlayedFlags` kommen jüngster Spieltag zuerst
 * (verifiziert, siehe `PlayerDetails.lastMatchdayPoints`). Index 0 bekommt
 * deshalb das volle Gewicht 0.7^0. Kippt die Reihenfolge, kippt die Form.
 */
function computeForm(
  averagePoints: number,
  lastMatchdayPoints: number[],
  hasPlayedFlags: boolean[],
): { value: number; raw: number } {
  const ap = averagePoints || 0;
  const pts = lastMatchdayPoints || [];
  const hpf = hasPlayedFlags || [];
  const floor = 50;
  const range = 120; // 170 - 50
  if (pts.length === 0) {
    return { value: clamp01((ap - floor) / range), raw: ap };
  }
  const decayFactor = 0.7;
  let weightedSum = 0;
  let weightTotal = 0;
  let decayIndex = 0;
  for (let i = 0; i < pts.length; i++) {
    if (hpf[i]) {
      const weight = Math.pow(decayFactor, decayIndex);
      weightedSum += (pts[i] ?? 0) * weight;
      weightTotal += weight;
      decayIndex++;
    }
  }
  if (weightTotal === 0) {
    return { value: clamp01((ap - floor) / range), raw: ap };
  }
  const recentAvg = weightedSum / weightTotal;
  const blended = 0.7 * recentAvg + 0.3 * ap;
  return { value: clamp01((blended - floor) / range), raw: blended };
}

/**
 * Probability-Mapping geknickt statt linear. Stammspieler (1) ↔ wahrschein-
 * licher Starter (2) liegen in der Realität näher beieinander, als die
 * Kickbase-Skala suggeriert.
 */
const PROB_MAPPING: Record<number, number> = {
  1: 1.0,
  2: 0.85,
  3: 0.65,
  4: 0.4,
  5: 0.2,
};

/**
 * Anteil, den die Kickbase-Prognose an der Startelf-Schätzung hält. Der Rest
 * kommt aus der Einsatzhistorie.
 */
const PROB_FORECAST_WEIGHT = 0.7;

/**
 * Startelf-Schätzung: Kickbase-Prognose, gegen die eigenen Einsätze
 * gegengerechnet.
 *
 * Die Prognose ist eine Meinung über den nächsten Spieltag, die Historie ist
 * gemessen. Wo beide dasselbe sagen, ändert die Mischung nichts; wo sie
 * auseinanderlaufen, etwa "sicher" für jemanden, der seit sechs Spieltagen
 * nicht auflief, zieht sie den Wert Richtung Wirklichkeit.
 */
function computeStartProbability(hasPlayedFlags: boolean[], probability: number): number {
  const mapped = PROB_MAPPING[probability];
  const fromHistory = startShareFromHistory(hasPlayedFlags);
  // prob 0 heißt "keine Angabe"; alles ausserhalb 1..5 behandeln wir genauso
  // und schätzen allein aus der Historie, statt den 45-%-Faktor still auf 0
  // fallen zu lassen.
  if (mapped === undefined) return fromHistory ?? 0.5;
  // Ohne Historie gibt es nichts gegenzurechnen. Ein Neuzugang würde sonst
  // für Spieltage bestraft, an denen er gar nicht dabei sein konnte.
  if (fromHistory === null) return mapped;
  return PROB_FORECAST_WEIGHT * mapped + (1 - PROB_FORECAST_WEIGHT) * fromHistory;
}

/**
 * Anteil der Spieltage mit Einsatz, abklingend gewichtet. Index 0 ist der
 * jüngste Spieltag. `null`, wenn es keine Historie gibt.
 */
function startShareFromHistory(hasPlayedFlags: boolean[]): number | null {
  if (hasPlayedFlags.length === 0) return null;
  const decayFactor = 0.75;
  let weightedPlayed = 0;
  let weightTotal = 0;
  for (let i = 0; i < hasPlayedFlags.length; i++) {
    const weight = Math.pow(decayFactor, i);
    weightedPlayed += (hasPlayedFlags[i] ? 1 : 0) * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedPlayed / weightTotal : null;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Teamstärke ausschliesslich aus dem Tabellenplatz.
 *
 * Die früher hier gerechnete Tor-Verfeinerung (Angriff/Abwehr getrennt aus
 * `mdsum`) war unerreichbar: `mdsum` liefert nur ein Fenster von rund drei
 * Spieltagen, die Schwelle von fünf beendeten Spielen pro Team wurde nie
 * erreicht. Angriff und Abwehr waren damit immer identisch. Die Tabelle
 * selbst führt keine Tore für/gegen, nur Tordifferenz, also lässt sich
 * beides auch daraus nicht trennen.
 */
function buildTeamStrengths(table: CompetitionTable | null): Record<string, TeamStrength> {
  const out: Record<string, TeamStrength> = {};
  if (!table || !Array.isArray(table.teams) || table.teams.length === 0) {
    return out;
  }
  const played = Math.max(...table.teams.map((t) => t.matchesPlayed));
  if (played < MIN_TABLE_MATCHES) return out;
  const total = table.teams.length;
  for (const t of table.teams) {
    out[t.id] = {
      teamName: t.name,
      position: t.position,
      points: t.points,
      matchesPlayed: t.matchesPlayed,
      goalDifference: t.goalDifference,
      overall: total === 1 ? 1 : 1 - (t.position - 1) / (total - 1),
    };
  }
  return out;
}

function buildNextOpponents(players: OptimizerPlayer[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of players) {
    if (!p.teamId || out[p.teamId]) continue;
    for (const m of p.matchSummary ?? []) {
      if (m.state === 0) {
        out[p.teamId] = m.team1Id === p.teamId ? m.team2Id : m.team1Id;
        break;
      }
    }
  }
  return out;
}

/**
 * Stärke des nächsten Gegners, invertiert: schwacher Gegner = hoher Wert.
 * 0.5 (neutral), solange Gegner oder Tabelle nichts hergeben.
 *
 * Nicht positionsabhängig. Die Trennung TW/ABW gegen gegnerischen Angriff
 * und MF/ANG gegen gegnerische Abwehr braucht Tore für/gegen pro Team, die
 * keine der genutzten Responses liefert.
 */
function computeMatchup(
  teamId: string,
  nextOpponents: Record<string, string>,
  teamStrengths: Record<string, TeamStrength>,
): number {
  if (!teamId) return 0.5;
  const opponentId = nextOpponents[teamId];
  if (!opponentId) return 0.5;
  const opp = teamStrengths[opponentId];
  if (!opp) return 0.5;
  return 1 - opp.overall;
}

/** Used by `score.ts` to convert raw {@link OptimizerPlayer} fields. */
export function positionLabel(code: PositionCode): PositionLabel {
  return POSITION_LABEL[code];
}

/** Test-only: do not import outside `tests/`. */
export const _internal = {
  computeAvailability,
  computeForm,
  computeStartProbability,
  buildTeamStrengths,
  buildNextOpponents,
  computeMatchup,
  scorePlayer: (opt: LineupOptimizer, p: OptimizerPlayer): ScoreDetail => opt.scorePlayer(p),
};
