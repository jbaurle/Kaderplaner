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
  /** Nachname, wie in der Tabelle. */
  name: string;
  /** Vorname aus dem Spielerdetail. Leer, wenn keiner bekannt ist. */
  firstName: string;
  /** Klartext zum Ausfall aus `stxt`. Leer, wenn fit oder unbekannt. */
  statusText: string;
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

/*
 * Feste Zahl der Felder je Hälfte. Die Achse behält damit ihr Raster, auch
 * wenn eine Seite leer ist: sonst zieht die belegte Seite die Felder breit,
 * und die Spieltage wandern beim nächsten Öffnen an eine andere Stelle.
 */
/*
 * Feste Liste statt `Intl`: Chrome liefert für de-DE "Sep" und "Mär", also
 * ohne Punkt und mit einer Abkürzung, die es im Deutschen nicht gibt.
 * Abgekürzt wird mit Punkt, die kurzen Monatsnamen stehen ganz da.
 */
const MONTHS = [
  'Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni',
  'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.',
] as const;

const PAST_SLOTS = 5;
const AHEAD_SLOTS = 3;

/**
 * Kurzer Monat zum Anstoss, etwa "Aug". Leer, wenn kein Zeitstempel vorliegt:
 * gespielte Spieltage führen keinen, `matchSummary` kennt nur Tore.
 */
function monthShort(kickoff: string): string {
  if (!kickoff) return '';
  const date = new Date(kickoff);
  if (Number.isNaN(date.getTime())) return '';
  return MONTHS[date.getMonth()] ?? '';
}

/** Sieg grün, Niederlage rot, Unentschieden grau. */
function resultClass(day: MatchdayEntry): string {
  if (day.goalsFor === null || day.goalsAgainst === null) return '';
  if (day.goalsFor > day.goalsAgainst) return 'pd-trend--easy';
  if (day.goalsFor < day.goalsAgainst) return 'pd-trend--hard';
  return 'pd-trend--mid';
}

/** Grün über null, rot darunter. Null bleibt neutral. */
function signClass(value: number): string {
  if (value > 0) return ' pd-pos';
  if (value < 0) return ' pd-neg';
  return '';
}

const PERCENT = (value: number): string => `${Math.round(value * 100)} %`;

/** Dieselbe Ampel als Schriftfarbe, für die grosse Zahl. */
function gradeText(value: number): string {
  if (value >= 0.7) return 'pd-text--good';
  if (value >= 0.4) return 'pd-text--mid';
  return 'pd-text--weak';
}

/** Ab 70 % gut, ab 40 % mittel, darunter schwach. Farbe trägt Bedeutung. */
function gradeClass(value: number): string {
  if (value >= 0.7) return 'pd-grade--good';
  if (value >= 0.4) return 'pd-grade--mid';
  return 'pd-grade--weak';
}

/**
 * Dasselbe Zeichen wie in der Gegner-Spalte der Tabelle: hoch heisst
 * schwacher Gegner, runter heisst starker. Das Mittelfeld bekommt nichts:
 * ein Zeichen für "unentschieden zu bewerten" wäre nur ein Fleck am Wappen.
 */
function trendGlyph(entry: MatchdayEntry): string {
  if (entry.trend === 'up') return '&uarr;';
  if (entry.trend === 'down') return '&darr;';
  return '';
}

