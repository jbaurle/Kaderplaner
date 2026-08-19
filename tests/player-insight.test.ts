import { describe, expect, it } from 'vitest';
import type { MatchSummary } from '../src/api/types.js';
import type { PlanningRow } from '../src/compute/planning.js';
import {
  buildMatchdays,
  computeLineupEffect,
  computePlayerInsight,
  computeSaleEffect,
  CREDIT_SHARE,
  type PlayerInsightInput,
} from '../src/compute/player-insight.js';

function row(overrides: Partial<PlanningRow> & { id: string }): PlanningRow {
  const marketValue = overrides.marketValue ?? 10_000_000;
  return {
    id: overrides.id,
    name: overrides.name ?? 'Spieler',
    position: overrides.position ?? 2,
    positionLabel: overrides.positionLabel ?? 'ABW',
    marketValue,
    saleValue: overrides.saleValue ?? marketValue,
    bestOffer: overrides.bestOffer ?? 0,
    mvgl: overrides.mvgl ?? 0,
    gainLoss: overrides.gainLoss ?? 0,
    isInLineup: overrides.isInLineup ?? true,
    teamId: overrides.teamId ?? '2',
    status: overrides.status ?? 0,
    probability: overrides.probability ?? 0,
    imagePath: overrides.imagePath ?? '',
    flags: overrides.flags ?? { S1: false, S2: false, S3: false, S4: false },
  };
}

function input(overrides: Partial<PlayerInsightInput> = {}): PlayerInsightInput {
  const target = overrides.row ?? row({ id: 'a' });
  return {
    row: target,
    squad: overrides.squad ?? [target],
    budget: overrides.budget ?? 0,
    score: overrides.score ?? null,
    scoreByPlayer: overrides.scoreByPlayer ?? {},
    top11Ids: overrides.top11Ids ?? [],
    lineupInput: overrides.lineupInput ?? null,
    fixtures: overrides.fixtures ?? [],
    teams: overrides.teams ?? {},
    teamCount: overrides.teamCount ?? 18,
    weekly: overrides.weekly ?? null,
  };
}

describe('computeSaleEffect', () => {
  it('rechnet Erlös aufs Konto und Marktwert gegen die Kreditlinie', () => {
    const target = row({ id: 'a', marketValue: 30_000_000, saleValue: 30_000_000 });
    const teamValue = 300_000_000;
    const sale = computeSaleEffect(
      input({ row: target, squad: [target], budget: -50_000_000 }),
      teamValue,
    );

    expect(sale.proceeds).toBe(30_000_000);
    expect(sale.creditDrop).toBe(-CREDIT_SHARE * 30_000_000);
    expect(sale.net).toBeCloseTo(30_000_000 - 0.33 * 30_000_000, 6);
    expect(sale.headroomNow).toBeCloseTo(-50_000_000 + 0.33 * 300_000_000, 6);
    // Konto steigt um den Erlös, der Teamwert fällt um den Marktwert.
    expect(sale.headroomAfter).toBeCloseTo(
      -20_000_000 + 0.33 * 270_000_000,
      6,
    );
    expect(sale.headroomAfter - sale.headroomNow).toBeCloseTo(sale.net, 6);
  });

  it('trennt Erlös und Marktwert, wenn ein fremdes Gebot darüber liegt', () => {
    const target = row({ id: 'a', marketValue: 10_000_000, saleValue: 12_000_000 });
    const sale = computeSaleEffect(input({ row: target, squad: [target] }), 100_000_000);

    // Aufs Konto kommt das Gebot, die Kreditlinie hängt am Marktwert.
    expect(sale.proceeds).toBe(12_000_000);
    expect(sale.creditDrop).toBeCloseTo(-3_300_000, 6);
    expect(sale.net).toBeCloseTo(8_700_000, 6);
  });
});

