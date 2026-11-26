import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STORAGE_KEY_PREFS,
  readInspectorCollapsed,
  writeInspectorCollapsed,
} from './useRigStore';
import { readThemePreference, resolveIsDark, writeThemePreference } from './useTheme';
import { chooseHandlesForPositions } from '../components/canvas/SystemCanvas';

describe('useTheme & UI layout preference helpers', () => {
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

  it('persists theme and inspectorCollapsed under wing-rig:prefs:v1 without clobbering each other', () => {
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
    expect(readInspectorCollapsed()).toBe(false);

    writeThemePreference('dark');
    writeInspectorCollapsed(true);
    expect(readThemePreference()).toBe('dark');
    expect(readInspectorCollapsed()).toBe(true);
    expect(JSON.parse(store.get(STORAGE_KEY_PREFS)!)).toEqual({
      compact: true,
      theme: 'dark',
      inspectorCollapsed: true,
    });

    writeThemePreference('light');
    expect(readThemePreference()).toBe('light');
    expect(readInspectorCollapsed()).toBe(true);
  });

  it('routes canvas handles cleanly in all 4 directions for arbitrary room layouts', () => {
    // Left -> Right
    expect(chooseHandlesForPositions({ x: 0, y: 100 }, { x: 350, y: 120 })).toEqual({
      sourceHandle: 'right',
      targetHandle: 'left',
    });
    // Right -> Left (rearranged room layout)
    expect(chooseHandlesForPositions({ x: 500, y: 100 }, { x: 100, y: 110 })).toEqual({
      sourceHandle: 'left-source',
      targetHandle: 'right-target',
    });
    // Top -> Bottom
    expect(chooseHandlesForPositions({ x: 200, y: 50 }, { x: 220, y: 320 })).toEqual({
      sourceHandle: 'bottom-source',
      targetHandle: 'top-target',
    });
    // Bottom -> Top
    expect(chooseHandlesForPositions({ x: 200, y: 350 }, { x: 210, y: 60 })).toEqual({
      sourceHandle: 'top-source',
      targetHandle: 'bottom-target',
    });
  });
});
