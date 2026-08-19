/**
 * Der Spielerdialog. Geht auf, wenn man in der Tabelle auf einen Namen tippt.
 *
 * Aufbau von oben nach unten: wer er ist, was er wert ist, was er bringt,
 * wann er spielt, was ein Verkauf auslöst, und ganz unten der Satz dazu.
 * Kickbase zeigt einen Spieler für sich, hier steht daneben, was er für den
 * eigenen Kader bedeutet.
 *
 * Reiner Renderer. Öffnen, Schliessen und das Rechnen steuern
 * `planning-page.ts` und `compute/player-insight.ts`.
 */

import type { PlayerId, PositionCode } from '../api/types.js';
import type { ScoreDetail } from '../compute/optimizer.js';
import type { PositionLabel } from '../compute/planning.js';
import type { MatchdayEntry, PlayerInsight } from '../compute/player-insight.js';
import {
  escapeHtml,
  formatMio,
  formatSignedMio,
  playerImageUrl,
  playerPhotoUrl,
  teamLogoUrl,
} from './format.js';

export interface PlayerDialogInput {
  playerId: PlayerId;
  name: string;
  positionLabel: PositionLabel;
  /** Zahlencode 1 bis 4, für die Farbe der Positionsmarke. */
  position: PositionCode;
  teamId: string;
  /** Vereinsname aus der Tabelle, leer wenn der Score-Lauf noch aussteht. */
  teamName: string;
  /** Bildpfad aus dem Kader (`pim`), leer wenn Kickbase keinen führt. */
  imagePath: string;
  /** 0 heisst einsatzbereit, alles andere ist ein Ausfall. */
  status: number;
  marketValue: number;
  saleValue: number;
  /** "G/V seit Kauf" laut Kickbase. */
  mvgl: number;
  /** Score und Teilwerte, null solange kein Lauf durch ist. */
  score: { score: number; detail: ScoreDetail } | null;
  insight: PlayerInsight;
}

const PERCENT = (value: number): string => `${Math.round(value * 100)} %`;

/** Ab 70 % gut, ab 40 % mittel, darunter schwach. Farbe trägt Bedeutung. */
function gradeClass(value: number): string {
  if (value >= 0.7) return 'pd-grade--good';
  if (value >= 0.4) return 'pd-grade--mid';
  return 'pd-grade--weak';
}

/** Dieselben Wortlaute wie in der Gegner-Spalte der Tabelle. */
function trendLabel(entry: MatchdayEntry): string {
  if (entry.trend === 'up') return 'leicht';
  if (entry.trend === 'down') return 'schwer';
  return 'mittel';
}

function trendClass(entry: MatchdayEntry): string {
  if (entry.trend === 'up') return 'pd-trend--easy';
  if (entry.trend === 'down') return 'pd-trend--hard';
  return 'pd-trend--mid';
}

// ---------- Kopf ----------

function renderHead(input: PlayerDialogInput): string {
  const photo = input.imagePath ? playerImageUrl(input.imagePath) : playerPhotoUrl(input.playerId);
  const fit = input.status === 0;
  const statusTitle = fit ? 'Einsatzbereit' : 'Ausfall laut Kickbase';
  const club = input.teamName || 'Verein unbekannt';

  return `
    <header class="pd-head">
      <div class="pd-identity">
        <span class="pd-portrait">
          <img class="pd-photo" src="${photo}" alt="" loading="eager" decoding="sync">
          <img class="pd-crest" src="${teamLogoUrl(input.teamId)}" alt="" width="30" height="30">
        </span>
        <span class="pd-ident-text">
          <span class="pd-name">${escapeHtml(input.name)}</span>
          <span class="pd-tags">
            <span class="chip chip--pos${input.position}">${input.positionLabel}</span>
            <span class="pd-club">${escapeHtml(club)}</span>
            <span class="pd-status${fit ? '' : ' pd-status--out'}" title="${statusTitle}" aria-label="${statusTitle}"></span>
          </span>
        </span>
        <button type="button" class="dialog-close pd-close" data-dialog-close aria-label="Schließen">×</button>
      </div>
      <div class="pd-values">
        <span class="pd-value"><span>Marktwert</span><b>${formatMio(input.marketValue)}</b></span>
        <span class="pd-value"><span>Erlös</span><b>${formatMio(input.saleValue)}</b></span>
        <span class="pd-value"><span>G/V seit Kauf</span><b class="${input.mvgl < 0 ? 'pd-neg' : 'pd-pos'}">${formatSignedMio(input.mvgl)}</b></span>
      </div>
      <p class="pd-unit">Alle Beträge in Mio. €</p>
    </header>
  `;
}

// ---------- Score ----------

