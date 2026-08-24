import { afterEach, describe, expect, it, vi } from 'vitest';
import { KickbaseClient } from '../src/api/kickbase.js';
import type { PerformanceSeason, PlayerPerformance } from '../src/api/types.js';
import {
  defaultSeasonId,
  gradeOf,
  matchdayCount,
  matchdaysBySlot,
  pickSeasons,
  seasonStats,
} from '../src/compute/performance.js';
import {
  isFresh,
  loadPerformance,
  savePerformance,
  MAX_AGE_MS,
} from '../src/state/performance.js';

/**
 * Ein Spieltag aus `/performance`, so wie Kickbase ihn schickt. Fehlt `p`,
 * stand der Spieler nicht im Kader.
 */
function wireMatch(day: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    day,
    mp: "90'",
    md: '2025-08-03T11:30:00Z',
    t1: '2',
    t2: '9',
    t1g: 3,
    t2g: 1,
    pt: '2',
    ...overrides,
  };
}

function season(id: string, matchdays: PerformanceSeason['matchdays']): PerformanceSeason {
  return { id, title: `Saison ${id}`, competition: 'Bundesliga', matchdays };
}

function matchday(
  day: number,
  points: number | null,
  overrides: Partial<PerformanceSeason['matchdays'][number]> = {},
): PerformanceSeason['matchdays'][number] {
  return {
    day,
    points,
    minutes: points === null ? 0 : 90,
    teamId: '2',
    opponentId: '9',
    goalsFor: 1,
    goalsAgainst: 0,
    kickoff: '2025-08-03T11:30:00Z',
    ...overrides,
  };
}

describe('getPlayerPerformance', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stub(data: unknown): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })),
    );
  }

  it('liest Punkte, Minuten, Gegner und Verein je Spieltag', async () => {
    stub({
      it: [
        {
          sid: '35',
          ti: '2025/2026',
          n: 'Bundesliga',
          ph: [wireMatch(1, { p: 65, mp: "28'" })],
        },
      ],
    });

    const result = await new KickbaseClient('t').getPlayerPerformance('1', 'p1');
    expect(result.seasons).toHaveLength(1);
    expect(result.seasons[0]).toMatchObject({ id: '35', title: '2025/2026', competition: 'Bundesliga' });
    expect(result.seasons[0]?.matchdays[0]).toEqual({
      day: 1,
      points: 65,
      minutes: 28,
      teamId: '2',
      opponentId: '9',
      goalsFor: 3,
      goalsAgainst: 1,
      kickoff: '2025-08-03T11:30:00Z',
    });
  });

  it('dreht Gegner und Tore, wenn der eigene Verein auswärts spielt', async () => {
    stub({ it: [{ sid: '35', ph: [wireMatch(1, { p: 10, pt: '9' })] }] });
    const result = await new KickbaseClient('t').getPlayerPerformance('1', 'p1');
    expect(result.seasons[0]?.matchdays[0]).toMatchObject({
      opponentId: '2',
      goalsFor: 1,
      goalsAgainst: 3,
    });
  });

  it('macht aus fehlenden Punkten null, nicht 0', async () => {
    stub({ it: [{ sid: '35', ph: [wireMatch(1), wireMatch(2, { p: 0 })] }] });
    const result = await new KickbaseClient('t').getPlayerPerformance('1', 'p1');
    expect(result.seasons[0]?.matchdays[0]?.points).toBeNull();
    expect(result.seasons[0]?.matchdays[1]?.points).toBe(0);
  });

  it('lässt Spieltage ohne Nummer oder ohne Begegnung weg', async () => {
    stub({ it: [{ sid: '35', ph: [wireMatch(0, { p: 5 }), wireMatch(2, { p: 5, t2: undefined })] }] });
    const result = await new KickbaseClient('t').getPlayerPerformance('1', 'p1');
    expect(result.seasons[0]?.matchdays).toHaveLength(0);
  });
});

describe('seasonStats', () => {
  it('rechnet Summe, Schnitt und Einsätze nur über gespielte Spieltage', () => {
    const stats = seasonStats(season('35', [matchday(1, 100), matchday(2, null), matchday(3, 50)]));
    expect(stats.total).toBe(150);
    expect(stats.played).toBe(2);
    expect(stats.average).toBe(75);
    expect(stats.max).toBe(100);
    expect(stats.days).toBe(34);
  });

  it('bleibt ohne Einsatz bei 0 und liefert einen Nenner über null', () => {
    const stats = seasonStats(season('35', [matchday(1, null)]));
    expect(stats.total).toBe(0);
    expect(stats.average).toBe(0);
    expect(stats.max).toBe(1);
  });
});

