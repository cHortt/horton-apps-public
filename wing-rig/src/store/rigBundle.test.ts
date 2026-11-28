import { describe, expect, it } from 'vitest';
import { createMockRig } from '../schema/mockRig';
import {
  createLibraryEntryFromRig,
  duplicateLibraryEntry,
  summarizeLibraryEntry,
} from './rigLibraryDb';
import {
  WING_RIG_BUNDLE_FORMAT,
  buildBundleFileName,
  parseRigOrBundleJson,
  serializeRigBundle,
} from './rigBundle';

describe('Rig Library & Full Portable Rig Bundler', () => {
  it('round-trips a full .wingrig.json bundle including raw .snap baselines and staged patches', () => {
    const rig = createMockRig();
    const entry = createLibraryEntryFromRig(rig, {
      name: 'Sunday Standard',
      venue: 'Main Sanctuary',
      notes: 'Baseline sanctuary dual-WING setup',
      tags: ['Primary', 'Sunday'],
      baselines: {
        'stage-wing': {
          consoleNodeId: 'stage-wing',
          fileName: 'SHC-Monitor.snap',
          creatorName: 'SHC-MONITOR',
          snapshotType: 'snapshot.11',
          creatorVersion: '3.3.2',
          byteLength: 42,
          importedAt: '2026-11-27T00:00:00.000Z',
          rawJson: '{"type":"snapshot.11","ae_data":{"io":{}}}',
        },
      },
      stagedPatches: [
        {
          id: 'p-1',
          consoleNodeId: 'stage-wing',
          createdAt: '2026-11-27T01:00:00.000Z',
          summary: 'Set A.24 Guest Mic',
          jsonPaths: ['ae_data.io.in.A.24'],
          touchesPhantom48v: true,
          op: {
            type: 'set-input',
            group: 'A',
            slot: 24,
            name: 'Guest Mic',
            phantom48v: true,
          },
        },
      ],
    });

    const raw = serializeRigBundle(entry);
    const parsedObj = JSON.parse(raw) as { format: string };
    expect(parsedObj.format).toBe(WING_RIG_BUNDLE_FORMAT);
    expect(buildBundleFileName(entry.name)).toBe('sunday-standard.wingrig.json');

    const decoded = parseRigOrBundleJson(raw);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok || decoded.kind !== 'bundle') {
      throw new Error('Expected bundle payload');
    }

    expect(decoded.baselineCount).toBe(1);
    expect(decoded.stagedCount).toBe(1);
    expect(decoded.entry.name).toBe('Sunday Standard');
    expect(decoded.entry.notes).toBe('Baseline sanctuary dual-WING setup');
    expect(decoded.entry.baselines['stage-wing'].rawJson).toContain('snapshot.11');
    expect(decoded.entry.stagedPatches).toHaveLength(1);
  });

  it('continues accepting lightweight .rig.json payloads cleanly', () => {
    const rig = createMockRig();
    const decoded = parseRigOrBundleJson(JSON.stringify(rig));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('Expected valid rig');
    expect(decoded.kind).toBe('rig');
    if (decoded.kind === 'rig') {
      expect(decoded.rig.name).toBe(rig.name);
    }
  });

  it('duplicates a library entry with deep isolation from the original', () => {
    const rig = createMockRig();
    const original = createLibraryEntryFromRig(rig, {
      name: 'Sunday Standard',
      tags: ['Sunday'],
    });

    const copy = duplicateLibraryEntry(original, {
      name: 'Easter Orchestra',
      tags: ['Event'],
      resetBaselineToCurrent: true,
    });

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Easter Orchestra');

    // Mutating the copy must not mutate the original
    copy.rig.nodes[0].rawName = 'MUTATED';
    expect(original.rig.nodes[0].rawName).not.toBe('MUTATED');

    const summary = summarizeLibraryEntry(copy);
    expect(summary.name).toBe('Easter Orchestra');
    expect(summary.nodeCount).toBe(copy.rig.nodes.length);
  });

  it('rejects invalid JSON or malformed bundles gracefully', () => {
    const badJson = parseRigOrBundleJson('{not valid json');
    expect(badJson.ok).toBe(false);

    const badBundle = parseRigOrBundleJson(
      JSON.stringify({ format: WING_RIG_BUNDLE_FORMAT, bundleVersion: 99, entry: {} }),
    );
    expect(badBundle.ok).toBe(false);
  });
});
