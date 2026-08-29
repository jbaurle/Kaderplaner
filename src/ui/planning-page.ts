/**
 * Planning page controller. Holds in-memory state, fetches from the API,
 * persists scenarios + snapshots, and renders both desktop + mobile views
 * (CSS hides whichever doesn't match the viewport).
 *
 * Renders three layers:
 *   1. The header bar (title + league link + formation + Laden + account).
 *   2. Optional error / score-error banners.
 *   3. The table container, plus the footline.
 *
 * Der pure Renderer liegt in `planning-desktop.ts`. Eine Tabelle für jede
 * Breite: welche Spalten sichtbar sind, entscheidet CSS.
 */

import { KickbaseClient, KickbaseError } from '../api/kickbase.js';
import { getTheme, toggleTheme, THEME_ICON, themeToggleLabel } from './theme.js';
import type {
  League,
  LeagueId,
  MarketOffer,
  MarketPlayer,
  PlayerId,
  PlayerPerformance,
  SquadPlayer,
} from '../api/types.js';
import { computePlanning, planningRowFromMarketPlayer, type MarketListing, type PlanningView } from '../compute/planning.js';
import {
  computeScores,
  type ScoreResult,
  type SquadFreshFields,
} from '../compute/score.js';
import {
  clearSlot,
  loadScenarios,
  saveScenarios,
  setFlag,
  type ScenarioSlot,
  type ScenarioState,
} from '../state/planning.js';
import { loadLineup, saveLineup } from '../state/lineup.js';
import { isFresh, loadPerformance, savePerformance } from '../state/performance.js';
import { defaultSeasonId } from '../compute/performance.js';
import { loadOppLayout, saveOppLayout } from '../state/opponents.js';
import { loadOptimizerCache } from '../state/optimizer.js';
import { buildLabel } from './build-info.js';
import { escapeHtml } from './format.js';
import { LineupPage, kickbaseLineup, type LineupPlayer } from './lineup-page.js';
import {
  renderFormationHelpBody,
  renderHelpModal,
  FEATURES_HELP_BODY,
  FEATURES_HELP_TITLE,
  FORMATION_HELP_TITLE,
  SCORE_HELP_BODY,
  SCORE_HELP_TITLE,
  type FormationHelpInput,
  type HelpModal,
} from './help.js';
import { renderOffersBody } from './offers-dialog.js';
import { computePlayerInsight } from '../compute/player-insight.js';
import { renderPlayerDialog } from './player-dialog.js';
import {
  planningDesktopMarkup,
  updatePlanningScenarios,
  wirePlanningDesktop,
  type DesktopScoresProp,
  type TransferRow,
} from './planning-desktop.js';
import { positionLabel, type PositionLabel } from '../compute/optimizer.js';
import type { ResolvedScenarioSlot } from '../compute/planning.js';

export interface PlanningPageProps {
  host: HTMLElement;
  client: KickbaseClient;
  leagueId: LeagueId;
  leagueName: string;
  /** Alle Ligen des Accounts. Ab zwei wird der Liganame zum Wechsel-Link. */
  leagues: League[];
  userLabel: string;
  onSelectLeague: (leagueId: LeagueId) => void;
  onLogout: () => void;
  onUnauthorized: () => void;
}

/**
 * Offene Overlays: die Hilfetexte, die Ligaauswahl und die Gebote auf einen
 * Spieler. Nur letztere hängen an einer Id.
 */
type ModalKind =
  | HelpModal
  | 'league'
  | { kind: 'offers'; playerId: PlayerId }
  | { kind: 'player'; playerId: PlayerId };

interface PageState {
  isLoading: boolean;
  isScoring: boolean;
  error: string | null;
  scoreError: string | null;
  budget: number | null;
  squad: SquadPlayer[] | null;
  scenarios: ScenarioState;
  /**
   * Currently displayed scores. Cleared on every Laden, re-filled by the
   * Score-Lauf, der direkt danach anläuft. Persisted cache is independent
   * (see `state/optimizer.ts`).
   */
  scores: ScoreResult | null;
  /**
   * Der Transfermarkt, wie ihn Kickbase gerade führt. Das eigene Gebot hängt
   * als `uop`/`uoid` am Spieler, deshalb stehen im Transferblock auch Gebote,
   * die in der Kickbase-App abgegeben wurden.
   */
  market: MarketPlayer[];
  /** Offenes Overlay, `null` wenn keins. */
  modal: ModalKind | null;
  /**
   * Szenariospalte, die unter 820 px sichtbar ist. Darüber zeigt CSS alle
   * vier und der Umschalter verschwindet.
   */
  activeSlot: ResolvedScenarioSlot;
  /**
   * Punkte je Spieltag, je Spieler. Füllt sich beim Öffnen des Spielerdialogs
   * aus dem Cache (`state/performance.ts`) und aus der Antwort von Kickbase.
   */
  performance: Record<PlayerId, PlayerPerformance>;
  /** Der Spieler, dessen Punkte gerade unterwegs sind. Für den Ladetext. */
  performanceLoading: PlayerId | null;
  /** Saison, die im Spielerdialog offen steht. */
  performanceSeason: string | null;
  /** Angetippter Spieltag im Spielerdialog, null wenn keiner. */
  performanceDay: number | null;
}

