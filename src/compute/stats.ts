/**
 * Was die Statistik-Ebene aus Rangliste und Punkten je Spieltag rechnet:
 * die laufende Saison als Zahlenreihe je Manager, Tabellenstände, die
 * eigenen Kennzahlen und die Meilensteine der Saison.
 *
 * Kein DOM, kein Netz. Alles kommt als Eingabe herein.
 */

import type { LeagueRanking, ManagerPerformance, ManagerSeason } from '../api/types.js';
import { LIVE_BUFFER_MS } from './performance.js';

/** Wie viele Spieltage eine Saison hat, solange die Daten nichts anderes sagen. */
export const DEFAULT_DAY_COUNT = 34;

/** Ab wie vielen gewerteten Spieltagen die Meilensteine etwas aussagen. */
export const MILESTONES_FROM = 3;

/**
 * Ohne Spielplan kennt die Historie nur den ersten Anstoß eines Spieltags.
 * Ein Spieltag reicht von Freitagabend bis Sonntag, mit Nachzügler bis
 * Montag; dreieinhalb Tage decken das ab.
 */
const OPEN_WITHOUT_SCHEDULE_MS = 3.5 * 24 * 60 * 60 * 1000;

export interface SeasonManager {
  id: string;
  name: string;
  /** Profilbild relativ zum CDN, leer wenn keins. */
  imagePath: string;
  isMe: boolean;
  /** Punkte je angepfiffenem Spieltag, Index 0 = Spieltag 1. */
  points: number[];
  /** Spieltagssieg laut Kickbase, gleiche Länge wie `points`. */
  won: boolean[];
}

export interface LeagueSeason {
  /** Beschriftung, etwa "2026/2027". */
  title: string;
  /** Spieltage der Saison insgesamt. */
  dayCount: number;
  /** Spieltage, die schon angepfiffen wurden. */
  playedDays: number;
  /** Der letzte angepfiffene Spieltag, solange er nicht durch ist; 0 sonst. */
  openDay: number;
  /** In der Reihenfolge der Rangliste. */
  managers: SeasonManager[];
}

export interface BuildInput {
  ranking: LeagueRanking;
  /** Je Manager-Id die Historie. Fehlt eine, gibt es keine Saison. */
  performances: Record<string, ManagerPerformance>;
  /** Eigene Nutzer-Id, markiert `isMe`. */
  userId: string;
  /** Anstoß je Verein und Spieltag aus dem Spielplan, null ohne Score-Lauf. */
  kickoffs: Record<string, Record<number, string>> | null;
  now: number;
}

function currentSeason(performance: ManagerPerformance): ManagerSeason | null {
  return performance.seasons[performance.seasons.length - 1] ?? null;
}

function timestamp(iso: string): number {
  if (!iso) return Number.NaN;
  return new Date(iso).getTime();
}

/**
 * Die laufende Saison aus den Historien aller Manager. Null, wenn eine fehlt:
 * ein Tabellenstand aus halben Daten wäre falsch, nicht nur unvollständig.
 *
 * Ein Spieltag zählt als angepfiffen, sobald sein erster Anstoß vorbei ist
 * oder irgendwer dort Punkte hat. Ob er noch offen ist, sagt der Spielplan:
 * der letzte Anstoß des Spieltags plus das Live-Fenster aus `performance.ts`.
 * Ohne Spielplan bleibt der Abstand zum ersten Anstoß.
 */
export function buildLeagueSeason(input: BuildInput): LeagueSeason | null {
  const { ranking, performances, userId, kickoffs, now } = input;
  const seasons: { rank: LeagueRanking['managers'][number]; season: ManagerSeason }[] = [];
  for (const rank of ranking.managers) {
    const performance = performances[rank.id];
    const season = performance ? currentSeason(performance) : null;
    if (!season) return null;
    seasons.push({ rank, season });
  }
  if (seasons.length === 0) return null;

  const first = seasons[0]!.season;
  const dayCount = Math.max(
    DEFAULT_DAY_COUNT,
    ...seasons.map((s) => s.season.matchdays.reduce((max, d) => Math.max(max, d.day), 0)),
  );

  const firstKickoff = (day: number): number =>
    timestamp(first.matchdays.find((d) => d.day === day)?.kickoff ?? '');
  const anyPoints = (day: number): boolean =>
    seasons.some((s) => (s.season.matchdays.find((d) => d.day === day)?.points ?? 0) > 0);

  let playedDays = 0;
  for (let day = 1; day <= dayCount; day++) {
    const kickoff = firstKickoff(day);
    const started = (!Number.isNaN(kickoff) && kickoff <= now) || anyPoints(day);
    if (started) playedDays = day;
  }

  let openDay = 0;
  if (playedDays > 0) {
    const last = lastKickoff(kickoffs, playedDays);
    if (last !== null) {
      if (last + LIVE_BUFFER_MS > now) openDay = playedDays;
    } else {
      const kickoff = firstKickoff(playedDays);
      if (!Number.isNaN(kickoff) && kickoff + OPEN_WITHOUT_SCHEDULE_MS > now) openDay = playedDays;
    }
  }

  const managers: SeasonManager[] = seasons.map(({ rank, season }) => {
    const points: number[] = [];
    const won: boolean[] = [];
    for (let day = 1; day <= playedDays; day++) {
      const entry = season.matchdays.find((d) => d.day === day);
      points.push(entry?.points ?? 0);
      won.push(entry?.won ?? false);
    }
    return {
      id: rank.id,
      name: rank.name,
      imagePath: rank.imagePath,
      isMe: rank.id === userId,
      points,
      won,
    };
  });

  return { title: first.title, dayCount, playedDays, openDay, managers };
}

