/**
 * Hilfe-Overlays. Drei Inhalte, ein Rahmen:
 *
 *   - `features`   die Features-Seite, eingebettet als Rahmen.
 *   - `score`      statische Erklärung, wie der Score zustande kommt.
 *   - `formation`  datenabhängige Begründung, warum keine gültige
 *                  Formation möglich ist.
 *
 * Reine Renderer. Öffnen, Schliessen und die Auswahl steuert
 * `planning-page.ts` über `state.modal`.
 */

import { VALID_FORMATIONS, type PositionLabel } from '../compute/optimizer.js';
import { escapeHtml } from './format.js';

export type HelpModal = 'features' | 'score' | 'formation';

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

export const FEATURES_HELP_TITLE = 'Alle Features im Überblick';

/*
 * Kein eigener Text mehr: der Dialog zeigt die Features-Seite selbst, damit
 * es nur eine Fassung gibt. ?embed=1 blendet dort Kopf und Fusszeile aus,
 * das Thema liest die Seite selbst aus dem localStorage.
 */
export const FEATURES_HELP_BODY = `
  <iframe class="help-frame" src="/features.html?embed=1"
          title="Alle Features im Überblick"></iframe>
`;

export const SCORE_HELP_TITLE = 'Wie der Score entsteht';

export const SCORE_HELP_BODY = `
  <p>
    Der Score sagt, wie gut ein <strong>Spieler selbst</strong> in den nächsten
    Spieltag geht: Form, Startelf-Prognose und Verfügbarkeit. Ein Wert zwischen
    0 und 100 %, gedacht zum Vergleich innerhalb deines eigenen Kaders.
  </p>

  <p class="help-formula">
    Score = (35 % Form + 55 % Startelf + 10 % Sockel) × Verfügbarkeit
  </p>

  <p>
    Im Spielerdialog stehen die drei Teile als Balken nebeneinander. Startelf
    heißt dort kurz <strong>S11</strong>, sonst passt die Beschriftung nicht
    neben den Balken.
  </p>

  <p>
    Der Gegner steckt nicht darin. Er sagt nichts über den Spieler, sondern
    über den Spieltag, und stünde er mit in der Zahl, sänke sie mit einer
    schweren Ansetzung, obwohl sich am Spieler nichts geändert hat. Er steht
    deshalb in seiner eigenen Spalte, als Wappen mit Tendenzpfeil.
  </p>

  <dl class="help-list">
    <dt>Startelf 55 %</dt>
    <dd>
      Die Kickbase-Wahrscheinlichkeit 1 bis 5, umgesetzt als
      100 % · 85 % · 65 % · 40 % · 20 %. Der mit Abstand größte Anteil, denn wer
      nicht spielt, punktet nicht. Dagegen gerechnet werden die letzten
      Einsätze, 70 % Prognose zu 30 % Wirklichkeit: wer als sicher gilt, aber
      seit Wochen nicht auflief, wird gedämpft. Fehlt die Angabe, zählen allein
      die Einsätze; fehlen die, bleibt die Prognose allein stehen.
    </dd>

    <dt>Form 35 %</dt>
    <dd>
      Die letzten Spieltage, die Kickbase zum Spieler mitliefert, abklingend
      gewichtet: der jüngste zählt voll, danach 70 %, 49 % und so weiter. Das
      Ergebnis wird 70/30 mit dem Saisonschnitt gemischt. 50 Punkte ergeben
      0 %, 170 Punkte ergeben 100 %. Spieltage ohne Einsatz zählen nicht mit.
    </dd>

    <dt>Gegner, nur bei der Auswahl</dt>
    <dd>
      Der Tabellenplatz des nächsten Gegners, umgedreht: schwacher Gegner heißt
      hoher Wert. In der angezeigten Zahl steckt er nicht, wohl aber in der
      Frage, wer in die grün markierte Elf kommt: bei fast gleichem Stand
      entscheidet er. Die Ansetzung dafür steht im Spielerdetail, nicht im
      Spielplan, aus dem die Gegner-Spalte kommt. Fehlt sie dort, oder hat noch
      kein Verein drei Spiele gespielt, zählt er neutral.
    </dd>

    <dt>Sockel 10 %</dt>
    <dd>Konstant, damit ein einsatzfähiger Spieler nie bei 0 landet.</dd>

    <dt>Verfügbarkeit</dt>
    <dd>
      Kein Summand, sondern ein Faktor auf das Ganze. Fit zählt voll, ein
      Ausfall setzt den Score auf 0. Deshalb heißt <strong>0 %</strong> immer
      „fällt aus“, und ein fitter Spieler kommt nie unter 10 %. Kickbase führt
      dazwischen noch einen Status, der 30 % abzieht; in echten Daten ist er
      bisher nicht aufgetaucht.
    </dd>
  </dl>

  <h3>Die grün markierten 11</h3>
  <p>
    Das sind nicht einfach die elf höchsten Werte. Der Optimizer probiert alle
    zehn gültigen Formationen durch und wählt die beste Elf, bei der der Verkauf
    aller übrigen Spieler den Kontostand ins Plus bringt. Schafft das keine
    Formation, kommt trotzdem die beste Elf, und die Fußzeile sagt dazu, dass
    das Konto im Minus bleibt. Dazu kommen Paar-Effekte: zwei eigene Spieler
    aus demselben Verein verstärken sich leicht, zwei eigene Spieler, die
    gegeneinander spielen, ziehen sich runter.
  </p>
  <p>
    Ausgewählt wird außerdem mit dem Gegner, obwohl er in der Zahl nicht steht.
    Bei fast gleichem Stand geht der mit der leichteren Ansetzung vor. Deshalb
    kann ein Spieler mit ein paar Prozent weniger in der markierten Elf stehen
    als einer daneben.
  </p>

  <h3>Was der Score nicht sagt</h3>
  <ul class="help-list-plain">
    <li>Nichts über Marktwert, Kaufpreis oder ob sich ein Transfer lohnt.</li>
    <li>Keine Punktprognose in absoluten Zahlen. 72 % heißt nicht 72 Punkte.</li>
    <li>
      Nichts über deine Kaderstruktur. Ein starker Verteidiger nützt dir nichts,
      wenn dir Stürmer fehlen.
    </li>
  </ul>

  <h3>In der Vorbereitung eingeschränkt</h3>
  <p>
    Zwischen den Saisons steht die Tabelle auf null und es gibt keinen nächsten
    Gegner. Die Form kommt noch aus den letzten Spieltagen der Vorsaison, übrig
    bleibt praktisch die Startelf-Wahrscheinlichkeit. Auf die Zahl schlägt das
    weniger durch als früher, weil der Gegner ohnehin nicht mehr mitzählt; die
    Auswahl der Elf trifft es dagegen schon. Sobald ein Verein drei Spiele
    gespielt hat, greifen Tabelle und Gegner wieder.
  </p>
`;

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
