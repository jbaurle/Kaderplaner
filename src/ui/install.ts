/**
 * "App installieren" als eigener Knopf.
 *
 * Chromium-Browser melden mit `beforeinstallprompt`, dass sie die Seite als
 * App anbieten würden. Wer das Ereignis abfängt und aufhebt, darf den Dialog
 * später selbst öffnen, an einer Stelle, die man auch findet: das Menü des
 * Browsers versteckt ihn je nach Fassung tief oder gar nicht.
 *
 * Andere Browser feuern das Ereignis nie. Dort bleibt der Knopf aus und es
 * bleibt beim Weg über das Menü, siehe die Anleitung auf der Funktionsseite.
 *
 * Das Ereignis kommt einmal je Seitenaufruf, oft bevor die Oberfläche steht.
 * Deshalb hängt `initInstallPrompt()` ganz früh in main.ts und hebt es auf,
 * die Oberfläche fragt danach.
 */

/** Steht so nicht in der DOM-Typdefinition, das Ereignis ist Chromium-eigen. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let pending: BeforeInstallPromptEvent | null = null;
const watchers = new Set<() => void>();

function notify(): void {
  watchers.forEach((watcher) => watcher());
}

export function initInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Ohne das zeigt Chrome seine eigene Leiste am unteren Rand.
    event.preventDefault();
    pending = event as BeforeInstallPromptEvent;
    notify();
  });

  // Nach der Installation gibt es nichts mehr anzubieten.
  window.addEventListener('appinstalled', () => {
    pending = null;
    notify();
  });
}

export function canInstall(): boolean {
  return pending !== null;
}

/**
 * Meldet jede Änderung an `canInstall()`. Der Rückgabewert hängt sich wieder
 * aus; wer ihn nicht ruft, wird beim nächsten Signal von selbst abgemeldet,
 * sobald sein Knopf nicht mehr im Dokument hängt.
 */
export function watchInstall(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

/**
 * Ist die App hier schon installiert? Zwei Quellen: sie läuft gerade
 * standalone, oder Chrome kennt sie über `related_applications` im Manifest
 * (`getInstalledRelatedApps`). Andere Browser können die Frage nicht
 * beantworten und melden false; dort bleibt der Hinweis eben stehen.
 */
export async function isAppInstalled(): Promise<boolean> {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  const nav = navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<unknown[]>;
  };
  if (!nav.getInstalledRelatedApps) return false;
  try {
    const apps = await nav.getInstalledRelatedApps();
    return apps.length > 0;
  } catch {
    return false;
  }
}

/**
 * Öffnet den Dialog des Browsers. Das Ereignis trägt nur einen Aufruf, danach
 * ist es verbraucht, egal wie der Nutzer sich entscheidet.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = pending;
  if (!event) return 'unavailable';

  pending = null;
  notify();
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome;
}
