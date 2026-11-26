import type {
  AnnotationOverlay,
  ChannelPatch,
  HardwareNode,
  OrphanedAnnotation,
  PortGroupCode,
  RigDocument,
  TrunkConnection,
  TrunkProtocol,
} from '../schema/rig';
import type { ParsedWingSnapshot } from './wingSnapParser';

export interface DiffItem {
  id: string;
  label: string;
  detail?: string;
}

export interface TrunkDiffSummary {
  trunkId: string;
  label: string;
  beforeForward: number;
  afterForward: number;
  beforeReturn: number;
  afterReturn: number;
  isNew: boolean;
}

export interface SnapMergeDiff {
  targetConsoleNodeId: string;
  targetConsoleName: string;
  isNewConsole: boolean;
  addedChannels: DiffItem[];
  updatedChannels: DiffItem[];
  removedChannels: DiffItem[];
  addedBuses: DiffItem[];
  updatedBuses: DiffItem[];
  removedBuses: DiffItem[];
  trunkSummaries: TrunkDiffSummary[];
  preservedAnnotationsCount: number;
  newOrphans: OrphanedAnnotation[];
}

export interface SnapMergeResult {
  rig: RigDocument;
  diff: SnapMergeDiff;
}

function collectConsoleChannels(node?: HardwareNode): Map<string, ChannelPatch> {
  const map = new Map<string, ChannelPatch>();
  if (!node) return map;
  for (const pg of node.portGroups) {
    for (const ch of pg.channels) {
      map.set(ch.id, ch);
    }
  }
  return map;
}

function channelSignature(ch: ChannelPatch): string {
  return JSON.stringify({
    slot: ch.slot,
    rawName: ch.rawName,
    mode: ch.mode,
    gainDb: ch.gainDb ?? null,
    phantom48v: Boolean(ch.phantom48v),
    consoleChannel: ch.consoleChannel ?? null,
    channelStripName: ch.channelStripName ?? null,
    routeLabel: ch.routeLabel ?? null,
    passthroughFrom: ch.passthroughFrom ?? null,
  });
}

function protocolForGroup(code: PortGroupCode): TrunkProtocol {
  switch (code) {
    case 'A':
    case 'B':
    case 'C':
      return 'aes50';
    case 'SC':
      return 'stageconnect';
    case 'USB':
      return 'usb';
    case 'CRD':
    case 'MOD':
      return 'dante';
    case 'AUX':
      return 'analog-trs';
    default:
      return 'analog-xlr';
  }
}

export function resolveTargetConsoleId(
  rig: RigDocument,
  parsed: ParsedWingSnapshot,
  explicitConsoleId?: string,
): string {
  if (explicitConsoleId) return explicitConsoleId;

  const byCreator = rig.nodes.find(
    (n) =>
      n.kind === 'console' &&
      (n.snapshotCreatorName?.toLowerCase() === parsed.metadata.creatorName.toLowerCase() ||
        n.rawName.toLowerCase() === parsed.metadata.creatorName.toLowerCase()),
  );
  if (byCreator) return byCreator.id;

  // Fallback: if single console exists or creatorName mentions monitor/stage
  const isMonitor = /mon|stage/i.test(parsed.metadata.creatorName);
  const byHint = rig.nodes.find(
    (n) =>
      n.kind === 'console' &&
      (isMonitor ? n.id.includes('stage') || n.zone === 'Stage Rack' : n.id.includes('foh')),
  );
  if (byHint) return byHint.id;

  return parsed.consoleNode.id;
}

