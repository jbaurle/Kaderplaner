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
 *     744   + FIX als Vergleichsspalte
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
 * eigene Spalte nicht passt; ab 388 blendet CSS sie aus.
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
function formationGauge(): string {
  return `<span class="formation-gauge" aria-hidden="true">${formationIssueChip('10/11')}</span>`;
}

/** Obergrenze der Summen: alle verkauft, dazu ein positiver Kontostand. */
function widestAmount(view: PlanningView): number {
  const totalMv = view.rows.reduce((sum, row) => sum + row.marketValue, 0);
  return Math.max(totalMv + Math.max(view.budget, 0), Math.abs(view.budget));
}

export interface PlanningDesktopCallbacks {
  onToggle: (playerId: PlayerId, slot: ScenarioSlot) => void;
  onClearSlot: (slot: ScenarioSlot) => void;
  onCopyFromS5: (slot: ScenarioSlot) => void;
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

const ALL_SLOTS: readonly ResolvedScenarioSlot[] = ['S1', 'S2', 'S3', 'S5'];

/**
 * Kurzfassung im Spaltenkopf. Die lange Erklärung steht im Hilfedialog
 * ("Was ist der Score?"), die Aufschlüsselung je Spieler im Tooltip der Zelle.
 */
const SCORE_HINT =
  'Was der Spieler am nächsten Spieltag bringt, 0 bis 100 %. Aus Form, Startelf-Prognose, Gegner und Verfügbarkeit.';

const SLOT_LABEL: Record<ResolvedScenarioSlot, string> = {
  S1: 'S1',
  S2: 'S2',
  S3: 'S3',
  S5: 'FIX',
};

export function renderPlanningDesktop(
  host: HTMLElement,
  view: PlanningView,
  scores: DesktopScoresProp | null,
  bids: readonly TransferRow[],
  activeSlot: ResolvedScenarioSlot,
  callbacks: PlanningDesktopCallbacks,
): void {
  const widest = widestAmount(view);
  host.innerHTML = `
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
          <th class="col-mv">
            <span class="label-wide">Marktwert</span><span class="label-narrow">MW</span>
            <span class="mv-gv-label">G/V</span>
          </th>
          ${ALL_SLOTS.map((s) => renderSlotHeader(s, activeSlot)).join('')}
          <th class="col-pl">
            <span class="label-wide">G/V seit Kauf</span><span class="label-narrow">G/V</span>
          </th>
          <th class="col-score" title="${SCORE_HINT}">Score</th>
          <th class="col-opp" title="Gegner am nächsten Spieltag">
            ${renderOpponentsHeader(scores?.opponents ?? EMPTY_OPPONENTS)}
          </th>
        </tr>
      </thead>
      <tbody>
        ${view.rows.map((row) => renderPlayerRow(row, scores, activeSlot)).join('')}
      </tbody>
      <tfoot>
        ${renderFooterRow(view, activeSlot)}
        ${renderFormationIssuesRow(view, activeSlot)}
        ${renderTransferLabelRow(activeSlot)}
        ${renderTransferHeadRow(activeSlot, scores)}
        ${renderTransferRows(bids, scores, activeSlot)}
        ${renderTransferFooterRow(bids, activeSlot)}
      </tfoot>
    </table>
  `;

  host.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

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
      if (slot && slot !== 'S5') callbacks.onSelectAllTransfers(slot as ScenarioSlot);
      return;
    }

    const clearTransfers = target.closest<HTMLElement>('[data-clear-transfers]');
    if (clearTransfers) {
      event.stopPropagation();
      const slot = clearTransfers.dataset['clearTransfers'];
      if (slot && slot !== 'S5') callbacks.onClearTransferSlot(slot as ScenarioSlot);
      return;
    }

    const clearBtn = target.closest<HTMLElement>('[data-clear-slot]');
    if (clearBtn) {
      event.stopPropagation();
      const slot = clearBtn.dataset['clearSlot'];
      if (slot && slot !== 'S5') callbacks.onClearSlot(slot as ScenarioSlot);
      return;
    }

