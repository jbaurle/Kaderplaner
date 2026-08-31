import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CompetitionTable,
  MarketPlayer,
  PlayerDetails,
  SquadPlayer,
} from '../src/api/types.js';
import { computeScores } from '../src/compute/score.js';
import {
  emptyOptimizerCache,
  loadOptimizerCache,
  saveOptimizerCache,
} from '../src/state/optimizer.js';

/**
 * Der Spielplan gehört nicht zu dem, was hier geprüft wird: die Gegner-Spalte
 * hat ihre eigenen Tests. Ein leerer Plan hält ihn aus dem Weg.
 */
const EMPTY_SCHEDULE = { currentDay: 0, matches: [] };

const LEAGUE = 'lg-1';

// Same Map-backed shim as state-optimizer.test.ts — Node 25 native localStorage
// is incomplete and jsdom doesn't reliably override it.
const fakeStore = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string): string | null => fakeStore.get(k) ?? null,
  setItem: (k: string, v: string): void => {
    fakeStore.set(k, String(v));
  },
  removeItem: (k: string): void => {
    fakeStore.delete(k);
  },
  clear: (): void => {
    fakeStore.clear();
  },
  key: (i: number): string | null => Array.from(fakeStore.keys())[i] ?? null,
  get length(): number {
    return fakeStore.size;
  },
};

beforeEach(() => {
  fakeStore.clear();
  vi.stubGlobal('localStorage', fakeLocalStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fakeStore.clear();
});

function squadPlayer(overrides: Partial<SquadPlayer> & { id: string }): SquadPlayer {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    position: overrides.position ?? 3,
    marketValue: overrides.marketValue ?? 1_000_000,
    mvgl: overrides.mvgl ?? 0,
    mvChange1d: overrides.mvChange1d ?? 0,
    mvChange7d: overrides.mvChange7d ?? 0,
    isInLineup: overrides.isInLineup ?? false,
    lineupOrder: overrides.lineupOrder ?? null,
    averagePoints: overrides.averagePoints ?? 0,
    status: overrides.status ?? 0,
    probability: overrides.probability ?? 0,
    teamId: overrides.teamId ?? '',
    imagePath: overrides.imagePath ?? '',
  };
}

function table(mc: number): CompetitionTable {
  return {
    teams: [
      { id: 't1', name: 'Bayern',   position: 1, points: 0, matchesPlayed: mc, goalDifference: 0 },
      { id: 't2', name: 'Dortmund', position: 2, points: 0, matchesPlayed: mc, goalDifference: 0 },
    ],
  };
}

function details(overrides: Partial<PlayerDetails> = {}): PlayerDetails {
  return {
    firstName: overrides.firstName ?? '',
    lastName: overrides.lastName ?? '',
    averagePoints: overrides.averagePoints ?? 100,
    status: overrides.status ?? 0,
    statusText: overrides.statusText ?? '',
    teamId: overrides.teamId ?? 't1',
    teamName: overrides.teamName ?? 'Bayern',
    probability: overrides.probability ?? 1,
    lastMatchdayPoints: overrides.lastMatchdayPoints ?? [],
    hasPlayedFlags: overrides.hasPlayedFlags ?? [],
    matchSummary: overrides.matchSummary ?? [
      { day: 1, state: 0, team1Id: 't1', team2Id: 't2', team1Goals: 0, team2Goals: 0 },
    ],
  };
}

const FRESH = {
  averagePoints: 100,
  status: 0,
  probability: 1,
  teamId: 't1',
};

function marketPlayer(overrides: Partial<MarketPlayer> & { id: string }): MarketPlayer {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    firstName: overrides.firstName ?? '',
    position: overrides.position ?? 3,
    marketValue: overrides.marketValue ?? 1_000_000,
    price: overrides.price ?? 1_000_000,
    expiresInSeconds: overrides.expiresInSeconds ?? 0,
    offerCount: overrides.offerCount ?? 0,
    myOffer: overrides.myOffer ?? null,
    offers: overrides.offers ?? [],
    status: overrides.status ?? 0,
    probability: overrides.probability ?? 0,
    averagePoints: overrides.averagePoints ?? 0,
    teamId: overrides.teamId ?? 't1',
    imagePath: overrides.imagePath ?? '',
    trend: overrides.trend ?? 0,
  };
}

