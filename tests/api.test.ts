import { afterEach, describe, expect, it, vi } from 'vitest';
import { KickbaseClient, KickbaseError, _marketInternal } from '../src/api/kickbase.js';
import type { WireMarketPlayer } from '../src/api/types.js';

interface FetchCall {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function captureCalls(): { calls: FetchCall[]; setResponse: (r: Response | (() => Response | Promise<Response>)) => void } {
  const calls: FetchCall[] = [];
  let next: Response | (() => Response | Promise<Response>) = new Response('null', { status: 200 });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: typeof input === 'string' ? input : input.toString(),
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return typeof next === 'function' ? next() : next;
    }),
  );

  return {
    calls,
    setResponse(r) {
      next = r;
    },
  };
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('KickbaseClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('login', () => {
    it('POSTs JSON to /v4/user/login and returns mapped result', async () => {
      const { calls, setResponse } = captureCalls();
      setResponse(jsonResponse({
        tkn: 'tok-123',
        unm: 'thilo',
        srvl: [
          { id: 'l1', name: 'Friends 1' },
          { id: 'l2', name: 'Friends 2' },
        ],
      }));

      const client = new KickbaseClient();
      const result = await client.login('a@b.de', 'pw');

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('https://api.kickbase.com/v4/user/login');
      expect(calls[0]?.method).toBe('POST');
      expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
      expect(JSON.parse(calls[0]?.body ?? 'null')).toEqual({
        em: 'a@b.de',
        pass: 'pw',
        loy: false,
        rep: {},
      });
      expect(result).toEqual({
        token: 'tok-123',
        email: 'a@b.de',
        userName: 'thilo',
        leagues: [
          { id: 'l1', name: 'Friends 1' },
          { id: 'l2', name: 'Friends 2' },
        ],
      });
    });

    it('does NOT attach an Authorization header on login, even with a pre-existing token', async () => {
      const { calls, setResponse } = captureCalls();
      setResponse(jsonResponse({ tkn: 't', srvl: [], unm: 'x' }));

      const client = new KickbaseClient('preexisting-token');
      await client.login('a@b.de', 'pw');

      expect(calls[0]?.headers.has('Authorization')).toBe(false);
    });

    it('throws a KickbaseError with isUnauthorized=true on 401', async () => {
      const { setResponse } = captureCalls();
      setResponse(new Response('{"err":1,"errMsg":"AccessDenied"}', { status: 401 }));

      const client = new KickbaseClient();
      const err = await client.login('a@b.de', 'wrong').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KickbaseError);
      expect((err as KickbaseError).status).toBe(401);
      expect((err as KickbaseError).isUnauthorized).toBe(true);
    });

    it('throws a KickbaseError with status=0 on network failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      );

      const client = new KickbaseClient();
      const err = await client.login('a@b.de', 'pw').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KickbaseError);
      expect((err as KickbaseError).status).toBe(0);
    });

    it('defaults userName to null when wire `unm` is missing', async () => {
      const { setResponse } = captureCalls();
      setResponse(jsonResponse({ tkn: 'tok', srvl: [{ id: 'l', name: 'L' }] }));

      const client = new KickbaseClient();
      const result = await client.login('a@b.de', 'pw');
      expect(result.userName).toBeNull();
    });
  });

  describe('getBudget + getSquad', () => {
    it('attaches the bearer token after login', async () => {
      const { calls, setResponse } = captureCalls();
      let phase = 0;
      setResponse(() => {
        phase += 1;
        if (phase === 1) return jsonResponse({ tkn: 'TOKEN_X', srvl: [{ id: 'l', name: 'L' }] });
        return jsonResponse({ b: 12345 });
      });

      const client = new KickbaseClient();
      await client.login('a@b.de', 'pw');
      await client.getBudget('l');

      expect(calls).toHaveLength(2);
      expect(calls[1]?.headers.get('Authorization')).toBe('Bearer TOKEN_X');
      expect(calls[1]?.url).toBe('https://api.kickbase.com/v4/leagues/l/me/budget');
    });

    it('returns the budget balance', async () => {
      const { setResponse } = captureCalls();
      setResponse(jsonResponse({ b: 999_999 }));

      const client = new KickbaseClient('tok');
      const result = await client.getBudget('league-1');
      expect(result.balance).toBe(999_999);
    });

    it('maps wire squad fields to domain shape', async () => {
      const { setResponse } = captureCalls();
      setResponse(jsonResponse({
        it: [
          { i: 'p1', n: 'Dahmen',     pos: 1, mv: 100, mvgl:   5, lo: 1,    ap: 90, st: 0, prob: 1, tid: 'tA', pim: 'content/file/a.png' },
          { i: 'p2', n: 'Bensebaini', pos: 2, mv: 200, mvgl: -10, lo: null, ap: 80, st: 1, prob: 0, tid: 'tB' },
        ],
      }));

      const client = new KickbaseClient('tok');
      const { players } = await client.getSquad('league-1');
      expect(players).toEqual([
        { id: 'p1', name: 'Dahmen',     position: 1, marketValue: 100, mvgl:   5, isInLineup: true,  averagePoints: 90, status: 0, probability: 1, teamId: 'tA', imagePath: 'content/file/a.png' },
        { id: 'p2', name: 'Bensebaini', position: 2, marketValue: 200, mvgl: -10, isInLineup: false, averagePoints: 80, status: 1, probability: 0, teamId: 'tB', imagePath: '' },
      ]);
    });

    it('clamps an unexpected position code to TW (1) instead of crashing', async () => {
      const { setResponse } = captureCalls();
      setResponse(jsonResponse({ it: [{ i: 'x', n: 'X', pos: 99, mv: 0, mvgl: 0, lo: null }] }));

      const client = new KickbaseClient('tok');
      const { players } = await client.getSquad('league-1');
      expect(players[0]?.position).toBe(1);
      expect(players[0]?.averagePoints).toBe(0);
    });

    it('throws KickbaseError with isUnauthorized=true on 401 for getSquad', async () => {
      const { setResponse } = captureCalls();
      setResponse(new Response('', { status: 401 }));

      const client = new KickbaseClient('expired-token');
      const err = await client.getSquad('league-1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KickbaseError);
      expect((err as KickbaseError).isUnauthorized).toBe(true);
    });

    // Der Live-Fall: abgelaufene Token beantwortet Kickbase mit 403, nicht 401.
    it('throws KickbaseError with isUnauthorized=true on 403 for getSquad', async () => {
      const { setResponse } = captureCalls();
      setResponse(new Response('', { status: 403 }));

      const client = new KickbaseClient('expired-token');
      const err = await client.getSquad('league-1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KickbaseError);
      expect((err as KickbaseError).status).toBe(403);
      expect((err as KickbaseError).isUnauthorized).toBe(true);
    });
  });

  describe('setToken', () => {
    it('updates the bearer token used by subsequent requests', async () => {
      const { calls, setResponse } = captureCalls();
      setResponse(() => jsonResponse({ b: 0 })); // fresh Response per call (bodies are one-shot)

      const client = new KickbaseClient('first');
      await client.getBudget('l');
      client.setToken('second');
      await client.getBudget('l');
      client.setToken(null);
      await client.getBudget('l');

      expect(calls[0]?.headers.get('Authorization')).toBe('Bearer first');
      expect(calls[1]?.headers.get('Authorization')).toBe('Bearer second');
      expect(calls[2]?.headers.get('Authorization')).toBeNull();
    });
  });

  describe('getCompetitionTable', () => {
    it('GETs /competitions/{id}/table with bearer token and maps the response', async () => {
      const { calls, setResponse } = captureCalls();
      setResponse(jsonResponse({
        it: [
          { tid: 't1', tn: 'Bayern',     cpl: 1, cp: 60, mc: 25, gd: 50 },
          { tid: 't2', tn: 'Dortmund',   cpl: 2, cp: 55, mc: 25, gd: 30 },
        ],
      }));

      const client = new KickbaseClient('tok');
      const table = await client.getCompetitionTable(1);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('https://api.kickbase.com/v4/competitions/1/table');
      expect(calls[0]?.method).toBe('GET');
      expect(calls[0]?.headers.get('Authorization')).toBe('Bearer tok');
      expect(table.teams).toEqual([
        { id: 't1', name: 'Bayern',   position: 1, points: 60, matchesPlayed: 25, goalDifference: 50 },
        { id: 't2', name: 'Dortmund', position: 2, points: 55, matchesPlayed: 25, goalDifference: 30 },
      ]);
    });

    it('throws KickbaseError with isUnauthorized=true on 401', async () => {
      const { setResponse } = captureCalls();
      setResponse(new Response('', { status: 401 }));

      const client = new KickbaseClient('expired');
      const err = await client.getCompetitionTable(1).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KickbaseError);
      expect((err as KickbaseError).isUnauthorized).toBe(true);
    });
  });

  describe('getPlayerDetails', () => {
    it('GETs /leagues/{lid}/players/{pid} with bearer token and maps the response', async () => {
      const { calls, setResponse } = captureCalls();
      setResponse(jsonResponse({
        ap: 92.5,
        st: 0,
        stxt: 'fit',
        tid: 'team-bay',
        tn: 'Bayern',
        prob: 4,
        ph: [
          { hp: true, p: 120 },
          { hp: false, p: 0 },
          { hp: true, p: 60 },
        ],
        mdsum: [
          { day: 25, mdst: 2, t1: 'team-bay', t2: 'team-fcb', t1g: 3, t2g: 1 },
          { day: 26, mdst: 0, t1: 'team-fra', t2: 'team-bay', t1g: 0, t2g: 0 },
        ],
      }));

      const client = new KickbaseClient('tok');
      const details = await client.getPlayerDetails('league-1', 'player-1');

      expect(calls[0]?.url).toBe('https://api.kickbase.com/v4/leagues/league-1/players/player-1');
      expect(calls[0]?.headers.get('Authorization')).toBe('Bearer tok');
      expect(details).toEqual({
        averagePoints: 92.5,
        status: 0,
        statusText: 'fit',
        teamId: 'team-bay',
        teamName: 'Bayern',
        probability: 4,
        lastMatchdayPoints: [120, 0, 60],
        hasPlayedFlags: [true, false, true],
        matchSummary: [
          { day: 25, state: 2, team1Id: 'team-bay', team2Id: 'team-fcb', team1Goals: 3, team2Goals: 1 },
          { day: 26, state: 0, team1Id: 'team-fra', team2Id: 'team-bay', team1Goals: 0, team2Goals: 0 },
        ],
      });
    });

    it('defaults missing optional fields safely (status=0, prob=0, empty arrays)', async () => {
      const { setResponse } = captureCalls();
      setResponse(jsonResponse({}));

      const client = new KickbaseClient('tok');
      const details = await client.getPlayerDetails('l', 'p');
      expect(details).toEqual({
        averagePoints: 0,
        status: 0,
        statusText: '',
        teamId: '',
        teamName: '',
        probability: 0,
        lastMatchdayPoints: [],
        hasPlayedFlags: [],
        matchSummary: [],
      });
    });
  });

  describe('getPlayerDetailsBatch', () => {
    it('fetches all ids in parallel and returns them in input order', async () => {
      const { calls, setResponse } = captureCalls();
      let i = 0;
      setResponse(() => {
        i += 1;
        return jsonResponse({ ap: i * 10, tid: `t${i}` });
      });

      const client = new KickbaseClient('tok');
      const results = await client.getPlayerDetailsBatch('league-1', ['a', 'b', 'c']);

      expect(calls).toHaveLength(3);
      const urls = calls.map((c) => c.url);
      expect(urls).toContain('https://api.kickbase.com/v4/leagues/league-1/players/a');
      expect(urls).toContain('https://api.kickbase.com/v4/leagues/league-1/players/b');
      expect(urls).toContain('https://api.kickbase.com/v4/leagues/league-1/players/c');
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.teamId)).toEqual(['t1', 't2', 't3']);
    });

    it('rejects when any single fetch fails', async () => {
      const { setResponse } = captureCalls();
      let i = 0;
      setResponse(() => {
        i += 1;
        if (i === 2) return new Response('', { status: 500 });
        return jsonResponse({ ap: 1 });
      });

      const client = new KickbaseClient('tok');
      const err = await client.getPlayerDetailsBatch('l', ['a', 'b', 'c']).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KickbaseError);
      expect((err as KickbaseError).status).toBe(500);
    });
  });
});

