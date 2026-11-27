import type {
  ChannelPatch,
  ConsoleChannelStrip,
  HardwareNode,
  MixBusKind,
  MixBusSummary,
  PortGroup,
  PortGroupCode,
  RigDocument,
  RigZone,
  TrunkConnection,
  TrunkProtocol,
} from '../../schema/rig';
import {
  resolveChannelName,
  resolveNodeName,
  resolveNodeZone,
  resolveTrunkName,
} from '../../schema/helpers';

export type InspectorFacet = '48v' | 'passthrough' | 'notes' | 'unpatched' | 'vacant' | 'traced';

export interface InspectorChannelRow {
  key: string;
  slot: number;
  primary?: ChannelPatch;
  partner?: ChannelPatch;
  isVacant: boolean;
  isStereoPair: boolean;
  slotLabel: string;
  displayName: string;
  rawBaseName: string;
  phantom48v: boolean;
  polarityInverted: boolean;
  muted: boolean;
  isPassthrough: boolean;
  /** True for a console input slot that feeds neither a console strip nor a direct cross-trunk pass-through */
  isUnpatchedInput: boolean;
  hasAnnotation: boolean;
  routeSummary?: string;
  channelIds: string[];
}

export interface InspectorStripRow {
  key: string;
  kind: 'ch' | 'aux';
  index: number;
  isVacant: boolean;
  strip?: ConsoleChannelStrip;
  source: { portGroup: PortGroup; channel: ChannelPatch } | null;
}

export interface InspectorBusRow {
  key: string;
  kind: MixBusKind;
  index: number;
  isVacant: boolean;
  bus?: MixBusSummary;
}

export interface CollapsedBusOutput {
  key: string;
  group: PortGroupCode;
  label: string;
  startSlot: number;
  endSlot?: number;
  isStereoPair: boolean;
  trunkId?: string;
}

export interface ConnectedTrunkChip {
  trunk: TrunkConnection;
  name: string;
  protocol: TrunkProtocol;
  portCode: PortGroupCode;
  directionArrow: '↔' | '→' | '←';
  peerNodeId: string;
  peerName: string;
  countSummary: string;
}

export const ZONE_ORDER: RigZone[] = [
  'Stage',
  'Stage Rack',
  'FOH Booth',
  'Amp Vault',
  'Broadcast',
  'Custom',
];

/** Verified Behringer WING console capacities */
export const WING_STRIP_CAPACITIES: Record<'ch' | 'aux', number> = {
  ch: 40,
  aux: 8,
};

export const WING_BUS_CAPACITIES: Record<MixBusKind, number> = {
  bus: 16,
  mtx: 8,
  main: 4,
  mon: 2,
};

const PROTOCOL_DEFAULT_CAPACITY: Partial<Record<TrunkProtocol, number>> = {
  aes50: 48,
  stageconnect: 32,
  dante: 64,
  usb: 48,
};

export function stripStereoSuffix(name: string): string {
  return name.replace(/\s+(L|R|Left|Right)$/i, '').trim();
}

export function padSlot(slot: number): string {
  return String(slot).padStart(2, '0');
}

function isStereoPairAdjacent(
  rig: RigDocument,
  cur: ChannelPatch,
  next: ChannelPatch | undefined,
): boolean {
  if (!next || next.slot !== cur.slot + 1) return false;
  if (cur.mode === 'ST' && cur.stereoSide === 'L' && next.mode === 'ST' && next.stereoSide === 'R') {
    return true;
  }
  const curName = resolveChannelName(rig, cur);
  const nextName = resolveChannelName(rig, next);
  return (
    /\s+L$/i.test(curName) &&
    /\s+R$/i.test(nextName) &&
    stripStereoSuffix(curName).toLowerCase() === stripStereoSuffix(nextName).toLowerCase()
  );
}

/**
 * Builds a Set of input keys (`${group}:${slot}`) on a console node that are directly
 * forwarded out via cross-trunk pass-through outputs (e.g., Stage A.1 -> C.1 split, or C.48 -> A.16 Sub).
 */
