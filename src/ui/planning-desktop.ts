/**
 * Planning table — one view for every screen width.
 *
 * Pure renderer: takes a `PlanningView` plus toggle callback, paints the host.
 * Event handling uses delegation on the host so the renderer doesn't need to
 * track per-cell listeners.
 *
 * Welche Spalten sichtbar sind, entscheidet CSS über Container-Queries
 * (`planning.css`, Abschnitt "Breitenleiter"). Der Renderer gibt immer alle
 * Spalten aus und markiert nur, welche Szenariospalte die aktive ist:
 *
 *   < 320   Spieler · Pos · aktives Szenario · Score · Gegner, Rest scrollt
 *     320   dieselbe Auswahl, passend
 *     360   + Marktwert, G/V als zweite Zeile darunter
 *     412   G/V als eigene Spalte, größere Schrift
 *     744   + BANK als Vergleichsspalte
 *     820   alle vier Szenarien, kein Umschalter
 *     924   volle Beträge statt Millionen
 */

import type { MarketPlayer, PlayerId } from '../api/types.js';
import { positionLabel, type ScoreDetail } from '../compute/optimizer.js';
import type {
  PlanningRow,
  PlanningView,
  ResolvedScenarioSlot,
  ScenarioSummaries,
  ScenarioSummary,
} from '../compute/planning.js';
import type { ScenarioFlags, ScenarioSlot } from '../state/planning.js';
import type { OppLayout } from '../state/opponents.js';
import {
  EMPTY_OPPONENTS,
  trendOfPosition,
  type OpponentsView,
  type TeamInfo,
  type Trend,
} from '../compute/score.js';
import { formationIssueChip, formationIssueChips } from './chips.js';
import {
  escapeHtml,
  formatEur,
  formatMio,
  formatSignedEur,
  formatSignedMio,
  teamLogoUrl,
} from './format.js';

/**
 * Geldbetrag in beiden Schreibweisen. Welche sichtbar ist, entscheidet CSS:
 * schmal die Millionen ohne Einheit, ab der letzten Stufe der volle Betrag.
 * Ein Umschalten im JavaScript würde eine Breitenmessung brauchen.
 */
function money(value: number, signed = false): string {
  const wide = signed ? formatGvEur(value) : formatEur(value);
  const narrow = signed ? formatSignedMio(value) : formatMio(value);
  return amountPair(wide, narrow);
}

function amountPair(wide: string, narrow: string): string {
  return `<span class="amount-wide">${escapeHtml(wide)}</span><span class="amount-narrow">${escapeHtml(narrow)}</span>`;
}

/**
 * G/V als zweite Zeile in der Marktwertzelle. Sichtbar nur, solange die
 * eigene Spalte nicht passt; ab 366 blendet CSS sie aus.
 *
 * Immer mit Vorzeichen, auch bei Gewinn: die Zeile steht direkt unter dem
 * Marktwert und ohne Plus liest sich der Wert wie ein zweiter Betrag statt
 * wie ein Gewinn. In der eigenen Spalte sagt die Überschrift daneben, worum
 * es geht, dort bleibt es beim Vorzeichen nur im Minus.
 */
function mvglLine(value: number): string {
  const amount = amountPair(formatSignedEur(value), formatSignedMio(value));
  return `<span class="mv-gv ${signColorClass(value)}">${amount}</span>`;
}

/**
 * Unsichtbarer Platzhalter in Höhe des größtmöglichen Betrags. Die Werte
 * in den Summenzeilen wachsen mit jeder Auswahl; ohne den Platzhalter zöge
 * das die Spalte breiter und die ganze Tabelle verschöbe sich.
 */
function gauge(value: number): string {
  return `<span class="amount-gauge" aria-hidden="true">${money(value)}</span>`;
}

/**
 * Unsichtbarer Platzhalter in Breite des breitesten Formationschips. Die
 * Fehlerzeile steht nur da, solange eine Formation kaputt ist, und ihre Chips
 * können breiter sein als der Betrag darüber (in Millionen-Schreibweise
 * etwa "10/11" gegen "1.128,2"). Ohne den Platzhalter wüchse die Spalte beim
 * ersten Fehler und schrümpfte beim letzten wieder.
 *
 * `formationIssueLabel` liefert nur `TW`, `ABW`, `MF`, `ANG` und `X/11` mit X
 * bis 10, breiter als `10/11` wird es also nie.
 */
/**
 * Unsichtbare Platzhalter in den beiden rechten Spaltenköpfen. Beide Spalten
 * stehen leer da, bis der Score-Lauf durch ist, und wüchsen erst dann auf ihre
 * Breite: die Prozentzahl kann dreistellig werden, die Spieltagsnummer
 * zweistellig. Ohne die Reservierung rückt beim Eintreffen der Werte die halbe
 * Tabelle nach links.
 */
const SCORE_GAUGE = '<span class="head-gauge" aria-hidden="true">100&nbsp;%</span>';
const OPP_GAUGE = '<span class="head-gauge" aria-hidden="true">ST&nbsp;34</span>';

function formationGauge(): string {
  return `<span class="formation-gauge" aria-hidden="true">${formationIssueChip('10/11')}</span>`;
}

/** Obergrenze der Summen: alle verkauft, dazu ein positiver Kontostand. */
function widestAmount(view: PlanningView): number {
  // Über den Erlös, nicht über den Marktwert: liegt ein Gebot darüber, zählt
  // das Gebot, und die Summe der Verkäufe kann den Marktwert übersteigen.
  const totalSale = view.rows.reduce((sum, row) => sum + row.saleValue, 0);
  return Math.max(totalSale + Math.max(view.budget, 0), Math.abs(view.budget));
}

