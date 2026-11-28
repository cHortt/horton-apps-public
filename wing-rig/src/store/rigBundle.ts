import type { RigDocument } from '../schema/rig';
import type {
  ConsoleBaselineRecord,
  ConsoleLinkConfig,
  StagedPatchEntry,
} from '../schema/patch';
import { validateRigDocument } from '../schema/helpers';
import { inferConsoleLinkConfig } from '../parser/snapVerifier';
import {
  cloneRigDocument,
  createLibraryEntryFromRig,
  generateProfileId,
  type RigLibraryEntry,
} from './rigLibraryDb';

export const WING_RIG_BUNDLE_FORMAT = 'wing-rig-bundle' as const;
export const WING_RIG_BUNDLE_VERSION = 1 as const;

/**
 * Self-contained portable archive for an entire Rig Library entry,
 * including Layer 1 + Layer 2 RigDocument, clean baseline snapshot,
 * raw lossless .snap baselines, staged Patch Studio ops, and link config.
 */
export interface RigBundleDocument {
  format: typeof WING_RIG_BUNDLE_FORMAT;
  bundleVersion: typeof WING_RIG_BUNDLE_VERSION;
  exportedAt: string;
  entry: {
    id: string;
    name: string;
    venue: string;
    notes?: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
    rig: RigDocument;
    baselineRig: RigDocument;
    baselines: Record<string, ConsoleBaselineRecord>;
    stagedPatches: StagedPatchEntry[];
    linkConfig: ConsoleLinkConfig;
  };
}

export type ParsedImportPayload =
  | {
      ok: true;
      kind: 'bundle';
      entry: RigLibraryEntry;
      baselineCount: number;
      stagedCount: number;
    }
  | {
      ok: true;
      kind: 'rig';
      rig: RigDocument;
    }
  | {
      ok: false;
      error: string;
    };

export function buildRigBundle(entry: RigLibraryEntry): RigBundleDocument {
  return {
    format: WING_RIG_BUNDLE_FORMAT,
    bundleVersion: WING_RIG_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    entry: {
      id: entry.id,
      name: entry.name,
      venue: entry.venue,
      notes: entry.notes,
      tags: [...entry.tags],
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      rig: cloneRigDocument(entry.rig),
      baselineRig: cloneRigDocument(entry.baselineRig),
      baselines: JSON.parse(JSON.stringify(entry.baselines)) as Record<
        string,
        ConsoleBaselineRecord
      >,
      stagedPatches: JSON.parse(JSON.stringify(entry.stagedPatches)) as StagedPatchEntry[],
      linkConfig: { ...entry.linkConfig },
    },
  };
}

export function serializeRigBundle(entry: RigLibraryEntry): string {
  return JSON.stringify(buildRigBundle(entry), null, 2);
}

