import { useCallback, useEffect, useState } from 'react';
import type {
  BusAnnotation,
  ChannelAnnotation,
  HardwareNode,
  NodeAnnotation,
  Point2D,
  RigDocument,
  TraceResult,
  TraceTarget,
  TrunkAnnotation,
  TrunkConnection,
} from '../schema/rig';
import { traceSignal, validateRigDocument } from '../schema/helpers';
import { createMockRig } from '../schema/mockRig';
import { applySnapMerge, type SnapMergeDiff } from '../parser/merge';
import type { ParsedWingSnapshot } from '../parser/wingSnapParser';

// Strict applet isolation: all localStorage keys MUST be prefixed with "wing-rig:"
export const STORAGE_KEY_RIG = 'wing-rig:document:v1';
export const STORAGE_KEY_PREFS = 'wing-rig:prefs:v1';

export type SelectionState =
  | { type: 'node'; id: string }
  | { type: 'trunk'; id: string }
  | null;

export type AppViewMode = 'canvas' | 'print';

function loadInitialRig(): RigDocument {
  if (typeof window === 'undefined') return createMockRig();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_RIG);
    if (!raw) return createMockRig();
    const parsed = JSON.parse(raw) as unknown;
    const validation = validateRigDocument(parsed);
    if (validation.valid) {
      return parsed as RigDocument;
    }
  } catch {
    // Fallback cleanly to demo rig if localStorage is corrupted
  }
  return createMockRig();
}

