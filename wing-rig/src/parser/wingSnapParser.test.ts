import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMockRig } from '../schema/mockRig';
import { traceSignal, validateRigDocument } from '../schema/helpers';
import { applySnapMerge, computeSnapMergeDiff } from './merge';
import { decodeStereoSlot, parseWingSnap } from './wingSnapParser';

const SHC_SNAP_PATH = resolve(__dirname, '../../fixtures/snapshots/SHC-Monitor.snap');
const SHC_SNAP_RAW = readFileSync(SHC_SNAP_PATH, 'utf-8');

describe('Behringer WING .snap parser (SHC-Monitor.snap fixture)', () => {
  it('decodes stereo L/R output slot indexing accurately', () => {
    expect(decodeStereoSlot(1)).toEqual({ index: 1, side: 'L' });
    expect(decodeStereoSlot(2)).toEqual({ index: 1, side: 'R' });
    expect(decodeStereoSlot(9)).toEqual({ index: 5, side: 'L' });
    expect(decodeStereoSlot(10)).toEqual({ index: 5, side: 'R' });
    expect(decodeStereoSlot(23)).toEqual({ index: 12, side: 'L' });
  });

  it('parses SHC-Monitor.snap metadata, preamps, clink overrides, and cross-trunk pass-throughs', () => {
    const parsed = parseWingSnap(SHC_SNAP_RAW, {
      fileName: 'SHC-Monitor.snap',
      consoleNodeId: 'stage-wing',
      importedAt: '2026-11-25T19:00:00.000Z',
    });

    expect(parsed.metadata.snapshotType).toBe('snapshot.11');
    expect(parsed.metadata.creator).toBe('WING Edit');
    expect(parsed.metadata.creatorVersion).toBe('3.3.2');
    expect(parsed.metadata.creatorName).toBe('SHC-MONITOR');
    expect(parsed.consoleNode.model).toBe('Behringer WING Rack');

    // Verify AES50-A inputs (32 active channels)
    const aesAIn = parsed.inputsByGroup.A ?? [];
    expect(aesAIn.length).toBe(32);
    expect(aesAIn.find((c) => c.slot === 1)?.rawName).toBe('Kick');
    const acoustic2 = aesAIn.find((c) => c.slot === 11);
    expect(acoustic2?.rawName).toBe('Acoustic 2');
    expect(acoustic2?.phantom48v).toBe(true);
    expect(acoustic2?.gainDb).toBe(17.5);

    // Verify clink inheritance vs explicit channel override:
    // ch.1 has name="" + clink=true -> inherits A.1 ("Kick")
    const ch1 = parsed.consoleNode.channelStrips?.find((s) => s.kind === 'ch' && s.index === 1);
    expect(ch1?.resolvedName).toBe('Kick');
    // ch.17 has name="PCORR" + clink=true -> overrides LCL.1 ("Andrew")
    const ch17 = parsed.consoleNode.channelStrips?.find((s) => s.kind === 'ch' && s.index === 17);
    expect(ch17?.resolvedName).toBe('PCORR');
    const lcl1 = parsed.inputsByGroup.LCL?.find((c) => c.slot === 1);
    expect(lcl1?.rawName).toBe('Andrew');
    expect(lcl1?.channelStripName).toBe('PCORR');

    // Verify direct cross-trunk pass-throughs
    const aesCOut = parsed.outputsByGroup.C ?? [];
    expect(aesCOut.length).toBe(45);
    const splitKick = aesCOut.find((c) => c.slot === 1);
    expect(splitKick?.passthroughFrom).toMatchObject({ group: 'A', slot: 1 });
    const splitLcl1 = aesCOut.find((c) => c.slot === 25);
    expect(splitLcl1?.passthroughFrom).toMatchObject({ group: 'LCL', slot: 1 });

    // Verify FOH Sub pass-through out.A.16 <- C.48
    const aesAOut = parsed.outputsByGroup.A ?? [];
    const subOut = aesAOut.find((c) => c.slot === 16);
    expect(subOut?.rawName).toBe('Sub');
    expect(subOut?.passthroughFrom).toMatchObject({ group: 'C', slot: 48 });

    // Verify MON.1 -> BUS.7 (Piano) indirection on out.A.5/6 and out.AUX.7/8
    const mon1 = parsed.consoleNode.mixBuses.find((b) => b.kind === 'mon' && b.index === 1);
    expect(mon1?.monitorSource).toMatchObject({ kind: 'bus', index: 7, rawRef: 'BUS.7' });
    const monOutA5 = aesAOut.find((c) => c.slot === 5);
    expect(monOutA5?.routeLabel).toContain('Piano');

    // Verify Choir bus 12 is mono and routed to out.A.15
    const bus12 = parsed.consoleNode.mixBuses.find((b) => b.kind === 'bus' && b.index === 12);
    expect(bus12?.rawName).toBe('Choir');
    expect(bus12?.mono).toBe(true);
    expect(bus12?.outputs.some((o) => o.group === 'A' && o.slot === 15)).toBe(true);
  });

  it('merges SHC-Monitor.snap deterministically, preserves Layer 2 annotations & manual gear, and is idempotent', () => {
    const baseRig = createMockRig();
    // Add custom Layer 2 annotations and a custom channel annotation that will become orphaned
    baseRig.annotations.nodes['stage-wing'] = {
      friendlyName: 'Main Stage Monitor Rack',
      notes: 'Custom engineer note that must survive re-import',
      position: { x: 455, y: 210 },
    };
    baseRig.annotations.channels['stage-wing:in:A:99'] = {
      friendlyName: 'Old Unused Floor Mic',
      cableTag: 'XLR-OLD-99',
      notes: 'Should move to orphaned when missing in snapshot',
    };

    const parsed = parseWingSnap(SHC_SNAP_RAW, {
      fileName: 'SHC-Monitor.snap',
      importedAt: '2026-11-25T19:00:00.000Z',
    });

    const previewDiff = computeSnapMergeDiff(baseRig, parsed);
    expect(previewDiff.targetConsoleNodeId).toBe('stage-wing');
    expect(previewDiff.isNewConsole).toBe(false);
    expect(previewDiff.newOrphans.some((o) => o.key === 'stage-wing:in:A:99')).toBe(true);

    const firstMerge = applySnapMerge(baseRig, parsed);
    expect(validateRigDocument(firstMerge.rig).valid).toBe(true);

    // Manual nodes (FOH WING, Media PC, PA Amp Rack, DL32, Wireless, IEM) all survive
    expect(firstMerge.rig.nodes.length).toBe(7);
    expect(firstMerge.rig.nodes.some((n) => n.id === 'pa-amp-rack')).toBe(true);

    // Layer 2 annotations preserved!
    expect(firstMerge.rig.annotations.nodes['stage-wing']?.friendlyName).toBe(
      'Main Stage Monitor Rack',
    );
    expect(firstMerge.rig.annotations.nodes['stage-wing']?.position).toEqual({ x: 455, y: 210 });
    expect(firstMerge.rig.annotations.trunks['trunk-aes50-c']?.cableTag).toBe('CAT6-FOH-TRUNK');

    // Removed annotated channel moved to orphaned!
    expect(
      firstMerge.rig.annotations.orphaned.some(
        (o) => o.key === 'stage-wing:in:A:99' && o.friendlyName === 'Old Unused Floor Mic',
      ),
    ).toBe(true);

    // End-to-end trace still works on the merged real-snapshot rig!
    const subTrace = traceSignal(firstMerge.rig, {
      type: 'channel',
      nodeId: 'stage-wing',
      group: 'C',
      slot: 48,
      channelId: 'stage-wing:in:C:48',
    });
    expect(subTrace.activeNodeIds).toContain('foh-wing');
    expect(subTrace.activeNodeIds).toContain('stage-wing');
    expect(subTrace.activeNodeIds).toContain('dl32-stage');

    // Idempotency: merging the exact same snapshot a second time produces zero changes & zero new orphans
    const secondMerge = applySnapMerge(firstMerge.rig, parsed);
    expect(secondMerge.diff.addedChannels).toEqual([]);
    expect(secondMerge.diff.updatedChannels).toEqual([]);
    expect(secondMerge.diff.removedChannels).toEqual([]);
    expect(secondMerge.diff.addedBuses).toEqual([]);
    expect(secondMerge.diff.updatedBuses).toEqual([]);
    expect(secondMerge.diff.removedBuses).toEqual([]);
    expect(secondMerge.diff.newOrphans).toEqual([]);
    expect(secondMerge.rig.annotations.orphaned.length).toBe(
      firstMerge.rig.annotations.orphaned.length,
    );
  });
});