function rekeyParsedSnapshot(
  parsed: ParsedWingSnapshot,
  targetConsoleId: string,
): ParsedWingSnapshot {
  if (parsed.consoleNode.id === targetConsoleId) return parsed;
  const oldPrefix = `${parsed.consoleNode.id}:`;
  const newPrefix = `${targetConsoleId}:`;
  const rekey = (id: string) => (id.startsWith(oldPrefix) ? newPrefix + id.slice(oldPrefix.length) : id);

  const rekeyPatch = (ch: ChannelPatch): ChannelPatch => ({
    ...ch,
    id: rekey(ch.id),
    sourceRef: ch.sourceRef
      ? {
          ...ch.sourceRef,
          nodeId: ch.sourceRef.nodeId === parsed.consoleNode.id ? targetConsoleId : ch.sourceRef.nodeId,
        }
      : undefined,
    passthroughFrom: ch.passthroughFrom
      ? {
          ...ch.passthroughFrom,
          nodeId:
            ch.passthroughFrom.nodeId === parsed.consoleNode.id
              ? targetConsoleId
              : ch.passthroughFrom.nodeId,
        }
      : undefined,
  });

  const rekeyedPortGroups = parsed.consoleNode.portGroups.map((pg) => ({
    ...pg,
    id: rekey(pg.id),
    channels: pg.channels.map(rekeyPatch),
  }));

  const inputsByGroup: ParsedWingSnapshot['inputsByGroup'] = {};
  for (const [k, v] of Object.entries(parsed.inputsByGroup)) {
    if (v) inputsByGroup[k as PortGroupCode] = v.map(rekeyPatch);
  }
  const outputsByGroup: ParsedWingSnapshot['outputsByGroup'] = {};
  for (const [k, v] of Object.entries(parsed.outputsByGroup)) {
    if (v) outputsByGroup[k as PortGroupCode] = v.map(rekeyPatch);
  }

  return {
    ...parsed,
    metadata: {
      ...parsed.metadata,
      consoleNodeId: targetConsoleId,
    },
    consoleNode: {
      ...parsed.consoleNode,
      id: targetConsoleId,
      portGroups: rekeyedPortGroups,
      channelStrips: parsed.consoleNode.channelStrips?.map((s) => ({
        ...s,
        id: rekey(s.id),
      })),
      mixBuses: parsed.consoleNode.mixBuses.map((b) => ({
        ...b,
        id: rekey(b.id),
      })),
    },
    inputsByGroup,
    outputsByGroup,
  };
}