export interface PlanningDesktopCallbacks {
  onToggle: (playerId: PlayerId, slot: ScenarioSlot) => void;
  /** Klick auf einen Erlös, hinter dem ein fremdes Gebot steht. */
  onShowOffers: (playerId: PlayerId) => void;
  /** Klick auf den Namen eines Kaderspielers. */
  onShowPlayer: (playerId: PlayerId) => void;
  onClearSlot: (slot: ScenarioSlot) => void;
  onCopyFromS4: (slot: ScenarioSlot) => void;
  /** Umschalter unter 820 px: welche Szenariospalte gezeigt wird. */
  onSelectSlot: (slot: ResolvedScenarioSlot) => void;
  /** ×-Knopf im Transferkopf: räumt diese Spalte nur im Transferblock ab. */
  onClearTransferSlot: (slot: ScenarioSlot) => void;
  /** ✓-Knopf im Transferkopf: hakt alle Transfers dieser Spalte an. */
  onSelectAllTransfers: (slot: ScenarioSlot) => void;
}

/**
 * Eine Zeile im Transferblock: das eigene Gebot auf einen Marktspieler, dazu
 * die Szenarien, in denen der Zugang eingeplant ist. Die Häkchen liegen im
 * selben Zustand wie die des Kaders, nur bedeuten sie hier "kaufen" statt
 * "verkaufen".
 */
export interface TransferRow {
  player: MarketPlayer;
  flags: ScenarioFlags;
}

export interface DesktopScoresProp {
  byPlayer: Record<PlayerId, { score: number; detail: ScoreDetail }>;
  top11Ids: PlayerId[];
  formationFallback: boolean;
  /** Nächste Ansetzungen je Verein. Leer, solange nichts bekannt ist. */
  opponents: OpponentsView;
  /** Scores der Marktspieler, auf derselben Skala wie der Kader. */
  marketByPlayer: Record<PlayerId, { score: number; detail: ScoreDetail }>;
}

const ALL_SLOTS: readonly ResolvedScenarioSlot[] = ['S1', 'S2', 'S3', 'S4'];

/**
 * Kurzfassung im Spaltenkopf. Die lange Erklärung steht im Hilfedialog
 * ("Was ist der Score?"), die Aufschlüsselung je Spieler im Tooltip der Zelle.
 */
/**
 * Was in der Spalte steht, ist nicht mehr nur Kickbases Marktwert: liegt ein
 * Gebot darüber, zählt das Gebot. Der Kopf sagt es einmal, die Zelle selbst
 * bleibt eine Zahl.
 */
const ERLOES_HINT =
  'Was der Verkauf bringt: das höchste Gebot eines Mitspielers, sonst der Marktwert. Grüne Beträge stehen für ein Gebot, ein Klick zeigt es.';

const SCORE_HINT =
  'Was der Spieler am nächsten Spieltag bringt, 0 bis 100 %. Aus Form, Startelf-Prognose und Verfügbarkeit. Der Gegner steht in der Spalte daneben.';

const SLOT_LABEL: Record<ResolvedScenarioSlot, string> = {
  S1: 'S1',
  S2: 'S2',
  S3: 'S3',
  S4: 'BANK',
};

/**
 * Umschalter und Tabelle als Markup, ohne sie irgendwo einzuhängen.
 *
 * Getrennt vom Verdrahten, damit die Seite in einer einzigen Zuweisung
 * entstehen kann: würde die Tabelle nachgereicht, wäre das Dokument für einen
 * Moment nur Kopf und Fußzeile hoch, und iOS klemmt die Scroll-Position auf
 * genau diese Höhe. Das Verdrahten übernimmt {@link wirePlanningDesktop}.
 */
export function planningDesktopMarkup(
  view: PlanningView,
  scores: DesktopScoresProp | null,
  bids: readonly TransferRow[],
  activeSlot: ResolvedScenarioSlot,
  /**
   * Wie die Gegner-Spalte aussehen soll, solange der Score-Lauf noch läuft.
   * Kommt aus dem letzten Lauf dieser Liga (`state/opponents.ts`).
   */
  fallbackOpp: OppLayout = { columns: 1, nextDay: 0 },
): string {
  const widest = widestAmount(view);
  // Vor dem Lauf ist nichts bekannt: Raster und Spaltenkopf stehen trotzdem
  // schon so da, wie sie gleich aussehen werden.
  const opponents: OpponentsView = scores?.opponents ?? {
    ...EMPTY_OPPONENTS,
    columns: fallbackOpp.columns,
    nextDay: fallbackOpp.nextDay,
  };
  return `
    ${renderSlotSwitch(activeSlot)}
    <table class="planning-table">
      <thead>
        ${/* Von oben nach unten eine Rechnung: Start, ab, dazu, Ergebnis. */ ''}
        ${renderActualBalanceRow(view.budget, activeSlot, widest)}
        ${
          // Ohne offene Gebote wäre die Zeile in jeder Spalte 0 €.
          bids.length > 0
            ? renderScenarioSummaryRow('Gebote', view.summaries, 'bidsSum', activeSlot, widest)
            : ''
        }
        ${renderScenarioSummaryRow('Verkäufe', view.summaries, 'salesSum', activeSlot, widest)}
        ${renderScenarioSummaryRow('Kontostand (neu)', view.summaries, 'newBalance', activeSlot, widest)}
        <tr class="planning-headrow">
          <th class="col-name">Spieler</th>
          <th class="col-pos">Pos</th>
          <th class="col-mv" title="${ERLOES_HINT}">
            <span class="label-wide">Erlös</span><span class="label-narrow">Erl.</span>
            <span class="mv-gv-label">G/V</span>
          </th>
          ${ALL_SLOTS.map((s) => renderSlotHeader(s, activeSlot)).join('')}
          <th class="col-pl">
            <span class="label-wide">G/V seit Kauf</span><span class="label-narrow">G/V</span>
          </th>
          <th class="col-score" title="${SCORE_HINT}">
            <span class="label-wide">Score</span><span class="label-narrow">%</span>
            ${SCORE_GAUGE}
          </th>
          <th class="col-opp" title="Gegner am nächsten Spieltag">
            ${renderOpponentsHeader(opponents)}${OPP_GAUGE}
          </th>
        </tr>
      </thead>
      <tbody>
        ${view.rows.map((row) => renderPlayerRow(row, scores, opponents, activeSlot)).join('')}
      </tbody>
      <tfoot>
        ${renderFooterRow(view, activeSlot)}
        ${renderFormationIssuesRow(view, activeSlot)}
        ${
          // Ohne eigenes Gebot steht der Block leer da und kostet drei Zeilen.
          bids.length > 0
            ? `
              ${renderTransferLabelRow(activeSlot)}
              ${renderTransferHeadRow(activeSlot, opponents)}
              ${renderTransferRows(bids, scores, opponents, activeSlot)}
              ${renderTransferFooterRow(bids, activeSlot)}
            `
            : ''
        }
      </tfoot>
    </table>
  `;
}