export class PlanningPage {
  private readonly props: PlanningPageProps;
  private state: PageState;
  /** Hängt an der Tabelle und meldet jede Breitenänderung, siehe `watchWidth`. */
  private widthObserver: ResizeObserver | null = null;
  /** Als Felder, damit `dispose()` genau diese Listener wieder abhängt. */
  private readonly onResize = (): void => this.fitAmounts();
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.closeModal();
  };
  /**
   * Zählt die Score-Läufe. Ein neues Laden oder ein neuer Lauf zählt hoch,
   * damit die Antwort eines überholten Laufs nicht mehr in den State fällt.
   */
  private scoreRun = 0;
  /** Das Modal des letzten Renderns, siehe die Scroll-Rettung in `render`. */
  private renderedModalKey = '';

  constructor(props: PlanningPageProps) {
    this.props = props;
    this.state = {
      isLoading: true,
      isScoring: false,
      error: null,
      scoreError: null,
      budget: null,
      squad: null,
      scenarios: loadScenarios(props.leagueId),
      scores: null,
      market: [],
      modal: null,
      activeSlot: 'S1',
      performance: {},
      performanceLoading: null,
      performanceSeason: null,
      performanceDay: null,
    };
  }

  start(): void {
    this.render();
    void this.fetch();
    // Drehen ändert die Breite, ohne dass neu gerendert wird.
    window.addEventListener('resize', this.onResize);
    // Escape hängt am Dokument, nicht am Overlay: das Overlay hat beim Öffnen
    // keinen Fokus, die Taste käme dort erst nach einem Klick an. Ohne offenes
    // Overlay läuft `closeModal()` ins Leere.
    document.addEventListener('keydown', this.onKeydown);
  }

  /**
   * Hängt die Listener an window/document wieder ab. Ohne diesen Aufruf lebt
   * eine verworfene Instanz weiter: ihr Escape-Handler rendert den Host dann
   * mit den veralteten Daten der alten Liga neu. `App` ruft das vor jedem
   * Ansichtswechsel auf.
   */
  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKeydown);
    this.widthObserver?.disconnect();
    this.widthObserver = null;
  }

  /** Fetch budget + squad, danach laufen die Scores automatisch hinterher. */
  private async fetch(): Promise<void> {
    this.state.isLoading = true;
    this.state.error = null;
    this.state.scores = null;
    this.state.scoreError = null;
    // Ein Lauf, der noch unterwegs ist, gilt ab jetzt für einen alten Kader.
    this.scoreRun += 1;
    this.state.isScoring = false;
    this.render();

    try {
      // Der Markt darf das Laden nicht aufhalten: fällt er aus, bleibt der
      // Transferblock leer und Kader und Score stehen trotzdem.
      const [budget, squad, market] = await Promise.all([
        this.props.client.getBudget(this.props.leagueId),
        this.props.client.getSquad(this.props.leagueId),
        this.props.client.getMarket(this.props.leagueId).catch(() => ({ players: [] })),
      ]);

      this.state.budget = budget.balance;
      this.state.squad = squad.players;
      this.state.market = market.players;
      this.state.isLoading = false;
      this.render();

      // Zweite Stufe: die Tabelle steht schon, der Score-Lauf blockiert sie
      // nicht. Am selben Spieltag kostet er einen einzigen Request, weil die
      // Spielerdetails aus dem Cache kommen (`state/optimizer.ts`).
      void this.runScores();
    } catch (err) {
      if (err instanceof KickbaseError && err.isUnauthorized) {
        this.props.onUnauthorized();
        return;
      }
      this.state.isLoading = false;
      this.state.error = friendlyMessage(err);
      this.render();
    }
  }

  /**
   * Compute scores via cache + optimizer. Läuft nach jedem Laden von selbst
   * und noch einmal, wenn jemand nach einem Fehler auf "Erneut versuchen"
   * drückt. Der jeweils jüngste Lauf gewinnt.
   */
  private async runScores(): Promise<void> {
    if (!this.state.squad || this.state.budget === null) return;
    const run = ++this.scoreRun;
    this.state.isScoring = true;
    this.state.scoreError = null;
    this.render();

    try {
      const fresh = extractSquadFreshFields(this.state.squad);
      const result = await computeScores({
        client: this.props.client,
        leagueId: this.props.leagueId,
        squad: this.state.squad,
        squadFreshFields: fresh,
        budget: this.state.budget,
        market: this.bids(),
      });
      if (run !== this.scoreRun) return;
      this.state.scores = result;
      this.state.isScoring = false;
      // Damit die Gegner-Spalte beim nächsten Laden gleich in ihrer Breite und
      // mit ihrem Spieltag steht, statt erst mit den Wappen zu wachsen.
      saveOppLayout(this.props.leagueId, {
        columns: result.opponents.columns,
        nextDay: result.opponents.nextDay,
      });
      this.render();
    } catch (err) {
      if (err instanceof KickbaseError && err.isUnauthorized) {
        this.props.onUnauthorized();
        return;
      }
      if (run !== this.scoreRun) return;
      this.state.isScoring = false;
      this.state.scoreError = friendlyScoreMessage(err);
      this.render();
    }
  }

  /** Die eigenen offenen Gebote, in der Reihenfolge des Marktes. */
  /**
   * Das höchste Gebot eines Mitspielers je Spieler. Das eigene zählt nicht:
   * es sagt nichts darüber, was ein Verkauf bringt.
   *
   * Gebote hängen am Marktspieler, und auf dem Markt stehen auch die eigenen,
   * die man selbst dorthin gestellt hat. Genau die treffen den Kader.
   */
  private bestOffers(): Record<PlayerId, number> {
    const out: Record<PlayerId, number> = {};
    for (const player of this.state.market) {
      const amounts = player.offers.filter((o) => !o.isMine).map((o) => o.amount);
      if (amounts.length > 0) out[player.id] = Math.max(...amounts);
    }
    return out;
  }

  /**
   * Die eigenen Angebote im Transfermarkt. Auf dem Markt stehen auch die
   * eigenen Spieler, und nur die treffen den Kader: ein Kaderspieler, der
   * dort auftaucht, ist einer, den man selbst eingestellt hat.
   */
  private listings(): Record<PlayerId, MarketListing> {
    const squadIds = new Set((this.state.squad ?? []).map((p) => p.id));
    const out: Record<PlayerId, MarketListing> = {};
    for (const player of this.state.market) {
      if (!squadIds.has(player.id)) continue;
      out[player.id] = {
        price: player.price,
        expiresInSeconds: player.expiresInSeconds,
        offerCount: player.offers.filter((o) => !o.isMine).length,
      };
    }
    return out;
  }

  /** Die fremden Gebote auf einen Spieler, absteigend. Leer, wenn keine da sind. */
  private offersFor(playerId: PlayerId): MarketOffer[] {
    const player = this.state.market.find((p) => p.id === playerId);
    return (player?.offers ?? []).filter((o) => !o.isMine);
  }

  private bids(): MarketPlayer[] {
    return this.state.market.filter((p) => p.myOffer !== null);
  }

  /**
   * Häkchen dieser Spalte nur im Transferblock löschen. `clearSlot` wäre
   * falsch: das räumt auch den Kader ab, und beide Blöcke teilen sich
   * denselben Zustand.
   */
  private handleClearTransferSlot(slot: ScenarioSlot): void {
    this.setAllTransferFlags(slot, false);
  }

  /** ✓ im Transferkopf: alle Zugänge dieser Spalte anhaken. */
  private handleSelectAllTransfers(slot: ScenarioSlot): void {
    this.setAllTransferFlags(slot, true);
  }

  private setAllTransferFlags(slot: ScenarioSlot, value: boolean): void {
    let next = this.state.scenarios;
    for (const bid of this.bids()) next = setFlag(next, bid.id, slot, value);
    this.state.scenarios = next;
    saveScenarios(this.props.leagueId, next);
    this.applyScenarioChange();
  }

  private toggleFlag(playerId: PlayerId, slot: ScenarioSlot): void {
    const current = this.state.scenarios.byPlayer[playerId]?.[slot] ?? false;
    this.state.scenarios = setFlag(this.state.scenarios, playerId, slot, !current);
    saveScenarios(this.props.leagueId, this.state.scenarios);
    this.applyScenarioChange();
  }

  /**
   * Volle Beträge nur, wenn sie wirklich passen.
   *
   * Wie breit "128.200.000 €" ist, hängt an Schrift und Gerät: Safari auf
   * dem iPad setzt breiter als Chrome unter Windows, und die längste Zahl
   * hängt am Kader. Eine feste Pixelgrenze rechnet deshalb an der Wirklichkeit
   * vorbei. Hier wird stattdessen einmal die volle Schreibweise probiert und
   * bei Überlauf auf Millionen zurückgefallen.
   */
  private fitAmounts(): void {
    const shell = this.props.host.querySelector<HTMLElement>('.planning-shell');
    const host = this.props.host.querySelector<HTMLElement>('.planning-table-host');
    if (!shell || !host) return;
    shell.classList.remove('is-compact-amounts');
    if (host.scrollWidth > host.clientWidth) shell.classList.add('is-compact-amounts');
  }

  /**
   * Die Passprobe an die tatsächliche Größe hängen, nicht nur ans Rendern.
   * Beim ersten Aufbau steht die Breite manchmal noch nicht fest, etwa
   * solange Safari die Adressleiste einklappt; ohne Beobachter bliebe das
   * falsche Ergebnis stehen, bis der nächste Klick neu zeichnet.
   */
  private watchWidth(): void {
    const host = this.props.host.querySelector<HTMLElement>('.planning-table-host');
    if (!host) return;
    this.widthObserver?.disconnect();
    this.widthObserver = new ResizeObserver(() => this.fitAmounts());
    this.widthObserver.observe(host);
  }

  private handleSelectSlot(slot: ResolvedScenarioSlot): void {
    if (this.state.activeSlot === slot) return;
    this.state.activeSlot = slot;
    this.render();
  }

  private handleClearSlot(slot: ScenarioSlot): void {
    this.state.scenarios = clearSlot(this.state.scenarios, slot);
    saveScenarios(this.props.leagueId, this.state.scenarios);
    this.applyScenarioChange();
  }

  /**
   * Copy the auto-bench state (S4 = !isInLineup) into a user slot. Used to
   * seed a new manual scenario from the current bench, then customise from
   * there. Replaces the slot's existing flags entirely.
   *
   * Die Zugänge hakt sie mit an. BANK verkauft jeden von ihnen, denn ein
   * Zugang steht nie in der Aufstellung; ohne sie stünde die Spalte auf einem
   * anderen Kontostand als die Vorlage.
   */
  private handleCopyFromS4(slot: ScenarioSlot): void {
    if (!this.state.squad) return;
    let next = clearSlot(this.state.scenarios, slot);
    for (const player of this.state.squad) {
      if (!player.isInLineup) {
        next = setFlag(next, player.id, slot, true);
      }
    }
    for (const bid of this.bids()) {
      next = setFlag(next, bid.id, slot, true);
    }
    this.state.scenarios = next;
    saveScenarios(this.props.leagueId, this.state.scenarios);
    this.applyScenarioChange();
  }

  /**
   * Kader, Gebote und Häkchen zu einer Ansicht rechnen. Eigene Methode, weil
   * ein Häkchen dieselbe Rechnung braucht wie das Rendern, nur ohne neuen
   * Aufbau der Tabelle.
   */
  private buildView(): { view: PlanningView; transferRows: TransferRow[] } | null {
    const { state } = this;
    if (!state.squad || state.budget === null) return null;

    const transferRows: TransferRow[] = this.bids().map((player) => ({
      player,
      flags: state.scenarios.byPlayer[player.id] ?? { S1: false, S2: false, S3: false },
    }));

    const view = computePlanning({
      budget: state.budget,
      squad: state.squad,
      scenarios: state.scenarios,
      transfers: transferRows.map((row) => ({
        id: row.player.id,
        positionLabel: positionLabel(row.player.position),
        amount: row.player.myOffer?.amount ?? 0,
        marketValue: row.player.marketValue,
        flags: row.flags,
      })),
      bestOffers: this.bestOffers(),
      listings: this.listings(),
    });

    return { view, transferRows };
  }

  /**
   * Ein Häkchen ändert Zahlen und Klassen, keinen Aufbau. Deshalb wird die
   * Tabelle nachgezogen statt neu gebaut: die Wappen bleiben dieselben
   * Elemente und flackern nicht. Steht keine Tabelle da, bleibt es beim
   * vollen Aufbau.
   */
  private applyScenarioChange(): void {
    const host = this.props.host.querySelector<HTMLElement>('.planning-table-host');
    const built = this.buildView();
    if (!host || !built || !host.querySelector('.planning-table')) {
      this.render();
      return;
    }
    updatePlanningScenarios(host, built.view, built.transferRows, this.state.activeSlot);
    this.fitAmounts();
  }

  private render(): void {
    const { state, props } = this;

    /*
     * Netz unter dem Umbau: die Seite entsteht in einer einzigen Zuweisung,
     * das Dokument schrumpft dabei nicht mehr zwischendurch. Sollte WebKit
     * die Position trotzdem verlieren, steht sie hier noch. Nur im Hauptzweig
     * gesetzt, die frühen Rückgaben für Laden und Fehler gehören nach oben.
     */
    const scrollY = window.scrollY;
    /*
     * Dasselbe für den Dialog: ein Tipp auf einen Spieltag baut die Seite neu
     * auf, und der Abschnitt ganz unten wäre danach wieder außer Sicht. Aber
     * nur, solange dasselbe Modal offen bleibt: der Gebotsdialog, der aus
     * einem gescrollten Spielerdialog aufgeht, soll oben beginnen.
     */
    const modalKey = describeModal(state.modal);
    const dialogScroll = modalKey === this.renderedModalKey
      ? props.host.querySelector<HTMLElement>('.dialog-body')?.scrollTop ?? 0
      : 0;
    /*
     * Und dasselbe für den Fokus: Saison-Reiter und Spieltag-Kacheln bauen
     * die Seite neu auf, der Fokus soll danach auf dem gleichwertigen neuen
     * Element weiterleben statt auf den Backdrop zu fallen. Nur diese beiden
     * Controls rendern aus dem offenen Dialog heraus neu.
     */
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let dialogFocus: string | null = null;
    if (modalKey === this.renderedModalKey && active?.closest('[data-dialog-shade]')) {
      const seasonTab = active.dataset['seasonTab'];
      const perfDay = active.dataset['perfDay'];
      if (seasonTab !== undefined) dialogFocus = `[data-season-tab="${CSS.escape(seasonTab)}"]`;
      else if (perfDay !== undefined) dialogFocus = `[data-perf-day="${CSS.escape(perfDay)}"]`;
    }
    this.renderedModalKey = modalKey;

    // First-load skeleton — no data yet.
    if (state.isLoading && !state.squad) {
      props.host.innerHTML = `
        <main class="auth-shell">
          <p class="auth-hint">Kaderdaten werden geladen…</p>
        </main>
      `;
      return;
    }

    // Error before any data has loaded.
    if (!state.squad || state.budget === null) {
      props.host.innerHTML = `
        <main class="auth-shell">
          <section class="auth-card">
            <h1 class="auth-title">Fehler</h1>
            <p class="auth-error" role="alert">${escapeHtml(state.error ?? 'Daten konnten nicht geladen werden.')}</p>
            <button type="button" class="auth-submit" id="retry-btn">Erneut versuchen</button>
            <button type="button" class="auth-link" id="logout-btn">Abmelden</button>
          </section>
        </main>
      `;
      props.host.querySelector('#retry-btn')?.addEventListener('click', () => void this.fetch());
      props.host.querySelector('#logout-btn')?.addEventListener('click', () => props.onLogout());
      return;
    }

    // Die Daten sind oben geprüft, hier fällt die Rechnung nicht mehr aus.
    const built = this.buildView();
    if (!built) return;
    const { view, transferRows } = built;

    const desktopScores: DesktopScoresProp | null = state.scores
      ? {
          byPlayer: state.scores.byPlayer,
          top11Ids: state.scores.top11Ids,
          formationFallback: state.scores.formationFallback,
          opponents: state.scores.opponents,
          marketByPlayer: state.scores.marketByPlayer,
        }
      : null;

    const fallbackBanner =
      state.scores?.formationFallback
        ? `<div class="banner banner--warning">
              Keine gültige Formation möglich, Scores werden ohne Aufstellung gezeigt.
              <button type="button" class="help-dot help-dot--banner" data-modal="formation"
                      aria-label="Warum ist keine Formation möglich?">?</button>
            </div>`
        : '';
    const modalHtml = this.renderModal(view);

    props.host.innerHTML = `
      <div class="planning-shell${state.isScoring ? ' is-scoring' : ''}">
        <header class="planning-header">
          <h1><img class="brand-mark" src="/favicon.svg" alt="" width="22" height="22">Kaderplaner</h1>
          <div class="planning-account">
            <span class="user-label">${escapeHtml(props.userLabel)}</span>
            <button type="button" class="icon-btn icon-btn--theme" id="theme-toggle-btn"
                    title="${themeToggleLabel(getTheme())}"
                    aria-label="${themeToggleLabel(getTheme())}">
              ${THEME_ICON[getTheme()]}
            </button>
            <button type="button" class="icon-btn" id="logout-btn" title="Abmelden" aria-label="Abmelden">
              ${LOGOUT_ICON}
            </button>
          </div>
          <div class="planning-subtitle">
            ${renderLeagueLabel(props.leagueName)} ·
            <button type="button" class="formation-chip formation-chip--link" data-lineup
                    title="Aufstellung bearbeiten">${escapeHtml(view.formation)}</button> ·
            ${view.totalPlayers} Spieler · ${view.lineupCount}/11 in Aufstellung
          </div>
          <div class="planning-actions-row">
            <button type="button" class="btn btn--primary${state.isLoading ? ' is-busy' : ''}"
                    id="laden-btn"${state.isLoading ? ' disabled aria-busy="true"' : ''}>
              <span class="btn-label">Laden</span>
            </button>
            <button type="button" class="btn btn--secondary" id="lineup-btn">Aufstellung</button>
          </div>
        </header>
        ${
          state.error
            ? `<div class="banner banner--warning">
                ${escapeHtml(state.error)}
                <button type="button" class="banner-action" id="retry-btn">Erneut versuchen</button>
              </div>`
            : ''
        }
        ${
          state.scoreError
            ? `<div class="banner banner--warning">
                ${escapeHtml(state.scoreError)}
                <button type="button" class="banner-action" id="score-retry-btn">Erneut versuchen</button>
              </div>`
            : ''
        }
        ${fallbackBanner}
        <div class="planning-table-host">${planningDesktopMarkup(
          view,
          desktopScores,
          transferRows,
          state.activeSlot,
          loadOppLayout(props.leagueId),
        )}</div>
        ${renderFootline(state.scores, state.isScoring)}
      </div>
      ${modalHtml}
    `;

    const tableHost = props.host.querySelector<HTMLElement>('.planning-table-host');
    if (!tableHost) {
      throw new Error('PlanningPage: table container missing after render.');
    }

    const onToggle = (playerId: PlayerId, slot: ScenarioSlot): void =>
      this.toggleFlag(playerId, slot);
    const onClearSlot = (slot: ScenarioSlot): void => this.handleClearSlot(slot);
    const onCopyFromS4 = (slot: ScenarioSlot): void => this.handleCopyFromS4(slot);
    const onSelectSlot = (slot: ResolvedScenarioSlot): void => this.handleSelectSlot(slot);
    wirePlanningDesktop(tableHost, {
      onToggle,
      onClearSlot,
      onCopyFromS4,
      onSelectSlot,
      onShowOffers: (playerId) => this.openModal({ kind: 'offers', playerId }),
      onShowPlayer: (playerId) => this.openModal({ kind: 'player', playerId }),
      onClearTransferSlot: (slot) => this.handleClearTransferSlot(slot),
      onSelectAllTransfers: (slot) => this.handleSelectAllTransfers(slot),
    });
    this.fitAmounts();
    this.watchWidth();

    props.host
      .querySelector('[data-lineup]')
      ?.addEventListener('click', () => this.openLineup(view));
    props.host
      .querySelector('#lineup-btn')
      ?.addEventListener('click', () => this.openLineup(view));
    props.host.querySelector('#laden-btn')?.addEventListener('click', () => void this.fetch());
    props.host.querySelector('#logout-btn')?.addEventListener('click', () => props.onLogout());
    // Reine CSS-Umschaltung (data-theme auf <html>), kein Re-Render der
    // Seite nötig — nur der Knopf selbst zeigt danach das andere Icon.
    const themeButton = props.host.querySelector<HTMLButtonElement>('#theme-toggle-btn');
    themeButton?.addEventListener('click', () => {
      const next = toggleTheme();
      const label = themeToggleLabel(next);
      themeButton.innerHTML = THEME_ICON[next];
      themeButton.title = label;
      themeButton.setAttribute('aria-label', label);
    });
    props.host.querySelector('#retry-btn')?.addEventListener('click', () => void this.fetch());
    props.host.querySelector('#score-retry-btn')?.addEventListener('click', () => void this.runScores());

    // Listener hängen an frisch gerenderten Elementen, nicht am dauerhaften
    // Host: `render()` läuft bei jedem Toggle und würde dort stapeln.
    for (const el of props.host.querySelectorAll<HTMLElement>('[data-modal]')) {
      el.addEventListener('click', () => {
        const kind = el.dataset['modal'];
        if (kind === 'features' || kind === 'score' || kind === 'formation' || kind === 'league') {
          this.openModal(kind);
        }
      });
    }
    this.wireModal(dialogFocus);
    // Deklarativ statt in openModal und closeModal: so stimmt die Sperre auch
    // dann, wenn ein Laden oder ein Ligawechsel das Overlay nebenbei schließt.
    document.body.classList.toggle('is-dialog-open', this.state.modal !== null);

    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    if (dialogScroll > 0) {
      const body = props.host.querySelector<HTMLElement>('.dialog-body');
      if (body) body.scrollTop = dialogScroll;
    }
  }

  /**
   * Aufstellung öffnen. Die Seite legt sich als eigene Ebene über die
   * Tabelle und arbeitet mit den bereits geladenen Daten, es geht also kein
   * Request raus.
   *
   * Ohne gespeicherten Entwurf startet sie mit der Aufstellung, die Kickbase
   * heute meldet. Der Entwurf selbst bleibt lokal, an Kickbase geschickt wird
   * noch nichts.
   */
  private openLineup(view: PlanningView): void {
    const players: LineupPlayer[] = view.rows.map((row) => ({
      id: row.id,
      name: row.name,
      positionLabel: row.positionLabel,
      marketValue: row.marketValue,
      teamId: row.teamId,
      status: row.status,
      probability: row.probability,
      imagePath: row.imagePath,
      isInLineup: row.isInLineup,
      lineupOrder: row.lineupOrder,
    }));
    const known = new Set(players.map((p) => p.id));
    const stored = loadLineup(this.props.leagueId, known);
    const initialIds = stored ?? kickbaseLineup(players);
    const scores = this.state.scores;

    new LineupPage({
      players,
      budget: view.budget,
      scores: scores ? scores.byPlayer : null,
      // Ohne gültige Formation hat der Optimizer keine Elf, nur Einzelwerte.
      bestEleven: scores && !scores.formationFallback ? scores.top11Ids : null,
      initialIds,
      onChange: (ids) => saveLineup(this.props.leagueId, ids),
      // Nach dem Senden ist `isInLineup` im Kader veraltet, also einmal neu
      // laden. Fällt der POST durch, bleibt es beim Fehler im Blatt.
      onSubmit: async (formation, ids) => {
        await this.props.client.setLineup(this.props.leagueId, formation, ids);
        await this.fetch();
      },
      onClose: () => {},
      onUnauthorized: () => this.props.onUnauthorized(),
    }).open();
  }

  private openModal(kind: ModalKind): void {
    this.state.modal = kind;
    if (typeof kind === 'object' && kind.kind === 'player') {
      // Jeder Spieler bringt seine eigene Saison und seinen eigenen
      // angetippten Spieltag mit, der vorige darf nicht stehen bleiben.
      this.state.performanceSeason = null;
      this.state.performanceDay = null;
      this.applyCachedPerformance(kind.playerId);
      void this.refreshPerformance(kind.playerId);
    }
    this.render();
  }

  /**
   * Den Cache-Eintrag in den State heben, ohne zu rendern. So steht der
   * Abschnitt schon beim Aufgehen des Dialogs da, auch wenn gleich danach
   * eine Anfrage rausgeht.
   */
  private applyCachedPerformance(playerId: PlayerId): void {
    const cached = loadPerformance(this.props.leagueId, playerId);
    if (!cached) return;
    this.state.performance[playerId] = cached.performance;
    this.state.performanceSeason = defaultSeasonId(cached.performance);
  }

  /**
   * Die Punkte je Spieltag holen, wenn der Cache fehlt oder zu alt ist. Ein
   * Fehler bleibt still: der Dialog steht auch ohne diesen Abschnitt, und ein
   * Banner über der Tabelle würde zu einem geschlossenen Dialog gehören.
   */
  private async refreshPerformance(playerId: PlayerId): Promise<void> {
    const cached = loadPerformance(this.props.leagueId, playerId);
    if (cached && isFresh(cached)) return;

    this.state.performanceLoading = playerId;
    this.render();
    try {
      const performance = await this.props.client.getPlayerPerformance(
        this.props.leagueId,
        playerId,
      );
      savePerformance(this.props.leagueId, playerId, performance);
      this.state.performance[playerId] = performance;
      // Die Saison nur setzen, solange keine gewählt ist und der Dialog noch
      // zu diesem Spieler gehört. Wer während der Anfrage umschaltet, soll
      // nicht zurückgeworfen werden; und die späte Antwort eines schon
      // geschlossenen Dialogs darf nicht die Saison des nächsten bestimmen.
      const modal = this.state.modal;
      const stillOpen =
        typeof modal === 'object' && modal !== null
        && modal.kind === 'player' && modal.playerId === playerId;
      if (stillOpen && this.state.performanceSeason === null) {
        this.state.performanceSeason = defaultSeasonId(performance);
      }
    } catch (err) {
      if (err instanceof KickbaseError && err.isUnauthorized) {
        this.props.onUnauthorized();
        return;
      }
    } finally {
      if (this.state.performanceLoading === playerId) this.state.performanceLoading = null;
      this.render();
    }
  }

  private closeModal(): void {
    if (!this.state.modal) return;
    this.state.modal = null;
    this.render();
  }

  private renderModal(view: PlanningView): string {
    if (this.state.modal === 'features') {
      return renderHelpModal(FEATURES_HELP_TITLE, FEATURES_HELP_BODY);
    }
    if (this.state.modal === 'score') {
      return renderHelpModal(SCORE_HELP_TITLE, SCORE_HELP_BODY);
    }
    if (this.state.modal === 'formation') {
      return renderHelpModal(
        FORMATION_HELP_TITLE,
        renderFormationHelpBody(collectFormationHelp(view, this.state.scores)),
      );
    }
    if (this.state.modal === 'league') {
      return renderHelpModal(
        'Liga wechseln',
        renderLeagueChoice(this.props.leagues, this.props.leagueId),
      );
    }
    const modal = this.state.modal;
    if (modal !== null && typeof modal === 'object' && modal.kind === 'offers') {
      return this.renderOffersModal(modal.playerId, view);
    }
    if (modal !== null && typeof modal === 'object' && modal.kind === 'player') {
      return this.renderPlayerModal(modal.playerId, view);
    }
    return '';
  }

  /**
   * Die Gebote auf einen Kaderspieler. Der Kopf trägt seinen Namen, darunter
   * steht, wie viele es sind. Fehlt der Spieler oder sind die Gebote weg, geht
   * gar nichts auf: dazwischen kann ein Laden liegen.
   */
  private renderOffersModal(playerId: PlayerId, view: PlanningView): string {
    const row = view.rows.find((r) => r.id === playerId);
    const offers = this.offersFor(playerId);
    if (!row || offers.length === 0) return '';

    const market = this.state.market.find((p) => p.id === playerId);
    const body = renderOffersBody({
      playerName: row.name,
      marketValue: row.marketValue,
      mvgl: row.mvgl,
      askingPrice: market?.price ?? 0,
      offers,
    });
    const count = offers.length === 1 ? '1 Gebot' : `${offers.length} Gebote`;
    return renderHelpModal(`Gebote für ${row.name}`, body, count);
  }

  /**
   * Der Spielerdialog. Alles darin steht schon im Speicher: die Zeile aus der
   * Planungsansicht, der Score aus dem letzten Lauf und die Spieltage aus dem
   * Optimizer-Cache. Der zweite Optimizer-Lauf für "beste Elf ohne ihn" läuft
   * lokal auf denselben Zutaten, es geht keine einzige Abfrage raus.
   */
  private renderPlayerModal(playerId: PlayerId, view: PlanningView): string {
    const squadRow = view.rows.find((r) => r.id === playerId);
    const isOwned = squadRow !== undefined;
    // Nicht im Kader: der Name kam aus dem Transferblock, ein Gebot auf
    // einen fremden Spieler. Derselbe Dialog, nur ohne Verkaufsfolgen — der
    // gehört noch niemandem.
    const marketPlayer = this.state.market.find((p) => p.id === playerId);
    const row = squadRow ?? (marketPlayer ? planningRowFromMarketPlayer(marketPlayer) : null);
    if (!row) return '';

    const scores = this.state.scores;
    const cache = loadOptimizerCache(this.props.leagueId);
    // Kaderspieler stehen im Kader-Cache und in `byPlayer`, Marktspieler
    // separat in `marketWeeklyByPlayer`/`marketByPlayer` — der Kader-Cache
    // räumt alles weg, was nicht im Kader steht (siehe ComputeScoresInput.market).
    const weekly = isOwned ? cache?.weeklyDetails[playerId] : scores?.marketWeeklyByPlayer[playerId];
    const score = isOwned ? scores?.byPlayer[playerId] : scores?.marketByPlayer[playerId];

    const insight = computePlayerInsight({
      row,
      squad: view.rows,
      budget: view.budget,
      score: score ?? null,
      scoreByPlayer: scores?.byPlayer ?? {},
      top11Ids: scores?.top11Ids ?? [],
      lineupInput: scores?.lineupInput ?? null,
      fixtures: scores?.fixturesAhead[row.teamId] ?? [],
      kickoffs: scores?.kickoffs[row.teamId] ?? {},
      teams: scores?.opponents.teams ?? {},
      teamCount: scores?.opponents.teamCount ?? 0,
      weekly: weekly
        ? {
            mc: weekly.mc,
            lastMatchdayPoints: weekly.lastMatchdayPoints,
            hasPlayedFlags: weekly.hasPlayedFlags,
            matchSummary: weekly.matchSummary,
          }
        : null,
    });

    return renderPlayerDialog({
      playerId: row.id,
      name: row.name,
      firstName: weekly?.firstName ?? '',
      statusText: weekly?.statusText ?? '',
      positionLabel: row.positionLabel,
      position: row.position,
      teamId: row.teamId,
      teamName: scores?.opponents.teams[row.teamId]?.name ?? '',
      imagePath: row.imagePath,
      status: row.status,
      marketValue: row.marketValue,
      saleValue: row.saleValue,
      mvgl: row.mvgl,
      score: score ?? null,
      listing: row.listing,
      bestOffer: row.bestOffer,
      insight,
      performance: {
        performance: this.state.performance[row.id] ?? null,
        seasonId: this.state.performanceSeason,
        isLoading: this.state.performanceLoading === row.id,
        selectedDay: this.state.performanceDay,
      },
      isOwned,
    });
  }

  private wireModal(focusSelector: string | null = null): void {
    const backdrop = this.props.host.querySelector<HTMLElement>('[data-dialog-shade]');
    if (!backdrop) return;
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) this.closeModal();
    });

    // aria-modal="true" verspricht, dass hinter dem Dialog nichts erreichbar
    // ist. Die Seite dahinter bleibt aber im Dokument, also fängt das Overlay
    // Tab selbst ein und läuft an den Rändern im Kreis.
    backdrop.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusables = [...backdrop.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === backdrop)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    });
    // Mehrere Schliesser: das Kreuz im Kopf und die bereits offene Liga.
    for (const el of backdrop.querySelectorAll<HTMLElement>('[data-dialog-close]')) {
      el.addEventListener('click', () => this.closeModal());
    }

    // Der Knopf im Marktstreifen des Spielerdialogs. Er löst den Spieler-
    // dialog durch den Gebotsdialog ab, wie der grüne Betrag in der Tabelle.
    for (const el of backdrop.querySelectorAll<HTMLElement>('[data-offers]')) {
      el.addEventListener('click', () => {
        const id = el.dataset['offers'];
        if (id) this.openModal({ kind: 'offers', playerId: id });
      });
    }

    // Umschalter und Spieltage im Abschnitt "Punkte je Spieltag".
    for (const el of backdrop.querySelectorAll<HTMLElement>('[data-season-tab]')) {
      el.addEventListener('click', () => {
        const seasonId = el.dataset['seasonTab'];
        if (!seasonId || seasonId === this.state.performanceSeason) return;
        this.state.performanceSeason = seasonId;
        // Der angetippte Spieltag gehört zur alten Saison und sagt in der
        // neuen etwas anderes.
        this.state.performanceDay = null;
        this.render();
      });
    }
    for (const el of backdrop.querySelectorAll<HTMLElement>('[data-perf-day]')) {
      el.addEventListener('click', () => {
        const day = Number(el.dataset['perfDay']);
        if (!Number.isFinite(day)) return;
        this.state.performanceDay = this.state.performanceDay === day ? null : day;
        this.render();
      });
    }

    // Die Sprechblase zum angetippten Spieltag steht mittig über ihrer Spalte.
    // An den Randspalten liefe sie aus dem Dialog, deshalb wird hier gemessen
    // und der Überstand über --callout-shift zurückgeschoben; der Pfeil im CSS
    // wandert gegenläufig und bleibt über der Spalte.
    const callout = backdrop.querySelector<HTMLElement>('.pd-perf-callout');
    const dialogBox = callout?.closest<HTMLElement>('.dialog-box');
    if (callout && dialogBox) {
      const edge = 8;
      const bubble = callout.getBoundingClientRect();
      const box = dialogBox.getBoundingClientRect();
      const shift = bubble.left < box.left + edge
        ? box.left + edge - bubble.left
        : Math.min(0, box.right - edge - bubble.right);
      if (shift !== 0) callout.style.setProperty('--callout-shift', `${shift}px`);
    }

    // Die offene Liga trägt keine Id, ein Klick darauf lädt also nichts neu.
    for (const el of backdrop.querySelectorAll<HTMLElement>('[data-league-id]')) {
      el.addEventListener('click', () => {
        const id = el.dataset['leagueId'];
        if (id) this.props.onSelectLeague(id);
      });
    }

    // Der gerettete Fokus aus `render()`, sonst der Backdrop als Ausgangspunkt.
    const restored = focusSelector ? backdrop.querySelector<HTMLElement>(focusSelector) : null;
    (restored ?? backdrop).focus();
  }
}

