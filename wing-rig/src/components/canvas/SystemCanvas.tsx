import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  applyNodeChanges,
  type EdgeTypes,
  type NodeMouseHandler,
  type NodeTypes,
  type OnNodeDrag,
  type OnNodesChange,
} from '@xyflow/react';
import { Move, PanelRightOpen } from 'lucide-react';
import type { Point2D, RigDocument, TraceResult, TrunkConnection, TrunkProtocol } from '../../schema/rig';
import {
  PROTOCOL_META,
  buildNodeTopologySummary,
  resolveNodeName,
  resolveNodePosition,
  resolveNodeZone,
  resolveTrunkCableTag,
  resolveTrunkName,
} from '../../schema/helpers';
import type { SelectionState } from '../../store/useRigStore';
import { HardwareNodeCard, type HardwareFlowNode } from './HardwareNodeCard';
import { TrunkEdge, type TrunkFlowEdge } from './TrunkEdge';
import { TraceBanner } from './TraceBanner';

interface SystemCanvasProps {
  rig: RigDocument;
  editMode: boolean;
  isDark: boolean;
  inspectorCollapsed: boolean;
  selection: SelectionState;
  trace: TraceResult | null;
  onSelectNode: (id: string) => void;
  onSelectTrunk: (id: string) => void;
  onClearSelection: () => void;
  onClearTrace: () => void;
  onNodePositionChange: (nodeId: string, pos: Point2D) => void;
  onExpandInspector: () => void;
}

const nodeTypes: NodeTypes = {
  hardware: HardwareNodeCard,
};

const edgeTypes: EdgeTypes = {
  trunk: TrunkEdge,
};

/**
 * Picks clean source/target handles in all 4 directions (left-to-right, right-to-left,
 * top-to-bottom, bottom-to-top) so rearranging blocks to match the physical room
 * never creates awkward backwards loops.
 */
export function chooseHandlesForPositions(
  srcPos: Point2D,
  tgtPos: Point2D,
): { sourceHandle: string; targetHandle: string } {
  const dx = tgtPos.x - srcPos.x;
  const dy = tgtPos.y - srcPos.y;

  // Prefer vertical handles when target is predominantly above or below source
  if (Math.abs(dy) > Math.abs(dx) * 1.15 && Math.abs(dy) > 90) {
    if (dy > 0) {
      return { sourceHandle: 'bottom-source', targetHandle: 'top-target' };
    }
    return { sourceHandle: 'top-source', targetHandle: 'bottom-target' };
  }

  // Horizontal: route right -> left normally, or left-source -> right-target when rearranged right-to-left
  if (dx < -40) {
    return { sourceHandle: 'left-source', targetHandle: 'right-target' };
  }
  return { sourceHandle: 'right', targetHandle: 'left' };
}

function chooseHandles(
  doc: RigDocument,
  trunk: TrunkConnection,
  livePositions: Map<string, Point2D>,
): { sourceHandle: string; targetHandle: string } {
  const srcNode = doc.nodes.find((n) => n.id === trunk.sourceNodeId);
  const tgtNode = doc.nodes.find((n) => n.id === trunk.targetNodeId);
  if (!srcNode || !tgtNode) {
    return { sourceHandle: 'right', targetHandle: 'left' };
  }
  const srcPos = livePositions.get(srcNode.id) ?? resolveNodePosition(doc, srcNode);
  const tgtPos = livePositions.get(tgtNode.id) ?? resolveNodePosition(doc, tgtNode);
  return chooseHandlesForPositions(srcPos, tgtPos);
}

/**
 * Reconciles RigDocument hardware nodes into React Flow nodes while preserving
 * React Flow v12 internal properties (`measured`, `dragging`, `selected`) so nodes
 * never lose measured dimensions and disappear during or after dragging.
 */
