import { describe, expect, it } from 'vitest';
import type { CompetitionTable, PositionCode } from '../src/api/types.js';
import {
  LineupOptimizer,
  SELECTION_WEIGHTS,
  VALID_FORMATIONS,
  _internal,
  positionLabel,
  type OptimizerPlayer,
  type PositionLabel,
  type ScoreDetail,
  type ScoredPlayer,
} from '../src/compute/optimizer.js';

function makePlayer(overrides: Partial<OptimizerPlayer> = {}): OptimizerPlayer {
  return {
    playerId: overrides.playerId ?? '',
    name: overrides.name ?? '',
    position: overrides.position ?? 'MF',
    positionCode: overrides.positionCode ?? 3,
    marketValue: overrides.marketValue ?? 0,
    averagePoints: overrides.averagePoints ?? 0,
    status: overrides.status ?? 0,
    teamId: overrides.teamId ?? '',
    probability: overrides.probability ?? 0,
    lastMatchdayPoints: overrides.lastMatchdayPoints ?? [],
    hasPlayedFlags: overrides.hasPlayedFlags ?? [],
    matchSummary: overrides.matchSummary ?? [],
  };
}

function makeScored(overrides: {
  playerId: string;
  score: number;
  position?: PositionLabel;
  positionCode?: PositionCode;
  teamId?: string;
  marketValue?: number;
  scoreDetail?: ScoreDetail;
}): ScoredPlayer {
  const base = makePlayer({
    playerId: overrides.playerId,
    name: overrides.playerId,
    position: overrides.position ?? 'MF',
    positionCode: overrides.positionCode ?? 3,
    teamId: overrides.teamId ?? '',
    marketValue: overrides.marketValue ?? 0,
  });
  return {
    ...base,
    score: overrides.score,
    selScore: overrides.score,
    scoreDetail: overrides.scoreDetail ?? {
      score: overrides.score,
      form: 0,
      formRaw: 0,
      startProb: 0,
      matchup: 0,
      availability: 1,
    },
  };
}

describe('LineupOptimizer', () => {
  describe('constants', () => {
    it('has the 10 Kickbase formations in canonical order', () => {
      expect(VALID_FORMATIONS).toEqual([
        '4-4-2', '4-2-4', '3-4-3', '4-3-3', '5-3-2',
        '3-5-2', '5-4-1', '4-5-1', '3-6-1', '5-2-3',
      ]);
    });
  });

  describe('positionLabel helper', () => {
    it('maps position codes to labels', () => {
      expect(positionLabel(1)).toBe('TW');
      expect(positionLabel(2)).toBe('ABW');
      expect(positionLabel(3)).toBe('MF');
      expect(positionLabel(4)).toBe('ANG');
    });
  });
});

describe('computeAvailability', () => {
  const { computeAvailability } = _internal;

  it('grades status: 0 → 1.0, 1 → 0.7, anything else → 0 (2 = Ausfall, real belegt)', () => {
    expect(computeAvailability(0)).toBe(1.0);
    expect(computeAvailability(1)).toBe(0.7);
    expect(computeAvailability(2)).toBe(0);
    expect(computeAvailability(4)).toBe(0);
  });
});

describe('computeForm', () => {
  const { computeForm } = _internal;

  it('falls back to averagePoints scaled to 50..170 when no matchday history exists', () => {
    expect(computeForm(110, [], [])).toEqual({ value: 0.5, raw: 110 });
    expect(computeForm(50, [], [])).toEqual({ value: 0, raw: 50 });
    expect(computeForm(170, [], [])).toEqual({ value: 1, raw: 170 });
    expect(computeForm(30, [], [])).toEqual({ value: 0, raw: 30 });
  });

  it('blends recent decayed matchdays (0.7^i) with averagePoints (70/30)', () => {
    // pts = [100, 90, 80], all played → weights 1, 0.7, 0.49 → totalWeight 2.19
    // weightedSum = 100 + 63 + 39.2 = 202.2
    // recentAvg = 202.2 / 2.19 ≈ 92.32877
    // blended = 0.7 * 92.32877 + 0.3 * 110 = 97.63014
    // value = (97.63014 - 50) / 120 ≈ 0.39692
    const result = computeForm(110, [100, 90, 80], [true, true, true]);
    expect(result.raw).toBeCloseTo(97.63014, 3);
    expect(result.value).toBeCloseTo(0.39692, 3);
  });

  it('skips matchdays where hasPlayed=false (decay index advances only on played)', () => {
    // played sequence: just 100 (weight 1.0). recentAvg = 100. blended = 0.7*100 + 0.3*80 = 94.
    // value = (94 - 50)/120 ≈ 0.3667.
    const result = computeForm(80, [100, 0], [true, false]);
    expect(result.raw).toBeCloseTo(94, 6);
    expect(result.value).toBeCloseTo(0.3667, 3);
  });

  it('falls back to averagePoints when every flag is false', () => {
    expect(computeForm(80, [10, 20, 30], [false, false, false])).toEqual({
      value: (80 - 50) / 120,
      raw: 80,
    });
  });

  it('clamps to [0, 1]', () => {
    expect(computeForm(170, [400], [true]).value).toBe(1);
    expect(computeForm(0, [-100], [true]).value).toBe(0);
  });
});

