export type HardwareNodeKind =
  | 'console'
  | 'stagebox'
  | 'wireless'
  | 'iem'
  | 'media'
  | 'amp'
  | 'external';

export type RigZone =
  | 'Stage'
  | 'Stage Rack'
  | 'FOH Booth'
  | 'Amp Vault'
  | 'Broadcast'
  | 'Custom';

export type TrunkProtocol =
  | 'aes50'
  | 'analog-xlr'
  | 'analog-trs'
  | 'dante'
  | 'usb'
  | 'stageconnect'
  | 'network';

export type PortGroupCode =
  | 'LCL'
  | 'AUX'
  | 'A'
  | 'B'
  | 'C'
  | 'SC'
  | 'USB'
  | 'CRD'
  | 'MOD'
  | 'PLAY'
  | 'REC'
  | 'AES'
  | 'USR'
  | 'OSC'
  | 'ANALOG'
  | 'DANTE'
  | 'NETWORK';

export type PortDirection = 'input' | 'output' | 'bidirectional';

export type ChannelMode = 'M' | 'ST';

export type MixBusKind = 'bus' | 'main' | 'mtx' | 'mon';

export type SourceOrigin = 'snapshot' | 'manual';

export interface Point2D {
  x: number;
  y: number;
}

export interface SignalRef {
  nodeId: string;
  group: PortGroupCode | 'BUS' | 'MAIN' | 'MTX' | 'MON';
  slot: number;
  direction?: 'in' | 'out';
  label?: string;
}

export interface BusSendRef {
  busKind: MixBusKind;
  busIndex: number;
  levelDb?: number;
  mode?: string;
}

export interface ChannelPatch {
  /** Stable deterministic key (e.g. "stage-wing:in:A:1" or "trunk-aes50-a:fwd:1") */
  id: string;
  /** 1-based physical or logical slot number */
  slot: number;
  /** Raw label from console snapshot or hardware default */
  rawName: string;
  mode: ChannelMode;
  stereoSide?: 'L' | 'R';
  gainDb?: number;
  phantom48v?: boolean;
  polarityInverted?: boolean;
  muted?: boolean;
  colorIndex?: number;
  tags?: string;
  /** Console channel strip that consumes this source (e.g. "CH 1", "AUX 2") */
  consoleChannel?: string;
  /** Source console channel name override if different from preamp name */
  channelStripName?: string;
  /** Mix buses fed by this channel strip */
  busSends?: BusSendRef[];
  /** Mains fed by this channel strip (1..4) */
  mainSends?: number[];
  /** What signal feeds this output or trunk channel */
  sourceRef?: SignalRef;
  /** Direct cross-trunk pass-through origin (e.g. out.C.1 <- in.A.1 or out.A.16 <- in.C.48) */
  passthroughFrom?: SignalRef;
  /** Human-readable routing summary for outputs (e.g. "Bus 5 L (Drums)" or "Pass-through: A.1") */
  routeLabel?: string;
}

export interface PortGroup {
  id: string;
  code: PortGroupCode;
  label: string;
  direction: PortDirection;
  capacity: number;
  channels: ChannelPatch[];
}

export interface MixBusSummary {
  /** Stable key, e.g. "stage-wing:bus:5" */
  id: string;
  kind: MixBusKind;
  index: number;
  rawName: string;
  mono: boolean;
  muted: boolean;
  colorIndex?: number;
  tags?: string;
  /** For MON buses: resolved source string like "BUS.7" or "MAIN.1" */
  monitorSource?: {
    kind: MixBusKind;
    index: number;
    rawRef: string;
  };
  /** Output slots fed by this bus */
  outputs: Array<{
    group: PortGroupCode;
    slot: number;
    stereoSide?: 'L' | 'R';
    trunkId?: string;
  }>;
}

