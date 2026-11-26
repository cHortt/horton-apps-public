import type {
  ChannelPatch,
  ConsoleChannelStrip,
  MixBusSummary,
  RigDocument,
} from './rig';

function makeStageInput(
  slot: number,
  rawName: string,
  opts: {
    mode?: 'M' | 'ST';
    stereoSide?: 'L' | 'R';
    gainDb?: number;
    phantom48v?: boolean;
    consoleChannel?: string;
  } = {},
): ChannelPatch {
  return {
    id: `stage-wing:in:A:${slot}`,
    slot,
    rawName,
    mode: opts.mode ?? 'M',
    stereoSide: opts.stereoSide,
    gainDb: opts.gainDb ?? 0,
    phantom48v: opts.phantom48v ?? false,
    consoleChannel: opts.consoleChannel,
  };
}

function makeLocalInput(
  slot: number,
  rawName: string,
  opts: {
    mode?: 'M' | 'ST';
    stereoSide?: 'L' | 'R';
    gainDb?: number;
    phantom48v?: boolean;
    consoleChannel?: string;
    channelStripName?: string;
  } = {},
): ChannelPatch {
  return {
    id: `stage-wing:in:LCL:${slot}`,
    slot,
    rawName,
    mode: opts.mode ?? 'M',
    stereoSide: opts.stereoSide,
    gainDb: opts.gainDb ?? 0,
    phantom48v: opts.phantom48v ?? false,
    consoleChannel: opts.consoleChannel,
    channelStripName: opts.channelStripName,
  };
}

