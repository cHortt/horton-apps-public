import { useCallback, useEffect, useMemo, useState } from 'react';
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
import type {
  ConsoleBaselineMeta,
  ConsoleBaselineRecord,
  ConsoleLinkConfig,
  StagedPatchEntry,
} from '../schema/patch';
import { traceSignal, validateRigDocument } from '../schema/helpers';
import { createMockRig } from '../schema/mockRig';
import { applySnapMerge, type SnapMergeDiff } from '../parser/merge';
import { parseWingSnap, type ParsedWingSnapshot } from '../parser/wingSnapParser';
import { applyPatchOpsToRawSnap, buildDefaultSnapExportName } from '../parser/snapPatcher';
import { inferConsoleLinkConfig, verifyRigPaths } from '../parser/snapVerifier';
import {
  clearAllBaselines,
  deleteBaselineRecord,
  loadAllBaselines,
  saveBaselineRecord,
} from './snapBaselineDb';
import {
  decodeRigPayload,
  parseShareModeFromLocation,
  type ShareModeInfo,
} from './shareLink';

// Strict applet isolation: all localStorage keys MUST be prefixed with "wing-rig:"
export const STORAGE_KEY_RIG = 'wing-rig:document:v1';
export const STORAGE_KEY_PREFS = 'wing-rig:prefs:v1';
export const STORAGE_KEY_STAGED = 'wing-rig:staged-patches:v1';
export const STORAGE_KEY_LINK = 'wing-rig:console-link:v1';

export type SelectionState =
  | { type: 'node'; id: string }
  | { type: 'trunk'; id: string }
  | null;

export type AppViewMode = 'canvas' | 'patch' | 'print';

function readCurrentShareMode(): ShareModeInfo {
  if (typeof window === 'undefined') {
    return { lockedReadOnly: false, source: 'none', encodedPayload: null };
  }
  return parseShareModeFromLocation({
    search: window.location.search,
    hash: window.location.hash,
  });
}

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

function loadInitialStaged(): StagedPatchEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_STAGED);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as StagedPatchEntry[];
    }
  } catch {
    // Ignore malformed staging cache
  }
  return [];
}

function loadInitialLinkConfig(rig: RigDocument): ConsoleLinkConfig {
  const inferred = inferConsoleLinkConfig(rig);
  if (typeof window === 'undefined') return inferred;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_LINK);
    if (!raw) return inferred;
    const parsed = JSON.parse(raw) as Partial<ConsoleLinkConfig>;
    const nodeIds = new Set(rig.nodes.filter((n) => n.kind === 'console').map((n) => n.id));
    if (parsed.stageConsoleId && nodeIds.has(parsed.stageConsoleId)) {
      return {
        stageConsoleId: parsed.stageConsoleId,
        fohConsoleId:
          parsed.fohConsoleId && nodeIds.has(parsed.fohConsoleId)
            ? parsed.fohConsoleId
            : inferred.fohConsoleId,
        stageSplitPort: parsed.stageSplitPort ?? inferred.stageSplitPort,
        fohReceivePort: parsed.fohReceivePort ?? inferred.fohReceivePort,
        headampOwnerConsoleId:
          parsed.headampOwnerConsoleId && nodeIds.has(parsed.headampOwnerConsoleId)
            ? parsed.headampOwnerConsoleId
            : parsed.stageConsoleId,
      };
    }
  } catch {
    // Fall back to inferred link
  }
  return inferred;
}

export function readInspectorCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFS);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { inspectorCollapsed?: unknown };
    return parsed.inspectorCollapsed === true;
  } catch {
    return false;
  }
}

export function writeInspectorCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFS);
    let existing: Record<string, unknown> = {};
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    }
    window.localStorage.setItem(
      STORAGE_KEY_PREFS,
      JSON.stringify({ ...existing, inspectorCollapsed: collapsed }),
    );
  } catch {
    // Ignore storage errors
  }
}