export function buildNodePassthroughInputSet(node: HardwareNode): Set<string> {
  const set = new Set<string>();
  for (const pg of node.portGroups) {
    if (pg.direction === 'input') continue;
    for (const ch of pg.channels) {
      if (ch.passthroughFrom && ch.passthroughFrom.nodeId === node.id) {
        set.add(`${ch.passthroughFrom.group}:${ch.passthroughFrom.slot}`);
      }
    }
  }
  return set;
}

function mergeStereoRouteSummary(primaryRoute?: string, partnerRoute?: string): string | undefined {
  if (!primaryRoute) return partnerRoute;
  if (!partnerRoute) return primaryRoute;
  if (primaryRoute === partnerRoute) return primaryRoute;
  // Turn "Bus 5 L (Drums)" + "Bus 5 R (Drums)" into "Bus 5 L/R (Drums)"
  if (/\bL\b/.test(primaryRoute) && /\bR\b/.test(partnerRoute)) {
    const merged = primaryRoute.replace(/\bL\b/, 'L/R');
    if (primaryRoute.replace(/\bL\b/, 'R') === partnerRoute) {
      return merged;
    }
  }
  return primaryRoute;
}

function makeVacantRow(slot: number, keyPrefix: string): InspectorChannelRow {
  return {
    key: `${keyPrefix}:vacant:${slot}`,
    slot,
    isVacant: true,
    isStereoPair: false,
    slotLabel: padSlot(slot),
    displayName: 'Vacant',
    rawBaseName: '',
    phantom48v: false,
    polarityInverted: false,
    muted: false,
    isPassthrough: false,
    isUnpatchedInput: false,
    hasAnnotation: false,
    channelIds: [],
  };
}

/**
 * Normalizes a list of ChannelPatch slots into scannable InspectorChannelRow items,
 * optionally collapsing adjacent Stereo L/R pairs and interleaving vacant slots up to `capacity`.
 */