/**
 * Die Stellen nachziehen, die von den Häkchen abhängen, statt die Tabelle neu
 * zu bauen. Ein Neuaufbau erzeugt jedes Wappen als neues Element, und Safari
 * auf dem iPhone zeichnet die erst im nächsten Frame: sichtbar als Flackern.
 *
 * Angefasst wird alles, was ein Häkchen bewegt: die Zelle selbst, die
 * Summenzeilen, die Anzahl je Szenario, die Summe im Transferblock und die
 * Fehlerzeile. Alles andere in der Tabelle hängt am Kader, nicht am Szenario.
 */
export function updatePlanningScenarios(
  host: HTMLElement,
  view: PlanningView,
  bids: readonly TransferRow[],
  activeSlot: ResolvedScenarioSlot,
): void {
  const widest = widestAmount(view);

  const flagsById = new Map<string, Record<string, boolean>>();
  for (const row of view.rows) flagsById.set(row.id, { ...row.flags });
  for (const bid of bids) flagsById.set(bid.player.id, { ...bid.flags });

  for (const cell of host.querySelectorAll<HTMLElement>('[data-player-id][data-slot]')) {
    const id = cell.dataset['playerId'];
    const slot = cell.dataset['slot'];
    if (!id || !slot) continue;
    cell.classList.toggle('scen-cell--checked', Boolean(flagsById.get(id)?.[slot]));
  }

  for (const cell of host.querySelectorAll<HTMLElement>('[data-sum][data-slot]')) {
    const key = cell.dataset['sum'] as keyof Pick<
      ScenarioSummary,
      'newBalance' | 'salesSum' | 'bidsSum'
    >;
    const slot = cell.dataset['slot'] as ResolvedScenarioSlot;
    const value = view.summaries[slot][key];
    cell.innerHTML = `${money(value)}${gauge(widest)}`;
    if (key === 'newBalance') {
      cell.classList.toggle('num--neg', value < 0);
      cell.classList.toggle('num--pos', value >= 0);
    }
  }

  for (const cell of host.querySelectorAll<HTMLElement>('[data-count]')) {
    const slot = cell.dataset['count'] as ResolvedScenarioSlot;
    cell.textContent = String(view.rows.filter((row) => row.flags[slot]).length);
  }

  for (const cell of host.querySelectorAll<HTMLElement>('[data-tsum]')) {
    const slot = cell.dataset['tsum'] as ScenarioSlot;
    const sold = bids
      .filter((row) => row.flags[slot])
      .reduce((sum, row) => sum + row.player.marketValue, 0);
    cell.innerHTML = money(sold);
  }

  // Die Fehlerzeile kommt und geht mit der Formation. Sie trägt kein Bild,
  // sie darf im Ganzen ausgetauscht werden.
  const markup = renderFormationIssuesRow(view, activeSlot).trim();
  const current = host.querySelector('tr.planning-footer-formation');
  if (!markup) {
    current?.remove();
  } else if (current) {
    current.outerHTML = markup;
  } else {
    host.querySelector('[data-footer="squad"]')?.insertAdjacentHTML('afterend', markup);
  }
}

/**
 * Ein einziger Listener am Wirt, der alle Klicks in der Tabelle verteilt. Er
 * hängt an dem frisch gerenderten Element, nicht am dauerhaften Host: bei
 * jedem Toggle wird neu gezeichnet, am Host würden sich die Listener stapeln.
 */
