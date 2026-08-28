/**
 * Aufstellungsseite: die Elf entsteht hier, nicht in der Tabelle.
 *
 * Zuschnitt "Elf zuerst, Formation folgt": es wird keine Formation vorgewählt.
 * Wer aufgestellt wird, landet in der Reihe seiner Position, und die Formation
 * ergibt sich aus den Zahlen. Gesperrt wird erst, wenn von diesem Stand aus
 * keine der zehn gültigen Formationen mehr erreichbar ist, siehe
 * `compute/lineup.ts`.
 *
 * Der Zuschnitt folgt der Kickbase-App: Rasen mit Linien, Spieler frei auf dem
 * Grün, freier Platz als Plus, darunter Positionsreiter mit Kartenband.
 *
 * Zwei Wege, einen Spieler zu bewegen:
 *   - Tippen: schiebt zwischen Bank und Elf hin und her.
 *   - Ziehen: Feldspieler am ganzen Token, Bankspieler nur am Bild. Das Band
 *     scrollt quer, und eine ganze Karte mit `touch-action: none` ließe sich
 *     nicht mehr wegwischen.
 *
 * Die Seite hängt an `document.body`, nicht am Host des Kaderplaners. Der
 * Kaderplaner baut seinen Host bei jedem Rendern neu auf und würde diese
 * Ebene sonst mitsamt laufender Zieh-Geste wegwerfen.
 *
 * Der Entwurf bleibt im Browser, bis jemand "Aufstellen" drückt. Erst dann
 * geht er als Formation plus Id-Liste an Kickbase, siehe `submit`.
 */

import { ERROR_CODES, KickbaseError } from '../api/kickbase.js';
import type { PlayerId } from '../api/types.js';
import type { PositionLabel } from '../compute/optimizer.js';
import {
  canPlace,
  countPositions,
  detectFormation,
  explainBlock,
  isReachable,
  lineupIssues,
  totalPlayers,
  type PositionCounts,
} from '../compute/lineup.js';
import { formationIssueChips } from './chips.js';
import {
  escapeHtml,
  formatMio,
  playerImageUrl,
  playerPhotoUrl,
  teamLogoUrl,
} from './format.js';

export interface LineupPlayer {
  id: PlayerId;
  name: string;
  positionLabel: PositionLabel;
  marketValue: number;
  teamId: string;
  /** Verfügbarkeit laut Kickbase, 0 heißt fit. */
  status: number;
  /** S11-Prognose 1 bis 5, 0 heißt keine Angabe. */
  probability: number;
  /** Bildpfad relativ zum CDN, leer wenn Kickbase keins führt. */
  imagePath: string;
  /** Aufstellung laut Kickbase, Grundlage für "aktuelle Elf". */
  isInLineup: boolean;
}

export interface LineupPageProps {
  players: readonly LineupPlayer[];
  budget: number;
  /** Score je Spieler, `null` solange nichts gerechnet wurde. */
  scores: Record<PlayerId, { score: number }> | null;
  /** Beste Elf des Optimizers, `null` ohne Score-Lauf. */
  bestEleven: readonly PlayerId[] | null;
  initialIds: readonly PlayerId[];
  onChange: (ids: PlayerId[]) => void;
  /**
   * Die Elf an Kickbase schicken. Wirft der Aufruf, zeigt die Seite die
   * Meldung unter der Bank an, der Entwurf bleibt stehen.
   */
  onSubmit: (formation: string, ids: PlayerId[]) => Promise<void>;
  onClose: () => void;
  /**
   * Kickbase hat das Token beim Senden verworfen. Das Blatt schließt sich
   * vorher selbst; der Aufrufer führt zurück zur Anmeldung.
   */
  onUnauthorized: () => void;
}

/** Zeile unter der Bank: Sperrgrund beim Aufstellen oder Ergebnis des Sendens. */
interface Note {
  text: string;
  tone: 'hint' | 'ok' | 'error';
}

/** Von oben nach unten, wie auf dem Platz. */
const ROWS: readonly PositionLabel[] = ['ANG', 'MF', 'ABW', 'TW'];

/** Reiter der Bank, von hinten nach vorne wie im Kader üblich. */
const TABS: readonly PositionLabel[] = ['TW', 'ABW', 'MF', 'ANG'];

const POSITION_NAME: Record<PositionLabel, string> = {
  TW: 'Torwart',
  ABW: 'Abwehr',
  MF: 'Mittelfeld',
  ANG: 'Angriff',
};

/**
 * Spielfeldlinien in echten Massen, auf ein gestauchtes Feld gezeichnet.
 *
 * Die Zeichenfläche ist 680 auf 850 Einheiten, das Verhältnis 4:5 des
 * Rasens. Die Linien selbst behalten ihre echten Masse in Zehntelmetern:
 * Strafraum 403 auf 165, Torraum 183 auf 55, Kreise mit Radius 91,5,
 * Elfmeterpunkt 110 vor der Linie, Eckbogen 20.
 *
 * Ein maßstäblicher Platz wäre 680 auf 1050. Gestaucht wirkt er wie in der
 * Kickbase-App: die Räume nehmen mehr Höhe ein, der Mittelkreis bleibt rund,
 * und die Elf steht auf dem Rasen statt in einem halb leeren Schlauch.
 *
 * Der Strafraumbogen ist nur der Teil des Elfmeterkreises ausserhalb des
 * Raums, deshalb ein Bogen zwischen den Schnittpunkten mit der Strafraumlinie
 * (± 73,1 Einheiten neben der Mitte) statt eines ganzen Kreises.
 */
const PITCH_LINES = `
  <svg class="pitch-lines" viewBox="0 0 680 850" aria-hidden="true">
    <g fill="none" stroke="rgba(255,255,255,.4)" stroke-width="3">
      <rect x="6" y="6" width="668" height="838" rx="6" />
      <line x1="6" y1="425" x2="674" y2="425" />
      <circle cx="340" cy="425" r="91.5" />

      <rect x="138.4" y="6" width="403.2" height="165" />
      <rect x="248.4" y="6" width="183.2" height="55" />
      <path d="M 266.9 171 A 91.5 91.5 0 0 0 413.1 171" />

      <rect x="138.4" y="679" width="403.2" height="165" />
      <rect x="248.4" y="789" width="183.2" height="55" />
      <path d="M 266.9 679 A 91.5 91.5 0 0 1 413.1 679" />

      <path d="M 6 26 A 20 20 0 0 0 26 6" />
      <path d="M 654 6 A 20 20 0 0 0 674 26" />
      <path d="M 6 824 A 20 20 0 0 1 26 844" />
      <path d="M 674 824 A 20 20 0 0 0 654 844" />
    </g>
    <g fill="rgba(255,255,255,.4)">
      <circle cx="340" cy="425" r="6" />
      <circle cx="340" cy="116" r="6" />
      <circle cx="340" cy="734" r="6" />
    </g>
  </svg>
`;

