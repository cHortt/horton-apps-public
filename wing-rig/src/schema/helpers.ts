import type {
  ChannelPatch,
  HardwareNode,
  MixBusKind,
  MixBusSummary,
  PortGroupCode,
  RigDocument,
  SearchHit,
  TraceResult,
  TraceStep,
  TraceTarget,
  TrunkConnection,
  TrunkProtocol,
} from './rig';

export interface ValidationIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export const PROTOCOL_META: Record<
  TrunkProtocol,
  { label: string; shortLabel: string; color: string; bg: string; border: string; text: string }
> = {
  aes50: {
    label: 'AES50 SuperMAC',
    shortLabel: 'AES50',
    color: '#0284c7',
    bg: '#e0f2fe',
    border: '#38bdf8',
    text: '#0369a1',
  },
  'analog-xlr': {
    label: 'Analog XLR',
    shortLabel: 'XLR',
    color: '#d97706',
    bg: '#fef3c7',
    border: '#fbbf24',
    text: '#b45309',
  },
  'analog-trs': {
    label: 'Analog TRS / Aux',
    shortLabel: 'TRS',
    color: '#ca8a04',
    bg: '#fef9c3',
    border: '#facc15',
    text: '#a16207',
  },
  dante: {
    label: 'Dante / AoIP',
    shortLabel: 'DANTE',
    color: '#0d9488',
    bg: '#ccfbf1',
    border: '#2dd4bf',
    text: '#0f766e',
  },
  usb: {
    label: 'USB Audio',
    shortLabel: 'USB',
    color: '#4f46e5',
    bg: '#e0e7ff',
    border: '#818cf8',
    text: '#4338ca',
  },
  stageconnect: {
    label: 'StageCONNECT',
    shortLabel: 'SC',
    color: '#059669',
    bg: '#d1fae5',
    border: '#34d399',
    text: '#047857',
  },
  network: {
    label: 'Control / Network',
    shortLabel: 'NET',
    color: '#475569',
    bg: '#f1f5f9',
    border: '#94a3b8',
    text: '#334155',
  },
};

export function resolveNodeName(doc: RigDocument, node: HardwareNode): string {
  const friendly = doc.annotations.nodes[node.id]?.friendlyName?.trim();
  return friendly || node.rawName;
}

export function resolveNodeZone(doc: RigDocument, node: HardwareNode): HardwareNode['zone'] {
  return doc.annotations.nodes[node.id]?.zone ?? node.zone;
}

export function resolveNodePosition(doc: RigDocument, node: HardwareNode): { x: number; y: number } {
  return doc.annotations.nodes[node.id]?.position ?? node.position;
}

export function resolveTrunkName(doc: RigDocument, trunk: TrunkConnection): string {
  const friendly = doc.annotations.trunks[trunk.id]?.friendlyName?.trim();
  return friendly || trunk.label;
}

export function resolveTrunkCableTag(doc: RigDocument, trunk: TrunkConnection): string | undefined {
  return doc.annotations.trunks[trunk.id]?.cableTag?.trim() || undefined;
}

export function resolveChannelName(doc: RigDocument, channel: ChannelPatch): string {
  const friendly = doc.annotations.channels[channel.id]?.friendlyName?.trim();
  if (friendly) return friendly;
  if (channel.rawName && channel.rawName.trim()) return channel.rawName.trim();
  if (channel.routeLabel && channel.routeLabel.trim()) return channel.routeLabel.trim();
  return `Ch ${channel.slot}`;
}

export function resolveBusName(doc: RigDocument, bus: MixBusSummary): string {
  const friendly = doc.annotations.buses[bus.id]?.friendlyName?.trim();
  if (friendly) return friendly;
  if (bus.rawName && bus.rawName.trim() && bus.rawName.trim() !== '.') {
    return bus.rawName.trim();
  }
  return `${bus.kind.toUpperCase()} ${bus.index}`;
}

export function formatGain(gainDb?: number): string {
  if (gainDb === undefined || Number.isNaN(gainDb)) return '—';
  const sign = gainDb > 0 ? '+' : '';
  return `${sign}${gainDb % 1 === 0 ? gainDb.toFixed(0) : gainDb.toFixed(1)} dB`;
}