export function groupInspectorChannels(
  rig: RigDocument,
  channels: ChannelPatch[],
  options: {
    groupStereo: boolean;
    includeVacant?: boolean;
    capacity?: number;
    keyPrefix?: string;
    isConsoleInput?: boolean;
    portCode?: PortGroupCode;
    passthroughInputKeys?: Set<string>;
  },
): InspectorChannelRow[] {
  const sorted = [...channels].sort((a, b) => a.slot - b.slot);
  const occupiedRows: InspectorChannelRow[] = [];
  const occupiedSlots = new Set<number>();
  const {
    groupStereo,
    includeVacant = false,
    capacity = 0,
    keyPrefix = 'slot',
    isConsoleInput = false,
    portCode,
    passthroughInputKeys,
  } = options;

  let i = 0;
  while (i < sorted.length) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const prev = sorted[i - 1];
    const curAnn = rig.annotations.channels[cur.id];
    const curName = resolveChannelName(rig, cur);

    const canPair = groupStereo && isStereoPairAdjacent(rig, cur, next);

    if (canPair && next) {
      const nextAnn = rig.annotations.channels[next.id];
      const baseName = stripStereoSuffix(curName) || curName;
      const rawBaseName = stripStereoSuffix(cur.rawName) || cur.rawName;
      const curPassed =
        Boolean(cur.passthroughFrom) ||
        Boolean(portCode && passthroughInputKeys?.has(`${portCode}:${cur.slot}`));
      const nextPassed =
        Boolean(next.passthroughFrom) ||
        Boolean(portCode && passthroughInputKeys?.has(`${portCode}:${next.slot}`));
      const isPassthrough = curPassed || nextPassed;
      const hasStrip = Boolean(cur.consoleChannel || next.consoleChannel);
      const isUnpatchedInput = isConsoleInput && !hasStrip && !isPassthrough;

      occupiedSlots.add(cur.slot);
      occupiedSlots.add(next.slot);
      occupiedRows.push({
        key: `${cur.id}+${next.id}`,
        slot: cur.slot,
        primary: cur,
        partner: next,
        isVacant: false,
        isStereoPair: true,
        slotLabel: `${padSlot(cur.slot)}–${padSlot(next.slot)}`,
        displayName: baseName,
        rawBaseName,
        phantom48v: Boolean(cur.phantom48v || next.phantom48v),
        polarityInverted: Boolean(cur.polarityInverted || next.polarityInverted),
        muted: Boolean(cur.muted || next.muted),
        isPassthrough,
        isUnpatchedInput,
        hasAnnotation: Boolean(
          curAnn?.friendlyName ||
            curAnn?.cableTag ||
            curAnn?.notes ||
            nextAnn?.friendlyName ||
            nextAnn?.cableTag ||
            nextAnn?.notes,
        ),
        routeSummary: mergeStereoRouteSummary(cur.routeLabel, next.routeLabel),
        channelIds: [cur.id, next.id],
      });
      i += 2;
    } else {
      const isPassthrough =
        Boolean(cur.passthroughFrom) ||
        Boolean(portCode && passthroughInputKeys?.has(`${portCode}:${cur.slot}`));

      // When stereo grouping is OFF, don't falsely flag the R half of a patched stereo pair as unpatched
      const isStereoPartnerOfPatched =
        cur.mode === 'ST' &&
        cur.stereoSide === 'R' &&
        Boolean(prev && prev.slot === cur.slot - 1 && prev.mode === 'ST' && prev.consoleChannel);

      const isUnpatchedInput =
        isConsoleInput && !cur.consoleChannel && !isPassthrough && !isStereoPartnerOfPatched;

      occupiedSlots.add(cur.slot);
      occupiedRows.push({
        key: cur.id,
        slot: cur.slot,
        primary: cur,
        isVacant: false,
        isStereoPair: false,
        slotLabel: padSlot(cur.slot),
        displayName: curName,
        rawBaseName: cur.rawName,
        phantom48v: Boolean(cur.phantom48v),
        polarityInverted: Boolean(cur.polarityInverted),
        muted: Boolean(cur.muted),
        isPassthrough,
        isUnpatchedInput,
        hasAnnotation: Boolean(curAnn?.friendlyName || curAnn?.cableTag || curAnn?.notes),
        routeSummary: cur.routeLabel,
        channelIds: [cur.id],
      });
      i += 1;
    }
  }

  if (!includeVacant || capacity <= 0) {
    return occupiedRows;
  }

  // Guard against outlier single-slot pass-through groups (e.g. capacity 2 with only slot 16)
  const hasAnyInRange = sorted.length === 0 || sorted.some((c) => c.slot <= capacity);
  if (!hasAnyInRange) {
    return occupiedRows;
  }

  const combined: InspectorChannelRow[] = [...occupiedRows];
  for (let slot = 1; slot <= capacity; slot++) {
    if (!occupiedSlots.has(slot)) {
      combined.push(makeVacantRow(slot, keyPrefix));
    }
  }
  combined.sort((a, b) => a.slot - b.slot);
  return combined;
}

/**
 * Resolves the usable lane capacity for a trunk in either forward or return direction,
 * intersecting endpoint PortGroup capacities when both endpoints declare them.
 */
export function resolveTrunkDirectionCapacity(
  rig: RigDocument,
  trunk: TrunkConnection,
  direction: 'forward' | 'return',
): number {
  const activeList = direction === 'return' ? trunk.returnChannels : trunk.channels;
  const maxOccupied = activeList.reduce((max, c) => Math.max(max, c.slot), 0);

  const srcNodeId = direction === 'return' ? trunk.targetNodeId : trunk.sourceNodeId;
  const srcGroup = direction === 'return' ? trunk.targetPortGroup : trunk.sourcePortGroup;
  const tgtNodeId = direction === 'return' ? trunk.sourceNodeId : trunk.targetNodeId;
  const tgtGroup = direction === 'return' ? trunk.sourcePortGroup : trunk.targetPortGroup;

  const srcNode = rig.nodes.find((n) => n.id === srcNodeId);
  const tgtNode = rig.nodes.find((n) => n.id === tgtNodeId);

  const srcPg = srcNode?.portGroups.find(
    (pg) => pg.code === srcGroup && pg.direction !== 'input' && pg.capacity > 0,
  );
  const tgtPg = tgtNode?.portGroups.find(
    (pg) => pg.code === tgtGroup && pg.direction !== 'output' && pg.capacity > 0,
  );

  let inferred = 0;
  if (srcPg && tgtPg) {
    inferred = Math.min(srcPg.capacity, tgtPg.capacity);
  } else if (srcPg) {
    inferred = srcPg.capacity;
  } else if (tgtPg) {
    inferred = tgtPg.capacity;
  } else {
    inferred = PROTOCOL_DEFAULT_CAPACITY[trunk.protocol] ?? 0;
  }

  return Math.max(inferred, maxOccupied);
}

