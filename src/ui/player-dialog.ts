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

import type {
  PerformanceMatchday,
  PerformanceSeason,
  PlayerId,
  PlayerPerformance,
  PositionCode,
} from '../api/types.js';
import type { ScoreDetail } from '../compute/optimizer.js';
import {
  gradeOf,
  matchdaysBySlot,
  pickSeasons,
  seasonStats,
  type SeasonStats,
} from '../compute/performance.js';
import type { MarketListing, PositionLabel } from '../compute/planning.js';
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
  /** 0 heißt einsatzbereit, alles andere ist ein Ausfall. */
  status: number;
  marketValue: number;
  saleValue: number;
  /** "G/V seit Kauf" laut Kickbase. */
  mvgl: number;
  /** Score und Teilwerte, null solange kein Lauf durch ist. */
  score: { score: number; detail: ScoreDetail } | null;
  /** Das eigene Angebot im Transfermarkt, null wenn er nicht drin steht. */
  listing: MarketListing | null;
  /** Das höchste fremde Gebot, 0 wenn keins vorliegt. */
  bestOffer: number;
  insight: PlayerInsight;
  /** Punkte je Spieltag, ganz unten im Dialog. */
  performance: PerformanceView;
  /**
   * Steht er im eigenen Kader? Nur dann ergibt "Wenn du verkaufst" einen
   * Sinn — bei einem Transferkandidaten, auf den nur ein Gebot liegt, gehört
   * er noch niemandem, ein Verkaufserlös wäre erfunden.
   */
  isOwned: boolean;
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
 * Ab wann die Tabelle etwas taugt. Nach ein, zwei Spieltagen steht ein
 * Aufsteiger auf Platz 2 und der Meister auf 15: Platz und Pfeil wären dann
 * eine Aussage über nichts. Bis dahin bleiben beide Zeilen leer.
 */
const TABLE_COUNTS_FROM = 3;

/**
 * Anstossdatum als Fuß der Kachel, etwa "22. Aug.". Leer, wenn kein
 * Zeitstempel vorliegt.
 */
function dateShort(kickoff: string): string {
  if (!kickoff) return '';
  const date = new Date(kickoff);
  if (Number.isNaN(date.getTime())) return '';
  const month = MONTHS[date.getMonth()];
  return month ? `${date.getDate()}. ${month}` : '';
}