export function validateRigDocument(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      issues: [{ level: 'error', path: '$', message: 'Rig document must be a JSON object.' }],
    };
  }

  const doc = input as Partial<RigDocument>;
  if (doc.schemaVersion !== 1) {
    issues.push({
      level: 'error',
      path: 'schemaVersion',
      message: `Unsupported schemaVersion: ${String(doc.schemaVersion)} (expected 1).`,
    });
  }
  if (!doc.id || typeof doc.id !== 'string') {
    issues.push({ level: 'error', path: 'id', message: 'Missing string document id.' });
  }
  if (!doc.name || typeof doc.name !== 'string') {
    issues.push({ level: 'error', path: 'name', message: 'Missing string document name.' });
  }
  if (!Array.isArray(doc.nodes)) {
    issues.push({ level: 'error', path: 'nodes', message: 'nodes must be an array.' });
  }
  if (!Array.isArray(doc.trunks)) {
    issues.push({ level: 'error', path: 'trunks', message: 'trunks must be an array.' });
  }
  if (!doc.annotations || typeof doc.annotations !== 'object') {
    issues.push({ level: 'error', path: 'annotations', message: 'annotations object is required.' });
  }

  const nodeIds = new Set<string>();
  if (Array.isArray(doc.nodes)) {
    doc.nodes.forEach((n, idx) => {
      if (!n || typeof n.id !== 'string' || !n.id) {
        issues.push({ level: 'error', path: `nodes[${idx}].id`, message: 'Node missing valid id.' });
        return;
      }
      if (nodeIds.has(n.id)) {
        issues.push({ level: 'error', path: `nodes[${idx}].id`, message: `Duplicate node id "${n.id}".` });
      }
      nodeIds.add(n.id);
      if (!n.position || typeof n.position.x !== 'number' || typeof n.position.y !== 'number') {
        issues.push({
          level: 'error',
          path: `nodes[${idx}].position`,
          message: `Node "${n.id}" has invalid position.`,
        });
      }
      if (!Array.isArray(n.portGroups)) {
        issues.push({
          level: 'error',
          path: `nodes[${idx}].portGroups`,
          message: `Node "${n.id}" missing portGroups array.`,
        });
      }
    });
  }

  const trunkIds = new Set<string>();
  if (Array.isArray(doc.trunks)) {
    doc.trunks.forEach((t, idx) => {
      if (!t || typeof t.id !== 'string' || !t.id) {
        issues.push({ level: 'error', path: `trunks[${idx}].id`, message: 'Trunk missing valid id.' });
        return;
      }
      if (trunkIds.has(t.id)) {
        issues.push({ level: 'error', path: `trunks[${idx}].id`, message: `Duplicate trunk id "${t.id}".` });
      }
      trunkIds.add(t.id);
      if (!nodeIds.has(t.sourceNodeId)) {
        issues.push({
          level: 'error',
          path: `trunks[${idx}].sourceNodeId`,
          message: `Trunk "${t.id}" references missing sourceNodeId "${t.sourceNodeId}".`,
        });
      }
      if (!nodeIds.has(t.targetNodeId)) {
        issues.push({
          level: 'error',
          path: `trunks[${idx}].targetNodeId`,
          message: `Trunk "${t.id}" references missing targetNodeId "${t.targetNodeId}".`,
        });
      }
      if (!Array.isArray(t.channels) || !Array.isArray(t.returnChannels)) {
        issues.push({
          level: 'error',
          path: `trunks[${idx}]`,
          message: `Trunk "${t.id}" must include channels and returnChannels arrays.`,
        });
      }
    });
  }

  return {
    valid: !issues.some((i) => i.level === 'error'),
    issues,
  };
}

function getNodeById(doc: RigDocument, id: string): HardwareNode | undefined {
  return doc.nodes.find((n) => n.id === id);
}

