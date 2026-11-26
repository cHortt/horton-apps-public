import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMockRig } from '../schema/mockRig';
import { traceSignal, validateRigDocument } from '../schema/helpers';
import type { ConsoleBaselineMeta, ConsoleLinkConfig } from '../schema/patch';
import { applySnapMerge } from './merge';
import { parseWingSnap } from './wingSnapParser';
import {
  applyPatchOpsToRawSnap,
  buildDefaultSnapExportName,
  buildDualSourcePatches,
  buildReturnOutputPatches,
  encodeStereoSlot,
} from './snapPatcher';
import { inferConsoleLinkConfig, verifyRigPaths } from './snapVerifier';

const SHC_SNAP_PATH = resolve(__dirname, '../../fixtures/snapshots/SHC-Monitor.snap');
const SHC_SNAP_RAW = readFileSync(SHC_SNAP_PATH, 'utf-8');

/**
 * Creates a realistic synthetic FOH WING .snap based on SHC-Monitor.snap's exact snapshot.11 schema
 * so dual-console split, verification, and round-trip export can be tested deterministically.
 */
function makeSyntheticFohSnap(): string {
  const base = JSON.parse(SHC_SNAP_RAW) as Record<string, unknown>;
  base.creator_name = 'SHC-FOH';
  const ae = base.ae_data as {
    io: {
      in: Record<string, Record<string, Record<string, unknown>>>;
      out: Record<string, Record<string, Record<string, unknown>>>;
    };
    ch: Record<string, Record<string, unknown>>;
    bus: Record<string, Record<string, unknown>>;
  };

  // Clear Stage-specific A/LCL inputs and set FOH C inputs mirroring Stage splits 1..16
  for (const grp of ['A', 'LCL']) {
    for (const key of Object.keys(ae.io.in[grp] ?? {})) {
      ae.io.in[grp][key].name = '';
      ae.io.in[grp][key].mode = 'M';
      ae.io.in[grp][key].g = 0;
      ae.io.in[grp][key].vph = false;
    }
  }
  for (const key of Object.keys(ae.io.in.C ?? {})) {
    ae.io.in.C[key].name = '';
    ae.io.in.C[key].mode = 'M';
    ae.io.in.C[key].g = 0;
    ae.io.in.C[key].vph = false;
  }
  // Seed Kick on C.1, Stereo Piano on C.15-16 (intentionally mismatched M on FOH to test verifier!),
  // and a dead-end FOH ch.24 listening to C.24 (which is OFF in SHC-Monitor.snap!)
  ae.io.in.C['1'].name = 'Kick';
  ae.io.in.C['15'].name = 'Piano';
  ae.io.in.C['15'].mode = 'M'; // intentional mismatch with Stage ST
  ae.io.in.C['2'].name = 'WrongLabel'; // intentional drift vs Stage Snare/slot 2

  for (const key of Object.keys(ae.ch)) {
    const ch = ae.ch[key] as { name: string; clink: boolean; in: { conn: { grp: string; in: number } } };
    ch.name = '';
    ch.clink = true;
    ch.in.conn.grp = 'OFF';
    ch.in.conn.in = 1;
  }
  (ae.ch['1'] as { in: { conn: { grp: string; in: number } } }).in.conn = { grp: 'C', in: 1 };
  (ae.ch['15'] as { in: { conn: { grp: string; in: number } } }).in.conn = { grp: 'C', in: 15 };
  (ae.ch['24'] as { in: { conn: { grp: string; in: number } } }).in.conn = { grp: 'C', in: 24 };

  for (const grp of Object.keys(ae.io.out)) {
    for (const key of Object.keys(ae.io.out[grp] ?? {})) {
      ae.io.out[grp][key] = { grp: 'OFF', in: 1 };
    }
  }
  ae.io.out.C['48'] = { grp: 'MAIN', in: 3 }; // Main 2 L -> Sub return on C.48

  return JSON.stringify(base);
}

