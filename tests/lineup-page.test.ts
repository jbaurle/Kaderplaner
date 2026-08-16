/**
 * Die Reihenfolge in der Reihe. Sie kommt seit dem Ziehen mit Lücke aus der
 * Liste und nicht mehr aus dem Score: wer an dritter Stelle abgelegt wurde,
 * steht dort auch nach dem Loslassen.
 *
 * Das Ziehen selbst braucht `elementFromPoint` und echte Zeiger-Ereignisse und
 * bleibt deshalb aussen vor. Geprüft wird der Zustand darunter, den das
 * Ziehen ändert: welche Elf gespeichert wird und in welcher Folge die Kreise
 * im Markup stehen.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { LineupPage, type LineupPlayer } from '../src/ui/lineup-page.js';
import type { PositionLabel } from '../src/compute/optimizer.js';

// jsdom kennt kein Scrollen. Die Seite schiebt das Band an die Gruppe, sobald
// jemand vom Feld geht; ohne diesen Platzhalter wirft das im Test.
Element.prototype.scrollIntoView ??= (): void => {};

function player(id: string, name: string, pos: PositionLabel): LineupPlayer {
  return {
    id,
    name,
    positionLabel: pos,
    marketValue: 1_000_000,
    teamId: 't1',
    status: 0,
    probability: 0,
    imagePath: '',
    isInLineup: false,
  };
}

const PLAYERS: LineupPlayer[] = [
  player('a', 'Abele', 'ABW'),
  player('b', 'Bauer', 'ABW'),
  player('c', 'Conrad', 'ABW'),
  player('t', 'Trapp', 'TW'),
];

/** Absteigender Score: `a` ist der beste, `c` der schlechteste. */
const SCORES = { a: { score: 0.9 }, b: { score: 0.5 }, c: { score: 0.1 }, t: { score: 0.7 } };

function open(initialIds: string[] = []): { saved: string[][]; layer: HTMLElement } {
  const saved: string[][] = [];
  const page = new LineupPage({
    players: PLAYERS,
    budget: 0,
    scores: SCORES,
    bestEleven: null,
    initialIds,
    onChange: (ids) => saved.push([...ids]),
    onSubmit: () => Promise.resolve(),
    onClose: () => {},
  });
  page.open();
  const layer = document.querySelector<HTMLElement>('.lineup-layer');
  if (!layer) throw new Error('Ebene fehlt');
  return { saved, layer };
}

function click(layer: HTMLElement, selector: string): void {
  const el = layer.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`nicht gefunden: ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function rowNames(layer: HTMLElement, row: PositionLabel): string[] {
  const tokens = layer.querySelectorAll<HTMLElement>(`[data-row="${row}"] .tok .tok-name`);
  return [...tokens].map((el) => el.textContent ?? '');
}

afterEach(() => {
  for (const layer of document.querySelectorAll('.lineup-layer')) layer.remove();
});

describe('LineupPage: Reihenfolge', () => {
  it('stellt in der Folge auf, in der getippt wurde, nicht nach Score', () => {
    const { saved, layer } = open();
    click(layer, '.bench-card[data-player-id="c"]');
    click(layer, '.bench-card[data-player-id="a"]');
    click(layer, '.bench-card[data-player-id="b"]');

    expect(saved.at(-1)).toEqual(['c', 'a', 'b']);
    expect(rowNames(layer, 'ABW')).toEqual(['Conrad', 'Abele', 'Bauer']);
  });

  it('behaelt die Folge der uebrigen, wenn einer vom Feld geht', () => {
    const { saved, layer } = open(['c', 'a', 'b']);
    click(layer, '[data-row="ABW"] .tok[data-player-id="a"]');

    expect(saved.at(-1)).toEqual(['c', 'b']);
    expect(rowNames(layer, 'ABW')).toEqual(['Conrad', 'Bauer']);
  });

  it('uebernimmt die gespeicherte Folge beim Oeffnen', () => {
    const { layer } = open(['b', 'c', 'a']);
    expect(rowNames(layer, 'ABW')).toEqual(['Bauer', 'Conrad', 'Abele']);
  });
});
