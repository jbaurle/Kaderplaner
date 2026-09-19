/**
 * Die Statistik-Ebene: Tabs, Toggle und der Weg der Daten. Die
 * Rechnung dahinter steht in `stats.test.ts`, hier geht es um das Markup und
 * darum, was die Ebene wann holt und ablegt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KickbaseError, type KickbaseClient } from '../src/api/kickbase.js';
import type { LeagueRanking, ManagerPerformance, PointAdjustment } from '../src/api/types.js';
import { loadStats, saveStats } from '../src/state/stats.js';
import { StatsPage } from '../src/ui/stats-page.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/*
 * Anstoß je Spieltag im Wochentakt: Spieltag 4 liegt vier Tage zurück und ist
 * durch, Spieltag 5 kommt erst in drei Tagen. So sind es genau vier
 * gespielte Spieltage und keiner offen.
 */
const START = Date.now() - 25 * DAY_MS;
const kickoffOf = (day: number, start = START): string =>
  new Date(start + (day - 1) * 7 * DAY_MS).toISOString();

const RANKING: LeagueRanking = {
  leagueName: 'Test',
  managers: [
    { id: 'a', name: 'Anna', imagePath: '', seasonPoints: 340, seasonPlace: 2, dayPoints: 0, dayPlace: 0, teamValue: 0 },
    { id: 'b', name: 'Ben', imagePath: 'user/ben.png', seasonPoints: 355, seasonPlace: 1, dayPoints: 0, dayPlace: 0, teamValue: 0 },
  ],
};

