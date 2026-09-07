/**
 * Statistik: die Manager-Rangliste der Liga, in drei Reitern.
 *
 *   - Ich: Platz und Punkte, je Spieltag der eigene Balken vor dem des
 *     Ligabesten, drei Kennzahlen.
 *   - Saison: Podium und Meilensteine der Saison.
 *   - Tabelle: Manager mal Spieltage als Kreuztabelle, Gesamt vorn, dann die
 *     Spieltage absteigend, der jüngste zuerst.
 *
 * Die Ebene liegt wie die Aufstellung über dem Kaderplaner und hängt an
 * `document.body`. Anders als die Aufstellung holt sie ihre Daten selbst:
 * erst `ranking`, damit stehen Platz und Gesamttabelle sofort; dann je
 * Manager die Punkte je Spieltag, bis dahin steht ein Platzhalter. Beides
 * liegt danach eine Stunde im Cache, siehe `state/stats.ts`.
 */

import { KickbaseClient, KickbaseError } from '../api/kickbase.js';
import type { LeagueId, LeagueRanking, ManagerPerformance } from '../api/types.js';
import {
  buildLeagueSeason,
  dayStandings,
  gradeOfDay,
  milestones,
  MILESTONES_FROM,
  myFigures,
  rangesOf,
  standings,
  standingsBetween,
  type DayRange,
  type LeagueSeason,
  type RangeKey,
  type SeasonManager,
} from '../compute/stats.js';
import { isFresh, loadStats, saveStats } from '../state/stats.js';
import { escapeHtml, managerImageUrl } from './format.js';

export interface StatsPageProps {
  client: KickbaseClient;
  leagueId: LeagueId;
  /** Anstoß je Verein und Spieltag aus dem Score-Lauf, null ohne Lauf. */
  kickoffs: Record<string, Record<number, string>> | null;
  onClose: () => void;
  /** Kickbase hat das Token verworfen. Die Ebene schließt sich vorher selbst. */
  onUnauthorized: () => void;
}

export type StatsTab = 'ich' | 'saison' | 'tabelle';

const TABS: readonly { key: StatsTab; label: string }[] = [
  { key: 'ich', label: 'Ich' },
  { key: 'saison', label: 'Saison' },
  { key: 'tabelle', label: 'Tabelle' },
];

const NUMBER = new Intl.NumberFormat('de-DE');
const num = (value: number): string => NUMBER.format(value);

export class StatsPage {
  private readonly props: StatsPageProps;
  private readonly layer: HTMLElement;
  private tab: StatsTab = 'ich';
  /**
   * Welche Halbserie die Balken zeigen. `null` heißt: die mit dem laufenden
   * Spieltag. Sobald der Nutzer umschaltet, bleibt seine Wahl stehen.
   */
  private half: 0 | 1 | null = null;
  /** Angetippter Spieltag im Reiter Ich, null wenn keiner. */
  private selectedDay: number | null = null;
  /**
   * Bereich der Tabelle: Gesamt, Hinrunde oder Rückrunde. `null` heißt: die
   * Runde mit dem laufenden Spieltag. Sobald der Nutzer umschaltet, bleibt
   * seine Wahl stehen.
   */
  private range: RangeKey | null = null;
  private userId = '';
  private ranking: LeagueRanking | null = null;
  private performances: Record<string, ManagerPerformance> = {};
  private season: LeagueSeason | null = null;
  private loading = false;
  private error: string | null = null;
  private closed = false;

  constructor(props: StatsPageProps) {
    this.props = props;
    this.layer = document.createElement('div');
    this.layer.className = 'stats-layer';
    this.layer.tabIndex = -1;
  }

  open(): void {
    document.body.appendChild(this.layer);
    document.body.classList.add('is-stats-open');
    this.wire();
    const fresh = this.restore();
    this.render();
    this.layer.focus();
    if (!fresh) void this.fetch();
  }