describe('computeStartProbability', () => {
  const { computeStartProbability } = _internal;

  it('uses the piecewise mapping 1→1.0, 2→0.85, 3→0.65, 4→0.4, 5→0.2', () => {
    expect(computeStartProbability([], 1)).toBe(1.0);
    expect(computeStartProbability([], 2)).toBe(0.85);
    expect(computeStartProbability([], 3)).toBe(0.65);
    expect(computeStartProbability([], 4)).toBe(0.4);
    expect(computeStartProbability([], 5)).toBe(0.2);
  });

  it('falls back to decayed hasPlayedFlags when prob is 0', () => {
    // weights 1, 0.75, 0.5625; played = true,true,false
    // weighted = 1 + 0.75 = 1.75; total = 2.3125; ratio ≈ 0.7568
    expect(computeStartProbability([true, true, false], 0)).toBeCloseTo(0.7568, 3);
  });

  it('returns 0.5 when prob is 0 and there is no history', () => {
    expect(computeStartProbability([], 0)).toBe(0.5);
  });

  it('falls back to the history for values outside 1..5 instead of scoring 0', () => {
    expect(computeStartProbability([true, true, false], 9)).toBeCloseTo(0.7568, 3);
    expect(computeStartProbability([], 9)).toBe(0.5);
  });

  it('blends the forecast 70/30 with the history when both are there', () => {
    // history ≈ 0.7568 (siehe oben): 0.7 * 1.0 + 0.3 * 0.7568 ≈ 0.9270
    expect(computeStartProbability([true, true, false], 1)).toBeCloseTo(0.927, 3);
  });

  it('leaves a regular untouched because forecast and history agree', () => {
    expect(computeStartProbability([true, true, true], 1)).toBeCloseTo(1.0, 6);
  });

  it('damps a sure starter who has not played in a while', () => {
    // history 0: 0.7 * 1.0 + 0.3 * 0 = 0.7
    expect(computeStartProbability([false, false, false, false], 1)).toBeCloseTo(0.7, 6);
  });
});

describe('buildTeamStrengths', () => {
  const { buildTeamStrengths } = _internal;

  function tableWith(mc: number): CompetitionTable {
    return {
      teams: [
        { id: 't1', name: 'A', position: 1, points: 0, matchesPlayed: mc, goalDifference: 0 },
        { id: 't2', name: 'B', position: 2, points: 0, matchesPlayed: mc, goalDifference: 0 },
        { id: 't3', name: 'C', position: 3, points: 0, matchesPlayed: mc, goalDifference: 0 },
      ],
    };
  }

  it('returns an empty map when the table is null', () => {
    expect(buildTeamStrengths(null)).toEqual({});
  });

  it('derives overall from league position (1 = strongest, last = weakest)', () => {
    const strengths = buildTeamStrengths(tableWith(10));
    expect(strengths['t1']?.overall).toBe(1);
    expect(strengths['t2']?.overall).toBe(0.5);
    expect(strengths['t3']?.overall).toBe(0);
  });

  it('returns an empty map before the 3rd matchday — an empty table says nothing', () => {
    expect(buildTeamStrengths(tableWith(0))).toEqual({});
    expect(buildTeamStrengths(tableWith(2))).toEqual({});
    expect(Object.keys(buildTeamStrengths(tableWith(3)))).toHaveLength(3);
  });
});

