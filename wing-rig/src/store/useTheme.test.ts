import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY_PREFS } from './useRigStore';
import { readThemePreference, resolveIsDark, writeThemePreference } from './useTheme';

describe('useTheme helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to browser preference when preference is system', () => {
    expect(resolveIsDark('system', true)).toBe(true);
    expect(resolveIsDark('system', false)).toBe(false);
  });

  it('honors explicit light and dark overrides regardless of browser setting', () => {
    expect(resolveIsDark('dark', false)).toBe(true);
    expect(resolveIsDark('light', true)).toBe(false);
  });

  it('persists theme preference under wing-rig:prefs:v1 without clobbering other prefs', () => {
    const store = new Map<string, string>();
    store.set(STORAGE_KEY_PREFS, JSON.stringify({ compact: true }));
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    });

    expect(readThemePreference()).toBe('system');

    writeThemePreference('dark');
    expect(readThemePreference()).toBe('dark');
    expect(JSON.parse(store.get(STORAGE_KEY_PREFS)!)).toEqual({ compact: true, theme: 'dark' });

    writeThemePreference('light');
    expect(readThemePreference()).toBe('light');
  });
});