export function buildBundleFileName(name: string): string {
  const safe = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${safe || 'wing-rig'}.wingrig.json`;
}

export function estimateBundleBytes(entry: RigLibraryEntry): number {
  return serializeRigBundle(entry).length;
}

function validateBaselinesMap(
  raw: unknown,
): Record<string, ConsoleBaselineRecord> {
  const out: Record<string, ConsoleBaselineRecord> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const rec = value as Partial<ConsoleBaselineRecord>;
    if (
      typeof rec.consoleNodeId === 'string' &&
      typeof rec.fileName === 'string' &&
      typeof rec.rawJson === 'string'
    ) {
      out[key] = {
        consoleNodeId: rec.consoleNodeId,
        fileName: rec.fileName,
        creatorName: typeof rec.creatorName === 'string' ? rec.creatorName : '',
        snapshotType: typeof rec.snapshotType === 'string' ? rec.snapshotType : 'snapshot.11',
        creatorVersion: typeof rec.creatorVersion === 'string' ? rec.creatorVersion : '',
        byteLength: typeof rec.byteLength === 'number' ? rec.byteLength : rec.rawJson.length,
        importedAt:
          typeof rec.importedAt === 'string' ? rec.importedAt : new Date().toISOString(),
        rawJson: rec.rawJson,
      };
    }
  }
  return out;
}

/**
 * Parses either a full portable `.wingrig.json` bundle OR a lightweight `.rig.json` file.
 */
export function parseRigOrBundleJson(rawText: string): ParsedImportPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid JSON file.',
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'File root must be a JSON object.' };
  }

  const obj = parsed as Record<string, unknown>;

  // Full Portable Rig Bundle (.wingrig.json)
  if (obj.format === WING_RIG_BUNDLE_FORMAT) {
    if (obj.bundleVersion !== WING_RIG_BUNDLE_VERSION) {
      return {
        ok: false,
        error: `Unsupported bundle version: ${String(obj.bundleVersion)}`,
      };
    }
    const rawEntry = obj.entry;
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      return { ok: false, error: 'Bundle is missing entry payload.' };
    }
    const entryObj = rawEntry as Record<string, unknown>;
    const rigCheck = validateRigDocument(entryObj.rig);
    if (!rigCheck.valid) {
      return {
        ok: false,
        error: `Invalid rig inside bundle: ${rigCheck.issues
          .map((i) => `${i.path}: ${i.message}`)
          .join('; ')}`,
      };
    }
    const rigDoc = entryObj.rig as RigDocument;
    const baselineCheck = validateRigDocument(entryObj.baselineRig);
    const baselineRigDoc = baselineCheck.valid
      ? (entryObj.baselineRig as RigDocument)
      : cloneRigDocument(rigDoc);

    const baselines = validateBaselinesMap(entryObj.baselines);
    const stagedPatches = Array.isArray(entryObj.stagedPatches)
      ? (entryObj.stagedPatches as StagedPatchEntry[])
      : [];
    const linkConfig =
      entryObj.linkConfig &&
      typeof entryObj.linkConfig === 'object' &&
      !Array.isArray(entryObj.linkConfig) &&
      typeof (entryObj.linkConfig as Partial<ConsoleLinkConfig>).stageConsoleId === 'string'
        ? (entryObj.linkConfig as ConsoleLinkConfig)
        : inferConsoleLinkConfig(rigDoc);

    const now = new Date().toISOString();
    const entry: RigLibraryEntry = {
      id: typeof entryObj.id === 'string' && entryObj.id.trim() ? entryObj.id : generateProfileId('bundle'),
      name:
        typeof entryObj.name === 'string' && entryObj.name.trim()
          ? entryObj.name.trim()
          : rigDoc.name,
      venue: typeof entryObj.venue === 'string' ? entryObj.venue : rigDoc.venue,
      notes: typeof entryObj.notes === 'string' ? entryObj.notes : undefined,
      tags: Array.isArray(entryObj.tags)
        ? entryObj.tags.filter((t): t is string => typeof t === 'string')
        : [],
      createdAt: typeof entryObj.createdAt === 'string' ? entryObj.createdAt : now,
      updatedAt: typeof entryObj.updatedAt === 'string' ? entryObj.updatedAt : now,
      rig: cloneRigDocument(rigDoc),
      baselineRig: cloneRigDocument(baselineRigDoc),
      baselines,
      stagedPatches,
      linkConfig,
    };

    return {
      ok: true,
      kind: 'bundle',
      entry,
      baselineCount: Object.keys(baselines).length,
      stagedCount: stagedPatches.length,
    };
  }

  // Lightweight .rig.json fallback
  const rigCheck = validateRigDocument(parsed);
  if (!rigCheck.valid) {
    return {
      ok: false,
      error: rigCheck.issues.map((i) => `${i.path}: ${i.message}`).join('; '),
    };
  }
  return {
    ok: true,
    kind: 'rig',
    rig: parsed as RigDocument,
  };
}

export function bundleEntryFromRigJson(rig: RigDocument): RigLibraryEntry {
  return createLibraryEntryFromRig(rig, {
    name: rig.name,
    venue: rig.venue,
  });
}
