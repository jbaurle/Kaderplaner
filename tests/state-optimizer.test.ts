import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyOptimizerCache,
  loadOptimizerCache,
  OPTIMIZER_SCHEMA_VERSION,
  saveOptimizerCache,
} from '../src/state/optimizer.js';

const LEAGUE = 'l-1';
const KEY = `kb.optimizer.${LEAGUE}`;

// Node 25 ships an experimental `localStorage` global that lacks `clear` and
// `removeItem`, and jsdom doesn't reliably override it for Vitest tests on
// this host. A simple Map-backed shim gives every test a clean slate.
const fakeStore = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string): string | null => fakeStore.get(k) ?? null,
  setItem: (k: string, v: string): void => {
    fakeStore.set(k, String(v));
  },
  removeItem: (k: string): void => {
    fakeStore.delete(k);
  },
  clear: (): void => {
    fakeStore.clear();
  },
  key: (i: number): string | null => Array.from(fakeStore.keys())[i] ?? null,
  get length(): number {
    return fakeStore.size;
  },
};

beforeEach(() => {
  fakeStore.clear();
  vi.stubGlobal('localStorage', fakeLocalStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fakeStore.clear();
});

describe('loadOptimizerCache', () => {
  it('returns null when nothing is stored', () => {
    expect(loadOptimizerCache(LEAGUE)).toBeNull();
  });

  it('returns the parsed cache when the schema version matches', () => {
    const cache = emptyOptimizerCache();
    cache.table = { takenAt: 1, mc: 25, teams: [] };
    localStorage.setItem(KEY, JSON.stringify(cache));
    expect(loadOptimizerCache(LEAGUE)).toEqual(cache);
  });

  it('returns null when the schema version differs', () => {
    localStorage.setItem(KEY, JSON.stringify({ ...emptyOptimizerCache(), schemaVersion: 999 }));
    expect(loadOptimizerCache(LEAGUE)).toBeNull();
  });

  it('returns null when the stored value is not parseable JSON', () => {
    localStorage.setItem(KEY, '{"oops": ');
    expect(loadOptimizerCache(LEAGUE)).toBeNull();
  });
});

describe('saveOptimizerCache', () => {
  it('writes the cache under the namespaced key with the current schema version', () => {
    const cache = emptyOptimizerCache();
    cache.table = { takenAt: 42, mc: 10, teams: [] };
    saveOptimizerCache(LEAGUE, cache);
    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.schemaVersion).toBe(OPTIMIZER_SCHEMA_VERSION);
    expect(parsed.table).toEqual({ takenAt: 42, mc: 10, teams: [] });
  });
});

describe('emptyOptimizerCache', () => {
  it('returns an empty, well-typed cache object with the current schema version', () => {
    const c = emptyOptimizerCache();
    expect(c.schemaVersion).toBe(OPTIMIZER_SCHEMA_VERSION);
    expect(c.table).toBeNull();
    expect(c.weeklyDetails).toEqual({});
  });
});