describe('computeScores', () => {
  it('on first run, fetches table + every player and persists the cache', async () => {
    const client = {
      getCompetitionTable: vi.fn().mockResolvedValue(table(25)),
      getCompetitionMatchdays: vi.fn().mockResolvedValue(EMPTY_SCHEDULE),
      getPlayerDetailsBatch: vi.fn().mockResolvedValue([details(), details()]),
    };
    const squad: SquadPlayer[] = [
      squadPlayer({ id: 'a', position: 3 }),
      squadPlayer({ id: 'b', position: 4 }),
    ];

    const result = await computeScores({
      client: client as never,
      leagueId: LEAGUE,
      squad,
      squadFreshFields: { a: FRESH, b: FRESH },
      budget: 100_000_000,
    });

    expect(client.getCompetitionTable).toHaveBeenCalledTimes(1);
    expect(client.getPlayerDetailsBatch).toHaveBeenCalledTimes(1);
    expect(client.getPlayerDetailsBatch).toHaveBeenCalledWith(LEAGUE, ['a', 'b']);
    expect(result.formation).toBeDefined();
    expect(result.byPlayer).toBeDefined();
    expect(loadOptimizerCache(LEAGUE)).not.toBeNull();
  });

  it('on a follow-up run with unchanged matches-played, fetches the table only', async () => {
    const cache = emptyOptimizerCache();
    cache.table = { takenAt: 1, mc: 25, teams: table(25).teams };
    cache.weeklyDetails = {
      a: { mc: 25, firstName: '', statusText: '', matchSummary: [{ day: 1, state: 0, team1Id: 't1', team2Id: 't2', team1Goals: 0, team2Goals: 0 }], lastMatchdayPoints: [], hasPlayedFlags: [] },
      b: { mc: 25, firstName: '', statusText: '', matchSummary: [{ day: 1, state: 0, team1Id: 't1', team2Id: 't2', team1Goals: 0, team2Goals: 0 }], lastMatchdayPoints: [], hasPlayedFlags: [] },
    };
    saveOptimizerCache(LEAGUE, cache);

    const client = {
      getCompetitionTable: vi.fn().mockResolvedValue(table(25)),
      getCompetitionMatchdays: vi.fn().mockResolvedValue(EMPTY_SCHEDULE),
      getPlayerDetailsBatch: vi.fn(),
    };

    const result = await computeScores({
      client: client as never,
      leagueId: LEAGUE,
      squad: [squadPlayer({ id: 'a' }), squadPlayer({ id: 'b' })],
      squadFreshFields: { a: FRESH, b: FRESH },
      budget: 100_000_000,
    });

    expect(client.getCompetitionTable).toHaveBeenCalledTimes(1);
    expect(client.getPlayerDetailsBatch).not.toHaveBeenCalled();
    expect(result.formation).toBeDefined();
    expect(result.byPlayer).toBeDefined();
  });

  it('on a new matchday (max mc increased), refetches all player details', async () => {
    const cache = emptyOptimizerCache();
    cache.table = { takenAt: 1, mc: 25, teams: table(25).teams };
    cache.weeklyDetails = {
      a: { mc: 25, firstName: '', statusText: '', matchSummary: [], lastMatchdayPoints: [], hasPlayedFlags: [] },
    };
    saveOptimizerCache(LEAGUE, cache);

    const client = {
      getCompetitionTable: vi.fn().mockResolvedValue(table(26)),
      getCompetitionMatchdays: vi.fn().mockResolvedValue(EMPTY_SCHEDULE),
      getPlayerDetailsBatch: vi.fn().mockResolvedValue([details(), details()]),
    };

    await computeScores({
      client: client as never,
      leagueId: LEAGUE,
      squad: [squadPlayer({ id: 'a' }), squadPlayer({ id: 'b' })],
      squadFreshFields: { a: FRESH, b: FRESH },
      budget: 100_000_000,
    });

    expect(client.getPlayerDetailsBatch).toHaveBeenCalledWith(LEAGUE, ['a', 'b']);
  });

  it('fetches only newly added players (incremental) when matchday is unchanged', async () => {
    const cache = emptyOptimizerCache();
    cache.table = { takenAt: 1, mc: 25, teams: table(25).teams };
    cache.weeklyDetails = {
      a: { mc: 25, firstName: '', statusText: '', matchSummary: [], lastMatchdayPoints: [], hasPlayedFlags: [] },
    };
    saveOptimizerCache(LEAGUE, cache);

    const client = {
      getCompetitionTable: vi.fn().mockResolvedValue(table(25)),
      getCompetitionMatchdays: vi.fn().mockResolvedValue(EMPTY_SCHEDULE),
      getPlayerDetailsBatch: vi.fn().mockResolvedValue([details()]),
    };

    await computeScores({
      client: client as never,
      leagueId: LEAGUE,
      squad: [squadPlayer({ id: 'a' }), squadPlayer({ id: 'newPlayer' })],
      squadFreshFields: { a: FRESH, newPlayer: FRESH },
      budget: 100_000_000,
    });

    expect(client.getPlayerDetailsBatch).toHaveBeenCalledWith(LEAGUE, ['newPlayer']);
  });

  it('refetches a re-bought player whose cached entry is older than the table', async () => {
    // `a` wurde beim Spieltagswechsel mitgezogen, `stale` war da nicht im
    // Kader und hängt noch auf mc 24.
    const cache = emptyOptimizerCache();
    cache.table = { takenAt: 1, mc: 25, teams: table(25).teams };
    cache.weeklyDetails = {
      a: { mc: 25, firstName: '', statusText: '', matchSummary: [], lastMatchdayPoints: [], hasPlayedFlags: [] },
      stale: { mc: 24, firstName: '', statusText: '', matchSummary: [], lastMatchdayPoints: [], hasPlayedFlags: [] },
    };
    saveOptimizerCache(LEAGUE, cache);

    const client = {
      getCompetitionTable: vi.fn().mockResolvedValue(table(25)),
      getCompetitionMatchdays: vi.fn().mockResolvedValue(EMPTY_SCHEDULE),
      getPlayerDetailsBatch: vi.fn().mockResolvedValue([details()]),
    };

    await computeScores({
      client: client as never,
      leagueId: LEAGUE,
      squad: [squadPlayer({ id: 'a' }), squadPlayer({ id: 'stale' })],
      squadFreshFields: { a: FRESH, stale: FRESH },
      budget: 100_000_000,
    });

    expect(client.getPlayerDetailsBatch).toHaveBeenCalledWith(LEAGUE, ['stale']);
    expect(loadOptimizerCache(LEAGUE)?.weeklyDetails['stale']?.mc).toBe(25);
  });

  it('drops cached entries for players that left the squad', async () => {
    const cache = emptyOptimizerCache();
    cache.table = { takenAt: 1, mc: 25, teams: table(25).teams };
    cache.weeklyDetails = {
      a: { mc: 25, firstName: '', statusText: '', matchSummary: [], lastMatchdayPoints: [], hasPlayedFlags: [] },
      sold: { mc: 25, firstName: '', statusText: '', matchSummary: [], lastMatchdayPoints: [], hasPlayedFlags: [] },
    };
    saveOptimizerCache(LEAGUE, cache);

    const client = {
      getCompetitionTable: vi.fn().mockResolvedValue(table(25)),
      getCompetitionMatchdays: vi.fn().mockResolvedValue(EMPTY_SCHEDULE),
      getPlayerDetailsBatch: vi.fn(),
    };

    await computeScores({
      client: client as never,
      leagueId: LEAGUE,
      squad: [squadPlayer({ id: 'a' })],
      squadFreshFields: { a: FRESH },
      budget: 100_000_000,
    });

    expect(Object.keys(loadOptimizerCache(LEAGUE)!.weeklyDetails)).toEqual(['a']);
  });

  it('scores market players and returns their weekly details too', async () => {
    const client = {
      getCompetitionTable: vi.fn().mockResolvedValue(table(25)),
      getCompetitionMatchdays: vi.fn().mockResolvedValue(EMPTY_SCHEDULE),
      getPlayerDetailsBatch: vi
        .fn()
        .mockResolvedValueOnce([details()]) // squad
        .mockResolvedValueOnce([
          details({ firstName: 'Max', statusText: '', lastMatchdayPoints: [80, 60] }),
        ]), // market
    };

    const result = await computeScores({
      client: client as never,
      leagueId: LEAGUE,
      squad: [squadPlayer({ id: 'a' })],
      squadFreshFields: { a: FRESH },
      budget: 100_000_000,
      market: [marketPlayer({ id: 'bid1', name: 'Kandidat' })],
    });

    expect(client.getPlayerDetailsBatch).toHaveBeenCalledTimes(2);
    expect(client.getPlayerDetailsBatch).toHaveBeenNthCalledWith(2, LEAGUE, ['bid1']);
    expect(result.marketByPlayer['bid1']).toBeDefined();
    expect(result.marketWeeklyByPlayer['bid1']).toEqual({
      mc: 25,
      firstName: 'Max',
      statusText: '',
      matchSummary: expect.any(Array),
      lastMatchdayPoints: [80, 60],
      hasPlayedFlags: [],
    });
    // Der Kader-Cache bleibt Kader-only, der Marktspieler landet nicht darin.
    expect(loadOptimizerCache(LEAGUE)!.weeklyDetails['bid1']).toBeUndefined();
  });

  it('leaves marketByPlayer empty without open bids', async () => {
    const client = {
      getCompetitionTable: vi.fn().mockResolvedValue(table(25)),
      getCompetitionMatchdays: vi.fn().mockResolvedValue(EMPTY_SCHEDULE),
      getPlayerDetailsBatch: vi.fn().mockResolvedValue([details()]),
    };

    const result = await computeScores({
      client: client as never,
      leagueId: LEAGUE,
      squad: [squadPlayer({ id: 'a' })],
      squadFreshFields: { a: FRESH },
      budget: 100_000_000,
    });

    expect(client.getPlayerDetailsBatch).toHaveBeenCalledTimes(1);
    expect(result.marketByPlayer).toEqual({});
    expect(result.marketWeeklyByPlayer).toEqual({});
  });
});
