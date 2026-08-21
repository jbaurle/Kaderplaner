import { describe, expect, it } from 'vitest';
import {
  canPlace,
  countPositions,
  detectFormation,
  emptyCounts,
  explainBlock,
  isReachable,
  lineupIssues,
  squadFormationGap,
  type PositionCounts,
} from '../src/compute/lineup.js';
import type { PositionLabel } from '../src/compute/optimizer.js';

function counts(tw: number, abw: number, mf: number, ang: number): PositionCounts {
  return { TW: tw, ABW: abw, MF: mf, ANG: ang };
}

describe('countPositions', () => {
  it('zaehlt je Position', () => {
    const positions: PositionLabel[] = ['TW', 'ABW', 'ABW', 'MF', 'ANG', 'ANG'];
    expect(countPositions(positions)).toEqual(counts(1, 2, 1, 2));
  });
});

describe('isReachable', () => {
  it('leerer Stand ist erreichbar', () => {
    expect(isReachable(emptyCounts())).toBe(true);
  });

  it('zwei Torhueter sind es nie', () => {
    expect(isReachable(counts(2, 0, 0, 0))).toBe(false);
  });

  it('vier Stuermer bleiben erreichbar, solange 4-2-4 offen ist', () => {
    expect(isReachable(counts(1, 4, 2, 4))).toBe(true);
  });

  it('drei Mittelfeldspieler schliessen den vierten Stuermer aus', () => {
    // 4-2-4 ist die einzige Formation mit vier ANG und lässt nur 2 MF zu.
    expect(isReachable(counts(1, 3, 3, 4))).toBe(false);
  });
});

describe('canPlace', () => {
  it('erlaubt den vierten Stuermer bei 4-2-x', () => {
    expect(canPlace(counts(1, 4, 2, 3), 'ANG')).toBe(true);
  });

  it('sperrt den vierten Stuermer bei drei Mittelfeldspielern', () => {
    expect(canPlace(counts(1, 3, 3, 3), 'ANG')).toBe(false);
  });

  it('sperrt den zweiten Torwart', () => {
    expect(canPlace(counts(1, 0, 0, 0), 'TW')).toBe(false);
  });

  it('sperrt den sechsten Verteidiger', () => {
    expect(canPlace(counts(1, 5, 2, 3), 'ABW')).toBe(false);
  });
});

describe('detectFormation', () => {
  it('erkennt 4-2-4', () => {
    expect(detectFormation(counts(1, 4, 2, 4))).toBe('4-2-4');
  });

  it('erkennt 3-6-1', () => {
    expect(detectFormation(counts(1, 3, 6, 1))).toBe('3-6-1');
  });

  it('kennt 3-3-4 nicht, obwohl jede Position im Rahmen liegt', () => {
    expect(detectFormation(counts(1, 3, 3, 4))).toBeNull();
  });

  it('ohne elf Spieler gibt es keine Formation', () => {
    expect(detectFormation(counts(1, 4, 3, 2))).toBeNull();
  });
});

describe('lineupIssues', () => {
  it('meldet nichts, wenn die Elf steht', () => {
    expect(lineupIssues(counts(1, 4, 3, 3))).toEqual([]);
  });

  it('meldet fehlenden Torwart und Zahl', () => {
    expect(lineupIssues(counts(0, 4, 3, 3))).toEqual(['TW 0/1', '10/11 Spieler']);
  });

  it('nennt die Formation, die es nicht gibt', () => {
    expect(lineupIssues(counts(1, 3, 3, 4))).toEqual(['3-3-4 gibt es nicht']);
  });

  it('meldet die zu duenne Abwehr, wenn sechs MF nur noch 3-6-1 zulassen', () => {
    expect(lineupIssues(counts(0, 1, 6, 1))).toEqual(['TW 0/1', '8/11 Spieler', 'ABW 1/3']);
  });

  it('meldet jede unterbesetzte Reihe, auch ganz am Anfang', () => {
    expect(lineupIssues(counts(0, 1, 1, 0))).toEqual([
      'TW 0/1',
      '2/11 Spieler',
      'ABW 1/3',
      'MF 1/2',
      'ANG 0/1',
    ]);
  });
});

describe('explainBlock', () => {
  it('nennt 4-2-4 als einzigen Weg zum vierten Stuermer', () => {
    const text = explainBlock(counts(1, 3, 3, 3), 'ANG');
    expect(text).toContain('4-2-4');
    expect(text).toContain('MF auf 2');
  });

  it('sagt bei voller Elf, dass erst jemand weichen muss', () => {
    expect(explainBlock(counts(1, 4, 3, 3), 'ANG')).toContain('voll');
  });

  it('sagt beim Torwart, dass schon einer steht', () => {
    expect(explainBlock(counts(1, 3, 3, 2), 'TW')).toContain('Torwart');
  });
});

describe('squadFormationGap', () => {
  it('meldet nichts, solange eine Formation aufgeht', () => {
    expect(squadFormationGap(counts(1, 4, 4, 2))).toEqual([]);
  });

  it('stört sich nicht an Überzahl', () => {
    expect(squadFormationGap(counts(2, 8, 7, 5))).toEqual([]);
  });

  it('nennt den Torwart zuerst', () => {
    expect(squadFormationGap(counts(0, 5, 4, 2))).toEqual(['TW 0/1']);
  });

  it('findet die Lücke, die keine Untergrenze zeigt', () => {
    // 6 ABW, 3 MF, 1 ANG hält jede Untergrenze ein. Am nächsten liegt 5-3-2,
    // dafür fehlt ein Angreifer.
    expect(squadFormationGap(counts(1, 6, 3, 1))).toEqual(['ANG 1/2']);
  });

  it('zählt bei mehreren Lücken alle auf', () => {
    expect(squadFormationGap(counts(1, 3, 1, 1))).toEqual(['ABW 3/4', 'MF 1/4', 'ANG 1/2']);
  });
});