/** Der späteste Anstoß eines Spieltags über alle Vereine, null ohne Spielplan. */
function lastKickoff(
  kickoffs: Record<string, Record<number, string>> | null,
  day: number,
): number | null {
  if (!kickoffs) return null;
  let last: number | null = null;
  for (const byDay of Object.values(kickoffs)) {
    const time = timestamp(byDay[day] ?? '');
    if (Number.isNaN(time)) continue;
    if (last === null || time > last) last = time;
  }
  return last;
}

// ---------- Tabellenstände ----------

export interface StandingRow {
  manager: SeasonManager;
  total: number;
  /** Spieltagssiege, der offene Spieltag zählt noch nicht. */
  wins: number;
  /** Punkte je Spieltag, gerundet. */
  average: number;
}

/** Gesamtstand nach `upTo` Spieltagen, Führender zuerst. */
export function standings(season: LeagueSeason, upTo = season.playedDays): StandingRow[] {
  const days = Math.max(0, Math.min(upTo, season.playedDays));
  const rows = season.managers.map((manager) => {
    let total = 0;
    let wins = 0;
    for (let i = 0; i < days; i++) {
      total += manager.points[i] ?? 0;
      if (i + 1 !== season.openDay && manager.won[i]) wins++;
    }
    return { manager, total, wins, average: days > 0 ? Math.round(total / days) : 0 };
  });
  return rows.sort((a, b) => b.total - a.total);
}

export interface DayRow {
  manager: SeasonManager;
  points: number;
  won: boolean;
}

/** Alle Manager an einem Spieltag, bester zuerst. */
export function dayStandings(season: LeagueSeason, day: number): DayRow[] {
  const i = day - 1;
  return season.managers
    .map((manager) => ({ manager, points: manager.points[i] ?? 0, won: manager.won[i] ?? false }))
    .sort((a, b) => b.points - a.points);
}

function bestOfDay(season: LeagueSeason, i: number): number {
  return Math.max(0, ...season.managers.map((m) => m.points[i] ?? 0));
}

// ---------- Eigene Sicht ----------

export interface MyFigures {
  manager: SeasonManager;
  place: number;
  total: number;
  /** Abstand zum Ersten, 0 wenn man selbst vorn liegt. */
  gapToFirst: number;
  /** Vorsprung auf den Zweiten, 0 wenn man nicht vorn liegt oder allein ist. */
  leadOverSecond: number;
  average: number;
  wins: number;
  /** Summe dessen, was je Spieltag zum Tagesbesten fehlte. */
  lostToBest: number;
  /**
   * Summe des Vorsprungs auf den Zweitbesten an den Spieltagen, an denen man
   * selbst der Beste war. Die Kehrseite von `lostToBest`: wer nie etwas
   * liegen ließ, sieht hier, wie deutlich das war.
   */
  aheadOfSecond: number;
  /** Platz am jeweiligen Spieltag, Index 0 = Spieltag 1. */
  dayPlaces: number[];
}

export function myFigures(season: LeagueSeason): MyFigures | null {
  const rows = standings(season);
  const index = rows.findIndex((r) => r.manager.isMe);
  if (index < 0) return null;
  const row = rows[index]!;
  const first = rows[0]!;
  const second = rows[1];
  let lostToBest = 0;
  let aheadOfSecond = 0;
  const dayPlaces: number[] = [];
  for (let i = 0; i < season.playedDays; i++) {
    const mine = row.manager.points[i] ?? 0;
    lostToBest += bestOfDay(season, i) - mine;
    const ordered = dayStandings(season, i + 1);
    const place = ordered.findIndex((d) => d.manager.isMe) + 1;
    dayPlaces.push(place);
    const runnerUp = ordered[1];
    if (place === 1 && runnerUp) aheadOfSecond += mine - runnerUp.points;
  }
  return {
    manager: row.manager,
    place: index + 1,
    total: row.total,
    gapToFirst: first.total - row.total,
    leadOverSecond: index === 0 && second ? row.total - second.total : 0,
    average: row.average,
    wins: row.wins,
    lostToBest,
    aheadOfSecond,
    dayPlaces,
  };
}

