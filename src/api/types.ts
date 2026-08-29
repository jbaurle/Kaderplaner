/**
 * Types for the Kickbase v4 API client.
 *
 * Two layers:
 *   - Wire types (W*) match the API's terse field names verbatim.
 *   - Domain types (League, SquadPlayer, ...) are what the rest of the app sees.
 *
 * Mapping happens in `kickbase.ts`. Callers never import the wire types.
 */

export type PlayerId = string;
export type LeagueId = string;

/** Kickbase position codes used by the squad endpoint. */
export type PositionCode = 1 | 2 | 3 | 4;

export interface League {
  id: LeagueId;
  name: string;
}

export interface SquadPlayer {
  id: PlayerId;
  name: string;
  position: PositionCode;
  marketValue: number;
  /** "G/V seit Kauf" — gain/loss since the player was bought. */
  mvgl: number;
  isInLineup: boolean;
  /**
   * Platz in der Aufstellung — wire `lo`, 0-basiert in der Reihenfolge der
   * zuletzt gesendeten Liste (TW, ABW, MF, ANG). null, wenn er nicht
   * aufgestellt ist.
   */
  lineupOrder: number | null;
  /** Average points — wire `ap`. Used by the optimizer's form fallback. */
  averagePoints: number;
  /** Availability — wire `st`. 0 = fit. */
  status: number;
  /** Kickbase start probability 1..5 — wire `prob`. 0 = unknown. */
  probability: number;
  /** Team id — wire `tid`. */
  teamId: string;
  /**
   * Bildpfad des Spielers relativ zum CDN — wire `pim`, etwa
   * `content/file/<hash>.png`. Leer, wenn Kickbase keins führt. Verlässlicher
   * als der Pfad über die Spieler-Id: den gibt es nicht für jeden.
   */
  imagePath: string;
}

export interface LoginResult {
  token: string;
  email: string;
  userName: string | null;
  leagues: League[];
}

export interface BudgetResult {
  balance: number;
}

export interface SquadResult {
  players: SquadPlayer[];
}

/**
 * Ein Gebot auf einen Spieler, egal von wem. Kickbase liefert die Liste an
 * jedem Marktspieler mit, also auch an den eigenen, die man selbst auf den
 * Markt gestellt hat. Genau das sind die Gebote, die den Verkauf lohnen.
 */
export interface MarketOffer {
  /** Id des bietenden Managers. Dient zugleich als Id des Gebots. */
  userId: string;
  userName: string;
  amount: number;
  /** Bild des Managers relativ zum CDN, leer wenn Kickbase keins führt. */
  imagePath: string;
  /** Das eigene Gebot, nicht das eines Mitspielers. */
  isMine: boolean;
}

/**
 * Ein Angebot auf dem Transfermarkt.
 *
 * Feldnamen gegen eine echte Antwort geprüft (16.08.2026). Der Mapper in
 * `kickbase.ts` liest trotzdem defensiv: `ap` und `p` fehlen bei einem Teil
 * der Angebote.
 */
export interface MarketPlayer {
  id: PlayerId;
  /** Nachname, wie im Kader. */
  name: string;
  firstName: string;
  position: PositionCode;
  /** Marktwert laut Kickbase. */
  marketValue: number;
  /** Aufgerufener Preis. Bei Kickbase-Angeboten gleich dem Marktwert. */
  price: number;
  /** Restlaufzeit in Sekunden. */
  expiresInSeconds: number;
  /** Wie viele Gebote schon auf dem Spieler liegen, das eigene mitgezählt. */
  offerCount: number;
  /** Das eigene Gebot, falls eines liegt. `uoid` braucht der Rückzug. */
  myOffer: { amount: number; offerId: string } | null;
  /**
   * Alle Gebote auf den Spieler, das eigene mit `isMine` markiert. Leer, wenn
   * keins vorliegt. Ungeordnet, wie Kickbase sie liefert.
   */
  offers: MarketOffer[];
  status: number;
  probability: number;
  /** Schnitt, fehlt bei neu eingestellten Spielern. Dann 0. */
  averagePoints: number;
  teamId: string;
  /** Bildpfad relativ zum CDN, wie im Kader. */
  imagePath: string;
  /** Marktwert-Trend, 1 steigend, 2 fallend. 0 wenn nicht geliefert. */
  trend: number;
}

export interface MarketResult {
  players: MarketPlayer[];
}

// ---------- Wire types (internal) ----------

export interface WireLeague {
  id: string;
  name: string;
}

export interface WireLoginResponse {
  tkn: string;
  srvl: WireLeague[];
  unm?: string;
}

export interface WireBudgetResponse {
  b: number;
}

