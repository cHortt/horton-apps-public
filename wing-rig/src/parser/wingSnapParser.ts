import type {
  BusSendRef,
  ChannelMode,
  ChannelPatch,
  ConsoleChannelStrip,
  HardwareNode,
  MixBusKind,
  MixBusSummary,
  PortGroup,
  PortGroupCode,
  SnapshotMetadata,
} from '../schema/rig';

interface RawWingInputSlot {
  name?: string;
  mode?: string;
  g?: number;
  vph?: boolean;
  pol?: boolean;
  mute?: boolean;
  col?: number;
  icon?: number;
  rmt?: boolean;
}

interface RawWingOutputSlot {
  grp?: string;
  in?: number;
}

interface RawWingChannelStrip {
  name?: string;
  clink?: boolean;
  in?: {
    conn?: {
      grp?: string;
      in?: number;
      altgrp?: string;
      altin?: number;
    };
  };
  send?: Record<
    string,
    {
      on?: boolean;
      lvl?: number;
      mode?: string;
    }
  >;
  main?: Record<
    string,
    {
      on?: boolean;
      lvl?: number;
    }
  >;
}

interface RawWingBus {
  name?: string;
  busmono?: boolean;
  mute?: boolean;
  col?: number;
}

interface RawWingMonCfg {
  src?: string;
}

interface RawWingSnap {
  type?: string;
  creator?: string;
  creator_vers?: string;
  creator_model?: string;
  creator_name?: string;
  ae_data?: {
    cfg?: {
      mon?: Record<string, RawWingMonCfg>;
    };
    io?: {
      in?: Record<string, Record<string, RawWingInputSlot>>;
      out?: Record<string, Record<string, RawWingOutputSlot>>;
    };
    ch?: Record<string, RawWingChannelStrip>;
    aux?: Record<string, RawWingChannelStrip>;
    bus?: Record<string, RawWingBus>;
    main?: Record<string, RawWingBus>;
    mtx?: Record<string, RawWingBus>;
  };
}

export interface ParsedWingSnapshot {
  metadata: SnapshotMetadata;
  consoleNode: HardwareNode;
  inputsByGroup: Partial<Record<PortGroupCode, ChannelPatch[]>>;
  outputsByGroup: Partial<Record<PortGroupCode, ChannelPatch[]>>;
  stats: {
    activeInputs: number;
    activeOutputs: number;
    activeChannels: number;
    activeAuxes: number;
    passthroughOutputs: number;
    namedBuses: number;
  };
}

const INPUT_GROUP_LABELS: Record<PortGroupCode, string> = {
  LCL: 'Local Preamp Inputs',
  AUX: 'Aux Inputs',
  A: 'AES50-A Inputs',
  B: 'AES50-B Inputs',
  C: 'AES50-C Inputs',
  SC: 'StageCONNECT Inputs',
  USB: 'USB Audio Inputs',
  CRD: 'WING-LIVE / Card Inputs',
  MOD: 'Expansion Module Inputs',
  PLAY: 'USB Player Inputs',
  REC: 'USB Recorder',
  AES: 'AES/EBU Inputs',
  USR: 'User Signals',
  OSC: 'Oscillator',
  ANALOG: 'Analog Inputs',
  DANTE: 'Dante Inputs',
  NETWORK: 'Network Inputs',
};

const OUTPUT_GROUP_LABELS: Record<PortGroupCode, string> = {
  LCL: 'Local XLR Outputs',
  AUX: 'Aux Outputs',
  A: 'AES50-A Outputs',
  B: 'AES50-B Outputs',
  C: 'AES50-C Outputs',
  SC: 'StageCONNECT Outputs',
  USB: 'USB Audio Outputs',
  CRD: 'WING-LIVE / Card Outputs',
  MOD: 'Expansion Module Outputs',
  PLAY: 'USB Player',
  REC: 'USB Recorder Outputs',
  AES: 'AES/EBU Outputs',
  USR: 'User Outputs',
  OSC: 'Oscillator',
  ANALOG: 'Analog Outputs',
  DANTE: 'Dante Outputs',
  NETWORK: 'Network Outputs',
};

const KNOWN_PORT_GROUPS = new Set<PortGroupCode>([
  'LCL',
  'AUX',
  'A',
  'B',
  'C',
  'SC',
  'USB',
  'CRD',
  'MOD',
  'PLAY',
  'REC',
  'AES',
  'USR',
  'OSC',
]);

