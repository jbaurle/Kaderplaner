/**
 * Was der Spielerdialog aus der Spielerhistorie rechnet: Kennzahlen einer
 * Saison, das Raster der Spieltage und die Einstufung eines einzelnen
 * Spieltags.
 *
 * Kein DOM, kein Netz. Alles kommt als Eingabe herein.
 */

import type { PerformanceMatchday, PerformanceSeason, PlayerPerformance } from '../api/types.js';

/** Wie viele Spieltage eine Saison hat, solange die Daten nichts anderes sagen. */
export const DEFAULT_MATCHDAY_COUNT = 34;

export interface SeasonStats {
  /** Summe der Punkte über alle Spieltage mit Einsatz. */
  total: number;
  /** Zahl der Spieltage mit Einsatz. */
  played: number;
  /** Spieltage der Saison insgesamt, also auch die ohne Einsatz. */
  days: number;
  /** Punkte je Einsatz, gerundet. 0 ohne Einsatz. */
  average: number;
  /** Höchste Punktzahl der Saison, mindestens 1 (als Nenner für die Balken). */
  max: number;
}

/** Einstufung eines Spieltags für Farbe und Balken. */
export type MatchdayGrade = 'good' | 'mid' | 'weak' | 'neg' | 'out' | 'none';

export function seasonStats(season: PerformanceSeason, now = Date.now()): SeasonStats {
  const played = season.matchdays.filter((day) => finalPoints(day, now) !== null);
  const total = played.reduce((sum, day) => sum + (finalPoints(day, now) ?? 0), 0);
  const highest = played.reduce((max, day) => Math.max(max, finalPoints(day, now) ?? 0), 0);
  return {
    total,
    played: played.length,
    days: matchdayCount(season),
    average: played.length > 0 ? Math.round(total / played.length) : 0,
    max: Math.max(highest, 1),
  };
}

/**
 * Puffer nach Anstoß, bevor Kickbase-Punkte als verlässlich gelten. Innerhalb
 * dieses Fensters kann `points` noch der Live-Zwischenstand sein statt des
 * Endergebnisses (siehe Chabot, Spieltag 1: `state` stand längst auf fertig,
 * die Punkte lagen trotzdem noch tagelang daneben - dieser Puffer fängt nur
 * das kurze Live-Fenster ab, nicht diese Verzögerung).
 */
export const LIVE_BUFFER_MS = 2.5 * 60 * 60 * 1000;

export function isMatchLive(day: PerformanceMatchday, now = Date.now()): boolean {
  if (!day.kickoff) return false;
  const kickoff = new Date(day.kickoff).getTime();
  if (Number.isNaN(kickoff)) return false;
  const elapsed = now - kickoff;
  return elapsed >= 0 && elapsed < LIVE_BUFFER_MS;
}

/** `day.points`, aber `null` solange das Spiel noch im Live-Fenster steckt. */
function finalPoints(day: PerformanceMatchday, now: number): number | null {
  return isMatchLive(day, now) ? null : day.points;
}

/**
 * Wie viele Spieltage die Saison hat. Nicht `matchdays.length`: die Liste kann
 * Lücken haben, Ryerson fehlt in 2022/2023 der 8. Spieltag ganz. Die höchste
 * Nummer stimmt auch dann.
 */
export function matchdayCount(season: PerformanceSeason): number {
  const highest = season.matchdays.reduce((max, day) => Math.max(max, day.day), 0);
  return Math.max(highest, DEFAULT_MATCHDAY_COUNT);
}

/**
 * Ein Platz je Spieltag, gefüllt über `day`. Nicht über die Position in der
 * Liste: eine Lücke würde sonst alles danach um einen Spieltag verschieben.
 */
export function matchdaysBySlot(season: PerformanceSeason): (PerformanceMatchday | null)[] {
  const count = matchdayCount(season);
  const slots: (PerformanceMatchday | null)[] = [];
  for (let day = 1; day <= count; day++) {
    slots.push(season.matchdays.find((entry) => entry.day === day) ?? null);
  }
  return slots;
}

/**
 * Einstufung am eigenen Schnitt, nicht an einer festen Grenze: 50 Punkte sind
 * für einen Torwart gut und für einen Stürmer mager.
 */
export function gradeOf(day: PerformanceMatchday | null, average: number, now = Date.now()): MatchdayGrade {
  if (day === null) return 'none';
  const points = finalPoints(day, now);
  if (points === null) return 'out';
  if (points < 0) return 'neg';
  if (points >= average * 1.25) return 'good';
  if (points >= average * 0.6) return 'mid';
  return 'weak';
}

/**
 * Die laufende und die vorige Saison. Kickbase liefert aufsteigend, die
 * laufende steht also zuletzt. Führt Kickbase nur eine Saison, bleibt die
 * vorige leer.
 */
export function pickSeasons(performance: PlayerPerformance | null): {
  current: PerformanceSeason | null;
  previous: PerformanceSeason | null;
} {
  const seasons = performance?.seasons ?? [];
  return {
    current: seasons[seasons.length - 1] ?? null,
    previous: seasons[seasons.length - 2] ?? null,
  };
}

/**
 * Welche Saison beim Öffnen offen steht. Die laufende, sobald in ihr ein
 * Spieltag angepfiffen wurde, auch ohne eigenen Einsatz: die Saison läuft
 * dann. Vorher die vorige, sonst stünde der Dialog auf leeren Spalten.
 */
export function defaultSeasonId(performance: PlayerPerformance | null, now = Date.now()): string | null {
  const { current, previous } = pickSeasons(performance);
  if (current && seasonStarted(current, now)) return current.id;
  return previous?.id ?? current?.id ?? null;
}

/* Punkte zählen auch ohne Anstoßzeit: Kickbase führt sie nicht immer. */
function seasonStarted(season: PerformanceSeason, now: number): boolean {
  return season.matchdays.some((day) =>
    day.points !== null
    || (day.kickoff !== '' && new Date(day.kickoff).getTime() <= now));
}
