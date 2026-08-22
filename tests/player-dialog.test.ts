import { describe, expect, it } from 'vitest';
import type { MarketPlayer } from '../src/api/types.js';
import { planningRowFromMarketPlayer } from '../src/compute/planning.js';
import { renderPlayerDialog, type PlayerDialogInput } from '../src/ui/player-dialog.js';
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
    score: overrides.score ?? null,
    listing: overrides.listing ?? null,
    bestOffer: overrides.bestOffer ?? 0,
    insight: overrides.insight ?? EMPTY_INSIGHT,
    isOwned: overrides.isOwned ?? true,
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
