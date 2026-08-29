/**
 * Hilfe-Overlay: die datenabhängige Begründung, warum keine gültige
 * Formation möglich ist. Features und Score haben eigene Seiten
 * (features.html, score.html), die Fußzeile verlinkt sie direkt.
 *
 * Reiner Renderer. Öffnen, Schliessen und die Auswahl steuert
 * `planning-page.ts` über `state.modal`; `renderHelpModal` ist der Rahmen
 * für alle Overlays der Seite.
 */

import { VALID_FORMATIONS, type PositionLabel } from '../compute/optimizer.js';
import { escapeHtml } from './format.js';

export type HelpModal = 'formation';

const POSITIONS: readonly PositionLabel[] = ['TW', 'ABW', 'MF', 'ANG'];

export interface FormationHelpInput {
  /** Anzahl einsatzfähiger Spieler (Score > 0) je Position. */
  available: Record<PositionLabel, number>;
  /** Namen der Spieler mit Score 0. */
  unavailable: string[];
}

/**
 * Der Rahmen für jedes Overlay. `subtitle` ist optional und steht klein unter
 * dem Titel: die Hilfetexte brauchen keinen, die Gebote zählen dort mit.
 */
export function renderHelpModal(title: string, bodyHtml: string, subtitle = ''): string {
  return `
    <div class="dialog-shade" data-dialog-shade tabindex="-1">
      <section class="dialog-box" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <header class="dialog-head">
          <div class="dialog-heading">
            <h2 class="dialog-title">${escapeHtml(title)}</h2>
            ${subtitle ? `<p class="dialog-subtitle">${escapeHtml(subtitle)}</p>` : ''}
          </div>
          <button type="button" class="dialog-close" data-dialog-close aria-label="Schließen">×</button>
        </header>
        <div class="dialog-body">${bodyHtml}</div>
      </section>
    </div>
  `;
}

export const FORMATION_HELP_TITLE = 'Warum keine gültige Formation?';

export function renderFormationHelpBody(input: FormationHelpInput): string {
  const counts = POSITIONS.map((p) => `${p} ${input.available[p]}`).join(' · ');
  const closest = groupByGap(findClosestFormations(input.available));

  const closestHtml =
    closest.length === 0
      ? ''
      : `<p>Am nächsten dran:</p>
         <ul class="help-list-plain">
           ${closest.map((g) => `<li>${renderGapLine(g)}</li>`).join('')}
         </ul>`;

  const unavailableHtml =
    input.unavailable.length === 0
      ? ''
      : `<p>Nicht einsatzfähig: ${escapeHtml(input.unavailable.join(', '))}.</p>`;

  return `
    <p>
      Der Optimizer probiert zehn Formationen durch und braucht für jede genug
      einsatzfähige Spieler je Position. Einsatzfähig heißt Score über 0, also
      weder verletzt noch gesperrt. Für keine der zehn reicht dein Kader gerade.
    </p>

    <p class="help-formula">Einsatzfähig: ${escapeHtml(counts)}</p>

    ${closestHtml}
    ${unavailableHtml}

    <p>
      Die Prozentwerte in der Tabelle stimmen trotzdem, sie werden pro Spieler
      einzeln berechnet. Es fehlt nur die grün markierte Startelf.
    </p>

    <p class="help-note">
      Gültige Formationen (Abwehr-Mittelfeld-Angriff, dazu immer 1 TW):
      ${escapeHtml(VALID_FORMATIONS.join(', '))}.
    </p>
  `;
}

interface FormationGap {
  total: number;
  parts: string[];
}

interface GapGroup {
  formations: string[];
  gap: FormationGap;
}

/**
 * Formationen mit identischer Lücke zusammenfassen. Ohne das stünden bei
 * einem fehlenden Torwart zehn gleichlautende Zeilen untereinander, und bei
 * gemischten Lücken (etwa 1 ANG gegen 1 MF) würde eine davon falsch
 * beschriftet.
 */
function groupByGap(candidates: { formation: string; gap: FormationGap }[]): GapGroup[] {
  const groups: GapGroup[] = [];
  for (const c of candidates) {
    const key = c.gap.parts.join('+');
    const existing = groups.find((g) => g.gap.parts.join('+') === key);
    if (existing) existing.formations.push(c.formation);
    else groups.push({ formations: [c.formation], gap: c.gap });
  }
  return groups;
}

function renderGapLine(group: GapGroup): string {
  const all = group.formations.length === VALID_FORMATIONS.length;
  const label = all
    ? 'Alle zehn Formationen'
    : `<strong>${group.formations.map((f) => escapeHtml(f)).join('</strong>, <strong>')}</strong>`;
  const verb = group.gap.total === 1 ? 'fehlt' : 'fehlen';
  return `${label}: ${escapeHtml(formatGap(group.gap.parts))} ${verb}`;
}

function findClosestFormations(
  available: Record<PositionLabel, number>,
): { formation: string; gap: FormationGap }[] {
  const scored = VALID_FORMATIONS.map((formation) => ({
    formation,
    gap: gapFor(formation, available),
  })).filter((c) => c.gap.total > 0);
  if (scored.length === 0) return [];
  const best = Math.min(...scored.map((c) => c.gap.total));
  return scored.filter((c) => c.gap.total === best);
}

function gapFor(formation: string, available: Record<PositionLabel, number>): FormationGap {
  const parts = formation.split('-');
  const required: Record<PositionLabel, number> = {
    TW: 1,
    ABW: parseInt(parts[0] ?? '0', 10),
    MF: parseInt(parts[1] ?? '0', 10),
    ANG: parseInt(parts[2] ?? '0', 10),
  };
  const missing: string[] = [];
  let total = 0;
  for (const pos of POSITIONS) {
    const short = required[pos] - available[pos];
    if (short > 0) {
      missing.push(`${short} ${pos}`);
      total += short;
    }
  }
  return { total, parts: missing };
}

function formatGap(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}