export function useRigStore() {
  const [rig, setRig] = useState<RigDocument>(loadInitialRig);
  // Volunteer-First UX: always default to Read-Only Mode on startup
  const [editMode, setEditMode] = useState<boolean>(false);
  const [selection, setSelection] = useState<SelectionState>(null);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [view, setView] = useState<AppViewMode>('canvas');

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY_RIG, JSON.stringify(rig));
    } catch {
      // Ignore storage quota errors in restricted browsing modes
    }
  }, [rig]);

  // Esc clears active trace cleanly
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && trace) {
        setTrace(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [trace]);

  const selectNode = useCallback((id: string) => {
    setSelection({ type: 'node', id });
  }, []);

  const selectTrunk = useCallback((id: string) => {
    setSelection({ type: 'trunk', id });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  const runTrace = useCallback(
    (target: TraceTarget) => {
      const result = traceSignal(rig, target);
      setTrace(result);
    },
    [rig],
  );

  const clearTrace = useCallback(() => {
    setTrace(null);
  }, []);

  const updateRigMeta = useCallback((patch: Partial<Pick<RigDocument, 'name' | 'venue'>>) => {
    setRig((prev) => ({
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const updateNodePosition = useCallback((nodeId: string, position: Point2D) => {
    const rounded = { x: Math.round(position.x), y: Math.round(position.y) };
    setRig((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, position: rounded } : n)),
      annotations: {
        ...prev.annotations,
        nodes: {
          ...prev.annotations.nodes,
          [nodeId]: {
            ...prev.annotations.nodes[nodeId],
            position: rounded,
          },
        },
      },
    }));
  }, []);

  const updateNodeAnnotation = useCallback((nodeId: string, patch: Partial<NodeAnnotation>) => {
    setRig((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      annotations: {
        ...prev.annotations,
        nodes: {
          ...prev.annotations.nodes,
          [nodeId]: {
            ...prev.annotations.nodes[nodeId],
            ...patch,
          },
        },
      },
    }));
  }, []);

  const updateTrunkAnnotation = useCallback((trunkId: string, patch: Partial<TrunkAnnotation>) => {
    setRig((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      annotations: {
        ...prev.annotations,
        trunks: {
          ...prev.annotations.trunks,
          [trunkId]: {
            ...prev.annotations.trunks[trunkId],
            ...patch,
          },
        },
      },
    }));
  }, []);

  const updateChannelAnnotation = useCallback(
    (channelId: string, patch: Partial<ChannelAnnotation>) => {
      setRig((prev) => ({
        ...prev,
        updatedAt: new Date().toISOString(),
        annotations: {
          ...prev.annotations,
          channels: {
            ...prev.annotations.channels,
            [channelId]: {
              ...prev.annotations.channels[channelId],
              ...patch,
            },
          },
        },
      }));
    },
    [],
  );

  const updateBusAnnotation = useCallback((busId: string, patch: Partial<BusAnnotation>) => {
    setRig((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      annotations: {
        ...prev.annotations,
        buses: {
          ...prev.annotations.buses,
          [busId]: {
            ...prev.annotations.buses[busId],
            ...patch,
          },
        },
      },
    }));
  }, []);

  const dismissOrphan = useCallback((key: string) => {
    setRig((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      annotations: {
        ...prev.annotations,
        orphaned: prev.annotations.orphaned.filter((o) => o.key !== key),
      },
    }));
  }, []);

  const addManualNode = useCallback((node: HardwareNode, friendlyName?: string, notes?: string) => {
    setRig((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      nodes: [...prev.nodes, node],
      annotations: {
        ...prev.annotations,
        nodes: {
          ...prev.annotations.nodes,
          ...(friendlyName || notes
            ? { [node.id]: { friendlyName: friendlyName || undefined, notes: notes || undefined } }
            : {}),
        },
      },
    }));
    setSelection({ type: 'node', id: node.id });
  }, []);

  const deleteManualNode = useCallback((nodeId: string) => {
    setRig((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      trunks: prev.trunks.filter((t) => t.sourceNodeId !== nodeId && t.targetNodeId !== nodeId),
    }));
    setSelection((cur) => (cur?.type === 'node' && cur.id === nodeId ? null : cur));
    setTrace(null);
  }, []);

  const addManualTrunk = useCallback((trunk: TrunkConnection, cableTag?: string, notes?: string) => {
    setRig((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      trunks: [...prev.trunks, trunk],
      annotations: {
        ...prev.annotations,
        trunks: {
          ...prev.annotations.trunks,
          ...(cableTag || notes
            ? { [trunk.id]: { cableTag: cableTag || undefined, notes: notes || undefined } }
            : {}),
        },
      },
    }));
    setSelection({ type: 'trunk', id: trunk.id });
  }, []);

  const deleteManualTrunk = useCallback((trunkId: string) => {
    setRig((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      trunks: prev.trunks.filter((t) => t.id !== trunkId),
    }));
    setSelection((cur) => (cur?.type === 'trunk' && cur.id === trunkId ? null : cur));
    setTrace(null);
  }, []);

  const applySnapshot = useCallback(
    (parsed: ParsedWingSnapshot, targetConsoleId?: string): SnapMergeDiff => {
      const merged = applySnapMerge(rig, parsed, targetConsoleId);
      setRig(merged.rig);
      setSelection({ type: 'node', id: merged.diff.targetConsoleNodeId });
      setTrace(null);
      return merged.diff;
    },
    [rig],
  );

  const importRigJson = useCallback((rawText: string): { ok: true } | { ok: false; error: string } => {
    try {
      const parsed = JSON.parse(rawText) as unknown;
      const validation = validateRigDocument(parsed);
      if (!validation.valid) {
        return {
          ok: false,
          error: validation.issues.map((i) => `${i.path}: ${i.message}`).join('; '),
        };
      }
      setRig(parsed as RigDocument);
      setSelection(null);
      setTrace(null);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid JSON file.',
      };
    }
  }, []);

  const exportRigJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(rig, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = rig.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    a.download = `${safeName || 'wing-rig'}.rig.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rig]);

  const resetToDemoRig = useCallback(() => {
    const demo = createMockRig();
    setRig(demo);
    setSelection(null);
    setTrace(null);
  }, []);

  return {
    rig,
    editMode,
    setEditMode,
    selection,
    selectNode,
    selectTrunk,
    clearSelection,
    trace,
    runTrace,
    clearTrace,
    view,
    setView,
    updateRigMeta,
    updateNodePosition,
    updateNodeAnnotation,
    updateTrunkAnnotation,
    updateChannelAnnotation,
    updateBusAnnotation,
    dismissOrphan,
    addManualNode,
    deleteManualNode,
    addManualTrunk,
    deleteManualTrunk,
    applySnapshot,
    importRigJson,
    exportRigJson,
    resetToDemoRig,
  };
}
