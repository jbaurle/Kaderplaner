/**
 * Die Gegner-Spalte in v4: welche Ansetzungen sie aus dem Spielplan liest, wie
 * viele Felder sie aufmacht und wann ein Pfeil steht.
 */
import { describe, expect, it } from 'vitest';
import type { CompetitionMatch, CompetitionMatchdays, CompetitionTable } from '../src/api/types.js';
import {
  buildFixtures,
  buildOpponents,
  buildTeamInfo,
  trendOfPosition,
} from '../src/compute/score.js';

function match(overrides: Partial<CompetitionMatch> & { day: number }): CompetitionMatch {
  return {
    day: overrides.day,
    kickoff: overrides.kickoff ?? `2026-08-${10 + overrides.day}T13:30:00Z`,
    team1Id: overrides.team1Id ?? 'A',
    team2Id: overrides.team2Id ?? 'B',
    state: overrides.state ?? 0,
  };
}

function schedule(currentDay: number, matches: CompetitionMatch[]): CompetitionMatchdays {
  return { currentDay, matches };
}

const table: CompetitionTable = {
  teams: Array.from({ length: 18 }, (_, i) => ({
    id: `T${i + 1}`,
    name: `Verein ${i + 1}`,
    position: i + 1,
    points: 50 - i,
    matchesPlayed: 23,
    goalDifference: 20 - i,
  })),
};

describe('buildFixtures', () => {
  it('traegt jede Begegnung bei beiden Vereinen ein, mit Heimrecht', () => {
    const plan = schedule(24, [match({ day: 24, team1Id: 'A', team2Id: 'B' })]);
    expect(buildFixtures(plan)).toEqual({
      A: [{ opponentId: 'B', home: true, day: 24 }],
      B: [{ opponentId: 'A', home: false, day: 24 }],
    });
  });

  it('nimmt nur offene Spiele ab dem laufenden Spieltag', () => {
    const plan = schedule(24, [
      match({ day: 23, state: 2, team1Id: 'A', team2Id: 'X' }),
      match({ day: 24, state: 2, team1Id: 'A', team2Id: 'Y' }),
      match({ day: 25, team1Id: 'A', team2Id: 'Z' }),
    ]);
    expect(buildFixtures(plan)['A']).toEqual([{ opponentId: 'Z', home: true, day: 25 }]);
  });

  it('sortiert aufsteigend nach Spieltag und deckelt auf `max`', () => {
    const plan = schedule(
      24,
      [27, 25, 24, 26].map((day) => match({ day, team1Id: 'A', team2Id: `G${day}` })),
    );
    expect(buildFixtures(plan)['A']?.map((f) => f.day)).toEqual([24, 25, 26]);
    expect(buildFixtures(plan, 1)['A']).toHaveLength(1);
  });

  it('laesst Vereine ohne offenes Spiel weg', () => {
    const plan = schedule(24, [match({ day: 24, state: 2, team1Id: 'A', team2Id: 'B' })]);
    expect(buildFixtures(plan)).toEqual({});
  });
});

describe('buildOpponents', () => {
  it('macht so viele Felder auf, wie der beste Verein Spiele hat', () => {
    const plan = schedule(24, [
      match({ day: 24, team1Id: 'A', team2Id: 'T1' }),
      match({ day: 25, team1Id: 'A', team2Id: 'T2' }),
    ]);
    const view = buildOpponents(plan, table);
    expect(view.columns).toBe(2);
    expect(view.teamCount).toBe(18);
    expect(view.teams['T1']).toEqual({ name: 'Verein 1', position: 1 });
  });

  it('bleibt ohne Ansetzung bei null Feldern', () => {
    const leer = schedule(0, []);
    expect(buildOpponents(leer, table).columns).toBe(0);
    expect(buildOpponents(leer, table).nextDay).toBe(0);
  });

  it('nimmt fuer den Spaltentitel den kleinsten naechsten Spieltag', () => {
    const plan = schedule(24, [
      match({ day: 25, team1Id: 'B', team2Id: 'T2' }),
      match({ day: 24, team1Id: 'A', team2Id: 'T1' }),
    ]);
    expect(buildOpponents(plan, table).nextDay).toBe(24);
  });
});

describe('trendOfPosition', () => {
  it('oben in der Tabelle heisst starker Gegner', () => {
    expect(trendOfPosition(1, 18)).toBe('down');
    expect(trendOfPosition(6, 18)).toBe('down');
  });

  it('unten in der Tabelle heisst schwacher Gegner', () => {
    expect(trendOfPosition(13, 18)).toBe('up');
    expect(trendOfPosition(18, 18)).toBe('up');
  });

  it('Mittelfeld bekommt keinen Pfeil', () => {
    expect(trendOfPosition(9, 18)).toBe('flat');
  });

  it('ohne Tabelle bleibt es neutral', () => {
    expect(trendOfPosition(0, 18)).toBe('flat');
    expect(trendOfPosition(5, 0)).toBe('flat');
  });
});

describe('buildTeamInfo', () => {
  it('bildet Verein auf Name und Platz ab', () => {
    expect(buildTeamInfo(table)['T18']).toEqual({ name: 'Verein 18', position: 18 });
  });
});