export type DayGrade = 'good' | 'mid' | 'weak';

/**
 * Güte eines eigenen Spieltags gegen den Tagesbesten, wie die Balken im
 * Spielerdialog: gewonnen, nah dran, weit weg.
 */
export function gradeOfDay(mine: number, best: number): DayGrade {
  if (best > 0 && mine >= best) return 'good';
  if (mine < best * 0.6) return 'weak';
  return 'mid';
}

// ---------- Meilensteine ----------

export interface Milestones {
  /** Wie viele Spieltage gezählt wurden, der offene nicht. */
  countedDays: number;
  bestDay: { points: number; day: number; manager: SeasonManager };
  worstDay: { points: number; day: number; manager: SeasonManager };
  /** Kleinster Abstand zwischen Erstem und Zweitem eines Spieltags. */
  closestDay: { gap: number; day: number };
  widestWin: { gap: number; day: number; manager: SeasonManager };
  /** Wer nach den meisten Spieltagen vorn lag. */
  longestOnTop: { days: number; manager: SeasonManager };
  /** Meiste Plätze von einem Spieltag zum nächsten gutgemacht, null wenn nie. */
  biggestJump: { gain: number; day: number; manager: SeasonManager } | null;
}

/**
 * Null, solange weniger als {@link MILESTONES_FROM} Spieltage gewertet sind
 * oder die Liga nur einen Manager hat: knappster Spieltag und deutlichster
 * Sieg brauchen einen Zweiten.
 */
export function milestones(season: LeagueSeason): Milestones | null {
  const counted: number[] = [];
  for (let i = 0; i < season.playedDays; i++) if (i + 1 !== season.openDay) counted.push(i);
  if (counted.length < MILESTONES_FROM || season.managers.length < 2) return null;

  let bestDay: Milestones['bestDay'] | null = null;
  let worstDay: Milestones['worstDay'] | null = null;
  let closestDay: Milestones['closestDay'] | null = null;
  let widestWin: Milestones['widestWin'] | null = null;
  for (const i of counted) {
    const day = i + 1;
    for (const manager of season.managers) {
      const points = manager.points[i] ?? 0;
      if (!bestDay || points > bestDay.points) bestDay = { points, day, manager };
      if (!worstDay || points < worstDay.points) worstDay = { points, day, manager };
    }
    const ordered = dayStandings(season, day);
    const gap = ordered[0]!.points - ordered[1]!.points;
    if (!closestDay || gap < closestDay.gap) closestDay = { gap, day };
    if (!widestWin || gap > widestWin.gap) widestWin = { gap, day, manager: ordered[0]!.manager };
  }

  // Wer nach jedem Spieltag vorn lag, und die Plätze für den Sprung.
  const running = season.managers.map(() => 0);
  const daysOnTop = season.managers.map(() => 0);
  const places = season.managers.map(() => [] as number[]);
  for (const i of counted) {
    season.managers.forEach((m, index) => { running[index] = (running[index] ?? 0) + (m.points[i] ?? 0); });
    const order = running.map((total, index) => ({ index, total })).sort((a, b) => b.total - a.total);
    daysOnTop[order[0]!.index] = (daysOnTop[order[0]!.index] ?? 0) + 1;
    order.forEach((entry, place) => places[entry.index]!.push(place + 1));
  }
  let topIndex = 0;
  daysOnTop.forEach((days, index) => { if (days > (daysOnTop[topIndex] ?? 0)) topIndex = index; });

  let biggestJump: Milestones['biggestJump'] = null;
  places.forEach((series, index) => {
    for (let k = 1; k < series.length; k++) {
      const gain = (series[k - 1] ?? 0) - (series[k] ?? 0);
      if (gain > 0 && (!biggestJump || gain > biggestJump.gain)) {
        biggestJump = { gain, day: (counted[k] ?? 0) + 1, manager: season.managers[index]! };
      }
    }
  });

  if (!bestDay || !worstDay || !closestDay || !widestWin) return null;
  return {
    countedDays: counted.length,
    bestDay,
    worstDay,
    closestDay,
    widestWin,
    longestOnTop: { days: daysOnTop[topIndex] ?? 0, manager: season.managers[topIndex]! },
    biggestJump,
  };
}
