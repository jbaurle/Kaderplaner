/**
 * Die Statistik-Ebene: Reiter, Umschalter und der Weg der Daten. Die
 * Rechnung dahinter steht in `stats.test.ts`, hier geht es um das Markup und
 * darum, was die Ebene wann holt und ablegt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KickbaseError, type KickbaseClient } from '../src/api/kickbase.js';
import type { LeagueRanking, ManagerPerformance } from '../src/api/types.js';
import { loadStats, saveStats } from '../src/state/stats.js';
import { StatsPage } from '../src/ui/stats-page.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/*
 * Anstoß je Spieltag im Wochentakt: Spieltag 4 liegt vier Tage zurück und ist
 * durch, Spieltag 5 kommt erst in drei Tagen. So sind es genau vier
 * gespielte Spieltage und keiner offen.
 */
const START = Date.now() - 25 * DAY_MS;
const kickoffOf = (day: number): string => new Date(START + (day - 1) * 7 * DAY_MS).toISOString();

const RANKING: LeagueRanking = {
  leagueName: 'Test',
  managers: [
    { id: 'a', name: 'Anna', imagePath: '', seasonPoints: 340, seasonPlace: 2, dayPoints: 0, dayPlace: 0, teamValue: 0 },
    { id: 'b', name: 'Ben', imagePath: 'user/ben.png', seasonPoints: 355, seasonPlace: 1, dayPoints: 0, dayPlace: 0, teamValue: 0 },
  ],
};

function performance(id: string, points: number[]): ManagerPerformance {
  return {
    managerId: id,
    managerName: id,
    seasons: [{
      id: '2', title: '2026/2027', place: 0, averagePoints: 0, totalPoints: 0, wins: 0,
      matchdays: Array.from({ length: 34 }, (_, i) => ({
        day: i + 1, points: points[i] ?? 0, kickoff: kickoffOf(i + 1), won: false,
      })),
    }],
  };
}

const PERFORMANCES: Record<string, ManagerPerformance> = {
  a: performance('a', [100, 50, 120, 70]),
  b: performance('b', [80, 90, 110, 75]),
};

