import { describe, expect, it } from 'vitest';
import type { MarketPlayer } from '../src/api/types.js';
import { planningRowFromMarketPlayer } from '../src/compute/planning.js';
import {
  renderPlayerDialog,
  type PerformanceView,
  type PlayerDialogInput,
} from '../src/ui/player-dialog.js';
import type { PlayerInsight } from '../src/compute/player-insight.js';

function marketPlayer(overrides: Partial<MarketPlayer> & { id: string }): MarketPlayer {
  return {
    id: overrides.id,
    name: overrides.name ?? 'Kandidat',
    firstName: overrides.firstName ?? '',
    position: overrides.position ?? 2,
    marketValue: overrides.marketValue ?? 10_000_000,
    price: overrides.price ?? 10_000_000,
    expiresInSeconds: overrides.expiresInSeconds ?? 0,
    offerCount: overrides.offerCount ?? 1,
    myOffer: overrides.myOffer ?? { amount: 10_000_000, offerId: 'o1' },
    offers: overrides.offers ?? [],
    status: overrides.status ?? 0,
    probability: overrides.probability ?? 0,
    averagePoints: overrides.averagePoints ?? 0,
    teamId: overrides.teamId ?? '2',
    imagePath: overrides.imagePath ?? '',
    trend: overrides.trend ?? 0,
  };
}

const EMPTY_INSIGHT: PlayerInsight = {
  teamValue: 0,
  sale: { proceeds: 0, creditDrop: 0, net: 0, headroomNow: 0, headroomAfter: 0 },
  lineup: {
    bestElevenNow: null,
    bestElevenAfter: null,
    successor: null,
    inBestEleven: false,
    formationHolds: true,
    position: 'ABW',
    countNow: 0,
    countAfter: 0,
  },
  matchdays: [],
};

const EMPTY_PERFORMANCE: PerformanceView = {
  performance: null,
  seasonId: null,
  isLoading: false,
  selectedDay: null,
  teams: {},
};

function dialogInput(overrides: Partial<PlayerDialogInput> = {}): PlayerDialogInput {
  return {
    playerId: overrides.playerId ?? 'p1',
    name: overrides.name ?? 'Spieler',
    firstName: overrides.firstName ?? '',
    statusText: overrides.statusText ?? '',
    positionLabel: overrides.positionLabel ?? 'ABW',
    position: overrides.position ?? 2,
    teamId: overrides.teamId ?? '2',
    teamName: overrides.teamName ?? '',
    imagePath: overrides.imagePath ?? '',
    status: overrides.status ?? 0,
    marketValue: overrides.marketValue ?? 10_000_000,
    saleValue: overrides.saleValue ?? 10_000_000,
    mvgl: overrides.mvgl ?? 0,
    mvChange1d: overrides.mvChange1d ?? 0,
    mvChange7d: overrides.mvChange7d ?? 0,
    score: overrides.score ?? null,
    listing: overrides.listing ?? null,
    bestOffer: overrides.bestOffer ?? 0,
    insight: overrides.insight ?? EMPTY_INSIGHT,
    performance: overrides.performance ?? EMPTY_PERFORMANCE,
    isOwned: overrides.isOwned ?? true,
    lineup: overrides.lineup ?? null,
  };
}

describe('planningRowFromMarketPlayer', () => {
  it('übernimmt die Kernfelder aus dem Marktspieler', () => {
    const player = marketPlayer({ id: 'p1', name: 'Kandidat', marketValue: 5_000_000, teamId: '9' });
    const row = planningRowFromMarketPlayer(player);
    expect(row.id).toBe('p1');
    expect(row.name).toBe('Kandidat');
    expect(row.marketValue).toBe(5_000_000);
    expect(row.teamId).toBe('9');
    expect(row.positionLabel).toBe('ABW');
  });

  it('markiert ihn als nicht im Kader und ohne eigenes Angebot', () => {
    const row = planningRowFromMarketPlayer(marketPlayer({ id: 'p1' }));
    expect(row.isInLineup).toBe(false);
    expect(row.listing).toBeNull();
    expect(row.gainLoss).toBe(0);
    expect(row.mvgl).toBe(0);
  });
});

describe('renderPlayerDialog: Marktwert-Trend', () => {
  it('zeigt beide Zeiträume mit Pfeil und Betrag ohne Vorzeichen', () => {
    const html = renderPlayerDialog(dialogInput({ mvChange1d: -372_176, mvChange7d: 2_590_095 }));
    expect(html).toContain('pd-mvtrend');
    expect(html).toContain('▼ 0,37');
    expect(html).toContain('▲ 2,59');
    expect(html).toContain('heute');
    expect(html).toContain('7 Tage');
  });

  it('lässt die Zeile weg, wenn Kickbase keine Trendwerte liefert', () => {
    const html = renderPlayerDialog(dialogInput({ mvChange1d: 0, mvChange7d: 0 }));
    expect(html).not.toContain('pd-mvtrend');
  });
});