  close(): void {
    this.closed = true;
    document.body.classList.remove('is-stats-open');
    this.layer.remove();
    this.props.onClose();
  }

  // ---------- Daten ----------

  /** Den Cache übernehmen, auch einen alten: besser als leere Kacheln. */
  private restore(): boolean {
    const entry = loadStats(this.props.leagueId);
    if (!entry) return false;
    this.userId = entry.userId;
    this.ranking = entry.ranking;
    this.performances = entry.performances;
    this.rebuild();
    return isFresh(entry);
  }

  private rebuild(): void {
    this.season = this.ranking
      ? buildLeagueSeason({
          ranking: this.ranking,
          performances: this.performances,
          userId: this.userId,
          kickoffs: this.props.kickoffs,
          now: Date.now(),
        })
      : null;
  }

  private async fetch(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.error = null;
    this.render();
    try {
      const { client, leagueId } = this.props;
      const userId = this.userId || (await client.getMe()).id;
      const ranking = await client.getLeagueRanking(leagueId);
      if (this.closed) return;
      // Die Liste steht schon, die Historie kommt nach: so ist die Ebene
      // nicht leer, während je Manager eine Anfrage läuft.
      this.userId = userId;
      this.ranking = ranking;
      this.render();

      const list = await Promise.all(
        ranking.managers.map((m) => client.getManagerPerformance(leagueId, m.id)),
      );
      if (this.closed) return;
      const performances: Record<string, ManagerPerformance> = {};
      ranking.managers.forEach((m, i) => {
        const performance = list[i];
        if (performance) performances[m.id] = performance;
      });
      this.performances = performances;
      saveStats(leagueId, { userId, ranking, performances });
      this.rebuild();
    } catch (cause) {
      if (cause instanceof KickbaseError && cause.isUnauthorized) {
        this.close();
        this.props.onUnauthorized();
        return;
      }
      this.error = cause instanceof Error ? cause.message : 'Unbekannter Fehler';
    } finally {
      this.loading = false;
      if (!this.closed) this.render();
    }
  }

  // ---------- Ereignisse ----------

