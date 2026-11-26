import type { ChannelMode, MixBusKind, PortGroupCode } from '../schema/rig';
import type { SnapPatchOp, StagedPatchEntry } from '../schema/patch';

/**
 * Inverse of decodeStereoSlot: converts a 1-based Bus/Main/Mtx/Mon index + side ('L' | 'R')
 * into the Behringer WING output slot number (e.g. Bus 5 L -> 9, Bus 5 R -> 10).
 */
export function encodeStereoSlot(index: number, side: 'L' | 'R' = 'L'): number {
  const safeIndex = Math.max(1, Math.floor(index));
  return side === 'R' ? safeIndex * 2 : safeIndex * 2 - 1;
}

/**
 * Returns the paired stereo slot for a given 1-based input slot (odd -> slot+1, even -> slot-1).
 */
export function getStereoPartnerSlot(slot: number): number {
  return slot % 2 === 1 ? slot + 1 : Math.max(1, slot - 1);
}

/**
 * Formats exact verified WING .snap JSON paths touched by a SnapPatchOp.
 */
export function describePatchJsonPaths(op: SnapPatchOp): string[] {
  switch (op.type) {
    case 'set-input': {
      const base = `ae_data.io.in.${op.group}.${op.slot}`;
      if (op.mode === 'ST' && op.pairStereoSlot !== false) {
        const partner = getStereoPartnerSlot(op.slot);
        return [base, `ae_data.io.in.${op.group}.${partner}`];
      }
      return [base];
    }
    case 'set-output':
      return [`ae_data.io.out.${op.group}.${op.slot}`];
    case 'set-channel-strip': {
      const paths: string[] = [];
      const root = `ae_data.${op.kind}.${op.index}`;
      if (
        op.name !== undefined ||
        op.clink !== undefined ||
        op.colorIndex !== undefined ||
        op.tags !== undefined
      ) {
        paths.push(root);
      }
      if (op.sourceGroup !== undefined || op.altSourceGroup !== undefined) {
        paths.push(`${root}.in.conn`);
      }
      if (op.busSendToggles && Object.keys(op.busSendToggles).length > 0) {
        paths.push(`${root}.send.{${Object.keys(op.busSendToggles).join(',')}}`);
      }
      if (op.mainSendToggles && Object.keys(op.mainSendToggles).length > 0) {
        paths.push(`${root}.main.{${Object.keys(op.mainSendToggles).join(',')}}`);
      }
      return paths.length > 0 ? paths : [root];
    }
    case 'set-bus':
      return [`ae_data.${op.kind}.${op.index}`];
    case 'set-monitor-source':
      return [`ae_data.cfg.mon.${op.monitorIndex}.src`];
  }
}