export function decodeStereoSlot(slot: number): { index: number; side: 'L' | 'R' } {
  const safeSlot = Math.max(1, Math.floor(slot));
  return {
    index: Math.ceil(safeSlot / 2),
    side: safeSlot % 2 === 1 ? 'L' : 'R',
  };
}

function parseMonitorSource(src?: string): MixBusSummary['monitorSource'] | undefined {
  if (!src || src === 'OFF') return undefined;
  const match = /^(BUS|MAIN|MTX)\.(\d+)$/i.exec(src.trim());
  if (!match) return undefined;
  const kindMap: Record<string, MixBusKind> = {
    BUS: 'bus',
    MAIN: 'main',
    MTX: 'mtx',
  };
  return {
    kind: kindMap[match[1].toUpperCase()],
    index: Number(match[2]),
    rawRef: src.trim().toUpperCase(),
  };
}

function isKnownPortGroup(code: string): code is PortGroupCode {
  return KNOWN_PORT_GROUPS.has(code as PortGroupCode);
}

function sortedNumericKeys(obj?: Record<string, unknown>): number[] {
  if (!obj) return [];
  return Object.keys(obj)
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
}

export function slugifyConsoleId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'wing-console';
}

export function parseWingSnap(
  input: string | unknown,
  options: { fileName?: string; consoleNodeId?: string; importedAt?: string } = {},
): ParsedWingSnapshot {
  let raw: RawWingSnap;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input) as RawWingSnap;
    } catch (err) {
      throw new Error(
        `Invalid .snap JSON file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (input && typeof input === 'object') {
    raw = input as RawWingSnap;
  } else {
    throw new Error('Expected .snap JSON string or object.');
  }

  if (!raw.ae_data || !raw.ae_data.io || !raw.ae_data.io.in || !raw.ae_data.io.out) {
    throw new Error(
      'Not a valid Behringer WING snapshot: missing ae_data.io.in / ae_data.io.out.',
    );
  }

  const creatorName = (raw.creator_name || 'WING-CONSOLE').trim();
  const consoleNodeId = options.consoleNodeId || slugifyConsoleId(creatorName);
  const ae = raw.ae_data;
  const rawIn = ae.io?.in ?? {};
  const rawOut = ae.io?.out ?? {};

  // 1. Parse Mix Buses, Mains, Matrices, and Monitors
  const mixBuses: MixBusSummary[] = [];
  const busLookup = new Map<string, MixBusSummary>();

  const registerBus = (bus: MixBusSummary) => {
    mixBuses.push(bus);
    busLookup.set(`${bus.kind}:${bus.index}`, bus);
  };

  for (const idx of sortedNumericKeys(ae.bus)) {
    const b = ae.bus![String(idx)];
    registerBus({
      id: `${consoleNodeId}:bus:${idx}`,
      kind: 'bus',
      index: idx,
      rawName: (b.name ?? '').trim(),
      mono: Boolean(b.busmono),
      muted: Boolean(b.mute),
      colorIndex: b.col,
      outputs: [],
    });
  }

  for (const idx of sortedNumericKeys(ae.main)) {
    const m = ae.main![String(idx)];
    registerBus({
      id: `${consoleNodeId}:main:${idx}`,
      kind: 'main',
      index: idx,
      rawName: (m.name ?? '').trim(),
      mono: false,
      muted: Boolean(m.mute),
      colorIndex: m.col,
      outputs: [],
    });
  }

  for (const idx of sortedNumericKeys(ae.mtx)) {
    const m = ae.mtx![String(idx)];
    registerBus({
      id: `${consoleNodeId}:mtx:${idx}`,
      kind: 'mtx',
      index: idx,
      rawName: (m.name ?? '').trim(),
      mono: false,
      muted: Boolean(m.mute),
      colorIndex: m.col,
      outputs: [],
    });
  }

  const monCfg = ae.cfg?.mon ?? {};
  for (const idx of sortedNumericKeys(monCfg)) {
    const parsedSrc = parseMonitorSource(monCfg[String(idx)]?.src);
    registerBus({
      id: `${consoleNodeId}:mon:${idx}`,
      kind: 'mon',
      index: idx,
      rawName: `Monitor ${idx}`,
      mono: false,
      muted: false,
      monitorSource: parsedSrc,
      outputs: [],
    });
  }

  const getBusDisplayName = (kind: MixBusKind, index: number): string => {
    const b = busLookup.get(`${kind}:${index}`);
    if (b && b.rawName && b.rawName !== '.') return b.rawName;
    return `${kind.toUpperCase()} ${index}`;
  };

  // 2. Parse Channel Strips (ch 1..40, aux 1..8) with clink inheritance
  const channelStrips: ConsoleChannelStrip[] = [];
  const consumedInputs = new Map<string, ConsoleChannelStrip>();

  const parseStripBank = (
    bank: Record<string, RawWingChannelStrip> | undefined,
    kind: 'ch' | 'aux',
  ) => {
    for (const idx of sortedNumericKeys(bank)) {
      const ch = bank![String(idx)];
      const conn = ch.in?.conn;
      const srcGrp = (conn?.grp ?? 'OFF').trim();
      const srcSlot = Number(conn?.in ?? 0);
      const rawName = (ch.name ?? '').trim();
      const clink = Boolean(ch.clink);

      if (srcGrp === 'OFF' && !rawName) continue;

      const sourceSlotData =
        srcGrp !== 'OFF' && srcSlot > 0 ? rawIn[srcGrp]?.[String(srcSlot)] : undefined;
      const sourcePreampName = (sourceSlotData?.name ?? '').trim();

      // Verified WING clink rule:
      // non-empty ch.name ALWAYS overrides; if ch.name === "" and clink is true, inherit io.in[grp][in].name
      let resolvedName = rawName;
      if (!resolvedName && clink && sourcePreampName) {
        resolvedName = sourcePreampName;
      }
      if (!resolvedName) {
        resolvedName = `${kind.toUpperCase()} ${idx}`;
      }

      const busSends: BusSendRef[] = [];
      if (ch.send) {
        for (const busIdx of sortedNumericKeys(ch.send)) {
          const s = ch.send[String(busIdx)];
          if (s?.on) {
            busSends.push({
              busKind: 'bus',
              busIndex: busIdx,
              levelDb: typeof s.lvl === 'number' ? s.lvl : undefined,
              mode: s.mode,
            });
          }
        }
      }

      const mainSends: number[] = [];
      if (ch.main) {
        for (const mainIdx of sortedNumericKeys(ch.main)) {
          if (ch.main[String(mainIdx)]?.on) {
            mainSends.push(mainIdx);
          }
        }
      }

      const strip: ConsoleChannelStrip = {
        id: `${consoleNodeId}:strip:${kind}:${idx}`,
        kind,
        index: idx,
        rawName,
        resolvedName,
        clink,
        sourceGroup: srcGrp,
        sourceSlot: srcSlot,
        altSourceGroup: conn?.altgrp && conn.altgrp !== 'OFF' ? conn.altgrp : undefined,
        altSourceSlot: conn?.altgrp && conn.altgrp !== 'OFF' ? conn.altin : undefined,
        busSends,
        mainSends,
      };

      channelStrips.push(strip);
      if (srcGrp !== 'OFF' && srcSlot > 0) {
        const key = `${srcGrp}:${srcSlot}`;
        if (!consumedInputs.has(key)) {
          consumedInputs.set(key, strip);
        }
      }
    }
  };

  parseStripBank(ae.ch, 'ch');
  parseStripBank(ae.aux, 'aux');

  // 3. Identify inputs referenced by direct cross-trunk pass-through outputs
  const passthroughReferencedInputs = new Set<string>();
  for (const outGrp of Object.keys(rawOut)) {
    const outSlots = rawOut[outGrp];
    for (const slotNum of sortedNumericKeys(outSlots)) {
      const entry = outSlots[String(slotNum)];
      const srcGrp = (entry?.grp ?? 'OFF').trim();
      const srcIn = Number(entry?.in ?? 0);
      if (srcGrp !== 'OFF' && srcIn > 0 && isKnownPortGroup(srcGrp)) {
        passthroughReferencedInputs.add(`${srcGrp}:${srcIn}`);
      }
    }
  }

  // 4. Parse Inputs (ae_data.io.in.<GRP>.<N>)
  const inputsByGroup: Partial<Record<PortGroupCode, ChannelPatch[]>> = {};
  const portGroups: PortGroup[] = [];
  let activeInputsCount = 0;

  for (const grpKey of Object.keys(rawIn)) {
    if (!isKnownPortGroup(grpKey)) continue;
    const slots = rawIn[grpKey];
    const keys = sortedNumericKeys(slots);
    const channels: ChannelPatch[] = [];

    for (const slotNum of keys) {
      const v = slots[String(slotNum)];
      const name = (v.name ?? '').trim();
      const strip = consumedInputs.get(`${grpKey}:${slotNum}`);
      const isReferenced = passthroughReferencedInputs.has(`${grpKey}:${slotNum}`);
      const hasGain = typeof v.g === 'number' && v.g !== 0;
      const hasPhantom = Boolean(v.vph);

      if (!name && !strip && !isReferenced && !hasGain && !hasPhantom) {
        continue;
      }

      const mode: ChannelMode = v.mode === 'ST' ? 'ST' : 'M';
      let stereoSide: 'L' | 'R' | undefined;
      if (mode === 'ST') {
        const prev = slots[String(slotNum - 1)];
        const next = slots[String(slotNum + 1)];
        if (prev && prev.mode === 'ST' && (prev.name ?? '').trim() === name && slotNum % 2 === 0) {
          stereoSide = 'R';
        } else if (
          next &&
          next.mode === 'ST' &&
          (next.name ?? '').trim() === name &&
          slotNum % 2 === 1
        ) {
          stereoSide = 'L';
        } else {
          stereoSide = slotNum % 2 === 1 ? 'L' : 'R';
        }
      }

      const patch: ChannelPatch = {
        id: `${consoleNodeId}:in:${grpKey}:${slotNum}`,
        slot: slotNum,
        rawName: name || (strip ? strip.resolvedName : `${grpKey} ${slotNum}`),
        mode,
        stereoSide,
        gainDb: typeof v.g === 'number' ? v.g : undefined,
        phantom48v: hasPhantom,
        polarityInverted: Boolean(v.pol),
        muted: Boolean(v.mute),
        colorIndex: v.col,
        consoleChannel: strip ? `${strip.kind.toUpperCase()} ${strip.index}` : undefined,
        channelStripName:
          strip && strip.rawName && strip.rawName !== name ? strip.rawName : undefined,
        busSends: strip?.busSends.length ? strip.busSends : undefined,
        mainSends: strip?.mainSends.length ? strip.mainSends : undefined,
      };

      channels.push(patch);
      activeInputsCount++;
    }

    if (channels.length > 0) {
      inputsByGroup[grpKey] = channels;
      portGroups.push({
        id: `${consoleNodeId}:in:${grpKey}`,
        code: grpKey,
        label: INPUT_GROUP_LABELS[grpKey] ?? `${grpKey} Inputs`,
        direction: 'input',
        capacity: keys.length,
        channels,
      });
    }
  }

  // 5. Parse Outputs (ae_data.io.out.<GRP>.<N>)
  const outputsByGroup: Partial<Record<PortGroupCode, ChannelPatch[]>> = {};
  let activeOutputsCount = 0;
  let passthroughCount = 0;

  for (const outGrp of Object.keys(rawOut)) {
    if (!isKnownPortGroup(outGrp)) continue;
    const slots = rawOut[outGrp];
    const keys = sortedNumericKeys(slots);
    const channels: ChannelPatch[] = [];

    for (const slotNum of keys) {
      const entry = slots[String(slotNum)];
      const srcGrp = (entry?.grp ?? 'OFF').trim();
      const srcIn = Number(entry?.in ?? 0);
      if (srcGrp === 'OFF' || srcIn <= 0) continue;

      let patch: ChannelPatch;

      if (srcGrp === 'BUS' || srcGrp === 'MAIN' || srcGrp === 'MTX' || srcGrp === 'MON') {
        const { index, side } = decodeStereoSlot(srcIn);
        const kindMap: Record<'BUS' | 'MAIN' | 'MTX' | 'MON', MixBusKind> = {
          BUS: 'bus',
          MAIN: 'main',
          MTX: 'mtx',
          MON: 'mon',
        };
        const busKind = kindMap[srcGrp];
        const busObj = busLookup.get(`${busKind}:${index}`);

        let displayName = getBusDisplayName(busKind, index);
        let routeLabel = `${srcGrp} ${index}${busObj?.mono ? '' : ` ${side}`} (${displayName})`;

        if (srcGrp === 'MON' && busObj?.monitorSource) {
          const monSrcName = getBusDisplayName(
            busObj.monitorSource.kind,
            busObj.monitorSource.index,
          );
          displayName = `${monSrcName} (Mon ${index})`;
          routeLabel = `MON ${index} ${side} ← ${busObj.monitorSource.kind.toUpperCase()} ${busObj.monitorSource.index} (${monSrcName})`;
        }

        if (busObj) {
          busObj.outputs.push({
            group: outGrp,
            slot: slotNum,
            stereoSide: busObj.mono ? undefined : side,
          });
        }

        patch = {
          id: `${consoleNodeId}:out:${outGrp}:${slotNum}`,
          slot: slotNum,
          rawName: busObj?.mono ? displayName : `${displayName} ${side}`,
          mode: busObj?.mono ? 'M' : 'ST',
          stereoSide: busObj?.mono ? undefined : side,
          sourceRef: {
            nodeId: consoleNodeId,
            group: srcGrp,
            slot: index,
            label: displayName,
          },
          routeLabel,
        };
      } else if (isKnownPortGroup(srcGrp)) {
        // Direct cross-trunk pass-through (e.g., out.C.1 <- A.1, out.C.25 <- LCL.1, out.A.16 <- C.48)
        const srcPreamp = rawIn[srcGrp]?.[String(srcIn)];
        const srcName = (srcPreamp?.name ?? '').trim() || `${srcGrp}.${srcIn}`;
        const srcMode: ChannelMode = srcPreamp?.mode === 'ST' ? 'ST' : 'M';
        passthroughCount++;

        patch = {
          id: `${consoleNodeId}:out:${outGrp}:${slotNum}`,
          slot: slotNum,
          rawName: srcName,
          mode: srcMode,
          passthroughFrom: {
            nodeId: consoleNodeId,
            group: srcGrp,
            slot: srcIn,
            direction: 'in',
            label: srcName,
          },
          routeLabel: `Pass-through ← ${srcGrp}.${srcIn}${srcPreamp?.name ? ` (${srcName})` : ''}`,
        };
      } else {
        patch = {
          id: `${consoleNodeId}:out:${outGrp}:${slotNum}`,
          slot: slotNum,
          rawName: `${srcGrp}.${srcIn}`,
          mode: 'M',
          routeLabel: `${srcGrp}.${srcIn}`,
        };
      }

      channels.push(patch);
      activeOutputsCount++;
    }

    if (channels.length > 0) {
      outputsByGroup[outGrp] = channels;
      portGroups.push({
        id: `${consoleNodeId}:out:${outGrp}`,
        code: outGrp,
        label: OUTPUT_GROUP_LABELS[outGrp] ?? `${outGrp} Outputs`,
        direction: 'output',
        capacity: keys.length,
        channels,
      });
    }
  }

  // Filter mixBuses down to named or active (routed) buses for clean display
  const meaningfulBuses = mixBuses.filter(
    (b) => (b.rawName && b.rawName !== '.') || b.outputs.length > 0 || b.monitorSource,
  );

  // Detect WING Rack vs Full/Compact based on LCL capacity (24 on WING Rack, 8 on WING Full)
  const lclInCount = Object.keys(rawIn.LCL ?? {}).length;
  const inferredModel =
    lclInCount >= 24 ? 'Behringer WING Rack' : 'Behringer WING Console';

  const metadata: SnapshotMetadata = {
    consoleNodeId,
    creatorName,
    creator: raw.creator ?? 'WING',
    creatorVersion: raw.creator_vers ?? 'unknown',
    creatorModel: raw.creator_model ?? 'wing',
    snapshotType: raw.type ?? 'snapshot',
    fileName: options.fileName ?? `${creatorName}.snap`,
    importedAt: options.importedAt ?? new Date().toISOString(),
  };

  const consoleNode: HardwareNode = {
    id: consoleNodeId,
    kind: 'console',
    rawName: creatorName,
    model: inferredModel,
    zone: creatorName.toLowerCase().includes('foh') ? 'FOH Booth' : 'Stage Rack',
    position: { x: 420, y: 185 },
    sourceOrigin: 'snapshot',
    snapshotCreatorName: creatorName,
    portGroups,
    channelStrips,
    mixBuses: meaningfulBuses,
  };

  return {
    metadata,
    consoleNode,
    inputsByGroup,
    outputsByGroup,
    stats: {
      activeInputs: activeInputsCount,
      activeOutputs: activeOutputsCount,
      activeChannels: channelStrips.filter((c) => c.kind === 'ch').length,
      activeAuxes: channelStrips.filter((c) => c.kind === 'aux').length,
      passthroughOutputs: passthroughCount,
      namedBuses: meaningfulBuses.filter((b) => b.kind === 'bus').length,
    },
  };
}
