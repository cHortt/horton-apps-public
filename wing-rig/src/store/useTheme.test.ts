import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyNodeChanges } from '@xyflow/react';
import {
  STORAGE_KEY_PREFS,
  readInspectorCollapsed,
  writeInspectorCollapsed,
} from './useRigStore';
import { readThemePreference, resolveIsDark, writeThemePreference } from './useTheme';
import { createMockRig } from '../schema/mockRig';
import { chooseHandlesForPositions, reconcileFlowNodes } from '../components/canvas/SystemCanvas';

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

  it('preserves React Flow v12 measured dimensions during drag and reconciliation so nodes never disappear', () => {
    const rig = createMockRig();
    const baseParams = {
      rig,
      editMode: true,
      selection: null,
      trace: null,
      activeNodeSet: new Set<string>(),
      snapshotNodeIds: new Set<string>(),
      onSelectNode: () => {},
    };

    // 1. Initial nodes
    let nodes = reconcileFlowNodes([], baseParams);
    // 2. React Flow measures all nodes on mount via `dimensions` changes
    nodes = applyNodeChanges(
      nodes.map((n) => ({
        id: n.id,
        type: 'dimensions' as const,
        dimensions: { width: 272, height: 148 },
      })),
      nodes,
    );
    expect(nodes.every((n) => n.measured?.width === 272 && n.measured?.height === 148)).toBe(true);

    // 3. User starts dragging stage-wing
    nodes = applyNodeChanges(
      [
        {
          id: 'stage-wing',
          type: 'position',
          position: { x: 600, y: 300 },
          dragging: true,
        },
      ],
      nodes,
    );
    // Reconcile while dragging (e.g. selection or state change) keeps live drag position AND measured dims
    nodes = reconcileFlowNodes(nodes, {
      ...baseParams,
      selection: { type: 'node', id: 'stage-wing' },
    });
    const dragged = nodes.find((n) => n.id === 'stage-wing')!;
    expect(dragged.position).toEqual({ x: 600, y: 300 });
    expect(nodes.every((n) => n.measured?.width === 272 && n.measured?.height === 148)).toBe(true);

    // 4. User drops stage-wing and rig updates persisted position
    nodes = applyNodeChanges(
      [{ id: 'stage-wing', type: 'position', position: { x: 600, y: 300 }, dragging: false }],
      nodes,
    );
    const updatedRig = {
      ...rig,
      nodes: rig.nodes.map((n) =>
        n.id === 'stage-wing' ? { ...n, position: { x: 600, y: 300 } } : n,
      ),
    };
    nodes = reconcileFlowNodes(nodes, { ...baseParams, rig: updatedRig });
    expect(nodes.find((n) => n.id === 'stage-wing')?.position).toEqual({ x: 600, y: 300 });
    expect(nodes.every((n) => n.measured?.width === 272 && n.measured?.height === 148)).toBe(true);
  });
});
