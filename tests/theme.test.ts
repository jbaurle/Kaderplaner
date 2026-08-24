/**
 * Der Dunkel-Modus steht an zwei Stellen: `theme.ts` schaltet ihn, und das
 * Inline-Skript in `index.html` liest den gespeicherten Stand, bevor das
 * Bundle da ist. Nur die erste Stelle prüft TypeScript.
 *
 * Diese Tests halten fest, worauf sich das Skript verlässt: Schlüssel
 * `kb.theme`, Wert `dark` mit oder ohne Anführungszeichen, und `data-theme`
 * auf `<html>`. Ändert jemand den Storage-Wrapper, fällt es hier auf und
 * nicht erst als weißes Aufblitzen im Browser.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { getTheme, initTheme, setTheme, toggleTheme } from '../src/ui/theme.js';

/** Dieselbe Zeile wie in index.html, nur ohne den Rahmen drumherum. */
function runBootstrapScript(): void {
  const stored = localStorage.getItem('kb.theme');
  if (stored === '"dark"' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#12181c');
  }
}

/** Dieselbe Meta-Zeile wie im Kopf von index.html. */
function addThemeColorMeta(): HTMLMetaElement {
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', '#f4f6f9');
  document.head.appendChild(meta);
  return meta;
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.querySelector('meta[name="theme-color"]')?.remove();
});

describe('theme', () => {
  it('legt die Wahl unter kb.theme ab, so wie das Inline-Skript sie erwartet', () => {
    setTheme('dark');
    const stored = localStorage.getItem('kb.theme');
    expect(stored === '"dark"' || stored === 'dark').toBe(true);
  });

  it('setzt und entfernt data-theme auf <html>', () => {
    setTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(getTheme()).toBe('dark');

    setTheme('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(getTheme()).toBe('light');
  });

  it('schaltet hin und zurück', () => {
    expect(toggleTheme()).toBe('dark');
    expect(toggleTheme()).toBe('light');
  });

  it('das Inline-Skript findet, was setTheme hinterlegt hat', () => {
    const meta = addThemeColorMeta();
    setTheme('dark');
    document.documentElement.removeAttribute('data-theme');
    meta.setAttribute('content', '#f4f6f9');

    runBootstrapScript();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(meta.getAttribute('content')).toBe('#12181c');
  });

  it('zieht die Farbe der Statusleiste mit, damit über der dunklen App kein heller Streifen steht', () => {
    const meta = addThemeColorMeta();

    setTheme('dark');
    expect(meta.getAttribute('content')).toBe('#12181c');

    setTheme('light');
    expect(meta.getAttribute('content')).toBe('#f4f6f9');
  });

  it('kommt ohne die Meta-Zeile aus', () => {
    expect(() => setTheme('dark')).not.toThrow();
  });

  it('initTheme holt den Stand nach, wenn das Inline-Skript nicht lief', () => {
    setTheme('dark');
    document.documentElement.removeAttribute('data-theme');

    initTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