export function useRigStore() {
  const [shareMode, setShareMode] = useState<ShareModeInfo>(readCurrentShareMode);
  const lockedReadOnly = shareMode.lockedReadOnly;

  const [rig, setRig] = useState<RigDocument>(() =>
    shareMode.source === 'embedded' ? createMockRig() : loadInitialRig(),
  );
  const [rigOrigin, setRigOrigin] = useState<'local' | 'embedded'>(
    shareMode.source === 'embedded' ? 'embedded' : 'local',
  );
  const [sharedLoading, setSharedLoading] = useState<boolean>(shareMode.source === 'embedded');
  const [sharedLoadError, setSharedLoadError] = useState<string | null>(null);

  // Volunteer-First UX: always default to Read-Only Mode on startup
  const [editModeState, setEditModeState] = useState<boolean>(false);
  const [patchUnlockedState, setPatchUnlockedState] = useState<boolean>(false);
  const [inspectorCollapsed, setInspectorCollapsedState] = useState<boolean>(readInspectorCollapsed);
  const [selection, setSelection] = useState<SelectionState>(null);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [viewState, setViewState] = useState<AppViewMode>('canvas');

  const editMode = lockedReadOnly ? false : editModeState;
  const patchUnlocked = lockedReadOnly ? false : patchUnlockedState;
  const view: AppViewMode = lockedReadOnly && viewState === 'patch' ? 'canvas' : viewState;

  const setEditMode = useCallback(
    (next: boolean) => {
      if (lockedReadOnly) return;
      setEditModeState(next);
    },
    [lockedReadOnly],
  );

  const setPatchUnlocked = useCallback(
    (next: boolean) => {
      if (lockedReadOnly) return;
      setPatchUnlockedState(next);
    },
    [lockedReadOnly],
  );

  const setView = useCallback(
    (next: AppViewMode) => {
      if (lockedReadOnly && next === 'patch') return;
      setViewState(next);
    },
    [lockedReadOnly],
  );

  const setInspectorCollapsed = useCallback((collapsed: boolean) => {
    setInspectorCollapsedState(collapsed);
    writeInspectorCollapsed(collapsed);
  }, []);

  const toggleInspectorCollapsed = useCallback(() => {
    setInspectorCollapsedState((prev) => {
      const next = !prev;
      writeInspectorCollapsed(next);
      return next;
    });
  }, []);

  // Raw lossless .snap baselines (persisted in IndexedDB wing-rig:snapshots:v1)
  const [baselines, setBaselines] = useState<Record<string, ConsoleBaselineRecord>>({});
  const [stagedPatches, setStagedPatches] = useState<StagedPatchEntry[]>(() =>
    shareMode.lockedReadOnly ? [] : loadInitialStaged(),
  );
  const [linkConfig, setLinkConfig] = useState<ConsoleLinkConfig>(() =>
    shareMode.source === 'embedded' ? inferConsoleLinkConfig(rig) : loadInitialLinkConfig(rig),
  );

  // React to URL hash/query navigation (e.g., opening or leaving a #view= link)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncShareMode = () => {
      const next = readCurrentShareMode();
      setShareMode(next);
      if (next.source !== 'embedded') {
        const localRig = loadInitialRig();
        setRig(localRig);
        setRigOrigin('local');
        setStagedPatches(next.lockedReadOnly ? [] : loadInitialStaged());
        setLinkConfig(loadInitialLinkConfig(localRig));
        setSelection(null);
        setTrace(null);
      }
    };
    window.addEventListener('hashchange', syncShareMode);
    window.addEventListener('popstate', syncShareMode);
    return () => {
      window.removeEventListener('hashchange', syncShareMode);
      window.removeEventListener('popstate', syncShareMode);
    };
  }, []);

  // Decode embedded #view=... shared rig strictly in memory (never touches localStorage)
  useEffect(() => {
    if (shareMode.source !== 'embedded') {
      setSharedLoading(false);
      setSharedLoadError(null);
      return;
    }

    let active = true;
    setRigOrigin('embedded');
    setSharedLoading(true);
    setSharedLoadError(null);
    setEditModeState(false);
    setPatchUnlockedState(false);
    setStagedPatches([]);
    setSelection(null);
    setTrace(null);

    void decodeRigPayload(shareMode.encodedPayload).then((result) => {
      if (!active) return;
      if (result.ok) {
        setRig(result.rig);
        setRigOrigin('embedded');
        setLinkConfig(inferConsoleLinkConfig(result.rig));
        setSharedLoadError(null);
      } else {
        setSharedLoadError(result.error);
      }
      setSharedLoading(false);
    });

    return () => {
      active = false;
    };
  }, [shareMode]);

  // Hydrate raw .snap baselines from IndexedDB on mount (only in editable main mode)
  useEffect(() => {
    if (lockedReadOnly) return;
    let active = true;
    void loadAllBaselines().then((loaded) => {
      if (active) setBaselines(loaded);
    });
    return () => {
      active = false;
    };
  }, [lockedReadOnly]);

  useEffect(() => {
    if (lockedReadOnly || rigOrigin !== 'local') return;
    try {
      window.localStorage.setItem(STORAGE_KEY_RIG, JSON.stringify(rig));
    } catch {
      // Ignore storage quota errors in restricted browsing modes
    }
  }, [rig, lockedReadOnly, rigOrigin]);

  useEffect(() => {
    if (lockedReadOnly || rigOrigin !== 'local') return;
    try {
      window.localStorage.setItem(STORAGE_KEY_STAGED, JSON.stringify(stagedPatches));
    } catch {
      // Ignore storage errors
    }
  }, [stagedPatches, lockedReadOnly, rigOrigin]);

  useEffect(() => {
    if (lockedReadOnly || rigOrigin !== 'local') return;
    try {
      window.localStorage.setItem(STORAGE_KEY_LINK, JSON.stringify(linkConfig));
    } catch {
      // Ignore storage errors
    }
  }, [linkConfig, lockedReadOnly, rigOrigin]);

  // Keep linkConfig valid if consoles are added/removed
  useEffect(() => {
    const consoleIds = new Set(rig.nodes.filter((n) => n.kind === 'console').map((n) => n.id));
    if (consoleIds.size === 0) return;
    if (
      !consoleIds.has(linkConfig.stageConsoleId) ||
      (linkConfig.fohConsoleId && !consoleIds.has(linkConfig.fohConsoleId))
    ) {
      setLinkConfig(inferConsoleLinkConfig(rig));
    }
  }, [rig, linkConfig]);

  // Lightweight baseline metadata (keeps raw .snap strings out of UI components)
  const baselineMetas = useMemo<Record<string, ConsoleBaselineMeta>>(() => {
    const out: Record<string, ConsoleBaselineMeta> = {};
    for (const [id, rec] of Object.entries(baselines)) {
      out[id] = {
        consoleNodeId: rec.consoleNodeId,
        fileName: rec.fileName,
        creatorName: rec.creatorName,
        snapshotType: rec.snapshotType,
        creatorVersion: rec.creatorVersion,
        byteLength: rec.byteLength,
        importedAt: rec.importedAt,
      };
    }
    return out;
  }, [baselines]);

  // Live Effective Rig: overlays staged .snap patches onto the committed RigDocument in memory
  // so the Schematic Canvas, Side Inspector, Search, and Click-to-Trace verify staged paths live!
  const effectiveRig = useMemo<RigDocument>(() => {
    if (stagedPatches.length === 0) return rig;

    const opsByConsole = new Map<string, StagedPatchEntry[]>();
    for (const entry of stagedPatches) {
      const list = opsByConsole.get(entry.consoleNodeId) ?? [];
      list.push(entry);
      opsByConsole.set(entry.consoleNodeId, list);
    }

    let current = rig;
    for (const [consoleId, entries] of opsByConsole) {
      const baseline = baselines[consoleId];
      if (!baseline) continue;
      try {
        const patchedRaw = applyPatchOpsToRawSnap(
          baseline.rawJson,
          entries.map((e) => e.op),
        );
        const parsed = parseWingSnap(patchedRaw, {
          fileName: baseline.fileName,
          consoleNodeId: consoleId,
          importedAt: baseline.importedAt,
        });
        current = applySnapMerge(current, parsed, consoleId).rig;
      } catch {
        // If a baseline fails to parse, leave committed state intact
      }
    }
    return current;
  }, [rig, baselines, stagedPatches]);

  const auditIssues = useMemo(
    () => verifyRigPaths(effectiveRig, linkConfig, baselineMetas, stagedPatches),
    [effectiveRig, linkConfig, baselineMetas, stagedPatches],
  );

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
      const result = traceSignal(effectiveRig, target);
      setTrace(result);
    },
    [effectiveRig],
  );

  const traceOnSchematic = useCallback(
    (target: TraceTarget) => {
      const result = traceSignal(effectiveRig, target);
      setTrace(result);
      if (target.trunkId) {
        setSelection({ type: 'trunk', id: target.trunkId });
      } else if (target.nodeId) {
        setSelection({ type: 'node', id: target.nodeId });
      }
      setView('canvas');
    },
    [effectiveRig],
  );

  const clearTrace = useCallback(() => {
    setTrace(null);
  }, []);

  const updateRigMeta = useCallback(
    (patch: Partial<Pick<RigDocument, 'name' | 'venue'>>) => {
      if (lockedReadOnly) return;
      setRig((prev) => ({
        ...prev,
        ...patch,
        updatedAt: new Date().toISOString(),
      }));
    },
    [lockedReadOnly],
  );

  const updateNodePosition = useCallback(
    (nodeId: string, position: Point2D) => {
      if (lockedReadOnly) return;
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
    },
    [lockedReadOnly],
  );

  const updateNodeAnnotation = useCallback(
    (nodeId: string, patch: Partial<NodeAnnotation>) => {
      if (lockedReadOnly) return;
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
    },
    [lockedReadOnly],
  );

  const updateTrunkAnnotation = useCallback(
    (trunkId: string, patch: Partial<TrunkAnnotation>) => {
      if (lockedReadOnly) return;
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
    },
    [lockedReadOnly],
  );

  const updateChannelAnnotation = useCallback(
    (channelId: string, patch: Partial<ChannelAnnotation>) => {
      if (lockedReadOnly) return;
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
    [lockedReadOnly],
  );

  const updateBusAnnotation = useCallback(
    (busId: string, patch: Partial<BusAnnotation>) => {
      if (lockedReadOnly) return;
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
    },
    [lockedReadOnly],
  );

  const dismissOrphan = useCallback(
    (key: string) => {
      if (lockedReadOnly) return;
      setRig((prev) => ({
        ...prev,
        updatedAt: new Date().toISOString(),
        annotations: {
          ...prev.annotations,
          orphaned: prev.annotations.orphaned.filter((o) => o.key !== key),
        },
      }));
    },
    [lockedReadOnly],
  );

  const addManualNode = useCallback(
    (node: HardwareNode, friendlyName?: string, notes?: string) => {
      if (lockedReadOnly) return;
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
    },
    [lockedReadOnly],
  );

  const deleteManualNode = useCallback(
    (nodeId: string) => {
      if (lockedReadOnly) return;
      setRig((prev) => ({
        ...prev,
        updatedAt: new Date().toISOString(),
        nodes: prev.nodes.filter((n) => n.id !== nodeId),
        trunks: prev.trunks.filter((t) => t.sourceNodeId !== nodeId && t.targetNodeId !== nodeId),
      }));
      setSelection((cur) => (cur?.type === 'node' && cur.id === nodeId ? null : cur));
      setTrace(null);
    },
    [lockedReadOnly],
  );

  const addManualTrunk = useCallback(
    (trunk: TrunkConnection, cableTag?: string, notes?: string) => {
      if (lockedReadOnly) return;
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
    },
    [lockedReadOnly],
  );

  const deleteManualTrunk = useCallback(
    (trunkId: string) => {
      if (lockedReadOnly) return;
      setRig((prev) => ({
        ...prev,
        updatedAt: new Date().toISOString(),
        trunks: prev.trunks.filter((t) => t.id !== trunkId),
      }));
      setSelection((cur) => (cur?.type === 'trunk' && cur.id === trunkId ? null : cur));
      setTrace(null);
    },
    [lockedReadOnly],
  );

  const applySnapshot = useCallback(
    (parsed: ParsedWingSnapshot, targetConsoleId?: string, rawSnapJson?: string): SnapMergeDiff => {
      const merged = applySnapMerge(rig, parsed, targetConsoleId);
      if (lockedReadOnly) return merged.diff;
      setRig(merged.rig);
      const resolvedId = merged.diff.targetConsoleNodeId;
      setSelection({ type: 'node', id: resolvedId });
      setTrace(null);

      // Persist raw .snap baseline in IndexedDB for lossless Patch Studio editing & export
      if (rawSnapJson) {
        const record: ConsoleBaselineRecord = {
          consoleNodeId: resolvedId,
          fileName: parsed.metadata.fileName,
          creatorName: parsed.metadata.creatorName,
          snapshotType: parsed.metadata.snapshotType,
          creatorVersion: parsed.metadata.creatorVersion,
          byteLength: rawSnapJson.length,
          importedAt: parsed.metadata.importedAt,
          rawJson: rawSnapJson,
        };
        setBaselines((prev) => ({ ...prev, [resolvedId]: record }));
        void saveBaselineRecord(record);
        // Clear older staged patches targeting this console since a fresh baseline was imported
        setStagedPatches((prev) => prev.filter((p) => p.consoleNodeId !== resolvedId));
      }

      return merged.diff;
    },
    [rig, lockedReadOnly],
  );

  // Patch Studio staging & export actions
  const stagePatches = useCallback(
    (entries: StagedPatchEntry[]) => {
      if (lockedReadOnly || entries.length === 0) return;
      setStagedPatches((prev) => [...prev, ...entries]);
    },
    [lockedReadOnly],
  );

  const removeStagedPatch = useCallback(
    (patchId: string) => {
      if (lockedReadOnly) return;
      setStagedPatches((prev) => prev.filter((p) => p.id !== patchId));
    },
    [lockedReadOnly],
  );

  const undoLastStagedPatch = useCallback(() => {
    if (lockedReadOnly) return;
    setStagedPatches((prev) => prev.slice(0, -1));
  }, [lockedReadOnly]);

  const discardStagedPatches = useCallback(
    (consoleNodeId?: string) => {
      if (lockedReadOnly) return;
      if (!consoleNodeId) {
        setStagedPatches([]);
      } else {
        setStagedPatches((prev) => prev.filter((p) => p.consoleNodeId !== consoleNodeId));
      }
    },
    [lockedReadOnly],
  );

  const updateLinkConfig = useCallback(
    (patch: Partial<ConsoleLinkConfig>) => {
      if (lockedReadOnly) return;
      setLinkConfig((prev) => ({ ...prev, ...patch }));
    },
    [lockedReadOnly],
  );

  const exportPatchedSnap = useCallback(
    (consoleNodeId: string, customFileName?: string): { ok: true; fileName: string } | { ok: false; error: string } => {
      if (lockedReadOnly) {
        return { ok: false, error: 'Read-only shared view cannot export .snap files.' };
      }
      const baseline = baselines[consoleNodeId];
      if (!baseline) {
        return { ok: false, error: 'No .snap baseline loaded for this console.' };
      }
      try {
        const consoleOps = stagedPatches
          .filter((p) => p.consoleNodeId === consoleNodeId)
          .map((p) => p.op);
        const patchedJson = applyPatchOpsToRawSnap(baseline.rawJson, consoleOps);
        const rawName = (customFileName ?? '').trim() || buildDefaultSnapExportName(baseline.fileName);
        const fileName = /\.snap$/i.test(rawName) ? rawName : `${rawName}.snap`;

        const blob = new Blob([patchedJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        return { ok: true, fileName };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to serialize patched .snap.',
        };
      }
    },
    [baselines, stagedPatches, lockedReadOnly],
  );

  const commitConsoleBaseline = useCallback(
    (consoleNodeId: string, newFileName?: string): boolean => {
      if (lockedReadOnly) return false;
      const baseline = baselines[consoleNodeId];
      if (!baseline) return false;
      const consoleOps = stagedPatches
        .filter((p) => p.consoleNodeId === consoleNodeId)
        .map((p) => p.op);
      if (consoleOps.length === 0) return false;

      const patchedJson = applyPatchOpsToRawSnap(baseline.rawJson, consoleOps);
      const now = new Date().toISOString();
      const fileName =
        (newFileName ?? '').trim() || buildDefaultSnapExportName(baseline.fileName);
      const parsed = parseWingSnap(patchedJson, {
        fileName,
        consoleNodeId,
        importedAt: now,
      });
      const merged = applySnapMerge(rig, parsed, consoleNodeId);
      setRig(merged.rig);

      const updatedBaseline: ConsoleBaselineRecord = {
        ...baseline,
        fileName,
        byteLength: patchedJson.length,
        importedAt: now,
        rawJson: patchedJson,
      };
      setBaselines((prev) => ({ ...prev, [consoleNodeId]: updatedBaseline }));
      void saveBaselineRecord(updatedBaseline);
      setStagedPatches((prev) => prev.filter((p) => p.consoleNodeId !== consoleNodeId));
      return true;
    },
    [baselines, stagedPatches, rig, lockedReadOnly],
  );

  const deleteConsoleBaseline = useCallback(
    (consoleNodeId: string) => {
      if (lockedReadOnly) return;
      setBaselines((prev) => {
        const next = { ...prev };
        delete next[consoleNodeId];
        return next;
      });
      setStagedPatches((prev) => prev.filter((p) => p.consoleNodeId !== consoleNodeId));
      void deleteBaselineRecord(consoleNodeId);
    },
    [lockedReadOnly],
  );

  const importRigJson = useCallback(
    (rawText: string): { ok: true } | { ok: false; error: string } => {
      if (lockedReadOnly) {
        return { ok: false, error: 'Read-only shared view cannot import .rig.json files.' };
      }
      try {
        const parsed = JSON.parse(rawText) as unknown;
        const validation = validateRigDocument(parsed);
        if (!validation.valid) {
          return {
            ok: false,
            error: validation.issues.map((i) => `${i.path}: ${i.message}`).join('; '),
          };
        }
        const doc = parsed as RigDocument;
        setRig(doc);
        setLinkConfig(inferConsoleLinkConfig(doc));
        setSelection(null);
        setTrace(null);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Invalid JSON file.',
        };
      }
    },
    [lockedReadOnly],
  );

  const exportRigJson = useCallback(() => {
    if (lockedReadOnly) return;
    const blob = new Blob([JSON.stringify(effectiveRig, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = effectiveRig.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    a.download = `${safeName || 'wing-rig'}.rig.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [effectiveRig, lockedReadOnly]);

  const resetToDemoRig = useCallback(() => {
    if (lockedReadOnly) return;
    const demo = createMockRig();
    setRig(demo);
    setLinkConfig(inferConsoleLinkConfig(demo));
    setStagedPatches([]);
    setBaselines({});
    void clearAllBaselines();
    setSelection(null);
    setTrace(null);
  }, [lockedReadOnly]);

  return {
    rig: effectiveRig,
    committedRig: rig,
    lockedReadOnly,
    shareSource: shareMode.source,
    sharedLoading,
    sharedLoadError,
    editMode,
    setEditMode,
    patchUnlocked,
    setPatchUnlocked,
    inspectorCollapsed,
    setInspectorCollapsed,
    toggleInspectorCollapsed,
    selection,
    selectNode,
    selectTrunk,
    clearSelection,
    trace,
    runTrace,
    traceOnSchematic,
    clearTrace,
    view,
    setView,
    baselineMetas,
    stagedPatches,
    linkConfig,
    auditIssues,
    stagePatches,
    removeStagedPatch,
    undoLastStagedPatch,
    discardStagedPatches,
    updateLinkConfig,
    exportPatchedSnap,
    commitConsoleBaseline,
    deleteConsoleBaseline,
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