describe('Lossless .snap Patcher & Cross-Console Path Verifier', () => {
  it('encodes stereo output slots as exact inverse of decodeStereoSlot and formats export filenames', () => {
    expect(encodeStereoSlot(1, 'L')).toBe(1);
    expect(encodeStereoSlot(1, 'R')).toBe(2);
    expect(encodeStereoSlot(5, 'L')).toBe(9);
    expect(encodeStereoSlot(5, 'R')).toBe(10);

    const name = buildDefaultSnapExportName('SHC-Monitor.snap', new Date('2026-11-26T12:00:00Z'));
    expect(name).toBe('SHC-Monitor-20261126.snap');
    expect(buildDefaultSnapExportName('SHC-Monitor-20261101.snap', new Date('2026-11-26T12:00:00Z'))).toBe(
      'SHC-Monitor-20261126.snap',
    );
  });

  it('preserves untouched DSP (EQ, FX, DCA) and ce_data byte-for-byte when patching SHC-Monitor.snap', () => {
    const beforeObj = JSON.parse(SHC_SNAP_RAW) as Record<string, unknown>;
    const beforeAe = beforeObj.ae_data as Record<string, unknown>;
    const beforeCh1Eq = JSON.stringify((beforeAe.ch as Record<string, Record<string, unknown>>)['1'].eq);
    const beforeFx = JSON.stringify(beforeAe.fx);
    const beforeDca = JSON.stringify(beforeAe.dca);
    const beforeCe = JSON.stringify(beforeObj.ce_data);

    const patchedJson = applyPatchOpsToRawSnap(SHC_SNAP_RAW, [
      {
        type: 'set-input',
        group: 'A',
        slot: 28,
        name: 'Acoustic Gtr 2',
        mode: 'M',
        gainDb: 19,
        phantom48v: true,
        colorIndex: 5,
        tags: '#STRINGS',
      },
      {
        type: 'set-channel-strip',
        kind: 'ch',
        index: 28,
        name: '',
        clink: true,
        sourceGroup: 'A',
        sourceSlot: 28,
        busSendToggles: { 1: true, 5: true },
        mainSendToggles: { 1: true },
      },
      {
        type: 'set-output',
        group: 'C',
        slot: 28,
        sourceGroup: 'A',
        sourceSlot: 28,
      },
      {
        type: 'set-bus',
        kind: 'bus',
        index: 12,
        name: 'Choir Vox',
        mono: true,
        colorIndex: 12,
      },
      {
        type: 'set-monitor-source',
        monitorIndex: 1,
        sourceRef: 'BUS.5',
      },
    ]);

    const afterObj = JSON.parse(patchedJson) as Record<string, unknown>;
    const afterAe = afterObj.ae_data as Record<string, unknown>;

    // Byte-for-byte preservation of untouched DSP & surface config
    expect(JSON.stringify((afterAe.ch as Record<string, Record<string, unknown>>)['1'].eq)).toBe(beforeCh1Eq);
    expect(JSON.stringify(afterAe.fx)).toBe(beforeFx);
    expect(JSON.stringify(afterAe.dca)).toBe(beforeDca);
    expect(JSON.stringify(afterObj.ce_data)).toBe(beforeCe);

    // Round-trip verification through parseWingSnap
    const parsed = parseWingSnap(patchedJson, {
      fileName: 'SHC-Monitor-edited.snap',
      consoleNodeId: 'stage-wing',
    });
    const inA28 = parsed.inputsByGroup.A?.find((c) => c.slot === 28);
    expect(inA28?.rawName).toBe('Acoustic Gtr 2');
    expect(inA28?.gainDb).toBe(19);
    expect(inA28?.phantom48v).toBe(true);
    expect(inA28?.colorIndex).toBe(5);
    expect(inA28?.tags).toBe('#STRINGS');
    expect(inA28?.consoleChannel).toBe('CH 28');

    const ch28 = parsed.consoleNode.channelStrips?.find((s) => s.kind === 'ch' && s.index === 28);
    expect(ch28?.resolvedName).toBe('Acoustic Gtr 2');
    expect(ch28?.busSends.some((s) => s.busIndex === 5)).toBe(true);
    expect(ch28?.mainSends).toContain(1);

    const outC28 = parsed.outputsByGroup.C?.find((c) => c.slot === 28);
    expect(outC28?.passthroughFrom).toMatchObject({ group: 'A', slot: 28 });

    const bus12 = parsed.consoleNode.mixBuses.find((b) => b.kind === 'bus' && b.index === 12);
    expect(bus12?.rawName).toBe('Choir Vox');
    expect(bus12?.colorIndex).toBe(12);

    const mon1 = parsed.consoleNode.mixBuses.find((b) => b.kind === 'mon' && b.index === 1);
    expect(mon1?.monitorSource).toMatchObject({ kind: 'bus', index: 5, rawRef: 'BUS.5' });
  });

  it('configures a stereo source across both consoles respecting Headamp Authority and verifies live trace', () => {
    const fohRaw = makeSyntheticFohSnap();
    const baseRig = createMockRig();

    const patches = buildDualSourcePatches({
      stageConsoleId: 'stage-wing',
      fohConsoleId: 'foh-wing',
      headampOwnerConsoleId: 'stage-wing',
      stageSplitPort: 'C',
      fohReceivePort: 'C',
      hasStageBaseline: true,
      hasFohBaseline: true,
      sourceName: 'Tracks Stereo',
      inputGroup: 'A',
      inputSlot: 33,
      mode: 'ST',
      gainDb: 12,
      phantom48v: false,
      colorIndex: 14,
      stageStripKind: 'ch',
      stageStripIndex: 33,
      stageStripClink: true,
      stageBusSendIds: [1, 2],
      stageMainSendIds: [1],
      splitToFoh: true,
      splitSlot: 33,
      fohStripKind: 'ch',
      fohStripIndex: 33,
      fohStripClink: true,
      fohBusSendIds: [],
      fohMainSendIds: [1],
    });

    const stageOps = patches.filter((p) => p.consoleNodeId === 'stage-wing').map((p) => p.op);
    const fohOps = patches.filter((p) => p.consoleNodeId === 'foh-wing').map((p) => p.op);

    // FOH must NOT receive preamp gain or +48V because Stage owns headamps
    const fohInputOp = fohOps.find((o) => o.type === 'set-input');
    expect(fohInputOp?.type === 'set-input' && fohInputOp.gainDb).toBeUndefined();
    expect(fohInputOp?.type === 'set-input' && fohInputOp.phantom48v).toBeUndefined();

    const patchedStage = applyPatchOpsToRawSnap(SHC_SNAP_RAW, stageOps);
    const patchedFoh = applyPatchOpsToRawSnap(fohRaw, fohOps);

    let rig = applySnapMerge(
      baseRig,
      parseWingSnap(patchedStage, { fileName: 'SHC-Monitor.snap', consoleNodeId: 'stage-wing' }),
      'stage-wing',
    ).rig;
    rig = applySnapMerge(
      rig,
      parseWingSnap(patchedFoh, { fileName: 'SHC-FOH.snap', consoleNodeId: 'foh-wing' }),
      'foh-wing',
    ).rig;

    expect(validateRigDocument(rig).valid).toBe(true);

    // Stereo pair slots 33 & 34 must both be populated on Stage A, Stage out.C, and FOH in.C
    const stageNode = rig.nodes.find((n) => n.id === 'stage-wing')!;
    const stageA = stageNode.portGroups.find((pg) => pg.code === 'A' && pg.direction === 'input')!;
    expect(stageA.channels.find((c) => c.slot === 33)?.mode).toBe('ST');
    expect(stageA.channels.find((c) => c.slot === 34)?.mode).toBe('ST');
    expect(stageA.channels.find((c) => c.slot === 34)?.rawName).toBe('Tracks Stereo');

    // End-to-end Click-to-Trace follows Stage Box -> Stage WING -> AES50-C -> FOH WING
    const trace = traceSignal(rig, {
      type: 'channel',
      nodeId: 'stage-wing',
      portDirection: 'in',
      group: 'A',
      slot: 33,
    });
    expect(trace.activeNodeIds).toContain('stage-wing');
    expect(trace.activeNodeIds).toContain('foh-wing');
    expect(trace.activeTrunkIds).toContain('trunk-aes50-c');
  });

  it('builds cross-console return pass-throughs (FOH Main/Mtx -> Stage DL32 output)', () => {
    const fohRaw = makeSyntheticFohSnap();
    const entries = buildReturnOutputPatches({
      originConsoleId: 'foh-wing',
      hasOriginBaseline: true,
      busKind: 'mtx',
      busIndex: 3,
      busName: 'Lobby Fill',
      originOutGroup: 'C',
      originOutSlot: 47,
      stereoOutput: false,
      relayConsoleId: 'stage-wing',
      hasRelayBaseline: true,
      relayReceiveGroup: 'C',
      relayOutGroup: 'A',
      relayOutSlot: 14,
      relayInputLabel: 'Lobby Fill',
    });

    const fohPatched = applyPatchOpsToRawSnap(
      fohRaw,
      entries.filter((e) => e.consoleNodeId === 'foh-wing').map((e) => e.op),
    );
    const stagePatched = applyPatchOpsToRawSnap(
      SHC_SNAP_RAW,
      entries.filter((e) => e.consoleNodeId === 'stage-wing').map((e) => e.op),
    );

    const parsedFoh = parseWingSnap(fohPatched, { consoleNodeId: 'foh-wing' });
    const parsedStage = parseWingSnap(stagePatched, { consoleNodeId: 'stage-wing' });

    const fohOut47 = parsedFoh.outputsByGroup.C?.find((c) => c.slot === 47);
    expect(fohOut47?.sourceRef).toMatchObject({ group: 'MTX', slot: 3 });

    const stageOutA14 = parsedStage.outputsByGroup.A?.find((c) => c.slot === 14);
    expect(stageOutA14?.passthroughFrom).toMatchObject({ group: 'C', slot: 47 });
  });

  it('detects dead-end splits, stereo mismatches, and label drift — and resolves them via suggestedFixes', () => {
    const fohRaw = makeSyntheticFohSnap();
    let rig = createMockRig();
    rig = applySnapMerge(
      rig,
      parseWingSnap(SHC_SNAP_RAW, { fileName: 'SHC-Monitor.snap', consoleNodeId: 'stage-wing' }),
      'stage-wing',
    ).rig;
    rig = applySnapMerge(
      rig,
      parseWingSnap(fohRaw, { fileName: 'SHC-FOH.snap', consoleNodeId: 'foh-wing' }),
      'foh-wing',
    ).rig;

    const link: ConsoleLinkConfig = inferConsoleLinkConfig(rig);
    expect(link.stageConsoleId).toBe('stage-wing');
    expect(link.fohConsoleId).toBe('foh-wing');
    expect(link.stageSplitPort).toBe('C');
    expect(link.fohReceivePort).toBe('C');

    const baselines: Record<string, ConsoleBaselineMeta> = {
      'stage-wing': {
        consoleNodeId: 'stage-wing',
        fileName: 'SHC-Monitor.snap',
        creatorName: 'SHC-MONITOR',
        snapshotType: 'snapshot.11',
        creatorVersion: '3.3.2',
        byteLength: SHC_SNAP_RAW.length,
        importedAt: '2026-11-26T00:00:00.000Z',
      },
      'foh-wing': {
        consoleNodeId: 'foh-wing',
        fileName: 'SHC-FOH.snap',
        creatorName: 'SHC-FOH',
        snapshotType: 'snapshot.11',
        creatorVersion: '3.3.2',
        byteLength: fohRaw.length,
        importedAt: '2026-11-26T00:00:00.000Z',
      },
    };

    const issues = verifyRigPaths(rig, link, baselines, []);
    const deadEnd = issues.find((i) => i.code === 'DEAD_END_SPLIT');
    const stMismatch = issues.find((i) => i.code === 'STEREO_MISMATCH');
    const labelDrift = issues.find((i) => i.code === 'LABEL_DRIFT');

    expect(deadEnd).toBeDefined();
    expect(deadEnd?.suggestedFixes?.length).toBeGreaterThan(0);
    expect(stMismatch).toBeDefined();
    expect(stMismatch?.suggestedFixes?.length).toBeGreaterThan(0);
    expect(labelDrift).toBeDefined();
    expect(labelDrift?.suggestedFixes?.length).toBeGreaterThan(0);

    // Apply all suggested fixes and re-verify!
    const allFixes = issues.flatMap((i) => i.suggestedFixes ?? []);
    const fixedStage = applyPatchOpsToRawSnap(
      SHC_SNAP_RAW,
      allFixes.filter((f) => f.consoleNodeId === 'stage-wing').map((f) => f.op),
    );
    const fixedFoh = applyPatchOpsToRawSnap(
      fohRaw,
      allFixes.filter((f) => f.consoleNodeId === 'foh-wing').map((f) => f.op),
    );

    let fixedRig = applySnapMerge(
      rig,
      parseWingSnap(fixedStage, { fileName: 'SHC-Monitor.snap', consoleNodeId: 'stage-wing' }),
      'stage-wing',
    ).rig;
    fixedRig = applySnapMerge(
      fixedRig,
      parseWingSnap(fixedFoh, { fileName: 'SHC-FOH.snap', consoleNodeId: 'foh-wing' }),
      'foh-wing',
    ).rig;

    const afterIssues = verifyRigPaths(fixedRig, link, baselines, []);
    expect(afterIssues.filter((i) => i.code === 'DEAD_END_SPLIT')).toHaveLength(0);
    expect(afterIssues.filter((i) => i.code === 'STEREO_MISMATCH')).toHaveLength(0);
    expect(afterIssues.filter((i) => i.code === 'LABEL_DRIFT')).toHaveLength(0);
  });
});