const STAR_ICON =
  '<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">' +
  '<path d="M6 0.6 7.3 4.7 11.4 6 7.3 7.3 6 11.4 4.7 7.3 0.6 6 4.7 4.7Z" /></svg>';

const CHECK_ICON =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M2.5 6.4 4.8 8.7 9.5 3.6" /></svg>';

const CROSS_ICON =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" aria-hidden="true"><path d="M3 3 9 9 M9 3 3 9" /></svg>';

/**
 * S11-Prognose von Kickbase, `prob` 1 bis 5. Die Bedeutung steht in der App
 * unter "Regeln & Icons": sicher, erwartet, unsicher, unwahrscheinlich,
 * ausgeschlossen. 0 heißt "keine Angabe" und zeigt nichts.
 */
const S11_LEVELS: Record<number, { cls: string; title: string; glyph: string }> = {
  1: { cls: 's11--sure', title: 'S11: sicher', glyph: STAR_ICON },
  2: { cls: 's11--likely', title: 'S11: erwartet', glyph: CHECK_ICON },
  3: { cls: 's11--unsure', title: 'S11: unsicher', glyph: '?' },
  4: { cls: 's11--unlikely', title: 'S11: unwahrscheinlich', glyph: '!' },
  5: { cls: 's11--out', title: 'S11: ausgeschlossen', glyph: CROSS_ICON },
};

/**
 * Ein Punkt für jeden, der nicht fit ist, ohne Deutung.
 *
 * Kickbase unterscheidet zehn Zustände, verletzt, angeschlagen, gesperrt und
 * so weiter. Der Squad-Response liefert dafür nur die Zahl `st`, und belegt
 * sind daraus bisher nur 0 und 2. Ein Kreuz oder eine Karte zu zeigen hieße
 * raten; der Punkt sagt genau so viel, wie wir wissen.
 */
const STATUS_TITLE = 'Nicht voll einsatzbereit';

/** Ab hier ist es kein Tippen mehr, sondern ein Ziehen. */
const DRAG_THRESHOLD_PX = 8;

/** So weit quer, und die Geste auf der Bank ist ein Blättern. */
const BENCH_PAN_PX = 12;

/**
 * `index` ist der Platz in der Reihe, nicht in der Elf: der dritte Verteidiger
 * von links steht auf 2, egal wie viele Spieler sonst noch aufgestellt sind.
 */
type DropAction =
  | { kind: 'add'; index: number }
  | { kind: 'move'; index: number }
  | { kind: 'remove' }
  | { kind: 'swap'; withId: PlayerId };

interface DragState {
  id: PlayerId;
  pos: PositionLabel;
  from: 'pitch' | 'bench';
  /** Das Element unter dem Finger, es fängt den Zeiger beim Start ein. */
  handle: HTMLElement;
  /** Finger oder Stift. Nur dort gibt es ein Blättern, das im Weg steht. */
  touch: boolean;
  /** Gesetzt, sobald die Geste als Blättern erkannt ist. */
  pan: { strip: HTMLElement; startLeft: number } | null;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  ghost: HTMLElement | null;
  /**
   * Versatz vom Zeiger zur Mitte des Ghosts, gemessen beim Aufnehmen. Ohne
   * ihn spränge der Kreis im Moment des Ausbrechens unter den Zeiger.
   */
  offset: { x: number; y: number };
  /** Der Platzhalter in der Reihe, solange der Zug dort landen würde. */
  gap: HTMLElement | null;
  drop: DropAction | null;
}

export class LineupPage {
  private readonly props: LineupPageProps;
  private readonly layer: HTMLElement;
  private readonly byId: Map<PlayerId, LineupPlayer>;
  /**
   * Die Elf als Liste, nicht als Menge: die Reihenfolge ist die Anordnung in
   * der Reihe. Für Kickbase und den Score bedeutet sie nichts, für das
   * Ziehen alles. Ohne sie spränge der Spieler nach dem Loslassen an eine
   * andere Stelle als die, an der die Lücke stand.
   */
  private order: PlayerId[];
  private note: Note | null = null;
  /** Läuft, solange der POST unterwegs ist. Solange bleibt der Knopf gesperrt. */
  private sending = false;
  /**
   * Was zuletzt an Kickbase ging. Stimmt der Entwurf damit überein, gibt es
   * nichts zu senden: derselbe Aufruf zweimal ändert nichts und sieht nur
   * aus wie ein zweiter Zug.
   */
  private sentIds: string | null = null;
  /** Schliesst das Blatt nach dem Senden. Ein Handschluss davor bricht ihn ab. */
  private closeTimer: number | null = null;
  private drag: DragState | null = null;
  /** Nach einem Ziehen kommt noch ein Klick hinterher, der ins Leere soll. */
  private suppressClick = false;
  /** Läuft, solange der Finger das Band am Rand weiterschiebt. */
  private benchScroll: number | null = null;
  private benchSpeed = 0;

  constructor(props: LineupPageProps) {
    this.props = props;
    this.byId = new Map(props.players.map((p) => [p.id, p]));
    this.order = dedupe(props.initialIds.filter((id) => this.byId.has(id)));
    this.layer = document.createElement('div');
    this.layer.className = 'lineup-layer';
    this.layer.tabIndex = -1;
  }

  open(): void {
    document.body.appendChild(this.layer);
    document.body.classList.add('is-lineup-open');
    this.wire();
    this.render();
    this.layer.focus();
  }

