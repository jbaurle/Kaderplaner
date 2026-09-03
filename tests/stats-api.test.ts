/**
 * Die drei Endpunkte der Statistik, gegen die Feldnamen der echten API
 * (Stand 03.09.2026): `user/me`, `leagues/{id}/ranking` und
 * `leagues/{id}/managers/{uid}/performance`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { KickbaseClient } from '../src/api/kickbase.js';

function stubFetch(body: unknown): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      urls.push(typeof input === 'string' ? input : input.toString());
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return { urls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KickbaseClient: Statistik', () => {
  it('getMe liest die Id aus u.id', async () => {
    stubFetch({ u: { id: '1893023', name: 'Jelrab_', email: 'x@y.de' } });
    const me = await new KickbaseClient('tok').getMe();
    expect(me).toEqual({ id: '1893023', name: 'Jelrab_' });
  });

  it('getLeagueRanking bildet die Manager ab und lässt Einträge ohne Id weg', async () => {
    const { urls } = stubFetch({
      ti: 'Stuggi League',
      us: [
        { i: '1893023', n: 'Jelrab_', sp: 1473, spl: 1, mdp: 1473, mdpl: 1, tv: 239214548, uim: 'user/a.jpeg' },
        { n: 'ohne Id' },
        { i: '1930849', n: 'Karinator', sp: 1374, spl: 2 },
      ],
    });
    const ranking = await new KickbaseClient('tok').getLeagueRanking('1909854');
    expect(urls[0]).toBe('https://api.kickbase.com/v4/leagues/1909854/ranking');
    expect(ranking.leagueName).toBe('Stuggi League');
    expect(ranking.managers).toEqual([
      {
        id: '1893023', name: 'Jelrab_', imagePath: 'user/a.jpeg',
        seasonPoints: 1473, seasonPlace: 1, dayPoints: 1473, dayPlace: 1, teamValue: 239214548,
      },
      {
        id: '1930849', name: 'Karinator', imagePath: '',
        seasonPoints: 1374, seasonPlace: 2, dayPoints: 0, dayPlace: 0, teamValue: 0,
      },
    ]);
  });

  it('getManagerPerformance bildet Saisons und Spieltage ab', async () => {
    const { urls } = stubFetch({
      u: '1893023',
      unm: 'Jelrab_',
      it: [
        { sid: '25', sn: '2025/2026', pl: 0, ap: 1137, tp: 38676, mdw: 23, it: [{ day: 1, mdp: 1141, tw: true }] },
        {
          sid: '42', sn: '2026/2027', pl: 1, ap: 1473, tp: 1473, mdw: 1,
          it: [
            { day: 1, cur: true, mdp: 1473, md: '2026-08-28T18:30:00Z', tw: true },
            { day: 2, mdp: 0, md: '2026-09-04T18:30:00Z', tw: false },
            { mdp: 99 },
          ],
        },
      ],
    });
    const performance = await new KickbaseClient('tok').getManagerPerformance('1909854', '1893023');
    expect(urls[0]).toBe('https://api.kickbase.com/v4/leagues/1909854/managers/1893023/performance');
    expect(performance.managerId).toBe('1893023');
    expect(performance.managerName).toBe('Jelrab_');
    expect(performance.seasons).toHaveLength(2);
    const current = performance.seasons[1]!;
    expect(current).toMatchObject({ id: '42', title: '2026/2027', place: 1, averagePoints: 1473, totalPoints: 1473, wins: 1 });
    // Der Eintrag ohne Spieltagsnummer fällt weg.
    expect(current.matchdays).toEqual([
      { day: 1, points: 1473, kickoff: '2026-08-28T18:30:00Z', won: true },
      { day: 2, points: 0, kickoff: '2026-09-04T18:30:00Z', won: false },
    ]);
  });
});