export interface WireSquadPlayer {
  i: string;
  n: string;
  pos: number;
  mv: number;
  mvgl: number;
  lo: number | null;
  ap?: number;
  st?: number;
  prob?: number;
  tid?: string;
  pim?: string;
}

export interface WireSquadResponse {
  it: WireSquadPlayer[];
}

/**
 * Transfermarkt, gegen eine echte Antwort geprüft (17.08.2026).
 *
 * Alles ausser `i` und `n` ist optional: `ap` und `p` fehlen bei einem Teil
 * der Angebote, `uop` und `uoid` nur bei denen mit eigenem Gebot. `ofs` steht
 * an jedem Spieler, auf dem ein Gebot liegt, auch an den eigenen: wer einen
 * Spieler selbst auf den Markt stellt, findet dort die Gebote der Mitspieler.
 */
export interface WireMarketPlayer {
  i: string;
  /** Nachname. */
  n: string;
  /** Vorname. */
  fn?: string;
  pos?: number;
  mv?: number;
  /** Marktwert-Trend, 1 steigend, 2 fallend. */
  mvt?: number;
  prc?: number;
  /** Restlaufzeit in Sekunden. */
  exs?: number;
  st?: number;
  prob?: number;
  ap?: number;
  /** Saisonpunkte. */
  p?: number;
  tid?: string;
  pim?: string;
  /** Anzahl der Gebote auf diesen Spieler. */
  ofc?: number;
  /** Eigenes Gebot: Betrag. */
  uop?: number;
  /** Eigenes Gebot: Id, die der Rückzug braucht. */
  uoid?: string;
  /** Alle Gebote auf den Spieler. */
  ofs?: WireMarketOffer[];
  /** Zeitpunkt der Einstellung. */
  dt?: string;
}

export interface WireMarketOffer {
  /** Bietender Nutzer. Gleich `uoid`, eine eigene Gebots-Id gibt es nicht. */
  u?: string;
  unm?: string;
  uoid?: string;
  uop?: number;
  /** Bild des Managers, etwa `user/<hash>.png`. */
  uim?: string;
  st?: number;
}

export interface WireMarketResponse {
  it?: WireMarketPlayer[];
}

// ---------- Optimizer-only domain types ----------

export interface CompetitionTable {
  teams: TeamRow[];
}

export interface TeamRow {
  /** teamId */
  id: string;
  /** team name */
  name: string;
  /** current league position 1..18 */
  position: number;
  /** current points */
  points: number;
  /** matches played */
  matchesPlayed: number;
  /** goal difference */
  goalDifference: number;
}

/** Eine Begegnung aus dem Spielplan des Wettbewerbs. */
export interface CompetitionMatch {
  /** Spieltag, 1-basiert. */
  day: number;
  /** Anstoss als ISO-Zeitstempel, leer wenn Kickbase keinen führt. */
  kickoff: string;
  team1Id: string;
  team2Id: string;
  /** 0 = noch nicht angepfiffen, alles andere läuft oder ist vorbei. */
  state: number;
}

/**
 * Der komplette Spielplan einer Saison. Anders als `mdsum` im Spielerdetail
 * deckt er alle Vereine und alle 34 Spieltage ab und hängt an keinem Kader.
 */
export interface CompetitionMatchdays {
  /** Laufender Spieltag laut Kickbase, 0 wenn unbekannt. */
  currentDay: number;
  matches: CompetitionMatch[];
}

export interface PlayerDetails {
  /** Vorname. Leer, wenn Kickbase keinen führt. */
  firstName: string;
  /** Nachname, wie im Kader. */
  lastName: string;
  averagePoints: number;
  /** 0 = available, anything else = unavailable. */
  status: number;
  statusText: string;
  teamId: string;
  teamName: string;
  /** Kickbase 1..5 start probability; 0 means "not provided". */
  probability: number;
  /**
   * Punkte je Spieltag aus `ph`, **jüngster Spieltag zuerst**, 0 für
   * Spieltage ohne Einsatz. Aktuell liefert Kickbase ein Fenster von fünf
   * Einträgen.
   *
   * Die Reihenfolge ist nirgends dokumentiert und am 01.08.2026 an einer
   * echten Response verifiziert: `ph` war `[nicht gespielt, ...]`, während
   * `/players/{id}/performance` für denselben Spieler am letzten Spieltag
   * 0 Minuten und an den vier davor 77'..81' auswies. Nur die Lesart
   * jüngster-zuerst passt dazu. Achtung: `mdsum` im selben Response läuft
   * andersherum, nämlich aufsteigend nach Spieltag.
   */
  lastMatchdayPoints: number[];
  /** Same length as lastMatchdayPoints — true when the player actually featured. */
  hasPlayedFlags: boolean[];
  /** Schedule + results for the player's team this season. */
  matchSummary: MatchSummary[];
}