  close(): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.cancelDrag();
    document.body.classList.remove('is-lineup-open');
    this.layer.remove();
    this.props.onClose();
  }

  // ---------- Zustand ----------

  private counts(): PositionCounts {
    const positions: PositionLabel[] = [];
    for (const id of this.order) {
      const player = this.byId.get(id);
      if (player) positions.push(player.positionLabel);
    }
    return countPositions(positions);
  }

  private has(id: PlayerId): boolean {
    return this.order.includes(id);
  }

  /** Die Spieler einer Reihe, in ihrer Anordnung von links nach rechts. */
  private rowPlayers(row: PositionLabel): LineupPlayer[] {
    const players: LineupPlayer[] = [];
    for (const id of this.order) {
      const player = this.byId.get(id);
      if (player && player.positionLabel === row) players.push(player);
    }
    return players;
  }

  /**
   * Wo in der ganzen Liste steht der `index`-te Platz dieser Reihe? Die Liste
   * mischt alle Reihen, ein Platz in der Abwehr ist darin also nicht einfach
   * die Zahl selbst.
   */
  private listIndex(row: PositionLabel, index: number): number {
    let seen = 0;
    for (let i = 0; i < this.order.length; i++) {
      const id = this.order[i];
      if (!id || this.byId.get(id)?.positionLabel !== row) continue;
      if (seen === index) return i;
      seen++;
    }
    return this.order.length;
  }

  private commit(): void {
    this.props.onChange([...this.order]);
    this.render();
  }

  /**
   * Das Band an die Gruppe dieser Position schieben. Ersetzt den früheren
   * Reiter: gezeigt wird weiterhin alles, nur der Ausschnitt wandert.
   */
  private scrollToGroup(pos: PositionLabel): void {
    const group = this.layer.querySelector<HTMLElement>(`[data-group="${pos}"]`);
    group?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }

  private toggle(id: PlayerId): void {
    const player = this.byId.get(id);
    if (!player) return;
    if (this.has(id)) {
      this.drop(id);
      this.note = null;
      this.commit();
      // Wer vom Feld geht, landet auf der Bank. Ohne den Schwenk wäre er
      // scheinbar verschwunden, wenn seine Gruppe gerade nicht im Bild ist.
      this.scrollToGroup(player.positionLabel);
      return;
    }
    if (canPlace(this.counts(), player.positionLabel)) {
      this.order.push(id);
      this.note = null;
    } else {
      this.note = { text: explainBlock(this.counts(), player.positionLabel), tone: 'hint' };
    }
    this.commit();
  }

  /** Vom Feld nehmen. Gibt den freigewordenen Platz in der Liste zurück. */
  private drop(id: PlayerId): number {
    const at = this.order.indexOf(id);
    if (at >= 0) this.order.splice(at, 1);
    return at;
  }

  private apply(action: DropAction, dragged: PlayerId): void {
    const player = this.byId.get(dragged);
    if (action.kind === 'add' && player) {
      this.order.splice(this.listIndex(player.positionLabel, action.index), 0, dragged);
    } else if (action.kind === 'move' && player) {
      this.drop(dragged);
      this.order.splice(this.listIndex(player.positionLabel, action.index), 0, dragged);
    } else if (action.kind === 'remove') {
      this.drop(dragged);
    } else if (action.kind === 'swap') {
      // Tausch: der eine geht raus, der andere kommt auf seinen Platz. Die
      // Zählung bleibt gleich, deshalb ist ein Tausch immer erlaubt.
      const leaving = this.has(dragged) ? dragged : action.withId;
      const arriving = leaving === dragged ? action.withId : dragged;
      const at = this.drop(leaving);
      this.order.splice(at < 0 ? this.order.length : at, 0, arriving);
    }
    this.note = null;
    this.commit();
  }

  // ---------- Ereignisse ----------

  private wire(): void {
    this.layer.addEventListener('click', (event) => this.handleClick(event));
    this.layer.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
    this.layer.addEventListener('pointermove', (event) => this.handlePointerMove(event));
    this.layer.addEventListener('pointerup', (event) => this.handlePointerUp(event));
    this.layer.addEventListener('pointercancel', () => this.cancelDrag());
    this.layer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
    // Fehlende Freisteller antwortet das CDN mit 403. `error` steigt nicht
    // auf, deshalb in der Erfassungsphase mithören und aufs Wappen wechseln.
    this.layer.addEventListener(
      'error',
      (event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement)) return;
        const fallback = img.dataset['fallback'];
        if (!fallback) return;
        delete img.dataset['fallback'];
        img.src = fallback;
        img.classList.add('is-logo');
      },
      true,
    );
  }

  private handleClick(event: MouseEvent): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target) return;

    // Klick neben das Blatt schließt, wie bei den Dialogen in planning-page.
    if (target === this.layer) {
      this.close();
      return;
    }

    if (target.closest('[data-close]')) {
      this.close();
      return;
    }

    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (actionEl) {
      this.runAction(actionEl.dataset['action'] ?? '');
      return;
    }

    // Der freie Platz ist kein Ziel, sondern ein Wegweiser: er schiebt das
    // Band an die Gruppe, aus der hier jemand fehlt.
    const plusEl = target.closest<HTMLElement>('[data-goto]');
    if (plusEl) {
      const pos = plusEl.dataset['goto'] as PositionLabel | undefined;
      if (pos) this.scrollToGroup(pos);
      return;
    }

    const token = target.closest<HTMLElement>('[data-player-id]');
    const id = token?.dataset['playerId'];
    if (id) this.toggle(id);
  }

  private runAction(action: string): void {
    if (action === 'submit') {
      void this.submit();
      return;
    }
    if (action === 'best') {
      const best = this.props.bestEleven;
      if (!best) return;
      this.order = dedupe(best.filter((id) => this.byId.has(id)));
    } else if (action === 'current') {
      this.order = this.props.players.filter((p) => p.isInLineup).map((p) => p.id);
    } else if (action === 'clear') {
      this.order = [];
    } else {
      return;
    }
    this.note = null;
    this.commit();
  }

  /**
   * Die Elf an Kickbase schicken. Nur möglich, wenn `detectFormation` eine
   * Formation liefert: die Prüfung deckt Torwart, Anzahl und Zählung in
   * einem ab, ein zweiter Test wäre nur eine zweite Wahrheit.
   */
  private async submit(): Promise<void> {
    const formation = detectFormation(this.counts());
    if (!formation || this.sending) return;

    if (this.isAtKickbase()) return;

    const ids = this.submitOrder();
    this.sending = true;
    this.note = null;
    this.render();
    try {
      await this.props.onSubmit(formation, ids);
      this.sentIds = idKey(ids);
      this.note = { text: `Aufstellung ${formation} an Kickbase gesendet.`, tone: 'ok' };
      // Kurz stehen lassen, damit die Zeile gelesen werden kann, dann zu. Das
      // Blatt kennt den Kader von vor dem Senden; wer es offen lässt, sähe
      // bei "Aktuelle Elf" weiter den alten Stand.
      this.closeTimer = window.setTimeout(() => this.close(), 1100);
    } catch (error) {
      // Abgelaufene Sitzung: Blatt zu und zurück zur Anmeldung, wie in allen
      // anderen API-Pfaden. Die Fehlerzeile hülfe hier nicht, jeder weitere
      // Versuch scheiterte gleich.
      if (error instanceof KickbaseError && error.isUnauthorized) {
        this.close();
        this.props.onUnauthorized();
      } else {
        this.note = { text: `Senden fehlgeschlagen: ${errorText(error)}`, tone: 'error' };
      }
    } finally {
      this.sending = false;
      this.render();
    }
  }

  /**
   * Beschriftung des Balkens. Sie trägt den Zustand: was gesendet würde,
   * oder woran es noch fehlt. Die Chips am Feld nennen jede Lücke einzeln,
   * hier steht nur die erste, sonst wird der Knopf zum Absatz.
   */
  private submitLabel(
    formation: string | null,
    counts: PositionCounts,
    total: number,
    sent: boolean,
  ): string {
    if (this.sending) return 'Sende…';
    if (sent && formation) return 'Bereits aufgestellt';
    if (formation) return `Aufstellen · ${formation}`;
    if (total < 11) {
      const missing = 11 - total;
      return missing === 1 ? 'Noch ein Spieler' : `Noch ${missing} Spieler`;
    }
    if (counts.TW !== 1) return counts.TW === 0 ? 'Kein Torwart in der Elf' : 'Zwei Torhüter in der Elf';
    return `${counts.ABW}-${counts.MF}-${counts.ANG} gibt es nicht`;
  }

  /**
   * Die Elf für Kickbase: Torwart, Abwehr, Mittelfeld, Angriff. Feldpositionen
   * nimmt der Endpoint nicht, nur die Liste. Innerhalb einer Reihe bleibt die
   * Anordnung vom Platz stehen.
   */
  private submitOrder(): PlayerId[] {
    return TABS.flatMap((row) => this.rowPlayers(row).map((p) => p.id));
  }

  /**
   * Steht dieser Entwurf schon bei Kickbase? Zwei Quellen: was diese Sitzung
   * gesendet hat, und was der Kader beim Öffnen gemeldet hat. Die zweite
   * deckt den Fall ab, dass jemand das Blatt nach dem Senden neu aufmacht,
   * die erste den, dass er es offen lässt. Die Anordnung auf dem Platz
   * zählt dabei nicht, Kickbase bekommt nur die Namen.
   */
  private isAtKickbase(): boolean {
    const draft = idKey(this.order);
    if (draft === '') return false;
    if (this.sentIds === draft) return true;
    const live = idKey(this.props.players.filter((p) => p.isInLineup).map((p) => p.id));
    return live === draft;
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // Ein neuer Handschluss beginnt: der Klick, den das letzte Ziehen
    // angekündigt hat, ist nie gekommen. Ohne das Zurücksetzen frisst die
    // Sperre den nächsten echten Klick, etwa den auf "Aufstellen".
    this.suppressClick = false;
    const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-drag-id]');
    if (!handle) return;
    const id = handle.dataset['dragId'];
    const from = handle.dataset['dragFrom'];
    const player = id ? this.byId.get(id) : undefined;
    if (!id || !player || (from !== 'pitch' && from !== 'bench')) return;

    this.drag = {
      id,
      pos: player.positionLabel,
      from,
      handle,
      // Der Zeiger wird erst beim Start eingefangen. Bis dahin ist offen, ob
      // das ein Zug wird oder ein Blättern, und das Blättern gehört dem
      // Browser.
      pointerId: event.pointerId,
      touch: event.pointerType !== 'mouse',
      pan: null,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      ghost: null,
      offset: { x: 0, y: 0 },
      gap: null,
      drop: null,
    };
  }

  /**
   * Wird aus dem Druck ein Zug?
   *
   * Auf dem Feld reicht die Strecke, dort gibt es nichts zu blättern. Auf der
   * Bank zählt bei Finger und Stift die Richtung: nach oben heißt
   * aufstellen, quer heißt blättern. Dazwischen passiert nichts, der Finger
   * darf sich noch entscheiden. Die Maus hat kein Wischen, sie zieht weiter in
   * jede Richtung.
   */
  private decideGesture(drag: DragState, event: PointerEvent): boolean {
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (drag.from === 'pitch' || !drag.touch) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return false;
      this.startDrag(drag);
      return true;
    }

    if (dy <= -DRAG_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx)) {
      this.startDrag(drag);
      return true;
    }
    if (Math.abs(dx) > BENCH_PAN_PX) {
      const strip = drag.handle.closest<HTMLElement>('.bench-strip');
      if (strip) {
        drag.pan = { strip, startLeft: strip.scrollLeft };
        capture(drag);
      } else {
        this.drag = null;
      }
    }
    return false;
  }

  private handlePointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    // Blättern in eigener Hand: die Kachel gibt die Geste nicht mehr an den
    // Browser ab, sonst bräche er den Zug nach oben ab.
    if (drag.pan) {
      drag.pan.strip.scrollLeft = drag.pan.startLeft - (event.clientX - drag.startX);
      event.preventDefault();
      return;
    }
    if (!drag.active && !this.decideGesture(drag, event)) return;

    event.preventDefault();
    if (drag.ghost) {
      const x = event.clientX + drag.offset.x;
      const y = event.clientY + drag.offset.y;
      drag.ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
    this.updateDropTarget(drag, event.clientX, event.clientY);
  }

  private handlePointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const action = drag.active ? drag.drop : null;
    const wasActive = drag.active;
    // Nach dem Blättern kommt ein Klick hinterher, der den Spieler sonst
    // aufs Feld stellt.
    const panned = drag.pan !== null;
    const draggedId = drag.id;
    // Der Körper, nicht die Hülle: das Anheben sitzt innen, und der Flug soll
    // dort beginnen, wo der Kreis zuletzt zu sehen war.
    const from = drag.ghost?.querySelector('.lineup-ghost-body')?.getBoundingClientRect() ?? null;
    this.cancelDrag();
    if (!wasActive) {
      if (panned) this.suppressClick = true;
      return;
    }
    // Der Klick nach dem Ziehen würde den Spieler ein zweites Mal bewegen.
    this.suppressClick = true;
    if (!action) return;
    this.apply(action, draggedId);
    if (from) this.flyIn(draggedId, from);
  }

  /**
   * Der Kreis erscheint nicht am Ziel, er fliegt hin: vom letzten Platz unter
   * dem Finger auf seinen Platz in der Reihe. Ohne den Flug ist nach dem
   * Loslassen unklar, welcher der elf Kreise gerade der eigene war.
   */
  private flyIn(id: PlayerId, from: DOMRect): void {
    const el = this.elementOf(id);
    const anchor = el?.querySelector<HTMLElement>('.tok-img, .card-img');
    if (!el || !anchor) return;
    const to = anchor.getBoundingClientRect();
    if (to.width === 0) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})` },
        { transform: 'none' },
      ],
      { duration: 160, easing: 'ease-out' },
    );
  }

  /**
   * So breit, wie die Spieler auf dem Rasen stehen. Am liebsten gemessen; ist
   * das Feld leer, gerechnet: die Kreise sind 12,5 % der Feldbreite, so steht
   * es in `lineup.css`. Auch ein Zug von der Bank bekommt dieses Mass, denn
   * dort will er hin.
   */
  private tokenSize(): number {
    for (const img of this.layer.querySelectorAll<HTMLElement>('.pitch .tok-img')) {
      const width = img.getBoundingClientRect().width;
      if (width > 0) return width;
    }
    const pitch = this.layer.querySelector<HTMLElement>('.pitch');
    if (!pitch) return 0;
    const style = getComputedStyle(pitch);
    const inner =
      pitch.getBoundingClientRect().width -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight);
    return inner * 0.125;
  }

  private elementOf(id: PlayerId): HTMLElement | null {
    for (const el of this.layer.querySelectorAll<HTMLElement>('[data-player-id]')) {
      if (el.dataset['playerId'] === id) return el;
    }
    return null;
  }

  private startDrag(drag: DragState): void {
    drag.active = true;
    this.layer.classList.add('is-dragging');
    capture(drag);

    const source = this.elementOf(drag.id);
    // Vor dem Ausheben messen: gleich ist der Platz zu und der Kreis fort.
    const size = this.tokenSize();
    drag.offset = grabOffset(source, drag.startX, drag.startY, size);

    // Der gezogene Kreis hängt am Finger, sein Platz in der Reihe schließt
    // sich. Was bleibt, ist die Lücke, und die wandert gleich mit.
    if (drag.from === 'pitch') {
      const row = source?.closest<HTMLElement>('[data-row]');
      if (source && row) flipRow(row, () => source.classList.add('is-lifted'));
    }

    const ghost = document.createElement('div');
    ghost.className = 'lineup-ghost';
    // Zwei Ebenen: außen die Lage am Zeiger, innen das Anheben. Das Anheben
    // ist eine Animation und liefe sonst gegen die Lage, die jede Bewegung
    // neu setzt.
    const body = document.createElement('div');
    body.className = 'lineup-ghost-body';
    body.innerHTML = this.renderTokenImage(drag.id);
    ghost.appendChild(body);
    // Die Breite kommt in Pixeln mit: der Ghost hängt an der Ebene, nicht am
    // Feld, und `cqw` wäre dort Prozent des Fensters statt des Rasens.
    if (size > 0) ghost.style.width = `${size}px`;
    // Am Finger liegt der Kreis nicht unter der Kuppe, sondern darüber: die
    // Hand verdeckt sonst genau das, was sie zieht. Die Maus braucht das
    // nicht, der Pfeil deckt nichts zu.
    if (drag.touch) {
      ghost.classList.add('is-touch');
      ghost.style.setProperty('--ghost-lift', `${Math.round(size * 0.5 + 16)}px`);
    }
    this.layer.appendChild(ghost);
    drag.ghost = ghost;
    this.markTargets(drag);
  }

  private updateDropTarget(drag: DragState, x: number, y: number): void {
    for (const el of this.layer.querySelectorAll('.is-over')) el.classList.remove('is-over');
    drag.drop = this.resolveDrop(drag, x, y);
    this.showGap(drag);
    this.autoScroll(x, y);
    if (!drag.drop) return;

    // Beim Einreihen sagt die Lücke, was passiert. Hervorgehoben wird nur,
    // was ausserhalb der Reihe liegt: die Bank und der Tauschpartner. Der
    // Tauschpartner über seine Id, nicht über den Punkt unter dem Finger:
    // den Tausch kann auch der Ghost gefunden haben, siehe `swapUnderGhost`.
    if (drag.drop.kind === 'remove') {
      this.layer.querySelector<HTMLElement>('[data-bench]')?.classList.add('is-over');
    } else if (drag.drop.kind === 'swap') {
      this.elementOf(drag.drop.withId)?.classList.add('is-over');
    }
  }

  /**
   * Zieht der Finger an den Rand des Bandes, schiebt es nach. Ohne das endet
   * jeder Zug an der Kante, und wer den Stürmer ganz hinten sucht, müsste
   * erst loslassen, scrollen und neu ansetzen.
   */
  private autoScroll(x: number, y: number): void {
    const strip = this.layer.querySelector<HTMLElement>('.bench-strip');
    if (!strip) return this.stopAutoScroll();
    const rect = strip.getBoundingClientRect();
    const edge = Math.min(64, rect.width / 4);
    const inside = y >= rect.top - 20 && y <= rect.bottom + 20;
    let speed = 0;
    if (inside && x < rect.left + edge) speed = -Math.ceil((rect.left + edge - x) / 5);
    else if (inside && x > rect.right - edge) speed = Math.ceil((x - rect.right + edge) / 5);
    // Die Geschwindigkeit steht im Feld, nicht in der Schleife: sonst liefe
    // das Band mit dem Tempo weiter, das beim ersten Rutschen galt.
    this.benchSpeed = speed;
    if (speed === 0) return this.stopAutoScroll();

    if (this.benchScroll !== null) return;
    const step = (): void => {
      strip.scrollLeft += this.benchSpeed;
      this.benchScroll = requestAnimationFrame(step);
    };
    this.benchScroll = requestAnimationFrame(step);
  }

  private stopAutoScroll(): void {
    if (this.benchScroll === null) return;
    cancelAnimationFrame(this.benchScroll);
    this.benchScroll = null;
  }

  /**
   * Die eigene Reihe hat Vorrang: hat sie Platz, wird eingereiht, und der
   * Finger sagt an welcher Stelle. Erst wenn sie voll ist, kommt der Tausch in
   * Frage, sonst gäbe es keinen Weg mehr, einen Vierten dazuzustellen, ohne
   * einen der drei zu treffen.
   */
  private resolveDrop(drag: DragState, x: number, y: number): DropAction | null {
    const under = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!under) return this.swapUnderGhost(drag);

    if (drag.from === 'pitch' && under.closest('[data-bench]')) return { kind: 'remove' };

    const row = under.closest<HTMLElement>('[data-row]');
    if (row && row.dataset['row'] === drag.pos) {
      if (drag.from === 'pitch') return { kind: 'move', index: slotIndex(row, x) };
      if (canPlace(this.counts(), drag.pos)) return { kind: 'add', index: slotIndex(row, x) };
    }

    const token = under.closest<HTMLElement>('[data-player-id]');
    const otherId = token?.dataset['playerId'];
    if (otherId && otherId !== drag.id && this.canSwap(drag, otherId)) {
      return { kind: 'swap', withId: otherId };
    }
    return this.swapUnderGhost(drag);
  }

  /**
   * Auf Touch schwebt der Ghost über dem Finger. Wer ihn über einen Spieler
   * schiebt, meint diesen, auch wenn der Finger selbst noch tiefer steht.
   * Liegt am Fingerpunkt also nichts, zählt die Überschneidung des
   * Ghost-Körpers: die größte gewinnt. Mit Hysterese: ein neues Ziel braucht
   * ein Viertel der kleineren Fläche, dem gehaltenen reicht ein Zehntel.
   * Ohne die Schwellen zuckte beim Vorbeiziehen jeder gestreifte Nachbar
   * auf, und am Rand kippte das Ziel mit jeder Bewegung.
   */
  private swapUnderGhost(drag: DragState): DropAction | null {
    const body = drag.ghost?.querySelector('.lineup-ghost-body');
    if (!body) return null;
    const ghost = body.getBoundingClientRect();
    // `drag.drop` trägt hier noch das Ziel der vorigen Bewegung.
    const held = drag.drop?.kind === 'swap' ? drag.drop.withId : null;
    let best: { id: PlayerId; area: number } | null = null;
    for (const el of this.layer.querySelectorAll<HTMLElement>('[data-player-id]')) {
      const id = el.dataset['playerId'];
      if (!id || id === drag.id) continue;
      const rect = el.getBoundingClientRect();
      const w = Math.min(ghost.right, rect.right) - Math.max(ghost.left, rect.left);
      const h = Math.min(ghost.bottom, rect.bottom) - Math.max(ghost.top, rect.top);
      if (w <= 0 || h <= 0) continue;
      const area = w * h;
      const smaller = Math.min(ghost.width * ghost.height, rect.width * rect.height);
      if (area < smaller * (id === held ? 0.1 : 0.25)) continue;
      if (best && area <= best.area) continue;
      if (this.canSwap(drag, id)) best = { id, area };
    }
    return best ? { kind: 'swap', withId: best.id } : null;
  }

  /**
   * Die Lücke dorthin schieben, wo der Spieler landen würde. Nur die eigene
   * Reihe bekommt eine: eine andere Position nimmt ihn ohnehin nicht.
   */
  private showGap(drag: DragState): void {
    const row = this.layer.querySelector<HTMLElement>(`[data-row="${drag.pos}"]`);
    if (!row) return;
    const drop = drag.drop;
    const index = drop && (drop.kind === 'add' || drop.kind === 'move') ? drop.index : null;

    if (index === null) {
      if (drag.gap?.parentElement) flipRow(row, () => drag.gap?.remove());
      return;
    }

    const tokens = row.querySelectorAll<HTMLElement>('.tok:not(.is-lifted)');
    const before = tokens[index] ?? null;
    const gap = (drag.gap ??= createGap());
    if (gap.parentElement === row && gap.nextElementSibling === before) return;
    flipRow(row, () => row.insertBefore(gap, before));
  }

  /**
   * Darf der gezogene Spieler diesen hier ersetzen?
   *
   * Immer nur Bank gegen Feld. Gleiche Position lässt die Zahlen unberührt,
   * eine andere ändert die Formation: dann muss der neue Stand erreichbar
   * bleiben. Ein Stürmer auf einen Mittelfeldspieler macht aus 4-3-3 ein
   * 4-2-4, auf einen Verteidiger gezogen wäre es 3-3-4 und fällt weg.
   */
  private canSwap(drag: DragState, otherId: PlayerId): boolean {
    const other = this.byId.get(otherId);
    if (!other) return false;
    const otherOnPitch = this.has(otherId);
    const draggedOnPitch = drag.from === 'pitch';
    if (otherOnPitch === draggedOnPitch) return false;
    return isReachable(this.countsAfterSwap(drag, other));
  }

  private countsAfterSwap(drag: DragState, other: LineupPlayer): PositionCounts {
    const draggedOnPitch = drag.from === 'pitch';
    const leaving = draggedOnPitch ? drag.pos : other.positionLabel;
    const arriving = draggedOnPitch ? other.positionLabel : drag.pos;
    const counts = this.counts();
    counts[leaving] -= 1;
    counts[arriving] += 1;
    return counts;
  }

  /**
   * Vor dem ersten Millimeter zeigen, wo der Spieler hin kann. Nur das: seine
   * Reihe, solange sie Platz hat, sonst die Spieler darin, die er ersetzt.
   *
   * Früher stand hier jeder Tausch, den `isReachable` noch zulässt, auch
   * über Positionsgrenzen. Bei einer halb fertigen Elf ist aber fast alles
   * noch erreichbar: dann war jedes Token markiert, nichts blass, und der
   * Hinweis sagte nichts mehr. Ein Tausch quer bleibt möglich, er leuchtet
   * nur erst auf, wenn der Finger darauf steht.
   */
  private markTargets(drag: DragState): void {
    const row = this.layer.querySelector<HTMLElement>(`[data-row="${drag.pos}"]`);
    if (drag.from === 'bench') {
      if (canPlace(this.counts(), drag.pos)) {
        row?.classList.add('is-target');
        return;
      }
      for (const tok of row?.querySelectorAll<HTMLElement>('.tok[data-player-id]') ?? []) {
        const id = tok.dataset['playerId'];
        if (id && this.canSwap(drag, id)) tok.classList.add('is-swappable');
      }
      return;
    }

    // Vom Feld aus nimmt ihn die eigene Reihe (umsortieren) und die Bank, dort
    // die Karten seiner Position: die stehen für "der spielt statt seiner".
    row?.classList.add('is-target');
    this.layer.querySelector<HTMLElement>('[data-bench]')?.classList.add('is-allowed');
    for (const card of this.layer.querySelectorAll<HTMLElement>('.bench-card[data-player-id]')) {
      const id = card.dataset['playerId'];
      if (id && this.byId.get(id)?.positionLabel === drag.pos) card.classList.add('is-swappable');
    }
  }

  private cancelDrag(): void {
    const drag = this.drag;
    this.drag = null;
    this.stopAutoScroll();
    if (!drag) return;
    drag.ghost?.remove();
    drag.gap?.remove();
    this.layer.classList.remove('is-dragging');
    for (const el of this.layer.querySelectorAll(
      '.is-over, .is-allowed, .is-target, .is-swappable, .is-lifted',
    )) {
      el.classList.remove('is-over', 'is-allowed', 'is-target', 'is-swappable', 'is-lifted');
    }
  }

  // ---------- Zeichnen ----------

  private render(): void {
    const counts = this.counts();
    const formation = detectFormation(counts);
    const issues = lineupIssues(counts);
    const total = totalPlayers(counts);

    const bench = this.props.players
      .filter((p) => !this.has(p.id))
      .sort((a, b) => this.byScore(a, b));
    const benchValue = bench.reduce((sum, p) => sum + p.marketValue, 0);
    const balance = this.props.budget + benchValue;

    // Grün nur, wenn die Elf wirklich steht. Zu wenige Spieler und eine
    // Zählung ohne Formation sind beides Gründe, es rot zu zeigen.
    const stateClass = formation ? 'is-ok' : 'is-bad';
    // Am Zeiger hängt zusätzlich die ganze Liste. Auf dem Handy gibt es
    // keinen Zeiger, deshalb steht der wichtigste Grund in der Beschriftung.
    const sent = formation !== null && this.isAtKickbase();
    const submitTitle = this.sending
      ? 'Wird gesendet…'
      : sent
        ? 'Diese Elf steht schon bei Kickbase.'
        : issues.join(', ');
    const submitBlock =
      formation && !this.sending && !sent ? '' : ` disabled title="${escapeHtml(submitTitle)}"`;
    // Die Ebene wird als Ganzes neu gebaut, das Band fängt damit wieder bei
    // den Torhütern an. Wer gerade bei der Abwehr war, soll dort bleiben.
    const benchScrollLeft = this.layer.querySelector<HTMLElement>('.bench-strip')?.scrollLeft ?? 0;

    this.layer.innerHTML = `
      <div class="lineup-sheet" role="dialog" aria-label="Aufstellung">
        <header class="lineup-head">
          <h2>Aufstellung</h2>
          <button type="button" class="dialog-close" data-close aria-label="Schließen">×</button>
          <div class="lineup-actions">
            <button type="button" class="lineup-link" data-action="current">Aktuelle Elf</button>
            <button type="button" class="lineup-link" data-action="best"
                    ${this.props.bestEleven ? '' : 'disabled title="Score wird noch berechnet"'}>Beste Elf nach Score</button>
            <button type="button" class="lineup-link lineup-link--clear" data-action="clear"
                    title="Elf leeren">Leeren</button>
          </div>
        </header>

        <div class="pitch">
          ${PITCH_LINES}
          <div class="pitch-status ${stateClass}">
            <div class="pitch-status-left">
              <span class="pitch-chip pitch-chip--count">${total}/11</span>
              ${formationIssueChips(issues.filter((issue) => !issue.endsWith('Spieler')))}
            </div>
            <div class="pitch-status-mid">
              ${formation ? `<span class="pitch-chip">${escapeHtml(formation)}</span>` : ''}
            </div>
            <div class="pitch-status-right">
              ${formation
                ? `<span class="pitch-chip">
                     Konto <span class="${balance < 0 ? 'is-neg' : 'is-pos'}">${formatMio(balance)}</span> Mio.
                   </span>`
                : ''}
            </div>
          </div>
          ${ROWS.map((row) => this.renderRow(row, counts)).join('')}
        </div>

        ${this.renderBench(bench)}
        ${renderNote(this.note, 'hint')}
        <button type="button" class="btn btn--go${sent ? ' is-sent' : ''}" data-action="submit"${submitBlock}>
          ${escapeHtml(this.submitLabel(formation, counts, total, sent))}
        </button>
        ${renderNote(this.note, 'send')}
      </div>
    `;

    const strip = this.layer.querySelector<HTMLElement>('.bench-strip');
    if (strip) strip.scrollLeft = benchScrollLeft;
  }

  private renderRow(row: PositionLabel, counts: PositionCounts): string {
    // Die Anordnung kommt aus der Liste, nicht aus dem Score: wer beim Ziehen
    // an dritter Stelle abgelegt wurde, steht dort auch nach dem Loslassen.
    const players = this.rowPlayers(row);
    const tokens = players.map((p) => this.renderToken(p)).join('');
    // Der freie Platz steht nur in leeren Reihen. In einer besetzten Reihe ist
    // er kein Hinweis mehr, sondern nur noch ein Kreis zwischen Gesichtern.
    const plus = players.length === 0 && canPlace(counts, row)
      ? `<button type="button" class="tok-plus" data-goto="${row}"
                 aria-label="${POSITION_NAME[row]} auf der Bank zeigen">
           <span class="plus-disc" aria-hidden="true">+</span>
           <span class="plus-label">${POSITION_NAME[row]}</span>
         </button>`
      : '';
    return `<div class="prow" data-row="${row}">${tokens}${plus}</div>`;
  }

  private renderToken(player: LineupPlayer): string {
    return `
      <button type="button" class="tok" data-player-id="${escapeHtml(player.id)}"
              data-drag-id="${escapeHtml(player.id)}" data-drag-from="pitch">
        ${this.renderTokenImage(player.id)}
        <span class="tok-name">${escapeHtml(player.name)}</span>
        <span class="tok-score">${this.scoreLabel(player.id)}</span>
      </button>
    `;
  }

  /**
   * Freisteller mit den beiden Abzeichen. Auf dem Feld ohne Wappen: der Verein
   * steht schon auf dem Trikot, und drei Marken auf einem Kreis von 50 px sind
   * eine zu viel. Statusicon unten links, S11-Prognose unten rechts.
   */
  private renderTokenImage(id: PlayerId): string {
    const player = this.byId.get(id);
    if (!player) return '<span class="tok-img"></span>';
    return `
      <span class="tok-img">
        <img class="tok-photo" src="${escapeHtml(photoSrc(player))}"
             data-fallback="${escapeHtml(teamLogoUrl(player.teamId))}"
             alt="" draggable="false" decoding="async">
        ${renderAlert(player)}
        ${renderS11(player, 'tok-s11')}
      </span>
    `;
  }

  /**
   * Bank als ein einziges Band, nach Position gruppiert. Kein Reiter: der
   * verstecke immer drei Viertel der Bank, und beim Aufstellen weiß man oft
   * erst beim Hinsehen, wen man sucht. Ein Tipp auf einen freien Platz schiebt
   * das Band an die passende Gruppe, siehe {@link scrollToGroup}.
   */
  private renderBench(bench: readonly LineupPlayer[]): string {
    if (bench.length === 0) {
      return `
        <section class="bench" data-bench>
          <p class="bench-empty">Die Bank ist leer, alle stehen auf dem Feld.</p>
        </section>
      `;
    }

    const groups = TABS.map((pos) => {
      const cards = bench.filter((p) => p.positionLabel === pos);
      if (cards.length === 0) return '';
      return `
        <div class="bench-group" data-group="${pos}">
          <span class="bench-grouplabel">${pos} <span>${cards.length}</span></span>
          <div class="bench-cards">${cards.map((p) => this.renderBenchCard(p)).join('')}</div>
        </div>
      `;
    }).join('');

    return `
      <section class="bench" data-bench>
        <div class="bench-strip">${groups}</div>
      </section>
    `;
  }

  private renderBenchCard(player: LineupPlayer): string {
    return `
      <button type="button" class="bench-card" data-player-id="${escapeHtml(player.id)}"
              data-drag-id="${escapeHtml(player.id)}" data-drag-from="bench">
        <span class="card-img">
          <img class="card-photo" src="${escapeHtml(photoSrc(player))}"
               data-fallback="${escapeHtml(teamLogoUrl(player.teamId))}" alt="" draggable="false"
               loading="lazy" decoding="async">
          ${renderAlert(player)}
          ${renderS11(player, 'card-s11')}
        </span>
        <img class="card-club" src="${escapeHtml(teamLogoUrl(player.teamId))}" alt="" draggable="false"
             width="18" height="18" loading="lazy" decoding="async">
        <span class="card-name">${escapeHtml(player.name)}</span>
        <span class="card-meta">${formatMio(player.marketValue)} Mio.</span>
        ${this.scoreLabel(player.id) ? `<span class="card-score">${this.scoreLabel(player.id)}</span>` : ''}
      </button>
    `;
  }

  /**
   * Auf dem Feld steht nur der Score. Der Marktwert gehört dort nicht hin:
   * beim Aufstellen zählt, wer spielt, nicht was er kostet, und unter jedem
   * Gesicht ein Betrag macht den Rasen zur Preisliste.
   */
  private scoreLabel(id: PlayerId): string {
    const entry = this.props.scores?.[id];
    return entry ? `${Math.round(entry.score * 100)} %` : '';
  }

  private byScore(a: LineupPlayer, b: LineupPlayer): number {
    const scoreA = this.props.scores?.[a.id]?.score ?? -1;
    const scoreB = this.props.scores?.[b.id]?.score ?? -1;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.name.localeCompare(b.name, 'de-DE');
  }
}

function dedupe(ids: readonly PlayerId[]): PlayerId[] {
  return [...new Set(ids)];
}

/**
 * Wo lag der Kreis, als er aufgenommen wurde?
 *
 * Der Ghost übernimmt diese Lage zum Zeiger und behält sie. Ohne sie sässe er
 * beim Ausbrechen plötzlich mittig unter dem Finger, obwohl der die Karte
 * vielleicht am unteren Rand gefasst hat. Der Versatz bleibt innerhalb einer
 * halben Kreisbreite: sonst zöge man an einem Kreis, der weit neben der Hand
 * liegt.
 */
function grabOffset(
  source: HTMLElement | null,
  startX: number,
  startY: number,
  size: number,
): { x: number; y: number } {
  const rect = source?.querySelector('.tok-img, .card-img')?.getBoundingClientRect();
  if (!rect || rect.width === 0 || size === 0) return { x: 0, y: 0 };
  const limit = size / 2;
  return {
    x: clamp(rect.left + rect.width / 2 - startX, -limit, limit),
    y: clamp(rect.top + rect.height / 2 - startY, -limit, limit),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Ab hier gehört der Zeiger der Geste, auch wenn er die Kachel verlässt.
 * Fehlschlagen kann das, wenn der Zeiger schon weg ist; dann laufen die
 * Ereignisse weiter über die Ebene, das genügt.
 */
function capture(drag: DragState): void {
  try {
    drag.handle.setPointerCapture(drag.pointerId);
  } catch {
    /* der Zeiger ist nicht mehr da */
  }
}

/**
 * An welchen Platz der Reihe zeigt der Finger?
 *
 * Gerechnet wird an der Breite der Reihe, nicht an den Kreisen darin. Die
 * verschieben sich nämlich, sobald die Lücke steht, und ein Index, der aus
 * verschobenen Kreisen kommt, springt zwischen zwei Plätzen hin und her.
 */
function slotIndex(row: HTMLElement, x: number): number {
  const tokens = row.querySelectorAll('.tok:not(.is-lifted)').length;
  const rect = row.getBoundingClientRect();
  if (rect.width === 0) return tokens;
  const raw = Math.floor(((x - rect.left) / rect.width) * (tokens + 1));
  return Math.min(Math.max(raw, 0), tokens);
}

/** Der Platzhalter, der in der Reihe mitwandert. */
function createGap(): HTMLElement {
  const gap = document.createElement('span');
  gap.className = 'tok-gap';
  gap.setAttribute('aria-hidden', 'true');
  return gap;
}

/**
 * Umbauen ohne Springen: erst messen, dann umbauen, dann jeden Kreis vom alten
 * Platz auf den neuen laufen lassen. Ohne das säßen die Nachbarn nach jedem
 * Wechsel der Lücke schlagartig woanders.
 */
function flipRow(row: HTMLElement, mutate: () => void): void {
  const tokens = [...row.querySelectorAll<HTMLElement>('.tok')];
  const before = tokens.map((tok) => tok.getBoundingClientRect().left);
  mutate();
  const deltas = tokens.map((tok, i) => {
    const rect = tok.getBoundingClientRect();
    return rect.width === 0 ? 0 : (before[i] ?? 0) - rect.left;
  });
  tokens.forEach((tok, i) => {
    const delta = deltas[i] ?? 0;
    if (Math.abs(delta) < 0.5) return;
    tok.style.transition = 'none';
    tok.style.transform = `translateX(${delta}px)`;
  });
  requestAnimationFrame(() => {
    for (const tok of tokens) {
      tok.style.transition = '';
      tok.style.transform = '';
    }
  });
}

/**
 * Warnzeichen oben rechts am Bild, gegenüber dem Wappen.
 *
 * Der Squad-Response liefert nur `st`: 0 heißt fit, alles andere heißt
 * ausgefallen. Ob Verletzung oder Sperre steht dort nicht, das käme aus
 * `stxt` der Spielerdetails, die diese Seite nicht lädt. Der Text bleibt
 * deshalb allgemein.
 */
function renderAlert(player: LineupPlayer): string {
  if (player.status === 0) return '';
  return `<span class="status-dot" title="${STATUS_TITLE}" aria-label="${STATUS_TITLE}"></span>`;
}

/**
 * Meldungen unter der Bank. Zwei Plätze, damit nichts wandert: der Grund
 * einer Sperre steht am Kartenband, wo er entsteht, das Ergebnis des Sendens
 * unter dem Balken, der es ausgelöst hat.
 */
function renderNote(note: Note | null, slot: 'hint' | 'send'): string {
  if (!note) return '';
  if ((note.tone === 'hint') !== (slot === 'hint')) return '';
  const cls = { hint: 'is-warning', ok: 'is-ok', error: 'is-error' }[note.tone];
  return `<p class="lineup-note ${cls}">${escapeHtml(note.text)}</p>`;
}

/**
 * Kennzeichen einer Elf, unabhängig von der Anordnung: Kickbase bekommt nur
 * die Formation und die Namen, und die Formation folgt aus den Namen. Ein
 * Umsortieren in der Reihe soll den Knopf also nicht wieder freigeben.
 */
function idKey(ids: readonly PlayerId[]): string {
  return [...ids].sort().join(',');
}

/**
 * Warum das Senden nicht geklappt hat, als Halbsatz hinter "Senden
 * fehlgeschlagen:". Kickbases eigener Grund steht englisch im Body, etwa
 * "InvalidData"; durchgereicht stünde er mitten in einer deutschen Zeile.
 * Was wir kennen, steht deutsch da, alles andere nennt wenigstens den Status.
 */
function errorText(error: unknown): string {
  if (error instanceof KickbaseError) {
    if (error.status === 0) return 'keine Verbindung zu Kickbase';
    if (error.isUnauthorized) return 'die Sitzung ist abgelaufen';
    if (error.code === ERROR_CODES.invalidData) return 'Kickbase nimmt diese Elf nicht an';
    return `Kickbase antwortet mit ${error.status}`;
  }
  return 'unbekannter Fehler';
}

/**
 * Bildquelle: erst der Pfad aus dem Squad-Response, sonst der Weg über die
 * Spieler-Id. Den zweiten gibt es nicht für jeden, gerade Neuzugänge fehlen
 * dort und bekamen bisher fälschlich das Wappen statt eines Gesichts.
 */
function photoSrc(player: LineupPlayer): string {
  return player.imagePath ? playerImageUrl(player.imagePath) : playerPhotoUrl(player.id);
}

/**
 * S11-Prognose unten rechts am Bild. Die Stufen und Farben folgen der
 * Kickbase-App, damit niemand zwei Legenden lernen muss.
 */
function renderS11(player: LineupPlayer, cls: string): string {
  const level = S11_LEVELS[player.probability];
  if (!level) return '';
  return `<span class="${cls} ${level.cls}" title="${level.title}"
                aria-label="${level.title}">${level.glyph}</span>`;
}

