import type {
  ChannelPatch,
  ConsoleChannelStrip,
  HardwareNode,
  MixBusSummary,
  PortGroup,
  PortGroupCode,
  RigDocument,
  TraceTarget,
} from '../schema/rig';
import {
  formatGain,
  resolveBusName,
  resolveChannelName,
  resolveNodeName,
  resolveTrunkCableTag,
  resolveTrunkName,
} from '../schema/helpers';

export type DiffCategory =
  | 'physical'
  | 'phantom'
  | 'splits'
  | 'strips'
  | 'buses'
  | 'hardware';

export type DiffChangeType = 'added' | 'removed' | 'moved' | 'modified';

export type DiffSeverity = 'safety' | 'action' | 'info';

export interface RigDiffItem {
  id: string;
  category: DiffCategory;
  changeType: DiffChangeType;
  severity: DiffSeverity;
  title: string;
  detail: string;
  nodeId?: string;
  nodeName?: string;
  location: string;
  beforeValue?: string;
  afterValue?: string;
  cableTag?: string;
  notes?: string;
  traceTarget?: TraceTarget;
}

export type DeltaStepSectionKey = 'physical' | 'safety' | 'console';

export interface DeltaChecklistItem {
  id: string;
  section: DeltaStepSectionKey;
  actionType: 'unplug' | 'move' | 'plug' | 'relabel' | 'phantom-on' | 'phantom-off' | 'preamp' | 'hardware' | 'console-load' | 'verify';
  headline: string;
  detail: string;
  location: string;
  cableTag?: string;
  notes?: string;
  critical?: boolean;
  traceTarget?: TraceTarget;
}

export interface DeltaChecklistSection {
  key: DeltaStepSectionKey;
  title: string;
  subtitle: string;
  items: DeltaChecklistItem[];
}

export interface RigDiffResult {
  beforeLabel: string;
  afterLabel: string;
  totalChanges: number;
  counts: Record<DiffCategory, number>;
  items: RigDiffItem[];
  checklist: DeltaChecklistSection[];
  affectedConsoleIds: string[];
}

const PHYSICAL_PORT_CODES = new Set<PortGroupCode>(['LCL', 'AUX', 'ANALOG', 'A', 'B', 'SC']);
const DIGITAL_SPLIT_CODES = new Set<PortGroupCode>(['C', 'B', 'A', 'SC', 'MOD', 'DANTE', 'USB', 'CRD', 'AES', 'NETWORK']);

function isPhysicalPort(node: HardwareNode, pg: PortGroup): boolean {
  if (node.kind === 'stagebox' || node.kind === 'wireless' || node.kind === 'iem' || node.kind === 'amp' || node.kind === 'media' || node.kind === 'external') {
    return true;
  }
  // On a console, Local XLR, Aux TRS, and Stagebox AES50-A preamps represent physical stage/rack connections
  return PHYSICAL_PORT_CODES.has(pg.code) && (pg.code === 'LCL' || pg.code === 'AUX' || pg.code === 'ANALOG' || pg.code === 'A');
}