function getTrunkChannelMatch(
  trunk: TrunkConnection,
  nodeId: string,
  group: PortGroupCode,
  slot: number,
  direction: 'in' | 'out',
): { channel: ChannelPatch; isReturn: boolean; peerNodeId: string; peerGroup: PortGroupCode } | null {
  // Forward channels flow sourceNode(sourcePortGroup) -> targetNode(targetPortGroup)
  // Return channels flow targetNode(targetPortGroup) -> sourceNode(sourcePortGroup)
  if (direction === 'in') {
    if (trunk.targetNodeId === nodeId && trunk.targetPortGroup === group) {
      const ch = trunk.channels.find((c) => c.slot === slot);
      if (ch) {
        return {
          channel: ch,
          isReturn: false,
          peerNodeId: trunk.sourceNodeId,
          peerGroup: trunk.sourcePortGroup,
        };
      }
    }
    if (trunk.sourceNodeId === nodeId && trunk.sourcePortGroup === group) {
      const ch = trunk.returnChannels.find((c) => c.slot === slot);
      if (ch) {
        return {
          channel: ch,
          isReturn: true,
          peerNodeId: trunk.targetNodeId,
          peerGroup: trunk.targetPortGroup,
        };
      }
    }
  } else {
    if (trunk.sourceNodeId === nodeId && trunk.sourcePortGroup === group) {
      const ch = trunk.channels.find((c) => c.slot === slot);
      if (ch) {
        return {
          channel: ch,
          isReturn: false,
          peerNodeId: trunk.targetNodeId,
          peerGroup: trunk.targetPortGroup,
        };
      }
    }
    if (trunk.targetNodeId === nodeId && trunk.targetPortGroup === group) {
      const ch = trunk.returnChannels.find((c) => c.slot === slot);
      if (ch) {
        return {
          channel: ch,
          isReturn: true,
          peerNodeId: trunk.sourceNodeId,
          peerGroup: trunk.sourcePortGroup,
        };
      }
    }
  }
  return null;
}

function busKindToGroup(kind: MixBusKind): 'BUS' | 'MAIN' | 'MTX' | 'MON' {
  switch (kind) {
    case 'bus':
      return 'BUS';
    case 'main':
      return 'MAIN';
    case 'mtx':
      return 'MTX';
    case 'mon':
      return 'MON';
  }
}

