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
  gradeOfDay,
  milestones,
  MILESTONES_FROM,
  myFigures,
  standings,
  type LeagueSeason,
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
      ${renderBars(season, me, half)}
      <div class="st-figures">
        <span class="st-fig"><span>Ø PUNKTE</span><b>${num(me.average)}</b></span>
        <span class="st-fig"><span>SPIELTAGSSIEGE</span><b>${me.wins}</b></span>
        ${lostOrAhead(me.lostToBest, me.aheadOfSecond)}
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
    const title = season.playedDays === 1 ? 'Spieltag 1' : `Spieltage 1 bis ${season.playedDays}`;
    const hint = season.playedDays > 1 ? ' Grün ist der Spieltagssieg, seitwärts blättern zeigt die übrigen Spieltage.' : ' Grün ist der Spieltagssieg.';
    const note = season.openDay
      ? openNote(season, 'Spalte und Gesamtsumme sind so lange vorläufig.' + hint)
      : `<p class="st-note">${hint.trim()}</p>`;
    return `
      ${sectionHead(title, `Saison ${escapeHtml(season.title)}`)}
      ${matrix(season)}
      ${note}
    `;
  }
}

// ---------- Bausteine ----------

function sectionHead(title: string, sub: string, gap = false): string {
  return `<div class="st-section-head${gap ? ' st-section-head--gap' : ''}">
    <span class="st-title">${title}</span><span class="st-sub">${sub}</span></div>`;
}

/**
 * Was zum Tagesbesten fehlte. Fehlte nie etwas, dreht sich die Kachel um und
 * zeigt den Vorsprung auf den jeweils Zweiten: eine 0 sagte nur, dass man
 * vorn war, nicht wie deutlich.
 */
function lostOrAhead(lostToBest: number, aheadOfSecond: number): string {
  if (lostToBest > 0) {
    return `<span class="st-fig"><span>AUF DEN BESTEN</span><b class="st-neg">-${num(lostToBest)}</b></span>`;
  }
  if (aheadOfSecond > 0) {
    return `<span class="st-fig"><span>VOR DEM ZWEITEN</span><b class="st-pos">+${num(aheadOfSecond)}</b></span>`;
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
function renderBars(season: LeagueSeason, me: ReturnType<typeof myFigures> & object, half: 0 | 1): string {
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
    const cls = day === season.openDay ? 'st-mine--open' : `st-mine--${gradeOfDay(mine, top)}`;
    items.push(`
      <span class="st-day" title="Spieltag ${day}: ${num(mine)}, bester ${num(top)}">
        <span class="st-rank${place === 1 ? ' st-rank--first' : ''}">${place}.</span>
        <span class="st-stack">
          <span class="st-best" style="height:${Math.round((top / scale) * 100)}%"></span>
          <span class="st-mine ${cls}" style="height:${Math.round((mine / scale) * 100)}%"></span>
        </span>
        <span class="st-points">${num(mine)}</span>
        <span class="st-daynum">${day}</span>
      </span>`);
  }
  return `<div class="st-bars">${items.join('')}</div>`;
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
 * Zeile je Manager, Spalte je Spieltag. Gesamt steht vorn, danach die
 * Spieltage absteigend: der jüngste ist der, den man sucht, und der steht so
 * ohne Blättern neben dem Namen.
 */
function matrix(season: LeagueSeason): string {
  const rows = standings(season);
  const days: number[] = [];
  for (let day = season.playedDays; day >= 1; day--) days.push(day);

  const head = [
    '<th class="st-col-name">Manager</th>',
    '<th class="st-col-total">Gesamt</th>',
    ...days.map((day) =>
      `<th class="${day === season.openDay ? 'st-col-open' : ''}">${day === season.openDay ? '<span class="st-dot">•</span>' : ''}${day}</th>`),
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
    return `
      <tr class="${row.manager.isMe ? 'is-me' : ''}">
        <td class="st-col-name">${managerCell(row.manager)}</td>
        <td class="st-col-total">${num(row.total)}</td>
        ${cells}
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
      <td class="st-col-total">${num(m.seasonPoints)}</td>
      <td class="st-col-gap">…</td>
    </tr>`).join('');
  return `
    <div class="st-matrix-scroll">
      <table class="st-matrix">
        <thead><tr><th class="st-col-name">Manager</th><th class="st-col-total">Gesamt</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}