function normalizeLabelForMatch(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function formatStripSource(strip: ConsoleChannelStrip): string {
  if (!strip.sourceGroup || strip.sourceGroup === 'OFF' || strip.sourceSlot <= 0) {
    return 'OFF';
  }
  return `${strip.sourceGroup}.${strip.sourceSlot}`;
}

function formatBusOutputs(bus: MixBusSummary): string {
  if (bus.outputs.length === 0) return 'Unrouted';
  return bus.outputs
    .map((o) => `${o.group}.${o.slot}${o.stereoSide ? ` (${o.stereoSide})` : ''}`)
    .join(', ');
}

function formatChannelMeta(ch: ChannelPatch): string {
  const parts: string[] = [];
  parts.push(ch.mode === 'ST' ? `ST${ch.stereoSide ? ` ${ch.stereoSide}` : ''}` : 'M');
  if (ch.gainDb !== undefined) parts.push(formatGain(ch.gainDb));
  if (ch.phantom48v) parts.push('+48V');
  if (ch.polarityInverted) parts.push('Ø');
  if (ch.muted) parts.push('MUTE');
  if (ch.routeLabel) parts.push(ch.routeLabel);
  return parts.join(' · ');
}

interface IndexedSlot {
  node: HardwareNode;
  pg: PortGroup;
  ch: ChannelPatch;
  name: string;
  cableTag?: string;
  notes?: string;
}

function buildSlotMap(rig: RigDocument): Map<string, IndexedSlot> {
  const map = new Map<string, IndexedSlot>();
  for (const node of rig.nodes) {
    for (const pg of node.portGroups) {
      for (const ch of pg.channels) {
        const key = `${node.id}|${pg.direction}|${pg.code}|${ch.slot}`;
        const ann = rig.annotations.channels[ch.id];
        map.set(key, {
          node,
          pg,
          ch,
          name: resolveChannelName(rig, ch),
          cableTag: ann?.cableTag,
          notes: ann?.notes,
        });
      }
    }
  }
  return map;
}

function buildStripMap(rig: RigDocument): Map<string, { node: HardwareNode; strip: ConsoleChannelStrip }> {
  const map = new Map<string, { node: HardwareNode; strip: ConsoleChannelStrip }>();
  for (const node of rig.nodes) {
    for (const strip of node.channelStrips ?? []) {
      map.set(`${node.id}|${strip.kind}|${strip.index}`, { node, strip });
    }
  }
  return map;
}

function buildBusMap(rig: RigDocument): Map<string, { node: HardwareNode; bus: MixBusSummary }> {
  const map = new Map<string, { node: HardwareNode; bus: MixBusSummary }>();
  for (const node of rig.nodes) {
    for (const bus of node.mixBuses) {
      map.set(`${node.id}|${bus.kind}|${bus.index}`, { node, bus });
    }
  }
  return map;
}

/**
 * Computes a deterministic, human-actionable diff between any two RigDocuments
 * and derives an ordered In-Person Physical Delta Checklist.
 */
export function computeRigDiff(
  beforeRig: RigDocument,
  afterRig: RigDocument,
  options?: {
    beforeLabel?: string;
    afterLabel?: string;
    consoleExportFileNames?: Record<string, string>;
  },
): RigDiffResult {
  const beforeLabel = options?.beforeLabel ?? beforeRig.name;
  const afterLabel = options?.afterLabel ?? afterRig.name;

  const items: RigDiffItem[] = [];
  const physicalChecklist: DeltaChecklistItem[] = [];
  const safetyChecklist: DeltaChecklistItem[] = [];
  const consoleChecklist: DeltaChecklistItem[] = [];
  const affectedConsoleIds = new Set<string>();

  // ---------------------------------------------------------------------------
  // 1. Hardware Devices & Trunks (Added / Removed / Cable Tag Changes)
  // ---------------------------------------------------------------------------
  const beforeNodes = new Map(beforeRig.nodes.map((n) => [n.id, n]));
  const afterNodes = new Map(afterRig.nodes.map((n) => [n.id, n]));

  for (const [id, node] of afterNodes) {
    if (!beforeNodes.has(id)) {
      const name = resolveNodeName(afterRig, node);
      const notes = afterRig.annotations.nodes[id]?.notes;
      items.push({
        id: `hw-add-${id}`,
        category: 'hardware',
        changeType: 'added',
        severity: 'action',
        title: `Add Hardware: ${name}`,
        detail: `${node.model} placed in ${node.zone}.`,
        nodeId: id,
        nodeName: name,
        location: node.zone,
        afterValue: `${name} (${node.model})`,
        notes,
        traceTarget: { type: 'node', nodeId: id },
      });
      physicalChecklist.push({
        id: `chk-hw-add-${id}`,
        section: 'physical',
        actionType: 'hardware',
        headline: `Set up ${name} (${node.model})`,
        detail: `Place in ${node.zone} and verify power/connections.`,
        location: node.zone,
        notes,
        traceTarget: { type: 'node', nodeId: id },
      });
    }
  }

  for (const [id, node] of beforeNodes) {
    if (!afterNodes.has(id)) {
      const name = resolveNodeName(beforeRig, node);
      items.push({
        id: `hw-rem-${id}`,
        category: 'hardware',
        changeType: 'removed',
        severity: 'action',
        title: `Remove Hardware: ${name}`,
        detail: `${node.model} removed from ${node.zone}.`,
        nodeId: id,
        nodeName: name,
        location: node.zone,
        beforeValue: `${name} (${node.model})`,
      });
      physicalChecklist.push({
        id: `chk-hw-rem-${id}`,
        section: 'physical',
        actionType: 'hardware',
        headline: `Disconnect / strike ${name}`,
        detail: `Remove ${node.model} from ${node.zone}.`,
        location: node.zone,
      });
    }
  }

  const beforeTrunks = new Map(beforeRig.trunks.map((t) => [t.id, t]));
  const afterTrunks = new Map(afterRig.trunks.map((t) => [t.id, t]));

  for (const [id, trunk] of afterTrunks) {
    const prev = beforeTrunks.get(id);
    const name = resolveTrunkName(afterRig, trunk);
    const tag = resolveTrunkCableTag(afterRig, trunk);
    const prevTag = prev ? resolveTrunkCableTag(beforeRig, prev) : undefined;
    const notes = afterRig.annotations.trunks[id]?.notes;
    const srcName = afterNodes.get(trunk.sourceNodeId)
      ? resolveNodeName(afterRig, afterNodes.get(trunk.sourceNodeId)!)
      : trunk.sourceNodeId;
    const tgtName = afterNodes.get(trunk.targetNodeId)
      ? resolveNodeName(afterRig, afterNodes.get(trunk.targetNodeId)!)
      : trunk.targetNodeId;
    const loc = `${srcName} (${trunk.sourcePortGroup}) ↔ ${tgtName} (${trunk.targetPortGroup})`;

    if (!prev) {
      items.push({
        id: `trunk-add-${id}`,
        category: 'hardware',
        changeType: 'added',
        severity: 'action',
        title: `Add Cable Trunk: ${name}`,
        detail: `Connect ${loc} (${trunk.protocol}).`,
        location: loc,
        afterValue: tag ? `${name} [${tag}]` : name,
        cableTag: tag,
        notes,
      });
      physicalChecklist.push({
        id: `chk-trunk-add-${id}`,
        section: 'physical',
        actionType: 'plug',
        headline: `Run trunk cable: ${name}`,
        detail: `Connect ${loc}.`,
        location: loc,
        cableTag: tag,
        notes,
      });
    } else if (tag !== prevTag) {
      items.push({
        id: `trunk-tag-${id}`,
        category: 'hardware',
        changeType: 'modified',
        severity: 'info',
        title: `Trunk Cable Tag Changed: ${name}`,
        detail: `Cable label updated on ${loc}.`,
        location: loc,
        beforeValue: prevTag || '(none)',
        afterValue: tag || '(none)',
        cableTag: tag,
      });
    }
  }

  for (const [id, trunk] of beforeTrunks) {
    if (!afterTrunks.has(id)) {
      const name = resolveTrunkName(beforeRig, trunk);
      const tag = resolveTrunkCableTag(beforeRig, trunk);
      items.push({
        id: `trunk-rem-${id}`,
        category: 'hardware',
        changeType: 'removed',
        severity: 'action',
        title: `Remove Cable Trunk: ${name}`,
        detail: `Trunk disconnected (${trunk.protocol}).`,
        location: `${trunk.sourcePortGroup} ↔ ${trunk.targetPortGroup}`,
        beforeValue: tag ? `${name} [${tag}]` : name,
        cableTag: tag,
      });
      physicalChecklist.push({
        id: `chk-trunk-rem-${id}`,
        section: 'physical',
        actionType: 'unplug',
        headline: `Disconnect trunk: ${name}`,
        detail: `Strike trunk cable (${trunk.protocol}).`,
        location: `${trunk.sourcePortGroup} ↔ ${trunk.targetPortGroup}`,
        cableTag: tag,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Port Group I/O Slots (with Move Detection + Physical vs Split Classification)
  // ---------------------------------------------------------------------------
  const beforeSlots = buildSlotMap(beforeRig);
  const afterSlots = buildSlotMap(afterRig);

  const removedSlots: Array<{ key: string; entry: IndexedSlot }> = [];
  const addedSlots: Array<{ key: string; entry: IndexedSlot }> = [];

  for (const [key, entry] of beforeSlots) {
    if (!afterSlots.has(key)) {
      removedSlots.push({ key, entry });
    }
  }
  for (const [key, entry] of afterSlots) {
    if (!beforeSlots.has(key)) {
      addedSlots.push({ key, entry });
    }
  }

  // Pair up obvious physical/port moves (same node + direction + normalized label)
  const matchedRemoved = new Set<string>();
  const matchedAdded = new Set<string>();

  for (const rem of removedSlots) {
    const remNorm = normalizeLabelForMatch(rem.entry.name);
    const remRawNorm = normalizeLabelForMatch(rem.entry.ch.rawName);
    if ((!remNorm || remNorm === 'off' || /^ch\s*\d+$/i.test(remNorm)) && !remRawNorm) continue;

    const match = addedSlots.find((add) => {
      if (
        matchedAdded.has(add.key) ||
        add.entry.node.id !== rem.entry.node.id ||
        add.entry.pg.direction !== rem.entry.pg.direction
      ) {
        return false;
      }
      const addNorm = normalizeLabelForMatch(add.entry.name);
      const addRawNorm = normalizeLabelForMatch(add.entry.ch.rawName);
      return (
        (remNorm.length > 0 && addNorm === remNorm) ||
        (remRawNorm.length > 0 && addRawNorm === remRawNorm)
      );
    });

    if (match) {
      matchedRemoved.add(rem.key);
      matchedAdded.add(match.key);
      const nodeName = resolveNodeName(afterRig, match.entry.node);
      const fromSlot = `${rem.entry.pg.code}.${rem.entry.ch.slot}`;
      const toSlot = `${match.entry.pg.code}.${match.entry.ch.slot}`;
      const physical = isPhysicalPort(match.entry.node, match.entry.pg);
      if (match.entry.node.kind === 'console') affectedConsoleIds.add(match.entry.node.id);

      const traceTarget: TraceTarget = {
        type: 'channel',
        nodeId: match.entry.node.id,
        portDirection: match.entry.pg.direction === 'output' ? 'out' : 'in',
        group: match.entry.pg.code,
        slot: match.entry.ch.slot,
        channelId: match.entry.ch.id,
      };

      items.push({
        id: `slot-move-${match.key}`,
        category: physical ? 'physical' : 'splits',
        changeType: 'moved',
        severity: 'action',
        title: `Moved ${match.entry.name}: ${fromSlot} → ${toSlot}`,
        detail: `${nodeName} ${match.entry.pg.direction === 'output' ? 'Output' : 'Input'} moved from ${fromSlot} to ${toSlot}.`,
        nodeId: match.entry.node.id,
        nodeName,
        location: `${nodeName} ${toSlot}`,
        beforeValue: fromSlot,
        afterValue: toSlot,
        cableTag: match.entry.cableTag ?? rem.entry.cableTag,
        notes: match.entry.notes ?? rem.entry.notes,
        traceTarget,
      });

      if (physical) {
        physicalChecklist.push({
          id: `chk-move-${match.key}`,
          section: 'physical',
          actionType: 'move',
          headline: `Move ${match.entry.name}: ${fromSlot} → ${toSlot}`,
          detail: `Unplug from ${nodeName} ${fromSlot} and patch into ${toSlot}.`,
          location: `${nodeName} ${fromSlot} → ${toSlot}`,
          cableTag: match.entry.cableTag ?? rem.entry.cableTag,
          notes: match.entry.notes ?? rem.entry.notes,
          traceTarget,
        });
      }

      // Check +48V safety on moved input
      if (match.entry.pg.direction !== 'output' && match.entry.ch.phantom48v !== rem.entry.ch.phantom48v) {
        safetyChecklist.push({
          id: `chk-48v-move-${match.key}`,
          section: 'safety',
          actionType: match.entry.ch.phantom48v ? 'phantom-on' : 'phantom-off',
          headline: `${match.entry.ch.phantom48v ? 'Verify +48V ON' : 'Verify +48V OFF'} on ${nodeName} ${toSlot} (${match.entry.name})`,
          detail: `Phantom power changed during move from ${fromSlot} (${rem.entry.ch.phantom48v ? 'ON' : 'OFF'}) to ${toSlot} (${match.entry.ch.phantom48v ? 'ON' : 'OFF'}).`,
          location: `${nodeName} ${toSlot}`,
          critical: true,
          traceTarget,
        });
      }
    }
  }

  // Remaining truly added slots
  for (const add of addedSlots) {
    if (matchedAdded.has(add.key)) continue;
    const { node, pg, ch, name, cableTag, notes } = add.entry;
    const nodeName = resolveNodeName(afterRig, node);
    const slotRef = `${pg.code}.${ch.slot}`;
    const physical = isPhysicalPort(node, pg);
    const isDigitalSplit = !physical && DIGITAL_SPLIT_CODES.has(pg.code);
    if (node.kind === 'console') affectedConsoleIds.add(node.id);

    const traceTarget: TraceTarget = {
      type: 'channel',
      nodeId: node.id,
      portDirection: pg.direction === 'output' ? 'out' : 'in',
      group: pg.code,
      slot: ch.slot,
      channelId: ch.id,
    };

    items.push({
      id: `slot-add-${add.key}`,
      category: physical ? 'physical' : isDigitalSplit ? 'splits' : 'physical',
      changeType: 'added',
      severity: ch.phantom48v ? 'safety' : 'action',
      title: `Added ${pg.direction === 'output' ? 'Output' : 'Input'}: ${name} (${slotRef})`,
      detail: `${nodeName} ${pg.label} slot ${ch.slot} — ${formatChannelMeta(ch)}.`,
      nodeId: node.id,
      nodeName,
      location: `${nodeName} ${slotRef}`,
      afterValue: `${name} (${formatChannelMeta(ch)})`,
      cableTag,
      notes,
      traceTarget,
    });

    if (physical) {
      physicalChecklist.push({
        id: `chk-plug-${add.key}`,
        section: 'physical',
        actionType: 'plug',
        headline: `Plug ${name} into ${nodeName} ${slotRef}`,
        detail: `${pg.direction === 'output' ? `Connect output destination (${ch.routeLabel ?? name})` : `Patch ${ch.mode === 'ST' ? 'stereo' : 'mono'} source`}${ch.gainDb !== undefined ? ` · Preamp ${formatGain(ch.gainDb)}` : ''}.`,
        location: `${nodeName} ${slotRef}`,
        cableTag,
        notes,
        traceTarget,
      });
    }

    if (pg.direction !== 'output' && ch.phantom48v) {
      safetyChecklist.push({
        id: `chk-48v-add-${add.key}`,
        section: 'safety',
        actionType: 'phantom-on',
        headline: `Confirm +48V ON for ${nodeName} ${slotRef} (${name})`,
        detail: `New input requests +48V phantom power. Verify condenser mic or active DI before unmuting.`,
        location: `${nodeName} ${slotRef}`,
        critical: true,
        traceTarget,
      });
    }
  }

  // Remaining truly removed slots
  for (const rem of removedSlots) {
    if (matchedRemoved.has(rem.key)) continue;
    const { node, pg, ch, name, cableTag, notes } = rem.entry;
    const nodeName = resolveNodeName(beforeRig, node);
    const slotRef = `${pg.code}.${ch.slot}`;
    const physical = isPhysicalPort(node, pg);
    if (node.kind === 'console') affectedConsoleIds.add(node.id);

    items.push({
      id: `slot-rem-${rem.key}`,
      category: physical ? 'physical' : 'splits',
      changeType: 'removed',
      severity: ch.phantom48v ? 'safety' : 'action',
      title: `Removed ${pg.direction === 'output' ? 'Output' : 'Input'}: ${name} (${slotRef})`,
      detail: `${nodeName} ${pg.label} slot ${ch.slot} unpatched.`,
      nodeId: node.id,
      nodeName,
      location: `${nodeName} ${slotRef}`,
      beforeValue: `${name} (${formatChannelMeta(ch)})`,
      cableTag,
      notes,
    });

    if (physical) {
      physicalChecklist.push({
        id: `chk-unplug-${rem.key}`,
        section: 'physical',
        actionType: 'unplug',
        headline: `Unplug ${name} from ${nodeName} ${slotRef}`,
        detail: `Slot is now vacant / unpatched.`,
        location: `${nodeName} ${slotRef}`,
        cableTag,
        notes,
      });
    }

    if (pg.direction !== 'output' && ch.phantom48v) {
      safetyChecklist.push({
        id: `chk-48v-rem-${rem.key}`,
        section: 'safety',
        actionType: 'phantom-off',
        headline: `Verify +48V OFF on ${nodeName} ${slotRef} (was ${name})`,
        detail: `Previously carried +48V phantom power — ensure +48V is off before patching dynamic/passive gear.`,
        location: `${nodeName} ${slotRef}`,
        critical: true,
      });
    }
  }

  // Modified slots present in both before & after
  for (const [key, afterEntry] of afterSlots) {
    const beforeEntry = beforeSlots.get(key);
    if (!beforeEntry) continue;

    const { node, pg, ch } = afterEntry;
    const prev = beforeEntry.ch;
    const nodeName = resolveNodeName(afterRig, node);
    const slotRef = `${pg.code}.${ch.slot}`;
    const physical = isPhysicalPort(node, pg);

    const traceTarget: TraceTarget = {
      type: 'channel',
      nodeId: node.id,
      portDirection: pg.direction === 'output' ? 'out' : 'in',
      group: pg.code,
      slot: ch.slot,
      channelId: ch.id,
    };

    const nameChanged = afterEntry.name !== beforeEntry.name;
    const modeChanged = ch.mode !== prev.mode;
    const gainChanged = ch.gainDb !== prev.gainDb;
    const phantomChanged = Boolean(ch.phantom48v) !== Boolean(prev.phantom48v);
    const polarityChanged = Boolean(ch.polarityInverted) !== Boolean(prev.polarityInverted);
    const routeChanged = (ch.routeLabel ?? '') !== (prev.routeLabel ?? '');
    const cableTagChanged = (afterEntry.cableTag ?? '') !== (beforeEntry.cableTag ?? '');
    const notesChanged = (afterEntry.notes ?? '') !== (beforeEntry.notes ?? '');

    if (
      !nameChanged &&
      !modeChanged &&
      !gainChanged &&
      !phantomChanged &&
      !polarityChanged &&
      !routeChanged &&
      !cableTagChanged &&
      !notesChanged
    ) {
      continue;
    }

    if (node.kind === 'console') affectedConsoleIds.add(node.id);

    // Explicit Phantom Power safety diff & checklist entry
    if (phantomChanged && pg.direction !== 'output') {
      const turnedOn = Boolean(ch.phantom48v);
      items.push({
        id: `slot-48v-${key}`,
        category: 'phantom',
        changeType: 'modified',
        severity: 'safety',
        title: `+48V ${turnedOn ? 'Enabled' : 'Disabled'} on ${nodeName} ${slotRef} (${afterEntry.name})`,
        detail: `Phantom power changed from ${turnedOn ? 'OFF → ON' : 'ON → OFF'}.`,
        nodeId: node.id,
        nodeName,
        location: `${nodeName} ${slotRef}`,
        beforeValue: turnedOn ? 'OFF' : '+48V ON',
        afterValue: turnedOn ? '+48V ON' : 'OFF',
        traceTarget,
      });
      safetyChecklist.push({
        id: `chk-48v-mod-${key}`,
        section: 'safety',
        actionType: turnedOn ? 'phantom-on' : 'phantom-off',
        headline: `${turnedOn ? 'Enable +48V' : 'Disable +48V'} on ${nodeName} ${slotRef} (${afterEntry.name})`,
        detail: turnedOn
          ? 'Confirm connected mic/DI requires +48V phantom power.'
          : 'Mute channel before turning +48V off to avoid pop.',
        location: `${nodeName} ${slotRef}`,
        critical: true,
        traceTarget,
      });
    }

    // Physical label / route / cable tag / mode change
    if (nameChanged || routeChanged || cableTagChanged || modeChanged || notesChanged) {
      const changedFields: string[] = [];
      if (nameChanged) changedFields.push(`Label: "${beforeEntry.name}" → "${afterEntry.name}"`);
      if (modeChanged) changedFields.push(`Mode: ${prev.mode} → ${ch.mode}`);
      if (routeChanged) changedFields.push(`Route: ${prev.routeLabel ?? '—'} → ${ch.routeLabel ?? '—'}`);
      if (cableTagChanged) changedFields.push(`Cable: ${beforeEntry.cableTag ?? '—'} → ${afterEntry.cableTag ?? '—'}`);
      if (notesChanged) changedFields.push(`Notes updated`);

      items.push({
        id: `slot-mod-${key}`,
        category: physical ? 'physical' : 'splits',
        changeType: 'modified',
        severity: nameChanged || routeChanged ? 'action' : 'info',
        title: `Updated ${nodeName} ${slotRef}: ${afterEntry.name}`,
        detail: changedFields.join(' · '),
        nodeId: node.id,
        nodeName,
        location: `${nodeName} ${slotRef}`,
        beforeValue: `${beforeEntry.name}${prev.routeLabel ? ` (${prev.routeLabel})` : ''}`,
        afterValue: `${afterEntry.name}${ch.routeLabel ? ` (${ch.routeLabel})` : ''}`,
        cableTag: afterEntry.cableTag,
        notes: afterEntry.notes,
        traceTarget,
      });

      if (physical && (nameChanged || cableTagChanged)) {
        physicalChecklist.push({
          id: `chk-repatch-${key}`,
          section: 'physical',
          actionType: nameChanged ? 'relabel' : 'plug',
          headline: nameChanged
            ? `Re-patch / re-label ${nodeName} ${slotRef}: "${beforeEntry.name}" → "${afterEntry.name}"`
            : `Verify cable tag on ${nodeName} ${slotRef} (${afterEntry.name})`,
          detail: changedFields.join(' · '),
          location: `${nodeName} ${slotRef}`,
          cableTag: afterEntry.cableTag,
          notes: afterEntry.notes,
          traceTarget,
        });
      }
    }

    // Preamp Gain / Polarity change
    if ((gainChanged || polarityChanged) && pg.direction !== 'output') {
      const preampParts: string[] = [];
      if (gainChanged) preampParts.push(`Gain ${formatGain(prev.gainDb)} → ${formatGain(ch.gainDb)}`);
      if (polarityChanged) preampParts.push(`Polarity ${prev.polarityInverted ? 'Ø' : 'Normal'} → ${ch.polarityInverted ? 'Ø' : 'Normal'}`);
      items.push({
        id: `slot-preamp-${key}`,
        category: 'phantom',
        changeType: 'modified',
        severity: 'info',
        title: `Preamp Adjusted on ${nodeName} ${slotRef} (${afterEntry.name})`,
        detail: preampParts.join(' · '),
        nodeId: node.id,
        nodeName,
        location: `${nodeName} ${slotRef}`,
        beforeValue: `${formatGain(prev.gainDb)}${prev.polarityInverted ? ' Ø' : ''}`,
        afterValue: `${formatGain(ch.gainDb)}${ch.polarityInverted ? ' Ø' : ''}`,
        traceTarget,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Console Channel Strips (CH 1..40, AUX 1..8)
  // ---------------------------------------------------------------------------
  const beforeStrips = buildStripMap(beforeRig);
  const afterStrips = buildStripMap(afterRig);
  const allStripKeys = new Set([...beforeStrips.keys(), ...afterStrips.keys()]);

  for (const key of allStripKeys) {
    const prev = beforeStrips.get(key);
    const next = afterStrips.get(key);
    const node = (next ?? prev)!.node;
    const nodeName = resolveNodeName(next ? afterRig : beforeRig, node);
    const strip = (next ?? prev)!.strip;
    const stripLabel = `${strip.kind.toUpperCase()} ${strip.index}`;

    const prevSrc = prev ? formatStripSource(prev.strip) : 'OFF';
    const nextSrc = next ? formatStripSource(next.strip) : 'OFF';
    const prevName = prev?.strip.resolvedName ?? '';
    const nextName = next?.strip.resolvedName ?? '';
    const prevBuses = prev ? prev.strip.busSends.map((b) => b.busIndex).sort((a, b) => a - b).join(',') : '';
    const nextBuses = next ? next.strip.busSends.map((b) => b.busIndex).sort((a, b) => a - b).join(',') : '';
    const prevMains = prev ? [...prev.strip.mainSends].sort((a, b) => a - b).join(',') : '';
    const nextMains = next ? [...next.strip.mainSends].sort((a, b) => a - b).join(',') : '';

    if (
      prevSrc === nextSrc &&
      prevName === nextName &&
      prevBuses === nextBuses &&
      prevMains === nextMains
    ) {
      continue;
    }

    affectedConsoleIds.add(node.id);
    const changeType: DiffChangeType =
      prevSrc === 'OFF' && nextSrc !== 'OFF'
        ? 'added'
        : prevSrc !== 'OFF' && nextSrc === 'OFF'
          ? 'removed'
          : 'modified';

    const details: string[] = [];
    if (prevSrc !== nextSrc) details.push(`Source: ${prevSrc} → ${nextSrc}`);
    if (prevName !== nextName) details.push(`Label: "${prevName || '—'}" → "${nextName || '—'}"`);
    if (prevBuses !== nextBuses) details.push(`Bus sends: [${prevBuses || 'none'}] → [${nextBuses || 'none'}]`);
    if (prevMains !== nextMains) details.push(`Main sends: [${prevMains || 'none'}] → [${nextMains || 'none'}]`);

    const traceTarget: TraceTarget | undefined =
      next && next.strip.sourceGroup !== 'OFF' && next.strip.sourceSlot > 0
        ? {
            type: 'channel',
            nodeId: node.id,
            portDirection: 'in',
            group: next.strip.sourceGroup as PortGroupCode,
            slot: next.strip.sourceSlot,
          }
        : undefined;

    items.push({
      id: `strip-${key}`,
      category: 'strips',
      changeType,
      severity: prevSrc !== nextSrc ? 'action' : 'info',
      title: `${nodeName} ${stripLabel}: ${nextName || prevName || 'Unassigned'}`,
      detail: details.join(' · '),
      nodeId: node.id,
      nodeName,
      location: `${nodeName} ${stripLabel}`,
      beforeValue: `${prevName || '—'} (${prevSrc})`,
      afterValue: `${nextName || '—'} (${nextSrc})`,
      traceTarget,
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Mix Buses, Mains, Matrices & Monitors
  // ---------------------------------------------------------------------------
  const beforeBuses = buildBusMap(beforeRig);
  const afterBuses = buildBusMap(afterRig);
  const allBusKeys = new Set([...beforeBuses.keys(), ...afterBuses.keys()]);

  for (const key of allBusKeys) {
    const prev = beforeBuses.get(key);
    const next = afterBuses.get(key);
    const node = (next ?? prev)!.node;
    const nodeName = resolveNodeName(next ? afterRig : beforeRig, node);
    const bus = (next ?? prev)!.bus;
    const busCode = `${bus.kind.toUpperCase()} ${bus.index}`;

    const prevName = prev ? resolveBusName(beforeRig, prev.bus) : '';
    const nextName = next ? resolveBusName(afterRig, next.bus) : '';
    const prevOut = prev ? formatBusOutputs(prev.bus) : 'Unrouted';
    const nextOut = next ? formatBusOutputs(next.bus) : 'Unrouted';
    const prevMono = prev?.bus.mono;
    const nextMono = next?.bus.mono;

    if (prevName === nextName && prevOut === nextOut && prevMono === nextMono) {
      continue;
    }

    affectedConsoleIds.add(node.id);
    const changeType: DiffChangeType = !prev ? 'added' : !next ? 'removed' : 'modified';
    const details: string[] = [];
    if (prevName !== nextName) details.push(`Name: "${prevName || '—'}" → "${nextName || '—'}"`);
    if (prevOut !== nextOut) details.push(`Outputs: ${prevOut} → ${nextOut}`);
    if (prev && next && prevMono !== nextMono) {
      details.push(`Format: ${prevMono ? 'Mono' : 'Stereo'} → ${nextMono ? 'Mono' : 'Stereo'}`);
    }

    const traceTarget: TraceTarget | undefined = next
      ? {
          type: 'bus',
          nodeId: node.id,
          busKind: next.bus.kind,
          busIndex: next.bus.index,
        }
      : undefined;

    items.push({
      id: `bus-${key}`,
      category: 'buses',
      changeType,
      severity: prevOut !== nextOut ? 'action' : 'info',
      title: `${nodeName} ${busCode}: ${nextName || prevName}`,
      detail: details.join(' · '),
      nodeId: node.id,
      nodeName,
      location: `${nodeName} ${busCode}`,
      beforeValue: `${prevName || '—'} → ${prevOut}`,
      afterValue: `${nextName || '—'} → ${nextOut}`,
      traceTarget,
    });

    if (prevOut !== nextOut) {
      consoleChecklist.push({
        id: `chk-bus-out-${key}`,
        section: 'console',
        actionType: 'verify',
        headline: `Verify ${nodeName} ${busCode} (${nextName || prevName}) output routing`,
        detail: `Outputs changed: ${prevOut} → ${nextOut}.`,
        location: `${nodeName} ${busCode}`,
        traceTarget,
      });
    }
  }

  // Add console .snap load reminders at the top of Console Verification checklist
  const consoleLoadItems: DeltaChecklistItem[] = [];
  for (const consoleId of affectedConsoleIds) {
    const consoleNode = afterRig.nodes.find((n) => n.id === consoleId);
    if (!consoleNode) continue;
    const name = resolveNodeName(afterRig, consoleNode);
    const snapHint =
      options?.consoleExportFileNames?.[consoleId] ??
      afterRig.sourceSnapshots.find((s) => s.consoleNodeId === consoleId)?.fileName;
    consoleLoadItems.push({
      id: `chk-load-snap-${consoleId}`,
      section: 'console',
      actionType: 'console-load',
      headline: `Load updated .snap onto ${name}`,
      detail: snapHint
        ? `Transfer & load "${snapHint}" via USB or WING Edit, then line-check changed inputs.`
        : `Export & load updated snapshot onto ${name}, then line-check changed inputs.`,
      location: `${consoleNode.zone} · ${name}`,
      traceTarget: { type: 'node', nodeId: consoleId },
    });
  }

  // Sort physical checklist: unplug -> move -> plug -> relabel -> hardware
  const physicalOrder: Record<DeltaChecklistItem['actionType'], number> = {
    unplug: 0,
    move: 1,
    plug: 2,
    relabel: 3,
    hardware: 4,
    'phantom-off': 5,
    'phantom-on': 6,
    preamp: 7,
    'console-load': 8,
    verify: 9,
  };
  physicalChecklist.sort((a, b) => physicalOrder[a.actionType] - physicalOrder[b.actionType]);
  safetyChecklist.sort((a, b) => physicalOrder[a.actionType] - physicalOrder[b.actionType]);

  const checklist: DeltaChecklistSection[] = [
    {
      key: 'physical',
      title: '1. Physical Connections, Cables & Rack Hardware',
      subtitle: 'Stagebox / rack XLRs, moves, relabels, and external hardware to touch in-person.',
      items: physicalChecklist,
    },
    {
      key: 'safety',
      title: '2. Phantom Power (+48V) & Preamp Safety Checks',
      subtitle: 'Verify before unmuting or patching dynamic / ribbon mics and passive DIs.',
      items: safetyChecklist,
    },
    {
      key: 'console',
      title: '3. Console Snapshot Loads & Routing Verification',
      subtitle: 'Load exported .snap files and confirm bus/strip outputs at the console.',
      items: [...consoleLoadItems, ...consoleChecklist],
    },
  ];

  const counts: Record<DiffCategory, number> = {
    physical: 0,
    phantom: 0,
    splits: 0,
    strips: 0,
    buses: 0,
    hardware: 0,
  };
  for (const item of items) {
    counts[item.category] += 1;
  }

  return {
    beforeLabel,
    afterLabel,
    totalChanges: items.length,
    counts,
    items,
    checklist,
    affectedConsoleIds: [...affectedConsoleIds],
  };
}
