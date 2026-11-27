import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Cable,
  Check,
  Edit3,
  GitBranch,
  Layers,
  PanelRightClose,
  Pencil,
  RotateCcw,
  Search,
  Sliders,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type {
  BusAnnotation,
  ChannelAnnotation,
  ChannelPatch,
  HardwareNode,
  NodeAnnotation,
  RigDocument,
  RigZone,
  TraceResult,
  TraceTarget,
  TrunkAnnotation,
  TrunkConnection,
} from '../../schema/rig';
import {
  PROTOCOL_META,
  formatGain,
  resolveBusName,
  resolveChannelName,
  resolveNodeName,
  resolveNodeZone,
  resolveTrunkCableTag,
  resolveTrunkName,
} from '../../schema/helpers';
import type { SelectionState } from '../../store/useRigStore';

interface SideInspectorProps {
  rig: RigDocument;
  lockedReadOnly?: boolean;
  editMode: boolean;
  isDark: boolean;
  selection: SelectionState;
  trace: TraceResult | null;
  onSelectNode: (id: string) => void;
  onSelectTrunk: (id: string) => void;
  onClearSelection: () => void;
  onCollapse: () => void;
  onRunTrace: (target: TraceTarget) => void;
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

const ZONES: RigZone[] = ['Stage', 'Stage Rack', 'FOH Booth', 'Amp Vault', 'Broadcast', 'Custom'];

export function SideInspector(props: SideInspectorProps) {
  const { rig, selection } = props;

  const selectedNode =
    selection?.type === 'node' ? rig.nodes.find((n) => n.id === selection.id) : undefined;
  const selectedTrunk =
    selection?.type === 'trunk' ? rig.trunks.find((t) => t.id === selection.id) : undefined;

  if (selectedTrunk) {
    return <TrunkInspectorView {...props} trunk={selectedTrunk} />;
  }
  if (selectedNode) {
    return <NodeInspectorView {...props} node={selectedNode} />;
  }
  return <OverviewInspectorView {...props} />;
}

interface ChannelRowProps {
  rig: RigDocument;
  channel: ChannelPatch;
  editMode: boolean;
  isTraced: boolean;
  onTrace: () => void;
  onUpdateChannelAnnotation: (channelId: string, patch: Partial<ChannelAnnotation>) => void;
}

function ChannelTableRow({
  rig,
  channel,
  editMode,
  isTraced,
  onTrace,
  onUpdateChannelAnnotation,
}: ChannelRowProps) {
  const [editing, setEditing] = useState(false);
  const ann = rig.annotations.channels[channel.id];
  const displayName = resolveChannelName(rig, channel);
  const hasFriendly = Boolean(ann?.friendlyName?.trim());

  const [friendlyDraft, setFriendlyDraft] = useState(ann?.friendlyName ?? '');
  const [cableDraft, setCableDraft] = useState(ann?.cableTag ?? '');
  const [notesDraft, setNotesDraft] = useState(ann?.notes ?? '');

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

  return (
    <div
      className={`border-b border-slate-100 dark:border-slate-800/80 last:border-b-0 transition-colors ${
        isTraced
          ? 'bg-sky-50/90 dark:bg-sky-950/60'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onTrace}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onTrace();
          }
        }}
        className="flex items-start gap-2 px-3 py-2 cursor-pointer"
      >
        <span
          className={`mt-0.5 inline-flex h-5 w-7 shrink-0 items-center justify-center rounded-[1px] font-mono text-[11px] font-semibold ${
            isTraced
              ? 'bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}
        >
          {channel.slot}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12.5px] font-semibold text-slate-900 dark:text-slate-100 truncate">
              {displayName}
            </span>
            {hasFriendly && channel.rawName && channel.rawName !== displayName && (
              <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                ({channel.rawName})
              </span>
            )}
            {channel.mode === 'ST' && (
              <span className="inline-flex items-center rounded-[1px] bg-indigo-50 dark:bg-indigo-950/70 px-1 py-0 text-[9.5px] font-mono font-semibold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80">
                ST{channel.stereoSide ? `·${channel.stereoSide}` : ''}
              </span>
            )}
            {channel.phantom48v && (
              <span className="inline-flex items-center gap-0.5 rounded-[1px] bg-rose-50 dark:bg-rose-950/70 px-1 py-0 text-[9.5px] font-mono font-semibold text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/80">
                <Zap className="w-2.5 h-2.5" />
                +48V
              </span>
            )}
            {channel.gainDb !== undefined && channel.gainDb !== 0 && (
              <span className="inline-flex items-center rounded-[1px] bg-slate-100 dark:bg-slate-800 px-1 py-0 text-[9.5px] font-mono text-slate-600 dark:text-slate-300">
                {formatGain(channel.gainDb)}
              </span>
            )}
            {channel.consoleChannel && (
              <span className="inline-flex items-center rounded-[1px] bg-sky-50 dark:bg-sky-950/70 px-1 py-0 text-[9.5px] font-mono font-medium text-sky-800 dark:text-sky-300 border border-sky-200/70 dark:border-sky-800/80">
                {channel.consoleChannel}
                {channel.channelStripName ? `: ${channel.channelStripName}` : ''}
              </span>
            )}
          </div>

          {(channel.routeLabel || ann?.cableTag || ann?.notes) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {channel.routeLabel && (
                <span className="font-mono text-[10.5px] text-slate-600 dark:text-slate-300">
                  {channel.routeLabel}
                </span>
              )}
              {ann?.cableTag && (
                <span className="inline-flex items-center gap-0.5 rounded-[1px] bg-amber-50 dark:bg-amber-950/70 px-1 font-mono text-[10px] text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80">
                  <Cable className="w-2.5 h-2.5" />
                  {ann.cableTag}
                </span>
              )}
              {ann?.notes && (
                <span className="text-slate-500 dark:text-slate-400 italic">{ann.notes}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {editMode && (
            <button
              type="button"
              title="Edit friendly label, cable tag, or notes"
              onClick={openEditor}
              className="rounded-[1px] p-1 text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-100 cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          <span
            title="Click to trace signal end-to-end"
            className={`rounded-[1px] p-1 ${
              isTraced
                ? 'text-sky-700 dark:text-sky-400'
                : 'text-slate-300 dark:text-slate-600 hover:text-sky-600 dark:hover:text-sky-400'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>

      {editing && (
        <form
          onSubmit={saveEdit}
          onClick={(e) => e.stopPropagation()}
          className="mx-3 mb-2.5 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-2.5 space-y-2"
        >
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
                className="mt-0.5 w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111827] px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
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
                className="mt-0.5 w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111827] px-2 py-1 font-mono text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
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
              className="mt-0.5 w-full rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#111827] px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
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
  );
}

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
}: SideInspectorProps & { trunk: TrunkConnection }) {
  const [directionTab, setDirectionTab] = useState<'forward' | 'return'>('forward');
  const [filter, setFilter] = useState('');

  const proto = PROTOCOL_META[trunk.protocol];
  const srcNode = rig.nodes.find((n) => n.id === trunk.sourceNodeId);
  const tgtNode = rig.nodes.find((n) => n.id === trunk.targetNodeId);
  const ann = rig.annotations.trunks[trunk.id];
  const tracedChannelIds = useMemo(() => new Set(trace?.activeChannelIds ?? []), [trace]);

  const activeList =
    directionTab === 'return' && trunk.returnChannels.length > 0
      ? trunk.returnChannels
      : trunk.channels;

  const filteredChannels = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return activeList;
    return activeList.filter((ch) => {
      const name = resolveChannelName(rig, ch).toLowerCase();
      const chAnn = rig.annotations.channels[ch.id];
      return (
        name.includes(q) ||
        String(ch.slot) === q ||
        (q.includes('48') && Boolean(ch.phantom48v)) ||
        (ch.routeLabel?.toLowerCase().includes(q) ?? false) ||
        (chAnn?.cableTag?.toLowerCase().includes(q) ?? false) ||
        (chAnn?.notes?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [activeList, filter, rig]);

  return (
    <aside className="flex h-full w-full flex-col border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
      <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                style={{
                  backgroundColor: isDark ? proto.darkBg : proto.bg,
                  color: isDark ? proto.darkText : proto.text,
                  borderColor: isDark ? proto.darkBorder : proto.border,
                }}
                className="inline-flex items-center rounded-[1px] border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase"
              >
                {proto.label}
              </span>
              {resolveTrunkCableTag(rig, trunk) && (
                <span className="inline-flex items-center gap-1 rounded-[1px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:text-slate-300">
                  <Cable className="w-3 h-3" />
                  {resolveTrunkCableTag(rig, trunk)}
                </span>
              )}
            </div>
            <h2 className="font-display mt-1.5 text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              {resolveTrunkName(rig, trunk)}
            </h2>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
              <button
                type="button"
                onClick={() => srcNode && onSelectNode(srcNode.id)}
                className="font-medium text-slate-700 dark:text-slate-200 hover:text-sky-700 dark:hover:text-sky-400 hover:underline cursor-pointer"
              >
                {srcNode ? resolveNodeName(rig, srcNode) : trunk.sourceNodeId} ({trunk.sourcePortGroup})
              </button>
              {trunk.returnChannels.length > 0 ? (
                <ArrowLeftRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
              )}
              <button
                type="button"
                onClick={() => tgtNode && onSelectNode(tgtNode.id)}
                className="font-medium text-slate-700 dark:text-slate-200 hover:text-sky-700 dark:hover:text-sky-400 hover:underline cursor-pointer"
              >
                {tgtNode ? resolveNodeName(rig, tgtNode) : trunk.targetNodeId} ({trunk.targetPortGroup})
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {editMode && trunk.sourceOrigin === 'manual' && (
              <button
                type="button"
                title="Delete manual trunk"
                onClick={() => onDeleteManualTrunk(trunk.id)}
                className="rounded-[2px] p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              title="Back to Rig Overview"
              onClick={onClearSelection}
              className="rounded-[2px] p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Collapse Rig Inspector"
              aria-label="Collapse Rig Inspector"
              onClick={onCollapse}
              className="rounded-[2px] p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Edit Mode inline trunk annotations */}
        {editMode ? (
          <div className="mt-3 space-y-2 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-2.5">
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
          </div>
        ) : (
          ann?.notes && (
            <p className="mt-2 rounded-[2px] bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300">
              {ann.notes}
            </p>
          )
        )}

        {/* Forward / Return Direction Tabs */}
        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDirectionTab('forward')}
            className={`flex-1 rounded-[2px] px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              directionTab === 'forward'
                ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            Forward ({trunk.channels.length})
          </button>
          {trunk.returnChannels.length > 0 && (
            <button
              type="button"
              onClick={() => setDirectionTab('return')}
              className={`flex-1 rounded-[2px] px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                directionTab === 'return'
                  ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Return ({trunk.returnChannels.length})
            </button>
          )}
        </div>

        <div className="relative mt-2.5">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter slots, names, +48V, cable tags..."
            className="w-full rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:bg-white dark:focus:bg-[#090d14] focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredChannels.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            No matching channels in this direction.
          </div>
        ) : (
          filteredChannels.map((ch) => (
            <ChannelTableRow
              key={ch.id}
              rig={rig}
              channel={ch}
              editMode={editMode}
              isTraced={tracedChannelIds.has(ch.id)}
              onUpdateChannelAnnotation={onUpdateChannelAnnotation}
              onTrace={() =>
                onRunTrace({
                  type: 'trunk-channel',
                  nodeId:
                    directionTab === 'return' ? trunk.targetNodeId : trunk.sourceNodeId,
                  trunkId: trunk.id,
                  direction: directionTab,
                  slot: ch.slot,
                  channelId: ch.id,
                })
              }
            />
          ))
        )}
      </div>
    </aside>
  );
}

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
  onSelectTrunk,
}: SideInspectorProps & { node: HardwareNode }) {
  const [tab, setTab] = useState<'io' | 'buses'>('io');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [filter, setFilter] = useState('');

  const ann = rig.annotations.nodes[node.id];
  const displayZone = resolveNodeZone(rig, node);
  const snapshotMeta = rig.sourceSnapshots.find((s) => s.consoleNodeId === node.id);
  const tracedChannelIds = useMemo(() => new Set(trace?.activeChannelIds ?? []), [trace]);
  const tracedBusIds = useMemo(() => new Set(trace?.activeBusIds ?? []), [trace]);

  const connectedTrunks = useMemo(
    () => rig.trunks.filter((t) => t.sourceNodeId === node.id || t.targetNodeId === node.id),
    [rig.trunks, node.id],
  );

  const visiblePortGroups = useMemo(() => {
    const groups =
      selectedGroupId === 'all'
        ? node.portGroups
        : node.portGroups.filter((pg) => pg.id === selectedGroupId);

    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((pg) => ({
        ...pg,
        channels: pg.channels.filter((ch) => {
          const name = resolveChannelName(rig, ch).toLowerCase();
          const chAnn = rig.annotations.channels[ch.id];
          return (
            name.includes(q) ||
            String(ch.slot) === q ||
            (q.includes('48') && Boolean(ch.phantom48v)) ||
            (ch.consoleChannel?.toLowerCase().includes(q) ?? false) ||
            (ch.routeLabel?.toLowerCase().includes(q) ?? false) ||
            (chAnn?.cableTag?.toLowerCase().includes(q) ?? false)
          );
        }),
      }))
      .filter((pg) => pg.channels.length > 0);
  }, [node.portGroups, selectedGroupId, filter, rig]);

  return (
    <aside className="flex h-full w-full flex-col border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
      <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center rounded-[1px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                {displayZone}
              </span>
              <span className="font-mono text-[10.5px] text-slate-500 dark:text-slate-400">
                {node.model}
              </span>
            </div>
            <h2 className="font-display mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              {resolveNodeName(rig, node)}
            </h2>
            {snapshotMeta && (
              <div className="mt-0.5 font-mono text-[10.5px] text-sky-700 dark:text-sky-400">
                Synced: {snapshotMeta.fileName} ({snapshotMeta.creator} {snapshotMeta.creatorVersion})
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Highlight connected trunks"
              onClick={() => onRunTrace({ type: 'node', nodeId: node.id })}
              className="rounded-[2px] p-1.5 text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/60 cursor-pointer"
            >
              <GitBranch className="w-4 h-4" />
            </button>
            {editMode && node.sourceOrigin === 'manual' && (
              <button
                type="button"
                title="Delete manual device"
                onClick={() => onDeleteManualNode(node.id)}
                className="rounded-[2px] p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              title="Back to Rig Overview"
              onClick={onClearSelection}
              className="rounded-[2px] p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Collapse Rig Inspector"
              aria-label="Collapse Rig Inspector"
              onClick={onCollapse}
              className="rounded-[2px] p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Edit Mode inline device annotations */}
        {editMode ? (
          <div className="mt-3 space-y-2 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-2.5">
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
                  {ZONES.map((z) => (
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
          </div>
        ) : (
          ann?.notes && (
            <p className="mt-2 rounded-[2px] bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300">
              {ann.notes}
            </p>
          )
        )}

        {/* Connected trunk pills */}
        {connectedTrunks.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {connectedTrunks.map((t) => {
              const p = PROTOCOL_META[t.protocol];
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTrunk(t.id)}
                  className="inline-flex items-center gap-1 rounded-[1px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-slate-400 dark:hover:border-slate-500 cursor-pointer"
                >
                  <span
                    style={{ backgroundColor: isDark ? p.darkColor : p.color }}
                    className="h-2 w-2 rounded-full"
                  />
                  {resolveTrunkName(rig, t)}
                </button>
              );
            })}
          </div>
        )}

        {/* Tabs: I/O Patch vs Mix Buses */}
        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTab('io')}
            className={`flex-1 rounded-[2px] px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              tab === 'io'
                ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            I/O Patch ({node.portGroups.reduce((s, pg) => s + pg.channels.length, 0)})
          </button>
          {node.mixBuses.length > 0 && (
            <button
              type="button"
              onClick={() => setTab('buses')}
              className={`flex-1 rounded-[2px] px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                tab === 'buses'
                  ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Mix Buses ({node.mixBuses.length})
            </button>
          )}
        </div>

        {tab === 'io' && (
          <div className="mt-2.5 space-y-2">
            {node.portGroups.length > 1 && (
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedGroupId('all')}
                  className={`rounded-[1px] px-2 py-0.5 text-[11px] font-medium cursor-pointer ${
                    selectedGroupId === 'all'
                      ? 'bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  All ({node.portGroups.length})
                </button>
                {node.portGroups.map((pg) => (
                  <button
                    key={pg.id}
                    type="button"
                    onClick={() => setSelectedGroupId(pg.id)}
                    className={`rounded-[1px] px-2 py-0.5 font-mono text-[10.5px] font-medium cursor-pointer ${
                      selectedGroupId === pg.id
                        ? 'bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {pg.direction === 'output' ? 'OUT' : 'IN'}·{pg.code} ({pg.channels.length})
                  </button>
                ))}
              </div>
            )}

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter channels, +48V, CH #..."
                className="w-full rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:bg-white dark:focus:bg-[#090d14] focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'io' ? (
          visiblePortGroups.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No matching channels on this device.
            </div>
          ) : (
            visiblePortGroups.map((pg) => (
              <div key={pg.id}>
                <div className="sticky top-0 z-10 flex items-center justify-between border-y border-slate-200 dark:border-slate-800 bg-slate-50/95 dark:bg-[#090d14]/90 backdrop-blur-xs px-3 py-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    {pg.label}
                  </span>
                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                    {pg.direction.toUpperCase()} · {pg.channels.length}/{pg.capacity}
                  </span>
                </div>
                {pg.channels.map((ch) => (
                  <ChannelTableRow
                    key={ch.id}
                    rig={rig}
                    channel={ch}
                    editMode={editMode}
                    isTraced={tracedChannelIds.has(ch.id)}
                    onUpdateChannelAnnotation={onUpdateChannelAnnotation}
                    onTrace={() =>
                      onRunTrace({
                        type: 'channel',
                        nodeId: node.id,
                        portDirection: pg.direction === 'output' ? 'out' : 'in',
                        group: pg.code,
                        slot: ch.slot,
                        channelId: ch.id,
                      })
                    }
                  />
                ))}
              </div>
            ))
          )
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {node.mixBuses.map((bus) => {
              const isTraced = tracedBusIds.has(bus.id);
              const busAnn = rig.annotations.buses[bus.id];
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
                  className={`px-3 py-2.5 transition-colors cursor-pointer ${
                    isTraced
                      ? 'bg-sky-50 dark:bg-sky-950/60'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`inline-flex items-center rounded-[1px] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
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
                      <span className="rounded-[1px] bg-slate-100 dark:bg-slate-800 px-1 py-0 text-[9.5px] font-mono text-slate-600 dark:text-slate-300">
                        {bus.mono ? 'MONO' : 'ST'}
                      </span>
                    </div>
                    <GitBranch
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isTraced
                          ? 'text-sky-600 dark:text-sky-400'
                          : 'text-slate-300 dark:text-slate-600'
                      }`}
                    />
                  </div>

                  {bus.monitorSource && (
                    <div className="mt-1 font-mono text-[10.5px] text-amber-800 dark:text-amber-300">
                      Source tap: {bus.monitorSource.rawRef}
                    </div>
                  )}

                  {bus.outputs.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {bus.outputs.map((out) => (
                        <span
                          key={`${out.group}-${out.slot}`}
                          className="rounded-[1px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:text-slate-300"
                        >
                          Out {out.group}.{out.slot}
                          {out.stereoSide ? ` (${out.stereoSide})` : ''}
                        </span>
                      ))}
                    </div>
                  )}

                  {editMode && (
                    <div
                      className="mt-2 flex gap-1.5"
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
                        className="flex-1 rounded-[1px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] px-2 py-1 text-[11px] text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
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

function OverviewInspectorView({
  rig,
  lockedReadOnly,
  editMode,
  isDark,
  onSelectNode,
  onSelectTrunk,
  onCollapse,
  onDismissOrphan,
  onOpenSnapImport,
  onResetDemo,
}: SideInspectorProps) {
  return (
    <aside className="flex h-full w-full flex-col border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
      <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-700 dark:text-sky-400" />
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Rig Inspector</h2>
          </div>
          <button
            type="button"
            title="Collapse Rig Inspector for full-screen topology view"
            aria-label="Collapse Rig Inspector"
            onClick={onCollapse}
            className="rounded-[2px] p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Select any hardware block or cable trunk on the diagram to inspect 1–48 channel patch lists
          and trace signals end-to-end.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Quick Metrics */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-[2px] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-2.5 text-center">
            <div className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">
              {rig.nodes.length}
            </div>
            <div className="text-[10.5px] font-medium text-slate-500 dark:text-slate-400">
              Devices
            </div>
          </div>
          <div className="rounded-[2px] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-2.5 text-center">
            <div className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">
              {rig.trunks.length}
            </div>
            <div className="text-[10.5px] font-medium text-slate-500 dark:text-slate-400">
              Trunks
            </div>
          </div>
          <div className="rounded-[2px] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-2.5 text-center">
            <div className="font-mono text-lg font-bold text-sky-700 dark:text-sky-400">
              {rig.sourceSnapshots.length}
            </div>
            <div className="text-[10.5px] font-medium text-slate-500 dark:text-slate-400">
              .snap Syncs
            </div>
          </div>
        </div>

        {/* Devices quick list */}
        <div>
          <h3 className="font-display mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Hardware Blocks
          </h3>
          <div className="space-y-1.5">
            {rig.nodes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onSelectNode(n.id)}
                className="flex w-full items-center justify-between rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 px-3 py-2 text-left hover:border-sky-400 dark:hover:border-sky-500 hover:bg-sky-50/40 dark:hover:bg-sky-950/40 transition-colors cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {resolveNodeName(rig, n)}
                  </div>
                  <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {n.model} · {resolveNodeZone(rig, n)}
                  </div>
                </div>
                <Sliders className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* Trunks quick list */}
        <div>
          <h3 className="font-display mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Signal Trunks
          </h3>
          <div className="space-y-1.5">
            {rig.trunks.map((t) => {
              const p = PROTOCOL_META[t.protocol];
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTrunk(t.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 px-3 py-2 text-left hover:border-sky-400 dark:hover:border-sky-500 hover:bg-sky-50/40 dark:hover:bg-sky-950/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      style={{ backgroundColor: isDark ? p.darkColor : p.color }}
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                    />
                    <span className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {resolveTrunkName(rig, t)}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-[10.5px] text-slate-500 dark:text-slate-400">
                    {t.channels.length}
                    {t.returnChannels.length ? ` ↔ ${t.returnChannels.length}` : ' ch'}
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

        {/* Quick Actions (hidden in locked Read-Only shared view) */}
        {!lockedReadOnly && (
          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
            <button
              type="button"
              onClick={onOpenSnapImport}
              className="flex w-full items-center justify-center gap-2 rounded-[2px] bg-sky-600 dark:bg-sky-500 px-3 py-2 text-xs font-semibold text-white dark:text-slate-950 hover:bg-sky-700 dark:hover:bg-sky-400 cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Import Behringer WING .snap
            </button>
            <button
              type="button"
              onClick={onResetDemo}
              className="flex w-full items-center justify-center gap-1.5 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to Sanctuary Demo Rig
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