/** Anstosszeit, etwa "15:30". Leer, wenn kein Zeitstempel vorliegt. */
function timeShort(kickoff: string): string {
  if (!kickoff) return '';
  const date = new Date(kickoff);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Wie viele Spieltage die Tabelle schon zählt. Der nächste angesetzte Spieltag
 * sagt es genauer als die Zahl der Kacheln: die Punkte reichen nur so weit
 * zurück, wie Kickbase sie führt. Ohne Ansetzung zählt der letzte gespielte.
 */
function countedDays(past: readonly MatchdayEntry[], ahead: readonly MatchdayEntry[]): number {
  const next = ahead[0]?.day ?? 0;
  if (next > 0) return next - 1;
  return past[past.length - 1]?.day ?? 0;
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

/** Dieselbe Ampel als Schriftfarbe, für die große Zahl. */
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
 * Dasselbe Zeichen wie in der Gegner-Spalte der Tabelle: hoch heißt
 * schwacher Gegner, runter heißt starker. Das Mittelfeld bekommt nichts:
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
          <img class="pd-photo" src="${escapeHtml(photo)}" alt="" loading="eager" decoding="sync">
          <img class="pd-crest" src="${escapeHtml(teamLogoUrl(input.teamId))}" alt="" width="30" height="30">
        </span>
        <span class="pd-ident-text">
          <span class="pd-name">${escapeHtml(fullName)}</span>
          <span class="pd-tags">
            <span class="chip chip--pos${input.position}">${input.positionLabel}</span>
            <span class="pd-club">${escapeHtml(club)}</span>
            <span class="pd-status${fit ? '' : ' pd-status--out'}" title="${escapeHtml(statusTitle)}" aria-label="${escapeHtml(statusTitle)}"></span>
            ${renderNewsLink(fullName, club, fit ? '' : input.statusText)}
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
      ${renderMarket(input)}
    </header>
  `;
}

/**
 * Das eigene Angebot im Transfermarkt, eine Zeile unter den Beträgen. Sie
 * steht nur da, wenn er wirklich drin steht: der aufgerufene Preis, sein
 * Abstand zum Marktwert und, falls Kickbase eine nennt, die Restlaufzeit.
 *
 * Liegen Gebote, führt der Knopf rechts in den Gebotsdialog. Er trägt
 * dasselbe `data-offers` wie der Betrag in der Tabelle, `wireModal` in
 * `planning-page.ts` hängt sich daran.
 */
function renderMarket(input: PlayerDialogInput): string {
  const listing = input.listing;
  if (!listing) return '';

  const overMarket = listing.price - input.marketValue;
  // Ohne eigenen Preis meldet Kickbase den Marktwert. Dann steht das auch da:
  // "aufgerufen 25,62" liest sich sonst wie eine Entscheidung.
  const price =
    overMarket === 0
      ? 'zum Marktwert'
      : `aufgerufen ${formatMio(listing.price)} (${formatSignedMio(overMarket)})`;
  const count = listing.offerCount;
  const offersBtn =
    count > 0
      ? `<button type="button" class="pd-market-offers" data-offers="${escapeHtml(input.playerId)}"
                 title="Alle Gebote ansehen">${count === 1 ? '1 Gebot' : `${count} Gebote`} · ${formatMio(input.bestOffer)}</button>`
      : '';

  const remaining = remainingLabel(listing.expiresInSeconds);
  const parts = [price, ...(remaining ? [remaining] : [])]
    .map((part) => `<span>${part}</span>`)
    .join(' · ');

  return `
      <div class="pd-market">
        <span class="pd-market-dot" aria-hidden="true"></span>
        <span class="pd-market-text"><b>Im Markt</b> · ${parts}</span>
        ${offersBtn}
      </div>
  `;
}

/**
 * Restlaufzeit in Worten, leer wenn keine bekannt ist.
 *
 * Zu eigenen Angeboten liefert Kickbase kein `exs`, und richtig so: sie laufen
 * nicht ab, sondern stehen, bis man sie zurückzieht oder ein Gebot annimmt.
 * Die Zeile lässt die Angabe dann weg, statt "abgelaufen" zu behaupten.
 *
 * Unter einer Stunde steht keine Zahl mehr da: der Wert stammt aus der letzten
 * Marktabfrage und läuft nicht mit, "noch 12 min" wäre nach zwölf Minuten
 * Ansehens falsch.
 */
function remainingLabel(seconds: number): string {
  if (seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  if (hours < 1) return 'läuft bald ab';
  if (hours < 24) return `noch ${hours} h`;
  // Abgerundet, nicht gerundet: aus 36 Stunden würden sonst "noch 2 Tage",
  // und die Angabe verspräche mehr Zeit, als das Angebot hat.
  const days = Math.floor(hours / 24);
  return days === 1 ? 'noch 1 Tag' : `noch ${days} Tage`;
}

/**
 * Suche nach Nachrichten zum Spieler.
 *
 * Kein Deep-Link: Ligainsider und Kicker haben keine Adresse, die sich aus
 * Namen bauen ließe, und eine gepflegte Zuordnung wäre bei jedem Wechsel
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
             title="${escapeHtml(title)}">News</a>`;
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
 * durch eine feine Linie. Beide Hälften sind gleich gebaut: Nummer, Wappen,
 * Ort, kleine Zeile, Hauptzahl mit Einheit, unten das Anstossdatum. Links ist
 * die Hauptzahl die Punkte, rechts der Tabellenplatz des Gegners.
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
  // Solange die Tabelle nichts aussagt, bleiben Platz und Pfeil weg.
  const ranked = countedDays(past, ahead) >= TABLE_COUNTS_FROM;

  /*
   * Eine Kachel je Spieltag, gespielt und geplant gleich gebaut: Nummer oben,
   * darunter das Wappen mit dem Ort rechts und der Einschätzung links, dann
   * das Ergebnis, die Hauptzahl mit ihrer Einheit, ganz unten das Datum.
   *
   * `start` schiebt die erste gespielte Kachel im Raster nach rechts, damit
   * eine halb volle Vergangenheit an der Linie steht und nicht am Rand.
   */
  const cell = (day: MatchdayEntry, start = 0): string => {
    const number = day.day > 0 ? String(day.day) : '&nbsp;';
    const place = start > 1 ? ` style="grid-column-start:${start}"` : '';
    const date = dateShort(day.kickoff) || '&nbsp;';

    const crest = day.opponentId
      ? `<img class="pd-day-crest" src="${escapeHtml(teamLogoUrl(day.opponentId))}" alt="" width="22" height="22">`
      : '<span class="pd-day-crest pd-day-crest--none" aria-hidden="true"></span>';
    const venue = day.home === null
      ? ''
      : `<span class="pd-venue${day.home ? '' : ' pd-venue--away'}">${day.home ? 'H' : 'A'}</span>`;
    // Die Einschätzung sitzt links am Wappen, spiegelbildlich zum Ort. Beides
    // gehört zum Gegner, deshalb hängt beides an seinem Wappen.
    const glyph = day.ahead && ranked ? trendGlyph(day) : '';
    const trend = glyph
      ? `<span class="pd-trend ${trendClass(day)}" aria-label="${trendLabel(day)}">${glyph}</span>`
      : '';
    const badge = `<span class="pd-day-badge">${crest}${trend}${venue}</span>`;

    if (day.ahead) {
      const position = ranked && day.opponentPosition > 0 ? String(day.opponentPosition) : '';
      const title = `${escapeHtml(day.opponentName ?? 'Gegner unbekannt')}, `
        + `${day.home ? 'zu Hause' : 'auswärts'}, Spieltag ${day.day}`
        + (ranked ? `, ${trendLabel(day)}` : '');
      return `
        <span class="pd-day pd-day--ahead"${place} title="${title}">
          <span class="pd-day-num">${number}</span>
          ${badge}
          <span class="pd-day-note">&nbsp;</span>
          <span class="pd-day-main">${position || '&nbsp;'}</span>
          <span class="pd-day-unit">${position ? 'Platz' : '&nbsp;'}</span>
          <span class="pd-day-date">${date}</span>
        </span>
      `;
    }

    // Der laufende Spieltag vor dem Anpfiff: statt Punkten die Anstosszeit,
    // und nicht gedämpft, denn "kein Einsatz" wäre die falsche Aussage.
    const clock = day.pending ? timeShort(day.kickoff) : '';
    const scoreline = day.goalsFor === null
      ? '&nbsp;'
      : `${day.goalsFor}:${day.goalsAgainst}`;
    const title = `Spieltag ${number}`
      + (day.opponentName ? `, gegen ${escapeHtml(day.opponentName)}` : '')
      + (day.played ? `, ${day.points} Punkte` : day.pending ? ', steht noch aus' : ', nicht gespielt');
    return `
      <span class="pd-day${day.played || day.pending ? '' : ' pd-day--out'}"${place} title="${title}">
        <span class="pd-day-num">${number}</span>
        ${badge}
        <span class="pd-day-note ${resultClass(day)}">${scoreline}</span>
        <span class="pd-day-main${clock ? ' pd-day-main--clock' : ''}">${day.played ? day.points : clock || '&middot;'}</span>
        <span class="pd-day-unit">${day.played ? 'Punkte' : clock ? 'Uhr' : '&nbsp;'}</span>
        <span class="pd-day-date">${date}</span>
      </span>
    `;
  };

  const shown = past.slice(-PAST_SLOTS);
  const pastCells = shown.length > 0
    ? shown.map((day, i) => cell(day, i === 0 ? PAST_SLOTS - shown.length + 1 : 0)).join('')
    : '<span class="pd-note">Noch keine Spieltage</span>';
  const aheadCells = ahead.length > 0
    ? ahead.slice(0, AHEAD_SLOTS).map((day) => cell(day)).join('')
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
        H Heim, A auswärts.${ranked ? ' Pfeil hoch heißt schwacher Gegner, runter starker.' : ''}
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
          <span class="pd-cell-label">Spielraum danach</span>
          <span class="pd-cell-value${signClass(sale.headroomAfter)}">${formatMio(sale.headroomAfter)}</span>
          <span class="pd-cell-note">jetzt ${formatMio(sale.headroomNow)}</span>
        </span>
      </div>
      ${eleven}
    </section>
  `;
}

// ---------- Punkte je Spieltag ----------

export interface PerformanceView {
  /** Alle Saisons, die Kickbase zu ihm führt. null, solange nichts da ist. */
  performance: PlayerPerformance | null;
  /** Die Saison, die offen steht. */
  seasonId: string | null;
  /** Läuft gerade eine Anfrage? Nur für den Text, solange nichts da ist. */
  isLoading: boolean;
  /** Angetippter Spieltag, null wenn keiner. */
  selectedDay: number | null;
}

/**
 * Höhe des höchsten Balkens in px. Die Fläche darüber steht in `planning.css`
 * und ist zwei Punkte höher, damit auch der höchste Balken noch Luft hat.
 */
const PERF_BAR = 42;

/**
 * Die Saison als zwei Reihen zu 17 Spieltagen. Zwei Reihen, weil eine Spalte
 * damit 18 statt 8 px breit wird: erst so ist Platz für das Wappen des
 * Gegners und die Punktzahl darunter.
 */
function renderPerformance(view: PerformanceView): string {
  const seasons = view.performance?.seasons ?? [];
  const season = seasons.find((entry) => entry.id === view.seasonId) ?? null;

  return `
    <section class="pd-section">
      <h3 class="pd-section-title">Punkte je Spieltag</h3>
      ${renderSeasonTabs(view)}
      ${season ? renderSeason(season, view.selectedDay) : renderPerformanceEmpty(view)}
    </section>
  `;
}

/**
 * Der Umschalter. Er steht nur da, wenn es etwas umzuschalten gibt: führt
 * Kickbase nur eine Saison, wäre ein Reiter ohne Gegenstück eine Attrappe.
 */
function renderSeasonTabs(view: PerformanceView): string {
  const { current, previous } = pickSeasons(view.performance);
  if (!current || !previous) return '';
  const tab = (season: PerformanceSeason, label: string): string => `
    <button type="button" data-season-tab="${escapeHtml(season.id)}"
            aria-pressed="${season.id === view.seasonId}"
            title="${escapeHtml(season.title)}">${label}</button>
  `;
  return `<div class="pd-tabs">${tab(current, 'Aktuelle Saison')}${tab(previous, 'Letzte Saison')}</div>`;
}

function renderPerformanceEmpty(view: PerformanceView): string {
  return perfPlaceholder(view.isLoading ? 'Punkte werden geladen…' : 'Keine Punkte bekannt.');
}

/*
 * Steht nichts an, bleibt die Fläche trotzdem stehen und der Satz sitzt in
 * ihrer Mitte. Sonst klappt der Dialog beim Umschalten der Saison zusammen und
 * alles darunter springt.
 */
function perfPlaceholder(text: string): string {
  return `<p class="pd-empty pd-perf-empty">${text}</p>`;
}

function renderSeason(season: PerformanceSeason, selectedDay: number | null): string {
  const stats = seasonStats(season);
  if (stats.played === 0) {
    // Ohne den Punkt am Ende: "28. Aug." trägt schon einen.
    const first = nextKickoff(season).replace(/\.$/, '');
    const hint = first ? ` Der erste ist am ${first}.` : '';
    return perfPlaceholder(`Noch kein Spieltag gespielt.${hint}`);
  }

  const slots = matchdaysBySlot(season);
  const half = Math.ceil(slots.length / 2);

  return `
    ${renderSeasonStats(stats)}
    <div class="pd-perf-halves">
      ${renderHalf(slots, 0, half, stats, selectedDay)}
      ${renderHalf(slots, half, slots.length, stats, selectedDay)}
    </div>
    <p class="pd-legend">
      Ein Tipp auf einen Spieltag zeigt Ergebnis und Minuten. Graue Stummel
      sind Spieltage ohne Einsatz, rote Minuspunkte.${switchNote(season)}
    </p>
  `;
}

/**
 * Der Satz zum Wechsel-Strich, nur wenn es ihn in dieser Saison gibt: unter
 * einem Spieler, der nie gewechselt hat, erklärte er ein Zeichen, das
 * nirgends steht.
 */
function switchNote(season: PerformanceSeason): string {
  const clubs = new Set(season.matchdays.map((day) => day.teamId));
  return clubs.size > 1 ? ' Der senkrechte Strich markiert den Vereinswechsel.' : '';
}

function renderSeasonStats(stats: SeasonStats): string {
  return `
    <p class="pd-perf-stats">
      <b>${NUMBER.format(stats.total)}</b> Punkte
      <span>·</span> <b>Ø ${stats.average}</b>
      <span>·</span> <b>${stats.played}</b> von ${stats.days} Einsätzen
    </p>
  `;
}

/**
 * Eine Reihe. Die Beschriftung trägt die Vereine dieser Hälfte: bei einem
 * Wechsel stehen dort zwei Wappen, und der Strich in der Reihe sagt, ab wann
 * das zweite gilt.
 */
function renderHalf(
  slots: (PerformanceMatchday | null)[],
  from: number,
  to: number,
  stats: SeasonStats,
  selectedDay: number | null,
): string {
  const part = slots.slice(from, to);
  const clubs = [
    ...new Set(
      part
        .filter((day): day is PerformanceMatchday => day !== null)
        .map((day) => day.teamId),
    ),
  ];
  const crests = clubs
    .map((id) => `<img src="${escapeHtml(teamLogoUrl(id))}" alt="" width="12" height="12">`)
    .join('');
  const columns = part
    .map((day, index) => renderPerfColumn(day, slots[from + index - 1] ?? null, stats, selectedDay))
    .join('');
  return `
    <div>
      <p class="pd-perf-half-label">Spieltag ${from + 1} bis ${to}${crests}</p>
      <div class="pd-perf-half" style="--perf-cols:${part.length}">${columns}</div>
    </div>
  `;
}

function renderPerfColumn(
  day: PerformanceMatchday | null,
  previous: PerformanceMatchday | null,
  stats: SeasonStats,
  selectedDay: number | null,
): string {
  const grade = gradeOf(day, stats.average);
  const height = perfBarHeight(day, stats);
  // Der Wechsel gehört an den ersten Spieltag beim neuen Verein.
  const switched = day !== null && previous !== null && previous.teamId !== day.teamId;
  const crest = day
    ? `<img class="pd-perf-crest" src="${escapeHtml(teamLogoUrl(day.opponentId))}" alt="" width="15" height="15">`
    : '<span class="pd-perf-crest"></span>';
  const points = day === null || day.points === null
    ? '<span class="pd-perf-num">&nbsp;</span>'
    : `<span class="pd-perf-num">${day.points}</span>`;
  const classes = ['pd-perf-col', `pd-perf-col--${grade}`, switched ? 'pd-perf-col--switch' : '']
    .filter(Boolean)
    .join(' ');
  const body = `
      <span class="pd-perf-bars"><span class="pd-perf-bar" style="height:${height}px"></span></span>
      ${crest}
      ${points}
  `;

  // Ein Spieltag, den es in den Daten nicht gibt, ist nichts zum Antippen:
  // als Knopf trüge er einen Zeiger, hinter dem nichts passiert.
  if (day === null) {
    return `<span class="${classes}" title="${perfTitle(day)}">${body}</span>`;
  }

  // Die Sprechblase zum angetippten Spieltag hängt an seiner Spalte und liegt
  // über dem Inhalt: die Abschnittshöhe bleibt gleich. Läuft sie seitlich aus
  // dem Dialog, schiebt `wireModal` sie über --callout-shift zurück.
  const callout = day.day === selectedDay
    ? `<span class="pd-perf-callout">${renderPerfCallout(day)}</span>`
    : '';

  return `
    <button type="button" class="${classes}" data-perf-day="${day.day}"
            aria-pressed="${day.day === selectedDay}"
            title="${perfTitle(day)}">${body}${callout}</button>
  `;
}

/**
 * Ein Spieltag ohne Einsatz bekommt einen Stummel, Minuspunkte auch: ohne ihn
 * wäre die Spalte leer und sähe aus wie ein Spieltag, den es nicht gab.
 */
function perfBarHeight(day: PerformanceMatchday | null, stats: SeasonStats): number {
  if (day === null) return 0;
  if (day.points === null) return 3;
  if (day.points < 0) return 4;
  return Math.max(3, Math.round((day.points / stats.max) * PERF_BAR));
}

function perfTitle(day: PerformanceMatchday | null): string {
  if (day === null) return 'Kein Spieltag';
  const points = day.points === null ? 'nicht gespielt' : `${day.points} Punkte`;
  return `Spieltag ${day.day}, ${points}`;
}

function renderPerfCallout(day: PerformanceMatchday): string {
  const result = `${day.goalsFor}:${day.goalsAgainst}`;
  const tail = day.points === null
    ? '<span>·</span> nicht im Kader'
    : `<span>·</span> ${day.minutes}′ <span>·</span> <b>${day.points}</b> Punkte`;
  return `
    Spieltag <b>${day.day}</b>
    <img src="${escapeHtml(teamLogoUrl(day.teamId))}" alt="" width="16" height="16">
    <b>${result}</b>
    <img src="${escapeHtml(teamLogoUrl(day.opponentId))}" alt="" width="16" height="16">
    ${tail}
  `;
}

/** Anstoß des ersten noch nicht gespielten Spieltags, für die leere Saison. */
function nextKickoff(season: PerformanceSeason): string {
  for (const day of season.matchdays) {
    const text = dateShort(day.kickoff);
    if (text) return text;
  }
  return '';
}

const NUMBER = new Intl.NumberFormat('de-DE');

/**
 * Das ganze Overlay. Trägt `data-dialog-shade` und `data-dialog-close`, damit
 * `wireModal` in `planning-page.ts` es ohne Sonderfall schließen kann.
 */
export function renderPlayerDialog(input: PlayerDialogInput): string {
  return `
    <div class="dialog-shade" data-dialog-shade tabindex="-1">
      <section class="dialog-box pd-box" role="dialog" aria-modal="true" aria-label="${escapeHtml(input.name)}">
        ${renderHead(input)}
        <div class="dialog-body pd-body">
          ${renderScore(input)}
          ${renderMatchdays(input.insight)}
          ${input.isOwned ? renderSale(input.insight) : ''}
          ${renderPerformance(input.performance)}
        </div>
      </section>
    </div>
  `;
}
