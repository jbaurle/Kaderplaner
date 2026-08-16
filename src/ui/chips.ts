/**
 * Chips für Formationsmängel. Tabelle und Aufstellung zeigen dieselben
 * Pillen: das Kürzel in seiner Positionsfarbe, der Zähler in Rot. Die Zahlen
 * aus den Meldungen ("ABW 1/3") stehen nicht auf dem Chip, Farbe und Kürzel
 * sagen genug.
 */

import { escapeHtml } from './format.js';

const POSITION_CHIP_CLASS: Record<string, string> = {
  TW: 'chip--pos1',
  ABW: 'chip--pos2',
  MF: 'chip--pos3',
  ANG: 'chip--pos4',
};

/** "TW 0/1" → "TW", "nur 3/11 Spieler" → "3/11". */
export function formationIssueLabel(issue: string): string {
  const parts = issue.split(' ');
  return (parts[0] === 'nur' ? parts[1] : parts[0]) ?? issue;
}

export function formationIssueChip(label: string): string {
  const chipClass = /^\d+\/\d+$/.test(label)
    ? 'formation-issue-chip--count'
    : POSITION_CHIP_CLASS[label] ?? '';
  return `<span class="formation-issue-chip ${chipClass}">${escapeHtml(label)}</span>`;
}

export function formationIssueChips(issues: readonly string[]): string {
  return issues.map((issue) => formationIssueChip(formationIssueLabel(issue))).join('');
}
