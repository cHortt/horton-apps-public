import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEY_PREFS } from './useRigStore';

export type ThemePreference = 'system' | 'light' | 'dark';

interface StoredPrefs {
  theme?: ThemePreference;
  [key: string]: unknown;
}

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFS);
    if (!raw) return 'system';
    const parsed = JSON.parse(raw) as StoredPrefs;
    if (parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system') {
      return parsed.theme;
    }
  } catch {
    // Ignore malformed preferences and default to browser setting
  }
  return 'system';
}

export function writeThemePreference(theme: ThemePreference): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFS);
    let existing: StoredPrefs = {};
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as StoredPrefs;
      }
    }
    window.localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify({ ...existing, theme }));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function resolveIsDark(preference: ThemePreference, systemDark: boolean): boolean {
  if (preference === 'dark') return true;
  if (preference === 'light') return false;
  return systemDark;
}

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);
  const [systemDark, setSystemDark] = useState<boolean>(getSystemPrefersDark);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const isDark = resolveIsDark(preference, systemDark);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
    root.style.colorScheme = isDark ? 'dark' : 'light';
  }, [isDark]);

  const toggleTheme = useCallback(() => {
    const next: ThemePreference = isDark ? 'light' : 'dark';
    setPreference(next);
    writeThemePreference(next);
  }, [isDark]);

  const resetThemeToSystem = useCallback(() => {
    setPreference('system');
    writeThemePreference('system');
  }, []);

  return {
    preference,
    isDark,
    toggleTheme,
    resetThemeToSystem,
  };
}