function renderScore(input: PlayerDialogInput): string {
  if (!input.score) {
    return `
      <section class="pd-section">
        <h3 class="pd-section-title">Score</h3>
        <p class="pd-empty">Der Score-Lauf ist noch nicht durch.</p>
      </section>
    `;
  }

  const detail = input.score.detail;
  // Fällt ein Spieler aus, setzt der Optimizer alle Teilwerte auf 0. Dann
  // stünden hier drei leere Balken, die nichts bedeuten.
  const out = detail.availability === 0;
  const bars: Array<[string, number]> = [
    ['Form', detail.form],
    ['Startelfchance', detail.startProb],
    ['Verfügbarkeit', detail.availability],
  ];

  return `
    <section class="pd-section">
      <h3 class="pd-section-title">Score</h3>
      <div class="pd-score">
        <span class="pd-score-main">
          <span class="pd-score-value">${Math.round(input.score.score * 100)}<i>%</i></span>
          <span class="pd-score-label">Gesamt</span>
        </span>
        <span class="pd-score-bars">
          ${out
            ? '<span class="pd-empty">Ausfall, deshalb kein Teilwert.</span>'
            : bars.map(([label, value]) => `
                <span class="pd-bar">
                  <span class="pd-bar-label">${label}</span>
                  <span class="pd-bar-track"><span class="pd-bar-fill ${gradeClass(value)}" style="width:${Math.round(value * 100)}%"></span></span>
                  <span class="pd-bar-value">${PERCENT(value)}</span>
                </span>
              `).join('')}
        </span>
      </div>
    </section>
  `;
}

// ---------- Spieltage ----------

/**
 * Eine durchgehende Achse, gespielt links und kommend rechts, getrennt nur
 * durch eine feine Linie. Beide Hälften sind gleich gebaut: Spieltag, Wappen,
 * Ort, Hauptzahl, kleine Zeile. Links ist die Hauptzahl die Punkte, rechts
 * der Tabellenplatz des Gegners.
 */
function renderMatchdays(insight: PlayerInsight): string {
  const days = insight.matchdays;
  if (days.length === 0) {
    return `
      <section class="pd-section">
        <h3 class="pd-section-title">Spieltage</h3>
        <p class="pd-empty">Noch keine Spieltage bekannt.</p>
      </section>
    `;
  }

  const past = days.filter((day) => !day.ahead);
  const ahead = days.filter((day) => day.ahead);
  const best = Math.max(1, ...past.map((day) => day.points ?? 0));

  const cell = (day: MatchdayEntry): string => {
    // Geschütztes Leerzeichen statt eines Zeichens für "unbekannt": die Zeile
    // hält ihre Höhe, ohne etwas zu behaupten.
    const label = day.day > 0 ? String(day.day) : '&nbsp;';
    const crest = day.opponentId
      ? `<img class="pd-day-crest" src="${teamLogoUrl(day.opponentId)}" alt="" width="20" height="20">`
      : '<span class="pd-day-crest pd-day-crest--none" aria-hidden="true"></span>';
    const venue = day.home === null
      ? '<span class="pd-venue pd-venue--none">&nbsp;</span>'
      : `<span class="pd-venue">${day.home ? 'H' : 'A'}</span>`;

    if (day.ahead) {
      return `
        <span class="pd-day pd-day--ahead" title="${escapeHtml(day.opponentName ?? 'Gegner unbekannt')}, ${day.home ? 'zu Hause' : 'auswärts'}, Spieltag ${day.day}">
          <span class="pd-day-num">${label}</span>
          ${crest}
          ${venue}
          <span class="pd-day-main">${day.opponentPosition > 0 ? `${day.opponentPosition}.` : '&nbsp;'}</span>
          <span class="pd-day-note ${trendClass(day)}">${trendLabel(day)}</span>
        </span>
      `;
    }

    const scoreline = day.goalsFor === null
      ? '&nbsp;'
      : `${day.goalsFor}:${day.goalsAgainst}`;
    return `
      <span class="pd-day${day.played ? '' : ' pd-day--out'}" title="Spieltag ${label}${day.opponentName ? `, gegen ${escapeHtml(day.opponentName)}` : ''}${day.played ? `, ${day.points} Punkte` : ', nicht gespielt'}">
        <span class="pd-day-num">${label}</span>
        ${crest}
        ${venue}
        <span class="pd-day-main">${day.played ? day.points : '&ndash;'}</span>
        <span class="pd-day-note">${scoreline}</span>
      </span>
    `;
  };

  // Der Verlauf als flache Balken: die Form der letzten Spiele auf einen
  // Blick, ohne fünf Zahlen zu vergleichen.
  const bar = (day: MatchdayEntry): string => {
    const height = day.played && day.points ? Math.max(6, Math.round((day.points / best) * 26)) : 3;
    return `<span class="pd-spark"><span class="pd-spark-fill" style="height:${height}px"></span></span>`;
  };

  return `
    <section class="pd-section">
      <h3 class="pd-section-title">Spieltage</h3>
      <div class="pd-scale">
        <span>Gespielt</span>
        <span>Kommend</span>
      </div>
      <div class="pd-axis">
        <span class="pd-half" style="flex:${Math.max(1, past.length)}">${past.map(cell).join('')}</span>
        <span class="pd-split" aria-hidden="true"></span>
        <span class="pd-half" style="flex:${Math.max(1, ahead.length)}">${ahead.map(cell).join('')}</span>
      </div>
      ${past.length > 0
        ? `<div class="pd-axis pd-axis--spark">
             <span class="pd-half" style="flex:${Math.max(1, past.length)}">${past.map(bar).join('')}</span>
             <span class="pd-split pd-split--quiet" aria-hidden="true"></span>
             <span class="pd-half" style="flex:${Math.max(1, ahead.length)}">${ahead.map(() => '<span class="pd-spark"></span>').join('')}</span>
           </div>`
        : ''}
      <p class="pd-legend">
        H Heim, A auswärts. Ergebnis aus Sicht seines Vereins.
        Links die Punkte je Spieltag, rechts der Tabellenplatz des Gegners.
      </p>
    </section>
  `;
}