describe('buildNextOpponents', () => {
  const { buildNextOpponents } = _internal;

  it('returns the opponent of the next unplayed match (state=0) for each team', () => {
    const players: OptimizerPlayer[] = [
      makePlayer({
        teamId: 'tA',
        matchSummary: [
          { day: 25, state: 2, team1Id: 'tA', team2Id: 'tX', team1Goals: 1, team2Goals: 1 },
          { day: 26, state: 0, team1Id: 'tA', team2Id: 'tY', team1Goals: 0, team2Goals: 0 },
        ],
      }),
      makePlayer({
        teamId: 'tB',
        matchSummary: [
          { day: 26, state: 0, team1Id: 'tZ', team2Id: 'tB', team1Goals: 0, team2Goals: 0 },
        ],
      }),
    ];
    const opp = buildNextOpponents(players);
    expect(opp['tA']).toBe('tY');
    expect(opp['tB']).toBe('tZ');
  });

  it('does not overwrite a team that already has a next opponent computed', () => {
    const playersSameTeam: OptimizerPlayer[] = [
      makePlayer({
        teamId: 'tA',
        matchSummary: [{ day: 26, state: 0, team1Id: 'tA', team2Id: 'tFIRST', team1Goals: 0, team2Goals: 0 }],
      }),
      makePlayer({
        teamId: 'tA',
        matchSummary: [{ day: 26, state: 0, team1Id: 'tA', team2Id: 'tSECOND', team1Goals: 0, team2Goals: 0 }],
      }),
    ];
    const opp = buildNextOpponents(playersSameTeam);
    expect(opp['tA']).toBe('tFIRST');
  });
});

describe('computeMatchup', () => {
  const { computeMatchup } = _internal;

  const teamStrengths = {
    tA: { teamName: 'A', position: 1, points: 0, matchesPlayed: 10, goalDifference: 0, overall: 1 },
    tB: { teamName: 'B', position: 9, points: 0, matchesPlayed: 10, goalDifference: 0, overall: 0.25 },
  };

  it('returns 0.5 when teamId is missing or has no next opponent', () => {
    expect(computeMatchup('', {}, teamStrengths)).toBe(0.5);
    expect(computeMatchup('tA', {}, teamStrengths)).toBe(0.5);
  });

  it('returns 0.5 when next opponent is not in the strength table', () => {
    expect(computeMatchup('tA', { tA: 'tUnknown' }, teamStrengths)).toBe(0.5);
  });

  it('inverts the next opponent strength — weak opponent, high value', () => {
    expect(computeMatchup('tA', { tA: 'tB' }, teamStrengths)).toBeCloseTo(0.75);
    expect(computeMatchup('tB', { tB: 'tA' }, teamStrengths)).toBeCloseTo(0);
  });
});