/**
 * Das eigene Gebot hängt als `uop` und `uoid` am Marktspieler. Die Feldnamen
 * stammen aus einer echten Antwort vom 16.08.2026.
 */
describe('toMarketPlayer', () => {
  it('liest das eigene Gebot aus uop und uoid', () => {
    const wire: WireMarketPlayer = {
      i: '6149',
      fn: 'Frank',
      n: 'Lehmann',
      tid: '77',
      pos: 1,
      st: 2,
      mvt: 2,
      mv: 2_005_732,
      ofc: 1,
      exs: 77_058,
      prc: 2_005_732,
      uop: 2_500_000,
      uoid: '1893023',
      pim: 'content/file/40a9.png',
      prob: 5,
    };

    const player = _marketInternal.toMarketPlayer(wire);

    expect(player.myOffer).toEqual({ amount: 2_500_000, offerId: '1893023' });
    expect(player.offerCount).toBe(1);
    expect(player.expiresInSeconds).toBe(77_058);
    expect(player.price).toBe(2_005_732);
    expect(player.firstName).toBe('Frank');
    expect(player.imagePath).toBe('content/file/40a9.png');
  });

  it('kommt ohne ap und ohne Gebot aus', () => {
    const player = _marketInternal.toMarketPlayer({ i: '7336', n: 'Suso', mv: 3_906_054 });

    expect(player.myOffer).toBeNull();
    expect(player.averagePoints).toBe(0);
    // Ohne prc gilt der Marktwert als Preis.
    expect(player.price).toBe(3_906_054);
  });

  it('ignoriert ein Gebot ohne Id, damit kein Rueckzug ins Leere laeuft', () => {
    const player = _marketInternal.toMarketPlayer({ i: '1', n: 'X', uop: 500 });
    expect(player.myOffer).toBeNull();
  });

  /**
   * Karazor am 17.08.2026: von uns eingestellt, ein fremdes Gebot. Kickbase
   * fuehrt keine eigene Gebots-Id, `u` und `uoid` tragen die Nutzer-Id.
   */
  it('liest fremde Gebote aus ofs, ohne sie als eigene zu zaehlen', () => {
    const player = _marketInternal.toMarketPlayer({
      i: '2214',
      n: 'Karazor',
      mv: 7_790_264,
      prc: 8_500_000,
      ofc: 1,
      ofs: [
        {
          u: '1930849',
          uoid: '1930849',
          unm: 'Karinator',
          uop: 8_900_000,
          uim: 'user/09fad33bc5a048329c5956b2173fa043.png',
          st: 0,
        },
      ],
    });

    expect(player.myOffer).toBeNull();
    expect(player.offers).toEqual([
      {
        userId: '1930849',
        userName: 'Karinator',
        amount: 8_900_000,
        imagePath: 'user/09fad33bc5a048329c5956b2173fa043.png',
        isMine: false,
      },
    ]);
  });

  it('markiert das eigene Gebot in ofs ueber uoid am Spieler', () => {
    const player = _marketInternal.toMarketPlayer({
      i: '6158',
      n: 'Schnellbacher',
      mv: 3_852_232,
      uop: 4_000_000,
      uoid: '1893023',
      ofs: [{ u: '1893023', uoid: '1893023', unm: 'Jelrab_', uop: 4_000_000 }],
    });

    expect(player.myOffer).toEqual({ amount: 4_000_000, offerId: '1893023' });
    expect(player.offers.map((o) => o.isMine)).toEqual([true]);
  });

  it('kommt ohne ofs aus', () => {
    expect(_marketInternal.toMarketPlayer({ i: '1', n: 'X' }).offers).toEqual([]);
  });
});