export function reconcileFlowNodes(
  prevNodes: HardwareFlowNode[],
  params: {
    rig: RigDocument;
    editMode: boolean;
    isDark?: boolean;
    selection: SelectionState;
    trace: TraceResult | null;
    activeNodeSet: Set<string>;
    snapshotNodeIds: Set<string>;
    onSelectNode: (id: string) => void;
  },
): HardwareFlowNode[] {
  const {
    rig,
    editMode,
    isDark = false,
    selection,
    trace,
    activeNodeSet,
    snapshotNodeIds,
    onSelectNode,
  } = params;
  const prevById = new Map(prevNodes.map((n) => [n.id, n]));

  return rig.nodes.map((node) => {
    const prev = prevById.get(node.id);
    const traceState: 'none' | 'active' | 'dimmed' = !trace
      ? 'none'
      : activeNodeSet.has(node.id)
        ? 'active'
        : 'dimmed';

    return {
      ...prev,
      id: node.id,
      type: 'hardware',
      position: prev?.dragging ? prev.position : resolveNodePosition(rig, node),
      draggable: editMode,
      data: {
        hardware: node,
        displayName: resolveNodeName(rig, node),
        displayZone: resolveNodeZone(rig, node),
        summary: buildNodeTopologySummary(rig, node),
        isDark,
        editMode,
        isSelected: selection?.type === 'node' && selection.id === node.id,
        traceState,
        hasSnapshotSync: snapshotNodeIds.has(node.id) || node.sourceOrigin === 'snapshot',
        onSelect: onSelectNode,
      },
    };
  });
}