export function applySnapMerge(
  existingRig: RigDocument,
  rawParsed: ParsedWingSnapshot,
  explicitConsoleId?: string,
): SnapMergeResult {
  const targetConsoleId = resolveTargetConsoleId(existingRig, rawParsed, explicitConsoleId);
  const parsed = rekeyParsedSnapshot(rawParsed, targetConsoleId);
  const existingConsole = existingRig.nodes.find((n) => n.id === targetConsoleId);
  const isNewConsole = !existingConsole;
  const now = parsed.metadata.importedAt || new Date().toISOString();

  // 1. Channel & Bus Diff for target console
  const oldChannels = collectConsoleChannels(existingConsole);
  const newChannels = collectConsoleChannels(parsed.consoleNode);

  const addedChannels: DiffItem[] = [];
  const updatedChannels: DiffItem[] = [];
  const removedChannels: DiffItem[] = [];

  for (const [id, ch] of newChannels) {
    const prev = oldChannels.get(id);
    if (!prev) {
      addedChannels.push({ id, label: ch.rawName, detail: `Slot ${ch.slot}` });
    } else if (channelSignature(prev) !== channelSignature(ch)) {
      updatedChannels.push({
        id,
        label: ch.rawName,
        detail:
          prev.rawName !== ch.rawName
            ? `"${prev.rawName}" → "${ch.rawName}"`
            : `Updated routing / preamp metadata`,
      });
    }
  }

  for (const [id, ch] of oldChannels) {
    if (!newChannels.has(id)) {
      removedChannels.push({ id, label: ch.rawName, detail: `Slot ${ch.slot}` });
    }
  }

  const oldBuses = new Map((existingConsole?.mixBuses ?? []).map((b) => [b.id, b]));
  const newBuses = new Map(parsed.consoleNode.mixBuses.map((b) => [b.id, b]));

  const addedBuses: DiffItem[] = [];
  const updatedBuses: DiffItem[] = [];
  const removedBuses: DiffItem[] = [];

  for (const [id, b] of newBuses) {
    const prev = oldBuses.get(id);
    if (!prev) {
      addedBuses.push({ id, label: b.rawName || `${b.kind.toUpperCase()} ${b.index}` });
    } else if (
      prev.rawName !== b.rawName ||
      prev.mono !== b.mono ||
      prev.outputs.length !== b.outputs.length
    ) {
      updatedBuses.push({
        id,
        label: b.rawName || `${b.kind.toUpperCase()} ${b.index}`,
        detail: prev.rawName !== b.rawName ? `"${prev.rawName}" → "${b.rawName}"` : 'Outputs changed',
      });
    }
  }

  for (const [id, b] of oldBuses) {
    if (!newBuses.has(id)) {
      removedBuses.push({ id, label: b.rawName || `${b.kind.toUpperCase()} ${b.index}` });
    }
  }

  // 2. Build updated Console node preserving position & zone
  const mergedConsoleNode: HardwareNode = {
    ...parsed.consoleNode,
    position: existingConsole?.position ?? parsed.consoleNode.position,
    zone: existingConsole?.zone ?? parsed.consoleNode.zone,
    sourceOrigin: 'snapshot',
  };

  // 3. Update existing nodes array (replace target console, preserve all other/manual nodes)
  const nextNodes: HardwareNode[] = existingRig.nodes.map((n) =>
    n.id === targetConsoleId ? mergedConsoleNode : { ...n, portGroups: n.portGroups.map((pg) => ({ ...pg })) },
  );
  if (isNewConsole) {
    nextNodes.push(mergedConsoleNode);
  }

  // 4. Synchronize trunks connected to targetConsoleId with parsed snapshot I/O
  const trunkSummaries: TrunkDiffSummary[] = [];
  const handledGroups = new Set<string>();

  const nextTrunks: TrunkConnection[] = existingRig.trunks.map((trunk) => {
    const touchesSource = trunk.sourceNodeId === targetConsoleId;
    const touchesTarget = trunk.targetNodeId === targetConsoleId;
    if (!touchesSource && !touchesTarget) return trunk;

    const consoleGroup = touchesSource ? trunk.sourcePortGroup : trunk.targetPortGroup;
    const parsedInputs = parsed.inputsByGroup[consoleGroup];
    const parsedOutputs = parsed.outputsByGroup[consoleGroup];

    let nextChannels = trunk.channels;
    let nextReturnChannels = trunk.returnChannels;

    if (touchesSource) {
      // Forward = console OUT -> peer; Return = peer -> console IN
      if (parsedOutputs && parsedOutputs.length > 0) {
        nextChannels = parsedOutputs.map((c) => ({ ...c, id: `${trunk.id}:fwd:${c.slot}` }));
        handledGroups.add(`out:${consoleGroup}`);
      }
      if (parsedInputs && parsedInputs.length > 0 && trunk.returnChannels.length > 0) {
        nextReturnChannels = parsedInputs.map((c) => ({ ...c, id: `${trunk.id}:ret:${c.slot}` }));
        handledGroups.add(`in:${consoleGroup}`);
      }
    } else if (touchesTarget) {
      // Forward = peer -> console IN; Return = console OUT -> peer
      if (parsedInputs && parsedInputs.length > 0) {
        nextChannels = parsedInputs.map((c) => ({ ...c, id: `${trunk.id}:fwd:${c.slot}` }));
        handledGroups.add(`in:${consoleGroup}`);
      }
      if (parsedOutputs && parsedOutputs.length > 0 && (trunk.returnChannels.length > 0 || consoleGroup === 'A' || consoleGroup === 'B' || consoleGroup === 'C')) {
        nextReturnChannels = parsedOutputs.map((c) => ({ ...c, id: `${trunk.id}:ret:${c.slot}` }));
        handledGroups.add(`out:${consoleGroup}`);
      }
    }

    // Link bus outputs to this trunkId for instant bus->trunk tracing
    for (const bus of mergedConsoleNode.mixBuses) {
      for (const out of bus.outputs) {
        if (out.group === consoleGroup) {
          out.trunkId = trunk.id;
        }
      }
    }

    // Also mirror updated channels onto non-console peer port groups so inspector views stay coherent
    const peerId = touchesSource ? trunk.targetNodeId : trunk.sourceNodeId;
    const peerGroup = touchesSource ? trunk.targetPortGroup : trunk.sourcePortGroup;
    const peerNode = nextNodes.find((n) => n.id === peerId);
    if (peerNode && peerNode.kind !== 'console') {
      peerNode.portGroups = peerNode.portGroups.map((pg) => {
        if (pg.code !== peerGroup) return pg;
        if (touchesTarget && pg.direction === 'output' && parsedInputs) {
          return {
            ...pg,
            channels: parsedInputs.map((c) => ({ ...c, id: `${peerNode.id}:in:${c.slot}` })),
          };
        }
        if (touchesTarget && pg.direction === 'input' && parsedOutputs) {
          return {
            ...pg,
            channels: parsedOutputs.map((c) => ({ ...c, id: `${peerNode.id}:out:${c.slot}` })),
          };
        }
        if (touchesSource && pg.direction === 'input' && parsedOutputs) {
          return {
            ...pg,
            channels: parsedOutputs.map((c) => ({ ...c, id: `${peerNode.id}:in:${c.slot}` })),
          };
        }
        return pg;
      });
    }

    trunkSummaries.push({
      trunkId: trunk.id,
      label: trunk.label,
      beforeForward: trunk.channels.length,
      afterForward: nextChannels.length,
      beforeReturn: trunk.returnChannels.length,
      afterReturn: nextReturnChannels.length,
      isNew: false,
    });

    return {
      ...trunk,
      channels: nextChannels,
      returnChannels: nextReturnChannels,
    };
  });

  // If this is a brand-new console with no existing trunks, synthesize trunks for active AES50 groups
  if (isNewConsole) {
    const autoGroups: PortGroupCode[] = ['A', 'B', 'C'];
    let yOffset = 60;
    for (const grp of autoGroups) {
      const ins = parsed.inputsByGroup[grp] ?? [];
      const outs = parsed.outputsByGroup[grp] ?? [];
      if (ins.length === 0 && outs.length === 0) continue;

      const peerId = `${targetConsoleId}-aes50-${grp.toLowerCase()}-peer`;
      const isStageBox = grp === 'A' && ins.length >= outs.length;
      const peerNode: HardwareNode = {
        id: peerId,
        kind: isStageBox ? 'stagebox' : 'external',
        rawName: isStageBox ? `AES50-${grp} Stage Box` : `AES50-${grp} Peer`,
        model: isStageBox ? 'Stage Box (Auto-Detected)' : `AES50-${grp} Device`,
        zone: isStageBox ? 'Stage' : 'FOH Booth',
        position: { x: isStageBox ? 40 : 850, y: yOffset },
        sourceOrigin: 'snapshot',
        portGroups: [
          ...(ins.length
            ? [
                {
                  id: `${peerId}:out:${grp}`,
                  code: grp,
                  label: `Outputs to ${mergedConsoleNode.rawName}`,
                  direction: 'output' as const,
                  capacity: 48,
                  channels: ins.map((c) => ({ ...c, id: `${peerId}:out:${grp}:${c.slot}` })),
                },
              ]
            : []),
          ...(outs.length
            ? [
                {
                  id: `${peerId}:in:${grp}`,
                  code: grp,
                  label: `Inputs from ${mergedConsoleNode.rawName}`,
                  direction: 'input' as const,
                  capacity: 48,
                  channels: outs.map((c) => ({ ...c, id: `${peerId}:in:${grp}:${c.slot}` })),
                },
              ]
            : []),
        ],
        mixBuses: [],
      };
      yOffset += 220;
      nextNodes.push(peerNode);

      const trunkId = `trunk-${targetConsoleId}-${grp.toLowerCase()}`;
      const newTrunk: TrunkConnection = {
        id: trunkId,
        label: `AES50-${grp} Trunk`,
        protocol: protocolForGroup(grp),
        sourceNodeId: isStageBox ? peerId : targetConsoleId,
        sourcePortGroup: grp,
        targetNodeId: isStageBox ? targetConsoleId : peerId,
        targetPortGroup: grp,
        sourceOrigin: 'snapshot',
        channels: (isStageBox ? ins : outs).map((c) => ({ ...c, id: `${trunkId}:fwd:${c.slot}` })),
        returnChannels: (isStageBox ? outs : ins).map((c) => ({
          ...c,
          id: `${trunkId}:ret:${c.slot}`,
        })),
      };
      nextTrunks.push(newTrunk);
      trunkSummaries.push({
        trunkId,
        label: newTrunk.label,
        beforeForward: 0,
        afterForward: newTrunk.channels.length,
        beforeReturn: 0,
        afterReturn: newTrunk.returnChannels.length,
        isNew: true,
      });
    }
  }

  // 5. Preserve Layer 2 annotations and track any removed annotated items in annotations.orphaned
  const validNodeIds = new Set(nextNodes.map((n) => n.id));
  const validTrunkIds = new Set(nextTrunks.map((t) => t.id));
  const validChannelIds = new Set<string>();
  const validBusIds = new Set<string>();

  for (const n of nextNodes) {
    for (const pg of n.portGroups) {
      for (const ch of pg.channels) validChannelIds.add(ch.id);
    }
    for (const b of n.mixBuses) validBusIds.add(b.id);
  }
  for (const t of nextTrunks) {
    for (const ch of t.channels) validChannelIds.add(ch.id);
    for (const ch of t.returnChannels) validChannelIds.add(ch.id);
  }

  const nextAnnotations: AnnotationOverlay = {
    nodes: { ...existingRig.annotations.nodes },
    trunks: { ...existingRig.annotations.trunks },
    channels: { ...existingRig.annotations.channels },
    buses: { ...existingRig.annotations.buses },
    orphaned: [...existingRig.annotations.orphaned],
  };

  const existingOrphanKeys = new Set(nextAnnotations.orphaned.map((o) => o.key));
  const newOrphans: OrphanedAnnotation[] = [];
  let preservedAnnotationsCount = 0;

  const hasContent = (ann?: { friendlyName?: string; cableTag?: string; notes?: string }) =>
    Boolean(ann && (ann.friendlyName?.trim() || ann.cableTag?.trim() || ann.notes?.trim()));

  for (const [key, ann] of Object.entries(existingRig.annotations.nodes)) {
    if (validNodeIds.has(key)) {
      if (hasContent(ann) || ann.position) preservedAnnotationsCount++;
    } else {
      delete nextAnnotations.nodes[key];
      if (hasContent(ann) && !existingOrphanKeys.has(key)) {
        const orphan: OrphanedAnnotation = {
          key,
          entityType: 'node',
          lastKnownName: ann.friendlyName || key,
          friendlyName: ann.friendlyName,
          notes: ann.notes,
          orphanedAt: now,
          reason: `Removed during ${parsed.metadata.fileName} import`,
        };
        newOrphans.push(orphan);
        nextAnnotations.orphaned.push(orphan);
        existingOrphanKeys.add(key);
      }
    }
  }

  for (const [key, ann] of Object.entries(existingRig.annotations.trunks)) {
    if (validTrunkIds.has(key)) {
      if (hasContent(ann)) preservedAnnotationsCount++;
    } else {
      delete nextAnnotations.trunks[key];
      if (hasContent(ann) && !existingOrphanKeys.has(key)) {
        const orphan: OrphanedAnnotation = {
          key,
          entityType: 'trunk',
          lastKnownName: ann.friendlyName || key,
          friendlyName: ann.friendlyName,
          cableTag: ann.cableTag,
          notes: ann.notes,
          orphanedAt: now,
          reason: `Removed during ${parsed.metadata.fileName} import`,
        };
        newOrphans.push(orphan);
        nextAnnotations.orphaned.push(orphan);
        existingOrphanKeys.add(key);
      }
    }
  }

  for (const [key, ann] of Object.entries(existingRig.annotations.channels)) {
    if (validChannelIds.has(key)) {
      if (hasContent(ann)) preservedAnnotationsCount++;
    } else {
      delete nextAnnotations.channels[key];
      if (hasContent(ann) && !existingOrphanKeys.has(key)) {
        const oldCh = oldChannels.get(key);
        const orphan: OrphanedAnnotation = {
          key,
          entityType: 'channel',
          lastKnownName: oldCh?.rawName || ann.friendlyName || key,
          friendlyName: ann.friendlyName,
          cableTag: ann.cableTag,
          notes: ann.notes,
          orphanedAt: now,
          reason: `Unpatched or removed in ${parsed.metadata.fileName}`,
        };
        newOrphans.push(orphan);
        nextAnnotations.orphaned.push(orphan);
        existingOrphanKeys.add(key);
      }
    }
  }

  for (const [key, ann] of Object.entries(existingRig.annotations.buses)) {
    if (validBusIds.has(key)) {
      if (hasContent(ann)) preservedAnnotationsCount++;
    } else {
      delete nextAnnotations.buses[key];
      if (hasContent(ann) && !existingOrphanKeys.has(key)) {
        const oldBus = oldBuses.get(key);
        const orphan: OrphanedAnnotation = {
          key,
          entityType: 'bus',
          lastKnownName: oldBus?.rawName || ann.friendlyName || key,
          friendlyName: ann.friendlyName,
          notes: ann.notes,
          orphanedAt: now,
          reason: `Removed in ${parsed.metadata.fileName}`,
        };
        newOrphans.push(orphan);
        nextAnnotations.orphaned.push(orphan);
        existingOrphanKeys.add(key);
      }
    }
  }

  // Re-attach previously orphaned annotations if those keys reappeared in the new snapshot!
  const remainingOrphans: OrphanedAnnotation[] = [];
  for (const orph of nextAnnotations.orphaned) {
    if (orph.entityType === 'channel' && validChannelIds.has(orph.key)) {
      nextAnnotations.channels[orph.key] = {
        friendlyName: orph.friendlyName,
        cableTag: orph.cableTag,
        notes: orph.notes,
      };
      preservedAnnotationsCount++;
    } else if (orph.entityType === 'bus' && validBusIds.has(orph.key)) {
      nextAnnotations.buses[orph.key] = {
        friendlyName: orph.friendlyName,
        notes: orph.notes,
      };
      preservedAnnotationsCount++;
    } else {
      remainingOrphans.push(orph);
    }
  }
  nextAnnotations.orphaned = remainingOrphans;

  // Update sourceSnapshots list (replace prior entry for this consoleNodeId)
  const nextSnapshots = [
    ...existingRig.sourceSnapshots.filter((s) => s.consoleNodeId !== targetConsoleId),
    parsed.metadata,
  ];

  const nextRig: RigDocument = {
    ...existingRig,
    updatedAt: now,
    sourceSnapshots: nextSnapshots,
    nodes: nextNodes,
    trunks: nextTrunks,
    annotations: nextAnnotations,
  };

  return {
    rig: nextRig,
    diff: {
      targetConsoleNodeId: targetConsoleId,
      targetConsoleName:
        existingRig.annotations.nodes[targetConsoleId]?.friendlyName || mergedConsoleNode.rawName,
      isNewConsole,
      addedChannels,
      updatedChannels,
      removedChannels,
      addedBuses,
      updatedBuses,
      removedBuses,
      trunkSummaries,
      preservedAnnotationsCount,
      newOrphans,
    },
  };
}

export function computeSnapMergeDiff(
  existingRig: RigDocument,
  parsed: ParsedWingSnapshot,
  explicitConsoleId?: string,
): SnapMergeDiff {
  return applySnapMerge(existingRig, parsed, explicitConsoleId).diff;
}
