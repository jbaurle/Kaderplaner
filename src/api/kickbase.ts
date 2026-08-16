/**
 * Kickbase v4 API client — port of `KBClient.gs` to the browser `fetch` API.
 *
 * Surface stays minimal: only the endpoints the planning view needs
 * (login, budget, squad, Aufstellung setzen). Optimizer-only endpoints from
 * the original Apps Script are deliberately omitted.
 *
 * CORS: api.kickbase.com echoes Origin and allows credentialed requests, so
 * the browser can call it directly. Verified 2026-04-28 against the
 * Cloudflare-Frankfurt edge. Geprüft wurde damals nur Lesen; ob der Preflight
 * auch für den POST auf `lineup` durchgeht, zeigt erst der erste Versuch.
 */

import type {
  BudgetResult,
  CompetitionMatch,
  CompetitionMatchdays,
  CompetitionTable,
  LeagueId,
  LoginResult,
  MarketPlayer,
  MarketResult,
  MatchSummary,
  PlayerDetails,
  PlayerId,
  PositionCode,
  SquadPlayer,
  SquadResult,
  TeamRow,
  WireBudgetResponse,
  WireCompetitionMatchdays,
  WireCompetitionTable,
  WireLoginResponse,
  WireMarketPlayer,
  WireMarketResponse,
  WireMatchSummary,
  WirePlayerDetails,
  WireSquadPlayer,
  WireSquadResponse,
  WireTeamRow,
} from './types.js';

const BASE_URL = 'https://api.kickbase.com/v4/';

export class KickbaseError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /**
     * Fachlicher Fehlercode aus dem Body (`err`), 0 wenn keiner kam.
     * Kickbase schickt fachliche Fehler mit HTTP 500, der Grund steht nur
     * hier drin: 6 = InvalidData, 5080 = UnderpayNotAllowed.
     */
    public readonly code = 0,
  ) {
    super(message);
    this.name = 'KickbaseError';
  }

  get isUnauthorized(): boolean {
    // Kickbase antwortet bei fehlendem oder abgelaufenem Token mit 403; nur
    // user/login liefert 401 (falsche Zugangsdaten). Beides heisst: Session weg.
    return this.status === 401 || this.status === 403;
  }
}

/** Fehlercodes, die wir kennen und übersetzen können. */
export const ERROR_CODES = {
  invalidData: 6,
  underpayNotAllowed: 5080,
} as const;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  authenticated?: boolean;
}

export class KickbaseClient {
  private token: string | null;

  constructor(token: string | null = null) {
    this.token = token;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const wire = await this.request<WireLoginResponse>('user/login', {
      method: 'POST',
      body: { em: email, pass: password, loy: false, rep: {} },
      authenticated: false,
    });
    this.token = wire.tkn;
    return {
      token: wire.tkn,
      email,
      userName: wire.unm ?? null,
      leagues: wire.srvl.map((l) => ({ id: l.id, name: l.name })),
    };
  }

  async getBudget(leagueId: LeagueId): Promise<BudgetResult> {
    const wire = await this.request<WireBudgetResponse>(`leagues/${leagueId}/me/budget`);
    return { balance: wire.b };
  }

  async getSquad(leagueId: LeagueId): Promise<SquadResult> {
    const wire = await this.request<WireSquadResponse>(`leagues/${leagueId}/squad`);
    return { players: wire.it.map(toSquadPlayer) };
  }

  /**
   * Aufstellung setzen. Der Endpoint nimmt nur die Formation und die elf Ids,
   * keine Feldpositionen: wo einer auf dem Rasen steht, ist Sache der App.
   *
   * Quelle ist die Community-Doku `kevinskyba/kickbase-api-doc`, nicht die
   * offizielle App. Antwortet Kickbase anders als erwartet, landet das als
   * `KickbaseError` beim Aufrufer.
   */
  async setLineup(
    leagueId: LeagueId,
    formation: string,
    playerIds: readonly PlayerId[],
  ): Promise<void> {
    await this.request<void>(`leagues/${leagueId}/lineup`, {
      method: 'POST',
      body: { type: formation, players: [...playerIds] },
    });
  }