// ---------- Verkauf ----------

function renderSale(insight: PlayerInsight): string {
  const { sale, lineup } = insight;
  const eleven = lineup.bestElevenNow !== null && lineup.bestElevenAfter !== null
    ? `<p class="pd-sale-note">Beste Elf danach ${PERCENT(lineup.bestElevenAfter)}, jetzt ${PERCENT(lineup.bestElevenNow)}.</p>`
    : '';

  return `
    <section class="pd-section">
      <h3 class="pd-section-title">Wenn du ihn verkaufst</h3>
      <div class="pd-sell">
        <span class="pd-cell">
          <span class="pd-cell-label">Aufs Konto</span>
          <span class="pd-cell-value pd-pos">${formatSignedMio(sale.proceeds)}</span>
          <span class="pd-cell-note">Erlös beim Verkauf</span>
        </span>
        <span class="pd-cell">
          <span class="pd-cell-label">Kreditlinie</span>
          <span class="pd-cell-value pd-neg">${formatSignedMio(sale.creditDrop)}</span>
          <span class="pd-cell-note">33 % vom Teamwert</span>
        </span>
        <span class="pd-cell">
          <span class="pd-cell-label">Netto Spielraum</span>
          <span class="pd-cell-value">${formatSignedMio(sale.net)}</span>
          <span class="pd-cell-note">Erlös minus Kreditlinie</span>
        </span>
        <span class="pd-cell">
          <span class="pd-cell-label">Rahmen danach</span>
          <span class="pd-cell-value">${formatMio(sale.headroomAfter)}</span>
          <span class="pd-cell-note">jetzt ${formatMio(sale.headroomNow)}</span>
        </span>
      </div>
      ${eleven}
    </section>
  `;
}

// ---------- Einschätzung ----------

function renderVerdict(insight: PlayerInsight): string {
  const { lineup } = insight;
  const successor = lineup.successor
    ? ` ${escapeHtml(lineup.successor.name)} rückt nach, Score ${PERCENT(lineup.successor.score)}.`
    : '';

  if (!lineup.formationHolds) {
    return `
      <div class="pd-verdict pd-verdict--warn">
        <span class="pd-verdict-mark">!</span>
        <span>
          <span class="pd-verdict-title">Die Aufstellung kippt</span>
          <span class="pd-verdict-text">Danach bleiben ${lineup.countAfter} ${lineup.position}, für eine gültige Formation reicht das nicht.${successor}</span>
        </span>
      </div>
    `;
  }

  const title = lineup.inBestEleven ? 'Er steht in der besten Elf' : 'Er steht nicht in der besten Elf';
  const text = lineup.inBestEleven
    ? `Ein Verkauf kostet dich einen Stammplatzspieler.${successor}`
    : 'Ein Verkauf ändert an der besten Elf nichts.';

  return `
    <div class="pd-verdict">
      <span class="pd-verdict-mark pd-verdict-mark--calm">i</span>
      <span>
        <span class="pd-verdict-title">${title}</span>
        <span class="pd-verdict-text">${text}</span>
      </span>
    </div>
  `;
}

/**
 * Das ganze Overlay. Trägt `data-dialog-shade` und `data-dialog-close`, damit
 * `wireModal` in `planning-page.ts` es ohne Sonderfall schliessen kann.
 */
export function renderPlayerDialog(input: PlayerDialogInput): string {
  return `
    <div class="dialog-shade" data-dialog-shade tabindex="-1">
      <section class="dialog-box pd-box" role="dialog" aria-modal="true" aria-label="${escapeHtml(input.name)}">
        ${renderHead(input)}
        <div class="dialog-body pd-body">
          ${renderScore(input)}
          ${renderMatchdays(input.insight)}
          ${renderSale(input.insight)}
          ${renderVerdict(input.insight)}
        </div>
      </section>
    </div>
  `;
}
