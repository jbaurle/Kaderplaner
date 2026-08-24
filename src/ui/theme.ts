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
  if (load<Theme>(KEY) === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  applyThemeColor(getTheme());
}
