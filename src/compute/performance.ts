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

export function seasonStats(season: PerformanceSeason): SeasonStats {
  const played = season.matchdays.filter((day) => day.points !== null);
  const total = played.reduce((sum, day) => sum + (day.points ?? 0), 0);
  const highest = played.reduce((max, day) => Math.max(max, day.points ?? 0), 0);
  return {
    total,
    played: played.length,
    days: matchdayCount(season),
    average: played.length > 0 ? Math.round(total / played.length) : 0,
    max: Math.max(highest, 1),
  };
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
export function gradeOf(day: PerformanceMatchday | null, average: number): MatchdayGrade {
  if (day === null) return 'none';
  if (day.points === null) return 'out';
  if (day.points < 0) return 'neg';
  if (day.points >= average * 1.25) return 'good';
  if (day.points >= average * 0.6) return 'mid';
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
 * Welche Saison beim Öffnen offen steht. Die laufende, sobald sie einen
 * Einsatz zeigt, sonst die vorige: vor dem ersten Spieltag stünde der Dialog
 * sonst auf einer leeren Spalte.
 */
export function defaultSeasonId(performance: PlayerPerformance | null): string | null {
  const { current, previous } = pickSeasons(performance);
  if (current && current.matchdays.some((day) => day.points !== null)) return current.id;
  return previous?.id ?? current?.id ?? null;
}
