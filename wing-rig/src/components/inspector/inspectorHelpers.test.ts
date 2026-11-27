import { describe, expect, it } from 'vitest';
import { createMockRig } from '../../schema/mockRig';
import {
  buildConsoleBusRows,
  buildConsoleStripRows,
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
  resolveTrunkDirectionCapacity,
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
    const kitRow = paired.find((r) => r.slot === 3)!;
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
    const kitR = ungrouped.find((r) => r.slot === 4)!;
    expect(kitR.isUnpatchedInput).toBe(false);
  });

  it('interleaves vacant slots in numeric order for Local Inputs (15/24) and respects outlier guard', () => {
    const rig = createMockRig();
    const stageWing = rig.nodes.find((n) => n.id === 'stage-wing')!;
    const localIn = stageWing.portGroups.find((pg) => pg.id === 'stage-wing:in:LCL')!;

    const withVacants = groupInspectorChannels(rig, localIn.channels, {
      groupStereo: true,
      includeVacant: true,
      capacity: localIn.capacity,
      keyPrefix: localIn.id,
      isConsoleInput: true,
      portCode: 'LCL',
    });

    // 15 occupied slots (with 2 stereo pairs -> 13 occupied rows) + 9 vacant slots (11..14, 20..24) = 22 rows
    const vacantSlots = withVacants.filter((r) => r.isVacant).map((r) => r.slot);
    expect(vacantSlots).toEqual([11, 12, 13, 14, 20, 21, 22, 23, 24]);
    expect(withVacants.length).toBe(22);
    // Verify numeric ordering (slot 11 appears right after 09-10 Choir and before 15-16 Room)
    const idxChoir = withVacants.findIndex((r) => r.slot === 9);
    const idx11 = withVacants.findIndex((r) => r.slot === 11);
    const idxRoom = withVacants.findIndex((r) => r.slot === 15);
    expect(idx11).toBe(idxChoir + 1);
    expect(idxRoom).toBe(idx11 + 4);

    // Outlier guard: pa-amp-rack:in:A has capacity 2 with single channel at slot 16 -> no bogus vacant slots 1..15
    const paRack = rig.nodes.find((n) => n.id === 'pa-amp-rack')!;
    const subReturn = paRack.portGroups.find((pg) => pg.id === 'pa-amp-rack:in:A')!;
    const subRows = groupInspectorChannels(rig, subReturn.channels, {
      groupStereo: true,
      includeVacant: true,
      capacity: subReturn.capacity,
      keyPrefix: subReturn.id,
    });
    expect(subRows.map((r) => r.slot)).toEqual([16]);
  });

  it('resolves usable trunk direction capacities for AES50 stagebox and console-to-console snakes', () => {
    const rig = createMockRig();
    const aesA = rig.trunks.find((t) => t.id === 'trunk-aes50-a')!;
    // DL32 (32x16) <-> Stage WING AES50-A (48x48) -> 32 forward, 16 return
    expect(resolveTrunkDirectionCapacity(rig, aesA, 'forward')).toBe(32);
    expect(resolveTrunkDirectionCapacity(rig, aesA, 'return')).toBe(16);

    const aesC = rig.trunks.find((t) => t.id === 'trunk-aes50-c')!;
    // Stage WING AES50-C (48) <-> FOH WING AES50-C (48) -> 48 forward, 48 return
    expect(resolveTrunkDirectionCapacity(rig, aesC, 'forward')).toBe(48);
    expect(resolveTrunkDirectionCapacity(rig, aesC, 'return')).toBe(48);

    const wireless = rig.trunks.find((t) => t.id === 'trunk-wireless-lcl')!;
    expect(resolveTrunkDirectionCapacity(rig, wireless, 'forward')).toBe(24);
  });

  it('builds full console strip (CH 1-40, AUX 1-8) and mix bus (BUS/MTX/MAIN/MON) lists with vacants', () => {
    const rig = createMockRig();
    const stageWing = rig.nodes.find((n) => n.id === 'stage-wing')!;

    const allStrips = buildConsoleStripRows(stageWing, { includeVacant: true });
    expect(allStrips.filter((s) => s.kind === 'ch')).toHaveLength(40);
    expect(allStrips.filter((s) => s.kind === 'aux')).toHaveLength(8);
    expect(allStrips.find((s) => s.kind === 'ch' && s.index === 22)?.isVacant).toBe(true);
    expect(allStrips.find((s) => s.kind === 'aux' && s.index === 4)?.isVacant).toBe(true);
    expect(allStrips.find((s) => s.kind === 'ch' && s.index === 1)?.isVacant).toBe(false);

    const allBuses = buildConsoleBusRows(stageWing, { includeVacant: true });
    expect(allBuses.filter((b) => b.kind === 'bus')).toHaveLength(16);
    expect(allBuses.filter((b) => b.kind === 'mtx')).toHaveLength(8);
    expect(allBuses.filter((b) => b.kind === 'main')).toHaveLength(4);
    expect(allBuses.filter((b) => b.kind === 'mon')).toHaveLength(2);
    expect(allBuses.find((b) => b.kind === 'bus' && b.index === 13)?.isVacant).toBe(true);
    expect(allBuses.find((b) => b.kind === 'mtx' && b.index === 1)?.isVacant).toBe(true);
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

    const subRow = paired.find((r) => r.slot === 16)!;
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

    const subReturn = rows.find((r) => r.slot === 48)!;
    expect(subReturn.isPassthrough).toBe(true);
    expect(subReturn.isUnpatchedInput).toBe(false);
  });

  it('filters rows accurately by facets (+48V, vacant, notes, traced) and search text', () => {
    const rig = createMockRig();
    const stageWing = rig.nodes.find((n) => n.id === 'stage-wing')!;
    const localIn = stageWing.portGroups.find((pg) => pg.id === 'stage-wing:in:LCL')!;
    const rows = groupInspectorChannels(rig, localIn.channels, {
      groupStereo: true,
      includeVacant: true,
      capacity: localIn.capacity,
      keyPrefix: localIn.id,
      isConsoleInput: true,
      portCode: 'LCL',
      passthroughInputKeys: buildNodePassthroughInputSet(stageWing),
    });

    const vacantOnly = filterInspectorRows(rig, rows, {
      query: '',
      facet: 'vacant',
      tracedChannelIds: new Set(),
    });
    expect(vacantOnly.map((r) => r.slot)).toEqual([11, 12, 13, 14, 20, 21, 22, 23, 24]);

    const phantomRows = filterInspectorRows(rig, rows, {
      query: '',
      facet: '48v',
      tracedChannelIds: new Set(),
    });
    expect(phantomRows.map((r) => r.displayName)).toEqual(['Choir']);

    const slotSearch = filterInspectorRows(rig, rows, {
      query: '13',
      facet: null,
      tracedChannelIds: new Set(),
    });
    expect(slotSearch.map((r) => r.slot)).toEqual([13]);
    expect(slotSearch[0].isVacant).toBe(true);
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