describe('scorePlayer', () => {
  it('returns all-zero when status is 2+ (verletzt/gesperrt)', () => {
    const p = makePlayer({ status: 2, averagePoints: 200, probability: 1 });
    const opt = new LineupOptimizer([p], null, 0);
    const detail = _internal.scorePlayer(opt, p);
    expect(detail).toEqual({
      score: 0, form: 0, formRaw: 0, startProb: 0, matchup: 0, availability: 0,
    });
  });

  it('scales the whole score by availability instead of adding it', () => {
    const fit = makePlayer({ status: 0, averagePoints: 110, probability: 1 });
    const limited = makePlayer({ status: 1, averagePoints: 110, probability: 1 });
    const opt = new LineupOptimizer([fit, limited], null, 0);

    // form 0.5, startProb 1.0, Anzeige ohne Gegner
    // fit = 0.35*0.5 + 0.55*1 + 0.10 = 0.825
    const fitDetail = _internal.scorePlayer(opt, fit);
    const limitedDetail = _internal.scorePlayer(opt, limited);
    expect(fitDetail.score).toBeCloseTo(0.825);
    expect(limitedDetail.availability).toBe(0.7);
    expect(limitedDetail.score).toBeCloseTo(0.825 * 0.7);
  });

  it('lässt den Gegner aus der Anzeige raus und rechnet ihn nur bei der Auswahl mit', () => {
    const p = makePlayer({
      teamId: 'tA',
      averagePoints: 110,                       // form = 0.5 in 50..170 range
      probability: 1,                           // startProb = 1.0
      lastMatchdayPoints: [],
      hasPlayedFlags: [],
      status: 0,
      matchSummary: [
        { day: 1, state: 0, team1Id: 'tA', team2Id: 'tB', team1Goals: 0, team2Goals: 0 },
      ],
    });
    const table: CompetitionTable = {
      teams: [
        { id: 'tA', name: 'A', position: 1, points: 0, matchesPlayed: 10, goalDifference: 0 },
        { id: 'tB', name: 'B', position: 2, points: 0, matchesPlayed: 10, goalDifference: 0 },
      ],
    };
    const opt = new LineupOptimizer([p], table, 0);
    const detail = _internal.scorePlayer(opt, p);
    // matchup: nächster Gegner tB ist Letzter (overall 0) → 1
    // Anzeige = (0.35*0.5 + 0.55*1 + 0.10) * 1 = 0.825, ohne den Gegner
    expect(detail.score).toBeCloseTo(0.825);
    expect(detail.form).toBeCloseTo(0.5);
    expect(detail.startProb).toBe(1);
    expect(detail.matchup).toBe(1);
    expect(detail.availability).toBe(1);

    // Auswahl = (0.30*0.5 + 0.45*1 + 0.15*1 + 0.10) * 1 = 0.85
    expect(opt.scorePlayer(p, SELECTION_WEIGHTS).score).toBeCloseTo(0.85);
  });

  it('stays neutral on matchup while the table has fewer than 3 matchdays', () => {
    const p = makePlayer({
      teamId: 'tA',
      averagePoints: 110,
      probability: 1,
      matchSummary: [
        { day: 1, state: 0, team1Id: 'tA', team2Id: 'tB', team1Goals: 0, team2Goals: 0 },
      ],
    });
    const preSeason: CompetitionTable = {
      teams: [
        { id: 'tA', name: 'A', position: 1, points: 0, matchesPlayed: 0, goalDifference: 0 },
        { id: 'tB', name: 'B', position: 2, points: 0, matchesPlayed: 0, goalDifference: 0 },
      ],
    };
    const opt = new LineupOptimizer([p], preSeason, 0);
    expect(_internal.scorePlayer(opt, p).matchup).toBe(0.5);
  });
});

describe('pairAdjustment', () => {
  it('returns zero delta when pair effects are disabled', () => {
    const lineup = [
      makeScored({ playerId: 'a', score: 1, teamId: 'tA', positionCode: 3, position: 'MF' }),
      makeScored({ playerId: 'b', score: 1, teamId: 'tA', positionCode: 4, position: 'ANG' }),
    ];
    const opt = new LineupOptimizer([], null, 0, undefined, /* pairEffects */ false);
    const r = opt.pairAdjustment(lineup);
    expect(r.delta).toBe(0);
    expect(r.pairs).toEqual([]);
  });

  it('adds a positive synergy contribution for same-team pairs (MF + ANG = 0.5 weight)', () => {
    const lineup = [
      makeScored({ playerId: 'a', score: 1, teamId: 'tA', positionCode: 3, position: 'MF' }),
      makeScored({ playerId: 'b', score: 1, teamId: 'tA', positionCode: 4, position: 'ANG' }),
    ];
    const opt = new LineupOptimizer([], null, 0);
    const r = opt.pairAdjustment(lineup);
    // base = 0.03 * min(1,1) = 0.03; synergy MF↔ANG = 0.5 → adj = 0.015
    expect(r.delta).toBeCloseTo(0.015);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]?.type).toBe('synergy');
  });

  it('subtracts a conflict contribution for opposing-team pairs (TW vs. opposing ANG = 0.9 weight)', () => {
    const players: OptimizerPlayer[] = [
      makePlayer({
        teamId: 'tA',
        matchSummary: [{ day: 1, state: 0, team1Id: 'tA', team2Id: 'tB', team1Goals: 0, team2Goals: 0 }],
      }),
    ];
    const opt = new LineupOptimizer(players, null, 0);
    const lineup = [
      makeScored({ playerId: 'a', score: 1, teamId: 'tA', positionCode: 1, position: 'TW' }),
      makeScored({ playerId: 'b', score: 1, teamId: 'tB', positionCode: 4, position: 'ANG' }),
    ];
    const r = opt.pairAdjustment(lineup);
    // base = 0.03; conflict TW↔ANG = 0.9 → adj = -0.027
    expect(r.delta).toBeCloseTo(-0.027);
    expect(r.pairs[0]?.type).toBe('conflict');
  });

  it('caps the total delta at ±10% of the base lineup score sum', () => {
    const lineup = Array.from({ length: 11 }, (_, i) =>
      makeScored({ playerId: `p${i}`, score: 0.1, teamId: 'tA', positionCode: 3, position: 'MF' }),
    );
    const opt = new LineupOptimizer([], null, 0);
    const r = opt.pairAdjustment(lineup);
    expect(r.delta).toBeLessThanOrEqual(1.1 * 0.10 + 1e-9);
  });
});