  /**
   * Transfermarkt der Liga. Nur v2 ruft das auf.
   *
   * Der Endpoint ist nicht verifiziert: Pfad und Feldnamen stammen aus der
   * Community-Doku, nicht aus der App. Antwortet Kickbase anders, fällt der
   * Mapper auf Nullwerte zurück statt zu werfen; ein echter Fehler (404, 403)
   * kommt weiter als {@link KickbaseError} beim Aufrufer an.
   */
  async getMarket(leagueId: LeagueId): Promise<MarketResult> {
    const wire = await this.request<WireMarketResponse>(`leagues/${leagueId}/market`);
    return { players: (wire?.it ?? []).map(toMarketPlayer) };
  }

  /**
   * Gebot abgeben. Pfad und Feldname sind gegen die echte API geprüft
   * (16.08.2026): der Body trägt genau `price`, alle anderen Namen antworten
   * mit `InvalidData`.
   *
   * Fachliche Absagen kommen als HTTP 500 mit Code im Body, etwa 5080
   * `UnderpayNotAllowed`, wenn das Gebot unter dem Mindestpreis liegt.
   */
  async placeOffer(leagueId: LeagueId, playerId: PlayerId, price: number): Promise<void> {
    await this.request<void>(`leagues/${leagueId}/market/${playerId}/offers`, {
      method: 'POST',
      body: { price: Math.round(price) },
    });
  }

  /**
   * Gebot zurückziehen. Gegen die echte API geprüft (16.08.2026): DELETE auf
   * diesen Pfad antwortet mit 200 und das Gebot ist weg.
   *
   * `offerId` ist das `uoid` aus der Marktantwort.
   */
  async withdrawOffer(
    leagueId: LeagueId,
    playerId: PlayerId,
    offerId: string,
  ): Promise<void> {
    await this.request<void>(`leagues/${leagueId}/market/${playerId}/offers/${offerId}`, {
      method: 'DELETE',
    });
  }

  async getCompetitionTable(competitionId: number): Promise<CompetitionTable> {
    const wire = await this.request<WireCompetitionTable>(
      `competitions/${competitionId}/table`,
    );
    return { teams: wire.it.map(toTeamRow) };
  }

  /**
   * Der Spielplan der Saison, flach: alle Begegnungen aller Spieltage in einer
   * Liste. Die Schachtelung nach Spieltag trägt keine Information, die nicht
   * schon in `day` der Begegnung steht.
   */
  async getCompetitionMatchdays(competitionId: number): Promise<CompetitionMatchdays> {
    const wire = await this.request<WireCompetitionMatchdays>(
      `competitions/${competitionId}/matchdays`,
    );
    const matches: CompetitionMatch[] = [];
    for (const matchday of wire.it ?? []) {
      for (const match of matchday.it ?? []) {
        if (!match.t1 || !match.t2) continue;
        matches.push({
          day: match.day ?? matchday.day ?? 0,
          kickoff: match.dt ?? '',
          team1Id: match.t1,
          team2Id: match.t2,
          state: match.st ?? 0,
        });
      }
    }
    return { currentDay: wire.day ?? 0, matches };
  }

  async getPlayerDetails(leagueId: LeagueId, playerId: PlayerId): Promise<PlayerDetails> {
    const wire = await this.request<WirePlayerDetails>(
      `leagues/${leagueId}/players/${playerId}`,
    );
    return toPlayerDetails(wire);
  }

