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
  PatchPrefillIntent,
  StagedPatchEntry,
} from '../schema/patch';
import { traceSignal, validateRigDocument } from '../schema/helpers';
import { createMockRig } from '../schema/mockRig';
import { applySnapMerge, type SnapMergeDiff } from '../parser/merge';
import { parseWingSnap, type ParsedWingSnapshot } from '../parser/wingSnapParser';
import { applyPatchOpsToRawSnap, buildDefaultSnapExportName } from '../parser/snapPatcher';
import { inferConsoleLinkConfig, verifyRigPaths } from '../parser/snapVerifier';
import { computeRigDiff } from '../parser/rigDiff';
import {
  clearAllBaselines,
  deleteBaselineRecord,
  loadAllBaselines,
  saveBaselineRecord,
} from './snapBaselineDb';
import {
  cloneRigDocument,
  createLibraryEntryFromRig,
  deleteLibraryEntryFromDb,
  duplicateLibraryEntry,
  generateProfileId,
  loadAllLibraryEntries,
  readActiveProfileId,
  saveLibraryEntry,
  summarizeLibraryEntry,
  writeActiveProfileId,
  type RigLibraryEntry,
  type RigLibrarySummary,
} from './rigLibraryDb';
import {
  buildBundleFileName,
  parseRigOrBundleJson,
  serializeRigBundle,
} from './rigBundle';
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

