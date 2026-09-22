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
  trendOfMatchup,
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
    // Der Anstoss faehrt mit, der Spielerdialog schreibt den Monat daraus.
    expect(buildFixtures(plan)).toEqual({
      A: [{ opponentId: 'B', home: true, day: 24, kickoff: '2026-08-34T13:30:00Z' }],
      B: [{ opponentId: 'A', home: false, day: 24, kickoff: '2026-08-34T13:30:00Z' }],
    });
  });

  it('nimmt nur offene Spiele ab dem laufenden Spieltag', () => {
    const plan = schedule(24, [
      match({ day: 23, state: 2, team1Id: 'A', team2Id: 'X' }),
      match({ day: 24, state: 2, team1Id: 'A', team2Id: 'Y' }),
      match({ day: 25, team1Id: 'A', team2Id: 'Z' }),
    ]);
    expect(buildFixtures(plan)['A']).toEqual([
      { opponentId: 'Z', home: true, day: 25, kickoff: '2026-08-35T13:30:00Z' },
    ]);
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
    expect(view.teams['T1']).toEqual({ name: 'Verein 1', position: 1, points: 50 });
  });

  it('bleibt ohne Ansetzung bei null Feldern', () => {
    const leer = schedule(0, []);
    expect(buildOpponents(leer, table).columns).toBe(0);
    expect(buildOpponents(leer, table).nextDay).toBe(0);
  });

  it('nimmt fuer den Spaltentitel den kleinsten nächsten Spieltag', () => {
    const plan = schedule(24, [
      match({ day: 25, team1Id: 'B', team2Id: 'T2' }),
      match({ day: 24, team1Id: 'A', team2Id: 'T1' }),
    ]);
    expect(buildOpponents(plan, table).nextDay).toBe(24);
  });
});

describe('trendOfMatchup', () => {
  const team = (position: number, points: number) => ({ name: '', position, points });

  it('ab 5 Plätzen und 3 Punkten besser heißt stärkerer Gegner', () => {
    expect(trendOfMatchup(team(10, 20), team(5, 23), 18)).toBe('down');
    expect(trendOfMatchup(team(18, 5), team(1, 40), 18)).toBe('down');
  });

  it('ab 5 Plätzen und 3 Punkten schlechter heißt schwächerer Gegner', () => {
    expect(trendOfMatchup(team(5, 23), team(10, 20), 18)).toBe('up');
    expect(trendOfMatchup(team(1, 40), team(18, 5), 18)).toBe('up');
  });

  it('unter 5 Plätzen Abstand bekommt keinen Pfeil, auch bei vielen Punkten', () => {
    expect(trendOfMatchup(team(10, 20), team(6, 30), 18)).toBe('flat');
    expect(trendOfMatchup(team(6, 30), team(10, 20), 18)).toBe('flat');
  });

  it('unter 3 Punkten Abstand bekommt keinen Pfeil, auch bei vielen Plätzen', () => {
    expect(trendOfMatchup(team(10, 5), team(4, 7), 18)).toBe('flat');
    expect(trendOfMatchup(team(4, 7), team(10, 5), 18)).toBe('flat');
  });

  it('zwei Vereine oben zeigen nicht beide nach unten', () => {
    expect(trendOfMatchup(team(5, 7), team(6, 7), 18)).toBe('flat');
    expect(trendOfMatchup(team(6, 7), team(5, 7), 18)).toBe('flat');
  });

  it('ohne Tabelle bleibt es neutral', () => {
    expect(trendOfMatchup(undefined, team(5, 20), 18)).toBe('flat');
    expect(trendOfMatchup(team(5, 20), team(0, 0), 18)).toBe('flat');
    expect(trendOfMatchup(team(5, 20), team(10, 10), 0)).toBe('flat');
  });
});

describe('buildTeamInfo', () => {
  it('bildet Verein auf Name, Platz und Punkte ab', () => {
    expect(buildTeamInfo(table)['T18']).toEqual({ name: 'Verein 18', position: 18, points: 33 });
  });
});