function fakeClient() {
  return {
    getMe: vi.fn().mockResolvedValue({ id: 'a', name: 'Anna' }),
    getLeagueRanking: vi.fn().mockResolvedValue(RANKING),
    getManagerPerformance: vi.fn((_league: string, id: string) => Promise.resolve(PERFORMANCES[id])),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function open(client = fakeClient(), onUnauthorized = (): void => {}) {
  const page = new StatsPage({
    client: client as unknown as KickbaseClient,
    leagueId: 'L1',
    kickoffs: null,
    onClose: () => {},
    onUnauthorized,
  });
  page.open();
  const layer = document.querySelector<HTMLElement>('.stats-layer');
  if (!layer) throw new Error('Ebene fehlt');
  return { page, layer, client };
}

function click(layer: HTMLElement, selector: string): void {
  const el = layer.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`nicht gefunden: ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const texts = (layer: HTMLElement, selector: string): string[] =>
  [...layer.querySelectorAll<HTMLElement>(selector)].map((el) => el.textContent?.trim() ?? '');

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  for (const layer of document.querySelectorAll('.stats-layer')) layer.remove();
  document.body.classList.remove('is-stats-open');
});

describe('StatsPage: Daten', () => {
  it('holt erst die Rangliste, dann je Manager die Historie, und legt beides ab', async () => {
    const { layer, client } = open();
    expect(layer.querySelector('.st-placeholder')?.textContent).toContain('geladen');
    await settle();

    expect(client.getMe).toHaveBeenCalledTimes(1);
    expect(client.getLeagueRanking).toHaveBeenCalledWith('L1');
    expect(client.getManagerPerformance).toHaveBeenCalledTimes(2);
    expect(layer.querySelector('.st-place')?.textContent).toContain('2.');
    expect(layer.querySelectorAll('.st-day')).toHaveLength(4);

    const cached = loadStats('L1');
    expect(cached?.userId).toBe('a');
    expect(Object.keys(cached?.performances ?? {})).toEqual(['a', 'b']);
  });

  it('zeigt einen frischen Cache ohne eine einzige Anfrage', async () => {
    saveStats('L1', { userId: 'a', ranking: RANKING, performances: PERFORMANCES });
    const { layer, client } = open();
    await settle();
    expect(client.getLeagueRanking).not.toHaveBeenCalled();
    expect(layer.querySelectorAll('.st-day')).toHaveLength(4);
  });

  it('holt einen alten Cache neu, zeigt ihn aber solange', async () => {
    saveStats('L1', { userId: 'a', ranking: RANKING, performances: PERFORMANCES }, Date.now() - 2 * 60 * 60 * 1000);
    const { layer, client } = open();
    expect(layer.querySelectorAll('.st-day')).toHaveLength(4);
    await settle();
    expect(client.getLeagueRanking).toHaveBeenCalledTimes(1);
    // Die Id ist bekannt, `user/me` wird nicht noch einmal gefragt.
    expect(client.getMe).not.toHaveBeenCalled();
  });

  it('schließt sich bei verworfenem Token und meldet es', async () => {
    const client = fakeClient();
    client.getLeagueRanking.mockRejectedValue(new KickbaseError(403, 'verboten'));
    const onUnauthorized = vi.fn();
    open(client, onUnauthorized);
    await settle();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.stats-layer')).toBeNull();
  });

  it('nennt einen anderen Fehler und bietet einen neuen Versuch an', async () => {
    const client = fakeClient();
    client.getLeagueRanking.mockRejectedValueOnce(new KickbaseError(500, 'kaputt'));
    const { layer } = open(client);
    await settle();
    expect(layer.querySelector('.st-placeholder')?.textContent).toContain('kaputt');
    click(layer, '[data-retry]');
    await settle();
    expect(layer.querySelectorAll('.st-day')).toHaveLength(4);
  });
});

describe('StatsPage: Reiter und Umschalter', () => {
  it('hat die Reiter Ich, Saison und Tabelle', async () => {
    const { layer } = open();
    await settle();
    expect(texts(layer, '.stats-tab')).toEqual(['Ich', 'Saison', 'Tabelle']);
    expect(layer.querySelector('.stats-tab[aria-pressed="true"]')?.textContent).toBe('Ich');
  });

  it('die Kreuztabelle: Manager, Gesamt, dann die Spieltage absteigend', async () => {
    const { layer } = open();
    await settle();
    click(layer, '[data-tab="tabelle"]');
    expect(layer.querySelector('.st-title')?.textContent).toBe('Spieltage 1 bis 4');
    expect(texts(layer, '.st-matrix thead th')).toEqual(['Manager', 'Gesamt', '4', '3', '2', '1']);
    expect(texts(layer, '.st-matrix tbody .st-name')).toEqual(['Ben', 'Anna']);
    // Ben: 355 gesamt, dann ST 4 bis 1.
    expect(texts(layer, '.st-matrix tbody tr:first-child td')).toEqual(['Ben', '355', '75', '110', '90', '80']);
  });

  it('zeigt statt "auf den Besten" den Vorsprung, wenn nie etwas fehlte', async () => {
    const { layer } = open();
    await settle();
    expect(texts(layer, '.st-fig span')).toContain('AUF DEN BESTEN');
    // Spieltag 2 fehlten 40, Spieltag 4 fehlten 5.
    expect(texts(layer, '.st-fig b.st-neg')).toEqual(['-45']);

    const client = fakeClient();
    const ahead = { a: performance('a', [100, 95, 120, 80]), b: performance('b', [80, 90, 110, 75]) };
    client.getManagerPerformance.mockImplementation((_league: string, id: string) => Promise.resolve(ahead[id as 'a' | 'b']));
    localStorage.clear();
    for (const old of document.querySelectorAll('.stats-layer')) old.remove();
    const second = open(client);
    await settle();
    expect(texts(second.layer, '.st-fig span')).toContain('VOR DEM ZWEITEN');
    expect(texts(second.layer, '.st-fig b.st-pos')).toEqual(['+40']);
  });

  it('markiert den Spieltagssieg grün', async () => {
    const won = {
      a: performance('a', [100, 50, 120, 70]),
      b: performance('b', [80, 90, 110, 75]),
    };
    won.a.seasons[0]!.matchdays[0]!.won = true;
    won.b.seasons[0]!.matchdays[1]!.won = true;
    const client = fakeClient();
    client.getManagerPerformance.mockImplementation((_league: string, id: string) => Promise.resolve(won[id as 'a' | 'b']));
    const { layer } = open(client);
    await settle();
    click(layer, '[data-tab="tabelle"]');
    const wins = [...layer.querySelectorAll<HTMLElement>('.st-cell-win')].map((el) => el.textContent);
    expect(wins).toEqual(['90', '100']);
  });

  it('Saison zeigt das Podium und ab drei Spieltagen die Meilensteine', async () => {
    const { layer } = open();
    await settle();
    click(layer, '[data-tab="saison"]');
    expect(texts(layer, '.st-slot-name')).toEqual(['Anna', 'Ben']);
    expect(layer.querySelectorAll('.st-card')).toHaveLength(6);
  });

  it('Escape und das Kreuz schließen die Ebene', async () => {
    const { layer } = open();
    await settle();
    layer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.stats-layer')).toBeNull();
    expect(document.body.classList.contains('is-stats-open')).toBe(false);
  });
});