describe('evaluateFormation', () => {
  function buildSquad(): OptimizerPlayer[] {
    const squad: OptimizerPlayer[] = [];
    let i = 0;
    const push = (n: number, pos: PositionCode, prefix: string): void => {
      for (let k = 0; k < n; k++) {
        squad.push(
          makePlayer({
            playerId: `${prefix}${k}`,
            name: `${prefix}${k}`,
            position: positionLabel(pos),
            positionCode: pos,
            averagePoints: 100 + (i++) * 2,
            marketValue: 1_000_000,
            probability: 1,
          }),
        );
      }
    };
    push(3, 1, 'tw');
    push(8, 2, 'abw');
    push(8, 3, 'mf');
    push(6, 4, 'ang');
    return squad;
  }

  it('returns null when there are not enough players for the formation', () => {
    const tooFew: OptimizerPlayer[] = [
      makePlayer({ playerId: 'tw', position: 'TW', positionCode: 1, averagePoints: 100 }),
    ];
    const opt = new LineupOptimizer(tooFew, null, 100_000_000);
    const r = opt.evaluateFormation('4-3-3');
    expect(r).toBeNull();
  });

  it('greedy-picks the highest-scored players per position for the requested formation', () => {
    const squad = buildSquad();
    const opt = new LineupOptimizer(squad, null, 100_000_000);
    const r = opt.evaluateFormation('4-3-3');
    expect(r).not.toBeNull();
    expect(r!.formation).toBe('4-3-3');
    expect(r!.start11).toHaveLength(11);
    const startCounts = { TW: 0, ABW: 0, MF: 0, ANG: 0 };
    for (const p of r!.start11) startCounts[p.position]++;
    expect(startCounts).toEqual({ TW: 1, ABW: 4, MF: 3, ANG: 3 });
  });

  it('marks budgetPlusOk=false when the bench cannot cover a negative balance', () => {
    const squad = buildSquad();
    const opt = new LineupOptimizer(squad, null, -1_000_000_000);
    const r = opt.evaluateFormation('4-3-3');
    expect(r!.budgetPlusOk).toBe(false);
  });
});

describe('fixBudget', () => {
  function starter(id: string, score: number, marketValue: number): ScoredPlayer {
    return makeScored({ playerId: id, score, marketValue, position: 'MF', positionCode: 3 });
  }

  it('keeps swapping until the balance is positive, not just once', () => {
    // Bank trägt 2 Mio, Konto -8 Mio. Ein Tausch bringt +4 Mio, es braucht zwei.
    const start11 = [starter('s1', 0.9, 5_000_000), starter('s2', 0.9, 5_000_000)];
    const bench = [starter('b1', 0.5, 1_000_000), starter('b2', 0.5, 1_000_000)];
    const opt = new LineupOptimizer([], null, -8_000_000);

    const fix = opt.fixBudget(start11, bench);

    expect(fix).not.toBeNull();
    expect(fix!.benchValue).toBe(10_000_000);
    expect(fix!.start11.map((p) => p.playerId).sort()).toEqual(['b1', 'b2']);
  });

  it('returns null when the swaps cannot close the gap — no score burned for nothing', () => {
    const start11 = [starter('s1', 0.9, 5_000_000)];
    const bench = [starter('b1', 0.5, 1_000_000)];
    const opt = new LineupOptimizer([], null, -500_000_000);

    expect(opt.fixBudget(start11, bench)).toBeNull();
  });

  it('never swaps in a bench player with score 0', () => {
    const start11 = [starter('s1', 0.9, 5_000_000)];
    const bench = [starter('injured', 0, 1_000_000)];
    const opt = new LineupOptimizer([], null, -3_000_000);

    expect(opt.fixBudget(start11, bench)).toBeNull();
  });

  it('leaves the inputs untouched', () => {
    const start11 = [starter('s1', 0.9, 5_000_000)];
    const bench = [starter('b1', 0.5, 1_000_000)];
    const opt = new LineupOptimizer([], null, -3_000_000);

    opt.fixBudget(start11, bench);

    expect(start11.map((p) => p.playerId)).toEqual(['s1']);
    expect(bench.map((p) => p.playerId)).toEqual(['b1']);
  });
});