export interface ConsoleChannelStrip {
  id: string;
  kind: 'ch' | 'aux';
  index: number;
  rawName: string;
  resolvedName: string;
  clink: boolean;
  colorIndex?: number;
  tags?: string;
  sourceGroup: string;
  sourceSlot: number;
  altSourceGroup?: string;
  altSourceSlot?: number;
  busSends: BusSendRef[];
  mainSends: number[];
}

export interface HardwareNode {
  id: string;
  kind: HardwareNodeKind;
  rawName: string;
  model: string;
  zone: RigZone;
  position: Point2D;
  sourceOrigin: SourceOrigin;
  snapshotCreatorName?: string;
  portGroups: PortGroup[];
  channelStrips?: ConsoleChannelStrip[];
  mixBuses: MixBusSummary[];
}

export interface TrunkConnection {
  id: string;
  label: string;
  protocol: TrunkProtocol;
  sourceNodeId: string;
  sourcePortGroup: PortGroupCode;
  targetNodeId: string;
  targetPortGroup: PortGroupCode;
  sourceOrigin: SourceOrigin;
  /** Forward direction: sourceNode -> targetNode */
  channels: ChannelPatch[];
  /** Return direction: targetNode -> sourceNode */
  returnChannels: ChannelPatch[];
}

export interface NodeAnnotation {
  friendlyName?: string;
  notes?: string;
  zone?: RigZone;
  position?: Point2D;
}

export interface TrunkAnnotation {
  friendlyName?: string;
  cableTag?: string;
  notes?: string;
}

export interface ChannelAnnotation {
  friendlyName?: string;
  cableTag?: string;
  notes?: string;
}

export interface BusAnnotation {
  friendlyName?: string;
  notes?: string;
}

export interface OrphanedAnnotation {
  key: string;
  entityType: 'node' | 'trunk' | 'channel' | 'bus';
  lastKnownName: string;
  friendlyName?: string;
  cableTag?: string;
  notes?: string;
  orphanedAt: string;
  reason: string;
}

export interface AnnotationOverlay {
  nodes: Record<string, NodeAnnotation>;
  trunks: Record<string, TrunkAnnotation>;
  channels: Record<string, ChannelAnnotation>;
  buses: Record<string, BusAnnotation>;
  orphaned: OrphanedAnnotation[];
}

export interface SnapshotMetadata {
  consoleNodeId: string;
  creatorName: string;
  creator: string;
  creatorVersion: string;
  creatorModel: string;
  snapshotType: string;
  fileName: string;
  importedAt: string;
}

export interface RigDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  venue: string;
  updatedAt: string;
  sourceSnapshots: SnapshotMetadata[];
  nodes: HardwareNode[];
  trunks: TrunkConnection[];
  annotations: AnnotationOverlay;
}

export interface TraceTarget {
  type: 'channel' | 'trunk-channel' | 'bus' | 'node';
  nodeId: string;
  trunkId?: string;
  direction?: 'forward' | 'return';
  portDirection?: 'in' | 'out';
  group?: PortGroupCode;
  slot?: number;
  channelId?: string;
  busKind?: MixBusKind;
  busIndex?: number;
  busId?: string;
}

export interface TraceStep {
  order: number;
  nodeId: string;
  nodeLabel: string;
  detail: string;
  trunkId?: string;
  trunkLabel?: string;
  protocol?: TrunkProtocol;
  kind: 'source' | 'trunk' | 'console' | 'bus' | 'passthrough' | 'destination';
}

export interface TraceResult {
  target: TraceTarget;
  title: string;
  subtitle: string;
  activeNodeIds: string[];
  activeTrunkIds: string[];
  activeChannelIds: string[];
  activeBusIds: string[];
  steps: TraceStep[];
}

export interface SearchHit {
  id: string;
  kind: 'node' | 'trunk' | 'channel' | 'bus';
  label: string;
  sublabel: string;
  badge?: string;
  nodeId: string;
  trunkId?: string;
  traceTarget: TraceTarget;
}
