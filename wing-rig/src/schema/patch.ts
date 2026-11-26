import type { ChannelMode, MixBusKind, PortGroupCode, TraceTarget } from './rig';

/**
 * Verified Behringer WING color indices (1..18) used across io.in, ch, aux, bus, main, and mtx.
 */
export const WING_COLORS: Array<{ index: number; name: string; hex: string }> = [
  { index: 1, name: 'Gray / Blue-Gray', hex: '#64748b' },
  { index: 2, name: 'Medium Blue', hex: '#2563eb' },
  { index: 3, name: 'Dark Blue', hex: '#1d4ed8' },
  { index: 4, name: 'Turquoise', hex: '#0891b2' },
  { index: 5, name: 'Green', hex: '#16a34a' },
  { index: 6, name: 'Olive', hex: '#65a30d' },
  { index: 7, name: 'Yellow', hex: '#eab308' },
  { index: 8, name: 'Amber', hex: '#d97706' },
  { index: 9, name: 'Red', hex: '#dc2626' },
  { index: 10, name: 'Coral', hex: '#f97316' },
  { index: 11, name: 'Pink', hex: '#ec4899' },
  { index: 12, name: 'Purple', hex: '#9333ea' },
  { index: 13, name: 'Light Gray', hex: '#94a3b8' },
  { index: 14, name: 'Light Blue', hex: '#38bdf8' },
  { index: 15, name: 'Mint', hex: '#10b981' },
  { index: 16, name: 'Light Yellow', hex: '#facc15' },
  { index: 17, name: 'Light Red', hex: '#f43f5e' },
  { index: 18, name: 'Lavender', hex: '#a855f7' },
];

export type SnapOutputSourceGroup =
  | PortGroupCode
  | 'BUS'
  | 'MAIN'
  | 'MTX'
  | 'MON'
  | 'OFF';

/**
 * Canonical, UI-decoupled mutation operations that compile into surgical JSON patches
 * against a Behringer WING .snap baseline (`ae_data.*`) without touching EQ/FX/ce_data.
 */
export type SnapPatchOp =
  | {
      type: 'set-input';
      group: PortGroupCode;
      slot: number;
      /** When mode === 'ST', automatically mirrors name/mode/gain/vph/col/tags to the paired slot */
      pairStereoSlot?: boolean;
      name?: string;
      mode?: ChannelMode;
      gainDb?: number;
      phantom48v?: boolean;
      polarityInverted?: boolean;
      muted?: boolean;
      colorIndex?: number;
      tags?: string;
    }
  | {
      type: 'set-output';
      group: PortGroupCode;
      slot: number;
      sourceGroup: SnapOutputSourceGroup;
      /** 1-based input slot, or encoded stereo slot for BUS (1..32), MAIN (1..8), MTX (1..16), MON (1..4) */
      sourceSlot: number;
    }
  | {
      type: 'set-channel-strip';
      kind: 'ch' | 'aux';
      index: number;
      name?: string;
      clink?: boolean;
      colorIndex?: number;
      tags?: string;
      sourceGroup?: PortGroupCode | 'OFF';
      sourceSlot?: number;
      altSourceGroup?: PortGroupCode | 'OFF';
      altSourceSlot?: number;
      busSendToggles?: Record<number, boolean>;
      mainSendToggles?: Record<number, boolean>;
    }
  | {
      type: 'set-bus';
      kind: 'bus' | 'main' | 'mtx';
      index: number;
      name?: string;
      mono?: boolean;
      muted?: boolean;
      colorIndex?: number;
      tags?: string;
    }
  | {
      type: 'set-monitor-source';
      monitorIndex: 1 | 2;
      /** e.g. "BUS.7", "MAIN.1", "MTX.1", or "OFF" */
      sourceRef: string;
    };

export interface StagedPatchEntry {
  id: string;
  consoleNodeId: string;
  createdAt: string;
  summary: string;
  /** Exact verified .snap JSON path(s) affected for diff transparency */
  jsonPaths: string[];
  /** True when this operation toggles +48V phantom power */
  touchesPhantom48v?: boolean;
  op: SnapPatchOp;
}

export interface ConsoleBaselineRecord {
  consoleNodeId: string;
  fileName: string;
  creatorName: string;
  snapshotType: string;
  creatorVersion: string;
  byteLength: number;
  importedAt: string;
  rawJson: string;
}

export interface ConsoleBaselineMeta {
  consoleNodeId: string;
  fileName: string;
  creatorName: string;
  snapshotType: string;
  creatorVersion: string;
  byteLength: number;
  importedAt: string;
}

/**
 * Defines how two consoles in the rig are linked for dual-console source splitting,
 * return pass-throughs, and cross-console path verification.
 */
export interface ConsoleLinkConfig {
  /** Primary / stage-side console (e.g. "stage-wing") */
  stageConsoleId: string;
  /** Secondary / FOH-side console (e.g. "foh-wing"), optional in single-console rigs */
  fohConsoleId?: string;
  /** Port group on Stage console sending splits to FOH (e.g. "C") */
  stageSplitPort: PortGroupCode;
  /** Port group on FOH console receiving splits from Stage (e.g. "C" or "A") */
  fohReceivePort: PortGroupCode;
  /** Console ID that owns physical stagebox preamp gain & +48V */
  headampOwnerConsoleId: string;
}

export type AuditSeverity = 'error' | 'warning' | 'info';

export interface PathAuditIssue {
  id: string;
  severity: AuditSeverity;
  code:
    | 'DEAD_END_SPLIT'
    | 'FOH_UNPATCHED_SPLIT'
    | 'STEREO_MISMATCH'
    | 'LABEL_DRIFT'
    | 'UNROUTED_BUS'
    | 'PHANTOM_CHANGE'
    | 'MISSING_BASELINE';
  title: string;
  detail: string;
  consoleNodeId?: string;
  traceTarget?: TraceTarget;
  /** Optional 1-click auto-fix operations */
  suggestedFixes?: Array<{
    consoleNodeId: string;
    summary: string;
    op: SnapPatchOp;
  }>;
}

export interface BusOutputSpec {
  kind: MixBusKind;
  index: number;
  side?: 'L' | 'R';
}