/**
 * Ein Spieltag aus der Spielerhistorie, `/players/{id}/performance`.
 *
 * Kickbase liefert dort jede Saison, in der der Spieler geführt wurde, mit
 * allen Spieltagen. Der eigene Verein hängt am einzelnen Spieltag, nicht an
 * der Saison: wer im Winter wechselt, hat in derselben Saison zwei.
 */
export interface PerformanceMatchday {
  /** Spieltagsnummer, 1-basiert. */
  day: number;
  /** Punkte an diesem Spieltag. `null` heißt: nicht im Kader. */
  points: number | null;
  /** Einsatzminuten, 0 ohne Einsatz. */
  minutes: number;
  /** Der Verein des Spielers an diesem Spieltag. */
  teamId: string;
  opponentId: string;
  /** Tore aus Sicht des Spielers. */
  goalsFor: number;
  goalsAgainst: number;
  /** Anstoß, ISO 8601. Leer, wenn Kickbase keinen führt. */
  kickoff: string;
}

export interface PerformanceSeason {
  /** Saison-Id laut Kickbase, etwa "35". */
  id: string;
  /** Beschriftung, etwa "2025/2026". */
  title: string;
  /** Wettbewerb dieser Saison, etwa "Bundesliga". */
  competition: string;
  /**
   * Die Spieltage in der Reihenfolge von Kickbase, aufsteigend. Die Liste ist
   * nicht zwingend lückenlos: Ryerson fehlt in 2022/2023 der 8. Spieltag ganz.
   */
  matchdays: PerformanceMatchday[];
}

export interface PlayerPerformance {
  /** Aufsteigend nach Saison, die laufende steht zuletzt. */
  seasons: PerformanceSeason[];
}

export interface MatchSummary {
  /** matchday number (1-based) */
  day: number;
  /** 0 = upcoming, 2 = finished (others not currently used). */
  state: number;
  /** team 1 id */
  team1Id: string;
  /** team 2 id */
  team2Id: string;
  /** goals team 1 (0 for upcoming) */
  team1Goals: number;
  /** goals team 2 (0 for upcoming) */
  team2Goals: number;
}

// ---------- Wire types (internal, optimizer) ----------

export interface WireCompetitionTable {
  it: WireTeamRow[];
}

export interface WireTeamRow {
  tid: string;
  tn: string;
  cpl: number;
  cp: number;
  mc: number;
  gd: number;
}

export interface WireCompetitionMatchdays {
  /** laufender Spieltag */
  day?: number;
  /** ein Eintrag je Spieltag */
  it?: WireMatchday[];
}

export interface WireMatchday {
  day?: number;
  /** die Begegnungen dieses Spieltags */
  it?: WireMatchdayMatch[];
}

export interface WireMatchdayMatch {
  day?: number;
  /** Anstoss, ISO 8601 */
  dt?: string;
  t1?: string;
  t2?: string;
  /** Status, 0 = noch nicht angepfiffen */
  st?: number;
}

export interface WirePlayerDetails {
  /** Vorname. Nur hier, der Kader liefert ihn nicht. */
  fn?: string;
  /** Nachname. */
  ln?: string;
  ap?: number;
  st?: number;
  stxt?: string;
  tid?: string;
  tn?: string;
  prob?: number;
  ph?: WirePointsHistoryEntry[];
  mdsum?: WireMatchSummary[];
}

export interface WirePointsHistoryEntry {
  hp?: boolean;
  p?: number;
}

export interface WirePerformanceResponse {
  it?: WirePerformanceSeason[];
}

export interface WirePerformanceSeason {
  /** Saison-Id, etwa "35". */
  sid?: string;
  /** Beschriftung, etwa "2025/2026". */
  ti?: string;
  /** Wettbewerb, etwa "Bundesliga". */
  n?: string;
  ph?: WirePerformanceMatch[];
}

export interface WirePerformanceMatch {
  day?: number;
  /** Punkte. Fehlt ganz, wenn der Spieler nicht im Kader stand. */
  p?: number;
  /** Einsatzminuten als Text, etwa "103'". */
  mp?: string;
  /** Anstoß, ISO 8601. */
  md?: string;
  t1?: string;
  t2?: string;
  t1g?: number;
  t2g?: number;
  /** Der Verein des Spielers an diesem Spieltag. */
  pt?: string;
}

export interface WireMatchSummary {
  day: number;
  mdst: number;
  t1: string;
  t2: string;
  t1g: number;
  t2g: number;
}
