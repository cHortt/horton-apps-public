import { describe, expect, it } from 'vitest';
import { createMockRig } from '../../schema/mockRig';
import {
  buildNodePassthroughInputSet,
  collapseBusOutputs,
  countBusSenders,
  countRigPhantomChannels,
  filterInspectorRows,
  findIndirectMonitorsForBus,
  findStripSourceChannel,
  getConnectedTrunkChips,
  groupInspectorChannels,
  groupNodesByZone,
} from './inspectorHelpers';

describe('inspectorHelpers', () => {
  it('collapses adjacent stereo L/R channels cleanly and preserves mono slots', () => {
    const rig = createMockRig();
    const stageWing = rig.nodes.find((n) => n.id === 'stage-wing')!;
    const aesAIn = stageWing.portGroups.find((pg) => pg.id === 'stage-wing:in:A')!;
    const passthroughKeys = buildNodePassthroughInputSet(stageWing);

    const paired = groupInspectorChannels(rig, aesAIn.channels, {
      groupStereo: true,
      isConsoleInput: true,
      portCode: 'A',
      passthroughInputKeys: passthroughKeys,
    });

    // 32 raw slots contain 6 stereo pairs (Kit, Pad, Acoustic 1, Piano, Synth, Aux 2) -> 26 rows
    expect(paired.length).toBe(26);
    const kitRow = paired.find((r) => r.primary.slot === 3)!;
    expect(kitRow.isStereoPair).toBe(true);
    expect(kitRow.slotLabel).toBe('03–04');
    expect(kitRow.displayName).toBe('Kit');
    expect(kitRow.channelIds).toEqual(['stage-wing:in:A:3', 'stage-wing:in:A:4']);

    const ungrouped = groupInspectorChannels(rig, aesAIn.channels, {
      groupStereo: false,
      isConsoleInput: true,
      portCode: 'A',
      passthroughInputKeys: passthroughKeys,
    });
    expect(ungrouped.length).toBe(32);

    // Stereo R partner of patched L slot (Kit R on slot 4) should NOT be flagged as unpatched
    const kitR = ungrouped.find((r) => r.primary.slot === 4)!;
    expect(kitR.isUnpatchedInput).toBe(false);
  });

  it('merges stereo L/R return routes and detects pass-through slots', () => {
    const rig = createMockRig();
    const stageWing = rig.nodes.find((n) => n.id === 'stage-wing')!;
    const aesAOut = stageWing.portGroups.find((pg) => pg.id === 'stage-wing:out:A')!;

    const paired = groupInspectorChannels(rig, aesAOut.channels, {
      groupStereo: true,
    });

    // 16 outputs = 7 stereo pairs + Choir Wedge + Sub Feed = 9 rows
    expect(paired.length).toBe(9);
    expect(paired[0].slotLabel).toBe('01–02');
    expect(paired[0].displayName).toBe('Drums');
    expect(paired[0].routeSummary).toBe('Bus 5 L/R (Drums)');

    const subRow = paired.find((r) => r.primary.slot === 16)!;
    expect(subRow.isPassthrough).toBe(true);
    expect(subRow.hasAnnotation).toBe(true);
  });

  it('does not falsely mark cross-trunk pass-through inputs (like C.48 Sub) as unpatched', () => {
    const rig = createMockRig();
    const stageWing = rig.nodes.find((n) => n.id === 'stage-wing')!;
    const aesCIn = stageWing.portGroups.find((pg) => pg.id === 'stage-wing:in:C')!;
    const passthroughKeys = buildNodePassthroughInputSet(stageWing);

    const rows = groupInspectorChannels(rig, aesCIn.channels, {
      groupStereo: true,
      isConsoleInput: true,
      portCode: 'C',
      passthroughInputKeys: passthroughKeys,
    });

    const subReturn = rows.find((r) => r.primary.slot === 48)!;
    expect(subReturn.isPassthrough).toBe(true);
    expect(subReturn.isUnpatchedInput).toBe(false);
  });

  it('filters rows accurately by facets (+48V, notes, passthrough, traced) and search text', () => {
    const rig = createMockRig();
    const stageWing = rig.nodes.find((n) => n.id === 'stage-wing')!;
    const aesAIn = stageWing.portGroups.find((pg) => pg.id === 'stage-wing:in:A')!;
    const rows = groupInspectorChannels(rig, aesAIn.channels, {
      groupStereo: true,
      isConsoleInput: true,
      portCode: 'A',
      passthroughInputKeys: buildNodePassthroughInputSet(stageWing),
    });

    const phantomRows = filterInspectorRows(rig, rows, {
      query: '',
      facet: '48v',
      tracedChannelIds: new Set(),
    });
    expect(phantomRows.map((r) => r.displayName)).toEqual(['Acoustic 2']);

    const tracedOnly = filterInspectorRows(rig, rows, {
      query: '',
      facet: 'traced',
      tracedChannelIds: new Set(['stage-wing:in:A:4']),
    });
    // Partner channel id matches the paired 03-04 Kit row
    expect(tracedOnly.map((r) => r.slotLabel)).toEqual(['03–04']);

    const slotSearch = filterInspectorRows(rig, rows, {
      query: '11',
      facet: null,
      tracedChannelIds: new Set(),
    });
    expect(slotSearch.some((r) => r.displayName === 'Acoustic 2')).toBe(true);
  });

  it('collapses bus stereo outputs, counts senders, and finds indirect monitor taps', () => {
    const rig = createMockRig();
    const stageWing = rig.nodes.find((n) => n.id === 'stage-wing')!;

    const iem1 = stageWing.mixBuses.find((b) => b.id === 'stage-wing:bus:1')!;
    const collapsed = collapseBusOutputs(iem1.outputs);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].label).toBe('LCL.1–2 (ST)');
    expect(countBusSenders(stageWing, iem1)).toBeGreaterThan(15);

    const pianoBus = stageWing.mixBuses.find((b) => b.id === 'stage-wing:bus:7')!;
    const indirectMons = findIndirectMonitorsForBus(stageWing, pianoBus);
    expect(indirectMons).toHaveLength(1);
    expect(indirectMons[0].id).toBe('stage-wing:mon:1');
  });

  it('resolves strip source channels, connected trunks, zone grouping, and phantom totals', () => {
    const rig = createMockRig();
    const stageWing = rig.nodes.find((n) => n.id === 'stage-wing')!;
    const ch8 = stageWing.channelStrips!.find((s) => s.kind === 'ch' && s.index === 8)!;
    const src = findStripSourceChannel(stageWing, ch8);
    expect(src?.channel.phantom48v).toBe(true);
    expect(src?.portGroup.code).toBe('A');

    const chips = getConnectedTrunkChips(rig, stageWing);
    expect(chips.length).toBe(4);
    expect(chips.some((c) => c.portCode === 'A' && c.directionArrow === '↔')).toBe(true);

    const zones = groupNodesByZone(rig, rig.nodes);
    expect(zones.map((z) => z.zone)).toEqual(['Stage', 'Stage Rack', 'FOH Booth', 'Amp Vault']);

    expect(countRigPhantomChannels(rig)).toBe(3);
  });
});