export type AppViewMode = 'canvas' | 'strips' | 'patch' | 'diff' | 'print';

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
  const [patchPrefill, setPatchPrefill] = useState<PatchPrefillIntent | null>(null);

  // Clean baseline RigDocument for Delta Checklist tracking (physical + .snap changes)
  const [baselineRig, setBaselineRig] = useState<RigDocument>(() => cloneRigDocument(rig));

  // Multi-Rig Library state (persisted in IndexedDB wing-rig:library:v1)
  const [libraryEntries, setLibraryEntries] = useState<RigLibraryEntry[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>(() => readActiveProfileId() ?? '');
  const [libraryReady, setLibraryReady] = useState<boolean>(false);

  const editMode = lockedReadOnly ? false : editModeState;
  const patchUnlocked = lockedReadOnly ? false : patchUnlockedState;
  const view: AppViewMode =
    lockedReadOnly && (viewState === 'patch' || viewState === 'diff') ? 'canvas' : viewState;

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
      if (lockedReadOnly && (next === 'patch' || next === 'diff')) return;
      setViewState(next);
    },
    [lockedReadOnly],
  );

  const openPatchHere = useCallback(
    (intent: PatchPrefillIntent) => {
      if (lockedReadOnly) return;
      setPatchPrefill(intent);
      setPatchUnlockedState(true);
      setViewState('patch');
    },
    [lockedReadOnly],
  );

  const clearPatchPrefill = useCallback(() => {
    setPatchPrefill(null);
  }, []);

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

  // Raw lossless .snap baselines scoped to the active profile
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
        setBaselineRig(cloneRigDocument(localRig));
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
        setBaselineRig(cloneRigDocument(result.rig));
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

  // Hydrate Multi-Rig Library from IndexedDB (auto-migrating legacy single-rig + baselines on first run)
  useEffect(() => {
    if (lockedReadOnly || rigOrigin !== 'local') return;
    let active = true;

    void Promise.all([loadAllLibraryEntries(), loadAllBaselines()]).then(
      ([storedEntries, legacyBaselines]) => {
        if (!active) return;
        if (storedEntries.length === 0) {
          const initial = createLibraryEntryFromRig(rig, {
            id: activeProfileId || generateProfileId('rig'),
            name: rig.name,
            venue: rig.venue,
            tags: ['Primary'],
            baselineRig: cloneRigDocument(rig),
            baselines: legacyBaselines,
            stagedPatches,
            linkConfig,
          });
          setLibraryEntries([initial]);
          setActiveProfileId(initial.id);
          setBaselines(initial.baselines);
          setBaselineRig(initial.baselineRig);
          writeActiveProfileId(initial.id);
          void saveLibraryEntry(initial);
          setLibraryReady(true);
          return;
        }

        const savedActiveId = readActiveProfileId();
        const chosen =
          storedEntries.find((e) => e.id === savedActiveId) ?? storedEntries[0];

        setLibraryEntries(storedEntries);
        setActiveProfileId(chosen.id);
        setRig(chosen.rig);
        setBaselineRig(chosen.baselineRig ?? cloneRigDocument(chosen.rig));
        setBaselines(chosen.baselines);
        setStagedPatches(chosen.stagedPatches);
        setLinkConfig(chosen.linkConfig ?? inferConsoleLinkConfig(chosen.rig));
        writeActiveProfileId(chosen.id);
        setLibraryReady(true);
      },
    );

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedReadOnly, rigOrigin]);

  // Persist active rig + staged patches + linkConfig to fast localStorage cache
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

  // Sync active profile state into the Multi-Rig Library IndexedDB store
  useEffect(() => {
    if (!libraryReady || !activeProfileId || lockedReadOnly || rigOrigin !== 'local') return;

    setLibraryEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === activeProfileId);
      if (idx === -1) return prev;
      const existing = prev[idx];
      const updated: RigLibraryEntry = {
        ...existing,
        name: rig.name || existing.name,
        venue: rig.venue ?? existing.venue,
        updatedAt: new Date().toISOString(),
        rig,
        baselineRig,
        baselines,
        stagedPatches,
        linkConfig,
      };
      void saveLibraryEntry(updated);
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
  }, [
    libraryReady,
    activeProfileId,
    lockedReadOnly,
    rigOrigin,
    rig,
    baselineRig,
    baselines,
    stagedPatches,
    linkConfig,
  ]);

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

  // Live diff between this profile's clean baselineRig and effectiveRig (captures both .snap & physical edits)
  const baselineDiff = useMemo(() => {
    const exportNames: Record<string, string> = {};
    for (const [cid, meta] of Object.entries(baselineMetas)) {
      exportNames[cid] = buildDefaultSnapExportName(meta.fileName);
    }
    return computeRigDiff(baselineRig, effectiveRig, {
      beforeLabel: `${baselineRig.name} (Baseline)`,
      afterLabel: `${effectiveRig.name} (Current)`,
      consoleExportFileNames: exportNames,
    });
  }, [baselineRig, effectiveRig, baselineMetas]);

  const librarySummaries = useMemo<RigLibrarySummary[]>(
    () => libraryEntries.map(summarizeLibraryEntry),
    [libraryEntries],
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

      const hadBaselineForConsole = Boolean(baselines[resolvedId]);
      if (!hadBaselineForConsole && rig.sourceSnapshots.length === 0) {
        setBaselineRig(cloneRigDocument(merged.rig));
      }

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
    [rig, baselines, lockedReadOnly],
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

  const switchProfile = useCallback(
    (profileId: string) => {
      if (lockedReadOnly) return;
      const target = libraryEntries.find((e) => e.id === profileId);
      if (!target) return;
      setActiveProfileId(target.id);
      writeActiveProfileId(target.id);
      setRig(cloneRigDocument(target.rig));
      setBaselineRig(cloneRigDocument(target.baselineRig ?? target.rig));
      setBaselines(JSON.parse(JSON.stringify(target.baselines)) as Record<string, ConsoleBaselineRecord>);
      setStagedPatches(JSON.parse(JSON.stringify(target.stagedPatches)) as StagedPatchEntry[]);
      setLinkConfig({ ...target.linkConfig });
      setSelection(null);
      setTrace(null);
    },
    [libraryEntries, lockedReadOnly],
  );

  const duplicateProfile = useCallback(
    (
      sourceProfileId: string,
      options?: {
        name?: string;
        notes?: string;
        tags?: string[];
        resetBaselineToCurrent?: boolean;
        activate?: boolean;
      },
    ): RigLibraryEntry | null => {
      if (lockedReadOnly) return null;
      const source = libraryEntries.find((e) => e.id === sourceProfileId);
      if (!source) return null;
      const copy = duplicateLibraryEntry(source, options);
      setLibraryEntries((prev) => [copy, ...prev]);
      void saveLibraryEntry(copy);
      if (options?.activate !== false) {
        setActiveProfileId(copy.id);
        writeActiveProfileId(copy.id);
        setRig(cloneRigDocument(copy.rig));
        setBaselineRig(cloneRigDocument(copy.baselineRig));
        setBaselines(JSON.parse(JSON.stringify(copy.baselines)) as Record<string, ConsoleBaselineRecord>);
        setStagedPatches(JSON.parse(JSON.stringify(copy.stagedPatches)) as StagedPatchEntry[]);
        setLinkConfig({ ...copy.linkConfig });
        setSelection(null);
        setTrace(null);
      }
      return copy;
    },
    [libraryEntries, lockedReadOnly],
  );

  const createNewProfile = useCallback(
    (options?: { name?: string; venue?: string; notes?: string; tags?: string[] }): RigLibraryEntry | null => {
      if (lockedReadOnly) return null;
      const demo = createMockRig();
      const entry = createLibraryEntryFromRig(demo, {
        name: options?.name?.trim() || 'New WING Rig',
        venue: options?.venue ?? demo.venue,
        notes: options?.notes,
        tags: options?.tags ?? [],
      });
      setLibraryEntries((prev) => [entry, ...prev]);
      void saveLibraryEntry(entry);
      setActiveProfileId(entry.id);
      writeActiveProfileId(entry.id);
      setRig(cloneRigDocument(entry.rig));
      setBaselineRig(cloneRigDocument(entry.baselineRig));
      setBaselines({});
      setStagedPatches([]);
      setLinkConfig({ ...entry.linkConfig });
      setSelection(null);
      setTrace(null);
      return entry;
    },
    [lockedReadOnly],
  );

  const updateProfileMeta = useCallback(
    (profileId: string, patch: { name?: string; venue?: string; notes?: string; tags?: string[] }) => {
      if (lockedReadOnly) return;
      const now = new Date().toISOString();
      setLibraryEntries((prev) =>
        prev.map((entry) => {
          if (entry.id !== profileId) return entry;
          const nextName = patch.name !== undefined ? patch.name : entry.name;
          const nextVenue = patch.venue !== undefined ? patch.venue : entry.venue;
          const updated: RigLibraryEntry = {
            ...entry,
            name: nextName,
            venue: nextVenue,
            notes: patch.notes !== undefined ? patch.notes : entry.notes,
            tags: patch.tags !== undefined ? [...patch.tags] : entry.tags,
            updatedAt: now,
            rig: {
              ...entry.rig,
              name: nextName,
              venue: nextVenue,
              updatedAt: now,
            },
          };
          void saveLibraryEntry(updated);
          return updated;
        }),
      );
      if (profileId === activeProfileId) {
        setRig((prev) => ({
          ...prev,
          name: patch.name !== undefined ? patch.name : prev.name,
          venue: patch.venue !== undefined ? patch.venue : prev.venue,
          updatedAt: now,
        }));
      }
    },
    [activeProfileId, lockedReadOnly],
  );

  const deleteProfile = useCallback(
    (profileId: string): boolean => {
      if (lockedReadOnly) return false;
      if (libraryEntries.length <= 1) return false;
      const remaining = libraryEntries.filter((e) => e.id !== profileId);
      setLibraryEntries(remaining);
      void deleteLibraryEntryFromDb(profileId);
      if (profileId === activeProfileId && remaining.length > 0) {
        const next = remaining[0];
        setActiveProfileId(next.id);
        writeActiveProfileId(next.id);
        setRig(cloneRigDocument(next.rig));
        setBaselineRig(cloneRigDocument(next.baselineRig ?? next.rig));
        setBaselines(JSON.parse(JSON.stringify(next.baselines)) as Record<string, ConsoleBaselineRecord>);
        setStagedPatches(JSON.parse(JSON.stringify(next.stagedPatches)) as StagedPatchEntry[]);
        setLinkConfig({ ...next.linkConfig });
        setSelection(null);
        setTrace(null);
      }
      return true;
    },
    [libraryEntries, activeProfileId, lockedReadOnly],
  );

  const markCurrentAsBaseline = useCallback(() => {
    if (lockedReadOnly) return;
    setBaselineRig(cloneRigDocument(effectiveRig));
  }, [effectiveRig, lockedReadOnly]);

  const exportProfileBundle = useCallback(
    (profileId?: string): { ok: true; fileName: string } | { ok: false; error: string } => {
      if (lockedReadOnly) {
        return { ok: false, error: 'Read-only view cannot export bundles.' };
      }
      const target =
        (profileId ? libraryEntries.find((e) => e.id === profileId) : undefined) ??
        libraryEntries.find((e) => e.id === activeProfileId) ??
        createLibraryEntryFromRig(rig, {
          baselineRig,
          baselines,
          stagedPatches,
          linkConfig,
        });

      try {
        const json = serializeRigBundle(target);
        const fileName = buildBundleFileName(target.name);
        const blob = new Blob([json], { type: 'application/json' });
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
          error: err instanceof Error ? err.message : 'Failed to export rig bundle.',
        };
      }
    },
    [
      lockedReadOnly,
      libraryEntries,
      activeProfileId,
      rig,
      baselineRig,
      baselines,
      stagedPatches,
      linkConfig,
    ],
  );

  const importProfileBundleOrRig = useCallback(
    (
      rawText: string,
      options?: { mode?: 'new-profile' | 'replace-active' },
    ):
      | { ok: true; kind: 'bundle' | 'rig'; profileName: string; baselineCount: number }
      | { ok: false; error: string } => {
      if (lockedReadOnly) {
        return { ok: false, error: 'Read-only shared view cannot import files.' };
      }
      const parsed = parseRigOrBundleJson(rawText);
      if (!parsed.ok) return parsed;

      const mode = options?.mode ?? (parsed.kind === 'bundle' ? 'new-profile' : 'replace-active');

      if (parsed.kind === 'bundle') {
        const incoming = parsed.entry;
        const collides = libraryEntries.some((e) => e.id === incoming.id);
        const finalEntry: RigLibraryEntry =
          mode === 'new-profile' && collides
            ? {
                ...incoming,
                id: generateProfileId('bundle'),
                updatedAt: new Date().toISOString(),
              }
            : {
                ...incoming,
                id: mode === 'replace-active' && activeProfileId ? activeProfileId : incoming.id,
                updatedAt: new Date().toISOString(),
              };

        setLibraryEntries((prev) => {
          const exists = prev.some((e) => e.id === finalEntry.id);
          return exists
            ? prev.map((e) => (e.id === finalEntry.id ? finalEntry : e))
            : [finalEntry, ...prev];
        });
        void saveLibraryEntry(finalEntry);
        setActiveProfileId(finalEntry.id);
        writeActiveProfileId(finalEntry.id);
        setRig(cloneRigDocument(finalEntry.rig));
        setBaselineRig(cloneRigDocument(finalEntry.baselineRig));
        setBaselines(JSON.parse(JSON.stringify(finalEntry.baselines)) as Record<string, ConsoleBaselineRecord>);
        setStagedPatches(JSON.parse(JSON.stringify(finalEntry.stagedPatches)) as StagedPatchEntry[]);
        setLinkConfig({ ...finalEntry.linkConfig });
        setSelection(null);
        setTrace(null);
        return {
          ok: true,
          kind: 'bundle',
          profileName: finalEntry.name,
          baselineCount: parsed.baselineCount,
        };
      }

      // Lightweight .rig.json import
      const doc = parsed.rig;
      if (mode === 'new-profile') {
        const entry = createLibraryEntryFromRig(doc, { name: doc.name, venue: doc.venue });
        setLibraryEntries((prev) => [entry, ...prev]);
        void saveLibraryEntry(entry);
        setActiveProfileId(entry.id);
        writeActiveProfileId(entry.id);
        setRig(cloneRigDocument(entry.rig));
        setBaselineRig(cloneRigDocument(entry.baselineRig));
        setBaselines({});
        setStagedPatches([]);
        setLinkConfig({ ...entry.linkConfig });
      } else {
        setRig(doc);
        setBaselineRig(cloneRigDocument(doc));
        setLinkConfig(inferConsoleLinkConfig(doc));
      }
      setSelection(null);
      setTrace(null);
      return { ok: true, kind: 'rig', profileName: doc.name, baselineCount: 0 };
    },
    [lockedReadOnly, libraryEntries, activeProfileId],
  );

  const importRigJson = useCallback(
    (rawText: string): { ok: true } | { ok: false; error: string } => {
      const res = importProfileBundleOrRig(rawText);
      if (!res.ok) return res;
      return { ok: true };
    },
    [importProfileBundleOrRig],
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
    setBaselineRig(cloneRigDocument(demo));
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
    baselineRig,
    baselineDiff,
    libraryEntries,
    librarySummaries,
    activeProfileId,
    lockedReadOnly,
    shareSource: shareMode.source,
    sharedLoading,
    sharedLoadError,
    editMode,
    setEditMode,
    patchUnlocked,
    setPatchUnlocked,
    patchPrefill,
    openPatchHere,
    clearPatchPrefill,
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
    switchProfile,
    duplicateProfile,
    createNewProfile,
    updateProfileMeta,
    deleteProfile,
    markCurrentAsBaseline,
    exportProfileBundle,
    importProfileBundleOrRig,
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