describe('matchdaysBySlot', () => {
  it('ordnet über die Spieltagsnummer, nicht über die Position in der Liste', () => {
    // Ryerson 2022/2023: der 8. Spieltag fehlt in der Antwort ganz.
    const slots = matchdaysBySlot(season('21', [matchday(7, 70), matchday(9, 90)]));
    expect(slots[6]?.points).toBe(70);
    expect(slots[7]).toBeNull();
    expect(slots[8]?.points).toBe(90);
    expect(slots).toHaveLength(34);
  });

  it('wächst mit, wenn eine Saison mehr als 34 Spieltage hat', () => {
    const long = season('99', [matchday(38, 10)]);
    expect(matchdayCount(long)).toBe(38);
    expect(matchdaysBySlot(long)).toHaveLength(38);
  });
});

describe('gradeOf', () => {
  const average = 100;

  it('stuft am eigenen Schnitt ein', () => {
    expect(gradeOf(matchday(1, 130), average)).toBe('good');
    expect(gradeOf(matchday(1, 80), average)).toBe('mid');
    expect(gradeOf(matchday(1, 40), average)).toBe('weak');
  });

  it('trennt Minuspunkte, fehlenden Einsatz und fehlenden Spieltag', () => {
    expect(gradeOf(matchday(1, -12), average)).toBe('neg');
    expect(gradeOf(matchday(1, null), average)).toBe('out');
    expect(gradeOf(null, average)).toBe('none');
  });
});

describe('pickSeasons und defaultSeasonId', () => {
  const performance: PlayerPerformance = {
    seasons: [
      season('26', [matchday(1, 80)]),
      season('35', [matchday(1, 100)]),
      season('42', [matchday(1, null)]),
    ],
  };

  it('nimmt die letzte als laufende und die davor als vorige', () => {
    const { current, previous } = pickSeasons(performance);
    expect(current?.id).toBe('42');
    expect(previous?.id).toBe('35');
  });

  it('öffnet die vorige Saison, solange die laufende keinen Einsatz zeigt', () => {
    expect(defaultSeasonId(performance)).toBe('35');
  });

  it('öffnet die laufende, sobald sie Punkte trägt', () => {
    const started: PlayerPerformance = {
      seasons: [season('35', [matchday(1, 100)]), season('42', [matchday(1, 55)])],
    };
    expect(defaultSeasonId(started)).toBe('42');
  });

  it('kommt mit gar keiner Saison zurecht', () => {
    expect(defaultSeasonId({ seasons: [] })).toBeNull();
    expect(defaultSeasonId(null)).toBeNull();
  });
});

describe('Cache', () => {
  afterEach(() => {
    localStorage.clear();
  });

  const performance: PlayerPerformance = { seasons: [season('35', [matchday(1, 100)])] };

  it('legt je Liga und Spieler einen eigenen Eintrag ab', () => {
    savePerformance('l1', 'p1', performance, 1_000);
    expect(localStorage.getItem('kb.performance.l1.p1')).not.toBeNull();
    expect(loadPerformance('l1', 'p2')).toBeNull();
    expect(loadPerformance('l2', 'p1')).toBeNull();
    expect(loadPerformance('l1', 'p1')?.performance.seasons[0]?.id).toBe('35');
  });

  it('gilt sechs Stunden und danach nicht mehr', () => {
    savePerformance('l1', 'p1', performance, 1_000);
    const entry = loadPerformance('l1', 'p1');
    expect(entry).not.toBeNull();
    expect(isFresh(entry!, 1_000 + MAX_AGE_MS - 1)).toBe(true);
    expect(isFresh(entry!, 1_000 + MAX_AGE_MS)).toBe(false);
  });

  it('verwirft einen Eintrag aus der Zukunft', () => {
    savePerformance('l1', 'p1', performance, 10_000);
    expect(isFresh(loadPerformance('l1', 'p1')!, 9_000)).toBe(false);
  });

  it('verwirft einen Eintrag mit fremdem Schema', () => {
    localStorage.setItem(
      'kb.performance.l1.p1',
      JSON.stringify({ schemaVersion: 99, savedAt: 1, performance }),
    );
    expect(loadPerformance('l1', 'p1')).toBeNull();
  });
});
