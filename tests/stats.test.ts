import { describe, expect, it } from 'vitest';
import type { LeagueRanking, ManagerPerformance, ManagerRank } from '../src/api/types.js';
import {
  buildLeagueSeason,
  dayStandings,
  gradeOfDay,
  milestones,
  myFigures,
  standings,
  type BuildInput,
} from '../src/compute/stats.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Erster Anstoß von Spieltag 1, danach je sieben Tage weiter. */
const START = Date.parse('2026-08-28T18:30:00Z');
const kickoffOf = (day: number): string => new Date(START + (day - 1) * 7 * DAY_MS).toISOString();

function rank(id: string, name: string, points: number): ManagerRank {
  return {
    id, name, imagePath: '', seasonPoints: points, seasonPlace: 0, dayPoints: 0, dayPlace: 0, teamValue: 0,
  };
}

/** Eine Saison mit 34 Spieltagen, Punkte nur für die ersten Einträge. */
function performance(id: string, points: number[], won: boolean[], withKickoff = true): ManagerPerformance {
  const matchdays = Array.from({ length: 34 }, (_, i) => ({
    day: i + 1,
    points: points[i] ?? 0,
    kickoff: withKickoff ? kickoffOf(i + 1) : '',
    won: won[i] ?? false,
  }));
  return {
    managerId: id,
    managerName: id,
    seasons: [
      { id: '1', title: '2025/2026', place: 0, averagePoints: 0, totalPoints: 0, wins: 0, matchdays: [] },
      { id: '2', title: '2026/2027', place: 0, averagePoints: 0, totalPoints: 0, wins: 0, matchdays },
    ],
  };
}

/*
 * Vier Spieltage, drei Manager. A ist "ich".
 *   ST 1: A 100, B 80,  C 60   -> A gewinnt, Abstand 20
 *   ST 2: A 50,  B 90,  C 70   -> B gewinnt, Abstand 20
 *   ST 3: A 120, B 110, C 30   -> A gewinnt, Abstand 10
 *   ST 4: A 70,  B 75,  C 100  -> C gewinnt, Abstand 25
 * Stand danach: B 355, A 340, C 260. B liegt nach ST 2, 3 und 4 vorn.
 */
const A = [100, 50, 120, 70];
const B = [80, 90, 110, 75];
const C = [60, 70, 30, 100];

function input(overrides: Partial<BuildInput> = {}): BuildInput {
  const ranking: LeagueRanking = {
    leagueName: 'Test',
    managers: [rank('a', 'Anna', 340), rank('b', 'Ben', 355), rank('c', 'Cem', 260)],
  };
  return {
    ranking,
    performances: {
      a: performance('a', A, [true, false, true, false]),
      b: performance('b', B, [false, true, false, false]),
      c: performance('c', C, [false, false, false, true]),
    },
    userId: 'a',
    kickoffs: null,
    // Fünf Tage nach dem Anstoß von Spieltag 4: der ist durch.
    now: START + 3 * 7 * DAY_MS + 5 * DAY_MS,
    ...overrides,
  };
}

describe('buildLeagueSeason', () => {
  it('zählt die angepfiffenen Spieltage und markiert mich', () => {
    const season = buildLeagueSeason(input())!;
    expect(season.title).toBe('2026/2027');
    expect(season.dayCount).toBe(34);
    expect(season.playedDays).toBe(4);
    expect(season.openDay).toBe(0);
    expect(season.managers.map((m) => m.isMe)).toEqual([true, false, false]);
    expect(season.managers[0]!.points).toEqual(A);
    expect(season.managers[1]!.won).toEqual([false, true, false, false]);
  });

  it('liefert null, sobald die Historie eines Managers fehlt', () => {
    const base = input();
    const { c: _c, ...rest } = base.performances;
    expect(buildLeagueSeason({ ...base, performances: rest })).toBeNull();
  });

  it('ohne Anstoßzeiten zählt ein Spieltag, sobald irgendwer dort Punkte hat', () => {
    const season = buildLeagueSeason(input({
      performances: {
        a: performance('a', [10, 0], [], false),
        b: performance('b', [0, 20], [], false),
        c: performance('c', [0, 0], [], false),
      },
    }))!;
    expect(season.playedDays).toBe(2);
  });

  it('ohne Spielplan bleibt der jüngste Spieltag dreieinhalb Tage offen', () => {
    const kickoff4 = START + 3 * 7 * DAY_MS;
    expect(buildLeagueSeason(input({ now: kickoff4 + 2 * DAY_MS }))!.openDay).toBe(4);
    expect(buildLeagueSeason(input({ now: kickoff4 + 4 * DAY_MS }))!.openDay).toBe(0);
  });

  it('mit Spielplan zählt der letzte Anstoß des Spieltags plus Live-Fenster', () => {
    const kickoff4 = START + 3 * 7 * DAY_MS;
    const last = kickoff4 + 2 * DAY_MS;
    const kickoffs = {
      t1: { 4: new Date(kickoff4).toISOString() },
      t2: { 4: new Date(last).toISOString() },
    };
    const hour = 60 * 60 * 1000;
    expect(buildLeagueSeason(input({ kickoffs, now: last + 1 * hour }))!.openDay).toBe(4);
    expect(buildLeagueSeason(input({ kickoffs, now: last + 3 * hour }))!.openDay).toBe(0);
  });
});