describe('refineWithPairEffects', () => {
  it('swaps a starter with a same-position bencher when (base + pairDelta) improves and budget stays valid', () => {
    const starter = makeScored({
      playerId: 'starter', score: 0.60, teamId: 'tA', positionCode: 3, position: 'MF',
      marketValue: 5_000_000,
    });
    const sameTeam = makeScored({
      playerId: 'sameTeam', score: 0.62, teamId: 'tA', positionCode: 3, position: 'MF',
      marketValue: 4_000_000,
    });
    const other = makeScored({
      playerId: 'other', score: 0.62, teamId: 'tB', positionCode: 3, position: 'MF',
      marketValue: 4_000_000,
    });
    const synergyAnchor = makeScored({
      playerId: 'anchor', score: 0.7, teamId: 'tA', positionCode: 4, position: 'ANG',
      marketValue: 0,
    });

    const opt = new LineupOptimizer([], null, 100_000_000);
    const start11 = [starter, synergyAnchor];
    const bench = [sameTeam, other];
    const baseSum = starter.score + synergyAnchor.score;
    const pairDelta = opt.pairAdjustment(start11).delta;

    const refined = opt.refineWithPairEffects(start11, bench, baseSum, pairDelta, 8_000_000);

    const startedIds = refined.start11.map((p) => p.playerId);
    expect(startedIds).toContain('sameTeam');
    expect(startedIds).not.toContain('starter');
  });

  it('returns the original lineup when no improving swap exists', () => {
    const a = makeScored({ playerId: 'a', score: 0.9, teamId: 'tA', positionCode: 3, position: 'MF', marketValue: 0 });
    const b = makeScored({ playerId: 'b', score: 0.4, teamId: 'tB', positionCode: 3, position: 'MF', marketValue: 0 });
    const opt = new LineupOptimizer([], null, 100_000_000);
    const refined = opt.refineWithPairEffects([a], [b], a.score, 0, 0);
    expect(refined.start11).toEqual([a]);
  });
});

describe('optimize (top-level)', () => {
  function buildBalancedSquad(): OptimizerPlayer[] {
    const squad: OptimizerPlayer[] = [];
    const push = (n: number, pos: PositionCode, prefix: string, ap: number): void => {
      for (let k = 0; k < n; k++) {
        squad.push(
          makePlayer({
            playerId: `${prefix}${k}`,
            name: `${prefix}${k}`,
            position: positionLabel(pos),
            positionCode: pos,
            averagePoints: ap + k * 5,
            marketValue: 1_000_000,
            probability: 1,
            status: 0,
          }),
        );
      }
    };
    push(3, 1, 'tw',  120);
    push(8, 2, 'abw', 100);
    push(8, 3, 'mf',  110);
    push(6, 4, 'ang', 105);
    return squad;
  }

  it('returns the highest-totalScore formation among the 10 valid options', () => {
    const opt = new LineupOptimizer(buildBalancedSquad(), null, 100_000_000);
    const r = opt.optimize();
    expect(r).not.toBeNull();
    expect(r!.start11).toHaveLength(11);
    expect(VALID_FORMATIONS).toContain(r!.formation);
    let maxTotal = -Infinity;
    for (const f of VALID_FORMATIONS) {
      const cand = opt.evaluateFormation(f);
      if (cand) maxTotal = Math.max(maxTotal, cand.totalScore);
    }
    expect(r!.totalScore).toBeCloseTo(maxTotal, 6);
  });

  it('returns null when no formation has enough available players', () => {
    const empty = new LineupOptimizer([], null, 0);
    expect(empty.optimize()).toBeNull();
  });

  it('returns a result even when no formation is budget-valid', () => {
    const squad = buildBalancedSquad();
    const opt = new LineupOptimizer(squad, null, -10_000_000_000);
    const r = opt.optimize();
    expect(r).not.toBeNull();
  });
});