    const copyBtn = target.closest<HTMLElement>('[data-copy-slot]');
    if (copyBtn) {
      event.stopPropagation();
      const slot = copyBtn.dataset['copySlot'];
      if (slot && slot !== 'S5') callbacks.onCopyFromS5(slot as ScenarioSlot);
      return;
    }

    const cell = target.closest<HTMLElement>('[data-slot][data-player-id]');
    if (!cell) return;
    const playerId = cell.dataset['playerId'];
    const slot = cell.dataset['slot'];
    if (!playerId || !slot) return;
    if (slot === 'S5') return; // S5 (fix) is auto-derived; not user-toggleable.
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
    // FIX ist die Vergleichsspalte: ab Tablet steht sie neben der aktiven.
    slot === 'S5' ? 'col-scen--fix' : '',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Umschalter für die eine sichtbare Szenariospalte. Ab 820 px blendet CSS ihn aus. */
function renderSlotSwitch(activeSlot: ResolvedScenarioSlot): string {
  const buttons = ALL_SLOTS.map((slot) => {
    const pressed = slot === activeSlot ? 'true' : 'false';
    // FIX fällt ab 720 aus dem Umschalter: dort steht die Spalte ohnehin
    // dauerhaft neben der gewählten.
    const cls = slot === 'S5' ? ' class="scen-switch-fix"' : '';
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
  if (slot === 'S5') {
    return `<th class="${scenClass(slot, activeSlot)}">${label}</th>`;
  }
  // S1-S3: no visible label at desktop width; the column position identifies
  // which is which. Schmal steht der Name im Umschalter darüber.
  //
  // Die Knöpfe liegen über der Zelle statt in ihr. Im Fluss wären sie
  // breiter als der Betrag darunter und machten S1 bis S3 breiter als FIX,
  // dessen Kopf nur das Wort trägt.
  return `
    <th class="${scenClass(slot, activeSlot)}">
      <span class="slot-actions">
        <button type="button" class="slot-copy"
                data-copy-slot="${slot}"
                title="Werte aus FIX übernehmen"
                aria-label="Werte aus FIX übernehmen">←</button>
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
    return `<td class="${scenClass(slot, activeSlot, cls)}">${money(value)}${gauge(widest)}</td>`;
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
      <td></td>
      <td></td>
      <td></td>
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
  const totalMv = view.rows.reduce((sum, row) => sum + row.marketValue, 0);
  const scenCells = ALL_SLOTS.map((slot) => {
    const sold = view.rows.filter((row) => row.flags[slot]).length;
    return `<td class="${scenClass(slot, activeSlot, 'scen-count')}">${sold}</td>`;
  }).join('');
  return `
    <tr class="planning-footer">
      <td class="col-name" colspan="2">${view.totalPlayers} Spieler</td>
      <td class="num col-mv">${money(totalMv)}${mvglLine(view.totalMvgl)}</td>
      ${scenCells}
      <td class="col-pl ${signColorClass(view.totalMvgl)}">${money(view.totalMvgl, true)}</td>
      <td class="col-score"></td>
      <td class="col-opp"></td>
    </tr>
  `;
}

function renderPlayerRow(
  row: PlanningRow,
  scores: DesktopScoresProp | null,
  activeSlot: ResolvedScenarioSlot,
): string {
  const nameCls = row.isInLineup ? 'col-name col-name--lineup' : 'col-name';
  const mvglCls = signColorClass(row.mvgl);

  const scenCells = ALL_SLOTS.map((slot) => {
    const checked = row.flags[slot];
    const isAuto = slot === 'S5';
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
        <span class="scen-amount">${money(row.marketValue)}</span>
      </td>
    `;
  }).join('');

  const scoreCell = renderScoreCell(row.id, row.isInLineup, scores);

  return `
    <tr>
      <td class="${nameCls}"><span class="name-text">${escapeHtml(row.name)}</span>${renderTeamLogo(row.teamId, scores?.opponents.teams ?? {})}</td>
      <td class="col-pos"><span class="chip chip--pos${row.position}">${escapeHtml(row.positionLabel)}</span></td>
      <td class="num col-mv">${money(row.marketValue)}${mvglLine(row.mvgl)}</td>
      ${scenCells}
      <td class="col-pl ${mvglCls}">${money(row.mvgl, true)}</td>
      ${scoreCell}
      <td class="col-opp">${renderOpponents(row.teamId, scores?.opponents ?? EMPTY_OPPONENTS)}</td>
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
 * Szenario der Zugang eingeplant ist, und brauchen keine Knöpfe. Wo oben FIX
 * steht, steht hier der Marktwert: einen festen Bestand gibt es für Zugänge
 * nicht. Die Spalte darauf bleibt frei, dort kommt der Knopf zum Entfernen hin.
 */
function renderTransferHeadRow(
  activeSlot: ResolvedScenarioSlot,
  scores: DesktopScoresProp | null,
): string {
  const scenCells = ALL_SLOTS.map((slot) => {
    if (slot === 'S5') {
      return `<th class="${scenClass(slot, activeSlot)}">Marktwert</th>`;
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
      <th class="col-score" title="${SCORE_HINT}">Score</th>
      <th class="col-opp">${renderOpponentsHeader(scores?.opponents ?? EMPTY_OPPONENTS)}</th>
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
  activeSlot: ResolvedScenarioSlot,
): string {
  if (bids.length === 0) {
    return `
      <tr class="planning-transfers-empty">
        <td class="col-name" colspan="10">Keine offenen Gebote.</td>
      </tr>
    `;
  }

  const opponents = scores?.opponents ?? EMPTY_OPPONENTS;
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
    // Die FIX-Spalte trägt hier den Marktwert und ist kein Häkchen: einen
    // festen Bestand gibt es für einen Zugang nicht.
    if (slot === 'S5') {
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
  // Fuss zwischen Summen- und Kopfzeilen, die mitzählen würden.
  const rowCls = index % 2 === 1 ? ' class="is-alt"' : '';
  return `
    <tr${rowCls}>
      <td class="col-name"><span class="name-text">${escapeHtml(bid.name)}</span>${renderTeamLogo(bid.teamId, opponents.teams)}</td>
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
    if (slot === 'S5') {
      return `<td class="${scenClass(slot, activeSlot, 'num')}">${money(totalMv)}</td>`;
    }
    const sold = bids
      .filter((row) => row.flags[slot])
      .reduce((sum, row) => sum + row.player.marketValue, 0);
    return `<td class="${scenClass(slot, activeSlot, 'num')}">${money(sold)}</td>`;
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
 * Der Pfeil steht nur bei starkem oder schwachem Gegner, das Mittelfeld bleibt
 * leer. Heim oder auswärts steht nur im Tooltip: als Farbe oder Deckkraft
 * wäre es eine zweite Bedeutung neben der Tendenz und dafür zu leise.
 */
function renderOpponents(teamId: string, opp: OpponentsView): string {
  if (opp.columns === 0) return '';
  const list = opp.fixtures[teamId] ?? [];

  let slots = '';
  for (let i = 0; i < opp.columns; i++) {
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
           width="20" height="20" loading="lazy" decoding="async">
      <span class="opp-arrow">${trendGlyph(trend)}</span>
    </span>`;
  }

  // Die Spaltenzahl geht als Variable rein, damit CSS sie schmal auf eine
  // herunterdrehen kann. Als fertiges `grid-template-columns` ginge das nicht.
  return `<span class="opp-slots" style="--opp-cols:${opp.columns}">${slots}</span>`;
}

/** Nur hoch und runter bekommen einen Pfeil, das Mittelfeld bleibt leer. */
function trendGlyph(trend: Trend): string {
  if (trend === 'up') {
    return '<span class="opp-trend opp-trend--up" aria-label="schwacher Gegner">↑</span>';
  }
  if (trend === 'down') {
    return '<span class="opp-trend opp-trend--down" aria-label="starker Gegner">↓</span>';
  }
  return '';
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
               width="20" height="20" loading="lazy" decoding="async">`;
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

function formatScoreTooltip(d: ScoreDetail): string {
  return [
    `S11: ${Math.round(d.startProb * 100)} %`,
    `Form: ${Math.round(d.form * 100)} % (${Math.round(d.formRaw)} Punkte)`,
    `Gegner: ${Math.round(d.matchup * 100)} %`,
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