export function wirePlanningDesktop(host: HTMLElement, callbacks: PlanningDesktopCallbacks): void {
  host.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const nameBtn = target.closest<HTMLElement>('[data-player]');
    if (nameBtn) {
      const playerId = nameBtn.dataset['player'];
      if (playerId) callbacks.onShowPlayer(playerId);
      return;
    }

    const offersBtn = target.closest<HTMLElement>('[data-offers]');
    if (offersBtn) {
      const playerId = offersBtn.dataset['offers'];
      if (playerId) callbacks.onShowOffers(playerId);
      return;
    }

    const slotBtn = target.closest<HTMLElement>('[data-select-slot]');
    if (slotBtn) {
      const slot = slotBtn.dataset['selectSlot'];
      if (slot) callbacks.onSelectSlot(slot as ResolvedScenarioSlot);
      return;
    }

    const selectTransfers = target.closest<HTMLElement>('[data-select-transfers]');
    if (selectTransfers) {
      event.stopPropagation();
      const slot = selectTransfers.dataset['selectTransfers'];
      if (slot && slot !== 'S4') callbacks.onSelectAllTransfers(slot as ScenarioSlot);
      return;
    }

    const clearTransfers = target.closest<HTMLElement>('[data-clear-transfers]');
    if (clearTransfers) {
      event.stopPropagation();
      const slot = clearTransfers.dataset['clearTransfers'];
      if (slot && slot !== 'S4') callbacks.onClearTransferSlot(slot as ScenarioSlot);
      return;
    }

    const clearBtn = target.closest<HTMLElement>('[data-clear-slot]');
    if (clearBtn) {
      event.stopPropagation();
      const slot = clearBtn.dataset['clearSlot'];
      if (slot && slot !== 'S4') callbacks.onClearSlot(slot as ScenarioSlot);
      return;
    }

    const copyBtn = target.closest<HTMLElement>('[data-copy-slot]');
    if (copyBtn) {
      event.stopPropagation();
      const slot = copyBtn.dataset['copySlot'];
      if (slot && slot !== 'S4') callbacks.onCopyFromS4(slot as ScenarioSlot);
      return;
    }

    const cell = target.closest<HTMLElement>('[data-slot][data-player-id]');
    if (!cell) return;
    const playerId = cell.dataset['playerId'];
    const slot = cell.dataset['slot'];
    if (!playerId || !slot) return;
    if (slot === 'S4') return; // S4 (BANK) is auto-derived; not user-toggleable.
    callbacks.onToggle(playerId, slot as ScenarioSlot);
  });
}

/**
 * Klassen einer Szenariozelle. Unter 820 px zeigt CSS nur die aktive Spalte,
 * darüber alle vier.
 */
