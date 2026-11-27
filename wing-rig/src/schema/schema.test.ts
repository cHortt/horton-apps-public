import { describe, expect, it } from 'vitest';
import { createMockRig } from './mockRig';
import {
  buildNodeTopologySummary,
  resolveBusName,
  resolveChannelName,
  resolveNodeName,
  searchRig,
  traceSignal,
  validateRigDocument,
} from './helpers';

describe('RigDocument schema & helpers', () => {
  it('validates the realistic sanctuary mock rig cleanly', () => {
    const rig = createMockRig();
    const res = validateRigDocument(rig);
    expect(res.valid).toBe(true);
    expect(res.issues).toEqual([]);
    expect(rig.nodes.length).toBe(7);
    expect(rig.trunks.length).toBe(6);
  });

  it('catches invalid rig documents with missing endpoints or bad version', () => {
    const res = validateRigDocument({
      schemaVersion: 2,
      id: '',
      name: 'Broken',
      nodes: [{ id: 'a', position: { x: 0, y: 0 }, portGroups: [] }],
      trunks: [
        {
          id: 't1',
          sourceNodeId: 'a',
          targetNodeId: 'missing-node',
          channels: [],
          returnChannels: [],
        },
      ],
      annotations: {},
    });
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.path === 'schemaVersion')).toBe(true);
    expect(res.issues.some((i) => i.path.includes('targetNodeId'))).toBe(true);
  });

  it('resolves Layer 2 friendly annotations over Layer 1 raw names', () => {
    const rig = createMockRig();
    const stageWing = rig.nodes.find((n) => n.id === 'stage-wing')!;
    expect(resolveNodeName(rig, stageWing)).toBe('Stage WING Rack (Monitor)');

    const subOut = stageWing.portGroups
      .find((pg) => pg.id === 'stage-wing:out:A')!
      .channels.find((c) => c.slot === 16)!;
    expect(resolveChannelName(rig, subOut)).toBe('Stage Sub Amp Feed');

    const drumsBus = stageWing.mixBuses.find((b) => b.kind === 'bus' && b.index === 5)!;
    expect(resolveBusName(rig, drumsBus)).toBe('Drums');
  });

  it('traces Kick end-to-end from Stage Box through Stage WING split to FOH WING', () => {
    const rig = createMockRig();
    const trace = traceSignal(rig, {
      type: 'channel',
      nodeId: 'stage-wing',
      group: 'A',
      slot: 1,
      channelId: 'stage-wing:in:A:1',
    });

    expect(trace.activeNodeIds).toContain('dl32-stage');
    expect(trace.activeNodeIds).toContain('stage-wing');
    expect(trace.activeNodeIds).toContain('foh-wing');
    expect(trace.activeTrunkIds).toContain('trunk-aes50-a');
    expect(trace.activeTrunkIds).toContain('trunk-aes50-c');
    expect(trace.steps.some((s) => s.kind === 'passthrough')).toBe(true);
  });

  it('traces FOH Sub return pass-through (C.48 -> out.A.16 -> DL32)', () => {
    const rig = createMockRig();
    const trace = traceSignal(rig, {
      type: 'channel',
      nodeId: 'stage-wing',
      group: 'C',
      slot: 48,
      channelId: 'stage-wing:in:C:48',
    });

    expect(trace.activeNodeIds).toContain('foh-wing');
    expect(trace.activeNodeIds).toContain('stage-wing');
    expect(trace.activeNodeIds).toContain('dl32-stage');
    expect(trace.activeTrunkIds).toContain('trunk-aes50-c');
    expect(trace.activeTrunkIds).toContain('trunk-aes50-a');
  });

  it('traces Piano Bus 7 through Monitor 1 indirection to Stage Box Out 5/6', () => {
    const rig = createMockRig();
    const trace = traceSignal(rig, {
      type: 'bus',
      nodeId: 'stage-wing',
      busKind: 'bus',
      busIndex: 7,
      busId: 'stage-wing:bus:7',
    });

    expect(trace.activeBusIds).toContain('stage-wing:bus:7');
    expect(trace.activeBusIds).toContain('stage-wing:mon:1');
    expect(trace.activeNodeIds).toContain('dl32-stage');
    expect(trace.activeTrunkIds).toContain('trunk-aes50-a');
  });

  it('supports global search across labels, +48V, cable tags, and mix buses', () => {
    const rig = createMockRig();
    const phantomHits = searchRig(rig, '+48V');
    expect(phantomHits.length).toBeGreaterThanOrEqual(2);
    expect(phantomHits.some((h) => h.label.includes('Acoustic 2'))).toBe(true);

    const cableHits = searchRig(rig, 'CAT6-FOH-TRUNK');
    expect(cableHits.some((h) => h.kind === 'trunk' && h.trunkId === 'trunk-aes50-c')).toBe(true);
  });

  it('builds role-adaptive topology summaries for hubs, sources, and destinations', () => {
    const rig = createMockRig();

    const stageWing = rig.nodes.find((n) => n.id === 'stage-wing')!;
    const hubSummary = buildNodeTopologySummary(rig, stageWing);
    expect(hubSummary.role).toBe('hub');
    expect(hubSummary.statusText).toBe('48kHz MASTER');
    expect(hubSummary.sheetRef).toBe('§2–3');
    expect(hubSummary.rows.map((r) => r.left)).toEqual(['AES50-A', 'LOCAL', 'AES50-C']);
    expect(hubSummary.rows[0].right).toContain('32 in');
    expect(hubSummary.rows[0].right).toContain('16 out');

    const dl32 = rig.nodes.find((n) => n.id === 'dl32-stage')!;
    const sourceSummary = buildNodeTopologySummary(rig, dl32);
    expect(sourceSummary.role).toBe('source');
    expect(sourceSummary.sheetRef).toBe('§1');
    expect(sourceSummary.rows.some((r) => r.left === 'CH 1–24')).toBe(true);
    expect(sourceSummary.rows.some((r) => r.left === 'CH 25–32' && r.right.includes('Talkbacks'))).toBe(true);

    const iemRack = rig.nodes.find((n) => n.id === 'iem-rack')!;
    const destSummary = buildNodeTopologySummary(rig, iemRack);
    expect(destSummary.role).toBe('dest');
    expect(destSummary.statusText).toBe('4× STEREO');
    expect(destSummary.sheetRef).toBe('§4');
    expect(destSummary.rows).toHaveLength(4);
    expect(destSummary.rows[0]).toMatchObject({ left: 'LCL 1–2', right: 'IEM 1 (ST)' });
  });
});