function performance(id: string, points: number[], start = START): ManagerPerformance {
  return {
    managerId: id,
    managerName: id,
    seasons: [{
      id: '2', title: '2026/2027', place: 0, averagePoints: 0, wins: 0,
      totalPoints: points.reduce((sum, p) => sum + p, 0),
      matchdays: Array.from({ length: 34 }, (_, i) => ({
        day: i + 1, points: points[i] ?? 0, kickoff: kickoffOf(i + 1, start), won: false,
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
    getPointAdjustments: vi.fn((): Promise<PointAdjustment[]> => Promise.resolve([])),
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
    expect(client.getPointAdjustments).toHaveBeenCalledWith('L1');
    expect(layer.querySelector('.st-place')?.textContent).toContain('2.');
    expect(layer.querySelectorAll('.st-mine')).toHaveLength(4);

    const cached = loadStats('L1');
    expect(cached?.userId).toBe('a');
    expect(Object.keys(cached?.performances ?? {})).toEqual(['a', 'b']);
    expect(cached?.adjustments).toEqual([]);
  });

  it('zeigt einen frischen Cache ohne eine einzige Anfrage', async () => {
    saveStats('L1', { userId: 'a', ranking: RANKING, performances: PERFORMANCES, adjustments: [] });
    const { layer, client } = open();
    await settle();
    expect(client.getLeagueRanking).not.toHaveBeenCalled();
    expect(layer.querySelectorAll('.st-mine')).toHaveLength(4);
  });

  it('holt einen alten Cache neu, zeigt ihn aber solange', async () => {
    saveStats(
      'L1',
      { userId: 'a', ranking: RANKING, performances: PERFORMANCES, adjustments: [] },
      Date.now() - 2 * 60 * 60 * 1000,
    );
    const { layer, client } = open();
    expect(layer.querySelectorAll('.st-mine')).toHaveLength(4);
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
    expect(layer.querySelectorAll('.st-mine')).toHaveLength(4);
  });
});

describe('StatsPage: Tabs und Toggle', () => {
  it('hat die Tabs Ich, Saison und Tabelle', async () => {
    const { layer } = open();
    await settle();
    expect(texts(layer, '.stats-tab')).toEqual(['Ich', 'Saison', 'Tabelle']);
    expect(layer.querySelector('.stats-tab[aria-pressed="true"]')?.textContent).toBe('Ich');
  });

  it('zeigt alle Spieltage der Halbserie, offene als Platzhalter', async () => {
    const { layer } = open();
    await settle();
    // 34 Spieltage, also 17 je Halbserie: vier gespielte, dreizehn offene.
    expect(layer.querySelectorAll('.st-day')).toHaveLength(17);
    expect(layer.querySelectorAll('.st-day--empty')).toHaveLength(13);
    expect(layer.querySelectorAll('.st-empty')).toHaveLength(13);
    // Die Punkte stehen an jedem gespielten Spieltag.
    expect(texts(layer, '.st-points').slice(0, 4)).toEqual(['100', '50', '120', '70']);
  });

  it('zeichnet den laufenden Spieltag als Säule, ohne Platz und Punkte', async () => {
    // Spieltag 4 stieg gestern an, das Fenster von dreieinhalb Tagen läuft.
    const running = Date.now() - 22 * DAY_MS;
    const client = fakeClient();
    const live = {
      a: performance('a', [100, 50, 120, 70], running),
      b: performance('b', [80, 90, 110, 75], running),
    };
    client.getManagerPerformance.mockImplementation((_l: string, id: string) =>
      Promise.resolve(live[id as 'a' | 'b']),
    );
    const { layer } = open(client);
    await settle();

    const day = layer.querySelector('.st-day--live');
    expect(day).not.toBeNull();
    expect(day?.querySelector('.st-live-frame')).not.toBeNull();
    expect(day?.querySelector('.st-rank')?.textContent).toBe('');
    expect(day?.querySelector('.st-points')?.textContent).toBe('');
    expect(day?.querySelector('.st-daynum')?.textContent).toBe('4');
    // Der Balken ist da, aber schraffiert.
    expect(day?.querySelector('.st-mine--open')).not.toBeNull();
    // Ø Punkte ohne den offenen Tag: (100 + 50 + 120) / 3 = 90.
    expect(texts(layer, '.st-fig b')[0]).toBe('90');
  });

  it('schaltet zwischen Hinrunde und Rückrunde um', async () => {
    const { layer } = open();
    await settle();
    expect(texts(layer, '.st-half button')).toEqual(['Hinrunde', 'Rückrunde']);
    expect(layer.querySelector('.st-half button[aria-pressed="true"]')?.textContent).toBe('Hinrunde');
    expect(texts(layer, '.st-daynum').at(-1)).toBe('17');

    click(layer, '[data-half="1"]');
    expect(layer.querySelector('.st-half button[aria-pressed="true"]')?.textContent).toBe('Rückrunde');
    expect(texts(layer, '.st-daynum')).toEqual(
      Array.from({ length: 17 }, (_, i) => String(i + 18)),
    );
    // In der Rückrunde ist noch kein Spieltag gespielt.
    expect(layer.querySelectorAll('.st-mine')).toHaveLength(0);
  });

  it('öffnet mit der Halbserie des laufenden Spieltags', async () => {
    // Vor dem ersten Spieltag: Hinrunde. Anstoß liegt in der Zukunft, keine
    // Punkte, also ist noch nichts angepfiffen.
    const future = Date.now() + 7 * DAY_MS;
    const before = fakeClient();
    const nothing = { a: performance('a', [], future), b: performance('b', [], future) };
    before.getManagerPerformance.mockImplementation((_l: string, id: string) =>
      Promise.resolve(nothing[id as 'a' | 'b']),
    );
    const early = open(before);
    await settle();
    expect(early.layer.querySelector('.st-half button[aria-pressed="true"]')?.textContent).toBe('Hinrunde');

    // Saison durch: Rückrunde. Alle 34 Anstöße liegen zurück.
    localStorage.clear();
    for (const old of document.querySelectorAll('.stats-layer')) old.remove();
    const past = Date.now() - 40 * 7 * DAY_MS;
    const all = Array.from({ length: 34 }, (_, i) => 60 + i);
    const after = fakeClient();
    const done = { a: performance('a', all, past), b: performance('b', all, past) };
    after.getManagerPerformance.mockImplementation((_l: string, id: string) =>
      Promise.resolve(done[id as 'a' | 'b']),
    );
    const late = open(after);
    await settle();
    expect(late.layer.querySelector('.st-half button[aria-pressed="true"]')?.textContent).toBe('Rückrunde');
    expect(texts(late.layer, '.st-daynum').at(0)).toBe('18');
  });

  it('die Kreuztabelle: Manager, Gesamt, Δ, dann die Spieltage absteigend', async () => {
    const { layer } = open();
    await settle();
    click(layer, '[data-tab="tabelle"]');
    expect(layer.querySelector('.st-title')?.textContent).toBe('Spieltage 1 bis 4');
    expect(texts(layer, '.st-matrix thead th')).toEqual(['Manager', 'Gesamt', 'Δ', '4', '3', '2', '1', '']);
    expect(texts(layer, '.st-matrix tbody .st-name')).toEqual(['Ben', 'Anna']);
    // Ben: 355 gesamt, vorn ohne Rückstand, dann ST 4 bis 1; Anna 15 dahinter.
    expect(texts(layer, '.st-matrix tbody tr:first-child td')).toEqual(['Ben', '355', '', '75', '110', '90', '80', '']);
    expect(texts(layer, '.st-matrix tbody tr:last-child .st-col-diff')).toEqual(['-15']);
  });

  it('die Bereiche: Gesamt, Hinrunde, Rückrunde; ohne Spieltag ausgegraut', async () => {
    const { layer } = open();
    await settle();
    click(layer, '[data-tab="tabelle"]');
    expect(texts(layer, '.st-range button')).toEqual(['Gesamt', 'Hinrunde', 'Rückrunde']);
    expect(layer.querySelector<HTMLButtonElement>('[data-range="rueck"]')?.disabled).toBe(true);
    // Beim Öffnen steht die laufende Runde, hier die Hinrunde.
    expect(layer.querySelector('[data-range="hin"]')?.getAttribute('aria-pressed')).toBe('true');

    click(layer, '[data-range="gesamt"]');
    expect(layer.querySelector('[data-range="gesamt"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(layer.querySelector('.st-title')?.textContent).toBe('Spieltage 1 bis 4');

    // Ausgegraut heißt: ein Tipp darauf ändert nichts.
    click(layer, '[data-range="rueck"]');
    expect(layer.querySelector('[data-range="gesamt"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('in der Rückrunde steht beim Öffnen die Rückrunde', async () => {
    // Spieltag 20 vor vier Tagen, also 20 gespielte Spieltage.
    const start = Date.now() - (19 * 7 + 4) * DAY_MS;
    const twenty = Array.from({ length: 20 }, (_, i) => 100 + i);
    const client = fakeClient();
    const late = { a: performance('a', twenty, start), b: performance('b', twenty.map((p) => p - 10), start) };
    client.getManagerPerformance.mockImplementation((_l: string, id: string) =>
      Promise.resolve(late[id as 'a' | 'b']),
    );
    const { layer } = open(client);
    await settle();
    click(layer, '[data-tab="tabelle"]');
    expect(layer.querySelector('[data-range="rueck"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(layer.querySelector('.st-title')?.textContent).toBe('Spieltage 18 bis 20');
    expect(texts(layer, '.st-matrix thead th')).toEqual(['Manager', 'Gesamt', 'Δ', '20', '19', '18', '']);
  });

  it('Δ gibt es erst ab dem zweiten Spieltag', async () => {
    // Spieltag 1 vor vier Tagen, Spieltag 2 erst in drei Tagen.
    const start = Date.now() - 4 * DAY_MS;
    const client = fakeClient();
    const one = { a: performance('a', [100], start), b: performance('b', [80], start) };
    client.getManagerPerformance.mockImplementation((_l: string, id: string) =>
      Promise.resolve(one[id as 'a' | 'b']),
    );
    const { layer } = open(client);
    await settle();
    click(layer, '[data-tab="tabelle"]');
    expect(layer.querySelector('.st-title')?.textContent).toBe('Spieltag 1');
    expect(texts(layer, '.st-matrix thead th')).toEqual(['Manager', 'Gesamt', '1', '']);
    expect(layer.querySelector('.st-col-diff')).toBeNull();
  });

  it('zeigt den Rückstand auf Platz 1, als Erster stattdessen den Vorsprung', async () => {
    const { layer } = open();
    await settle();
    expect(texts(layer, '.st-fig span')).toContain('AUF DEN BESTEN');
    // Anna 340, Ben 355: 15 hinter Platz 1.
    expect(texts(layer, '.st-fig b.st-neg')).toEqual(['-15']);

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

describe('StatsPage: angetippter Spieltag', () => {
  it('ein Tipp auf einen Balken zeigt die ersten drei des Spieltags, ein zweiter schließt', async () => {
    const { layer } = open();
    await settle();
    expect(layer.querySelector('.st-day--empty')?.tagName).toBe('SPAN');
    click(layer, '[data-day="3"]');

    const bar = layer.querySelector('[data-day="3"]');
    expect(bar?.getAttribute('aria-pressed')).toBe('true');
    const callout = bar?.querySelector('.st-callout');
    expect(callout?.querySelector('.st-co-head')?.textContent).toBe('Spieltag 3');
    // Anna hat an Spieltag 3 mit 120 gewonnen, sie ist "du".
    expect(texts(layer, '.st-callout .st-co-name')).toEqual(['Du', 'Ben']);
    expect(texts(layer, '.st-callout .st-co-points')).toEqual(['120', '110']);
    expect(layer.querySelector('.st-co-name--me')?.textContent).toBe('Du');

    click(layer, '[data-day="3"]');
    expect(layer.querySelector('.st-callout')).toBeNull();
    expect(layer.querySelector('[data-day="3"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('die eigene Zeile steht als vierte darunter, wenn man nicht unter den dreien ist', async () => {
    const ranking: LeagueRanking = {
      leagueName: 'Test',
      managers: [
        ...RANKING.managers,
        { id: 'c', name: 'Cem', imagePath: '', seasonPoints: 300, seasonPlace: 3, dayPoints: 0, dayPlace: 0, teamValue: 0 },
        { id: 'd', name: 'Dana', imagePath: '', seasonPoints: 290, seasonPlace: 4, dayPoints: 0, dayPlace: 0, teamValue: 0 },
      ],
    };
    const four: Record<string, ManagerPerformance> = {
      ...PERFORMANCES,
      c: performance('c', [130, 95, 60, 60]),
      d: performance('d', [125, 92, 50, 50]),
    };
    const client = fakeClient();
    client.getLeagueRanking.mockResolvedValue(ranking);
    client.getManagerPerformance.mockImplementation((_l: string, id: string) => Promise.resolve(four[id]));
    const { layer } = open(client);
    await settle();
    // Spieltag 1: Cem 130, Dana 125, Anna 100. Anna ist Dritte, also dabei.
    click(layer, '[data-day="1"]');
    expect(texts(layer, '.st-callout .st-co-name')).toEqual(['Cem', 'Dana', 'Du']);
    expect(layer.querySelector('.st-co-sep')).toBeNull();
    // Spieltag 2: Cem 95, Dana 92, Ben 90, Anna 50. Anna ist Vierte.
    click(layer, '[data-day="2"]');
    expect(texts(layer, '.st-callout .st-co-name')).toEqual(['Cem', 'Dana', 'Ben', 'Du']);
    expect(texts(layer, '.st-callout .st-co-place')).toEqual(['1.', '2.', '3.', '4.']);
    expect(layer.querySelector('.st-co-sep')).not.toBeNull();
  });

  it('der laufende Spieltag zeigt den Zwischenstand mit dem Hinweis', async () => {
    const running = Date.now() - 22 * DAY_MS;
    const client = fakeClient();
    const live = {
      a: performance('a', [100, 50, 120, 70], running),
      b: performance('b', [80, 90, 110, 75], running),
    };
    client.getManagerPerformance.mockImplementation((_l: string, id: string) =>
      Promise.resolve(live[id as 'a' | 'b']),
    );
    const { layer } = open(client);
    await settle();
    click(layer, '.st-day--live');
    expect(layer.querySelector('.st-co-head')?.textContent?.replace(/\s+/g, ' ')).toContain('läuft noch');
    expect(layer.querySelector('.st-co-place--first')).toBeNull();
  });
});

describe('StatsPage: Punktkorrekturen', () => {
  const DATE = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin',
  });
  /** Einen Tag nach dem Anstoß von Spieltag `day`. */
  const during = (day: number): string => new Date(Date.parse(kickoffOf(day)) + DAY_MS).toISOString();
  const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

  /** Anna mit Saisonsumme `net` neben der Summe ihrer Spieltage, dazu der Feed. */
  function withAdjustments(net: number, feed: PointAdjustment[]) {
    const client = fakeClient();
    const anna = performance('a', [100, 50, 120, 70]);
    anna.seasons[0]!.totalPoints += net;
    const all: Record<string, ManagerPerformance> = { ...PERFORMANCES, a: anna };
    client.getManagerPerformance.mockImplementation((_l: string, id: string) => Promise.resolve(all[id]));
    client.getPointAdjustments.mockResolvedValue(feed);
    return client;
  }

  it('zieht den Abzug von Gesamt ab, markiert den Namen und nennt die Buchung', async () => {
    const date = during(3);
    const { layer } = open(withAdjustments(-300, [{ managerId: 'a', amount: -300, date }]));
    await settle();
    // Der Kopf im Tab Ich rechnet schon mit dem Abzug: 340 - 300.
    expect(layer.querySelector('.st-hero-main b')?.textContent).toBe('40 Punkte');

    click(layer, '[data-tab="tabelle"]');
    expect(texts(layer, '.st-matrix tbody tr:last-child .st-col-total')).toEqual(['40']);
    expect(texts(layer, '.st-matrix tbody tr:last-child .st-adjust--minus')).toEqual(['-300']);
    expect(layer.querySelectorAll('.st-matrix .st-adjust')).toHaveLength(1);
    const note = layer.querySelector('.st-matrix-scroll + .st-note');
    expect(squash(note?.textContent)).toBe(
      `-300 Anna: 300 Punkte abgezogen am ${DATE.format(new Date(date))}. Gesamt enthält den Abzug, die Spieltage nicht.`,
    );
  });

  it('heben sich Abzug und Bonus auf, fehlt die Marke, die Buchungen stehen da', async () => {
    const minus = during(1);
    const plus = during(2);
    const { layer } = open(withAdjustments(0, [
      { managerId: 'a', amount: 100, date: plus },
      { managerId: 'a', amount: -100, date: minus },
    ]));
    await settle();
    click(layer, '[data-tab="tabelle"]');
    expect(layer.querySelector('.st-matrix .st-adjust')).toBeNull();
    expect(texts(layer, '.st-matrix tbody tr:last-child .st-col-total')).toEqual(['340']);
    expect(squash(layer.querySelector('.st-matrix-scroll + .st-note')?.textContent)).toBe(
      `Anna: -100 am ${DATE.format(new Date(minus))}, +100 am ${DATE.format(new Date(plus))}.` +
        ' Gesamt enthält Abzüge und Boni, die Spieltage nicht.',
    );
  });

  it('ohne Feed steht der Abzug trotzdem in Gesamt, nur ohne Datum', async () => {
    const client = withAdjustments(-300, []);
    client.getPointAdjustments.mockRejectedValue(new KickbaseError(500, 'kaputt'));
    const { layer } = open(client);
    await settle();
    click(layer, '[data-tab="tabelle"]');
    expect(texts(layer, '.st-matrix tbody tr:last-child .st-col-total')).toEqual(['40']);
    expect(squash(layer.querySelector('.st-matrix-scroll + .st-note')?.textContent)).toBe(
      '-300 Anna: 300 Punkte abgezogen. Gesamt enthält den Abzug, die Spieltage nicht.',
    );
  });
});

describe('StatsPage: Platzierungen', () => {
  it('zeigt im Tab Saison, wie oft wer auf dem Podest stand', async () => {
    const { layer } = open();
    await settle();
    click(layer, '[data-tab="saison"]');
    expect(texts(layer, '.st-places thead th')).toEqual(['Manager', '1', '2', '3', '4.+']);
    // Anna gewinnt ST 1 und 3, Ben ST 2 und 4; mit zwei Managern gibt es keinen Dritten.
    expect(layer.querySelector('.st-places tbody tr:first-child .st-name')?.textContent).toBe('Anna');
    expect(texts(layer, '.st-places tbody tr:first-child td:not(:first-child)')).toEqual(['2', '2', '–', '–']);
    expect(layer.querySelectorAll('.st-places .st-count--top-1')).toHaveLength(2);
    expect(layer.querySelector('.st-places tr.is-me .st-name')?.textContent).toBe('Anna');
  });
});