export function createMockRig(): RigDocument {
  const stageInputs: ChannelPatch[] = [
    makeStageInput(1, 'Kick', { gainDb: 0, consoleChannel: 'CH 1' }),
    makeStageInput(2, 'Snare', { gainDb: 0, consoleChannel: 'CH 2' }),
    makeStageInput(3, 'Kit', { mode: 'ST', stereoSide: 'L', gainDb: 0, consoleChannel: 'CH 3' }),
    makeStageInput(4, 'Kit', { mode: 'ST', stereoSide: 'R', gainDb: 0 }),
    makeStageInput(5, 'Pad', { mode: 'ST', stereoSide: 'L', gainDb: 5, consoleChannel: 'CH 4' }),
    makeStageInput(6, 'Pad', { mode: 'ST', stereoSide: 'R', gainDb: 5 }),
    makeStageInput(7, 'Perc', { gainDb: 0, consoleChannel: 'CH 5' }),
    makeStageInput(8, 'Bass', { gainDb: 15, consoleChannel: 'CH 6' }),
    makeStageInput(9, 'Acoustic 1', { mode: 'ST', stereoSide: 'L', gainDb: 0, consoleChannel: 'CH 7' }),
    makeStageInput(10, 'Acoustic 1', { mode: 'ST', stereoSide: 'R', gainDb: 0 }),
    makeStageInput(11, 'Acoustic 2', { gainDb: 17.5, phantom48v: true, consoleChannel: 'CH 8' }),
    makeStageInput(12, 'Electric 1', { gainDb: 0, consoleChannel: 'CH 9' }),
    makeStageInput(13, 'Electric 2', { gainDb: 5 }),
    makeStageInput(14, 'Electric 2', { gainDb: 10, consoleChannel: 'CH 10' }),
    makeStageInput(15, 'Piano', { mode: 'ST', stereoSide: 'L', gainDb: 5, consoleChannel: 'CH 11' }),
    makeStageInput(16, 'Piano', { mode: 'ST', stereoSide: 'R', gainDb: 5 }),
    makeStageInput(17, 'Synth', { mode: 'ST', stereoSide: 'L', gainDb: 22.5, consoleChannel: 'CH 12' }),
    makeStageInput(18, 'Synth', { mode: 'ST', stereoSide: 'R', gainDb: 22.5 }),
    makeStageInput(19, 'Aux 1', { gainDb: 30, consoleChannel: 'CH 13' }),
    makeStageInput(20, 'Aux 1', { gainDb: 0 }),
    makeStageInput(21, 'Aux 2', { mode: 'ST', stereoSide: 'L', gainDb: 0, consoleChannel: 'CH 14' }),
    makeStageInput(22, 'Aux 2', { mode: 'ST', stereoSide: 'R', gainDb: 0 }),
    makeStageInput(23, 'Tracks', { gainDb: 0, consoleChannel: 'CH 15' }),
    makeStageInput(24, 'Click/Guide', { gainDb: 37.5, consoleChannel: 'CH 16' }),
    makeStageInput(25, 'WL TB', { gainDb: 30, consoleChannel: 'CH 33' }),
    makeStageInput(26, 'Vx TB', { gainDb: 0, consoleChannel: 'CH 34' }),
    makeStageInput(27, 'Keys TB', { gainDb: 37.5, consoleChannel: 'CH 35' }),
    makeStageInput(28, 'Bass TB', { gainDb: 0, consoleChannel: 'CH 36' }),
    makeStageInput(29, 'Drums TB', { gainDb: 0, consoleChannel: 'CH 37' }),
    makeStageInput(30, 'TB 6', { gainDb: 0, consoleChannel: 'CH 38' }),
    makeStageInput(31, 'TB 7', { gainDb: 0, consoleChannel: 'CH 39' }),
    makeStageInput(32, 'TB 8', { gainDb: 0, consoleChannel: 'CH 40' }),
  ];

  const localInputs: ChannelPatch[] = [
    makeLocalInput(1, 'Vox 1', { gainDb: 35, consoleChannel: 'CH 17' }),
    makeLocalInput(2, 'Vox 2', { gainDb: 27.5, consoleChannel: 'CH 18' }),
    makeLocalInput(3, 'Vox 3', { gainDb: 27.5, consoleChannel: 'CH 19' }),
    makeLocalInput(4, 'Vox 4', { gainDb: 32.5, consoleChannel: 'CH 20' }),
    makeLocalInput(5, 'Vox 5', { gainDb: 20, consoleChannel: 'CH 21' }),
    makeLocalInput(6, 'Vox 6', { gainDb: 30, consoleChannel: 'CH 22' }),
    makeLocalInput(7, 'Vox 7', { gainDb: 0, consoleChannel: 'CH 23' }),
    makeLocalInput(8, 'Vox 8', { gainDb: 0, consoleChannel: 'CH 24' }),
    makeLocalInput(9, 'Choir', { mode: 'ST', stereoSide: 'L', gainDb: 20, phantom48v: true, consoleChannel: 'CH 25' }),
    makeLocalInput(10, 'Choir', { mode: 'ST', stereoSide: 'R', gainDb: 20, phantom48v: true }),
    makeLocalInput(15, 'Room', { mode: 'ST', stereoSide: 'L', gainDb: 0, consoleChannel: 'CH 26' }),
    makeLocalInput(16, 'Room', { mode: 'ST', stereoSide: 'R', gainDb: 0 }),
    makeLocalInput(17, 'Pastor', { gainDb: 35, consoleChannel: 'CH 30' }),
    makeLocalInput(18, 'Host', { gainDb: 30, consoleChannel: 'CH 31' }),
    makeLocalInput(19, 'Handheld', { gainDb: 22.5, consoleChannel: 'CH 32' }),
  ];

  const aes50AReturns: ChannelPatch[] = [
    { id: 'stage-wing:out:A:1', slot: 1, rawName: 'Drums L', mode: 'ST', stereoSide: 'L', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 5 }, routeLabel: 'Bus 5 L (Drums)' },
    { id: 'stage-wing:out:A:2', slot: 2, rawName: 'Drums R', mode: 'ST', stereoSide: 'R', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 5 }, routeLabel: 'Bus 5 R (Drums)' },
    { id: 'stage-wing:out:A:3', slot: 3, rawName: 'Bass L', mode: 'ST', stereoSide: 'L', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 6 }, routeLabel: 'Bus 6 L (Bass)' },
    { id: 'stage-wing:out:A:4', slot: 4, rawName: 'Bass R', mode: 'ST', stereoSide: 'R', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 6 }, routeLabel: 'Bus 6 R (Bass)' },
    { id: 'stage-wing:out:A:5', slot: 5, rawName: 'Piano L (Mon 1)', mode: 'ST', stereoSide: 'L', sourceRef: { nodeId: 'stage-wing', group: 'MON', slot: 1 }, routeLabel: 'MON 1 L ← Bus 7 (Piano)' },
    { id: 'stage-wing:out:A:6', slot: 6, rawName: 'Piano R (Mon 1)', mode: 'ST', stereoSide: 'R', sourceRef: { nodeId: 'stage-wing', group: 'MON', slot: 1 }, routeLabel: 'MON 1 R ← Bus 7 (Piano)' },
    { id: 'stage-wing:out:A:7', slot: 7, rawName: 'Guitar L', mode: 'ST', stereoSide: 'L', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 9 }, routeLabel: 'Bus 9 L (Guitar)' },
    { id: 'stage-wing:out:A:8', slot: 8, rawName: 'Guitar R', mode: 'ST', stereoSide: 'R', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 9 }, routeLabel: 'Bus 9 R (Guitar)' },
    { id: 'stage-wing:out:A:9', slot: 9, rawName: 'Synth L', mode: 'ST', stereoSide: 'L', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 8 }, routeLabel: 'Bus 8 L (Synth)' },
    { id: 'stage-wing:out:A:10', slot: 10, rawName: 'Synth R', mode: 'ST', stereoSide: 'R', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 8 }, routeLabel: 'Bus 8 R (Synth)' },
    { id: 'stage-wing:out:A:11', slot: 11, rawName: 'Aux 1 L', mode: 'ST', stereoSide: 'L', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 10 }, routeLabel: 'Bus 10 L (Aux 1)' },
    { id: 'stage-wing:out:A:12', slot: 12, rawName: 'Aux 1 R', mode: 'ST', stereoSide: 'R', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 10 }, routeLabel: 'Bus 10 R (Aux 1)' },
    { id: 'stage-wing:out:A:13', slot: 13, rawName: 'Aux 2 L', mode: 'ST', stereoSide: 'L', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 11 }, routeLabel: 'Bus 11 L (Aux 2)' },
    { id: 'stage-wing:out:A:14', slot: 14, rawName: 'Aux 2 R', mode: 'ST', stereoSide: 'R', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 11 }, routeLabel: 'Bus 11 R (Aux 2)' },
    { id: 'stage-wing:out:A:15', slot: 15, rawName: 'Choir Wedge', mode: 'M', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 12 }, routeLabel: 'Bus 12 (Choir Mono)' },
    {
      id: 'stage-wing:out:A:16',
      slot: 16,
      rawName: 'FOH Sub Feed',
      mode: 'M',
      passthroughFrom: { nodeId: 'stage-wing', group: 'C', slot: 48, direction: 'in', label: 'Sub' },
      routeLabel: 'Pass-through ← AES50-C In 48 (Sub)',
    },
  ];

  const localOutputs: ChannelPatch[] = [
    { id: 'stage-wing:out:LCL:1', slot: 1, rawName: 'IEM 1 L', mode: 'ST', stereoSide: 'L', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 1 }, routeLabel: 'Bus 1 L (IEM 1)' },
    { id: 'stage-wing:out:LCL:2', slot: 2, rawName: 'IEM 1 R', mode: 'ST', stereoSide: 'R', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 1 }, routeLabel: 'Bus 1 R (IEM 1)' },
    { id: 'stage-wing:out:LCL:3', slot: 3, rawName: 'IEM 2 L', mode: 'ST', stereoSide: 'L', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 2 }, routeLabel: 'Bus 2 L (IEM 2)' },
    { id: 'stage-wing:out:LCL:4', slot: 4, rawName: 'IEM 2 R', mode: 'ST', stereoSide: 'R', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 2 }, routeLabel: 'Bus 2 R (IEM 2)' },
    { id: 'stage-wing:out:LCL:5', slot: 5, rawName: 'IEM 3 L', mode: 'ST', stereoSide: 'L', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 3 }, routeLabel: 'Bus 3 L (IEM 3)' },
    { id: 'stage-wing:out:LCL:6', slot: 6, rawName: 'IEM 3 R', mode: 'ST', stereoSide: 'R', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 3 }, routeLabel: 'Bus 3 R (IEM 3)' },
    { id: 'stage-wing:out:LCL:7', slot: 7, rawName: 'IEM 4 L', mode: 'ST', stereoSide: 'L', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 4 }, routeLabel: 'Bus 4 L (IEM 4)' },
    { id: 'stage-wing:out:LCL:8', slot: 8, rawName: 'IEM 4 R', mode: 'ST', stereoSide: 'R', sourceRef: { nodeId: 'stage-wing', group: 'BUS', slot: 4 }, routeLabel: 'Bus 4 R (IEM 4)' },
  ];

  // Direct split outputs out.C.1..23 <- A.1..23 and out.C.25..38 <- LCL.1..14, out.C.41..48 <- LCL.17..24
  const aes50CForward: ChannelPatch[] = [];
  for (let i = 1; i <= 23; i++) {
    const src = stageInputs.find((c) => c.slot === i);
    aes50CForward.push({
      id: `stage-wing:out:C:${i}`,
      slot: i,
      rawName: src?.rawName ?? `Stage ${i}`,
      mode: src?.mode ?? 'M',
      stereoSide: src?.stereoSide,
      passthroughFrom: { nodeId: 'stage-wing', group: 'A', slot: i, direction: 'in', label: src?.rawName },
      routeLabel: `Split ← AES50-A.${i}`,
    });
  }
  for (let i = 1; i <= 14; i++) {
    const outSlot = 24 + i;
    const src = localInputs.find((c) => c.slot === i);
    aes50CForward.push({
      id: `stage-wing:out:C:${outSlot}`,
      slot: outSlot,
      rawName: src?.rawName ?? `Local ${i}`,
      mode: src?.mode ?? 'M',
      stereoSide: src?.stereoSide,
      passthroughFrom: { nodeId: 'stage-wing', group: 'LCL', slot: i, direction: 'in', label: src?.rawName },
      routeLabel: `Split ← LCL.${i}`,
    });
  }
  for (let i = 17; i <= 24; i++) {
    const outSlot = 24 + i;
    const src = localInputs.find((c) => c.slot === i);
    aes50CForward.push({
      id: `stage-wing:out:C:${outSlot}`,
      slot: outSlot,
      rawName: src?.rawName ?? `Local ${i}`,
      mode: src?.mode ?? 'M',
      stereoSide: src?.stereoSide,
      passthroughFrom: { nodeId: 'stage-wing', group: 'LCL', slot: i, direction: 'in', label: src?.rawName },
      routeLabel: `Split ← LCL.${i}`,
    });
  }

  const aes50CReturn: ChannelPatch[] = [
    { id: 'stage-wing:in:C:1', slot: 1, rawName: 'Music', mode: 'ST', stereoSide: 'L', consoleChannel: 'AUX 1', routeLabel: 'FOH Media Music L' },
    { id: 'stage-wing:in:C:2', slot: 2, rawName: 'Music', mode: 'ST', stereoSide: 'R', routeLabel: 'FOH Media Music R' },
    { id: 'stage-wing:in:C:3', slot: 3, rawName: 'Video', mode: 'ST', stereoSide: 'L', consoleChannel: 'AUX 2', routeLabel: 'FOH Media Video L' },
    { id: 'stage-wing:in:C:4', slot: 4, rawName: 'Video', mode: 'ST', stereoSide: 'R', routeLabel: 'FOH Media Video R' },
    { id: 'stage-wing:in:C:8', slot: 8, rawName: 'A/V TB', mode: 'M', consoleChannel: 'AUX 3', routeLabel: 'FOH Booth Talkback' },
    { id: 'stage-wing:in:C:48', slot: 48, rawName: 'Sub', mode: 'M', routeLabel: 'FOH Matrix 3 (Sub Feed)' },
  ];

  const allBuses1to12 = Array.from({ length: 12 }, (_, i) => ({
    busKind: 'bus' as const,
    busIndex: i + 1,
  }));

  const stageStrips: ConsoleChannelStrip[] = [
    { id: 'stage-wing:strip:ch:1', kind: 'ch', index: 1, rawName: '', resolvedName: 'Kick', clink: true, sourceGroup: 'A', sourceSlot: 1, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:2', kind: 'ch', index: 2, rawName: '', resolvedName: 'Snare', clink: true, sourceGroup: 'A', sourceSlot: 2, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:3', kind: 'ch', index: 3, rawName: '', resolvedName: 'Kit', clink: true, sourceGroup: 'A', sourceSlot: 3, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:4', kind: 'ch', index: 4, rawName: '', resolvedName: 'Pad', clink: true, sourceGroup: 'A', sourceSlot: 5, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:5', kind: 'ch', index: 5, rawName: '', resolvedName: 'Perc', clink: true, sourceGroup: 'A', sourceSlot: 7, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:6', kind: 'ch', index: 6, rawName: '', resolvedName: 'Bass', clink: true, sourceGroup: 'A', sourceSlot: 8, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:7', kind: 'ch', index: 7, rawName: '', resolvedName: 'Acoustic 1', clink: true, sourceGroup: 'A', sourceSlot: 9, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:8', kind: 'ch', index: 8, rawName: '', resolvedName: 'Acoustic 2', clink: true, sourceGroup: 'A', sourceSlot: 11, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:9', kind: 'ch', index: 9, rawName: '', resolvedName: 'Electric 1', clink: true, sourceGroup: 'A', sourceSlot: 12, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:10', kind: 'ch', index: 10, rawName: '', resolvedName: 'Electric 2', clink: true, sourceGroup: 'A', sourceSlot: 14, busSends: allBuses1to12.slice(0, 11), mainSends: [1] },
    { id: 'stage-wing:strip:ch:11', kind: 'ch', index: 11, rawName: '', resolvedName: 'Piano', clink: true, sourceGroup: 'A', sourceSlot: 15, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:12', kind: 'ch', index: 12, rawName: '', resolvedName: 'Synth', clink: true, sourceGroup: 'A', sourceSlot: 17, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:13', kind: 'ch', index: 13, rawName: '', resolvedName: 'Aux 1', clink: true, sourceGroup: 'A', sourceSlot: 19, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:14', kind: 'ch', index: 14, rawName: '', resolvedName: 'Aux 2', clink: true, sourceGroup: 'A', sourceSlot: 21, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:15', kind: 'ch', index: 15, rawName: '', resolvedName: 'Tracks', clink: true, sourceGroup: 'A', sourceSlot: 23, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:16', kind: 'ch', index: 16, rawName: '', resolvedName: 'Click/Guide', clink: true, sourceGroup: 'A', sourceSlot: 24, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:17', kind: 'ch', index: 17, rawName: '', resolvedName: 'Vox 1', clink: true, sourceGroup: 'LCL', sourceSlot: 1, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:18', kind: 'ch', index: 18, rawName: '', resolvedName: 'Vox 2', clink: true, sourceGroup: 'LCL', sourceSlot: 2, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:19', kind: 'ch', index: 19, rawName: '', resolvedName: 'Vox 3', clink: true, sourceGroup: 'LCL', sourceSlot: 3, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:20', kind: 'ch', index: 20, rawName: '', resolvedName: 'Vox 4', clink: true, sourceGroup: 'LCL', sourceSlot: 4, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:21', kind: 'ch', index: 21, rawName: '', resolvedName: 'Vox 5', clink: true, sourceGroup: 'LCL', sourceSlot: 5, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:25', kind: 'ch', index: 25, rawName: '', resolvedName: 'Choir', clink: true, sourceGroup: 'LCL', sourceSlot: 9, busSends: allBuses1to12, mainSends: [1] },
    { id: 'stage-wing:strip:ch:30', kind: 'ch', index: 30, rawName: '', resolvedName: 'Pastor', clink: true, sourceGroup: 'LCL', sourceSlot: 17, busSends: allBuses1to12.slice(0, 11), mainSends: [1] },
    { id: 'stage-wing:strip:aux:1', kind: 'aux', index: 1, rawName: '', resolvedName: 'Music', clink: true, sourceGroup: 'C', sourceSlot: 1, busSends: [], mainSends: [1] },
    { id: 'stage-wing:strip:aux:2', kind: 'aux', index: 2, rawName: '', resolvedName: 'Video', clink: true, sourceGroup: 'C', sourceSlot: 3, busSends: [], mainSends: [1] },
    { id: 'stage-wing:strip:aux:3', kind: 'aux', index: 3, rawName: '', resolvedName: 'A/V TB', clink: true, sourceGroup: 'C', sourceSlot: 8, busSends: [], mainSends: [1] },
  ];

  const stageBuses: MixBusSummary[] = [
    { id: 'stage-wing:bus:1', kind: 'bus', index: 1, rawName: 'IEM 1 (WL)', mono: false, muted: false, outputs: [{ group: 'LCL', slot: 1, stereoSide: 'L', trunkId: 'trunk-lcl-iem' }, { group: 'LCL', slot: 2, stereoSide: 'R', trunkId: 'trunk-lcl-iem' }] },
    { id: 'stage-wing:bus:2', kind: 'bus', index: 2, rawName: 'IEM 2 (Vox)', mono: false, muted: false, outputs: [{ group: 'LCL', slot: 3, stereoSide: 'L', trunkId: 'trunk-lcl-iem' }, { group: 'LCL', slot: 4, stereoSide: 'R', trunkId: 'trunk-lcl-iem' }] },
    { id: 'stage-wing:bus:3', kind: 'bus', index: 3, rawName: 'IEM 3 (Vox)', mono: false, muted: false, outputs: [{ group: 'LCL', slot: 5, stereoSide: 'L', trunkId: 'trunk-lcl-iem' }, { group: 'LCL', slot: 6, stereoSide: 'R', trunkId: 'trunk-lcl-iem' }] },
    { id: 'stage-wing:bus:4', kind: 'bus', index: 4, rawName: 'IEM 4 (Vox)', mono: false, muted: false, outputs: [{ group: 'LCL', slot: 7, stereoSide: 'L', trunkId: 'trunk-lcl-iem' }, { group: 'LCL', slot: 8, stereoSide: 'R', trunkId: 'trunk-lcl-iem' }] },
    { id: 'stage-wing:bus:5', kind: 'bus', index: 5, rawName: 'Drums', mono: false, muted: false, outputs: [{ group: 'A', slot: 1, stereoSide: 'L', trunkId: 'trunk-aes50-a' }, { group: 'A', slot: 2, stereoSide: 'R', trunkId: 'trunk-aes50-a' }] },
    { id: 'stage-wing:bus:6', kind: 'bus', index: 6, rawName: 'Bass', mono: false, muted: false, outputs: [{ group: 'A', slot: 3, stereoSide: 'L', trunkId: 'trunk-aes50-a' }, { group: 'A', slot: 4, stereoSide: 'R', trunkId: 'trunk-aes50-a' }] },
    { id: 'stage-wing:bus:7', kind: 'bus', index: 7, rawName: 'Piano', mono: false, muted: false, outputs: [] },
    { id: 'stage-wing:bus:8', kind: 'bus', index: 8, rawName: 'Synth', mono: false, muted: false, outputs: [{ group: 'A', slot: 9, stereoSide: 'L', trunkId: 'trunk-aes50-a' }, { group: 'A', slot: 10, stereoSide: 'R', trunkId: 'trunk-aes50-a' }] },
    { id: 'stage-wing:bus:9', kind: 'bus', index: 9, rawName: 'Guitar', mono: false, muted: false, outputs: [{ group: 'A', slot: 7, stereoSide: 'L', trunkId: 'trunk-aes50-a' }, { group: 'A', slot: 8, stereoSide: 'R', trunkId: 'trunk-aes50-a' }] },
    { id: 'stage-wing:bus:10', kind: 'bus', index: 10, rawName: 'Aux 1', mono: false, muted: false, outputs: [{ group: 'A', slot: 11, stereoSide: 'L', trunkId: 'trunk-aes50-a' }, { group: 'A', slot: 12, stereoSide: 'R', trunkId: 'trunk-aes50-a' }] },
    { id: 'stage-wing:bus:11', kind: 'bus', index: 11, rawName: 'Aux 2', mono: false, muted: false, outputs: [{ group: 'A', slot: 13, stereoSide: 'L', trunkId: 'trunk-aes50-a' }, { group: 'A', slot: 14, stereoSide: 'R', trunkId: 'trunk-aes50-a' }] },
    { id: 'stage-wing:bus:12', kind: 'bus', index: 12, rawName: 'Choir', mono: true, muted: false, outputs: [{ group: 'A', slot: 15, stereoSide: 'L', trunkId: 'trunk-aes50-a' }] },
    {
      id: 'stage-wing:mon:1',
      kind: 'mon',
      index: 1,
      rawName: 'Monitor 1',
      mono: false,
      muted: false,
      monitorSource: { kind: 'bus', index: 7, rawRef: 'BUS.7' },
      outputs: [
        { group: 'A', slot: 5, stereoSide: 'L', trunkId: 'trunk-aes50-a' },
        { group: 'A', slot: 6, stereoSide: 'R', trunkId: 'trunk-aes50-a' },
        { group: 'AUX', slot: 7, stereoSide: 'L' },
        { group: 'AUX', slot: 8, stereoSide: 'R' },
      ],
    },
    {
      id: 'stage-wing:main:1',
      kind: 'main',
      index: 1,
      rawName: 'Cue',
      mono: false,
      muted: false,
      outputs: [
        { group: 'CRD', slot: 1, stereoSide: 'L' },
        { group: 'CRD', slot: 2, stereoSide: 'R' },
      ],
    },
  ];

  const mediaOutputs: ChannelPatch[] = [
    { id: 'media-pc:out:USB:1', slot: 1, rawName: 'ProPresenter Music L', mode: 'ST', stereoSide: 'L' },
    { id: 'media-pc:out:USB:2', slot: 2, rawName: 'ProPresenter Music R', mode: 'ST', stereoSide: 'R' },
    { id: 'media-pc:out:USB:3', slot: 3, rawName: 'ProPresenter Video L', mode: 'ST', stereoSide: 'L' },
    { id: 'media-pc:out:USB:4', slot: 4, rawName: 'ProPresenter Video R', mode: 'ST', stereoSide: 'R' },
  ];

  const fohPaOutputs: ChannelPatch[] = [
    { id: 'foh-wing:out:LCL:1', slot: 1, rawName: 'Main L', mode: 'ST', stereoSide: 'L', sourceRef: { nodeId: 'foh-wing', group: 'MTX', slot: 1 }, routeLabel: 'Matrix 1 L (Main PA)' },
    { id: 'foh-wing:out:LCL:2', slot: 2, rawName: 'Main R', mode: 'ST', stereoSide: 'R', sourceRef: { nodeId: 'foh-wing', group: 'MTX', slot: 1 }, routeLabel: 'Matrix 1 R (Main PA)' },
    { id: 'foh-wing:out:LCL:3', slot: 3, rawName: 'Front Fill', mode: 'M', sourceRef: { nodeId: 'foh-wing', group: 'MTX', slot: 2 }, routeLabel: 'Matrix 2 (Front Fill)' },
    { id: 'foh-wing:out:LCL:4', slot: 4, rawName: 'Lobby / Cry Room', mode: 'M', sourceRef: { nodeId: 'foh-wing', group: 'MTX', slot: 4 }, routeLabel: 'Matrix 4 (Lobby)' },
  ];

  const fohBuses: MixBusSummary[] = [
    { id: 'foh-wing:main:1', kind: 'main', index: 1, rawName: 'Main LR', mono: false, muted: false, outputs: [] },
    { id: 'foh-wing:mtx:1', kind: 'mtx', index: 1, rawName: 'PA Mains', mono: false, muted: false, outputs: [{ group: 'LCL', slot: 1, stereoSide: 'L', trunkId: 'trunk-foh-pa' }, { group: 'LCL', slot: 2, stereoSide: 'R', trunkId: 'trunk-foh-pa' }] },
    { id: 'foh-wing:mtx:2', kind: 'mtx', index: 2, rawName: 'Front Fill', mono: true, muted: false, outputs: [{ group: 'LCL', slot: 3, stereoSide: 'L', trunkId: 'trunk-foh-pa' }] },
    { id: 'foh-wing:mtx:3', kind: 'mtx', index: 3, rawName: 'Sub Feed', mono: true, muted: false, outputs: [{ group: 'C', slot: 48, stereoSide: 'L', trunkId: 'trunk-aes50-c' }] },
    { id: 'foh-wing:mtx:4', kind: 'mtx', index: 4, rawName: 'Lobby', mono: true, muted: false, outputs: [{ group: 'LCL', slot: 4, stereoSide: 'L', trunkId: 'trunk-foh-pa' }] },
  ];

  const fohStrips: ConsoleChannelStrip[] = aes50CForward.slice(0, 16).map((ch, idx) => ({
    id: `foh-wing:strip:ch:${idx + 1}`,
    kind: 'ch',
    index: idx + 1,
    rawName: ch.rawName,
    resolvedName: ch.rawName,
    clink: true,
    sourceGroup: 'C',
    sourceSlot: ch.slot,
    busSends: [],
    mainSends: [1],
  }));

  return {
    schemaVersion: 1,
    id: 'sanctuary-dual-wing-demo',
    name: 'Sanctuary Dual-WING Rig',
    venue: 'Main Sanctuary',
    updatedAt: '2026-11-25T19:00:00.000Z',
    sourceSnapshots: [],
    nodes: [
      {
        id: 'dl32-stage',
        kind: 'stagebox',
        rawName: 'Midas DL32',
        model: 'Midas DL32 (32×16)',
        zone: 'Stage',
        position: { x: 40, y: 80 },
        sourceOrigin: 'manual',
        portGroups: [
          {
            id: 'dl32-stage:A:out',
            code: 'A',
            label: 'Stage Inputs (1–32)',
            direction: 'output',
            capacity: 32,
            channels: stageInputs.map((c) => ({ ...c, id: `dl32-stage:in:${c.slot}` })),
          },
          {
            id: 'dl32-stage:A:in',
            code: 'A',
            label: 'Stage Outputs (1–16)',
            direction: 'input',
            capacity: 16,
            channels: aes50AReturns.map((c) => ({ ...c, id: `dl32-stage:out:${c.slot}` })),
          },
        ],
        mixBuses: [],
      },
      {
        id: 'wireless-rack',
        kind: 'wireless',
        rawName: 'Wireless Mic Rack',
        model: 'Shure ULX-D Quad × 3',
        zone: 'Stage Rack',
        position: { x: 40, y: 360 },
        sourceOrigin: 'manual',
        portGroups: [
          {
            id: 'wireless-rack:LCL:out',
            code: 'LCL',
            label: 'XLR Direct Outputs',
            direction: 'output',
            capacity: 24,
            channels: localInputs.map((c) => ({ ...c, id: `wireless-rack:out:${c.slot}` })),
          },
        ],
        mixBuses: [],
      },
      {
        id: 'stage-wing',
        kind: 'console',
        rawName: 'SHC-MONITOR',
        model: 'Behringer WING Rack',
        zone: 'Stage Rack',
        position: { x: 420, y: 185 },
        sourceOrigin: 'manual',
        snapshotCreatorName: 'SHC-MONITOR',
        portGroups: [
          {
            id: 'stage-wing:in:A',
            code: 'A',
            label: 'AES50-A Inputs',
            direction: 'input',
            capacity: 48,
            channels: stageInputs,
          },
          {
            id: 'stage-wing:out:A',
            code: 'A',
            label: 'AES50-A Outputs',
            direction: 'output',
            capacity: 48,
            channels: aes50AReturns,
          },
          {
            id: 'stage-wing:in:LCL',
            code: 'LCL',
            label: 'Local Preamp Inputs',
            direction: 'input',
            capacity: 24,
            channels: localInputs,
          },
          {
            id: 'stage-wing:out:LCL',
            code: 'LCL',
            label: 'Local XLR Outputs',
            direction: 'output',
            capacity: 8,
            channels: localOutputs,
          },
          {
            id: 'stage-wing:out:C',
            code: 'C',
            label: 'AES50-C Split to FOH',
            direction: 'output',
            capacity: 48,
            channels: aes50CForward,
          },
          {
            id: 'stage-wing:in:C',
            code: 'C',
            label: 'AES50-C Returns from FOH',
            direction: 'input',
            capacity: 48,
            channels: aes50CReturn,
          },
        ],
        channelStrips: stageStrips,
        mixBuses: stageBuses,
      },
      {
        id: 'iem-rack',
        kind: 'iem',
        rawName: 'IEM Rack',
        model: 'Shure PSM900 × 4 Stereo',
        zone: 'Stage Rack',
        position: { x: 420, y: 455 },
        sourceOrigin: 'manual',
        portGroups: [
          {
            id: 'iem-rack:LCL:in',
            code: 'LCL',
            label: 'Transmitter Inputs (1–8)',
            direction: 'input',
            capacity: 8,
            channels: localOutputs.map((c) => ({ ...c, id: `iem-rack:in:${c.slot}` })),
          },
        ],
        mixBuses: [],
      },
      {
        id: 'foh-wing',
        kind: 'console',
        rawName: 'FOH WING',
        model: 'Behringer WING Full',
        zone: 'FOH Booth',
        position: { x: 850, y: 185 },
        sourceOrigin: 'manual',
        snapshotCreatorName: 'FOH-WING',
        portGroups: [
          {
            id: 'foh-wing:in:C',
            code: 'C',
            label: 'AES50-C Inputs from Stage',
            direction: 'input',
            capacity: 48,
            channels: aes50CForward.map((c) => ({
              ...c,
              id: `foh-wing:in:C:${c.slot}`,
              passthroughFrom: undefined,
            })),
          },
          {
            id: 'foh-wing:out:C',
            code: 'C',
            label: 'AES50-C Returns to Stage',
            direction: 'output',
            capacity: 48,
            channels: aes50CReturn.map((c) => ({
              ...c,
              id: `foh-wing:out:C:${c.slot}`,
              sourceRef: c.slot === 48 ? { nodeId: 'foh-wing', group: 'MTX', slot: 3 } : undefined,
            })),
          },
          {
            id: 'foh-wing:in:USB',
            code: 'USB',
            label: 'USB Audio Inputs',
            direction: 'input',
            capacity: 48,
            channels: mediaOutputs.map((c) => ({ ...c, id: `foh-wing:in:USB:${c.slot}` })),
          },
          {
            id: 'foh-wing:out:LCL',
            code: 'LCL',
            label: 'Local PA Outputs',
            direction: 'output',
            capacity: 8,
            channels: fohPaOutputs,
          },
        ],
        channelStrips: fohStrips,
        mixBuses: fohBuses,
      },
      {
        id: 'media-pc',
        kind: 'media',
        rawName: 'Media PC',
        model: 'ProPresenter / Dante / USB',
        zone: 'FOH Booth',
        position: { x: 850, y: 455 },
        sourceOrigin: 'manual',
        portGroups: [
          {
            id: 'media-pc:out:USB',
            code: 'USB',
            label: 'Stereo Playback Feeds',
            direction: 'output',
            capacity: 4,
            channels: mediaOutputs,
          },
        ],
        mixBuses: [],
      },
      {
        id: 'pa-amp-rack',
        kind: 'amp',
        rawName: 'PA Amp Rack',
        model: 'System DSP + Mains/Subs',
        zone: 'Amp Vault',
        position: { x: 1230, y: 185 },
        sourceOrigin: 'manual',
        portGroups: [
          {
            id: 'pa-amp-rack:in:LCL',
            code: 'LCL',
            label: 'FOH System Feeds',
            direction: 'input',
            capacity: 8,
            channels: fohPaOutputs.map((c) => ({ ...c, id: `pa-amp-rack:in:${c.slot}` })),
          },
          {
            id: 'pa-amp-rack:in:A',
            code: 'A',
            label: 'Stage Sub Return (DL32 Out 16)',
            direction: 'input',
            capacity: 2,
            channels: [
              {
                id: 'pa-amp-rack:in:sub:16',
                slot: 16,
                rawName: 'Subwoofer Amp',
                mode: 'M',
                routeLabel: 'From DL32 Out 16 (Pass-through C.48)',
              },
            ],
          },
        ],
        mixBuses: [],
      },
    ],
    trunks: [
      {
        id: 'trunk-aes50-a',
        label: 'AES50-A Stage Box',
        protocol: 'aes50',
        sourceNodeId: 'dl32-stage',
        sourcePortGroup: 'A',
        targetNodeId: 'stage-wing',
        targetPortGroup: 'A',
        sourceOrigin: 'manual',
        channels: stageInputs.map((c) => ({ ...c, id: `trunk-aes50-a:fwd:${c.slot}` })),
        returnChannels: aes50AReturns.map((c) => ({ ...c, id: `trunk-aes50-a:ret:${c.slot}` })),
      },
      {
        id: 'trunk-wireless-lcl',
        label: 'Wireless & Stage XLR Loom',
        protocol: 'analog-xlr',
        sourceNodeId: 'wireless-rack',
        sourcePortGroup: 'LCL',
        targetNodeId: 'stage-wing',
        targetPortGroup: 'LCL',
        sourceOrigin: 'manual',
        channels: localInputs.map((c) => ({ ...c, id: `trunk-wireless-lcl:fwd:${c.slot}` })),
        returnChannels: [],
      },
      {
        id: 'trunk-lcl-iem',
        label: 'Local Out → IEM Transmitters',
        protocol: 'analog-xlr',
        sourceNodeId: 'stage-wing',
        sourcePortGroup: 'LCL',
        targetNodeId: 'iem-rack',
        targetPortGroup: 'LCL',
        sourceOrigin: 'manual',
        channels: localOutputs.map((c) => ({ ...c, id: `trunk-lcl-iem:fwd:${c.slot}` })),
        returnChannels: [],
      },
      {
        id: 'trunk-aes50-c',
        label: 'AES50-C Stage ↔ FOH Snake',
        protocol: 'aes50',
        sourceNodeId: 'stage-wing',
        sourcePortGroup: 'C',
        targetNodeId: 'foh-wing',
        targetPortGroup: 'C',
        sourceOrigin: 'manual',
        channels: aes50CForward.map((c) => ({ ...c, id: `trunk-aes50-c:fwd:${c.slot}` })),
        returnChannels: aes50CReturn.map((c) => ({ ...c, id: `trunk-aes50-c:ret:${c.slot}` })),
      },
      {
        id: 'trunk-media-foh',
        label: 'Media Playback USB',
        protocol: 'usb',
        sourceNodeId: 'media-pc',
        sourcePortGroup: 'USB',
        targetNodeId: 'foh-wing',
        targetPortGroup: 'USB',
        sourceOrigin: 'manual',
        channels: mediaOutputs.map((c) => ({ ...c, id: `trunk-media-foh:fwd:${c.slot}` })),
        returnChannels: [],
      },
      {
        id: 'trunk-foh-pa',
        label: 'FOH → PA Amp Feeds',
        protocol: 'analog-xlr',
        sourceNodeId: 'foh-wing',
        sourcePortGroup: 'LCL',
        targetNodeId: 'pa-amp-rack',
        targetPortGroup: 'LCL',
        sourceOrigin: 'manual',
        channels: fohPaOutputs.map((c) => ({ ...c, id: `trunk-foh-pa:fwd:${c.slot}` })),
        returnChannels: [],
      },
    ],
    annotations: {
      nodes: {
        'dl32-stage': {
          friendlyName: 'Midas DL32 Stage Box',
          notes: 'Upstage center rack. Provides 32 band/TB preamps and 16 monitor/sub outputs.',
        },
        'stage-wing': {
          friendlyName: 'Stage WING Rack (Monitor)',
          notes: 'Clock master (48 kHz). Handles all IEM mixes and passes clean split to FOH via AES50-C.',
        },
        'foh-wing': {
          friendlyName: 'FOH WING Console',
          notes: 'Synced to AES50-C clock. Feeds Mains, Front Fill, Lobby, and sends Sub return on C.48.',
        },
      },
      trunks: {
        'trunk-aes50-a': {
          cableTag: 'CAT6-SHIELD-A1',
          notes: '50 ft shielded Cat6 etherCON between stage box and WING Rack AES50-A.',
        },
        'trunk-aes50-c': {
          cableTag: 'CAT6-FOH-TRUNK',
          notes: '150 ft conduit run to FOH booth. Ch 1–23 stage split, Ch 25–48 local split; Ret Ch 48 = FOH Sub.',
        },
        'trunk-wireless-lcl': {
          cableTag: 'XLR-RACK-LOOM',
          notes: 'Short patch loom inside stage rack from ULX-D receivers to WING Local In 1–19.',
        },
        'trunk-lcl-iem': {
          cableTag: 'IEM-PATCH-1-8',
          notes: 'WING Local Out 1–8 feeding 4 stereo PSM900 transmitters.',
        },
      },
      channels: {
        'stage-wing:in:A:11': {
          notes: 'Active DI box requires +48V phantom power.',
        },
        'stage-wing:out:A:16': {
          friendlyName: 'Stage Sub Amp Feed',
          cableTag: 'XLR-SUB-16',
          notes: 'Direct pass-through from FOH AES50-C Return 48 to Stage Box Out 16.',
        },
      },
      buses: {},
      orphaned: [],
    },
  };
}
