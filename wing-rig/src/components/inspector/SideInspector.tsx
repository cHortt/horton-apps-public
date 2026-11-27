import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Cable,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit3,
  GitBranch,
  Layers,
  PanelRightClose,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import type {
  BusAnnotation,
  ChannelAnnotation,
  ConsoleChannelStrip,
  HardwareNode,
  MixBusKind,
  MixBusSummary,
  NodeAnnotation,
  PortGroupCode,
  RigDocument,
  RigZone,
  TraceResult,
  TraceTarget,
  TrunkAnnotation,
  TrunkConnection,
} from '../../schema/rig';
import type { PathAuditIssue } from '../../schema/patch';
import {
  PROTOCOL_META,
  buildNodeTopologySummary,
  formatGain,
  portCodeToProtocol,
  resolveBusName,
  resolveNodeName,
  resolveNodeZone,
  resolveTrunkCableTag,
  resolveTrunkName,
  traceSignal,
} from '../../schema/helpers';
import type { SelectionState } from '../../store/useRigStore';
import {
  ZONE_ORDER,
  buildNodePassthroughInputSet,
  collapseBusOutputs,
  compactNodeTabLabel,
  countBusSenders,
  countRigPhantomChannels,
  filterInspectorRows,
  findIndirectMonitorsForBus,
  findStripSourceChannel,
  getConnectedTrunkChips,
  groupInspectorChannels,
  groupNodesByZone,
  padSlot,
  type InspectorChannelRow,
  type InspectorFacet,
} from './inspectorHelpers';

export interface SideInspectorProps {
  rig: RigDocument;
  auditIssues?: PathAuditIssue[];
  lockedReadOnly?: boolean;
  editMode: boolean;
  isDark: boolean;
  selection: SelectionState;
  trace: TraceResult | null;
  onSelectNode: (id: string) => void;
  onSelectTrunk: (id: string) => void;
  onClearSelection: () => void;
  onClearTrace: () => void;
  onCollapse: () => void;
  onRunTrace: (target: TraceTarget) => void;
  onTraceOnSchematic?: (target: TraceTarget) => void;
  onUpdateNodeAnnotation: (nodeId: string, patch: Partial<NodeAnnotation>) => void;
  onUpdateTrunkAnnotation: (trunkId: string, patch: Partial<TrunkAnnotation>) => void;
  onUpdateChannelAnnotation: (channelId: string, patch: Partial<ChannelAnnotation>) => void;
  onUpdateBusAnnotation: (busId: string, patch: Partial<BusAnnotation>) => void;
  onDismissOrphan: (key: string) => void;
  onDeleteManualNode: (nodeId: string) => void;
  onDeleteManualTrunk: (trunkId: string) => void;
  onOpenSnapImport: () => void;
  onResetDemo: () => void;
}

const PORT_DISPLAY_LABELS: Partial<Record<PortGroupCode, string>> = {
  A: 'AES50-A',
  B: 'AES50-B',
  C: 'AES50-C',
  LCL: 'Local XLR',
  AUX: 'Aux TRS',
  SC: 'StageCONNECT',
  USB: 'USB Audio',
  CRD: 'WING-LIVE Card',
  MOD: 'Expansion / Dante',
  AES: 'AES/EBU',
  PLAY: 'USB Player',
  REC: 'USB Recorder',
};

function formatPortDropdownLabel(code: PortGroupCode): string {
  return PORT_DISPLAY_LABELS[code] ?? code;
}

const STATUS_TONE_BADGE: Record<'sky' | 'indigo' | 'rose' | 'amber' | 'slate', string> = {
  sky: 'bg-sky-50 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800/80',
  indigo:
    'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/80',
  rose: 'bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/80',
  amber:
    'bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/80',
  slate:
    'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
};

export function SideInspector(props: SideInspectorProps) {
  const { rig, selection } = props;

  const selectedNode =
    selection?.type === 'node' ? rig.nodes.find((n) => n.id === selection.id) : undefined;
  const selectedTrunk =
    selection?.type === 'trunk' ? rig.trunks.find((t) => t.id === selection.id) : undefined;

  if (selectedTrunk) {
    return <TrunkInspectorView key={selectedTrunk.id} {...props} trunk={selectedTrunk} />;
  }
  if (selectedNode) {
    return <NodeInspectorView key={selectedNode.id} {...props} node={selectedNode} />;
  }
  return <OverviewInspectorView {...props} />;
}

// =============================================================================
// Shared Scannable Channel Row with Progressive Disclosure & Inline Edit
// =============================================================================

interface ChannelInspectorRowProps {
  rig: RigDocument;
  row: InspectorChannelRow;
  isOutputView: boolean;
  editMode: boolean;
  isTraced: boolean;
  isExpanded: boolean;
  traceTarget: TraceTarget;
  onToggleExpandAndTrace: () => void;
  onSelectNode: (id: string) => void;
  onSelectTrunk: (id: string) => void;
  onUpdateChannelAnnotation: (channelId: string, patch: Partial<ChannelAnnotation>) => void;
}

