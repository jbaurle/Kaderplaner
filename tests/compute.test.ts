import { describe, expect, it } from 'vitest';
import type { SquadPlayer } from '../src/api/types.js';
import { computePlanning } from '../src/compute/planning.js';
import type { ScenarioState } from '../src/state/planning.js';

function player(overrides: Partial<SquadPlayer> & { id: string }): SquadPlayer {
  return {
    id: overrides.id,
    name: overrides.name ?? 'Player',
    position: overrides.position ?? 3,
    marketValue: overrides.marketValue ?? 1_000_000,
    mvgl: overrides.mvgl ?? 0,
    isInLineup: overrides.isInLineup ?? true,
    averagePoints: overrides.averagePoints ?? 0,
    status: overrides.status ?? 0,
    probability: overrides.probability ?? 0,
    teamId: overrides.teamId ?? '',
    imagePath: overrides.imagePath ?? '',
  };
}

const NO_SCENARIOS: ScenarioState = { byPlayer: {} };

describe('computePlanning', () => {
  it('returns an empty view for an empty squad', () => {
    const view = computePlanning({ budget: 1000, squad: [], scenarios: NO_SCENARIOS });

    expect(view.rows).toEqual([]);
    expect(view.formation).toBe('0-0-0');
    expect(view.lineupCount).toBe(0);
    expect(view.totalPlayers).toBe(0);
    expect(view.budget).toBe(1000);
    expect(view.totalMvgl).toBe(0);
    expect(view.summaries.S1).toEqual({
      salesSum: 0,
      bidsSum: 0,
      transactionSum: 0,
      newBalance: 1000,
      posCounts: { TW: 0, ABW: 0, MF: 0, ANG: 0 },
      totalKept: 0,
      isFormationValid: false,
      formationIssues: ['nur 0/11 Spieler', 'TW 0/1', 'ABW 0/3', 'MF 0/2', 'ANG 0/1'],
    });
  });

  it('sorts rows by position, then localised name (ä, ö, ü grouped sensibly)', () => {
    const squad = [
      player({ id: 'b', name: 'Bensebaini', position: 2 }),
      player({ id: 'd', name: 'Dahmen', position: 1 }),
      player({ id: 'a', name: 'Ångström', position: 2 }),
      player({ id: 'm', name: 'Müller', position: 3 }),
    ];
    const view = computePlanning({ budget: 0, squad, scenarios: NO_SCENARIOS });
    expect(view.rows.map((r) => r.id)).toEqual(['d', 'a', 'b', 'm']);
  });

  it('sums totalMvgl across all rows', () => {
    const view = computePlanning({
      budget: 0,
      squad: [
        player({ id: 'a', mvgl: 100 }),
        player({ id: 'b', mvgl: -40 }),
        player({ id: 'c', mvgl: 10 }),
      ],
      scenarios: NO_SCENARIOS,
    });

    expect(view.totalMvgl).toBe(70);
  });

  describe('S4 (auto-bench)', () => {
    it('is true for non-lineup players, false for lineup players, regardless of stored S1-S3', () => {
      const scenarios: ScenarioState = {
        byPlayer: {
          lineupPlayer: { S1: true, S2: true, S3: true },
        },
      };
      const view = computePlanning({
        budget: 0,
        squad: [
          player({ id: 'lineupPlayer', isInLineup: true }),
          player({ id: 'benchPlayer', isInLineup: false }),
        ],
        scenarios,
      });
      expect(view.rows.find((r) => r.id === 'lineupPlayer')?.flags.S4).toBe(false);
      expect(view.rows.find((r) => r.id === 'benchPlayer')?.flags.S4).toBe(true);
    });

    it("S4's transactionSum captures every non-lineup player's market value", () => {
      const view = computePlanning({
        budget: 0,
        squad: [
          player({ id: 'a', isInLineup: true, marketValue: 100 }),
          player({ id: 'b', isInLineup: false, marketValue: 200 }),
          player({ id: 'c', isInLineup: false, marketValue: 300 }),
        ],
        scenarios: NO_SCENARIOS,
      });
      expect(view.summaries.S4.transactionSum).toBe(500);
    });
  });

  describe('S1-S3 flags', () => {
    it('come from scenario state, default false when no entry', () => {
      const scenarios: ScenarioState = {
        byPlayer: { '1': { S1: true, S2: false, S3: true } },
      };
      const view = computePlanning({
        budget: 0,
        squad: [player({ id: '1' }), player({ id: '2' })],
        scenarios,
      });
      const row1 = view.rows.find((r) => r.id === '1');
      const row2 = view.rows.find((r) => r.id === '2');
      expect(row1?.flags).toMatchObject({ S1: true, S2: false, S3: true });
      expect(row2?.flags).toMatchObject({ S1: false, S2: false, S3: false });
    });
  });

  describe('per-scenario summaries', () => {
    it('transactionSum = Σ marketValue of sold players, newBalance = budget + transactionSum', () => {
      const scenarios: ScenarioState = {
        byPlayer: {
          a: { S1: true, S2: false, S3: false },
          b: { S1: true, S2: false, S3: false },
        },
      };
      const view = computePlanning({
        budget: 1000,
        squad: [
          player({ id: 'a', marketValue: 100 }),
          player({ id: 'b', marketValue: 250 }),
          player({ id: 'c', marketValue: 999 }),
        ],
        scenarios,
      });
      expect(view.summaries.S1.transactionSum).toBe(350);
      expect(view.summaries.S1.newBalance).toBe(1350);
      expect(view.summaries.S2.transactionSum).toBe(0);
      expect(view.summaries.S2.newBalance).toBe(1000);
    });

    it('posCounts counts kept (not sold) players by position', () => {
      const scenarios: ScenarioState = {
        byPlayer: { sold: { S1: true, S2: false, S3: false } },
      };
      const view = computePlanning({
        budget: 0,
        squad: [
          player({ id: 'tw1', position: 1 }),
          player({ id: 'sold', position: 2 }),
          player({ id: 'abw1', position: 2 }),
          player({ id: 'mf1', position: 3 }),
          player({ id: 'mf2', position: 3 }),
          player({ id: 'ang1', position: 4 }),
        ],
        scenarios,
      });
      expect(view.summaries.S1.posCounts).toEqual({ TW: 1, ABW: 1, MF: 2, ANG: 1 });
      expect(view.summaries.S1.totalKept).toBe(5);
      expect(view.summaries.S2.posCounts).toEqual({ TW: 1, ABW: 2, MF: 2, ANG: 1 });
      expect(view.summaries.S2.totalKept).toBe(6);
    });

    it('marks a scenario valid when the kept squad meets the minimum formation rules', () => {
      const view = computePlanning({
        budget: 0,
        squad: [
          player({ id: 'tw', position: 1 }),
          player({ id: 'abw1', position: 2 }),
          player({ id: 'abw2', position: 2 }),
          player({ id: 'abw3', position: 2 }),
          player({ id: 'mf1', position: 3 }),
          player({ id: 'mf2', position: 3 }),
          player({ id: 'mf3', position: 3 }),
          player({ id: 'ang1', position: 4 }),
          player({ id: 'ang2', position: 4 }),
          player({ id: 'ang3', position: 4 }),
          player({ id: 'ang4', position: 4 }),
        ],
        scenarios: NO_SCENARIOS,
      });

      expect(view.summaries.S1.isFormationValid).toBe(true);
    });

    it('marks a scenario invalid when no goalkeeper is kept', () => {
      const scenarios: ScenarioState = {
        byPlayer: { tw: { S1: true, S2: false, S3: false } },
      };
      const view = computePlanning({
        budget: 0,
        squad: [
          player({ id: 'tw', position: 1 }),
          player({ id: 'abw1', position: 2 }),
          player({ id: 'abw2', position: 2 }),
          player({ id: 'abw3', position: 2 }),
          player({ id: 'mf1', position: 3 }),
          player({ id: 'mf2', position: 3 }),
          player({ id: 'mf3', position: 3 }),
          player({ id: 'ang1', position: 4 }),
          player({ id: 'ang2', position: 4 }),
          player({ id: 'ang3', position: 4 }),
          player({ id: 'ang4', position: 4 }),
          player({ id: 'ang5', position: 4 }),
        ],
        scenarios,
      });

      expect(view.summaries.S1.posCounts.TW).toBe(0);
      expect(view.summaries.S1.totalKept).toBe(11);
      expect(view.summaries.S1.isFormationValid).toBe(false);
      expect(view.summaries.S1.formationIssues).toEqual(['TW 0/1']);
    });

    it('marks a scenario invalid when fewer than 11 players are kept', () => {
      const scenarios: ScenarioState = {
        byPlayer: { extra: { S1: true, S2: false, S3: false } },
      };
      const view = computePlanning({
        budget: 0,
        squad: [
          player({ id: 'tw', position: 1 }),
          player({ id: 'abw1', position: 2 }),
          player({ id: 'abw2', position: 2 }),
          player({ id: 'abw3', position: 2 }),
          player({ id: 'mf1', position: 3 }),
          player({ id: 'mf2', position: 3 }),
          player({ id: 'mf3', position: 3 }),
          player({ id: 'ang1', position: 4 }),
          player({ id: 'ang2', position: 4 }),
          player({ id: 'ang3', position: 4 }),
          player({ id: 'extra', position: 4 }),
        ],
        scenarios,
      });

      expect(view.summaries.S1.totalKept).toBe(10);
      expect(view.summaries.S1.isFormationValid).toBe(false);
      expect(view.summaries.S1.formationIssues).toEqual(['nur 10/11 Spieler']);
    });

    it('lists every position problem for an invalid scenario', () => {
      const view = computePlanning({
        budget: 0,
        squad: [
          player({ id: 'tw', position: 1 }),
          player({ id: 'abw1', position: 2 }),
          player({ id: 'mf1', position: 3 }),
          player({ id: 'ang1', position: 4 }),
          player({ id: 'ang2', position: 4 }),
          player({ id: 'ang3', position: 4 }),
          player({ id: 'ang4', position: 4 }),
          player({ id: 'ang5', position: 4 }),
          player({ id: 'ang6', position: 4 }),
          player({ id: 'ang7', position: 4 }),
          player({ id: 'ang8', position: 4 }),
        ],
        scenarios: NO_SCENARIOS,
      });

      expect(view.summaries.S1.isFormationValid).toBe(false);
      expect(view.summaries.S1.formationIssues).toEqual(['ABW 1/3', 'MF 1/2']);
    });

    it('keeps S1-S3 independent of each other', () => {
      const scenarios: ScenarioState = {
        byPlayer: {
          a: { S1: true, S2: false, S3: false },
          b: { S1: false, S2: true, S3: false },
          c: { S1: false, S2: false, S3: true },
        },
      };
      const view = computePlanning({
        budget: 0,
        squad: [
          player({ id: 'a', marketValue: 100 }),
          player({ id: 'b', marketValue: 200 }),
          player({ id: 'c', marketValue: 400 }),
        ],
        scenarios,
      });
      expect(view.summaries.S1.transactionSum).toBe(100);
      expect(view.summaries.S2.transactionSum).toBe(200);
      expect(view.summaries.S3.transactionSum).toBe(400);
    });
  });

  describe('formation + lineupCount (current lineup, not post-sale)', () => {
    it('counts only currently-lineup players, ignoring scenarios', () => {
      const scenarios: ScenarioState = {
        byPlayer: {
          starterToSell: { S1: true, S2: false, S3: false },
        },
      };
      const view = computePlanning({
        budget: 0,
        squad: [
          player({ id: 'tw', position: 1, isInLineup: true }),
          player({ id: 'abw1', position: 2, isInLineup: true }),
          player({ id: 'abw2', position: 2, isInLineup: true }),
          player({ id: 'mf1', position: 3, isInLineup: true }),
          player({ id: 'mf2', position: 3, isInLineup: true }),
          player({ id: 'mf3', position: 3, isInLineup: true }),
          player({ id: 'ang1', position: 4, isInLineup: true }),
          player({ id: 'starterToSell', position: 4, isInLineup: true }),
          player({ id: 'bench', position: 4, isInLineup: false }),
        ],
        scenarios,
      });
      // Ohne TW notiert, wie VALID_FORMATIONS: 2 ABW, 3 MF, 2 ANG.
      expect(view.formation).toBe('2-3-2');
      expect(view.lineupCount).toBe(8);
      expect(view.totalPlayers).toBe(9);
    });
  });

  describe('Zugänge (offene Gebote)', () => {
    // Über Marktwert geboten: 2.500 gezahlt, 2.000 bekommen.
    const transfer = {
      id: 't1',
      positionLabel: 'TW' as const,
      amount: 2_500,
      marketValue: 2_000,
      flags: { S1: true, S2: false, S3: false },
    };

    it('zieht das Gebot in jeder Spalte ab, auch in BANK', () => {
      const view = computePlanning({
        budget: 0,
        squad: [],
        scenarios: NO_SCENARIOS,
        transfers: [transfer],
      });
      for (const slot of ['S1', 'S2', 'S3', 'S4'] as const) {
        expect(view.summaries[slot].bidsSum).toBe(-2_500);
      }
    });

    it('bringt beim Verkauf den Marktwert zurück, nicht das Gebot', () => {
      const view = computePlanning({
        budget: 0,
        squad: [],
        scenarios: NO_SCENARIOS,
        transfers: [transfer],
      });
      expect(view.summaries.S1.salesSum).toBe(2_000);
      expect(view.summaries.S1.transactionSum).toBe(-500);
      expect(view.summaries.S1.newBalance).toBe(-500);
      // Ohne Häkchen bleibt er im Kader und zählt bei der Formation mit.
      expect(view.summaries.S2.salesSum).toBe(0);
      expect(view.summaries.S2.transactionSum).toBe(-2_500);
      expect(view.summaries.S2.posCounts.TW).toBe(1);
      expect(view.summaries.S1.posCounts.TW).toBe(0);
    });

    it('trennt Verkäufe und Gebote, transactionSum bleibt die Summe', () => {
      const view = computePlanning({
        budget: 10_000,
        squad: [player({ id: 'a', marketValue: 800, isInLineup: false })],
        scenarios: NO_SCENARIOS,
        transfers: [transfer],
      });
      const fix = view.summaries.S4;
      expect(fix.salesSum).toBe(800);
      expect(fix.bidsSum).toBe(-2_500);
      expect(fix.transactionSum).toBe(-1_700);
      expect(fix.newBalance).toBe(8_300);
    });
  });
});