export function SystemCanvas({
  rig,
  editMode,
  isDark,
  inspectorCollapsed,
  selection,
  trace,
  onSelectNode,
  onSelectTrunk,
  onClearSelection,
  onClearTrace,
  onNodePositionChange,
  onExpandInspector,
}: SystemCanvasProps) {
  const activeNodeSet = useMemo(() => new Set(trace?.activeNodeIds ?? []), [trace]);
  const activeTrunkSet = useMemo(() => new Set(trace?.activeTrunkIds ?? []), [trace]);
  const snapshotNodeIds = useMemo(
    () => new Set(rig.sourceSnapshots.map((s) => s.consoleNodeId)),
    [rig.sourceSnapshots],
  );

  // Stateful React Flow nodes updated via applyNodeChanges so React Flow v12
  // preserves `measured` dimensions across drags, re-renders, and mode switches.
  const [flowNodes, setFlowNodes] = useState<HardwareFlowNode[]>(() =>
    reconcileFlowNodes([], {
      rig,
      editMode,
      isDark,
      selection,
      trace,
      activeNodeSet,
      snapshotNodeIds,
      onSelectNode,
    }),
  );

  useEffect(() => {
    setFlowNodes((prev) =>
      reconcileFlowNodes(prev, {
        rig,
        editMode,
        isDark,
        selection,
        trace,
        activeNodeSet,
        snapshotNodeIds,
        onSelectNode,
      }),
    );
  }, [rig, editMode, isDark, selection, trace, activeNodeSet, snapshotNodeIds, onSelectNode]);

  const livePositions = useMemo(
    () => new Map(flowNodes.map((n) => [n.id, n.position])),
    [flowNodes],
  );

  const flowEdges: TrunkFlowEdge[] = useMemo(
    () =>
      rig.trunks.map((trunk) => {
        const traceState = !trace
          ? 'none'
          : activeTrunkSet.has(trunk.id)
            ? 'active'
            : 'dimmed';
        const { sourceHandle, targetHandle } = chooseHandles(rig, trunk, livePositions);
        return {
          id: trunk.id,
          type: 'trunk',
          source: trunk.sourceNodeId,
          target: trunk.targetNodeId,
          sourceHandle,
          targetHandle,
          animated: traceState === 'active',
          data: {
            trunk,
            displayName: resolveTrunkName(rig, trunk),
            cableTag: resolveTrunkCableTag(rig, trunk),
            isSelected: selection?.type === 'trunk' && selection.id === trunk.id,
            isDark,
            traceState,
            onSelect: onSelectTrunk,
          },
        };
      }),
    [rig, livePositions, selection, isDark, trace, activeTrunkSet, onSelectTrunk],
  );

  const handleNodesChange: OnNodesChange<HardwareFlowNode> = useCallback(
    (changes) => {
      // Always allow React Flow dimension/selection changes so nodes stay measured & visible;
      // only allow position moves when Edit Mode is unlocked.
      const allowed = editMode
        ? changes.filter((c) => c.type !== 'remove')
        : changes.filter((c) => c.type !== 'position' && c.type !== 'remove');
      if (allowed.length === 0) return;

      setFlowNodes((nds) => applyNodeChanges(allowed, nds));
    },
    [editMode],
  );

  const handleNodeClick: NodeMouseHandler<HardwareFlowNode> = useCallback(
    (_event, node) => {
      onSelectNode(node.id);
    },
    [onSelectNode],
  );

  const handleNodeDragStop: OnNodeDrag<HardwareFlowNode> = useCallback(
    (_event, node) => {
      if (!editMode) return;
      onNodePositionChange(node.id, node.position);
    },
    [editMode, onNodePositionChange],
  );

  const usedProtocols = useMemo(() => {
    const set = new Set<TrunkProtocol>();
    for (const t of rig.trunks) set.add(t.protocol);
    return [...set];
  }, [rig.trunks]);

  const collapsedInspectLabel = useMemo(() => {
    if (!selection) return 'Rig Inspector';
    if (selection.type === 'node') {
      const n = rig.nodes.find((item) => item.id === selection.id);
      return n ? `Inspect: ${resolveNodeName(rig, n)}` : 'Rig Inspector';
    }
    const t = rig.trunks.find((item) => item.id === selection.id);
    return t ? `Inspect: ${resolveTrunkName(rig, t)}` : 'Rig Inspector';
  }, [rig, selection]);

  return (
    <div className="relative h-full w-full bg-[#f3f5f8] dark:bg-[#090d14]">
      {trace && (
        <TraceBanner
          trace={trace}
          onClear={onClearTrace}
          onSelectNode={onSelectNode}
          onSelectTrunk={onSelectTrunk}
        />
      )}

      {/* Subtle Edit Mode room-layout drag cue */}
      {editMode && !trace && (
        <div className="pointer-events-none absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 rounded-[2px] border border-amber-400/90 dark:border-amber-700/80 bg-amber-50/95 dark:bg-amber-950/90 backdrop-blur-xs px-2.5 py-1 font-mono text-[10.5px] font-semibold text-amber-900 dark:text-amber-200 shadow-xs">
          <Move className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>EDIT MODE · DRAG BLOCKS TO ARRANGE · AUTO-SAVED</span>
        </div>
      )}

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={editMode}
        nodesConnectable={false}
        elementsSelectable={true}
        snapToGrid={true}
        snapGrid={[14, 14]}
        onNodesChange={handleNodesChange}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={() => onClearSelection()}
        fitView
        fitViewOptions={{ padding: 0.16, maxZoom: 1.05 }}
        minZoom={0.35}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={28}
          lineWidth={1}
          color={isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.055)'}
        />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>

      {/* Protocol Legend & Read-Only / Edit status strip */}
      <div className="pointer-events-auto absolute bottom-3 left-14 z-10 hidden sm:flex items-center gap-2.5 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white/95 dark:bg-[#111827]/95 backdrop-blur-xs px-3 py-1.5 shadow-xs">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Trunks
        </span>
        {usedProtocols.map((protocol) => {
          const meta = PROTOCOL_META[protocol];
          return (
            <span
              key={protocol}
              className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-semibold text-slate-700 dark:text-slate-200"
            >
              <span
                style={{ backgroundColor: isDark ? meta.darkColor : meta.color }}
                className="h-1.5 w-3.5"
              />
              {meta.shortLabel}
            </span>
          );
        })}
        <span className="mx-0.5 h-3.5 w-px bg-slate-200 dark:bg-slate-700" />
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {editMode ? 'Drag devices to arrange' : 'Click any device or trunk to inspect & trace'}
        </span>
      </div>

      {/* Floating Expand Inspector button when Rig Inspector is collapsed */}
      {inspectorCollapsed && (
        <button
          type="button"
          onClick={onExpandInspector}
          title="Expand Rig Inspector"
          className="pointer-events-auto absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-[2px] border border-slate-400 dark:border-slate-600 bg-white/95 dark:bg-[#111827]/95 backdrop-blur-xs px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100 shadow-xs hover:border-sky-600 hover:text-sky-700 dark:hover:text-sky-400 transition-colors cursor-pointer"
        >
          <PanelRightOpen className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
          <span className="max-w-[190px] truncate">{collapsedInspectLabel}</span>
        </button>
      )}
    </div>
  );
}
