/**
 * Aufstellung: was zulässig ist und was von einem Zwischenstand aus noch
 * erreichbar ist.
 *
 * Rein: kein DOM, kein fetch, kein localStorage.
 *
 * Grundlage sind die zehn Formationen aus `VALID_FORMATIONS`. Die Liste ist
 * kein Produkt aus Ober- und Untergrenzen: ABW läuft von 3 bis 5, MF von 2
 * bis 6, ANG von 1 bis 4, trotzdem fehlt 3-3-4. Geprüft wird deshalb immer
 * gegen die Liste, nie gegen Bereiche.
 *
 * Zweiter Punkt, der beim Aufstellen zählt: eine halbe Elf ist keine
 * Formation. Während des Zusammenstellens kann also nur die Frage
 * beantwortet werden, ob überhaupt noch eine gültige Elf erreichbar ist,
 * siehe {@link isReachable}.
 */

import { VALID_FORMATIONS, type PositionLabel } from './optimizer.js';

export interface PositionCounts {
  TW: number;
  ABW: number;
  MF: number;
  ANG: number;
}

/** Eine Formation als Zahlen, `label` ist die Schreibweise "4-3-3". */
interface Shape {
  label: string;
  ABW: number;
  MF: number;
  ANG: number;
}

type OutfieldLabel = Exclude<PositionLabel, 'TW'>;

const OUTFIELD: readonly OutfieldLabel[] = ['ABW', 'MF', 'ANG'];

const SHAPES: readonly Shape[] = VALID_FORMATIONS.map((label) => {
  const parts = label.split('-').map(Number);
  return { label, ABW: parts[0] ?? 0, MF: parts[1] ?? 0, ANG: parts[2] ?? 0 };
});

export function emptyCounts(): PositionCounts {
  return { TW: 0, ABW: 0, MF: 0, ANG: 0 };
}

export function countPositions(positions: Iterable<PositionLabel>): PositionCounts {
  const counts = emptyCounts();
  for (const pos of positions) counts[pos]++;
  return counts;
}

export function totalPlayers(counts: PositionCounts): number {
  return counts.TW + counts.ABW + counts.MF + counts.ANG;
}

function covers(shape: Shape, counts: PositionCounts): boolean {
  return counts.ABW <= shape.ABW && counts.MF <= shape.MF && counts.ANG <= shape.ANG;
}

function withOneMore(counts: PositionCounts, pos: PositionLabel): PositionCounts {
  const next: PositionCounts = { ...counts };
  next[pos] = next[pos] + 1;
  return next;
}

/**
 * Lässt sich dieser Stand noch zu einer gültigen Elf ergänzen?
 *
 * Eine Formation muss jede Zählung gleichzeitig abdecken. Deckt sie ab, dann
 * sind es höchstens zehn Feldspieler, mit dem Torwart also höchstens elf.
 * Eine eigene Prüfung auf die Gesamtzahl braucht es deshalb nicht.
 */
export function isReachable(counts: PositionCounts): boolean {
  if (counts.TW > 1) return false;
  return SHAPES.some((shape) => covers(shape, counts));
}

/** Darf noch ein Spieler dieser Position dazu? */
export function canPlace(counts: PositionCounts, pos: PositionLabel): boolean {
  return isReachable(withOneMore(counts, pos));
}

/** Die Formation, wenn die Elf steht, sonst `null`. */
export function detectFormation(counts: PositionCounts): string | null {
  if (counts.TW !== 1 || totalPlayers(counts) !== 11) return null;
  const hit = SHAPES.find(
    (s) => s.ABW === counts.ABW && s.MF === counts.MF && s.ANG === counts.ANG,
  );
  return hit ? hit.label : null;
}

/**
 * Kleinste Anzahl, die eine von hier aus noch erreichbare Formation auf dieser
 * Position verlangt. Bei sechs MF bleibt nur 3-6-1, damit ist die Abwehr auf
 * genau drei festgelegt.
 */
function minStillNeeded(counts: PositionCounts, pos: OutfieldLabel): number {
  let min = Infinity;
  for (const shape of SHAPES) {
    if (covers(shape, counts)) min = Math.min(min, shape[pos]);
  }
  return Number.isFinite(min) ? min : counts[pos];
}