describe('renderPlayerDialog: Verkaufsfolgen nur im eigenen Kader', () => {
  it('zeigt "Wenn du verkaufst" für einen Kaderspieler', () => {
    const html = renderPlayerDialog(dialogInput({ isOwned: true }));
    expect(html).toContain('Wenn du verkaufst');
  });

  it('blendet "Wenn du verkaufst" für einen Transferkandidaten aus', () => {
    const html = renderPlayerDialog(dialogInput({ isOwned: false }));
    expect(html).not.toContain('Wenn du verkaufst');
  });
});

describe('renderPlayerDialog: Aufstellungsstreifen', () => {
  it('bleibt weg, wenn der Dialog nicht aus dem Aufstellungsblatt kommt', () => {
    const html = renderPlayerDialog(dialogInput({ lineup: null }));
    expect(html).not.toContain('pd-lineup');
  });

  it('bietet "Aufstellen" für einen Spieler auf der Bank', () => {
    const html = renderPlayerDialog(dialogInput({ lineup: { fielded: false } }));
    expect(html).toContain('sitzt auf der Bank');
    expect(html).toContain('data-lineup-toggle="p1"');
    expect(html).toContain('>Aufstellen<');
  });

  it('bietet "Auf die Bank" für einen Spieler auf dem Feld', () => {
    const html = renderPlayerDialog(dialogInput({ lineup: { fielded: true } }));
    expect(html).toContain('steht auf dem Feld');
    expect(html).toContain('>Auf die Bank<');
  });
});

describe('renderPlayerDialog: Tore und Vorlagen je Spieltag', () => {
  // Ein Anstoß weit in der Vergangenheit, damit kein Spieltag als live gilt.
  function performanceWith(days: { points: number; goals?: number; ownGoals?: number; assists?: number }[]): PerformanceView {
    return {
      performance: {
        seasons: [{
          id: '35',
          title: '2025/2026',
          competition: 'Bundesliga',
          matchdays: days.map((day, index) => ({
            day: index + 1,
            points: day.points,
            minutes: 90,
            teamId: '2',
            opponentId: '9',
            home: true,
            goalsFor: 1,
            goalsAgainst: 0,
            kickoff: '2025-08-03T11:30:00Z',
            goals: day.goals ?? 0,
            ownGoals: day.ownGoals ?? 0,
            assists: day.assists ?? 0,
          })),
        }],
      },
      seasonId: '35',
      isLoading: false,
      selectedDay: null,
      teams: {},
    };
  }

  const markCount = (html: string): number => html.split('class="pd-perf-mark"').length - 1;

  it('stapelt ein Symbol je Ereignis in den Balken', () => {
    const html = renderPlayerDialog(dialogInput({
      performance: performanceWith([{ points: 400, goals: 2, assists: 1 }, { points: 100 }]),
    }));
    // Drei im Balken, dazu Tor und Vorlage in der Legende.
    expect(markCount(html)).toBe(5);
    expect(html).not.toContain('pd-perf-marks--top');
    expect(html).toContain('Spieltag 1, 400 Punkte, 2 Tore, 1 Vorlage');
  });

  it('stellt auf den Balken, was nicht hineinpasst', () => {
    const html = renderPlayerDialog(dialogInput({
      performance: performanceWith([{ points: 400 }, { points: -24, ownGoals: 1 }]),
    }));
    // Der Stummel für Minuspunkte ist 4 px hoch, das Symbol steht 1 px darüber.
    expect(html).toContain('class="pd-perf-marks pd-perf-marks--top" style="bottom:5px"');
    expect(html).toContain('Spieltag 2, -24 Punkte, 1 Eigentor');
  });

  it('nennt den Verein am Wappen der Reihe, sobald die Tabelle da ist', () => {
    const view = performanceWith([{ points: 100 }]);
    const crest = '<img src="https://kickbase.b-cdn.net/pool/teams/2.png" alt=""';

    expect(renderPlayerDialog(dialogInput({ performance: view }))).toContain(`${crest} width="16"`);

    const named = { ...view, teams: { '2': { name: 'Bayern', position: 1 } } };
    expect(renderPlayerDialog(dialogInput({ performance: named }))).toContain(`${crest} title="Bayern" width="16"`);
  });

  it('nennt in der Legende nur Symbole, die vorkommen', () => {
    const html = renderPlayerDialog(dialogInput({
      performance: performanceWith([{ points: 100 }]),
    }));
    expect(markCount(html)).toBe(0);
  });
});