export function createStagedEntry(
  consoleNodeId: string,
  summary: string,
  op: SnapPatchOp,
): StagedPatchEntry {
  const touchesPhantom48v = op.type === 'set-input' && op.phantom48v !== undefined;
  return {
    id: `patch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    consoleNodeId,
    createdAt: new Date().toISOString(),
    summary,
    jsonPaths: describePatchJsonPaths(op),
    touchesPhantom48v: touchesPhantom48v || undefined,
    op,
  };
}

function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const fresh: Record<string, unknown> = {};
  parent[key] = fresh;
  return fresh;
}

function applySingleInputSlot(
  groupObj: Record<string, unknown>,
  slot: number,
  op: Extract<SnapPatchOp, { type: 'set-input' }>,
): void {
  const slotObj = ensureRecord(groupObj, String(slot));
  if (op.name !== undefined) slotObj.name = op.name;
  if (op.mode !== undefined) slotObj.mode = op.mode;
  if (op.gainDb !== undefined) slotObj.g = op.gainDb;
  if (op.phantom48v !== undefined) slotObj.vph = op.phantom48v;
  if (op.polarityInverted !== undefined) slotObj.pol = op.polarityInverted;
  if (op.muted !== undefined) slotObj.mute = op.muted;
  if (op.colorIndex !== undefined) slotObj.col = op.colorIndex;
  if (op.tags !== undefined) slotObj.tags = op.tags;
}

/**
 * Losslessly applies structured SnapPatchOp mutations onto a raw Behringer WING .snap JSON string.
 * Only the explicitly targeted `ae_data.*` keys are mutated; all untouched DSP (EQ, dynamics, FX,
 * DCA, mute groups) and `ce_data` control-surface layers pass through untouched.
 */
export function applyPatchOpsToRawSnap(rawSnapJson: string, ops: SnapPatchOp[]): string {
  if (ops.length === 0) return rawSnapJson;

  const doc = JSON.parse(rawSnapJson) as Record<string, unknown>;
  const ae = ensureRecord(doc, 'ae_data');

  for (const op of ops) {
    switch (op.type) {
      case 'set-input': {
        const io = ensureRecord(ae, 'io');
        const ioIn = ensureRecord(io, 'in');
        const grp = ensureRecord(ioIn, op.group);
        applySingleInputSlot(grp, op.slot, op);
        if (op.mode === 'ST' && op.pairStereoSlot !== false) {
          const partner = getStereoPartnerSlot(op.slot);
          applySingleInputSlot(grp, partner, op);
        }
        break;
      }

      case 'set-output': {
        const io = ensureRecord(ae, 'io');
        const ioOut = ensureRecord(io, 'out');
        const grp = ensureRecord(ioOut, op.group);
        const slotObj = ensureRecord(grp, String(op.slot));
        slotObj.grp = op.sourceGroup;
        slotObj.in = op.sourceGroup === 'OFF' ? 1 : Math.max(1, Math.floor(op.sourceSlot));
        break;
      }

      case 'set-channel-strip': {
        const bank = ensureRecord(ae, op.kind);
        const strip = ensureRecord(bank, String(op.index));
        if (op.name !== undefined) strip.name = op.name;
        if (op.clink !== undefined) strip.clink = op.clink;
        if (op.colorIndex !== undefined) strip.col = op.colorIndex;
        if (op.tags !== undefined) strip.tags = op.tags;

        if (op.sourceGroup !== undefined || op.altSourceGroup !== undefined) {
          const inObj = ensureRecord(strip, 'in');
          const conn = ensureRecord(inObj, 'conn');
          if (op.sourceGroup !== undefined) {
            conn.grp = op.sourceGroup;
            if (op.sourceGroup === 'OFF') {
              conn.in = 1;
            } else if (op.sourceSlot !== undefined) {
              conn.in = Math.max(1, Math.floor(op.sourceSlot));
            }
          }
          if (op.altSourceGroup !== undefined) {
            conn.altgrp = op.altSourceGroup;
            if (op.altSourceGroup === 'OFF') {
              conn.altin = 1;
            } else if (op.altSourceSlot !== undefined) {
              conn.altin = Math.max(1, Math.floor(op.altSourceSlot));
            }
          }
        }

        if (op.busSendToggles) {
          const sends = ensureRecord(strip, 'send');
          for (const [busIdx, enabled] of Object.entries(op.busSendToggles)) {
            const sendObj = ensureRecord(sends, busIdx);
            sendObj.on = Boolean(enabled);
          }
        }

        if (op.mainSendToggles) {
          const mains = ensureRecord(strip, 'main');
          for (const [mainIdx, enabled] of Object.entries(op.mainSendToggles)) {
            const mainObj = ensureRecord(mains, mainIdx);
            mainObj.on = Boolean(enabled);
          }
        }
        break;
      }

      case 'set-bus': {
        const bank = ensureRecord(ae, op.kind);
        const busObj = ensureRecord(bank, String(op.index));
        if (op.name !== undefined) busObj.name = op.name;
        if (op.mono !== undefined && op.kind === 'bus') busObj.busmono = op.mono;
        if (op.muted !== undefined) busObj.mute = op.muted;
        if (op.colorIndex !== undefined) busObj.col = op.colorIndex;
        if (op.tags !== undefined) busObj.tags = op.tags;
        break;
      }

      case 'set-monitor-source': {
        const cfg = ensureRecord(ae, 'cfg');
        const mon = ensureRecord(cfg, 'mon');
        const monObj = ensureRecord(mon, String(op.monitorIndex));
        monObj.src = op.sourceRef.trim().toUpperCase() || 'OFF';
        break;
      }
    }
  }

  return JSON.stringify(doc, null, 2);
}

/**
 * Builds a clean YYYYMMDD default export filename from the original snapshot filename.
 */
export function buildDefaultSnapExportName(originalFileName: string, date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const stamp = `${yyyy}${mm}${dd}`;
  const stripped = originalFileName
    .replace(/\.snap$/i, '')
    .replace(/-\d{8}$/, '')
    .trim();
  return `${stripped || 'WING-Snapshot'}-${stamp}.snap`;
}

export interface DualSourceWizardInput {
  stageConsoleId: string;
  fohConsoleId?: string;
  headampOwnerConsoleId: string;
  stageSplitPort: PortGroupCode;
  fohReceivePort: PortGroupCode;
  hasStageBaseline: boolean;
  hasFohBaseline: boolean;
  sourceName: string;
  inputGroup: PortGroupCode;
  inputSlot: number;
  mode: ChannelMode;
  gainDb: number;
  phantom48v: boolean;
  colorIndex?: number;
  tags?: string;
  stageStripKind: 'ch' | 'aux';
  stageStripIndex: number; // 0 = skip
  stageStripClink: boolean;
  stageStripOverrideName?: string;
  stageAltGroup?: PortGroupCode | 'OFF';
  stageAltSlot?: number;
  stageBusSendIds: number[];
  stageMainSendIds: number[];
  splitToFoh: boolean;
  splitSlot: number;
  fohStripKind: 'ch' | 'aux';
  fohStripIndex: number; // 0 = skip
  fohStripClink: boolean;
  fohStripOverrideName?: string;
  fohBusSendIds: number[];
  fohMainSendIds: number[];
}

/**
 * Generates atomic staged patch entries across one or both consoles for a new/updated input source.
 */
export function buildDualSourcePatches(input: DualSourceWizardInput): StagedPatchEntry[] {
  const entries: StagedPatchEntry[] = [];
  const trimmedName = input.sourceName.trim() || `${input.inputGroup} ${input.inputSlot}`;
  const isStereo = input.mode === 'ST';
  const partnerSlot = getStereoPartnerSlot(input.inputSlot);
  const splitPartnerSlot = getStereoPartnerSlot(input.splitSlot);
  const stageOwnsHeadamp = input.headampOwnerConsoleId === input.stageConsoleId;

  // 1. Stage console input preamp/source
  if (input.hasStageBaseline) {
    entries.push(
      createStagedEntry(
        input.stageConsoleId,
        `Set ${input.inputGroup}.${input.inputSlot}${isStereo ? `–${partnerSlot}` : ''} "${trimmedName}" (${input.mode}${stageOwnsHeadamp ? `, ${input.gainDb >= 0 ? '+' : ''}${input.gainDb} dB${input.phantom48v ? ', +48V' : ''}` : ''})`,
        {
          type: 'set-input',
          group: input.inputGroup,
          slot: input.inputSlot,
          pairStereoSlot: isStereo,
          name: trimmedName,
          mode: input.mode,
          gainDb: stageOwnsHeadamp ? input.gainDb : undefined,
          phantom48v: stageOwnsHeadamp ? input.phantom48v : undefined,
          colorIndex: input.colorIndex,
          tags: input.tags,
        },
      ),
    );

    // 2. Stage console channel/aux strip
    if (input.stageStripIndex > 0) {
      const busSendToggles: Record<number, boolean> = {};
      for (const b of input.stageBusSendIds) busSendToggles[b] = true;
      const mainSendToggles: Record<number, boolean> = {};
      for (const m of input.stageMainSendIds) mainSendToggles[m] = true;

      entries.push(
        createStagedEntry(
          input.stageConsoleId,
          `Patch ${input.stageStripKind.toUpperCase()} ${input.stageStripIndex} ← ${input.inputGroup}.${input.inputSlot}${input.stageStripClink ? ' (clink)' : ''}`,
          {
            type: 'set-channel-strip',
            kind: input.stageStripKind,
            index: input.stageStripIndex,
            name: input.stageStripClink ? '' : (input.stageStripOverrideName?.trim() || trimmedName),
            clink: input.stageStripClink,
            colorIndex: input.colorIndex,
            tags: input.tags,
            sourceGroup: input.inputGroup,
            sourceSlot: input.inputSlot,
            altSourceGroup: input.stageAltGroup,
            altSourceSlot: input.stageAltSlot,
            busSendToggles: Object.keys(busSendToggles).length > 0 ? busSendToggles : undefined,
            mainSendToggles: Object.keys(mainSendToggles).length > 0 ? mainSendToggles : undefined,
          },
        ),
      );
    }

    // 3. Stage -> FOH direct split pass-through
    if (input.splitToFoh && input.splitSlot > 0) {
      entries.push(
        createStagedEntry(
          input.stageConsoleId,
          `Split Out ${input.stageSplitPort}.${input.splitSlot} ← ${input.inputGroup}.${input.inputSlot}`,
          {
            type: 'set-output',
            group: input.stageSplitPort,
            slot: input.splitSlot,
            sourceGroup: input.inputGroup,
            sourceSlot: input.inputSlot,
          },
        ),
      );
      if (isStereo) {
        entries.push(
          createStagedEntry(
            input.stageConsoleId,
            `Split Out ${input.stageSplitPort}.${splitPartnerSlot} ← ${input.inputGroup}.${partnerSlot} (ST R)`,
            {
              type: 'set-output',
              group: input.stageSplitPort,
              slot: splitPartnerSlot,
              sourceGroup: input.inputGroup,
              sourceSlot: partnerSlot,
            },
          ),
        );
      }
    }
  }

  // 4. FOH console receive input + strip (if FOH baseline is loaded)
  if (input.fohConsoleId && input.hasFohBaseline && (input.splitToFoh || input.fohStripIndex > 0)) {
    const fohOwnsHeadamp = input.headampOwnerConsoleId === input.fohConsoleId;
    const fohInSlot = input.splitSlot > 0 ? input.splitSlot : input.inputSlot;

    entries.push(
      createStagedEntry(
        input.fohConsoleId,
        `Sync FOH ${input.fohReceivePort}.${fohInSlot}${isStereo ? `–${getStereoPartnerSlot(fohInSlot)}` : ''} "${trimmedName}" (${input.mode})`,
        {
          type: 'set-input',
          group: input.fohReceivePort,
          slot: fohInSlot,
          pairStereoSlot: isStereo,
          name: trimmedName,
          mode: input.mode,
          gainDb: fohOwnsHeadamp ? input.gainDb : undefined,
          phantom48v: fohOwnsHeadamp ? input.phantom48v : undefined,
          colorIndex: input.colorIndex,
          tags: input.tags,
        },
      ),
    );

    if (input.fohStripIndex > 0) {
      const busSendToggles: Record<number, boolean> = {};
      for (const b of input.fohBusSendIds) busSendToggles[b] = true;
      const mainSendToggles: Record<number, boolean> = {};
      for (const m of input.fohMainSendIds) mainSendToggles[m] = true;

      entries.push(
        createStagedEntry(
          input.fohConsoleId,
          `Patch FOH ${input.fohStripKind.toUpperCase()} ${input.fohStripIndex} ← ${input.fohReceivePort}.${fohInSlot}${input.fohStripClink ? ' (clink)' : ''}`,
          {
            type: 'set-channel-strip',
            kind: input.fohStripKind,
            index: input.fohStripIndex,
            name: input.fohStripClink ? '' : (input.fohStripOverrideName?.trim() || trimmedName),
            clink: input.fohStripClink,
            colorIndex: input.colorIndex,
            tags: input.tags,
            sourceGroup: input.fohReceivePort,
            sourceSlot: fohInSlot,
            busSendToggles: Object.keys(busSendToggles).length > 0 ? busSendToggles : undefined,
            mainSendToggles: Object.keys(mainSendToggles).length > 0 ? mainSendToggles : undefined,
          },
        ),
      );
    }
  }

  return entries;
}

export interface ReturnOutputWizardInput {
  originConsoleId: string;
  hasOriginBaseline: boolean;
  /** Bus/Main/Mtx/Mon source on origin console */
  busKind: MixBusKind;
  busIndex: number;
  busName?: string;
  busMono?: boolean;
  busColorIndex?: number;
  monitorSourceRef?: string;
  /** Output bank on origin console (e.g. LCL, A, AUX, or inter-console C for cross-console return) */
  originOutGroup: PortGroupCode;
  originOutSlot: number;
  stereoOutput: boolean;
  /** Optional cross-console pass-through on destination console (e.g. FOH C.48 -> Stage A.16) */
  relayConsoleId?: string;
  hasRelayBaseline?: boolean;
  relayReceiveGroup?: PortGroupCode;
  relayOutGroup?: PortGroupCode;
  relayOutSlot?: number;
  relayInputLabel?: string;
}

/**
 * Generates staged patch entries for configuring a Bus/Main/Mtx/Mon output and optional cross-console return pass-through.
 */
export function buildReturnOutputPatches(input: ReturnOutputWizardInput): StagedPatchEntry[] {
  const entries: StagedPatchEntry[] = [];
  const busGroupMap: Record<MixBusKind, 'BUS' | 'MAIN' | 'MTX' | 'MON'> = {
    bus: 'BUS',
    main: 'MAIN',
    mtx: 'MTX',
    mon: 'MON',
  };
  const outSrcGrp = busGroupMap[input.busKind];

  if (input.hasOriginBaseline) {
    if (input.busKind === 'mon' && input.monitorSourceRef) {
      entries.push(
        createStagedEntry(
          input.originConsoleId,
          `Set Monitor ${input.busIndex} source tap → ${input.monitorSourceRef}`,
          {
            type: 'set-monitor-source',
            monitorIndex: input.busIndex === 2 ? 2 : 1,
            sourceRef: input.monitorSourceRef,
          },
        ),
      );
    } else if (input.busKind !== 'mon' && (input.busName !== undefined || input.busMono !== undefined || input.busColorIndex !== undefined)) {
      entries.push(
        createStagedEntry(
          input.originConsoleId,
          `Update ${input.busKind.toUpperCase()} ${input.busIndex}${input.busName ? ` "${input.busName}"` : ''}`,
          {
            type: 'set-bus',
            kind: input.busKind,
            index: input.busIndex,
            name: input.busName,
            mono: input.busKind === 'bus' ? input.busMono : undefined,
            colorIndex: input.busColorIndex,
          },
        ),
      );
    }

    // Patch L (or Mono) output slot
    const leftEncoded = encodeStereoSlot(input.busIndex, 'L');
    entries.push(
      createStagedEntry(
        input.originConsoleId,
        `Patch Out ${input.originOutGroup}.${input.originOutSlot} ← ${outSrcGrp} ${input.busIndex}${input.stereoOutput ? ' L' : ''}`,
        {
          type: 'set-output',
          group: input.originOutGroup,
          slot: input.originOutSlot,
          sourceGroup: outSrcGrp,
          sourceSlot: leftEncoded,
        },
      ),
    );

    if (input.stereoOutput) {
      const rightEncoded = encodeStereoSlot(input.busIndex, 'R');
      const rightOutSlot = input.originOutSlot + 1;
      entries.push(
        createStagedEntry(
          input.originConsoleId,
          `Patch Out ${input.originOutGroup}.${rightOutSlot} ← ${outSrcGrp} ${input.busIndex} R`,
          {
            type: 'set-output',
            group: input.originOutGroup,
            slot: rightOutSlot,
            sourceGroup: outSrcGrp,
            sourceSlot: rightEncoded,
          },
        ),
      );
    }
  }

  // Optional cross-console return pass-through (e.g. FOH out.C.48 -> Stage in.C.48 -> Stage out.A.16)
  if (
    input.relayConsoleId &&
    input.hasRelayBaseline &&
    input.relayReceiveGroup &&
    input.relayOutGroup &&
    input.relayOutSlot &&
    input.relayOutSlot > 0
  ) {
    const label = input.relayInputLabel?.trim() || input.busName?.trim() || `${outSrcGrp} ${input.busIndex}`;
    entries.push(
      createStagedEntry(
        input.relayConsoleId,
        `Label return ${input.relayReceiveGroup}.${input.originOutSlot}${input.stereoOutput ? `–${input.originOutSlot + 1}` : ''} "${label}"`,
        {
          type: 'set-input',
          group: input.relayReceiveGroup,
          slot: input.originOutSlot,
          pairStereoSlot: input.stereoOutput,
          name: label,
          mode: input.stereoOutput ? 'ST' : 'M',
        },
      ),
    );
    entries.push(
      createStagedEntry(
        input.relayConsoleId,
        `Relay Return Out ${input.relayOutGroup}.${input.relayOutSlot} ← ${input.relayReceiveGroup}.${input.originOutSlot}`,
        {
          type: 'set-output',
          group: input.relayOutGroup,
          slot: input.relayOutSlot,
          sourceGroup: input.relayReceiveGroup,
          sourceSlot: input.originOutSlot,
        },
      ),
    );
    if (input.stereoOutput) {
      entries.push(
        createStagedEntry(
          input.relayConsoleId,
          `Relay Return Out ${input.relayOutGroup}.${input.relayOutSlot + 1} ← ${input.relayReceiveGroup}.${input.originOutSlot + 1} (R)`,
          {
            type: 'set-output',
            group: input.relayOutGroup,
            slot: input.relayOutSlot + 1,
            sourceGroup: input.relayReceiveGroup,
            sourceSlot: input.originOutSlot + 1,
          },
        ),
      );
    }
  }

  return entries;
}