/**
 * Fehlbestand eines Kaders zur nächstgelegenen Formation. Leere Liste heißt:
 * mindestens eine der zehn geht auf.
 *
 * Nicht mit {@link isReachable} zu verwechseln: dort ist eine Elf im Aufbau
 * gemeint, zu viele auf einer Position sind ein Ausschlussgrund. Hier ist der
 * Vorrat gemeint, aus dem elf ausgewählt werden, da stört Überzahl nicht.
 *
 * Mindestzahlen je Position reichen für diese Frage nicht: die Liste mischt
 * sie. Drei Abwehrspieler gibt es nur mit drei Angreifern, sechs Mittelfeld
 * nur mit einem. Wer 6 ABW, 3 MF und 1 ANG behält, erfüllt jede Untergrenze
 * und bekommt trotzdem keine der zehn Formationen zusammen.
 *
 * Sind mehrere Formationen gleich nah, gewinnt die erste aus der Liste. Der
 * Hinweis nennt damit einen Weg, nicht den einzigen.
 */
export function squadFormationGap(counts: PositionCounts): string[] {
  if (counts.TW < 1) return [`TW ${counts.TW}/1`];

  let best: { total: number; parts: string[] } | null = null;
  for (const shape of SHAPES) {
    const parts: string[] = [];
    let total = 0;
    for (const pos of OUTFIELD) {
      const short = shape[pos] - counts[pos];
      if (short > 0) {
        parts.push(`${pos} ${counts[pos]}/${shape[pos]}`);
        total += short;
      }
    }
    if (total === 0) return [];
    if (!best || total < best.total) best = { total, parts };
  }
  return best ? best.parts : [];
}

/** Kurztexte für den Chip im Kopf. Leere Liste heißt: die Elf steht. */
export function lineupIssues(counts: PositionCounts): string[] {
  const issues: string[] = [];
  const total = totalPlayers(counts);
  if (counts.TW !== 1) issues.push(`TW ${counts.TW}/1`);
  if (total !== 11) issues.push(`${total}/11 Spieler`);

  // Was auf einer Position noch fehlt, steht wie beim Torwart als eigener
  // Chip da, vom ersten Spieler an. Die Zahl dahinter ist keine feste
  // Untergrenze, sondern was die noch erreichbaren Formationen verlangen: bei
  // sechs MF bleibt nur 3-6-1, dort heißt es dann "ABW 1/3".
  for (const pos of OUTFIELD) {
    const need = minStillNeeded(counts, pos);
    if (counts[pos] < need) issues.push(`${pos} ${counts[pos]}/${need}`);
  }

  // Elf Spieler, ein Torwart, und trotzdem keine Formation: der Fall 3-3-4.
  if (total === 11 && counts.TW === 1 && detectFormation(counts) === null) {
    issues.push(`${counts.ABW}-${counts.MF}-${counts.ANG} gibt es nicht`);
  }
  return issues;
}

/**
 * Warum geht kein weiterer Spieler dieser Position mehr?
 *
 * Nennt die Formation, die dem Wunsch am nächsten kommt, und was dafür
 * weichen müsste. "Kein Platz" allein lässt den Benutzer sonst raten, ob
 * die Position voll ist oder eine andere im Weg steht.
 */
export function explainBlock(counts: PositionCounts, pos: PositionLabel): string {
  if (totalPlayers(counts) >= 11) return 'Die Elf ist voll. Erst jemanden auf die Bank setzen.';
  if (pos === 'TW') return 'Es steht schon ein Torwart in der Elf.';

  const wanted = counts[pos] + 1;
  const candidates = SHAPES.filter((shape) => shape[pos] >= wanted);
  if (candidates.length === 0) {
    return `Mehr als ${counts[pos]} ${pos} gibt es in keiner Formation.`;
  }

  // Die Formation mit dem kleinsten Überhang ist die, die am ehesten
  // erreichbar bleibt, wenn der Benutzer anderswo einen Platz räumt.
  let best = candidates[0]!;
  let bestExcess = excess(best, counts);
  for (const shape of candidates.slice(1)) {
    const value = excess(shape, counts);
    if (value < bestExcess) {
      best = shape;
      bestExcess = value;
    }
  }

  const blockers = OUTFIELD.filter((p) => counts[p] > best[p]).map(
    (p) => `${p} auf ${best[p]}`,
  );
  if (blockers.length === 0) return `Ein weiterer ${pos} passt hier nicht mehr.`;
  return `Ein weiterer ${pos} passt nur in ${best.label}, dafür müsste ${blockers.join(' und ')}.`;
}

function excess(shape: Shape, counts: PositionCounts): number {
  let sum = 0;
  for (const p of OUTFIELD) {
    const over = counts[p] - shape[p];
    if (over > 0) sum += over;
  }
  return sum;
}