/**
 * Builds the full Console Strip list (`CH 1..40`, `AUX 1..8`) optionally including vacant strips.
 */
export function buildConsoleStripRows(
  node: HardwareNode,
  options: { includeVacant: boolean },
): InspectorStripRow[] {
  const strips = node.channelStrips ?? [];
  const byKey = new Map<string, ConsoleChannelStrip>();
  for (const s of strips) {
    byKey.set(`${s.kind}:${s.index}`, s);
  }

  const rows: InspectorStripRow[] = [];

  if (!options.includeVacant) {
    for (const strip of strips) {
      rows.push({
        key: strip.id,
        kind: strip.kind,
        index: strip.index,
        isVacant: false,
        strip,
        source: findStripSourceChannel(node, strip),
      });
    }
    return rows;
  }

  const chCap = Math.max(
    WING_STRIP_CAPACITIES.ch,
    ...strips.filter((s) => s.kind === 'ch').map((s) => s.index),
  );
  const auxCap = Math.max(
    WING_STRIP_CAPACITIES.aux,
    ...strips.filter((s) => s.kind === 'aux').map((s) => s.index),
  );

  for (let idx = 1; idx <= chCap; idx++) {
    const strip = byKey.get(`ch:${idx}`);
    rows.push(
      strip
        ? {
            key: strip.id,
            kind: 'ch',
            index: idx,
            isVacant: false,
            strip,
            source: findStripSourceChannel(node, strip),
          }
        : {
            key: `${node.id}:strip:ch:vacant:${idx}`,
            kind: 'ch',
            index: idx,
            isVacant: true,
            source: null,
          },
    );
  }

  for (let idx = 1; idx <= auxCap; idx++) {
    const strip = byKey.get(`aux:${idx}`);
    rows.push(
      strip
        ? {
            key: strip.id,
            kind: 'aux',
            index: idx,
            isVacant: false,
            strip,
            source: findStripSourceChannel(node, strip),
          }
        : {
            key: `${node.id}:strip:aux:vacant:${idx}`,
            kind: 'aux',
            index: idx,
            isVacant: true,
            source: null,
          },
    );
  }

  return rows;
}

/**
 * Builds the full Mix Bus list (`BUS 1..16`, `MTX 1..8`, `MAIN 1..4`, `MON 1..2`),
 * optionally including vacant slots on WING consoles.
 */
export function buildConsoleBusRows(
  node: HardwareNode,
  options: { includeVacant: boolean },
): InspectorBusRow[] {
  const byKey = new Map<string, MixBusSummary>();
  for (const b of node.mixBuses) {
    byKey.set(`${b.kind}:${b.index}`, b);
  }

  if (!options.includeVacant || node.kind !== 'console') {
    return node.mixBuses.map((bus) => ({
      key: bus.id,
      kind: bus.kind,
      index: bus.index,
      isVacant: false,
      bus,
    }));
  }

  const kinds: MixBusKind[] = ['bus', 'mtx', 'main', 'mon'];
  const rows: InspectorBusRow[] = [];

  for (const kind of kinds) {
    const cap = Math.max(
      WING_BUS_CAPACITIES[kind],
      ...node.mixBuses.filter((b) => b.kind === kind).map((b) => b.index),
    );
    for (let idx = 1; idx <= cap; idx++) {
      const bus = byKey.get(`${kind}:${idx}`);
      rows.push(
        bus
          ? {
              key: bus.id,
              kind,
              index: idx,
              isVacant: false,
              bus,
            }
          : {
              key: `${node.id}:${kind}:vacant:${idx}`,
              kind,
              index: idx,
              isVacant: true,
            },
      );
    }
  }

  return rows;
}

