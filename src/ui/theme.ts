/**
 * Dunkel-Modus: ein Knopf, kein `prefers-color-scheme`. Der Zustand steht als
 * `data-theme="dark"` auf `<html>` — dieselbe Stelle, gegen die alle
 * Farb-Tokens in base.css/planning.css/lineup.css schon geschrieben sind,
 * kein Umbau dort nötig.
 *
 * Das Inline-Script in index.html setzt das Attribut schon vor dem ersten
 * Bildaufbau, damit die Seite nicht kurz hell aufblitzt und dann umspringt.
 * `initTheme()` hier ist nur der Nachzügler, falls jenes Script aus
 * irgendeinem Grund nicht lief (deaktiviertes JS im `<head>` betrifft es
 * nicht, das Modul selbst braucht ja auch JS).
 */

import { load, save } from '../storage/local.js';

export type Theme = 'light' | 'dark';

const KEY = 'theme';

/*
 * Die Statusleiste der auf dem Startbildschirm abgelegten App trägt
 * `theme-color`. Dieselben Werte wie `--bg` in base.css, sonst steht über der
 * dunklen App ein heller Streifen. Das Inline-Script in index.html setzt die
 * Farbe vor dem ersten Bildaufbau, hier folgt sie dem Umschalten.
 */
const THEME_COLOR: Record<Theme, string> = { light: '#f4f6f9', dark: '#12181c' };

function applyThemeColor(theme: Theme): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

export function getTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  applyThemeColor(theme);
  save(KEY, theme);
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function initTheme(): void {
  if (document.documentElement.hasAttribute('data-theme')) return;
  // Dunkel ist der Standard: nur ein gespeichertes "light" bleibt hell.
  if (load<Theme>(KEY) !== 'light') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  applyThemeColor(getTheme());
}

/** Mond = "wechselt zu dunkel" (Ausgangslage hell), Sonne umgekehrt. */
export const THEME_ICON: Record<Theme, string> = {
  light: `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 14.5a8 8 0 1 1-10.5-10.5 6.5 6.5 0 0 0 10.5 10.5z" />
    </svg>
  `,
  dark: `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  `,
};

/** Beschriftung des Umschalters: benennt das Design, zu dem der Klick führt. */
export function themeToggleLabel(theme: Theme): string {
  return theme === 'dark' ? 'Helles Design' : 'Dunkles Design';
}
