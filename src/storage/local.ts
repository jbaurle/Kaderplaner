/**
 * Typed wrapper around localStorage. All app-owned keys live under the
 * `kb.` namespace.
 *
 * Failure modes are intentionally swallowed: localStorage may be unavailable
 * (private browsing in some browsers, full quota), and the app's data is
 * fully reproducible from the Kickbase API. Worst case the user's snapshot
 * doesn't persist for the next visit; the planning view itself still works.
 */

const NAMESPACE = 'kb.';

export function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(NAMESPACE + key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(NAMESPACE + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — accepted degradation.
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(NAMESPACE + key);
  } catch {
    // ignore
  }
}
