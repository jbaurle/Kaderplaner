import './styles/base.css';
import './styles/planning.css';
import './styles/lineup.css';
import { App } from './ui/app.js';
import { initInstallPrompt } from './ui/install.js';
import { initTheme } from './ui/theme.js';

// Nachzügler zum Inline-Script in index.html, siehe dort.
initTheme();

// Muss vor dem ersten Bildaufbau hängen: `beforeinstallprompt` kommt einmal
// und wäre sonst weg, bevor die Anmeldeseite danach fragt.
initInstallPrompt();

const host = document.getElementById('app');
if (!host) throw new Error('#app container missing in index.html');

new App({ host }).start();

/*
 * Der Service Worker speichert nichts, siehe public/sw.js. Er steht nur da,
 * damit Chrome auf Android die App wirklich installiert. Erst nach `load`,
 * damit die Registrierung nicht mit dem ersten Bildaufbau um die Leitung
 * streitet. `updateViaCache: 'none'` verhindert, dass der Browser die Datei
 * selbst bis zu einen Tag lang aus seinem HTTP-Cache bedient.
 *
 * Scheitert die Registrierung, etwa ohne HTTPS, läuft die App wie bisher
 * weiter: sie hängt an keiner Stelle daran.
 */
window.addEventListener('load', () => {
  navigator.serviceWorker?.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
});
