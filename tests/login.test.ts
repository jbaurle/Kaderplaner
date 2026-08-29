/**
 * Die Anmeldeseite trägt einen Hinweis, wenn jemand nicht freiwillig hier
 * gelandet ist. Geprüft wird, dass er im Feld steht und dass die Seite am
 * Handy dann mit dem Formular vorne startet.
 */

import { describe, expect, it } from 'vitest';
import { renderLogin } from '../src/ui/login.js';

// jsdom kennt kein matchMedia. Die Seite fragt damit nur, ob jemand weniger
// Bewegung wünscht; für das Markup ist die Antwort egal.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: (): void => {},
  removeListener: (): void => {},
  addEventListener: (): void => {},
  removeEventListener: (): void => {},
  dispatchEvent: (): boolean => false,
})) as typeof window.matchMedia;

function render(notice?: string): HTMLElement {
  const host = document.createElement('div');
  renderLogin(host, {
    prefilledEmail: 'manager@example.com',
    notice: notice ?? null,
    onSubmit: async () => {},
  });
  return host;
}

describe('renderLogin', () => {
  it('zeigt ohne Hinweis die übliche Zeile und startet bei "Features"', () => {
    const host = render();

    expect(host.querySelector('.lp-panel-note')?.textContent).toContain('Kostenlos');
    expect(host.querySelector<HTMLElement>('.lp-hero')?.dataset['tab']).toBe('info');
    expect(host.querySelector('#lp-tab-info')?.getAttribute('aria-selected')).toBe('true');
  });

  it('setzt den Hinweis an die Stelle der Zeile und schaltet auf das Formular', () => {
    const host = render('Deine Sitzung ist abgelaufen. Bitte melde dich neu an.');

    const note = host.querySelector('.lp-panel-note');
    expect(note?.textContent).toContain('Sitzung ist abgelaufen');
    expect(note?.getAttribute('role')).toBe('status');
    expect(host.querySelector<HTMLElement>('.lp-hero')?.dataset['tab']).toBe('login');
    expect(host.querySelector('#lp-tab-login')?.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('#lp-tab-info')?.getAttribute('aria-selected')).toBe('false');
  });

  it('nimmt im hellen Design die hellen Aufnahmen', () => {
    const host = render();
    const srcs = [...host.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '');
    expect(srcs).toContain('/images/table-desktop.webp');
    expect(srcs.some((s) => s.endsWith('-dark.webp'))).toBe(false);
  });

  it('nimmt im dunklen Design die dunklen Aufnahmen', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    try {
      const host = render();
      const shots = [...host.querySelectorAll('img')]
        .map((i) => i.getAttribute('src') ?? '')
        .filter((s) => s.startsWith('/images/'));
      expect(shots.length).toBeGreaterThan(0);
      expect(shots.every((s) => s.endsWith('-dark.webp'))).toBe(true);
    } finally {
      document.documentElement.removeAttribute('data-theme');
    }
  });

  it('lässt den roten Fehlerplatz für falsche Zugangsdaten frei', () => {
    const host = render('Deine Sitzung ist abgelaufen. Bitte melde dich neu an.');

    expect(host.querySelector('#login-error')?.textContent).toBe('');
  });
});