  private wire(): void {
    this.layer.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target === this.layer || target.closest('[data-close]')) {
        this.close();
        return;
      }
      const tab = target.closest<HTMLElement>('[data-tab]');
      if (tab) {
        const key = tab.dataset['tab'];
        if (key === 'ich' || key === 'saison' || key === 'tabelle') this.tab = key;
        this.render();
        return;
      }
      const side = target.closest<HTMLElement>('[data-half]');
      if (side) {
        this.half = side.dataset['half'] === '1' ? 1 : 0;
        this.render();
        return;
      }
      const pick = target.closest<HTMLButtonElement>('[data-range]');
      if (pick && !pick.disabled) {
        const key = pick.dataset['range'];
        if (key === 'gesamt' || key === 'hin' || key === 'rueck') this.range = key;
        this.render();
        return;
      }
      // Ein zweiter Tipp auf denselben Spieltag schließt die Blase wieder.
      const bar = target.closest<HTMLElement>('[data-day]');
      if (bar) {
        const day = Number(bar.dataset['day']);
        this.selectedDay = this.selectedDay === day ? null : day;
        this.render();
        return;
      }
      if (target.closest('[data-retry]')) void this.fetch();
    });
    this.layer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
    // Ein fehlendes Profilbild antwortet das CDN mit 403. `error` steigt nicht
    // auf, deshalb in der Erfassungsphase mithören und Initialen zeigen.
    this.layer.addEventListener(
      'error',
      (event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement) || !img.classList.contains('st-avatar')) return;
        const span = document.createElement('span');
        span.className = img.className + ' st-avatar--initials';
        span.textContent = initialsOf(img.dataset['name'] ?? '');
        img.replaceWith(span);
      },
      true,
    );
  }

  // ---------- Darstellung ----------

  private render(): void {
    // Die Kreuztabelle blättert seitwärts; ein Neuaufbau soll die Stelle halten.
    const matrixScroll = this.layer.querySelector<HTMLElement>('.st-matrix-scroll')?.scrollLeft ?? 0;
    const tabs = TABS.map(
      (t) =>
        `<button type="button" class="stats-tab" data-tab="${t.key}"
                 aria-pressed="${t.key === this.tab}">${t.label}</button>`,
    ).join('');
    const body =
      this.tab === 'ich' ? this.renderMe() : this.tab === 'saison' ? this.renderSeason() : this.renderTable();

    this.layer.innerHTML = `
      <div class="stats-sheet" role="dialog" aria-label="Statistik">
        <header class="stats-head">
          <h2>Statistik</h2>
          <button type="button" class="dialog-close" data-close aria-label="Schließen">×</button>
          <div class="stats-tabs pd-tabs">${tabs}</div>
        </header>
        ${body}
      </div>
    `;
    const scroller = this.layer.querySelector<HTMLElement>('.st-matrix-scroll');
    if (scroller) scroller.scrollLeft = matrixScroll;
    placeCallout(this.layer);
    pinColumns(this.layer);
  }

  /** Platzhalter, solange die Historie fehlt: lädt, Fehler, oder gar nichts. */
  private pending(): string {
    if (this.error) {
      return `<p class="st-placeholder st-note--error">${escapeHtml(this.error)}
        <button type="button" class="st-retry" data-retry>Erneut versuchen</button></p>`;
    }
    if (this.loading) return '<p class="st-placeholder">Punkte je Spieltag werden geladen…</p>';
    return '<p class="st-placeholder">Keine Punkte bekannt.</p>';
  }

  /**
   * Die Halbserie, die gezeigt wird: die Wahl des Nutzers, sonst die mit dem
   * laufenden Spieltag. Vor dem ersten Spieltag ist das die Hinrunde.
   */
  private shownHalf(season: LeagueSeason): 0 | 1 {
    if (this.half !== null) return this.half;
    return Math.max(1, season.playedDays) > halfSize(season) ? 1 : 0;
  }

  /**
   * Der Bereich der Tabelle: die Wahl des Nutzers, sonst die laufende Runde,
   * wie bei den Balken. Ein Bereich ohne gespielten Spieltag fällt auf
   * Gesamt zurück.
   */
  private shownRange(season: LeagueSeason, ranges: readonly DayRange[]): DayRange {
    const wanted = this.range ?? (this.shownHalf(season) === 1 ? 'rueck' : 'hin');
    return ranges.find((r) => r.key === wanted && r.played.length > 0) ?? ranges[0]!;
  }

  private renderMe(): string {
    const season = this.season;
    if (!season) {
      const hero = this.ranking ? heroFromRanking(this.ranking, this.userId) : '';
      return `${hero}${sectionHead('Deine Spieltage', 'grau: bester der Liga')}${this.pending()}`;
    }
    const me = myFigures(season);
    if (!me) {
      return `<p class="st-placeholder">Du bist in dieser Rangliste nicht dabei.</p>`;
    }
    const half = this.shownHalf(season);
    return `
      ${hero(me.place, me.total, me.gapToFirst, me.leadOverSecond, season.managers.length, season.playedDays, season.dayCount, me.manager)}
      ${sectionHead('Deine Spieltage', 'grau: bester der Liga')}
      ${renderHalfSwitch(half)}
      ${renderBars(season, me, half, this.selectedDay)}
      <div class="st-figures">
        <span class="st-fig"><span>Ø PUNKTE</span><b>${num(me.average)}</b></span>
        <span class="st-fig"><span>SPIELTAGSSIEGE</span><b>${me.wins}</b></span>
        ${lostOrAhead(me.place, me.gapToFirst, me.leadOverSecond)}
      </div>
      ${openNote(season, 'Dein Balken dort ist schraffiert; Kennzahlen und Meilensteine zählen ihn erst, wenn er durch ist.')}
    `;
  }

  private renderSeason(): string {
    const season = this.season;
    if (!season) return `${sectionHead('Saison', '')}${this.pending()}`;
    const rows = standings(season);
    const head = sectionHead(`Saison ${escapeHtml(season.title)}`, `nach Spieltag ${season.playedDays} von ${season.dayCount}`);
    const stones = milestones(season);
    const cards = stones
      ? renderMilestones(stones)
      : `<p class="st-placeholder">Meilensteine gibt es ab Spieltag ${MILESTONES_FROM}.</p>`;
    return `
      ${head}
      ${renderPodium(rows)}
      ${sectionHead('Meilensteine', stones ? `${stones.countedDays} gewertete Spieltage` : '')}
      ${cards}
      ${openNote(season, 'Er zählt in Podium und Meilensteine erst, wenn er durch ist.')}
    `;
  }

  private renderTable(): string {
    const season = this.season;
    if (!season) {
      if (!this.ranking) return `${sectionHead('Rangliste', '')}${this.pending()}`;
      return `
        ${sectionHead('Rangliste', 'Stand jetzt')}
        ${matrixFromRanking(this.ranking, this.userId)}
        <p class="st-note">${this.error ? escapeHtml(this.error) : 'Die Spieltage kommen, sobald die Punkte je Spieltag geladen sind.'}
          ${this.error ? '<button type="button" class="st-retry" data-retry>Erneut versuchen</button>' : ''}</p>
      `;
    }
    const ranges = rangesOf(season);
    const current = this.shownRange(season, ranges);
    const played = current.played;
    const first = played[0] ?? 0;
    const last = played[played.length - 1] ?? 0;
    const title = played.length === 0
      ? 'Noch kein Spieltag'
      : played.length === 1 ? `Spieltag ${first}` : `Spieltage ${first} bis ${last}`;
    const hint = played.length > 1
      ? ' Grün ist der Spieltagssieg, Δ der Rückstand auf Platz 1, seitwärts blättern zeigt die übrigen Spieltage.'
      : ' Grün ist der Spieltagssieg.';
    const note = season.openDay && played.includes(season.openDay)
      ? openNote(season, 'Spalte und Gesamtsumme sind so lange vorläufig.' + hint)
      : `<p class="st-note">${hint.trim()}</p>`;
    return `
      ${renderRangeTabs(ranges, current.key)}
      ${sectionHead(title, `Saison ${escapeHtml(season.title)}`)}
      ${matrix(season, current)}
      ${note}
    `;
  }
}