/** Für den Tooltip, dort steht der Klartext. */
function trendLabel(entry: MatchdayEntry): string {
  if (entry.trend === 'up') return 'schwacher Gegner';
  if (entry.trend === 'down') return 'starker Gegner';
  return 'Gegner im Mittelfeld';
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
  const statusTitle = fit
    ? 'Einsatzbereit'
    : input.statusText || 'Ausfall laut Kickbase';
  const club = input.teamName || 'Verein unbekannt';
  // Der Vorname steht nur im Spielerdetail, der Kader kennt ihn nicht.
  const fullName = input.firstName ? `${input.firstName} ${input.name}` : input.name;

  return `
    <header class="pd-head">
      <div class="pd-identity">
        <span class="pd-portrait">
          <img class="pd-photo" src="${photo}" alt="" loading="eager" decoding="sync">
          <img class="pd-crest" src="${teamLogoUrl(input.teamId)}" alt="" width="30" height="30">
        </span>
        <span class="pd-ident-text">
          <span class="pd-name">${escapeHtml(fullName)}</span>
          <span class="pd-tags">
            <span class="chip chip--pos${input.position}">${input.positionLabel}</span>
            <span class="pd-club">${escapeHtml(club)}</span>
            <span class="pd-status${fit ? '' : ' pd-status--out'}" title="${statusTitle}" aria-label="${statusTitle}"></span>
          </span>
          ${renderNewsLink(fullName, club, fit ? '' : input.statusText)}
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

/**
 * Suche nach Nachrichten zum Spieler.
 *
 * Kein Deep-Link: Ligainsider und Kicker haben keine Adresse, die sich aus
 * Namen bauen liesse, und eine gepflegte Zuordnung wäre bei jedem Wechsel
 * falsch. Die Suche mit Name, Verein und `ligainsider` führt in aller Regel
 * genau auf die Spielerseite dort.
 *
 * Bei einem Ausfall geht der Grund mit in die Anfrage: Kickbase nennt nur das
 * Wort, wie lange er fehlt, steht nur in den Nachrichten.
 */
function renderNewsLink(fullName: string, club: string, statusText: string): string {
  const terms = [fullName, club, 'ligainsider', statusText].filter((t) => t !== '').join(' ');
  const url = `https://www.google.com/search?q=${encodeURIComponent(terms)}`;
  const title = statusText
    ? `Nachrichten zum Ausfall von ${fullName} suchen`
    : `Nachrichten zu ${fullName} suchen`;
  return `<a class="pd-news" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"
             title="${escapeHtml(title)}">News suchen</a>`;
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
    ['S11', detail.startProb],
    ['Verfügbarkeit', detail.availability],
  ];

  return `
    <section class="pd-section">
      <h3 class="pd-section-title">Score</h3>
      <div class="pd-score">
        <span class="pd-score-main">
          <span class="pd-score-value ${gradeText(input.score.score)}">${Math.round(input.score.score * 100)}<i>%</i></span>
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

  /*
   * Eine Kachel je Spieltag, gespielt und geplant gleich gebaut: Nummer oben,
   * darunter das Wappen mit dem Ort rechts und der Einschätzung links, dann
   * das Ergebnis, unten die Hauptzahl mit ihrer Einheit.
   */
  const cell = (day: MatchdayEntry): string => {
    const number = day.day > 0 ? String(day.day) : '&nbsp;';
    const month = monthShort(day.kickoff);
    const label = month ? `${number}<i>${month}</i>` : number;

    const crest = day.opponentId
      ? `<img class="pd-day-crest" src="${teamLogoUrl(day.opponentId)}" alt="" width="22" height="22">`
      : '<span class="pd-day-crest pd-day-crest--none" aria-hidden="true"></span>';
    const venue = day.home === null
      ? ''
      : `<span class="pd-venue${day.home ? '' : ' pd-venue--away'}">${day.home ? 'H' : 'A'}</span>`;
    // Die Einschätzung sitzt links am Wappen, spiegelbildlich zum Ort. Beides
    // gehört zum Gegner, deshalb hängt beides an seinem Wappen.
    const glyph = day.ahead ? trendGlyph(day) : '';
    const trend = glyph
      ? `<span class="pd-trend ${trendClass(day)}" aria-label="${trendLabel(day)}">${glyph}</span>`
      : '';
    const badge = `<span class="pd-day-badge">${crest}${trend}${venue}</span>`;

    if (day.ahead) {
      const title = `${escapeHtml(day.opponentName ?? 'Gegner unbekannt')}, `
        + `${day.home ? 'zu Hause' : 'auswärts'}, Spieltag ${day.day}, ${trendLabel(day)}`;
      return `
        <span class="pd-day pd-day--ahead" title="${title}">
          <span class="pd-day-num">${label}</span>
          ${badge}
          <span class="pd-day-note">&nbsp;</span>
          <span class="pd-day-main">${day.opponentPosition > 0 ? String(day.opponentPosition) : '&nbsp;'}</span>
          <span class="pd-day-unit">Platz</span>
        </span>
      `;
    }

    const scoreline = day.goalsFor === null
      ? '&nbsp;'
      : `${day.goalsFor}:${day.goalsAgainst}`;
    const title = `Spieltag ${number}`
      + (day.opponentName ? `, gegen ${escapeHtml(day.opponentName)}` : '')
      + (day.played ? `, ${day.points} Punkte` : ', nicht gespielt');
    return `
      <span class="pd-day${day.played ? '' : ' pd-day--out'}" title="${title}">
        <span class="pd-day-num">${label}</span>
        ${badge}
        <span class="pd-day-note ${resultClass(day)}">${scoreline}</span>
        <span class="pd-day-main">${day.played ? day.points : '&middot;'}</span>
        <span class="pd-day-unit">${day.played ? 'Punkte' : '&nbsp;'}</span>
      </span>
    `;
  };

  const pastCells = past.length > 0
    ? past.slice(-PAST_SLOTS).map(cell).join('')
    : '<span class="pd-note">Noch keine Spieltage</span>';
  const aheadCells = ahead.length > 0
    ? ahead.slice(0, AHEAD_SLOTS).map(cell).join('')
    : '<span class="pd-note">Saison ist durch</span>';

  return `
    <section class="pd-section">
      <h3 class="pd-section-title">Spieltage</h3>
      <div class="pd-axis">
        <span class="pd-half pd-half--past">${pastCells}</span>
        <span class="pd-split"><span class="pd-now">jetzt</span></span>
        <span class="pd-half pd-half--ahead">${aheadCells}</span>
      </div>
      <p class="pd-legend">
        H Heim, A auswärts. Pfeil hoch heisst schwacher Gegner, runter starker.
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
      <h3 class="pd-section-title">Wenn du verkaufst</h3>
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
          <span class="pd-cell-value${signClass(sale.net)}">${formatSignedMio(sale.net)}</span>
          <span class="pd-cell-note">Erlös minus Kreditlinie</span>
        </span>
        <span class="pd-cell">
          <span class="pd-cell-label">Rahmen danach</span>
          <span class="pd-cell-value${signClass(sale.headroomAfter)}">${formatMio(sale.headroomAfter)}</span>
          <span class="pd-cell-note">jetzt ${formatMio(sale.headroomNow)}</span>
        </span>
      </div>
      ${eleven}
    </section>
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
        </div>
      </section>
    </div>
  `;
}