describe('computeLineupEffect', () => {
  const squad = [
    row({ id: 'tw', positionLabel: 'TW', position: 1 }),
    row({ id: 'a1', positionLabel: 'ABW' }),
    row({ id: 'a2', positionLabel: 'ABW' }),
    row({ id: 'm1', positionLabel: 'MF', position: 3 }),
    row({ id: 's1', positionLabel: 'ANG', position: 4 }),
  ];

  it('zählt die Position vor und nach dem Verkauf', () => {
    const effect = computeLineupEffect(input({ row: squad[1]!, squad }));

    expect(effect.position).toBe('ABW');
    expect(effect.countNow).toBe(2);
    expect(effect.countAfter).toBe(1);
    // Fünf Spieler geben ohnehin keine Elf her, das prüft der Test darunter.
    expect(effect.formationHolds).toBe(false);
  });

  it('prüft, ob der Rest noch eine Elf hergibt, nicht ob er in eine passt', () => {
    // Elf, die genau 4-4-2 stellt, plus ein zweiter Torhüter.
    const full = [
      row({ id: 'tw1', positionLabel: 'TW', position: 1 }),
      row({ id: 'tw2', positionLabel: 'TW', position: 1 }),
      ...['b1', 'b2', 'b3', 'b4'].map((id) => row({ id, positionLabel: 'ABW' })),
      ...['m1', 'm2', 'm3', 'm4'].map((id) => row({ id, positionLabel: 'MF', position: 3 })),
      ...['s1', 's2'].map((id) => row({ id, positionLabel: 'ANG', position: 4 })),
    ];

    // Der zweite Torhüter darf gehen, es bleibt einer.
    const spare = computeLineupEffect(input({ row: full[1]!, squad: full }));
    expect(spare.formationHolds).toBe(true);

    // Der letzte Torhüter nicht.
    const withoutKeeper = full.filter((player) => player.id !== 'tw2');
    const keeper = computeLineupEffect(input({ row: withoutKeeper[0]!, squad: withoutKeeper }));
    expect(keeper.formationHolds).toBe(false);

    // Zu viele auf einer Position sind kein Problem, zu wenige schon: ohne
    // einen Stürmer bleibt nur noch einer, und jede Formation braucht mindestens einen.
    const oneStriker = full.filter((player) => player.id !== 's2');
    const striker = computeLineupEffect(input({ row: oneStriker.at(-1)!, squad: oneStriker }));
    expect(striker.formationHolds).toBe(false);
  });

  it('bildet den Schnitt der besten Elf aus den Einzelscores', () => {
    const effect = computeLineupEffect(input({
      row: squad[1]!,
      squad,
      top11Ids: ['tw', 'a1', 'a2'],
      scoreByPlayer: { tw: { score: 0.6 }, a1: { score: 0.9 }, a2: { score: 0.3 } },
    }));

    expect(effect.bestElevenNow).toBeCloseTo(0.6, 6);
    expect(effect.inBestEleven).toBe(true);
    // Ohne Optimizer-Zutaten gibt es keinen Vergleich, aber auch keinen Fehler.
    expect(effect.bestElevenAfter).toBeNull();
    expect(effect.successor).toBeNull();
  });
});

describe('buildMatchdays', () => {
  const teams = {
    '9': { name: 'Stuttgart', position: 17 },
    '10': { name: 'Bremen', position: 3 },
  };

  const matchSummary: MatchSummary[] = [
    { day: 33, state: 2, team1Id: '2', team2Id: '9', team1Goals: 3, team2Goals: 0 },
    { day: 34, state: 2, team1Id: '10', team2Id: '2', team1Goals: 1, team2Goals: 2 },
  ];

  it('zählt die Spieltagsnummer vom Stand herunter und dreht die Reihenfolge um', () => {
    const days = buildMatchdays(input({
      teams,
      weekly: {
        mc: 34,
        // Jüngster zuerst, so liefert es Kickbase.
        lastMatchdayPoints: [128, 94, 0],
        hasPlayedFlags: [true, true, false],
        matchSummary,
      },
    }));

    expect(days.map((day) => day.day)).toEqual([32, 33, 34]);
    expect(days.map((day) => day.points)).toEqual([0, 94, 128]);
    expect(days.map((day) => day.played)).toEqual([false, true, true]);
  });

  it('holt Gegner und Ergebnis aus dem Spielplan, aus Sicht des eigenen Vereins', () => {
    const days = buildMatchdays(input({
      teams,
      weekly: {
        mc: 34,
        lastMatchdayPoints: [128, 94],
        hasPlayedFlags: [true, true],
        matchSummary,
      },
    }));

    const home = days.find((day) => day.day === 33)!;
    expect(home.home).toBe(true);
    expect(home.opponentName).toBe('Stuttgart');
    expect(home.goalsFor).toBe(3);
    expect(home.goalsAgainst).toBe(0);

    const away = days.find((day) => day.day === 34)!;
    expect(away.home).toBe(false);
    expect(away.opponentName).toBe('Bremen');
    expect(away.goalsFor).toBe(2);
    expect(away.goalsAgainst).toBe(1);
  });

  it('lässt die Spieltagsnummer weg, statt eine falsche zu erfinden', () => {
    const days = buildMatchdays(input({
      weekly: {
        mc: 1,
        lastMatchdayPoints: [50, 40, 30],
        hasPlayedFlags: [true, true, true],
        matchSummary: [],
      },
    }));

    // mc 1 deckt nur den jüngsten Eintrag ab, die beiden davor liegen davor.
    expect(days.map((day) => day.day)).toEqual([0, 0, 1]);
    expect(days.every((day) => day.opponentId === null)).toBe(true);
  });

  it('hängt die kommenden Ansetzungen mit Einschätzung hinten an', () => {
    const days = buildMatchdays(input({
      teams,
      teamCount: 18,
      fixtures: [
        { opponentId: '9', home: true, day: 1 },
        { opponentId: '10', home: false, day: 2 },
      ],
    }));

    expect(days).toHaveLength(2);
    expect(days.every((day) => day.ahead)).toBe(true);
    // Platz 17 von 18 ist ein schwacher Gegner, Platz 3 ein starker.
    expect(days[0]!.trend).toBe('up');
    expect(days[1]!.trend).toBe('down');
    expect(days[0]!.points).toBeNull();
  });
});

describe('computePlayerInsight', () => {
  it('summiert den Teamwert aus den Marktwerten des Kaders', () => {
    const squad = [
      row({ id: 'a', marketValue: 10_000_000 }),
      row({ id: 'b', marketValue: 20_000_000 }),
    ];
    const insight = computePlayerInsight(input({ row: squad[0]!, squad }));

    expect(insight.teamValue).toBe(30_000_000);
    expect(insight.sale.headroomNow).toBeCloseTo(0.33 * 30_000_000, 6);
    expect(insight.matchdays).toEqual([]);
  });
});