describe('standings und dayStandings', () => {
  it('sortiert nach Punkten, zählt Siege und rundet den Schnitt', () => {
    const rows = standings(buildLeagueSeason(input())!);
    expect(rows.map((r) => r.manager.id)).toEqual(['b', 'a', 'c']);
    expect(rows.map((r) => r.total)).toEqual([355, 340, 260]);
    expect(rows.map((r) => r.wins)).toEqual([1, 2, 1]);
    expect(rows.map((r) => r.average)).toEqual([89, 85, 65]);
  });

  it('kann einen früheren Stand zeigen', () => {
    const rows = standings(buildLeagueSeason(input())!, 1);
    expect(rows.map((r) => r.manager.id)).toEqual(['a', 'b', 'c']);
    expect(rows[0]!.total).toBe(100);
  });

  it('der offene Spieltag zählt noch nicht als Sieg', () => {
    const kickoff4 = START + 3 * 7 * DAY_MS;
    const rows = standings(buildLeagueSeason(input({ now: kickoff4 + DAY_MS }))!);
    // C hat an Spieltag 4 gewonnen, der ist aber offen.
    expect(rows.find((r) => r.manager.id === 'c')!.wins).toBe(0);
  });

  it('ordnet einen Spieltag nach Punkten', () => {
    const rows = dayStandings(buildLeagueSeason(input())!, 4);
    expect(rows.map((r) => r.manager.id)).toEqual(['c', 'b', 'a']);
    expect(rows[0]!.won).toBe(true);
  });
});

describe('myFigures', () => {
  it('rechnet Platz, Abstand, Verlust zum Tagesbesten und die Plätze je Spieltag', () => {
    const me = myFigures(buildLeagueSeason(input())!)!;
    expect(me.place).toBe(2);
    expect(me.total).toBe(340);
    expect(me.gapToFirst).toBe(15);
    expect(me.leadOverSecond).toBe(0);
    expect(me.wins).toBe(2);
    expect(me.lostToBest).toBe(70);
    // Spieltag 1 mit 20 und Spieltag 3 mit 10 vor dem Zweiten.
    expect(me.aheadOfSecond).toBe(30);
    expect(me.dayPlaces).toEqual([1, 3, 1, 3]);
  });

  it('nennt den Vorsprung, wenn ich vorn liege', () => {
    const me = myFigures(buildLeagueSeason(input({ userId: 'b' }))!)!;
    expect(me.place).toBe(1);
    expect(me.leadOverSecond).toBe(15);
    expect(me.gapToFirst).toBe(0);
  });

  it('ist null, wenn ich nicht in der Liga stehe', () => {
    expect(myFigures(buildLeagueSeason(input({ userId: 'x' }))!)).toBeNull();
  });
});

describe('milestones', () => {
  it('gibt es erst ab drei gewerteten Spieltagen', () => {
    // Zwei Spieltage gespielt, die übrigen ohne Punkte und mit Anstoß in der Zukunft.
    const early = buildLeagueSeason(input({
      now: START + 7 * DAY_MS + 5 * DAY_MS,
      performances: {
        a: performance('a', A.slice(0, 2), []),
        b: performance('b', B.slice(0, 2), []),
        c: performance('c', C.slice(0, 2), []),
      },
    }))!;
    expect(early.playedDays).toBe(2);
    expect(milestones(early)).toBeNull();
  });

  it('findet beste und schwächste Leistung, knappsten und deutlichsten Spieltag', () => {
    const stones = milestones(buildLeagueSeason(input())!)!;
    expect(stones.countedDays).toBe(4);
    expect(stones.bestDay).toMatchObject({ points: 120, day: 3 });
    expect(stones.bestDay.manager.id).toBe('a');
    expect(stones.worstDay).toMatchObject({ points: 30, day: 3 });
    expect(stones.worstDay.manager.id).toBe('c');
    expect(stones.closestDay).toEqual({ gap: 10, day: 3 });
    expect(stones.widestWin).toMatchObject({ gap: 25, day: 4 });
    expect(stones.widestWin.manager.id).toBe('c');
  });

  it('weiß, wer am längsten vorn lag und wer am weitesten sprang', () => {
    const stones = milestones(buildLeagueSeason(input())!)!;
    expect(stones.longestOnTop.days).toBe(3);
    expect(stones.longestOnTop.manager.id).toBe('b');
    expect(stones.biggestJump).toMatchObject({ gain: 1, day: 2 });
    expect(stones.biggestJump!.manager.id).toBe('b');
  });

  it('lässt den offenen Spieltag aus', () => {
    const kickoff4 = START + 3 * 7 * DAY_MS;
    const stones = milestones(buildLeagueSeason(input({ now: kickoff4 + DAY_MS }))!)!;
    expect(stones.countedDays).toBe(3);
    // Der deutlichste Sieg von C an Spieltag 4 zählt noch nicht.
    expect(stones.widestWin.day).toBe(1);
  });
});

describe('gradeOfDay', () => {
  it('gewonnen ist gut, unter 60 Prozent schwach, dazwischen mittel', () => {
    expect(gradeOfDay(100, 100)).toBe('good');
    expect(gradeOfDay(80, 100)).toBe('mid');
    expect(gradeOfDay(50, 100)).toBe('weak');
    expect(gradeOfDay(0, 0)).toBe('mid');
  });
});