function ChannelInspectorRow({
  rig,
  row,
  isOutputView,
  editMode,
  isTraced,
  isExpanded,
  traceTarget,
  onToggleExpandAndTrace,
  onSelectNode,
  onSelectTrunk,
  onUpdateChannelAnnotation,
}: ChannelInspectorRowProps) {
  const [editing, setEditing] = useState(false);
  const channel = row.primary;
  const ann = rig.annotations.channels[channel.id];
  const partnerAnn = row.partner ? rig.annotations.channels[row.partner.id] : undefined;

  const [friendlyDraft, setFriendlyDraft] = useState(ann?.friendlyName ?? '');
  const [cableDraft, setCableDraft] = useState(ann?.cableTag ?? '');
  const [notesDraft, setNotesDraft] = useState(ann?.notes ?? '');

  // Close inline edit form cleanly if Edit Mode is turned off
  useEffect(() => {
    if (!editMode && editing) {
      setEditing(false);
    }
  }, [editMode, editing]);

  const inlineTrace = useMemo(
    () => (isExpanded ? traceSignal(rig, traceTarget) : null),
    [isExpanded, rig, traceTarget],
  );

  const openEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFriendlyDraft(ann?.friendlyName ?? '');
    setCableDraft(ann?.cableTag ?? '');
    setNotesDraft(ann?.notes ?? '');
    setEditing(true);
  };

  const saveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateChannelAnnotation(channel.id, {
      friendlyName: friendlyDraft.trim() || undefined,
      cableTag: cableDraft.trim() || undefined,
      notes: notesDraft.trim() || undefined,
    });
    setEditing(false);
  };

  const effectiveCableTag = ann?.cableTag || partnerAnn?.cableTag;
  const effectiveNotes = ann?.notes || partnerAnn?.notes;
  const showRawAlias = Boolean(
    ann?.friendlyName?.trim() && row.rawBaseName && row.rawBaseName !== row.displayName,
  );
  const hasGain = !isOutputView && channel.gainDb !== undefined;

  return (
    <div
      className={`border-b border-slate-100 dark:border-slate-800/80 last:border-b-0 transition-colors ${
        isTraced
          ? 'bg-sky-50/90 dark:bg-sky-950/50'
          : 'hover:bg-slate-50/90 dark:hover:bg-slate-800/50'
      }`}
    >
      {/* Compact 1-line aligned summary row */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleExpandAndTrace}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpandAndTrace();
          }
        }}
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
      >
        {/* Col 1: Fixed-width tabular slot badge */}
        <span
          className={`inline-flex h-5 shrink-0 items-center justify-center rounded-[1px] font-mono text-[11px] font-semibold tabular-nums ${
            row.isStereoPair ? 'w-11' : 'w-7'
          } ${
            isTraced
              ? 'bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}
        >
          {row.slotLabel}
        </span>

        {/* Col 2: Name + concise exception indicators only */}
        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          <span
            title={row.displayName}
            className="text-[12.5px] font-semibold text-slate-900 dark:text-slate-100 truncate"
          >
            {row.displayName}
          </span>
          {row.isStereoPair ? (
            <span className="inline-flex shrink-0 items-center rounded-[1px] bg-indigo-50 dark:bg-indigo-950/70 px-1 py-0 font-mono text-[9.5px] font-semibold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80">
              ST
            </span>
          ) : (
            channel.mode === 'ST' && (
              <span className="inline-flex shrink-0 items-center rounded-[1px] bg-indigo-50 dark:bg-indigo-950/70 px-1 py-0 font-mono text-[9.5px] font-semibold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80">
                ST{channel.stereoSide ? `·${channel.stereoSide}` : ''}
              </span>
            )
          )}
          {row.phantom48v && (
            <span
              title="+48V Phantom Power ON"
              className="inline-flex shrink-0 items-center gap-0.5 rounded-[1px] bg-rose-50 dark:bg-rose-950/70 px-1 py-0 font-mono text-[9.5px] font-semibold text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/80"
            >
              <Zap className="w-2.5 h-2.5" />
              48V
            </span>
          )}
          {row.polarityInverted && (
            <span
              title="Polarity inverted (Ø)"
              className="inline-flex shrink-0 items-center rounded-[1px] bg-amber-50 dark:bg-amber-950/70 px-1 py-0 font-mono text-[9.5px] font-bold text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80"
            >
              Ø
            </span>
          )}
          {row.muted && (
            <span
              title="Muted"
              className="inline-flex shrink-0 items-center rounded-[1px] bg-rose-100 dark:bg-rose-950 px-1 py-0 font-mono text-[9px] font-bold text-rose-800 dark:text-rose-300"
            >
              MUTE
            </span>
          )}
          {row.isPassthrough && isOutputView && (
            <span
              title="Direct cross-trunk pass-through"
              className="inline-flex shrink-0 items-center rounded-[1px] bg-amber-50 dark:bg-amber-950/70 px-1 py-0 font-mono text-[9px] font-semibold text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80"
            >
              ↔
            </span>
          )}
          {row.hasAnnotation && (
            <span
              title={effectiveCableTag || effectiveNotes || 'Has human annotation'}
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400"
            />
          )}
        </div>

        {/* Col 3: Right-aligned tabular Console Strip / Route + Gain */}
        <div className="flex items-center gap-2 shrink-0">
          {!isOutputView ? (
            <>
              {channel.consoleChannel ? (
                <span className="font-mono text-[10.5px] font-semibold text-sky-700 dark:text-sky-300 tabular-nums">
                  {channel.consoleChannel}
                </span>
              ) : row.isUnpatchedInput ? (
                <span
                  title="Preamp slot has no console strip or direct pass-through assigned"
                  className="font-mono text-[10px] font-medium text-amber-700 dark:text-amber-400"
                >
                  Unpatched
                </span>
              ) : row.routeSummary ? (
                <span
                  title={row.routeSummary}
                  className="max-w-[120px] truncate font-mono text-[10px] text-slate-500 dark:text-slate-400"
                >
                  {row.routeSummary}
                </span>
              ) : null}
              {hasGain && (
                <span
                  className={`w-[48px] text-right font-mono text-[10.5px] tabular-nums ${
                    channel.gainDb && channel.gainDb !== 0
                      ? 'font-medium text-slate-700 dark:text-slate-200'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {formatGain(channel.gainDb)}
                </span>
              )}
            </>
          ) : (
            row.routeSummary && (
              <span
                title={row.routeSummary}
                className="max-w-[148px] truncate font-mono text-[10.5px] text-slate-600 dark:text-slate-300"
              >
                {row.routeSummary}
              </span>
            )
          )}

          <span className="text-slate-400 dark:text-slate-500">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </span>
        </div>
      </div>

      {/* Progressive Disclosure Drawer (Signal hops, preamp specs, human annotations, Edit button) */}
      {isExpanded && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mx-3 mb-2 rounded-[2px] border border-sky-200/90 dark:border-sky-800/70 bg-slate-50/90 dark:bg-[#0b111d] p-2.5 space-y-2 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <GitBranch className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300 truncate">
                Signal Path · Slot {row.slotLabel}
              </span>
              {showRawAlias && (
                <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 truncate">
                  (raw: {row.rawBaseName})
                </span>
              )}
            </div>
            {editMode && !editing && (
              <button
                type="button"
                onClick={openEditor}
                className="inline-flex shrink-0 items-center gap-1 rounded-[1px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-300 cursor-pointer"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            )}
          </div>

          {/* Clickable End-to-End Signal Breadcrumb */}
          {inlineTrace && inlineTrace.steps.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {inlineTrace.steps.map((step, idx) => (
                <div key={`${step.order}-${step.detail}`} className="flex items-center gap-1">
                  {idx > 0 && (
                    <ArrowRight className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (step.trunkId) onSelectTrunk(step.trunkId);
                      else onSelectNode(step.nodeId);
                    }}
                    title={`${step.nodeLabel}: ${step.detail}`}
                    className="rounded-[1px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-300 cursor-pointer"
                  >
                    <span className="font-semibold">{step.nodeLabel}</span>
                    <span className="text-slate-500 dark:text-slate-400"> · {step.detail}</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Compact Technical Specs Strip */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200/80 dark:border-slate-800 pt-1.5 text-[11px] text-slate-600 dark:text-slate-300">
            {row.isStereoPair && row.partner && (
              <span>
                Pair:{' '}
                <strong className="font-mono text-slate-900 dark:text-slate-100">
                  {channel.slot} (L) + {row.partner.slot} (R)
                </strong>
              </span>
            )}
            {channel.gainDb !== undefined && (
              <span>
                Gain:{' '}
                <strong className="font-mono text-slate-900 dark:text-slate-100">
                  {formatGain(channel.gainDb)}
                </strong>
              </span>
            )}
            {row.phantom48v && (
              <span className="font-mono font-semibold text-rose-700 dark:text-rose-400">
                ⚡ +48V ON
              </span>
            )}
            {row.polarityInverted && (
              <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">
                Ø Inverted
              </span>
            )}
            {channel.consoleChannel && (
              <span>
                Strip:{' '}
                <strong className="font-mono text-sky-700 dark:text-sky-300">
                  {channel.consoleChannel}
                  {channel.channelStripName ? ` (${channel.channelStripName})` : ''}
                </strong>
              </span>
            )}
            {channel.busSends && channel.busSends.length > 0 && (
              <span>
                Sends:{' '}
                <strong className="font-mono text-slate-900 dark:text-slate-100">
                  {channel.busSends.length} bus{channel.busSends.length === 1 ? '' : 'es'}
                </strong>
              </span>
            )}
            {row.routeSummary && (
              <span className="font-mono text-[10.5px] text-slate-700 dark:text-slate-200">
                {row.routeSummary}
              </span>
            )}
          </div>

          {/* Layer 2 Human Cable Tag & Notes */}
          {(effectiveCableTag || effectiveNotes) && !editing && (
            <div className="flex flex-wrap items-center gap-2 rounded-[1px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] px-2 py-1.5 text-[11px]">
              {effectiveCableTag && (
                <span className="inline-flex items-center gap-1 rounded-[1px] bg-amber-50 dark:bg-amber-950/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80">
                  <Cable className="w-3 h-3" />
                  {effectiveCableTag}
                </span>
              )}
              {effectiveNotes && (
                <span className="text-slate-600 dark:text-slate-300 italic">{effectiveNotes}</span>
              )}
            </div>
          )}

          {/* Inline Edit Form (only in Edit Mode on explicit click) */}
          {editing && (
            <form
              onSubmit={saveEdit}
              className="rounded-[2px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] p-2.5 space-y-2"
            >
              {row.isStereoPair && (
                <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                  Editing primary slot <span className="font-mono font-semibold">{channel.slot}</span>{' '}
                  (turn off <span className="font-mono">ST Pairs</span> to annotate L/R separately).
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                    Friendly Label
                  </label>
                  <input
                    type="text"
                    value={friendlyDraft}
                    onChange={(e) => setFriendlyDraft(e.target.value)}
                    placeholder={channel.rawName}
                    className="mt-0.5 w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#0b111d] px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                    Cable / Snake Tag
                  </label>
                  <input
                    type="text"
                    value={cableDraft}
                    onChange={(e) => setCableDraft(e.target.value)}
                    placeholder="e.g. XLR-STG-01"
                    className="mt-0.5 w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#0b111d] px-2 py-1 font-mono text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Notes
                </label>
                <input
                  type="text"
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="DI box, stage position, phantom notes..."
                  className="mt-0.5 w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#0b111d] px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-[1px] bg-slate-900 dark:bg-sky-500 px-2.5 py-1 text-[11px] font-medium text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-sky-400 cursor-pointer"
                >
                  <Check className="w-3 h-3" />
                  Save
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Trunk Inspector View
// =============================================================================

function TrunkInspectorView({
  rig,
  trunk,
  editMode,
  isDark,
  trace,
  onClearSelection,
  onCollapse,
  onRunTrace,
  onUpdateTrunkAnnotation,
  onUpdateChannelAnnotation,
  onDeleteManualTrunk,
  onSelectNode,
  onSelectTrunk,
}: SideInspectorProps & { trunk: TrunkConnection }) {
  const [directionTab, setDirectionTab] = useState<'forward' | 'return'>('forward');
  const [filter, setFilter] = useState('');
  const [facet, setFacet] = useState<InspectorFacet | null>(null);
  const [groupStereo, setGroupStereo] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);

  const proto = PROTOCOL_META[trunk.protocol];
  const srcNode = rig.nodes.find((n) => n.id === trunk.sourceNodeId);
  const tgtNode = rig.nodes.find((n) => n.id === trunk.targetNodeId);
  const srcName = srcNode ? resolveNodeName(rig, srcNode) : trunk.sourceNodeId;
  const tgtName = tgtNode ? resolveNodeName(rig, tgtNode) : trunk.targetNodeId;
  const ann = rig.annotations.trunks[trunk.id];
  const cableTag = resolveTrunkCableTag(rig, trunk);
  const tracedChannelIds = useMemo(() => new Set(trace?.activeChannelIds ?? []), [trace]);

  const effectiveDir: 'forward' | 'return' =
    directionTab === 'return' && trunk.returnChannels.length > 0 ? 'return' : 'forward';

  const activeList = effectiveDir === 'return' ? trunk.returnChannels : trunk.channels;

  const groupedRows = useMemo(
    () =>
      groupInspectorChannels(rig, activeList, {
        groupStereo,
        isConsoleInput: false,
      }),
    [rig, activeList, groupStereo],
  );

  const facetCounts = useMemo(
    () => ({
      phantom: groupedRows.filter((r) => r.phantom48v).length,
      passthrough: groupedRows.filter((r) => r.isPassthrough).length,
      notes: groupedRows.filter((r) => r.hasAnnotation).length,
      traced: groupedRows.filter((r) => r.channelIds.some((id) => tracedChannelIds.has(id))).length,
    }),
    [groupedRows, tracedChannelIds],
  );

  const filteredRows = useMemo(
    () => filterInspectorRows(rig, groupedRows, { query: filter, facet, tracedChannelIds }),
    [rig, groupedRows, filter, facet, tracedChannelIds],
  );

  const toggleFacet = (next: InspectorFacet) => {
    setFacet((cur) => (cur === next ? null : next));
  };

  return (
    <aside className="flex h-full w-full flex-col border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
      {/* Compact Header */}
      <div className="border-b border-slate-200 dark:border-slate-800 px-3.5 py-2.5 shrink-0">
        {/* Top Breadcrumb + Protocol + Actions */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClearSelection}
            className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Rig Overview</span>
          </button>

          <div className="flex items-center gap-1.5">
            <span
              style={{
                backgroundColor: isDark ? proto.darkBg : proto.bg,
                color: isDark ? proto.darkText : proto.text,
                borderColor: isDark ? proto.darkBorder : proto.border,
              }}
              className="inline-flex items-center rounded-[1px] border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase"
            >
              {proto.shortLabel}
            </span>
            {cableTag && (
              <span className="hidden sm:inline-flex items-center gap-1 rounded-[1px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:text-slate-300">
                <Cable className="w-2.5 h-2.5" />
                {cableTag}
              </span>
            )}
            {editMode && trunk.sourceOrigin === 'manual' && (
              <button
                type="button"
                title="Delete manual trunk"
                onClick={() => onDeleteManualTrunk(trunk.id)}
                className="rounded-[2px] p-1 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              title="Collapse Rig Inspector"
              aria-label="Collapse Rig Inspector"
              onClick={onCollapse}
              className="rounded-[2px] p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Identity Row + Collapsible Cable Info/Edit Trigger */}
        <div className="mt-1.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              {resolveTrunkName(rig, trunk)}
            </h2>
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
              <button
                type="button"
                onClick={() => srcNode && onSelectNode(srcNode.id)}
                className="font-medium text-slate-700 dark:text-slate-200 hover:text-sky-700 dark:hover:text-sky-400 hover:underline cursor-pointer"
              >
                {compactNodeTabLabel(srcName)} ({trunk.sourcePortGroup})
              </button>
              {trunk.returnChannels.length > 0 ? (
                <ArrowLeftRight className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
              ) : (
                <ArrowRight className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => tgtNode && onSelectNode(tgtNode.id)}
                className="font-medium text-slate-700 dark:text-slate-200 hover:text-sky-700 dark:hover:text-sky-400 hover:underline cursor-pointer"
              >
                {compactNodeTabLabel(tgtName)} ({trunk.targetPortGroup})
              </button>
            </div>
          </div>

          {(editMode || ann?.notes || cableTag) && (
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              className={`shrink-0 inline-flex items-center gap-1 rounded-[2px] border px-2 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                editMode
                  ? 'border-amber-300 dark:border-amber-700/80 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-950'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {editMode ? (
                <>
                  <Pencil className="w-3 h-3" />
                  <span>{detailsOpen ? 'Done' : 'Edit Cable'}</span>
                </>
              ) : (
                <span>{detailsOpen ? 'Hide Notes' : 'Cable Info'}</span>
              )}
              {detailsOpen ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
          )}
        </div>

        {/* Collapsible Trunk Notes / Edit Drawer */}
        {detailsOpen && (
          <div className="mt-2 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-2.5 space-y-2">
            {editMode ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                      Friendly Trunk Name
                    </label>
                    <input
                      type="text"
                      value={ann?.friendlyName ?? ''}
                      onChange={(e) =>
                        onUpdateTrunkAnnotation(trunk.id, {
                          friendlyName: e.target.value || undefined,
                        })
                      }
                      placeholder={trunk.label}
                      className="mt-0.5 w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111827] px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                      Physical Cable Tag
                    </label>
                    <input
                      type="text"
                      value={ann?.cableTag ?? ''}
                      onChange={(e) =>
                        onUpdateTrunkAnnotation(trunk.id, {
                          cableTag: e.target.value || undefined,
                        })
                      }
                      placeholder="CAT6-FOH-01"
                      className="mt-0.5 w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111827] px-2 py-1 font-mono text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                    Cable Run Notes
                  </label>
                  <textarea
                    rows={2}
                    value={ann?.notes ?? ''}
                    onChange={(e) =>
                      onUpdateTrunkAnnotation(trunk.id, { notes: e.target.value || undefined })
                    }
                    placeholder="Conduit path, cable length, clock master notes..."
                    className="mt-0.5 w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111827] px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                {ann?.notes && <p className="leading-relaxed">{ann.notes}</p>}
                <div className="font-mono text-[10.5px] text-slate-500 dark:text-slate-400">
                  {proto.label}
                  {cableTag ? ` · Tag: ${cableTag}` : ''}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Endpoint-Labeled Direction Tabs */}
        {trunk.returnChannels.length > 0 && (
          <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0b111d] p-0.5">
            <button
              type="button"
              onClick={() => {
                setDirectionTab('forward');
                setFacet(null);
              }}
              title={`${srcName} → ${tgtName}`}
              className={`rounded-[1px] px-2 py-1 text-[11px] font-semibold truncate transition-colors cursor-pointer ${
                effectiveDir === 'forward'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs border border-slate-200/80 dark:border-slate-700'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {compactNodeTabLabel(srcName)} → {compactNodeTabLabel(tgtName)} ({trunk.channels.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setDirectionTab('return');
                setFacet(null);
              }}
              title={`${tgtName} → ${srcName}`}
              className={`rounded-[1px] px-2 py-1 text-[11px] font-semibold truncate transition-colors cursor-pointer ${
                effectiveDir === 'return'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs border border-slate-200/80 dark:border-slate-700'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {compactNodeTabLabel(tgtName)} → {compactNodeTabLabel(srcName)} ({trunk.returnChannels.length})
            </button>
          </div>
        )}

        {/* Streamlined 2-Row Filter Bar */}
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter slots, names, routes, cable tags..."
                className="w-full rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 pl-8 pr-7 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:bg-white dark:focus:bg-[#090d14] focus:outline-none"
              />
              {filter && (
                <button
                  type="button"
                  aria-label="Clear filter"
                  onClick={() => setFilter('')}
                  className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setGroupStereo((v) => !v)}
              title="Collapse adjacent Stereo L/R slots into single paired rows"
              className={`shrink-0 rounded-[2px] border px-2 py-1.5 font-mono text-[10.5px] font-semibold transition-colors cursor-pointer ${
                groupStereo
                  ? 'border-sky-500/80 bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              ST {groupStereo ? 'ON' : 'OFF'}
            </button>
          </div>

          {(facetCounts.phantom > 0 ||
            facetCounts.passthrough > 0 ||
            facetCounts.notes > 0 ||
            facetCounts.traced > 0 ||
            facet !== null) && (
            <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-0.5">
              {facetCounts.phantom > 0 && (
                <button
                  type="button"
                  onClick={() => toggleFacet('48v')}
                  className={`inline-flex shrink-0 items-center gap-0.5 rounded-[1px] border px-1.5 py-0.5 font-mono text-[10.5px] font-semibold cursor-pointer ${
                    facet === '48v'
                      ? 'border-rose-400 bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                  }`}
                >
                  <Zap className="w-2.5 h-2.5" />
                  48V ({facetCounts.phantom})
                </button>
              )}
              {facetCounts.passthrough > 0 && (
                <button
                  type="button"
                  onClick={() => toggleFacet('passthrough')}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-[1px] border px-1.5 py-0.5 text-[10.5px] font-semibold cursor-pointer ${
                    facet === 'passthrough'
                      ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                  }`}
                >
                  ↔ Pass-thru ({facetCounts.passthrough})
                </button>
              )}
              {facetCounts.notes > 0 && (
                <button
                  type="button"
                  onClick={() => toggleFacet('notes')}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-[1px] border px-1.5 py-0.5 text-[10.5px] font-semibold cursor-pointer ${
                    facet === 'notes'
                      ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                  }`}
                >
                  Notes ({facetCounts.notes})
                </button>
              )}
              {facetCounts.traced > 0 && (
                <button
                  type="button"
                  onClick={() => toggleFacet('traced')}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-[1px] border px-1.5 py-0.5 text-[10.5px] font-semibold cursor-pointer ${
                    facet === 'traced'
                      ? 'border-sky-600 bg-sky-600 text-white dark:bg-sky-500 dark:text-slate-950'
                      : 'border-sky-300 dark:border-sky-700 bg-sky-50/70 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300'
                  }`}
                >
                  <GitBranch className="w-2.5 h-2.5" />
                  Traced ({facetCounts.traced})
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable Channel List */}
      <div className="flex-1 overflow-y-auto">
        {filteredRows.length === 0 ? (
          <div className="p-6 text-center space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No matching channels in this direction.
            </p>
            {(filter || facet) && (
              <button
                type="button"
                onClick={() => {
                  setFilter('');
                  setFacet(null);
                }}
                className="rounded-[2px] border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-sky-700 dark:text-sky-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Reset filters
              </button>
            )}
          </div>
        ) : (
          filteredRows.map((row) => {
            const traceTarget: TraceTarget = {
              type: 'trunk-channel',
              nodeId: effectiveDir === 'return' ? trunk.targetNodeId : trunk.sourceNodeId,
              trunkId: trunk.id,
              direction: effectiveDir,
              slot: row.primary.slot,
              channelId: row.primary.id,
            };
            const isTraced = row.channelIds.some((id) => tracedChannelIds.has(id));
            return (
              <ChannelInspectorRow
                key={row.key}
                rig={rig}
                row={row}
                isOutputView={effectiveDir === 'return' || Boolean(row.primary.sourceRef)}
                editMode={editMode}
                isTraced={isTraced}
                isExpanded={expandedRowKey === row.key}
                traceTarget={traceTarget}
                onSelectNode={onSelectNode}
                onSelectTrunk={onSelectTrunk}
                onUpdateChannelAnnotation={onUpdateChannelAnnotation}
                onToggleExpandAndTrace={() => {
                  setExpandedRowKey((cur) => (cur === row.key ? null : row.key));
                  onRunTrace(traceTarget);
                }}
              />
            );
          })
        )}
      </div>
    </aside>
  );
}

// =============================================================================
// Device / Node Inspector View
// =============================================================================

function NodeInspectorView({
  rig,
  node,
  editMode,
  isDark,
  trace,
  onClearSelection,
  onCollapse,
  onRunTrace,
  onUpdateNodeAnnotation,
  onUpdateChannelAnnotation,
  onUpdateBusAnnotation,
  onDeleteManualNode,
  onSelectNode,
  onSelectTrunk,
}: SideInspectorProps & { node: HardwareNode }) {
  const [tab, setTab] = useState<'io' | 'strips' | 'buses'>('io');
  const [dirFilter, setDirFilter] = useState<'all' | 'input' | 'output'>('all');
  const [portFilter, setPortFilter] = useState<string>('all');
  const [filter, setFilter] = useState('');
  const [facet, setFacet] = useState<InspectorFacet | null>(null);
  const [groupStereo, setGroupStereo] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);

  // Strips tab state
  const [stripKindFilter, setStripKindFilter] = useState<'all' | 'ch' | 'aux'>('all');
  const [stripQuery, setStripQuery] = useState('');
  const [stripPhantomOnly, setStripPhantomOnly] = useState(false);
  const [expandedStripId, setExpandedStripId] = useState<string | null>(null);

  // Buses tab state
  const [busKindFilter, setBusKindFilter] = useState<'all' | MixBusKind>('all');
  const [busQuery, setBusQuery] = useState('');
  const [editingBusId, setEditingBusId] = useState<string | null>(null);

  useEffect(() => {
    if (!editMode && editingBusId) {
      setEditingBusId(null);
    }
  }, [editMode, editingBusId]);

  const ann = rig.annotations.nodes[node.id];
  const displayZone = resolveNodeZone(rig, node);
  const snapshotMeta = rig.sourceSnapshots.find((s) => s.consoleNodeId === node.id);
  const nodeSummary = useMemo(() => buildNodeTopologySummary(rig, node), [rig, node]);
  const tracedChannelIds = useMemo(() => new Set(trace?.activeChannelIds ?? []), [trace]);
  const tracedBusIds = useMemo(() => new Set(trace?.activeBusIds ?? []), [trace]);

  const connectedTrunks = useMemo(() => getConnectedTrunkChips(rig, node), [rig, node]);
  const passthroughInputKeys = useMemo(() => buildNodePassthroughInputSet(node), [node]);

  const strips = node.channelStrips ?? [];
  const hasStrips = strips.length > 0;
  const hasBuses = node.mixBuses.length > 0;
  const totalIoChannels = useMemo(
    () => node.portGroups.reduce((sum, pg) => sum + pg.channels.length, 0),
    [node.portGroups],
  );

  // Distinct directions & port codes on this device
  const hasBothDirections = useMemo(() => {
    const hasIn = node.portGroups.some((pg) => pg.direction !== 'output');
    const hasOut = node.portGroups.some((pg) => pg.direction === 'output');
    return hasIn && hasOut;
  }, [node.portGroups]);

  const portCodes = useMemo(() => {
    const seen = new Set<PortGroupCode>();
    for (const pg of node.portGroups) seen.add(pg.code);
    return [...seen];
  }, [node.portGroups]);

  // Scoped port groups (after Direction + Port filter, BEFORE text/facet filter so facet counts stay accurate)
  const scopedGroupsWithRows = useMemo(() => {
    return node.portGroups
      .filter((pg) => {
        if (dirFilter === 'input') return pg.direction !== 'output';
        if (dirFilter === 'output') return pg.direction === 'output';
        return true;
      })
      .filter((pg) => portFilter === 'all' || pg.code === portFilter)
      .map((pg) => ({
        pg,
        rows: groupInspectorChannels(rig, pg.channels, {
          groupStereo,
          isConsoleInput: node.kind === 'console' && pg.direction !== 'output',
          portCode: pg.code,
          passthroughInputKeys,
        }),
      }));
  }, [node, rig, dirFilter, portFilter, groupStereo, passthroughInputKeys]);

  const facetCounts = useMemo(() => {
    let phantom = 0;
    let passthrough = 0;
    let notes = 0;
    let unpatched = 0;
    let traced = 0;
    for (const { rows } of scopedGroupsWithRows) {
      for (const r of rows) {
        if (r.phantom48v) phantom += 1;
        if (r.isPassthrough) passthrough += 1;
        if (r.hasAnnotation) notes += 1;
        if (r.isUnpatchedInput) unpatched += 1;
        if (r.channelIds.some((id) => tracedChannelIds.has(id))) traced += 1;
      }
    }
    return { phantom, passthrough, notes, unpatched, traced };
  }, [scopedGroupsWithRows, tracedChannelIds]);

  const visiblePortGroups = useMemo(() => {
    return scopedGroupsWithRows
      .map(({ pg, rows }) => ({
        pg,
        rows: filterInspectorRows(rig, rows, { query: filter, facet, tracedChannelIds }),
      }))
      .filter(({ rows }) => rows.length > 0);
  }, [scopedGroupsWithRows, rig, filter, facet, tracedChannelIds]);

  // Strips data enriched with source preamp info
  const enrichedStrips = useMemo(() => {
    return strips.map((strip) => ({
      strip,
      source: findStripSourceChannel(node, strip),
    }));
  }, [strips, node]);

  const stripHasAux = useMemo(() => strips.some((s) => s.kind === 'aux'), [strips]);
  const stripPhantomCount = useMemo(
    () => enrichedStrips.filter((s) => Boolean(s.source?.channel.phantom48v)).length,
    [enrichedStrips],
  );

  const filteredStrips = useMemo(() => {
    const q = stripQuery.trim().toLowerCase();
    return enrichedStrips.filter(({ strip, source }) => {
      if (stripKindFilter !== 'all' && strip.kind !== stripKindFilter) return false;
      if (stripPhantomOnly && !source?.channel.phantom48v) return false;
      if (!q) return true;
      const label = `${strip.kind} ${strip.index}`.toLowerCase();
      const srcStr = `${strip.sourceGroup}.${strip.sourceSlot}`.toLowerCase();
      return (
        strip.resolvedName.toLowerCase().includes(q) ||
        strip.rawName.toLowerCase().includes(q) ||
        label.includes(q) ||
        srcStr.includes(q) ||
        String(strip.index) === q
      );
    });
  }, [enrichedStrips, stripKindFilter, stripPhantomOnly, stripQuery]);

  // Mix buses filter
  const availableBusKinds = useMemo(() => {
    const order: MixBusKind[] = ['bus', 'mtx', 'main', 'mon'];
    return order.filter((k) => node.mixBuses.some((b) => b.kind === k));
  }, [node.mixBuses]);

  const filteredBuses = useMemo(() => {
    const q = busQuery.trim().toLowerCase();
    return node.mixBuses.filter((bus) => {
      if (busKindFilter !== 'all' && bus.kind !== busKindFilter) return false;
      if (!q) return true;
      const name = resolveBusName(rig, bus).toLowerCase();
      const busAnn = rig.annotations.buses[bus.id];
      const outs = bus.outputs.map((o) => `${o.group}.${o.slot}`.toLowerCase()).join(' ');
      return (
        name.includes(q) ||
        `${bus.kind} ${bus.index}`.includes(q) ||
        outs.includes(q) ||
        (bus.monitorSource?.rawRef.toLowerCase().includes(q) ?? false) ||
        (busAnn?.notes?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [node.mixBuses, busKindFilter, busQuery, rig]);

  const toggleFacet = (next: InspectorFacet) => {
    setFacet((cur) => (cur === next ? null : next));
  };

  const tabCount = 1 + (hasStrips ? 1 : 0) + (hasBuses ? 1 : 0);

  return (
    <aside className="flex h-full w-full flex-col border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
      {/* Compact Header */}
      <div className="border-b border-slate-200 dark:border-slate-800 px-3.5 py-2.5 shrink-0">
        {/* Top Breadcrumb + Actions (replaces ambiguous X + Collapse) */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClearSelection}
            className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Rig Overview</span>
          </button>

          <div className="flex items-center gap-1">
            <span
              className={`hidden sm:inline-flex items-center rounded-[1px] border px-1.5 py-0.5 font-mono text-[9.5px] font-semibold ${STATUS_TONE_BADGE[nodeSummary.statusTone]}`}
            >
              {nodeSummary.statusText}
            </span>
            <button
              type="button"
              title="Highlight connected trunks"
              onClick={() => onRunTrace({ type: 'node', nodeId: node.id })}
              className="rounded-[2px] p-1 text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/60 cursor-pointer"
            >
              <GitBranch className="w-3.5 h-3.5" />
            </button>
            {editMode && node.sourceOrigin === 'manual' && (
              <button
                type="button"
                title="Delete manual device"
                onClick={() => onDeleteManualNode(node.id)}
                className="rounded-[2px] p-1 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              title="Collapse Rig Inspector"
              aria-label="Collapse Rig Inspector"
              onClick={onCollapse}
              className="rounded-[2px] p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Compact Identity + Collapsible Details Trigger */}
        <div className="mt-1.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              {resolveNodeName(rig, node)}
            </h2>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
              <span className="font-semibold text-slate-600 dark:text-slate-300">{displayZone}</span>
              <span>·</span>
              <span className="truncate">{node.model}</span>
              {connectedTrunks.length > 0 && (
                <>
                  <span>·</span>
                  <span className="font-mono shrink-0">
                    {connectedTrunks.length} trunk{connectedTrunks.length === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setDetailsOpen((o) => !o)}
            className={`shrink-0 inline-flex items-center gap-1 rounded-[2px] border px-2 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer ${
              editMode
                ? 'border-amber-300 dark:border-amber-700/80 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-950'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {editMode ? (
              <>
                <Pencil className="w-3 h-3" />
                <span>{detailsOpen ? 'Done' : 'Edit Details'}</span>
              </>
            ) : (
              <span>{detailsOpen ? 'Hide Info' : 'Notes & Trunks'}</span>
            )}
            {detailsOpen ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        </div>

        {/* Collapsible Notes, Snapshot Meta, Connected Trunks & Edit Form */}
        {detailsOpen && (
          <div className="mt-2 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-2.5 space-y-2">
            {editMode ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                      Friendly Label
                    </label>
                    <input
                      type="text"
                      value={ann?.friendlyName ?? ''}
                      onChange={(e) =>
                        onUpdateNodeAnnotation(node.id, {
                          friendlyName: e.target.value || undefined,
                        })
                      }
                      placeholder={node.rawName}
                      className="mt-0.5 w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111827] px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                      Zone
                    </label>
                    <select
                      value={displayZone}
                      onChange={(e) =>
                        onUpdateNodeAnnotation(node.id, { zone: e.target.value as RigZone })
                      }
                      className="mt-0.5 w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111827] px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                    >
                      {ZONE_ORDER.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                    Rack / Setup Notes
                  </label>
                  <textarea
                    rows={2}
                    value={ann?.notes ?? ''}
                    onChange={(e) =>
                      onUpdateNodeAnnotation(node.id, { notes: e.target.value || undefined })
                    }
                    placeholder="Clock sync, IP address, power sequence, rack location..."
                    className="mt-0.5 w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111827] px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </>
            ) : (
              <>
                {ann?.notes ? (
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {ann.notes}
                  </p>
                ) : (
                  <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                    No rack/setup notes recorded.
                  </p>
                )}
                {snapshotMeta && (
                  <div className="font-mono text-[10.5px] text-sky-700 dark:text-sky-400">
                    Synced: {snapshotMeta.fileName} ({snapshotMeta.creator}{' '}
                    {snapshotMeta.creatorVersion})
                  </div>
                )}
              </>
            )}

            {connectedTrunks.length > 0 && (
              <div className="pt-1.5 border-t border-slate-200 dark:border-slate-700/80">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Connected Trunks
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {connectedTrunks.map((chip) => {
                    const p = PROTOCOL_META[chip.protocol];
                    return (
                      <button
                        key={chip.trunk.id}
                        type="button"
                        onClick={() => onSelectTrunk(chip.trunk.id)}
                        title={`${chip.name} (${chip.portCode} ${chip.directionArrow} ${chip.peerName})`}
                        className="inline-flex items-center gap-1 rounded-[1px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] px-2 py-0.5 font-mono text-[10.5px] text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-300 cursor-pointer"
                      >
                        <span
                          style={{ backgroundColor: isDark ? p.darkColor : p.color }}
                          className="h-2 w-2 rounded-full shrink-0"
                        />
                        <span className="font-semibold">{chip.portCode}</span>
                        <span className="text-slate-400">{chip.directionArrow}</span>
                        <span className="truncate max-w-[110px]">
                          {compactNodeTabLabel(chip.peerName)}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500">
                          ({chip.countSummary})
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Segmented Tab Bar: I/O Jacks | Strips | Buses */}
        {tabCount > 1 && (
          <div
            className={`mt-2.5 grid gap-1 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0b111d] p-0.5 ${
              tabCount === 3 ? 'grid-cols-3' : 'grid-cols-2'
            }`}
          >
            <button
              type="button"
              onClick={() => setTab('io')}
              className={`rounded-[1px] px-2 py-1 text-[11.5px] font-semibold transition-colors cursor-pointer ${
                tab === 'io'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs border border-slate-200/80 dark:border-slate-700'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              I/O ({totalIoChannels})
            </button>
            {hasStrips && (
              <button
                type="button"
                onClick={() => setTab('strips')}
                className={`rounded-[1px] px-2 py-1 text-[11.5px] font-semibold transition-colors cursor-pointer ${
                  tab === 'strips'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs border border-slate-200/80 dark:border-slate-700'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Strips ({strips.length})
              </button>
            )}
            {hasBuses && (
              <button
                type="button"
                onClick={() => setTab('buses')}
                className={`rounded-[1px] px-2 py-1 text-[11.5px] font-semibold transition-colors cursor-pointer ${
                  tab === 'buses'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs border border-slate-200/80 dark:border-slate-700'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Buses ({node.mixBuses.length})
              </button>
            )}
          </div>
        )}

        {/* Tab-Specific Compact Filter Toolbar */}
        {tab === 'io' && (
          <div className="mt-2 space-y-1.5">
            {/* Row 1: Search + Clear + ST Pairs Toggle */}
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search slot, name, CH #, tag..."
                  className="w-full rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 pl-8 pr-7 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:bg-white dark:focus:bg-[#090d14] focus:outline-none"
                />
                {filter && (
                  <button
                    type="button"
                    aria-label="Clear filter"
                    onClick={() => setFilter('')}
                    className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setGroupStereo((v) => !v)}
                title="Collapse adjacent Stereo L/R slots into single paired rows"
                className={`shrink-0 rounded-[2px] border px-2 py-1.5 font-mono text-[10.5px] font-semibold transition-colors cursor-pointer ${
                  groupStereo
                    ? 'border-sky-500/80 bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                ST {groupStereo ? 'ON' : 'OFF'}
              </button>
            </div>

            {/* Row 2: Direction Toggle + Port Select + 1-Click Facet Pills (single scrollable row) */}
            {(hasBothDirections ||
              portCodes.length > 1 ||
              facetCounts.phantom > 0 ||
              facetCounts.passthrough > 0 ||
              facetCounts.notes > 0 ||
              facetCounts.unpatched > 0 ||
              facetCounts.traced > 0) && (
              <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-0.5">
                {hasBothDirections && (
                  <div className="inline-flex shrink-0 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0b111d] p-0.5 text-[10.5px]">
                    {(
                      [
                        ['all', 'All'],
                        ['input', 'IN'],
                        ['output', 'OUT'],
                      ] as const
                    ).map(([k, lbl]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setDirFilter(k)}
                        className={`rounded-[1px] px-1.5 py-0.5 font-semibold cursor-pointer ${
                          dirFilter === k
                            ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                )}

                {portCodes.length > 1 && (
                  <select
                    aria-label="Filter by port group"
                    value={portFilter}
                    onChange={(e) => setPortFilter(e.target.value)}
                    className="shrink-0 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-slate-700 dark:text-slate-200 focus:border-sky-500 focus:outline-none cursor-pointer"
                  >
                    <option value="all">All Ports ({portCodes.length})</option>
                    {portCodes.map((code) => (
                      <option key={code} value={code}>
                        {formatPortDropdownLabel(code)}
                      </option>
                    ))}
                  </select>
                )}

                {facetCounts.phantom > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleFacet('48v')}
                    className={`inline-flex shrink-0 items-center gap-0.5 rounded-[1px] border px-1.5 py-0.5 font-mono text-[10.5px] font-semibold cursor-pointer ${
                      facet === '48v'
                        ? 'border-rose-400 bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                    }`}
                  >
                    <Zap className="w-2.5 h-2.5" />
                    48V ({facetCounts.phantom})
                  </button>
                )}

                {facetCounts.passthrough > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleFacet('passthrough')}
                    className={`inline-flex shrink-0 items-center gap-1 rounded-[1px] border px-1.5 py-0.5 text-[10.5px] font-semibold cursor-pointer ${
                      facet === 'passthrough'
                        ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                    }`}
                  >
                    ↔ Split ({facetCounts.passthrough})
                  </button>
                )}

                {facetCounts.notes > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleFacet('notes')}
                    className={`inline-flex shrink-0 items-center gap-1 rounded-[1px] border px-1.5 py-0.5 text-[10.5px] font-semibold cursor-pointer ${
                      facet === 'notes'
                        ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                    }`}
                  >
                    Notes ({facetCounts.notes})
                  </button>
                )}

                {facetCounts.unpatched > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleFacet('unpatched')}
                    className={`inline-flex shrink-0 items-center gap-1 rounded-[1px] border px-1.5 py-0.5 text-[10.5px] font-semibold cursor-pointer ${
                      facet === 'unpatched'
                        ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                    }`}
                  >
                    ⚠ Unpatched ({facetCounts.unpatched})
                  </button>
                )}

                {facetCounts.traced > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleFacet('traced')}
                    className={`inline-flex shrink-0 items-center gap-1 rounded-[1px] border px-1.5 py-0.5 text-[10.5px] font-semibold cursor-pointer ${
                      facet === 'traced'
                        ? 'border-sky-600 bg-sky-600 text-white dark:bg-sky-500 dark:text-slate-950'
                        : 'border-sky-300 dark:border-sky-700 bg-sky-50/70 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300'
                    }`}
                  >
                    <GitBranch className="w-2.5 h-2.5" />
                    Traced ({facetCounts.traced})
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'strips' && (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  value={stripQuery}
                  onChange={(e) => setStripQuery(e.target.value)}
                  placeholder="Search CH #, AUX #, name, source..."
                  className="w-full rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 pl-8 pr-7 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:bg-white dark:focus:bg-[#090d14] focus:outline-none"
                />
                {stripQuery && (
                  <button
                    type="button"
                    aria-label="Clear strip filter"
                    onClick={() => setStripQuery('')}
                    className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {stripHasAux && (
                <div className="inline-flex shrink-0 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0b111d] p-0.5 text-[10.5px]">
                  {(['all', 'ch', 'aux'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setStripKindFilter(k)}
                      className={`rounded-[1px] px-1.5 py-0.5 font-mono uppercase font-semibold cursor-pointer ${
                        stripKindFilter === k
                          ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}

              {stripPhantomCount > 0 && (
                <button
                  type="button"
                  onClick={() => setStripPhantomOnly((v) => !v)}
                  className={`inline-flex shrink-0 items-center gap-0.5 rounded-[2px] border px-1.5 py-1 font-mono text-[10.5px] font-semibold cursor-pointer ${
                    stripPhantomOnly
                      ? 'border-rose-400 bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Zap className="w-2.5 h-2.5" />
                  48V
                </button>
              )}
            </div>
          </div>
        )}

        {tab === 'buses' && (
          <div className="mt-2 flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                value={busQuery}
                onChange={(e) => setBusQuery(e.target.value)}
                placeholder="Filter buses, IEMs, outputs..."
                className="w-full rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 pl-8 pr-7 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:bg-white dark:focus:bg-[#090d14] focus:outline-none"
              />
              {busQuery && (
                <button
                  type="button"
                  aria-label="Clear bus filter"
                  onClick={() => setBusQuery('')}
                  className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {availableBusKinds.length > 1 && (
              <div className="inline-flex shrink-0 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0b111d] p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setBusKindFilter('all')}
                  className={`rounded-[1px] px-1.5 py-0.5 font-mono uppercase font-semibold cursor-pointer ${
                    busKindFilter === 'all'
                      ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  All
                </button>
                {availableBusKinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setBusKindFilter(k)}
                    className={`rounded-[1px] px-1.5 py-0.5 font-mono uppercase font-semibold cursor-pointer ${
                      busKindFilter === k
                        ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'io' ? (
          visiblePortGroups.length === 0 ? (
            <div className="p-6 text-center space-y-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No matching channels on this device.
              </p>
              {(filter || facet || dirFilter !== 'all' || portFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter('');
                    setFacet(null);
                    setDirFilter('all');
                    setPortFilter('all');
                  }}
                  className="rounded-[2px] border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-sky-700 dark:text-sky-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            visiblePortGroups.map(({ pg, rows }) => {
              const proto = PROTOCOL_META[portCodeToProtocol(pg.code)];
              const accent = isDark ? proto.darkColor : proto.color;
              return (
                <div key={pg.id}>
                  <div className="sticky top-0 z-10 flex items-center justify-between border-y border-slate-200 dark:border-slate-800 bg-slate-50/95 dark:bg-[#090d14]/95 backdrop-blur-xs px-3 py-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        style={{ backgroundColor: accent }}
                        className="h-3 w-1 shrink-0 rounded-[0.5px]"
                      />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 truncate">
                        {pg.label}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
                      {pg.direction === 'output' ? 'OUT' : 'IN'} · {pg.channels.length}/{pg.capacity}
                    </span>
                  </div>
                  {rows.map((row) => {
                    const traceTarget: TraceTarget = {
                      type: 'channel',
                      nodeId: node.id,
                      portDirection: pg.direction === 'output' ? 'out' : 'in',
                      group: pg.code,
                      slot: row.primary.slot,
                      channelId: row.primary.id,
                    };
                    const isTraced = row.channelIds.some((id) => tracedChannelIds.has(id));
                    return (
                      <ChannelInspectorRow
                        key={row.key}
                        rig={rig}
                        row={row}
                        isOutputView={pg.direction === 'output'}
                        editMode={editMode}
                        isTraced={isTraced}
                        isExpanded={expandedRowKey === row.key}
                        traceTarget={traceTarget}
                        onSelectNode={onSelectNode}
                        onSelectTrunk={onSelectTrunk}
                        onUpdateChannelAnnotation={onUpdateChannelAnnotation}
                        onToggleExpandAndTrace={() => {
                          setExpandedRowKey((cur) => (cur === row.key ? null : row.key));
                          onRunTrace(traceTarget);
                        }}
                      />
                    );
                  })}
                </div>
              );
            })
          )
        ) : tab === 'strips' ? (
          filteredStrips.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No matching console channel strips.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredStrips.map(({ strip, source }) => (
                <ConsoleStripRow
                  key={strip.id}
                  rig={rig}
                  node={node}
                  strip={strip}
                  source={source}
                  isTraced={Boolean(source && tracedChannelIds.has(source.channel.id))}
                  isExpanded={expandedStripId === strip.id}
                  onToggle={() => {
                    setExpandedStripId((cur) => (cur === strip.id ? null : strip.id));
                    if (source) {
                      onRunTrace({
                        type: 'channel',
                        nodeId: node.id,
                        portDirection: 'in',
                        group: source.portGroup.code,
                        slot: source.channel.slot,
                        channelId: source.channel.id,
                      });
                    }
                  }}
                  onTraceBus={(bus) =>
                    onRunTrace({
                      type: 'bus',
                      nodeId: node.id,
                      busKind: bus.kind,
                      busIndex: bus.index,
                      busId: bus.id,
                    })
                  }
                />
              ))}
            </div>
          )
        ) : filteredBuses.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            No matching mix buses.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {filteredBuses.map((bus) => {
              const isTraced = tracedBusIds.has(bus.id);
              const busAnn = rig.annotations.buses[bus.id];
              const senderCount = countBusSenders(node, bus);
              const collapsedOutputs = collapseBusOutputs(bus.outputs);
              const indirectMons = findIndirectMonitorsForBus(node, bus);
              const isEditingBus = editMode && editingBusId === bus.id;

              return (
                <div
                  key={bus.id}
                  onClick={() =>
                    onRunTrace({
                      type: 'bus',
                      nodeId: node.id,
                      busKind: bus.kind,
                      busIndex: bus.index,
                      busId: bus.id,
                    })
                  }
                  className={`px-3 py-2 transition-colors cursor-pointer ${
                    isTraced
                      ? 'bg-sky-50 dark:bg-sky-950/60'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`inline-flex shrink-0 items-center rounded-[1px] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                          bus.kind === 'main'
                            ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950'
                            : bus.kind === 'mon'
                              ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-300'
                              : bus.kind === 'mtx'
                                ? 'bg-indigo-100 dark:bg-indigo-950/80 text-indigo-900 dark:text-indigo-300'
                                : 'bg-sky-100 dark:bg-sky-950/80 text-sky-900 dark:text-sky-300'
                        }`}
                      >
                        {bus.kind} {bus.index}
                      </span>
                      <span className="truncate text-[12.5px] font-semibold text-slate-900 dark:text-slate-100">
                        {resolveBusName(rig, bus)}
                      </span>
                      <span className="rounded-[1px] bg-slate-100 dark:bg-slate-800 px-1 py-0 text-[9.5px] font-mono text-slate-600 dark:text-slate-300 shrink-0">
                        {bus.mono ? 'M' : 'ST'}
                      </span>
                      {bus.muted && (
                        <span
                          title="Bus Muted"
                          className="inline-flex items-center gap-0.5 rounded-[1px] bg-rose-100 dark:bg-rose-950 px-1 py-0 text-[9.5px] font-mono font-bold text-rose-700 dark:text-rose-300 shrink-0"
                        >
                          <VolumeX className="w-2.5 h-2.5" />
                          MUTE
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {senderCount > 0 && (
                        <span className="font-mono text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                          {senderCount} ch →
                        </span>
                      )}
                      {editMode && (
                        <button
                          type="button"
                          title="Edit friendly bus label or notes"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingBusId((cur) => (cur === bus.id ? null : bus.id));
                          }}
                          className="rounded-[1px] p-0.5 text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-100 cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                      <GitBranch
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isTraced
                            ? 'text-sky-600 dark:text-sky-400'
                            : 'text-slate-300 dark:text-slate-600'
                        }`}
                      />
                    </div>
                  </div>

                  {/* Source tap for MON buses */}
                  {bus.monitorSource && (
                    <div className="mt-1 font-mono text-[10.5px] text-amber-800 dark:text-amber-300">
                      Source tap: {bus.monitorSource.rawRef}
                    </div>
                  )}

                  {/* Collapsed Stereo Output Chips + Indirect MON Routing */}
                  {(collapsedOutputs.length > 0 || indirectMons.length > 0) && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {collapsedOutputs.map((out) =>
                        out.trunkId ? (
                          <button
                            key={out.key}
                            type="button"
                            title="Jump to output trunk"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectTrunk(out.trunkId!);
                            }}
                            className="rounded-[1px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-300 cursor-pointer"
                          >
                            Out {out.label}
                          </button>
                        ) : (
                          <span
                            key={out.key}
                            className="rounded-[1px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:text-slate-300"
                          >
                            Out {out.label}
                          </span>
                        ),
                      )}
                      {indirectMons.map((mon) => {
                        const monOuts = collapseBusOutputs(mon.outputs);
                        const monOutText =
                          monOuts.length > 0 ? ` → ${monOuts.map((o) => o.label).join(', ')}` : '';
                        return (
                          <span
                            key={mon.id}
                            className="rounded-[1px] border border-amber-300 dark:border-amber-700/80 bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-800 dark:text-amber-300"
                          >
                            ↳ MON {mon.index}
                            {monOutText}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {busAnn?.notes && !isEditingBus && (
                    <div className="mt-1 text-[11px] italic text-slate-500 dark:text-slate-400">
                      {busAnn.notes}
                    </div>
                  )}

                  {isEditingBus && (
                    <div
                      className="mt-2 space-y-1.5 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={busAnn?.friendlyName ?? ''}
                        onChange={(e) =>
                          onUpdateBusAnnotation(bus.id, {
                            friendlyName: e.target.value || undefined,
                          })
                        }
                        placeholder="Friendly bus label..."
                        className="w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111827] px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={busAnn?.notes ?? ''}
                        onChange={(e) =>
                          onUpdateBusAnnotation(bus.id, {
                            notes: e.target.value || undefined,
                          })
                        }
                        placeholder="Mix notes (musician, IEM pack, wedge)..."
                        className="w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111827] px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

// =============================================================================
// Console Channel Strip Row (CH 1-40 / AUX 1-8 Tab)
// =============================================================================

function ConsoleStripRow({
  rig,
  node,
  strip,
  source,
  isTraced,
  isExpanded,
  onToggle,
  onTraceBus,
}: {
  rig: RigDocument;
  node: HardwareNode;
  strip: ConsoleChannelStrip;
  source: ReturnType<typeof findStripSourceChannel>;
  isTraced: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onTraceBus: (bus: MixBusSummary) => void;
}) {
  const ch = source?.channel;
  const stripTag = `${strip.kind.toUpperCase()} ${padSlot(strip.index)}`;
  const sourceBadge =
    strip.sourceGroup && strip.sourceSlot > 0
      ? ch?.mode === 'ST' && ch.stereoSide === 'L'
        ? `${strip.sourceGroup}.${strip.sourceSlot}–${strip.sourceSlot + 1}`
        : `${strip.sourceGroup}.${strip.sourceSlot}`
      : 'OFF';

  const sendSummary =
    strip.busSends.length > 0
      ? `${strip.busSends.length} bus`
      : strip.mainSends.length > 0
        ? `M${strip.mainSends.join(',')}`
        : '—';

  return (
    <div
      className={`transition-colors ${
        isTraced
          ? 'bg-sky-50/90 dark:bg-sky-950/50'
          : 'hover:bg-slate-50/90 dark:hover:bg-slate-800/50'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer"
      >
        <span
          className={`inline-flex h-5 w-12 shrink-0 items-center justify-center rounded-[1px] font-mono text-[10.5px] font-semibold tabular-nums ${
            isTraced
              ? 'bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}
        >
          {stripTag}
        </span>

        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-slate-900 dark:text-slate-100">
            {strip.resolvedName || stripTag}
          </span>
          {ch?.mode === 'ST' && (
            <span className="rounded-[1px] bg-indigo-50 dark:bg-indigo-950/70 px-1 py-0 font-mono text-[9.5px] font-semibold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80 shrink-0">
              ST
            </span>
          )}
          {ch?.phantom48v && (
            <span className="inline-flex items-center gap-0.5 rounded-[1px] bg-rose-50 dark:bg-rose-950/70 px-1 py-0 font-mono text-[9.5px] font-semibold text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/80 shrink-0">
              <Zap className="w-2.5 h-2.5" />
              48V
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 font-mono text-[10.5px] tabular-nums">
          <span className="rounded-[1px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-1.5 py-0.5 text-slate-700 dark:text-slate-200">
            {sourceBadge}
          </span>
          <span className="w-11 text-right text-slate-500 dark:text-slate-400">{sendSummary}</span>
          <span className="text-slate-400 dark:text-slate-500">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="mx-3 mb-2 rounded-[2px] border border-sky-200/90 dark:border-sky-800/70 bg-slate-50/90 dark:bg-[#0b111d] p-2.5 space-y-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600 dark:text-slate-300">
            <span>
              Source:{' '}
              <strong className="font-mono text-slate-900 dark:text-slate-100">{sourceBadge}</strong>
            </span>
            {ch?.gainDb !== undefined && (
              <span>
                Preamp:{' '}
                <strong className="font-mono text-slate-900 dark:text-slate-100">
                  {formatGain(ch.gainDb)}
                </strong>
              </span>
            )}
            {strip.altSourceGroup && strip.altSourceSlot && strip.altSourceSlot > 0 && (
              <span>
                Alt:{' '}
                <strong className="font-mono text-slate-700 dark:text-slate-200">
                  {strip.altSourceGroup}.{strip.altSourceSlot}
                </strong>
              </span>
            )}
            {strip.mainSends.length > 0 && (
              <span>
                Mains:{' '}
                <strong className="font-mono text-slate-900 dark:text-slate-100">
                  {strip.mainSends.map((m) => `Main ${m}`).join(', ')}
                </strong>
              </span>
            )}
          </div>

          {strip.busSends.length > 0 && (
            <div className="pt-1.5 border-t border-slate-200/80 dark:border-slate-800">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Mix Bus Sends ({strip.busSends.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {strip.busSends.map((send) => {
                  const bus = node.mixBuses.find(
                    (b) => b.kind === send.busKind && b.index === send.busIndex,
                  );
                  const label = bus
                    ? `${bus.index}·${resolveBusName(rig, bus)}`
                    : `${send.busKind.toUpperCase()} ${send.busIndex}`;
                  return (
                    <button
                      key={`${send.busKind}-${send.busIndex}`}
                      type="button"
                      onClick={() => bus && onTraceBus(bus)}
                      className="rounded-[1px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-300 cursor-pointer"
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Rig Overview View
// =============================================================================

function OverviewInspectorView({
  rig,
  auditIssues = [],
  lockedReadOnly,
  editMode,
  isDark,
  trace,
  onSelectNode,
  onSelectTrunk,
  onClearTrace,
  onTraceOnSchematic,
  onRunTrace,
  onCollapse,
  onDismissOrphan,
  onOpenSnapImport,
  onResetDemo,
}: SideInspectorProps) {
  const [query, setQuery] = useState('');
  const [healthOpen, setHealthOpen] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!editMode && confirmReset) {
      setConfirmReset(false);
    }
  }, [editMode, confirmReset]);

  const phantomCount = useMemo(() => countRigPhantomChannels(rig), [rig]);

  const alertIssues = useMemo(
    () => auditIssues.filter((i) => i.severity !== 'info'),
    [auditIssues],
  );
  const issuesByNodeId = useMemo(() => {
    const map = new Map<string, number>();
    for (const iss of alertIssues) {
      if (iss.consoleNodeId) {
        map.set(iss.consoleNodeId, (map.get(iss.consoleNodeId) ?? 0) + 1);
      }
    }
    return map;
  }, [alertIssues]);

  const q = query.trim().toLowerCase();

  const filteredNodes = useMemo(() => {
    if (!q) return rig.nodes;
    return rig.nodes.filter((n) => {
      const name = resolveNodeName(rig, n).toLowerCase();
      const zone = resolveNodeZone(rig, n).toLowerCase();
      const notes = rig.annotations.nodes[n.id]?.notes?.toLowerCase() ?? '';
      return (
        name.includes(q) ||
        n.model.toLowerCase().includes(q) ||
        zone.includes(q) ||
        notes.includes(q)
      );
    });
  }, [rig, q]);

  const zoneGroups = useMemo(
    () => groupNodesByZone(rig, filteredNodes),
    [rig, filteredNodes],
  );

  const filteredTrunks = useMemo(() => {
    if (!q) return rig.trunks;
    return rig.trunks.filter((t) => {
      const name = resolveTrunkName(rig, t).toLowerCase();
      const tag = (resolveTrunkCableTag(rig, t) ?? '').toLowerCase();
      const src = rig.nodes.find((n) => n.id === t.sourceNodeId);
      const tgt = rig.nodes.find((n) => n.id === t.targetNodeId);
      const endpoints = `${src ? resolveNodeName(rig, src) : ''} ${tgt ? resolveNodeName(rig, tgt) : ''}`.toLowerCase();
      return (
        name.includes(q) ||
        tag.includes(q) ||
        t.protocol.toLowerCase().includes(q) ||
        endpoints.includes(q)
      );
    });
  }, [rig, q]);

  const handleInspectIssue = (issue: PathAuditIssue) => {
    if (issue.traceTarget) {
      if (onTraceOnSchematic) {
        onTraceOnSchematic(issue.traceTarget);
      } else {
        if (issue.traceTarget.trunkId) onSelectTrunk(issue.traceTarget.trunkId);
        else if (issue.traceTarget.nodeId) onSelectNode(issue.traceTarget.nodeId);
        onRunTrace(issue.traceTarget);
      }
    } else if (issue.consoleNodeId) {
      onSelectNode(issue.consoleNodeId);
    }
  };

  return (
    <aside className="flex h-full w-full flex-col border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
      {/* Compact Overview Header + Inline Search */}
      <div className="border-b border-slate-200 dark:border-slate-800 px-3.5 py-2.5 shrink-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0" />
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Rig Overview
              </h2>
            </div>
            <div className="mt-0.5 font-mono text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">
              {rig.nodes.length} devices · {rig.trunks.length} trunks
              {phantomCount > 0 ? ` · ⚡${phantomCount}× 48V` : ''} · {rig.sourceSnapshots.length}{' '}
              .snap
            </div>
          </div>
          <button
            type="button"
            title="Collapse Rig Inspector for full-screen topology view"
            aria-label="Collapse Rig Inspector"
            onClick={onCollapse}
            className="rounded-[2px] p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter devices, zones, trunks, cable tags..."
            className="w-full rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 pl-8 pr-7 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:bg-white dark:focus:bg-[#090d14] focus:outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear filter"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* Active Trace Quick Card */}
        {trace && (
          <div className="rounded-[2px] border border-sky-300 dark:border-sky-700/80 bg-sky-50/80 dark:bg-sky-950/40 px-2.5 py-2 flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0 flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold text-sky-900 dark:text-sky-100 truncate">
                  Trace: {trace.title}
                </div>
                <div className="font-mono text-[10px] text-sky-700 dark:text-sky-300 truncate">
                  {trace.subtitle}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClearTrace}
              className="shrink-0 rounded-[1px] border border-sky-300 dark:border-sky-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-[10.5px] font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950 cursor-pointer"
            >
              Clear
            </button>
          </div>
        )}

        {/* Rig Health / Path Verifier Strip */}
        {auditIssues.length > 0 ? (
          <div className="rounded-[2px] border border-amber-300 dark:border-amber-700/80 bg-amber-50/70 dark:bg-amber-950/30 overflow-hidden">
            <button
              type="button"
              onClick={() => setHealthOpen((o) => !o)}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left text-xs font-bold text-amber-900 dark:text-amber-200 cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                Rig Health · {auditIssues.length} item{auditIssues.length === 1 ? '' : 's'}
              </span>
              {healthOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
            {healthOpen && (
              <div className="border-t border-amber-200 dark:border-amber-800/70 bg-white dark:bg-[#111827] divide-y divide-slate-100 dark:divide-slate-800">
                {auditIssues.slice(0, 6).map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => handleInspectIssue(issue)}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${
                          issue.severity === 'error'
                            ? 'bg-rose-500'
                            : issue.severity === 'warning'
                              ? 'bg-amber-500'
                              : 'bg-sky-500'
                        }`}
                      />
                      <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                        {issue.title}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] font-semibold text-sky-700 dark:text-sky-400 shrink-0">
                      Trace →
                    </span>
                  </button>
                ))}
                {auditIssues.length > 6 && (
                  <div className="px-2.5 py-1 text-[10.5px] font-mono text-slate-500 dark:text-slate-400">
                    +{auditIssues.length - 6} more in Patch Studio Verifier
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 rounded-[2px] border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/60 dark:bg-emerald-950/25 px-2.5 py-1.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Rig Health: All signal paths verified</span>
          </div>
        )}

        {/* Zone-Grouped Hardware Blocks */}
        <div className="space-y-3">
          {zoneGroups.length === 0 ? (
            <div className="text-center text-xs text-slate-500 dark:text-slate-400 py-3">
              No devices match &ldquo;{query}&rdquo;.
            </div>
          ) : (
            zoneGroups.map(({ zone, nodes }) => (
              <div key={zone} className="space-y-1.5">
                <h3 className="font-display text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {zone}
                </h3>
                {nodes.map((n) => {
                  const summary = buildNodeTopologySummary(rig, n);
                  const nodeAlerts = issuesByNodeId.get(n.id) ?? 0;
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => onSelectNode(n.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 px-2.5 py-2 text-left hover:border-sky-400 dark:hover:border-sky-500 hover:bg-sky-50/40 dark:hover:bg-sky-950/40 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {resolveNodeName(rig, n)}
                          </span>
                          {nodeAlerts > 0 && (
                            <span
                              title={`${nodeAlerts} path alert(s) on this device`}
                              className="h-2 w-2 rounded-full bg-amber-500 shrink-0"
                            />
                          )}
                        </div>
                        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {summary.subtitle}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-[1px] border px-1.5 py-0.5 font-mono text-[9.5px] font-semibold ${STATUS_TONE_BADGE[summary.statusTone]}`}
                      >
                        {summary.statusText}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Rich Signal Trunks */}
        <div>
          <h3 className="font-display mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Signal Trunks ({filteredTrunks.length})
          </h3>
          <div className="space-y-1.5">
            {filteredTrunks.map((t) => {
              const p = PROTOCOL_META[t.protocol];
              const src = rig.nodes.find((n) => n.id === t.sourceNodeId);
              const tgt = rig.nodes.find((n) => n.id === t.targetNodeId);
              const tag = resolveTrunkCableTag(rig, t);
              const arrow = t.returnChannels.length > 0 ? '↔' : '→';
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTrunk(t.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 px-2.5 py-2 text-left hover:border-sky-400 dark:hover:border-sky-500 hover:bg-sky-50/40 dark:hover:bg-sky-950/40 transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        style={{ backgroundColor: isDark ? p.darkColor : p.color }}
                        className="h-2 w-2 shrink-0 rounded-full"
                      />
                      <span className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">
                        {resolveTrunkName(rig, t)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[10.5px] text-slate-500 dark:text-slate-400">
                      {src ? compactNodeTabLabel(resolveNodeName(rig, src)) : t.sourceNodeId}{' '}
                      {arrow}{' '}
                      {tgt ? compactNodeTabLabel(resolveNodeName(rig, tgt)) : t.targetNodeId}
                      {tag ? (
                        <span className="font-mono text-slate-400 dark:text-slate-500">
                          {' '}
                          · {tag}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {t.channels.length}
                    {t.returnChannels.length ? `↔${t.returnChannels.length}` : ' ch'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Orphaned Annotations Tracker */}
        {rig.annotations.orphaned.length > 0 && (
          <div className="rounded-[2px] border border-amber-300 dark:border-amber-700/80 bg-amber-50/70 dark:bg-amber-950/40 p-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              Archived Annotations ({rig.annotations.orphaned.length})
            </div>
            <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300/90">
              Preserved from previous snapshots when channels or buses were unpatched.
            </p>
            <div className="mt-2 space-y-1.5">
              {rig.annotations.orphaned.map((o) => (
                <div
                  key={o.key}
                  className="flex items-start justify-between gap-2 rounded-[2px] border border-amber-200 dark:border-amber-800/70 bg-white dark:bg-[#111827] p-2 text-[11px]"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">
                      {o.friendlyName || o.lastKnownName}
                    </div>
                    <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                      {o.key}
                    </div>
                    {o.notes && (
                      <div className="text-slate-600 dark:text-slate-300 mt-0.5">{o.notes}</div>
                    )}
                  </div>
                  {editMode && (
                    <button
                      type="button"
                      title="Dismiss archived annotation"
                      onClick={() => onDismissOrphan(o.key)}
                      className="rounded-[1px] p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Volunteer-Safe Sticky Footer (Reset Demo gated behind Edit Mode + confirmation) */}
      {!lockedReadOnly && (
        <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-[#0b111d] px-3.5 py-2.5 shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSnapImport}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-[2px] bg-sky-600 dark:bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white dark:text-slate-950 hover:bg-sky-700 dark:hover:bg-sky-400 cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Import WING .snap</span>
          </button>

          {editMode &&
            (confirmReset ? (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmReset(false);
                    onResetDemo();
                  }}
                  className="rounded-[2px] bg-rose-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer"
                >
                  Confirm Reset
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                title="Reset rig back to the Sanctuary Demo Rig"
                onClick={() => setConfirmReset(true)}
                className="inline-flex shrink-0 items-center gap-1 rounded-[2px] border border-rose-300 dark:border-rose-800/80 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            ))}
        </div>
      )}
    </aside>
  );
}
