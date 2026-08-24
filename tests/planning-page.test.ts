/**
 * Der Async-Pfad hinter dem Spielerdialog: Öffnen stößt eine Anfrage nach den
 * Punkten je Spieltag an, und die Antwort darf nur wirken, wenn der Dialog
 * noch zu diesem Spieler gehört. Die Seite bleibt im Lade-Skelett (kein
 * `start()`), es geht hier nur um den Zustand, nicht ums Markup.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KickbaseClient } from '../src/api/kickbase.js';
import type { PlayerId, PlayerPerformance } from '../src/api/types.js';
import { PlanningPage } from '../src/ui/planning-page.js';
import { savePerformance } from '../src/state/performance.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function performanceWith(seasonId: string): PlayerPerformance {
  return {
    seasons: [
      {
        id: seasonId,
        title: `Saison ${seasonId}`,
        competition: 'Bundesliga',
        matchdays: [
          {
            day: 1,
            points: 100,
            minutes: 90,
            teamId: '2',
            opponentId: '9',
            goalsFor: 1,
            goalsAgainst: 0,
            kickoff: '2025-08-03T11:30:00Z',
          },
        ],
      },
    ],
  };
}

/**
 * Seite mit gestubbtem Client. `getPlayerPerformance` liefert je Spieler ein
 * steuerbares Promise, damit der Test die Reihenfolge der Antworten bestimmt.
 */
function makePage(): {
  page: PlanningPage;
  pending: Map<PlayerId, ReturnType<typeof deferred<PlayerPerformance>>>;
  performanceCalls: PlayerId[];
} {
  const pending = new Map<PlayerId, ReturnType<typeof deferred<PlayerPerformance>>>();
  const performanceCalls: PlayerId[] = [];
  const client = {
    getPlayerPerformance: vi.fn(async (_league: string, playerId: PlayerId) => {
      performanceCalls.push(playerId);
      const entry = deferred<PlayerPerformance>();
      pending.set(playerId, entry);
      return entry.promise;
    }),
  } as unknown as KickbaseClient;

  const page = new PlanningPage({
    host: document.createElement('div'),
    client,
    leagueId: 'l1',
    leagueName: 'Testliga',
    leagues: [],
    userLabel: 'manager@example.com',
    onSelectLeague: () => {},
    onLogout: () => {},
    onUnauthorized: () => {},
  });
  return { page, pending, performanceCalls };
}

/* Die Privaten der Seite, soweit der Test sie braucht. */
interface PageInternals {
  openModal(kind: { kind: 'player'; playerId: PlayerId }): void;
  closeModal(): void;
  state: {
    performanceSeason: string | null;
    performanceLoading: PlayerId | null;
    performance: Record<PlayerId, PlayerPerformance>;
  };
}

function internals(page: PlanningPage): PageInternals {
  return page as unknown as PageInternals;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('PlanningPage, Punkte je Spieltag', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('setzt nach der Antwort die Standardsaison des offenen Spielers', async () => {
    const { page, pending } = makePage();
    const p = internals(page);

    p.openModal({ kind: 'player', playerId: 'A' });
    expect(p.state.performanceLoading).toBe('A');

    pending.get('A')!.resolve(performanceWith('35'));
    await settle();

    expect(p.state.performanceSeason).toBe('35');
    expect(p.state.performanceLoading).toBeNull();
    expect(p.state.performance['A']?.seasons[0]?.id).toBe('35');
  });

  it('lässt eine späte Antwort nicht die Saison des nächsten Spielers setzen', async () => {
    const { page, pending } = makePage();
    const p = internals(page);

    // A öffnen, schließen, B öffnen — A's Antwort ist noch unterwegs.
    p.openModal({ kind: 'player', playerId: 'A' });
    p.closeModal();
    p.openModal({ kind: 'player', playerId: 'B' });

    pending.get('A')!.resolve(performanceWith('35'));
    await settle();
    // B hat noch nichts geliefert, also darf auch keine Saison gewählt sein.
    expect(p.state.performanceSeason).toBeNull();

    pending.get('B')!.resolve(performanceWith('42'));
    await settle();
    expect(p.state.performanceSeason).toBe('42');
  });

  it('respektiert eine Saison, die während der Anfrage gewählt wurde', async () => {
    const { page, pending } = makePage();
    const p = internals(page);

    p.openModal({ kind: 'player', playerId: 'A' });
    p.state.performanceSeason = '26';

    pending.get('A')!.resolve(performanceWith('35'));
    await settle();
    expect(p.state.performanceSeason).toBe('26');
  });

  it('fragt bei frischem Cache nicht erneut an und öffnet dessen Saison', async () => {
    savePerformance('l1', 'A', performanceWith('35'));
    const { page, performanceCalls } = makePage();
    const p = internals(page);

    p.openModal({ kind: 'player', playerId: 'A' });
    await settle();

    expect(performanceCalls).toHaveLength(0);
    expect(p.state.performanceSeason).toBe('35');
    expect(p.state.performance['A']?.seasons[0]?.id).toBe('35');
  });

  it('fragt bei abgelaufenem Cache erneut an', async () => {
    savePerformance('l1', 'A', performanceWith('26'), Date.now() - 7 * 60 * 60 * 1000);
    const { page, pending, performanceCalls } = makePage();
    const p = internals(page);

    p.openModal({ kind: 'player', playerId: 'A' });
    // Der alte Stand steht sofort da, die Anfrage läuft trotzdem.
    expect(p.state.performanceSeason).toBe('26');
    expect(performanceCalls).toEqual(['A']);

    pending.get('A')!.resolve(performanceWith('35'));
    await settle();
    expect(p.state.performance['A']?.seasons[0]?.id).toBe('35');
  });
});