const LOGOUT_ICON = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M12 3.5v8.5" />
    <path d="M6.9 6.9a7.2 7.2 0 1 0 10.2 0" />
  </svg>
`;

/** Ein Schlüssel je Modal, nur für den Vergleich in der Scroll-Rettung. */
function describeModal(modal: ModalKind | null): string {
  if (modal === null) return '';
  if (typeof modal === 'string') return modal;
  return `${modal.kind}:${modal.playerId}`;
}

/** Liganame im Kopf, immer als Einstieg in die Ligaauswahl. */
function renderLeagueLabel(leagueName: string): string {
  return `
    <button type="button" class="league-link" data-modal="league">
      ${escapeHtml(leagueName)}<span class="league-caret" aria-hidden="true">▾</span>
    </button>
  `;
}


function renderLeagueChoice(leagues: League[], currentId: LeagueId): string {
  const items = leagues
    .map((league) => {
      const isCurrent = league.id === currentId;
      // Die offene Liga schließt nur, statt dieselbe Liga neu zu laden.
      const attrs = isCurrent
        ? ' class="is-current" aria-current="true" data-dialog-close'
        : ` data-league-id="${escapeHtml(league.id)}"`;
      const tag = isCurrent ? '<span class="league-current-tag">geöffnet</span>' : '';
      return `
        <li>
          <button type="button"${attrs}>
            <strong>${escapeHtml(league.name)}</strong>
            ${tag}
          </button>
        </li>
      `;
    })
    .join('');

  // Die Ligaliste stammt aus der Anmeldung und wird danach nicht mehr
  // aktualisiert. Bei genau einer Liga ist das die häufigste Rückfrage.
  const hint =
    leagues.length < 2
      ? `<p class="league-note">Nur diese eine Liga im Account. Eine neu beigetretene
         Liga erscheint hier nach der nächsten Anmeldung.</p>`
      : '';

  return `<ul class="league-choice">${items}</ul>${hint}`;
}

/**
 * Fusszeile unter den Tabellen: Legende zur Score-Spalte, Hinweise, Links und
 * der Build-Stempel. Aufbau bleibt in jedem Zustand gleich, nur der Chip
 * wechselt.
 *
 * Die Hilfe steht hier und nicht mehr oben: die Kopfzeile trägt Aktionen, und
 * erklärt wird die Spalte da, wo die Legende schon steht.
 */
function renderFootline(scores: ScoreResult | null, isScoring: boolean): string {
  // Gruppen statt loser Teile. Schmal steht jede in einer eigenen Zeile, ab
  // Tablet laufen sie wieder nebeneinander. Ein einzelner Fließtext aus
  // Trennpunkten war auf dem Handy nicht mehr zu lesen.
  //
  // "(0 % = fällt aus)" gehört zur Legende und steht deshalb in derselben
  // Gruppe wie sie, nicht bei den Hinweisen: es erklärt den Score, nicht die
  // Einheit der Beträge.
  return `
    <p class="table-footline">
      <span class="footline-legend">
        <span class="legend-sample">Beste Elf nach Score</span>
        ${renderScoreStateChip(scores, isScoring)}
        <span>(0 % = fällt aus)</span>
      </span>
      <span class="amount-hint">Beträge in Mio. €</span>
      <span class="footline-build">${escapeHtml(buildLabel())}</span>
      <span class="footline-links">
        <button type="button" data-modal="score">Wie der Score entsteht</button>
        <span class="legend-sep" aria-hidden="true">·</span>
        <button type="button" data-modal="features">Alle Features im Überblick</button>
      </span>
      ${LEGAL_LINKS}
    </p>
  `;
}

/**
 * Pflichtangaben. Sie müssen von jeder Seite erreichbar sein, nicht nur von
 * der Anmeldung, und öffnen in einem neuen Tab: die Rückkehr würde sonst die
 * Anwendung neu laden und den Kader ein zweites Mal holen.
 *
 * Eigene, mittige Zeile ganz unten, in jeder Breite. Sie gehören nicht zur
 * Bedienung und stehen deshalb abgesetzt, wie auf der Anmeldeseite auch.
 */
const LEGAL_LINKS = `
  <span class="footline-legal">
    <a href="/legal-notice.html" target="_blank" rel="noopener">Impressum</a>
    <span class="legend-sep" aria-hidden="true">·</span>
    <a href="/privacy.html" target="_blank" rel="noopener">Datenschutz</a>
    <span class="legend-sep" aria-hidden="true">·</span>
    <a href="/terms.html" target="_blank" rel="noopener">Nutzungsbedingungen</a>
  </span>