export function traceSignal(doc: RigDocument, target: TraceTarget): TraceResult {
  const activeNodeIds = new Set<string>();
  const activeTrunkIds = new Set<string>();
  const activeChannelIds = new Set<string>();
  const activeBusIds = new Set<string>();
  const steps: TraceStep[] = [];
  const stepSeen = new Set<string>();

  const pushStep = (step: Omit<TraceStep, 'order'>) => {
    const dedupeKey = `${step.kind}|${step.nodeId}|${step.trunkId ?? ''}|${step.detail}`;
    if (stepSeen.has(dedupeKey)) return;
    stepSeen.add(dedupeKey);
    steps.push({ ...step, order: steps.length + 1 });
  };

  const nodeLabel = (id: string) => {
    const n = getNodeById(doc, id);
    return n ? resolveNodeName(doc, n) : id;
  };

  // Case 1: Node-level quick trace (highlights node + connected trunks)
  if (target.type === 'node') {
    const node = getNodeById(doc, target.nodeId);
    if (!node) {
      return {
        target,
        title: 'Unknown Node',
        subtitle: '',
        activeNodeIds: [],
        activeTrunkIds: [],
        activeChannelIds: [],
        activeBusIds: [],
        steps: [],
      };
    }
    activeNodeIds.add(node.id);
    pushStep({
      nodeId: node.id,
      nodeLabel: resolveNodeName(doc, node),
      detail: `${node.model} (${resolveNodeZone(doc, node)})`,
      kind: node.kind === 'console' ? 'console' : 'source',
    });
    for (const trunk of doc.trunks) {
      if (trunk.sourceNodeId === node.id || trunk.targetNodeId === node.id) {
        activeTrunkIds.add(trunk.id);
        activeNodeIds.add(trunk.sourceNodeId);
        activeNodeIds.add(trunk.targetNodeId);
        const peerId = trunk.sourceNodeId === node.id ? trunk.targetNodeId : trunk.sourceNodeId;
        pushStep({
          nodeId: peerId,
          nodeLabel: nodeLabel(peerId),
          trunkId: trunk.id,
          trunkLabel: resolveTrunkName(doc, trunk),
          protocol: trunk.protocol,
          detail: `${resolveTrunkName(doc, trunk)} (${trunk.channels.length} fwd${trunk.returnChannels.length ? ` / ${trunk.returnChannels.length} ret` : ''})`,
          kind: 'trunk',
        });
      }
    }
    return {
      target,
      title: resolveNodeName(doc, node),
      subtitle: `Connected to ${activeTrunkIds.size} trunk${activeTrunkIds.size === 1 ? '' : 's'}`,
      activeNodeIds: [...activeNodeIds],
      activeTrunkIds: [...activeTrunkIds],
      activeChannelIds: [...activeChannelIds],
      activeBusIds: [...activeBusIds],
      steps,
    };
  }

  // Case 2: Mix Bus / Main / Matrix / Monitor Trace
  if (target.type === 'bus' && target.busKind && target.busIndex !== undefined) {
    const consoleNode = getNodeById(doc, target.nodeId);
    if (!consoleNode) {
      return {
        target,
        title: 'Unknown Bus',
        subtitle: '',
        activeNodeIds: [],
        activeTrunkIds: [],
        activeChannelIds: [],
        activeBusIds: [],
        steps: [],
      };
    }

    const bus = consoleNode.mixBuses.find(
      (b) => b.kind === target.busKind && b.index === target.busIndex,
    );
    const busDisplay = bus
      ? `${bus.kind.toUpperCase()} ${bus.index} · ${resolveBusName(doc, bus)}`
      : `${target.busKind.toUpperCase()} ${target.busIndex}`;

    activeNodeIds.add(consoleNode.id);
    if (bus) activeBusIds.add(bus.id);

    // 2a. Find upstream inputs feeding this bus on this console
    const feedingStrips = (consoleNode.channelStrips ?? []).filter((strip) => {
      if (target.busKind === 'bus') {
        return strip.busSends.some((s) => s.busKind === 'bus' && s.busIndex === target.busIndex);
      }
      if (target.busKind === 'main') {
        return strip.mainSends.includes(target.busIndex!);
      }
      return false;
    });

    const upstreamSources = new Set<string>();
    for (const strip of feedingStrips) {
      const grp = strip.sourceGroup as PortGroupCode;
      for (const pg of consoleNode.portGroups) {
        if (pg.code === grp && pg.direction !== 'output') {
          const ch = pg.channels.find((c) => c.slot === strip.sourceSlot);
          if (ch) activeChannelIds.add(ch.id);
        }
      }
      for (const trunk of doc.trunks) {
        const match = getTrunkChannelMatch(trunk, consoleNode.id, grp, strip.sourceSlot, 'in');
        if (match) {
          activeTrunkIds.add(trunk.id);
          activeNodeIds.add(match.peerNodeId);
          activeChannelIds.add(match.channel.id);
          upstreamSources.add(nodeLabel(match.peerNodeId));
        }
      }
    }

    if (feedingStrips.length > 0) {
      const sourceSummary =
        upstreamSources.size > 0
          ? `${feedingStrips.length} channels via ${[...upstreamSources].join(', ')}`
          : `${feedingStrips.length} console channels`;
      pushStep({
        nodeId: consoleNode.id,
        nodeLabel: [...upstreamSources][0] ?? resolveNodeName(doc, consoleNode),
        detail: `Fed by ${sourceSummary}`,
        kind: 'source',
      });
    }

    pushStep({
      nodeId: consoleNode.id,
      nodeLabel: resolveNodeName(doc, consoleNode),
      detail: `${busDisplay}${bus?.mono ? ' (Mono)' : ' (Stereo)'}`,
      kind: 'bus',
    });

    // 2b. Check Monitor indirection (e.g. MON.1 sourced from BUS.7)
    const indirectMons = consoleNode.mixBuses.filter(
      (b) =>
        b.kind === 'mon' &&
        b.monitorSource &&
        b.monitorSource.kind === target.busKind &&
        b.monitorSource.index === target.busIndex,
    );
    const busesToFollow: MixBusSummary[] = [];
    if (bus) busesToFollow.push(bus);
    for (const mon of indirectMons) {
      activeBusIds.add(mon.id);
      busesToFollow.push(mon);
      pushStep({
        nodeId: consoleNode.id,
        nodeLabel: resolveNodeName(doc, consoleNode),
        detail: `Monitor ${mon.index} taps ${busDisplay}`,
        kind: 'bus',
      });
    }

    // 2c. Walk downstream outputs from bus (and indirect monitor) across trunks
    for (const b of busesToFollow) {
      for (const out of b.outputs) {
        for (const pg of consoleNode.portGroups) {
          if (pg.code === out.group && pg.direction !== 'input') {
            const ch = pg.channels.find((c) => c.slot === out.slot);
            if (ch) activeChannelIds.add(ch.id);
          }
        }
        for (const trunk of doc.trunks) {
          const match = getTrunkChannelMatch(trunk, consoleNode.id, out.group, out.slot, 'out');
          if (match) {
            activeTrunkIds.add(trunk.id);
            activeNodeIds.add(match.peerNodeId);
            activeChannelIds.add(match.channel.id);
            pushStep({
              nodeId: match.peerNodeId,
              nodeLabel: nodeLabel(match.peerNodeId),
              trunkId: trunk.id,
              trunkLabel: resolveTrunkName(doc, trunk),
              protocol: trunk.protocol,
              detail: `${resolveTrunkName(doc, trunk)} Ch ${out.slot}${out.stereoSide ? ` (${out.stereoSide})` : ''} → ${nodeLabel(match.peerNodeId)} Out ${out.slot}`,
              kind: 'destination',
            });
          }
        }
      }
    }

    return {
      target,
      title: busDisplay,
      subtitle: `${feedingStrips.length} sending ch · ${activeNodeIds.size} devices in path`,
      activeNodeIds: [...activeNodeIds],
      activeTrunkIds: [...activeTrunkIds],
      activeChannelIds: [...activeChannelIds],
      activeBusIds: [...activeBusIds],
      steps,
    };
  }

  // Case 3: Channel or Trunk-Channel end-to-end trace (direction-aware so in.A.1 never conflates with out.A.1)
  let seedNodeId = target.nodeId;
  let seedGroup = target.group;
  let seedSlot = target.slot;
  let seedDir: 'in' | 'out' | undefined = target.portDirection;
  let seedLabel = '';

  if (target.type === 'trunk-channel' && target.trunkId) {
    const trunk = doc.trunks.find((t) => t.id === target.trunkId);
    if (trunk) {
      activeTrunkIds.add(trunk.id);
      activeNodeIds.add(trunk.sourceNodeId);
      activeNodeIds.add(trunk.targetNodeId);
      const list = target.direction === 'return' ? trunk.returnChannels : trunk.channels;
      const ch = list.find((c) => c.id === target.channelId || c.slot === target.slot);
      if (ch) {
        activeChannelIds.add(ch.id);
        seedLabel = resolveChannelName(doc, ch);
        if (target.direction === 'return') {
          seedNodeId = trunk.sourceNodeId;
          seedGroup = trunk.sourcePortGroup;
          seedSlot = ch.slot;
          seedDir = 'in';
        } else {
          seedNodeId = trunk.targetNodeId;
          seedGroup = trunk.targetPortGroup;
          seedSlot = ch.slot;
          seedDir = 'in';
        }
      }
    }
  }

  // Infer direction from clicked channelId or matching portGroup if not explicitly provided
  const seedNode = getNodeById(doc, seedNodeId);
  if (seedNode && seedGroup && seedSlot !== undefined) {
    const matchingGroups = seedNode.portGroups.filter((pg) => {
      if (pg.code !== seedGroup) return false;
      if (seedDir === 'in') return pg.direction !== 'output';
      if (seedDir === 'out') return pg.direction !== 'input';
      return true;
    });

    // Prefer exact channelId match first
    let matchedPg = target.channelId
      ? matchingGroups.find((pg) => pg.channels.some((c) => c.id === target.channelId))
      : undefined;
    if (!matchedPg) {
      matchedPg = matchingGroups.find((pg) => pg.channels.some((c) => c.slot === seedSlot));
    }

    if (matchedPg) {
      if (!seedDir) {
        seedDir = matchedPg.direction === 'output' ? 'out' : 'in';
      }
      const ch = matchedPg.channels.find(
        (c) => (target.channelId && c.id === target.channelId) || c.slot === seedSlot,
      );
      if (ch) {
        activeChannelIds.add(ch.id);
        if (!seedLabel) seedLabel = resolveChannelName(doc, ch);
        if (
          seedDir === 'out' &&
          ch.sourceRef &&
          (ch.sourceRef.group === 'BUS' ||
            ch.sourceRef.group === 'MAIN' ||
            ch.sourceRef.group === 'MTX' ||
            ch.sourceRef.group === 'MON')
        ) {
          const busKindMap: Record<string, MixBusKind> = {
            BUS: 'bus',
            MAIN: 'main',
            MTX: 'mtx',
            MON: 'mon',
          };
          return traceSignal(doc, {
            type: 'bus',
            nodeId: ch.sourceRef.nodeId,
            busKind: busKindMap[ch.sourceRef.group],
            busIndex: ch.sourceRef.slot,
          });
        }
      }
    }
  }

  interface VisitKey {
    nodeId: string;
    group: PortGroupCode;
    slot: number;
    dir: 'in' | 'out';
  }

  const visited = new Set<string>();
  const queue: VisitKey[] = [];

  const enqueue = (nodeId: string, group: PortGroupCode, slot: number, dir: 'in' | 'out') => {
    const key = `${nodeId}:${dir}:${group}:${slot}`;
    if (visited.has(key)) return;
    visited.add(key);
    queue.push({ nodeId, group, slot, dir });
  };

  if (seedNodeId && seedGroup && seedSlot !== undefined) {
    enqueue(seedNodeId, seedGroup, seedSlot, seedDir ?? 'in');
  }
  if (target.channelId) {
    activeChannelIds.add(target.channelId);
  }

  const orderedUpstream: Array<Omit<TraceStep, 'order'>> = [];
  const orderedMiddle: Array<Omit<TraceStep, 'order'>> = [];
  const orderedDownstream: Array<Omit<TraceStep, 'order'>> = [];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const node = getNodeById(doc, cur.nodeId);
    if (!node) continue;
    activeNodeIds.add(node.id);

    // Highlight matching portGroup channel matching direction on this node
    for (const pg of node.portGroups) {
      if (pg.code !== cur.group) continue;
      const matchesDir =
        (cur.dir === 'in' && pg.direction !== 'output') ||
        (cur.dir === 'out' && pg.direction !== 'input');
      if (!matchesDir) continue;
      const ch = pg.channels.find((c) => c.slot === cur.slot);
      if (ch) {
        activeChannelIds.add(ch.id);
        if (!seedLabel) seedLabel = resolveChannelName(doc, ch);

        // If this is an output patched as a direct pass-through from an input on this node, walk upstream!
        if (
          cur.dir === 'out' &&
          ch.passthroughFrom &&
          ch.passthroughFrom.group !== 'BUS' &&
          ch.passthroughFrom.group !== 'MAIN' &&
          ch.passthroughFrom.group !== 'MTX' &&
          ch.passthroughFrom.group !== 'MON'
        ) {
          enqueue(
            ch.passthroughFrom.nodeId,
            ch.passthroughFrom.group as PortGroupCode,
            ch.passthroughFrom.slot,
            'in',
          );
        }
      }
    }

    if (cur.dir === 'in') {
      // Upstream: check trunks delivering INTO (node, cur.group, cur.slot)
      for (const trunk of doc.trunks) {
        const incoming = getTrunkChannelMatch(trunk, node.id, cur.group, cur.slot, 'in');
        if (incoming) {
          activeTrunkIds.add(trunk.id);
          activeChannelIds.add(incoming.channel.id);
          activeNodeIds.add(incoming.peerNodeId);
          if (!seedLabel) seedLabel = resolveChannelName(doc, incoming.channel);

          const peerNode = getNodeById(doc, incoming.peerNodeId);
          if (peerNode) {
            orderedUpstream.push({
              nodeId: peerNode.id,
              nodeLabel: resolveNodeName(doc, peerNode),
              detail: `${incoming.peerGroup} ${cur.slot} (${resolveChannelName(doc, incoming.channel)})`,
              kind: peerNode.kind === 'console' ? 'console' : 'source',
            });
          }
          orderedUpstream.push({
            nodeId: node.id,
            nodeLabel: resolveNodeName(doc, node),
            trunkId: trunk.id,
            trunkLabel: resolveTrunkName(doc, trunk),
            protocol: trunk.protocol,
            detail: `${resolveTrunkName(doc, trunk)} ${incoming.isReturn ? 'Return ' : ''}Ch ${cur.slot} → ${cur.group}.${cur.slot}`,
            kind: 'trunk',
          });

          enqueue(incoming.peerNodeId, incoming.peerGroup, cur.slot, 'out');
        }
      }

      // Console channel strips consuming this input
      if (node.kind === 'console' && node.channelStrips) {
        const strips = node.channelStrips.filter(
          (s) => s.sourceGroup === cur.group && s.sourceSlot === cur.slot,
        );
        for (const strip of strips) {
          const stripLabel = `${strip.kind.toUpperCase()} ${strip.index} (${strip.resolvedName})`;
          const busNames = strip.busSends.slice(0, 4).map((s) => {
            const b = node.mixBuses.find((mb) => mb.kind === s.busKind && mb.index === s.busIndex);
            return b ? resolveBusName(doc, b) : `${s.busKind.toUpperCase()} ${s.busIndex}`;
          });
          const extra = strip.busSends.length > 4 ? ` +${strip.busSends.length - 4} buses` : '';
          orderedMiddle.push({
            nodeId: node.id,
            nodeLabel: resolveNodeName(doc, node),
            detail: `${stripLabel}${busNames.length ? ` → sends to ${busNames.join(', ')}${extra}` : ''}`,
            kind: 'console',
          });
        }
      }

      // Downstream direct cross-trunk pass-through outputs on this same node (e.g., out.C.1 <- in.A.1 or out.A.16 <- in.C.48)
      for (const pg of node.portGroups) {
        if (pg.direction === 'input') continue;
        for (const outCh of pg.channels) {
          if (
            outCh.passthroughFrom &&
            outCh.passthroughFrom.nodeId === node.id &&
            outCh.passthroughFrom.group === cur.group &&
            outCh.passthroughFrom.slot === cur.slot
          ) {
            activeChannelIds.add(outCh.id);
            orderedDownstream.push({
              nodeId: node.id,
              nodeLabel: resolveNodeName(doc, node),
              detail: `Direct pass-through ${cur.group}.${cur.slot} → Out ${pg.code}.${outCh.slot}`,
              kind: 'passthrough',
            });
            enqueue(node.id, pg.code, outCh.slot, 'out');
          }
        }
      }
    } else {
      // cur.dir === 'out': Downstream trunks leaving FROM (node, cur.group, cur.slot)
      for (const trunk of doc.trunks) {
        const outgoing = getTrunkChannelMatch(trunk, node.id, cur.group, cur.slot, 'out');
        if (outgoing) {
          activeTrunkIds.add(trunk.id);
          activeChannelIds.add(outgoing.channel.id);
          activeNodeIds.add(outgoing.peerNodeId);
          const peerNode = getNodeById(doc, outgoing.peerNodeId);
          orderedDownstream.push({
            nodeId: outgoing.peerNodeId,
            nodeLabel: nodeLabel(outgoing.peerNodeId),
            trunkId: trunk.id,
            trunkLabel: resolveTrunkName(doc, trunk),
            protocol: trunk.protocol,
            detail: `${resolveTrunkName(doc, trunk)} ${outgoing.isReturn ? 'Return ' : ''}Ch ${cur.slot} → ${peerNode ? resolveNodeName(doc, peerNode) : outgoing.peerNodeId} ${outgoing.peerGroup}.${cur.slot}`,
            kind: peerNode?.kind === 'console' ? 'console' : 'destination',
          });
          enqueue(outgoing.peerNodeId, outgoing.peerGroup, cur.slot, 'in');
        }
      }
    }
  }

  for (const s of [...orderedUpstream, ...orderedMiddle, ...orderedDownstream]) {
    pushStep(s);
  }

  if (steps.length === 0 && seedNode) {
    pushStep({
      nodeId: seedNode.id,
      nodeLabel: resolveNodeName(doc, seedNode),
      detail: `${seedGroup ?? 'Port'} ${seedSlot ?? ''} · ${seedLabel || 'Signal'}`,
      kind: 'source',
    });
  }

  return {
    target,
    title: seedLabel || `${seedGroup ?? 'Ch'} ${seedSlot ?? ''}`,
    subtitle: `${activeNodeIds.size} device${activeNodeIds.size === 1 ? '' : 's'} · ${activeTrunkIds.size} trunk${activeTrunkIds.size === 1 ? '' : 's'}`,
    activeNodeIds: [...activeNodeIds],
    activeTrunkIds: [...activeTrunkIds],
    activeChannelIds: [...activeChannelIds],
    activeBusIds: [...activeBusIds],
    steps,
  };
}

