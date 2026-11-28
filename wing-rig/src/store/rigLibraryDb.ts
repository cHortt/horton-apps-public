import type { RigDocument } from '../schema/rig';
import type {
  ConsoleBaselineMeta,
  ConsoleBaselineRecord,
  ConsoleLinkConfig,
  StagedPatchEntry,
} from '../schema/patch';
import { inferConsoleLinkConfig } from '../parser/snapVerifier';

// Strict applet isolation: IndexedDB & localStorage keys strictly prefixed with "wing-rig:"
const LIBRARY_DB_NAME = 'wing-rig:library:v1';
const LIBRARY_DB_VERSION = 1;
const LIBRARY_STORE_NAME = 'entries';

export const STORAGE_KEY_ACTIVE_PROFILE = 'wing-rig:active-profile:v1';
export const STORAGE_KEY_DELTA_CHECKS = 'wing-rig:delta-checks:v1';

export interface RigLibraryEntry {
  id: string;
  name: string;
  venue: string;
  notes?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** Working RigDocument (Layer 1 committed facts + Layer 2 annotations) */
  rig: RigDocument;
  /** Snapshot of the rig when baseline was last imported or explicitly marked clean */
  baselineRig: RigDocument;
  /** Raw lossless .snap baselines scoped strictly to this library entry */
  baselines: Record<string, ConsoleBaselineRecord>;
  /** Pending Patch Studio staged edits scoped to this library entry */
  stagedPatches: StagedPatchEntry[];
  /** Inter-console link & headamp ownership config for this library entry */
  linkConfig: ConsoleLinkConfig;
}

export interface RigLibrarySummary {
  id: string;
  name: string;
  venue: string;
  notes?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  trunkCount: number;
  stagedCount: number;
  baselineMetas: ConsoleBaselineMeta[];
}

export function cloneRigDocument(rig: RigDocument): RigDocument {
  return JSON.parse(JSON.stringify(rig)) as RigDocument;
}

export function generateProfileId(prefix = 'rig'): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function summarizeLibraryEntry(entry: RigLibraryEntry): RigLibrarySummary {
  const baselineMetas: ConsoleBaselineMeta[] = Object.values(entry.baselines).map((rec) => ({
    consoleNodeId: rec.consoleNodeId,
    fileName: rec.fileName,
    creatorName: rec.creatorName,
    snapshotType: rec.snapshotType,
    creatorVersion: rec.creatorVersion,
    byteLength: rec.byteLength,
    importedAt: rec.importedAt,
  }));

  return {
    id: entry.id,
    name: entry.name,
    venue: entry.venue,
    notes: entry.notes,
    tags: [...entry.tags],
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    nodeCount: entry.rig.nodes.length,
    trunkCount: entry.rig.trunks.length,
    stagedCount: entry.stagedPatches.length,
    baselineMetas,
  };
}

export function createLibraryEntryFromRig(
  rig: RigDocument,
  options?: {
    id?: string;
    name?: string;
    venue?: string;
    notes?: string;
    tags?: string[];
    baselineRig?: RigDocument;
    baselines?: Record<string, ConsoleBaselineRecord>;
    stagedPatches?: StagedPatchEntry[];
    linkConfig?: ConsoleLinkConfig;
  },
): RigLibraryEntry {
  const now = new Date().toISOString();
  const clonedRig = cloneRigDocument(rig);
  const name = options?.name?.trim() || clonedRig.name || 'Untitled Rig';
  const venue = options?.venue?.trim() ?? clonedRig.venue ?? '';
  clonedRig.name = name;
  clonedRig.venue = venue;

  return {
    id: options?.id ?? generateProfileId('profile'),
    name,
    venue,
    notes: options?.notes,
    tags: options?.tags ? [...options.tags] : [],
    createdAt: now,
    updatedAt: now,
    rig: clonedRig,
    baselineRig: options?.baselineRig ? cloneRigDocument(options.baselineRig) : cloneRigDocument(clonedRig),
    baselines: options?.baselines ? JSON.parse(JSON.stringify(options.baselines)) : {},
    stagedPatches: options?.stagedPatches ? JSON.parse(JSON.stringify(options.stagedPatches)) : [],
    linkConfig: options?.linkConfig
      ? { ...options.linkConfig }
      : inferConsoleLinkConfig(clonedRig),
  };
}

export function duplicateLibraryEntry(
  source: RigLibraryEntry,
  options?: {
    name?: string;
    notes?: string;
    tags?: string[];
    resetBaselineToCurrent?: boolean;
  },
): RigLibraryEntry {
  const now = new Date().toISOString();
  const clonedRig = cloneRigDocument(source.rig);
  const copyName = options?.name?.trim() || `${source.name} (Copy)`;
  clonedRig.name = copyName;
  clonedRig.updatedAt = now;

  return {
    id: generateProfileId('event'),
    name: copyName,
    venue: source.venue,
    notes: options?.notes ?? source.notes,
    tags: options?.tags ? [...options.tags] : [...source.tags],
    createdAt: now,
    updatedAt: now,
    rig: clonedRig,
    baselineRig: options?.resetBaselineToCurrent
      ? cloneRigDocument(clonedRig)
      : cloneRigDocument(source.baselineRig),
    baselines: JSON.parse(JSON.stringify(source.baselines)) as Record<string, ConsoleBaselineRecord>,
    stagedPatches: JSON.parse(JSON.stringify(source.stagedPatches)) as StagedPatchEntry[],
    linkConfig: { ...source.linkConfig },
  };
}

function openLibraryDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(LIBRARY_DB_NAME, LIBRARY_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LIBRARY_STORE_NAME)) {
          db.createObjectStore(LIBRARY_STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadAllLibraryEntries(): Promise<RigLibraryEntry[]> {
  const db = await openLibraryDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(LIBRARY_STORE_NAME, 'readonly');
      const req = tx.objectStore(LIBRARY_STORE_NAME).getAll();
      req.onsuccess = () => {
        const items = (req.result as RigLibraryEntry[] | undefined) ?? [];
        const valid = items
          .filter((item) => item && typeof item.id === 'string' && item.rig)
          .map((item) => ({
            ...item,
            baselineRig: item.baselineRig ?? cloneRigDocument(item.rig),
            baselines: item.baselines ?? {},
            stagedPatches: Array.isArray(item.stagedPatches) ? item.stagedPatches : [],
            tags: Array.isArray(item.tags) ? item.tags : [],
            linkConfig: item.linkConfig ?? inferConsoleLinkConfig(item.rig),
          }))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        resolve(valid);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function saveLibraryEntry(entry: RigLibraryEntry): Promise<void> {
  const db = await openLibraryDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(LIBRARY_STORE_NAME, 'readwrite');
      tx.objectStore(LIBRARY_STORE_NAME).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteLibraryEntryFromDb(id: string): Promise<void> {
  const db = await openLibraryDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(LIBRARY_STORE_NAME, 'readwrite');
      tx.objectStore(LIBRARY_STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function readActiveProfileId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY_ACTIVE_PROFILE);
  } catch {
    return null;
  }
}

export function writeActiveProfileId(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_ACTIVE_PROFILE, id);
  } catch {
    // Ignore restricted storage errors
  }
}

export function readDeltaChecksMap(): Record<string, string[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_DELTA_CHECKS);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string[]>;
    }
  } catch {
    // Ignore malformed cache
  }
  return {};
}

export function writeDeltaChecksMap(map: Record<string, string[]>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_DELTA_CHECKS, JSON.stringify(map));
  } catch {
    // Ignore storage errors
  }
}
