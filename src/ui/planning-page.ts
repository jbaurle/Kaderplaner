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
import type {
  League,
  LeagueId,
  MarketOffer,
  MarketPlayer,
  PlayerId,
  SquadPlayer,
} from '../api/types.js';
import { computePlanning, type MarketListing, type PlanningView } from '../compute/planning.js';
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
import { loadOppLayout, saveOppLayout } from '../state/opponents.js';
import { loadOptimizerCache } from '../state/optimizer.js';
import { buildLabel } from './build-info.js';
import { escapeHtml } from './format.js';
import { LineupPage, type LineupPlayer } from './lineup-page.js';
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
}

export class PlanningPage {
  private readonly props: PlanningPageProps;
  private state: PageState;
  /** Hängt an der Tabelle und meldet jede Breitenänderung, siehe `watchWidth`. */
  private widthObserver: ResizeObserver | null = null;
  /**
   * Zählt die Score-Läufe. Ein neues Laden oder ein neuer Lauf zählt hoch,
   * damit die Antwort eines überholten Laufs nicht mehr in den State fällt.
   */
  private scoreRun = 0;

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
    };
  }

  start(): void {
    this.render();
    void this.fetch();
    // Drehen ändert die Breite, ohne dass neu gerendert wird.
    window.addEventListener('resize', () => this.fitAmounts());
    // Escape hängt am Dokument, nicht am Overlay: das Overlay hat beim Öffnen
    // keinen Fokus, die Taste käme dort erst nach einem Klick an. Ohne offenes
    // Overlay läuft `closeModal()` ins Leere.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeModal();
    });
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
   */
  private handleCopyFromS4(slot: ScenarioSlot): void {
    if (!this.state.squad) return;
    let next = clearSlot(this.state.scenarios, slot);
    for (const player of this.state.squad) {
      if (!player.isInLineup) {
        next = setFlag(next, player.id, slot, true);
      }
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
    this.wireModal();
    // Deklarativ statt in openModal und closeModal: so stimmt die Sperre auch
    // dann, wenn ein Laden oder ein Ligawechsel das Overlay nebenbei schliesst.
    document.body.classList.toggle('is-dialog-open', this.state.modal !== null);

    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
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
    }));
    const known = new Set(players.map((p) => p.id));
    const stored = loadLineup(this.props.leagueId, known);
    const initialIds = stored ?? players.filter((p) => p.isInLineup).map((p) => p.id);
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
    }).open();
  }

  private openModal(kind: ModalKind): void {
    this.state.modal = kind;
    this.render();
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
    const row = view.rows.find((r) => r.id === playerId);
    if (!row) return '';

    const scores = this.state.scores;
    const cache = loadOptimizerCache(this.props.leagueId);
    const weekly = cache?.weeklyDetails[playerId];

    const insight = computePlayerInsight({
      row,
      squad: view.rows,
      budget: view.budget,
      score: scores?.byPlayer[playerId] ?? null,
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
      score: scores?.byPlayer[playerId] ?? null,
      listing: row.listing,
      bestOffer: row.bestOffer,
      insight,
    });
  }

  private wireModal(): void {
    const backdrop = this.props.host.querySelector<HTMLElement>('[data-dialog-shade]');
    if (!backdrop) return;
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) this.closeModal();
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

    // Die offene Liga trägt keine Id, ein Klick darauf lädt also nichts neu.
    for (const el of backdrop.querySelectorAll<HTMLElement>('[data-league-id]')) {
      el.addEventListener('click', () => {
        const id = el.dataset['leagueId'];
        if (id) this.props.onSelectLeague(id);
      });
    }

    backdrop.focus();
  }
}

const LOGOUT_ICON = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M12 3.5v8.5" />
    <path d="M6.9 6.9a7.2 7.2 0 1 0 10.2 0" />
  </svg>
`;

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
      // Die offene Liga schliesst nur, statt dieselbe Liga neu zu laden.
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
        <button type="button" data-modal="score">Was ist der Score?</button>
        <span class="legend-sep" aria-hidden="true">·</span>
        <button type="button" data-modal="features">Was kann die App?</button>
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
    <a href="/impressum.html" target="_blank" rel="noopener">Impressum</a>
    <span class="legend-sep" aria-hidden="true">·</span>
    <a href="/datenschutz.html" target="_blank" rel="noopener">Datenschutz</a>
    <span class="legend-sep" aria-hidden="true">·</span>
    <a href="/nutzungsbedingungen.html" target="_blank" rel="noopener">Nutzungsbedingungen</a>
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
    if (err.status === 0) return 'Netzwerkfehler — bitte erneut versuchen.';
    return `Ladefehler (${err.status}) — bitte erneut versuchen.`;
  }
  if (err instanceof Error) return err.message;
  return 'Unbekannter Fehler.';
}

function friendlyScoreMessage(err: unknown): string {
  if (err instanceof KickbaseError) {
    if (err.status === 0) return 'Score-Berechnung fehlgeschlagen (Netzwerkfehler) — bitte erneut versuchen.';
    return `Score-Berechnung fehlgeschlagen (${err.status}) — bitte erneut versuchen.`;
  }
  if (err instanceof Error) return `Score-Berechnung fehlgeschlagen: ${err.message}`;
  return 'Score-Berechnung fehlgeschlagen — bitte erneut versuchen.';
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