function scenClass(slot: ResolvedScenarioSlot, activeSlot: ResolvedScenarioSlot, extra = ''): string {
  return [
    'col-scen',
    slot === activeSlot ? 'col-scen--active' : '',
    // BANK ist die Vergleichsspalte: ab Tablet steht sie neben der aktiven.
    slot === 'S4' ? 'col-scen--bank' : '',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Umschalter für die eine sichtbare Szenariospalte. Ab 820 px blendet CSS ihn aus. */
function renderSlotSwitch(activeSlot: ResolvedScenarioSlot): string {
  const buttons = ALL_SLOTS.map((slot) => {
    const pressed = slot === activeSlot ? 'true' : 'false';
    // BANK fällt ab 720 aus dem Umschalter: dort steht die Spalte ohnehin
    // dauerhaft neben der gewählten.
    const cls = slot === 'S4' ? ' class="scen-switch-bank"' : '';
    return `
      <button type="button"${cls} data-select-slot="${slot}" aria-pressed="${pressed}">
        ${escapeHtml(SLOT_LABEL[slot])}
      </button>
    `;
  }).join('');
  return `<div class="scen-switch">${buttons}</div>`;
}

function renderSlotHeader(slot: ResolvedScenarioSlot, activeSlot: ResolvedScenarioSlot): string {
  const label = escapeHtml(SLOT_LABEL[slot]);
  if (slot === 'S4') {
    return `<th class="${scenClass(slot, activeSlot)}">${label}</th>`;
  }
  // S1-S3: no visible label at desktop width; the column position identifies
  // which is which. Schmal steht der Name im Umschalter darüber.
  //
  // Die Knöpfe liegen über der Zelle statt in ihr. Im Fluss wären sie
  // breiter als der Betrag darunter und machten S1 bis S3 breiter als BANK,
  // dessen Kopf nur das Wort trägt.
  return `
    <th class="${scenClass(slot, activeSlot)}">
      <span class="slot-actions">
        <button type="button" class="slot-copy"
                data-copy-slot="${slot}"
                title="Werte aus BANK übernehmen"
                aria-label="Werte aus BANK übernehmen">←</button>
        <button type="button" class="slot-clear"
                data-clear-slot="${slot}"
                title="${label} zurücksetzen"
                aria-label="${label} zurücksetzen">×</button>
      </span>
    </th>
  `;
}

/**
 * Summenzeilen überspannen nur Spieler und Pos, die beiden Spalten die es in
 * jeder Breite gibt. Würde die Beschriftung auch den Marktwert überspannen,
 * rutschten die Werte beim Ausblenden dieser Spalte eine Position nach rechts.
 */
function renderSummaryLead(label: string): string {
  return `
    <th class="summary-label col-name" colspan="2">${escapeHtml(label)}</th>
    <td class="col-mv"></td>
  `;
}

const SUMMARY_TAIL =
  '<td class="col-pl"></td><td class="col-score"></td><td class="col-opp"></td>';

/*
 * Beide Platzhalter hängen hier, weil es diese Zeile immer gibt. In der
 * Fehlerzeile selbst wäre die Reservierung genau dann weg, wenn die Zeile
 * verschwindet, also im Moment des Breitensprungs.
 */
function renderActualBalanceRow(
  budget: number,
  activeSlot: ResolvedScenarioSlot,
  widest: number,
): string {
  const cells = ALL_SLOTS.map(
    (slot) =>
      `<td class="${scenClass(slot, activeSlot, 'num')}">${money(budget)}${gauge(widest)}${formationGauge()}</td>`,
  ).join('');
  return `
    <tr class="planning-summary">
      ${renderSummaryLead('Kontostand (aktuell)')}
      ${cells}
      ${SUMMARY_TAIL}
    </tr>
  `;
}

function renderScenarioSummaryRow(
  label: string,
  summaries: ScenarioSummaries,
  key: keyof Pick<ScenarioSummary, 'newBalance' | 'salesSum' | 'bidsSum'>,
  activeSlot: ResolvedScenarioSlot,
  widest: number,
): string {
  const cells = ALL_SLOTS.map((slot) => {
    const summary = summaries[slot];
    const value = summary[key];
    let cls = 'num';
    if (key === 'newBalance') {
      cls = value < 0 ? 'num num--neg' : 'num num--pos';
    }
    return `<td class="${scenClass(slot, activeSlot, cls)}"
                data-sum="${key}" data-slot="${slot}">${money(value)}${gauge(widest)}</td>`;
  }).join('');
  return `
    <tr class="planning-summary">
      ${renderSummaryLead(label)}
      ${cells}
      ${SUMMARY_TAIL}
    </tr>
  `;
}

function renderFormationIssuesRow(view: PlanningView, activeSlot: ResolvedScenarioSlot): string {
  const hasFormationIssues = ALL_SLOTS.some((slot) => !view.summaries[slot].isFormationValid);
  if (!hasFormationIssues) return '';

  const cells = ALL_SLOTS.map((slot) => {
    const summary = view.summaries[slot];
    if (summary.isFormationValid) {
      return `<td class="${scenClass(slot, activeSlot, 'formation-status-cell')}"></td>`;
    }

    const detail = summary.formationIssues.join(', ');
    const cls = scenClass(
      slot,
      activeSlot,
      'formation-status-cell formation-status-cell--invalid',
    );
    const title = ` title="${escapeHtml(`Formation ungültig: ${detail}`)}"`;
    return `<td class="${cls}"${title}>${renderFormationIssueBadges(summary.formationIssues)}</td>`;
  }).join('');

  return `
    <tr class="planning-footer planning-footer-formation">
      <td colspan="3"></td>
      ${cells}
      ${SUMMARY_TAIL}
    </tr>
  `;
}

function renderFormationIssueBadges(issues: string[]): string {
  if (issues.length === 0) return '';

  return `
    <span class="formation-issue-stack">
      ${formationIssueChips(issues)}
    </span>
  `;
}

/**
 * Summenzeile: Kadergröße, Summe der Marktwerte, je Szenario die Zahl der
 * angehakten Spieler, Summe G/V. Score und Gegner bleiben leer, beides lässt
 * sich nicht sinnvoll addieren.
 *
 * Gezählt wird nur der Kader. Zugänge stehen im eigenen Block darunter und
 * haben dort ihre eigene Summenzeile.
 */
function renderFooterRow(view: PlanningView, activeSlot: ResolvedScenarioSlot): string {
  const totalSale = view.rows.reduce((sum, row) => sum + row.saleValue, 0);
  const scenCells = ALL_SLOTS.map((slot) => {
    const sold = view.rows.filter((row) => row.flags[slot]).length;
    return `<td class="${scenClass(slot, activeSlot, 'scen-count')}" data-count="${slot}">${sold}</td>`;
  }).join('');
  return `
    <tr class="planning-footer" data-footer="squad">
      <td class="col-name" colspan="2">${view.totalPlayers} Spieler</td>
      <td class="num col-mv">${money(totalSale)}${mvglLine(view.totalGainLoss)}</td>
      ${scenCells}
      <td class="col-pl ${signColorClass(view.totalGainLoss)}">${money(view.totalGainLoss, true)}</td>
      <td class="col-score"></td>
      <td class="col-opp"></td>
    </tr>
  `;
}

/**
 * Der Erlös in seiner Spalte. Ohne Gebot eine Zahl wie jede andere, mit Gebot
 * grün und anklickbar. Kein Stern und kein Zusatzzeichen: die Farbe reicht,
 * und die gepunktete Linie sagt, dass dahinter noch etwas steckt.
 */
function renderSaleValue(row: PlanningRow): string {
  const amount = money(row.saleValue);
  if (row.bestOffer <= row.marketValue) return amount;
  return `
    <button type="button" class="amount-offer" data-offers="${escapeHtml(row.id)}"
            title="Gebot eines Mitspielers, Klick zeigt alle">${amount}</button>
  `;
}

function renderPlayerRow(
  row: PlanningRow,
  scores: DesktopScoresProp | null,
  opponents: OpponentsView,
  activeSlot: ResolvedScenarioSlot,
): string {
  const nameCls = row.isInLineup ? 'col-name col-name--lineup' : 'col-name';
  // Blau heißt: steht im Transfermarkt. Der Preis und die Gebote stehen im
  // Spielerdialog, in der Zeile ist dafür kein Platz.
  const listedCls = row.listing ? ' name-btn--listed' : '';
  const listedTitle = row.listing ? ' title="Steht im Transfermarkt"' : '';
  const gainLossCls = signColorClass(row.gainLoss);

  const scenCells = ALL_SLOTS.map((slot) => {
    const checked = row.flags[slot];
    const isAuto = slot === 'S4';
    const classes = [
      scenClass(slot, activeSlot),
      'scen-cell',
      checked ? 'scen-cell--checked' : '',
      isAuto ? 'scen-cell--auto' : 'scen-cell--clickable',
    ]
      .filter(Boolean)
      .join(' ');
    // Der Betrag steht immer im Markup und wird nur unsichtbar geschaltet.
    // Sonst wäre die Spalte ohne Auswahl schmal und würde beim ersten
    // Häkchen aufspringen, was die ganze Tabelle verschiebt.
    return `
      <td class="${classes}" data-player-id="${escapeHtml(row.id)}" data-slot="${slot}">
        <span class="scen-amount">${money(row.saleValue)}</span>
      </td>
    `;
  }).join('');

  const scoreCell = renderScoreCell(row.id, row.isInLineup, scores);

  return `
    <tr>
      <td class="${nameCls}" data-player="${escapeHtml(row.id)}"><button type="button" class="name-text name-btn${listedCls}"${listedTitle}>${escapeHtml(row.name)}</button>${renderTeamLogo(row.teamId, opponents.teams)}</td>
      <td class="col-pos"><span class="chip chip--pos${row.position}">${escapeHtml(row.positionLabel)}</span></td>
      <td class="num col-mv">${renderSaleValue(row)}${mvglLine(row.gainLoss)}</td>
      ${scenCells}
      <td class="col-pl ${gainLossCls}">${money(row.gainLoss, true)}</td>
      ${scoreCell}
      <td class="col-opp">${renderOpponents(row.teamId, opponents)}</td>
    </tr>
  `;
}

/**
 * Überschrift des Transferblocks, in derselben Schreibweise wie die
 * Beschriftungen über der Tabelle ("Verkäufe"). Sie steht über der
 * Spaltenzeile, damit klar ist, dass die Spalten darunter etwas anderes zählen
 * als die des Kaders.
 */
function renderTransferLabelRow(activeSlot: ResolvedScenarioSlot): string {
  const scenCells = ALL_SLOTS.map(
    (slot) => `<td class="${scenClass(slot, activeSlot)}"></td>`,
  ).join('');
  return `
    <tr class="planning-summary planning-transfers-label">
      <th class="summary-label col-name" colspan="2">
        Transfers
      </th>
      <td class="col-mv"></td>
      ${scenCells}
      ${SUMMARY_TAIL}
    </tr>
  `;
}

/**
 * Kopfzeile des Transferblocks, unterhalb der Summenzeile.
 *
 * Gleiche Spaltenzahl wie oben, damit die Breiten stehen bleiben, aber andere
 * Belegung: an dritter Stelle steht das Gebot. S1 bis S3 sagen, in welchem
 * Szenario der Zugang eingeplant ist, und brauchen keine Knöpfe. Wo oben BANK
 * steht, steht hier der Marktwert: einen festen Bestand gibt es für Zugänge
 * nicht. Die Spalte darauf bleibt frei, dort kommt der Knopf zum Entfernen hin.
 */
function renderTransferHeadRow(
  activeSlot: ResolvedScenarioSlot,
  opponents: OpponentsView,
): string {
  const scenCells = ALL_SLOTS.map((slot) => {
    if (slot === 'S4') {
      // Dieselbe Beschriftung wie im Kader: die Spalte trägt denselben Betrag,
      // und das Wort "Marktwert" war in der kompakten Schreibweise breiter als
      // jeder Betrag und zog die Spalte auseinander.
      return `
        <th class="${scenClass(slot, activeSlot)}">
          <span class="label-wide">Erlös</span><span class="label-narrow">Erl.</span>
        </th>
      `;
    }
    // Kein Spaltenname: welche Spalte welche ist, steht schon in der Kopfzeile
    // des Kaders darüber. Hier zählt der Knopf, der die Häkchen dieser
    // Spalte im Transferblock wieder abräumt.
    const label = escapeHtml(SLOT_LABEL[slot]);
    return `
      <th class="${scenClass(slot, activeSlot)}">
        <span class="transfer-slot-actions">
          <button type="button" class="slot-copy"
                  data-select-transfers="${slot}"
                  title="alle Transfers in ${label} auswählen"
                  aria-label="alle Transfers in ${label} auswählen">✓</button>
          <button type="button" class="slot-clear"
                  data-clear-transfers="${slot}"
                  title="${label} im Transferblock zurücksetzen"
                  aria-label="${label} im Transferblock zurücksetzen">×</button>
        </span>
      </th>
    `;
  }).join('');
  return `
    <tr class="planning-headrow planning-headrow--transfers">
      <th class="col-name">Spieler</th>
      <th class="col-pos">Pos</th>
      <th class="col-mv">Gebot</th>
      ${scenCells}
      <th class="col-pl"></th>
      <th class="col-score" title="${SCORE_HINT}">
        <span class="label-wide">Score</span><span class="label-narrow">%</span>
        ${SCORE_GAUGE}
      </th>
      <th class="col-opp">${renderOpponentsHeader(opponents)}${OPP_GAUGE}</th>
    </tr>
  `;
}

/**
 * Die Zeilen des Transferblocks: jedes eigene offene Gebot, das Kickbase im
 * Markt führt. Damit stehen hier auch Gebote aus der Kickbase-App, denn die
 * Marktantwort trägt das eigene Gebot an jedem Spieler mit.
 *
 * Score bleibt vorerst leer: dafür müsste der Optimizer über die
 * Marktspieler mitlaufen, das ist ein eigener Lauf.
 */
function renderTransferRows(
  bids: readonly TransferRow[],
  scores: DesktopScoresProp | null,
  opponents: OpponentsView,
  activeSlot: ResolvedScenarioSlot,
): string {
  return bids
    .map((row, index) => renderTransferRow(row, scores, opponents, activeSlot, index))
    .join('');
}

function renderTransferRow(
  row: TransferRow,
  scores: DesktopScoresProp | null,
  opponents: OpponentsView,
  activeSlot: ResolvedScenarioSlot,
  index: number,
): string {
  const bid = row.player;
  const amount = bid.myOffer?.amount ?? 0;

  const scenCells = ALL_SLOTS.map((slot) => {
    // Die BANK-Spalte trägt hier den Marktwert und ist kein Häkchen: einen
    // festen Bestand gibt es für einen Zugang nicht.
    if (slot === 'S4') {
      return `<td class="${scenClass(slot, activeSlot, 'num')}">${money(bid.marketValue)}</td>`;
    }
    const checked = row.flags[slot];
    const classes = [
      scenClass(slot, activeSlot),
      'scen-cell',
      'scen-cell--clickable',
      checked ? 'scen-cell--checked' : '',
    ]
      .filter(Boolean)
      .join(' ');
    // Der Marktwert, nicht das Gebot: ein Häkchen heißt hier dasselbe wie im
    // Kader, nämlich verkaufen, und Kickbase zahlt dafür den Marktwert. Das
    // Gebot steht daneben in der eigenen Spalte und geht in jeder Spalte ab.
    return `
      <td class="${classes}" data-player-id="${escapeHtml(bid.id)}" data-slot="${slot}">
        <span class="scen-amount">${money(bid.marketValue)}</span>
      </td>
    `;
  }).join('');

  // Der Wechsel steht im Markup, nicht in `nth-child`: die Zeilen liegen im
  // Fuß zwischen Summen- und Kopfzeilen, die mitzählen würden.
  const rowCls = index % 2 === 1 ? ' class="is-alt"' : '';
  return `
    <tr${rowCls}>
      <td class="col-name" data-player="${escapeHtml(bid.id)}"><button type="button" class="name-text name-btn">${escapeHtml(bid.name)}</button>${renderTeamLogo(bid.teamId, opponents.teams)}</td>
      <td class="col-pos"><span class="chip chip--pos${bid.position}">${escapeHtml(positionLabel(bid.position))}</span></td>
      <td class="num col-mv">${money(amount)}</td>
      ${scenCells}
      <td class="col-pl"></td>
      ${renderMarketScoreCell(bid.id, scores)}
      <td class="col-opp">${renderOpponents(bid.teamId, opponents)}</td>
    </tr>
  `;
}

/**
 * Summenzeile des Transferblocks, gebaut wie die des Kaders: links die Anzahl,
 * dann die Summen unter ihren Spalten. Auch die Szenariospalten summieren,
 * nicht zählen: nur so lässt sich die Zeile "Verkäufe" oben nachrechnen.
 */
function renderTransferFooterRow(
  bids: readonly TransferRow[],
  activeSlot: ResolvedScenarioSlot,
): string {
  if (bids.length === 0) return '';

  const totalBid = bids.reduce((sum, row) => sum + (row.player.myOffer?.amount ?? 0), 0);
  const totalMv = bids.reduce((sum, row) => sum + row.player.marketValue, 0);
  const scenCells = ALL_SLOTS.map((slot) => {
    if (slot === 'S4') {
      return `<td class="${scenClass(slot, activeSlot, 'num')}">${money(totalMv)}</td>`;
    }
    const sold = bids
      .filter((row) => row.flags[slot])
      .reduce((sum, row) => sum + row.player.marketValue, 0);
    return `<td class="${scenClass(slot, activeSlot, 'num')}" data-tsum="${slot}">${money(sold)}</td>`;
  }).join('');

  return `
    <tr class="planning-footer">
      <td class="col-name" colspan="2">${bids.length} ${bids.length === 1 ? 'Transfer' : 'Transfers'}</td>
      <td class="num col-mv">${money(totalBid)}</td>
      ${scenCells}
      <td class="col-pl"></td>
      <td class="col-score"></td>
      <td class="col-opp"></td>
    </tr>
  `;
}

/** Wie die Score-Zelle des Kaders, nur ohne Elf-Hervorhebung. */
function renderMarketScoreCell(playerId: PlayerId, scores: DesktopScoresProp | null): string {
  const entry = scores?.marketByPlayer[playerId];
  if (!entry) return `<td class="col-score score-cell"></td>`;
  const tooltip = formatScoreTooltip(entry.detail);
  return `
    <td class="col-score score-cell" title="${escapeHtml(tooltip)}">
      <span class="score-value">${escapeHtml(`${Math.round(entry.score * 100)} %`)}</span>
    </td>
  `;
}

/**
 * Spaltentitel: die Spieltagsnummer statt eines Worts. Sie sagt genauer, worauf
 * sich das Wappen bezieht, und hält die Spalte so schmal wie das Wappen.
 * Solange kein Spieltag bekannt ist, steht nur `ST` da.
 */
function renderOpponentsHeader(opp: OpponentsView): string {
  return opp.nextDay > 0 ? `ST&nbsp;${opp.nextDay}` : 'ST';
}

/**
 * Die nächsten Ansetzungen als festes Raster: Wappen des Gegners, daneben ein
 * Pfeil für die Tendenz. Jede Zeile bekommt gleich viele Felder, auch wenn
 * einem Verein eine Ansetzung fehlt, sonst wandern die Wappen von Zeile zu
 * Zeile.
 *
 * Der Pfeil steht bei starkem oder schwachem Gegner, im Mittelfeld steht ein
 * grauer Strich. Heim oder auswärts steht nur im Tooltip: als Farbe oder
 * Deckkraft wäre es eine zweite Bedeutung neben der Tendenz und dafür zu leise.
 *
 * Unter 796 px zeigt CSS nur die nächste Ansetzung, siehe `--opp-cols`.
 */
function renderOpponents(teamId: string, opp: OpponentsView): string {
  // Auch ohne bekannte Ansetzung steht das Raster da: sonst fehlte seine Höhe
  // und die Zeilen sprängen auf, sobald die Wappen eintreffen.
  const columns = Math.max(opp.columns, 1);
  const list = opp.fixtures[teamId] ?? [];

  let slots = '';
  for (let i = 0; i < columns; i++) {
    const fixture = list[i];
    if (!fixture) {
      slots += '<span class="opp-slot"></span>';
      continue;
    }
    const info = opp.teams[fixture.opponentId];
    const trend = trendOfPosition(info?.position ?? 0, opp.teamCount);
    const title = [
      info?.name ?? 'Gegner unbekannt',
      info ? ` (${info.position}.)` : '',
      fixture.home ? ', zu Hause' : ', auswärts',
      `, Spieltag ${fixture.day}`,
    ].join('');
    slots += `<span class="opp-slot" title="${escapeHtml(title)}">
      <img class="opp-crest" src="${escapeHtml(teamLogoUrl(fixture.opponentId))}" alt=""
           width="20" height="20" loading="eager" decoding="sync">
      <span class="opp-arrow">${trendGlyph(trend)}</span>
    </span>`;
  }

  // Die Spaltenzahl geht als Variable rein, damit CSS sie schmal auf eine
  // herunterdrehen kann. Als fertiges `grid-template-columns` ginge das nicht.
  return `<span class="opp-slots" style="--opp-cols:${columns}">${slots}</span>`;
}

/**
 * Hoch und runter bekommen einen Pfeil, das Mittelfeld einen grauen Strich.
 * Der Strich füllt denselben Platz wie ein Pfeil: leer sah die Zeile aus, als
 * fehlte die Angabe, statt zu sagen, dass der Gegner mittelmäßig steht.
 */
function trendGlyph(trend: Trend): string {
  if (trend === 'up') {
    return '<span class="opp-trend opp-trend--up" aria-label="schwacher Gegner">↑</span>';
  }
  if (trend === 'down') {
    return '<span class="opp-trend opp-trend--down" aria-label="starker Gegner">↓</span>';
  }
  return '<span class="opp-trend opp-trend--flat" aria-label="Gegner im Mittelfeld"></span>';
}

/**
 * Wappen am rechten Rand der Namensspalte, absolut positioniert. Es steht
 * ausserhalb des Textflusses, die Spalte wird dadurch nicht breiter, und weil
 * die Spalte eine feste rechte Kante hat, stehen alle Wappen in einer Linie.
 * Unter 388 px blendet CSS sie aus, dort zählt jedes Pixel.
 *
 * Feste `width` und `height`, sonst springt die Zeilenhöhe beim Nachladen.
 *
 * Der Tooltip nennt Verein und Tabellenplatz. Beides kommt aus der
 * Wettbewerbstabelle und steht erst nach dem Score-Lauf bereit; vorher trägt
 * das Wappen keinen.
 */
function renderTeamLogo(teamId: string, teams: Record<string, TeamInfo>): string {
  if (!teamId) return '';
  const info = teams[teamId];
  const title = info ? ` title="${escapeHtml(`${info.name} (${info.position}.)`)}"` : '';
  return `<img class="team-logo" src="${escapeHtml(teamLogoUrl(teamId))}" alt=""${title}
               width="20" height="20" loading="eager" decoding="sync">`;
}

function renderScoreCell(
  playerId: PlayerId,
  isInLineup: boolean,
  scores: DesktopScoresProp | null,
): string {
  if (!scores) return `<td class="col-score score-cell"></td>`;
  const entry = scores.byPlayer[playerId];
  if (!entry) return `<td class="col-score score-cell"></td>`;
  const pct = Math.round(entry.score * 100);
  const isTop11 = scores.top11Ids.includes(playerId);
  const cls = [
    'col-score',
    'score-cell',
    isTop11 ? 'score-cell--top11' : '',
  ].filter(Boolean).join(' ');
  const value = `${pct} %`;
  const tooltip = formatScoreTooltip(entry.detail);
  const valueCls = isTop11 && isInLineup ? 'score-value score-value--lineup-top11' : 'score-value';
  return `<td class="${cls}" title="${escapeHtml(tooltip)}"><span class="${valueCls}">${escapeHtml(value)}</span></td>`;
}

/**
 * Aufschlüsselung der Zelle. Der Gegner steht nicht mehr drin: er zählt für
 * die Zahl nicht mehr mit, sondern nur noch bei der Auswahl der Elf. Sein
 * Platz ist die Gegner-Spalte.
 */
function formatScoreTooltip(d: ScoreDetail): string {
  return [
    `S11: ${Math.round(d.startProb * 100)} %`,
    `Form: ${Math.round(d.form * 100)} % (${Math.round(d.formRaw)} Punkte)`,
    `Verfügbarkeit: ${Math.round(d.availability * 100)} %`,
  ].join('\n');
}

function formatGvEur(value: number): string {
  return value < 0 ? formatSignedEur(value) : formatEur(value);
}

function signColorClass(value: number): string {
  if (value > 0) return 'num num--pos';
  if (value < 0) return 'num num--neg';
  return 'num';
}
