/**
 * `beforeinstallprompt` gibt es nur in Chromium und nur einmal je Aufruf.
 * Diese Tests halten fest, was die Oberfläche davon erwartet: aufheben statt
 * durchlassen, ein Aufruf je Ereignis, und nach der Installation kein Angebot
 * mehr. Das Ereignis selbst wird hier nachgebaut, jsdom kennt es nicht.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  canInstall,
  initInstallPrompt,
  isAppInstalled,
  promptInstall,
  watchInstall,
} from '../src/ui/install.js';

// Einmal, wie in main.ts: jeder weitere Aufruf hinge einen zweiten Zuhörer
// ans Fenster und meldete jede Änderung doppelt.
beforeAll(() => {
  initInstallPrompt();
});

/** Dasselbe, was Chrome schickt: aufhebbar, mit prompt() und userChoice. */
function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  window.dispatchEvent(event);
  return { event, prompt };
}

afterEach(async () => {
  // Das Modul hält den letzten Stand: aufbrauchen, sonst färbt er den
  // nächsten Test ein.
  await promptInstall();
});

describe('install', () => {
  it('bietet nichts an, solange der Browser nichts gemeldet hat', () => {
    expect(canInstall()).toBe(false);
  });

  it('hebt das Ereignis auf, statt die Leiste des Browsers zuzulassen', () => {
const { event } = fireBeforeInstallPrompt();

    expect(event.defaultPrevented).toBe(true);
    expect(canInstall()).toBe(true);
  });

  it('öffnet den Dialog genau einmal und gibt die Wahl zurück', async () => {
const { prompt } = fireBeforeInstallPrompt('accepted');

    await expect(promptInstall()).resolves.toBe('accepted');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(canInstall()).toBe(false);

    await expect(promptInstall()).resolves.toBe('unavailable');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('meldet jede Änderung, damit der Knopf mitgeht', async () => {
const seen: boolean[] = [];
    const unwatch = watchInstall(() => seen.push(canInstall()));

    fireBeforeInstallPrompt();
    await promptInstall();
    unwatch();
    fireBeforeInstallPrompt();

    expect(seen).toEqual([true, false]);
  });

  it('nimmt das Angebot zurück, sobald die App installiert ist', () => {
fireBeforeInstallPrompt();
    expect(canInstall()).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));
    expect(canInstall()).toBe(false);
  });
});

/** jsdom kennt weder matchMedia noch getInstalledRelatedApps, beides Stubs. */
describe('isAppInstalled', () => {
  function stubStandalone(matches: boolean): void {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches }));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { getInstalledRelatedApps?: unknown }).getInstalledRelatedApps;
  });

  it('meldet true, wenn die Seite standalone läuft', async () => {
    stubStandalone(true);
    await expect(isAppInstalled()).resolves.toBe(true);
  });

  it('meldet true, wenn Chrome die App über related_applications kennt', async () => {
    stubStandalone(false);
    (navigator as { getInstalledRelatedApps?: unknown }).getInstalledRelatedApps =
      vi.fn().mockResolvedValue([{ platform: 'webapp' }]);
    await expect(isAppInstalled()).resolves.toBe(true);
  });

  it('meldet false ohne Antwortweg oder bei leerer Antwort', async () => {
    stubStandalone(false);
    await expect(isAppInstalled()).resolves.toBe(false);

    (navigator as { getInstalledRelatedApps?: unknown }).getInstalledRelatedApps =
      vi.fn().mockResolvedValue([]);
    await expect(isAppInstalled()).resolves.toBe(false);
  });
});