/** Gesamt, Hinrunde, Rückrunde als Textreiter; ohne gespielten Spieltag ausgegraut. */
function renderRangeTabs(ranges: readonly DayRange[], active: RangeKey): string {
  const buttons = ranges.map((r) =>
    `<button type="button" data-range="${r.key}" aria-pressed="${r.key === active}"${r.played.length ? '' : ' disabled'}>${r.label}</button>`,
  ).join('');
  return `<div class="st-range">${buttons}</div>`;
}

/**
 * Manager, Gesamt und Δ bleiben beim Blättern stehen. Die Abstände der
 * zweiten und dritten Spalte hängen an der Breite der Namensspalte und werden
 * deshalb nach dem Zeichnen gemessen, siehe `.st-col-total` in stats.css.
 */
function pinColumns(layer: HTMLElement): void {
  const table = layer.querySelector<HTMLElement>('.st-matrix');
  const name = table?.querySelector<HTMLElement>('th.st-col-name');
  const total = table?.querySelector<HTMLElement>('th.st-col-total');
  if (!table || !name || !total) return;
  table.style.setProperty('--name-w', `${name.offsetWidth}px`);
  table.style.setProperty('--total-w', `${total.offsetWidth}px`);
}

// ---------- Bausteine ----------

function sectionHead(title: string, sub: string, gap = false): string {
  return `<div class="st-section-head${gap ? ' st-section-head--gap' : ''}">
    <span class="st-title">${title}</span><span class="st-sub">${sub}</span></div>`;
}