`;

/**
 * Stand der Score-Berechnung als Chip. Grün wird er erst, wenn es die grün
 * markierten Zellen wirklich gibt: davor grau, ohne gültige Formation gelb.
 *
 * `budgetPlusOk` hängt als eigener Chip dran. Die Elf soll sich aus dem
 * Verkauf der übrigen Spieler tragen; geht das bei keiner der zehn
 * Formationen auf, zeigt der Optimizer trotzdem die beste. Ohne den Hinweis
 * sähe die grüne Markierung aus, als wäre die Bedingung erfüllt.
 */
function renderScoreStateChip(scores: ScoreResult | null, isScoring: boolean): string {
  if (isScoring) {
    return `<span class="formation-chip formation-chip--pending">wird berechnet…</span>`;
  }
  if (!scores) {
    return `<span class="formation-chip formation-chip--pending">nicht berechnet</span>`;
  }
  if (scores.formationFallback || !scores.formation) {
    return `<span class="formation-chip formation-chip--invalid">keine gültige Formation</span>`;
  }
  const budgetChip = scores.budgetPlusOk
    ? ''
    : `<span class="formation-chip formation-chip--invalid"
             title="Auch bei der besten Elf bleibt der Kontostand nach dem Verkauf aller übrigen Spieler negativ.">Budget reicht nicht</span>`;
  return `
    <span class="formation-chip">${escapeHtml(scores.formation)}</span>
    ${budgetChip}
  `;
}

/**
 * Zählt einsatzfähige Spieler (Score > 0) je Position und sammelt die
 * Namen der Ausfälle. Ohne Score-Ergebnis zählt niemand als einsatzfähig.
 */
function collectFormationHelp(
  view: PlanningView,
  scores: ScoreResult | null,
): FormationHelpInput {
  const available: Record<PositionLabel, number> = { TW: 0, ABW: 0, MF: 0, ANG: 0 };
  const unavailable: string[] = [];
  for (const row of view.rows) {
    const score = scores?.byPlayer[row.id]?.score ?? 0;
    if (score > 0) available[row.positionLabel]++;
    else unavailable.push(row.name);
  }
  return { available, unavailable };
}

function friendlyMessage(err: unknown): string {
  if (err instanceof KickbaseError) {
    if (err.status === 0) return 'Netzwerkfehler. Bitte erneut versuchen.';
    return `Ladefehler (${err.status}). Bitte erneut versuchen.`;
  }
  if (err instanceof Error) return err.message;
  return 'Unbekannter Fehler.';
}

function friendlyScoreMessage(err: unknown): string {
  if (err instanceof KickbaseError) {
    if (err.status === 0) return 'Score-Berechnung fehlgeschlagen (Netzwerkfehler). Bitte erneut versuchen.';
    return `Score-Berechnung fehlgeschlagen (${err.status}). Bitte erneut versuchen.`;
  }
  if (err instanceof Error) return `Score-Berechnung fehlgeschlagen: ${err.message}`;
  return 'Score-Berechnung fehlgeschlagen. Bitte erneut versuchen.';
}

function extractSquadFreshFields(squad: SquadPlayer[]): Record<PlayerId, SquadFreshFields> {
  const out: Record<PlayerId, SquadFreshFields> = {};
  for (const p of squad) {
    out[p.id] = {
      averagePoints: p.averagePoints,
      status: p.status,
      probability: p.probability,
      teamId: p.teamId,
    };
  }
  return out;
}