  /**
   * Fetches all player ids in parallel. Rejects on the first failure — partial
   * results would yield an unsound optimizer run, so we prefer all-or-nothing.
   */
  async getPlayerDetailsBatch(
    leagueId: LeagueId,
    playerIds: readonly PlayerId[],
  ): Promise<PlayerDetails[]> {
    return Promise.all(playerIds.map((id) => this.getPlayerDetails(leagueId, id)));
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, authenticated = true } = options;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated && this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, init);
    } catch (cause) {
      throw new KickbaseError(0, `Netzwerkfehler: ${(cause as Error)?.message ?? 'unbekannt'}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      // Fachliche Fehler kommen als 500 mit `{err, errMsg}` im Body. Ohne das
      // auszupacken hiesse jeder abgelehnte Gebotsversuch nur "Fehler 500".
      let code = 0;
      let message = text || `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(text) as { err?: number; errMsg?: string };
        if (typeof parsed?.err === 'number') code = parsed.err;
        if (parsed?.errMsg) message = parsed.errMsg;
      } catch {
        // Kein JSON, dann bleibt der Rohtext stehen.
      }
      throw new KickbaseError(response.status, message, code);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

function toSquadPlayer(wire: WireSquadPlayer): SquadPlayer {
  return {
    id: wire.i,
    name: wire.n,
    position: clampPosition(wire.pos),
    marketValue: wire.mv,
    mvgl: wire.mvgl,
    isInLineup: wire.lo != null,
    averagePoints: wire.ap ?? 0,
    status: wire.st ?? 0,
    probability: wire.prob ?? 0,
    teamId: wire.tid ?? '',
    imagePath: wire.pim ?? '',
  };
}

/** Test-only: der Mapper hängt an einer echten Antwort, das gehört geprüft. */
export const _marketInternal = { toMarketPlayer };

function toMarketPlayer(wire: WireMarketPlayer): MarketPlayer {
  const marketValue = wire.mv ?? 0;
  // `uop` ohne `uoid` wäre nutzlos: ohne Id kein Rückzug.
  const myOffer =
    wire.uop != null && wire.uoid
      ? { amount: wire.uop, offerId: wire.uoid }
      : null;

  return {
    id: wire.i,
    name: wire.n,
    firstName: wire.fn ?? '',
    position: clampPosition(wire.pos ?? 1),
    marketValue,
    price: wire.prc ?? marketValue,
    expiresInSeconds: wire.exs ?? 0,
    offerCount: wire.ofc ?? 0,
    myOffer,
    status: wire.st ?? 0,
    probability: wire.prob ?? 0,
    averagePoints: wire.ap ?? 0,
    teamId: wire.tid ?? '',
    imagePath: wire.pim ?? '',
    trend: wire.mvt ?? 0,
  };
}

function clampPosition(code: number): PositionCode {
  if (code === 1 || code === 2 || code === 3 || code === 4) return code;
  // Defensive: future Kickbase changes should not crash the app.
  return 1;
}

function toTeamRow(wire: WireTeamRow): TeamRow {
  return {
    id: wire.tid,
    name: wire.tn,
    position: wire.cpl,
    points: wire.cp,
    matchesPlayed: wire.mc,
    goalDifference: wire.gd,
  };
}

function toPlayerDetails(wire: WirePlayerDetails): PlayerDetails {
  const ph = wire.ph ?? [];
  const lastMatchdayPoints: number[] = [];
  const hasPlayedFlags: boolean[] = [];
  for (const entry of ph) {
    lastMatchdayPoints.push(entry.hp ? entry.p ?? 0 : 0);
    hasPlayedFlags.push(!!entry.hp);
  }
  return {
    averagePoints: wire.ap ?? 0,
    status: wire.st ?? 0,
    statusText: wire.stxt ?? '',
    teamId: wire.tid ?? '',
    teamName: wire.tn ?? '',
    probability: wire.prob ?? 0,
    lastMatchdayPoints,
    hasPlayedFlags,
    matchSummary: (wire.mdsum ?? []).map(toMatchSummary),
  };
}

function toMatchSummary(wire: WireMatchSummary): MatchSummary {
  return {
    day: wire.day,
    state: wire.mdst,
    team1Id: wire.t1,
    team2Id: wire.t2,
    team1Goals: wire.t1g,
    team2Goals: wire.t2g,
  };
}