/**
 * Der Rückstand auf Platz 1. Wer selbst vorn liegt, sieht stattdessen den
 * Vorsprung auf den Zweiten: ein Rückstand von null sagte nur, dass man
 * vorn ist, nicht wie deutlich.
 */
function lostOrAhead(place: number, gapToFirst: number, leadOverSecond: number): string {
  if (place > 1) {
    return `<span class="st-fig"><span>AUF DEN BESTEN</span><b class="st-neg">-${num(gapToFirst)}</b></span>`;
  }
  if (leadOverSecond > 0) {
    return `<span class="st-fig"><span>VOR DEM ZWEITEN</span><b class="st-pos">+${num(leadOverSecond)}</b></span>`;
  }
  return '<span class="st-fig"><span>AUF DEN BESTEN</span><b>0</b></span>';
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function avatar(manager: { name: string; imagePath: string }, extra = ''): string {
  const cls = `st-avatar${extra ? ' ' + extra : ''}`;
  if (!manager.imagePath) {
    return `<span class="${cls} st-avatar--initials">${escapeHtml(initialsOf(manager.name))}</span>`;
  }
  return `<img class="${cls}" src="${escapeHtml(managerImageUrl(manager.imagePath))}"
               data-name="${escapeHtml(manager.name)}" alt="" loading="lazy" decoding="async">`;
}

function managerCell(manager: { name: string; imagePath: string }): string {
  return `<span class="st-manager">${avatar(manager)}<span class="st-name">${escapeHtml(manager.name)}</span></span>`;
}

function hero(
  place: number,
  total: number,
  gapToFirst: number,
  leadOverSecond: number,
  managerCount: number,
  playedDays: number,
  dayCount: number,
  manager: { name: string; imagePath: string },
): string {
  const gap = place === 1
    ? managerCount > 1
      ? `<span class="st-pos">+${num(leadOverSecond)}</span> auf Platz 2 · `
      : ''
    : `<span class="st-neg">-${num(gapToFirst)}</span> auf Platz 1 · `;
  return `
    <div class="st-hero">
      <span class="st-place">${place}.<small>PLATZ</small></span>
      <span class="st-hero-main"><b>${num(total)} Punkte</b>${gap}${managerCount} Manager · ST ${playedDays}/${dayCount}</span>
      ${avatar(manager, 'st-avatar--big')}
    </div>`;
}

/** Der Kopf aus der Rangliste allein, solange die Historie noch fehlt. */
function heroFromRanking(ranking: LeagueRanking, userId: string): string {
  const me = ranking.managers.find((m) => m.id === userId);
  if (!me) return '';
  const sorted = [...ranking.managers].sort((a, b) => b.seasonPoints - a.seasonPoints);
  const place = sorted.findIndex((m) => m.id === userId) + 1;
  const first = sorted[0]?.seasonPoints ?? 0;
  const second = sorted[1]?.seasonPoints ?? 0;
  return hero(
    place,
    me.seasonPoints,
    first - me.seasonPoints,
    place === 1 ? me.seasonPoints - second : 0,
    ranking.managers.length,
    0,
    0,
    me,
  ).replace(' · ST 0/0', '');
}

/** Spieltage je Halbserie. Bei ungerader Zahl bekommt die Hinrunde den mehr. */
function halfSize(season: LeagueSeason): number {
  return Math.ceil(season.dayCount / 2);
}

function renderHalfSwitch(half: 0 | 1): string {
  const button = (key: 0 | 1, label: string): string =>
    `<button type="button" data-half="${key}" aria-pressed="${key === half}">${label}</button>`;
  return `<div class="st-half">${button(0, 'Hinrunde')}${button(1, 'Rückrunde')}</div>`;
}

/**
 * Die Balken einer Halbserie. Alle ihre Spieltage stehen da, auch die noch
 * offenen: sonst steht am ersten Spieltag ein einzelner Balken in einer
 * leeren Fläche und man sieht nicht, wie viel Saison noch kommt. Offene Tage
 * bekommen einen flachen Stummel auf der Grundlinie.
 *
 * Der Maßstab kommt aus der gezeigten Halbserie, nicht aus der ganzen Saison.
 * Sonst drückt ein Ausreißer der anderen Hälfte alles hier klein.
 */
function renderBars(
  season: LeagueSeason,
  me: ReturnType<typeof myFigures> & object,
  half: 0 | 1,
  selectedDay: number | null,
): string {
  const size = halfSize(season);
  const from = half * size;
  const to = Math.min(season.dayCount, from + size);
  const best = (i: number): number => Math.max(0, ...season.managers.map((m) => m.points[i] ?? 0));
  const played = Array.from({ length: Math.max(0, Math.min(to, season.playedDays) - from) }, (_, i) => best(from + i));
  const scale = Math.max(1, ...played);
  const items: string[] = [];
  for (let i = from; i < to; i++) {
    const day = i + 1;
    if (day > season.playedDays) {
      items.push(`
        <span class="st-day st-day--empty" title="Spieltag ${day}: noch offen">
          <span class="st-rank"></span>
          <span class="st-stack"><span class="st-empty"></span></span>
          <span class="st-points"></span>
          <span class="st-daynum">${day}</span>
        </span>`);
      continue;
    }
    const mine = me.manager.points[i] ?? 0;
    const top = best(i);
    const place = me.dayPlaces[i] ?? 0;
    // Der angetippte Spieltag trägt seine Sprechblase, wie im Spielerdialog.
    const pressed = day === selectedDay;
    const callout = pressed ? renderCallout(season, day) : '';
    /*
     * Der laufende Spieltag: eine gestrichelte Säule in voller Höhe, darin
     * wächst der Balken. Ohne sie stand über einer leeren Spalte nur ein
     * Platz, und der sagt nichts, solange alle bei null stehen. Deshalb
     * bleiben Platz und Punkte hier weg, bis der Tag durch ist.
     */
    if (day === season.openDay) {
      items.push(`
        <button type="button" class="st-day st-day--live" data-day="${day}" aria-pressed="${pressed}"
                title="Spieltag ${day} läuft: ${num(mine)}, bester ${num(top)}">
          <span class="st-rank"></span>
          <span class="st-stack">
            <span class="st-live-frame"></span>
            <span class="st-mine st-mine--open" style="height:${Math.round((mine / scale) * 100)}%"></span>
          </span>
          <span class="st-points"></span>
          <span class="st-daynum">${day}</span>
          ${callout}
        </button>`);
      continue;
    }
    items.push(`
      <button type="button" class="st-day" data-day="${day}" aria-pressed="${pressed}"
              title="Spieltag ${day}: ${num(mine)}, bester ${num(top)}">
        <span class="st-rank${place === 1 ? ' st-rank--first' : ''}">${place}.</span>
        <span class="st-stack">
          <span class="st-best" style="height:${Math.round((top / scale) * 100)}%"></span>
          <span class="st-mine st-mine--${gradeOfDay(mine, top)}" style="height:${Math.round((mine / scale) * 100)}%"></span>
        </span>
        <span class="st-points">${num(mine)}</span>
        <span class="st-daynum">${day}</span>
        ${callout}
      </button>`);
  }
  return `<div class="st-bars">${items.join('')}</div>`;
}

/**
 * Die Sprechblase zum angetippten Spieltag: die ersten drei mit Platz, Bild,
 * Name und Punkten, die eigene Zeile fett, wenn sie dabei ist, sonst als
 * vierte darunter. Sie hängt an ihrer Spalte und liegt über dem Inhalt; läuft
 * sie seitlich aus dem Blatt, schiebt `placeCallout` sie zurück.
 */
function renderCallout(season: LeagueSeason, day: number): string {
  const rows = dayStandings(season, day);
  const myIndex = rows.findIndex((r) => r.manager.isMe);
  const live = day === season.openDay;
  const row = (r: (typeof rows)[number], place: number, own: boolean): string => `
    <span class="st-co-place${place === 1 && !live ? ' st-co-place--first' : ''}">${place}.</span>
    ${avatar(r.manager)}
    <span class="st-co-name${own ? ' st-co-name--me' : ''}">${own ? 'Du' : escapeHtml(r.manager.name)}</span>
    <b class="st-co-points">${num(r.points)}</b>`;
  const top = rows.slice(0, 3).map((r, i) => row(r, i + 1, r.manager.isMe)).join('');
  const mine = myIndex >= 3 && rows[myIndex]
    ? `<span class="st-co-sep"></span>${row(rows[myIndex], myIndex + 1, true)}`
    : '';
  return `
    <span class="st-callout">
      <span class="st-co-head">Spieltag ${day}${live ? ' <span class="st-co-dot">·</span> läuft noch' : ''}</span>
      ${top}${mine}
    </span>`;
}

/**
 * Die Blase steht mittig über ihrer Spalte. An den Randspalten liefe sie aus
 * dem Blatt, deshalb wird gemessen und der Überstand über --callout-shift
 * zurückgeschoben; der Pfeil wandert gegenläufig und bleibt über der Spalte.
 * Wie `wireModal` in planning-page.ts für den Spielerdialog.
 */
function placeCallout(layer: HTMLElement): void {
  const callout = layer.querySelector<HTMLElement>('.st-callout');
  const sheet = layer.querySelector<HTMLElement>('.stats-sheet');
  if (!callout || !sheet) return;
  const edge = 8;
  const bubble = callout.getBoundingClientRect();
  const box = sheet.getBoundingClientRect();
  const shift = bubble.left < box.left + edge
    ? box.left + edge - bubble.left
    : Math.min(0, box.right - edge - bubble.right);
  if (shift !== 0) callout.style.setProperty('--callout-shift', `${shift}px`);
}

function openNote(season: LeagueSeason, text: string): string {
  if (!season.openDay) return '';
  return `<p class="st-note"><span class="st-flag">Spieltag ${season.openDay} offen</span> Noch nicht alle Spiele sind durch. ${text}</p>`;
}

function renderPodium(rows: ReturnType<typeof standings>): string {
  const order = [rows[1], rows[0], rows[2]].filter((r): r is NonNullable<typeof r> => r !== undefined);
  const heights: Record<number, number> = { 0: 64, 1: 44, 2: 30 };
  const slots = order.map((row) => {
    const place = rows.indexOf(row);
    return `
      <span class="st-slot${place === 0 ? ' st-slot--first' : ''}">
        ${avatar(row.manager)}
        <span class="st-slot-name">${escapeHtml(row.manager.name)}</span>
        <span class="st-slot-points">${num(row.total)}</span>
        <span class="st-step" style="height:${heights[place] ?? 24}px">${place + 1}</span>
      </span>`;
  });
  return `<div class="st-podium">${slots.join('')}</div>`;
}

function card(label: string, value: string, manager: SeasonManager | null): string {
  return `
    <span class="st-card">
      <span class="st-card-label">${label}</span>
      <span class="st-card-value">${value}</span>
      ${manager ? `<span class="st-card-holder">${avatar(manager)}${escapeHtml(manager.name)}</span>` : ''}
    </span>`;
}

function renderMilestones(stones: NonNullable<ReturnType<typeof milestones>>): string {
  const jump = stones.biggestJump;
  return `
    <div class="st-cards">
      ${card('BESTER SPIELTAG', `${num(stones.bestDay.points)} · ST ${stones.bestDay.day}`, stones.bestDay.manager)}
      ${card('LÄNGSTE ZEIT VORN', `${stones.longestOnTop.days} von ${stones.countedDays} Spieltagen`, stones.longestOnTop.manager)}
      ${card('KNAPPSTER SPIELTAG', `${num(stones.closestDay.gap)} Punkte · ST ${stones.closestDay.day}`, null)}
      ${card('DEUTLICHSTER SIEG', `+${num(stones.widestWin.gap)} · ST ${stones.widestWin.day}`, stones.widestWin.manager)}
      ${card('SCHWÄCHSTER SPIELTAG', `${num(stones.worstDay.points)} · ST ${stones.worstDay.day}`, stones.worstDay.manager)}
      ${card('GRÖSSTER SPRUNG', jump ? `+${jump.gain} ${jump.gain === 1 ? 'Platz' : 'Plätze'} · ST ${jump.day}` : 'noch keiner', jump?.manager ?? null)}
    </div>`;
}

/**
 * Zeile je Manager, Spalte je Spieltag des Bereichs. Gesamt und Δ stehen
 * vorn und fest, danach die Spieltage absteigend: der jüngste ist der, den
 * man sucht, und der steht so ohne Blättern neben dem Namen. Δ ist der
 * Rückstand auf Platz 1 und steht erst ab dem zweiten Spieltag; an Spieltag 1
 * sagt er nichts, was die Spieltagsspalte nicht schon zeigt. Die leere
 * Füllspalte am Ende nimmt den Rest der Breite, siehe stats.css.
 */
function matrix(season: LeagueSeason, range: DayRange): string {
  const rows = standingsBetween(season, range.from, range.to);
  const days = [...range.played].reverse();
  const withDiff = days.length >= 2;
  const lead = rows[0]?.total ?? 0;

  const head = [
    '<th class="st-col-name">Manager</th>',
    `<th class="st-col-total${withDiff ? '' : ' st-col-fixed-end'}">Gesamt</th>`,
    withDiff ? '<th class="st-col-diff st-col-fixed-end" title="Rückstand auf Platz 1">Δ</th>' : '',
    ...days.map((day) =>
      `<th class="${day === season.openDay ? 'st-col-open' : ''}">${day === season.openDay ? '<span class="st-dot">•</span>' : ''}${day}</th>`),
    '<th class="st-col-fill"></th>',
  ].join('');

  const body = rows.map((row) => {
    const cells = days.map((day) => {
      const i = day - 1;
      const points = row.manager.points[i] ?? 0;
      const cls = day === season.openDay
        ? 'st-cell-open'
        : row.manager.won[i] ? 'st-cell-win' : '';
      return `<td class="${cls}">${num(points)}</td>`;
    }).join('');
    // Der Führende hat keinen Rückstand, seine Zelle bleibt leer.
    const gap = lead - row.total;
    const diff = withDiff
      ? `<td class="st-col-diff st-col-fixed-end">${gap === 0 ? '' : '-' + num(gap)}</td>`
      : '';
    return `
      <tr class="${row.manager.isMe ? 'is-me' : ''}">
        <td class="st-col-name">${managerCell(row.manager)}</td>
        <td class="st-col-total${withDiff ? '' : ' st-col-fixed-end'}">${num(row.total)}</td>
        ${diff}
        ${cells}
        <td class="st-col-fill"></td>
      </tr>`;
  }).join('');

  return `
    <div class="st-matrix-scroll">
      <table class="st-matrix">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

/** Nur Name und Gesamt aus der Rangliste, solange die Spieltage noch fehlen. */
function matrixFromRanking(ranking: LeagueRanking, userId: string): string {
  const rows = [...ranking.managers].sort((a, b) => b.seasonPoints - a.seasonPoints);
  const body = rows.map((m) => `
    <tr class="${m.id === userId ? 'is-me' : ''}">
      <td class="st-col-name">${managerCell(m)}</td>
      <td class="st-col-total st-col-fixed-end">${num(m.seasonPoints)}</td>
      <td class="st-col-gap">…</td>
      <td class="st-col-fill"></td>
    </tr>`).join('');
  return `
    <div class="st-matrix-scroll">
      <table class="st-matrix">
        <thead><tr><th class="st-col-name">Manager</th><th class="st-col-total st-col-fixed-end">Gesamt</th><th></th><th class="st-col-fill"></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}