export function filterInspectorRows(
  rig: RigDocument,
  rows: InspectorChannelRow[],
  options: {
    query: string;
    facet: InspectorFacet | null;
    tracedChannelIds: Set<string>;
  },
): InspectorChannelRow[] {
  const { facet, tracedChannelIds } = options;
  const q = options.query.trim().toLowerCase();
  const isPhantomQuery = q === '+48v' || q === '48v' || q === 'phantom';
  const isVacantQuery = q === 'vacant' || q === 'unused' || q === 'open' || q === 'empty';

  return rows.filter((row) => {
    if (facet === 'vacant') {
      if (!row.isVacant) return false;
    } else if (facet === '48v') {
      if (!row.phantom48v) return false;
    } else if (facet === 'passthrough') {
      if (!row.isPassthrough) return false;
    } else if (facet === 'notes') {
      if (!row.hasAnnotation) return false;
    } else if (facet === 'unpatched') {
      if (!row.isUnpatchedInput) return false;
    } else if (facet === 'traced') {
      if (!row.channelIds.some((id) => tracedChannelIds.has(id))) return false;
    }

    if (!q) return true;

    if (row.isVacant) {
      return (
        isVacantQuery ||
        'vacant'.includes(q) ||
        'unused'.includes(q) ||
        'open'.includes(q) ||
        String(row.slot) === q ||
        row.slotLabel.includes(q)
      );
    }

    if (isPhantomQuery && row.phantom48v) return true;

    const p = row.primary!;
    const partner = row.partner;
    const pAnn = rig.annotations.channels[p.id];
    const partnerAnn = partner ? rig.annotations.channels[partner.id] : undefined;

    return (
      row.displayName.toLowerCase().includes(q) ||
      row.rawBaseName.toLowerCase().includes(q) ||
      String(p.slot) === q ||
      (partner !== undefined && String(partner.slot) === q) ||
      row.slotLabel.toLowerCase().includes(q) ||
      (q.includes('48') && row.phantom48v) ||
      (p.consoleChannel?.toLowerCase().includes(q) ?? false) ||
      (p.channelStripName?.toLowerCase().includes(q) ?? false) ||
      (row.routeSummary?.toLowerCase().includes(q) ?? false) ||
      (pAnn?.cableTag?.toLowerCase().includes(q) ?? false) ||
      (pAnn?.notes?.toLowerCase().includes(q) ?? false) ||
      (partnerAnn?.cableTag?.toLowerCase().includes(q) ?? false) ||
      (partnerAnn?.notes?.toLowerCase().includes(q) ?? false)
    );
  });
}

/**
 * Collapses adjacent stereo L/R outputs on the same port group into crisp badges (e.g., `LCL.1–2 (ST)`).
 */
export function collapseBusOutputs(outputs: MixBusSummary['outputs']): CollapsedBusOutput[] {
  const sorted = [...outputs].sort((a, b) =>
    a.group === b.group ? a.slot - b.slot : a.group.localeCompare(b.group),
  );
  const result: CollapsedBusOutput[] = [];
  let i = 0;
  while (i < sorted.length) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (
      next &&
      next.group === cur.group &&
      next.slot === cur.slot + 1 &&
      cur.stereoSide === 'L' &&
      next.stereoSide === 'R'
    ) {
      result.push({
        key: `${cur.group}-${cur.slot}-${next.slot}`,
        group: cur.group,
        label: `${cur.group}.${cur.slot}–${next.slot} (ST)`,
        startSlot: cur.slot,
        endSlot: next.slot,
        isStereoPair: true,
        trunkId: cur.trunkId ?? next.trunkId,
      });
      i += 2;
    } else {
      result.push({
        key: `${cur.group}-${cur.slot}`,
        group: cur.group,
        label: `${cur.group}.${cur.slot}${cur.stereoSide ? ` (${cur.stereoSide})` : ''}`,
        startSlot: cur.slot,
        isStereoPair: false,
        trunkId: cur.trunkId,
      });
      i += 1;
    }
  }
  return result;
}