export function searchRig(doc: RigDocument, rawQuery: string): SearchHit[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];

  const hits: SearchHit[] = [];
  const isPhantomSearch = q === '+48v' || q === '48v' || q === 'phantom';

  for (const node of doc.nodes) {
    const nName = resolveNodeName(doc, node);
    const nNotes = doc.annotations.nodes[node.id]?.notes ?? '';
    if (
      nName.toLowerCase().includes(q) ||
      node.rawName.toLowerCase().includes(q) ||
      node.model.toLowerCase().includes(q) ||
      resolveNodeZone(doc, node).toLowerCase().includes(q) ||
      nNotes.toLowerCase().includes(q)
    ) {
      hits.push({
        id: `node:${node.id}`,
        kind: 'node',
        label: nName,
        sublabel: `${node.model} · ${resolveNodeZone(doc, node)}`,
        badge: node.kind.toUpperCase(),
        nodeId: node.id,
        traceTarget: { type: 'node', nodeId: node.id },
      });
    }

    for (const bus of node.mixBuses) {
      const bName = resolveBusName(doc, bus);
      const bNotes = doc.annotations.buses[bus.id]?.notes ?? '';
      if (
        bName.toLowerCase().includes(q) ||
        `${bus.kind} ${bus.index}`.includes(q) ||
        bNotes.toLowerCase().includes(q)
      ) {
        hits.push({
          id: `bus:${bus.id}`,
          kind: 'bus',
          label: bName,
          sublabel: `${nName} · ${bus.kind.toUpperCase()} ${bus.index}${bus.mono ? ' (Mono)' : ' (Stereo)'}`,
          badge: bus.kind.toUpperCase(),
          nodeId: node.id,
          traceTarget: {
            type: 'bus',
            nodeId: node.id,
            busKind: bus.kind,
            busIndex: bus.index,
            busId: bus.id,
          },
        });
      }
    }

    for (const pg of node.portGroups) {
      for (const ch of pg.channels) {
        const chName = resolveChannelName(doc, ch);
        const chAnn = doc.annotations.channels[ch.id];
        const matches =
          (isPhantomSearch && ch.phantom48v) ||
          chName.toLowerCase().includes(q) ||
          ch.rawName.toLowerCase().includes(q) ||
          (ch.consoleChannel?.toLowerCase().includes(q) ?? false) ||
          (ch.routeLabel?.toLowerCase().includes(q) ?? false) ||
          (chAnn?.cableTag?.toLowerCase().includes(q) ?? false) ||
          (chAnn?.notes?.toLowerCase().includes(q) ?? false) ||
          `${pg.code.toLowerCase()}.${ch.slot}` === q;

        if (matches) {
          hits.push({
            id: `ch:${ch.id}`,
            kind: 'channel',
            label: chName,
            sublabel: `${nName} · ${pg.label} ${ch.slot}${ch.consoleChannel ? ` (${ch.consoleChannel})` : ''}`,
            badge: ch.phantom48v ? '+48V' : ch.mode === 'ST' ? 'ST' : pg.code,
            nodeId: node.id,
            traceTarget: {
              type: 'channel',
              nodeId: node.id,
              portDirection: pg.direction === 'output' ? 'out' : 'in',
              group: pg.code,
              slot: ch.slot,
              channelId: ch.id,
            },
          });
        }
      }
    }
  }

  for (const trunk of doc.trunks) {
    const tName = resolveTrunkName(doc, trunk);
    const cableTag = resolveTrunkCableTag(doc, trunk) ?? '';
    const tNotes = doc.annotations.trunks[trunk.id]?.notes ?? '';
    if (
      tName.toLowerCase().includes(q) ||
      trunk.protocol.toLowerCase().includes(q) ||
      cableTag.toLowerCase().includes(q) ||
      tNotes.toLowerCase().includes(q)
    ) {
      hits.push({
        id: `trunk:${trunk.id}`,
        kind: 'trunk',
        label: tName,
        sublabel: `${PROTOCOL_META[trunk.protocol].shortLabel}${cableTag ? ` · ${cableTag}` : ''} · ${trunk.channels.length} fwd / ${trunk.returnChannels.length} ret`,
        badge: PROTOCOL_META[trunk.protocol].shortLabel,
        nodeId: trunk.sourceNodeId,
        trunkId: trunk.id,
        traceTarget: {
          type: 'trunk-channel',
          nodeId: trunk.sourceNodeId,
          trunkId: trunk.id,
          direction: 'forward',
          slot: trunk.channels[0]?.slot ?? 1,
          channelId: trunk.channels[0]?.id,
        },
      });
    }
  }

  return hits.slice(0, 30);
}

export { busKindToGroup };