export function countBusSenders(node: HardwareNode, bus: MixBusSummary): number {
  const strips = node.channelStrips ?? [];
  if (bus.kind === 'bus') {
    return strips.filter((s) =>
      s.busSends.some((send) => send.busKind === 'bus' && send.busIndex === bus.index),
    ).length;
  }
  if (bus.kind === 'main') {
    return strips.filter((s) => s.mainSends.includes(bus.index)).length;
  }
  return 0;
}

export function findIndirectMonitorsForBus(
  node: HardwareNode,
  bus: MixBusSummary,
): MixBusSummary[] {
  return node.mixBuses.filter(
    (b) =>
      b.kind === 'mon' &&
      b.monitorSource &&
      b.monitorSource.kind === bus.kind &&
      b.monitorSource.index === bus.index,
  );
}

/**
 * Finds the matching input ChannelPatch on a console node for a given ConsoleChannelStrip,
 * so the Strips tab can display preamp gain, +48V, and stereo info without duplicating data.
 */
export function findStripSourceChannel(
  node: HardwareNode,
  strip: ConsoleChannelStrip,
): { portGroup: PortGroup; channel: ChannelPatch } | null {
  for (const pg of node.portGroups) {
    if (pg.direction === 'output' || pg.code !== strip.sourceGroup) continue;
    const ch = pg.channels.find((c) => c.slot === strip.sourceSlot);
    if (ch) return { portGroup: pg, channel: ch };
  }
  return null;
}

export function getConnectedTrunkChips(
  rig: RigDocument,
  node: HardwareNode,
): ConnectedTrunkChip[] {
  return rig.trunks
    .filter((t) => t.sourceNodeId === node.id || t.targetNodeId === node.id)
    .map((trunk) => {
      const isSource = trunk.sourceNodeId === node.id;
      const peerNodeId = isSource ? trunk.targetNodeId : trunk.sourceNodeId;
      const peerNode = rig.nodes.find((n) => n.id === peerNodeId);
      const portCode = isSource ? trunk.sourcePortGroup : trunk.targetPortGroup;
      const hasReturn = trunk.returnChannels.length > 0;
      const directionArrow: '↔' | '→' | '←' = hasReturn ? '↔' : isSource ? '→' : '←';
      const countSummary = hasReturn
        ? `${trunk.channels.length}/${trunk.returnChannels.length}`
        : String(trunk.channels.length);

      return {
        trunk,
        name: resolveTrunkName(rig, trunk),
        protocol: trunk.protocol,
        portCode,
        directionArrow,
        peerNodeId,
        peerName: peerNode ? resolveNodeName(rig, peerNode) : peerNodeId,
        countSummary,
      };
    });
}

export function groupNodesByZone(
  rig: RigDocument,
  nodes: HardwareNode[],
): Array<{ zone: RigZone; nodes: HardwareNode[] }> {
  const byZone = new Map<RigZone, HardwareNode[]>();
  for (const node of nodes) {
    const zone = resolveNodeZone(rig, node);
    const list = byZone.get(zone) ?? [];
    list.push(node);
    byZone.set(zone, list);
  }
  const ordered: Array<{ zone: RigZone; nodes: HardwareNode[] }> = [];
  for (const zone of ZONE_ORDER) {
    const list = byZone.get(zone);
    if (list && list.length > 0) {
      ordered.push({ zone, nodes: list });
    }
  }
  return ordered;
}

/** Shortens a long device name cleanly for narrow trunk direction tabs (e.g. "Midas DL32 Stage Box" -> "Midas DL32"). */
export function compactNodeTabLabel(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 16) return trimmed;
  const noParen = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (noParen.length <= 18) return noParen;
  return `${noParen.slice(0, 16).trimEnd()}…`;
}

export function countRigPhantomChannels(rig: RigDocument): number {
  let count = 0;
  for (const node of rig.nodes) {
    if (node.kind !== 'console') continue;
    for (const pg of node.portGroups) {
      if (pg.direction === 'output') continue;
      for (const ch of pg.channels) {
        if (ch.phantom48v) count += 1;
      }
    }
  }
  return count;
}
