import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
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
  dragOverrides: Record<string, Point2D>,
): { sourceHandle: string; targetHandle: string } {
  const srcNode = doc.nodes.find((n) => n.id === trunk.sourceNodeId);
  const tgtNode = doc.nodes.find((n) => n.id === trunk.targetNodeId);
  if (!srcNode || !tgtNode) {
    return { sourceHandle: 'right', targetHandle: 'left' };
  }
  const srcPos = dragOverrides[srcNode.id] ?? resolveNodePosition(doc, srcNode);
  const tgtPos = dragOverrides[tgtNode.id] ?? resolveNodePosition(doc, tgtNode);
  return chooseHandlesForPositions(srcPos, tgtPos);
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
  // Live in-flight drag positions so React Flow moves nodes smoothly at 60fps
  // before committing final coordinates to Layer 2 annotations (localStorage).
  const [dragPositions, setDragPositions] = useState<Record<string, Point2D>>({});

  const activeNodeSet = useMemo(() => new Set(trace?.activeNodeIds ?? []), [trace]);
  const activeTrunkSet = useMemo(() => new Set(trace?.activeTrunkIds ?? []), [trace]);
  const snapshotNodeIds = useMemo(
    () => new Set(rig.sourceSnapshots.map((s) => s.consoleNodeId)),
    [rig.sourceSnapshots],
  );

  const flowNodes: HardwareFlowNode[] = useMemo(
    () =>
      rig.nodes.map((node) => {
        const traceState = !trace
          ? 'none'
          : activeNodeSet.has(node.id)
            ? 'active'
            : 'dimmed';
        return {
          id: node.id,
          type: 'hardware',
          position: dragPositions[node.id] ?? resolveNodePosition(rig, node),
          draggable: editMode,
          data: {
            hardware: node,
            displayName: resolveNodeName(rig, node),
            displayZone: resolveNodeZone(rig, node),
            notes: rig.annotations.nodes[node.id]?.notes,
            editMode,
            isSelected: selection?.type === 'node' && selection.id === node.id,
            traceState,
            hasSnapshotSync: snapshotNodeIds.has(node.id) || node.sourceOrigin === 'snapshot',
            onSelect: onSelectNode,
          },
        };
      }),
    [rig, dragPositions, editMode, selection, trace, activeNodeSet, snapshotNodeIds, onSelectNode],
  );

  const flowEdges: TrunkFlowEdge[] = useMemo(
    () =>
      rig.trunks.map((trunk) => {
        const traceState = !trace
          ? 'none'
          : activeTrunkSet.has(trunk.id)
            ? 'active'
            : 'dimmed';
        const { sourceHandle, targetHandle } = chooseHandles(rig, trunk, dragPositions);
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
    [rig, dragPositions, selection, isDark, trace, activeTrunkSet, onSelectTrunk],
  );

  const handleNodesChange: OnNodesChange<HardwareFlowNode> = useCallback(
    (changes) => {
      if (!editMode) return;
      const updates: Record<string, Point2D> = {};
      const committed: Array<{ id: string; pos: Point2D }> = [];
      let hasUpdates = false;

      for (const ch of changes) {
        if (ch.type === 'position' && ch.position) {
          updates[ch.id] = ch.position;
          hasUpdates = true;
          if (ch.dragging === false) {
            committed.push({ id: ch.id, pos: ch.position });
          }
        }
      }

      if (hasUpdates) {
        setDragPositions((prev) => ({ ...prev, ...updates }));
      }
      if (committed.length > 0) {
        for (const item of committed) {
          onNodePositionChange(item.id, item.pos);
        }
        setDragPositions((prev) => {
          const next = { ...prev };
          for (const item of committed) delete next[item.id];
          return next;
        });
      }
    },
    [editMode, onNodePositionChange],
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
      setDragPositions((prev) => {
        if (!(node.id in prev)) return prev;
        const next = { ...prev };
        delete next[node.id];
        return next;
      });
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
    <div className="relative h-full w-full bg-slate-50 dark:bg-slate-950">
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
        <div className="pointer-events-none absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 rounded-lg border border-amber-300/90 dark:border-amber-700/80 bg-amber-50/95 dark:bg-amber-950/90 backdrop-blur-xs px-2.5 py-1 text-[11px] font-medium text-amber-900 dark:text-amber-200 shadow-xs">
          <Move className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>Drag blocks to arrange room layout · Auto-saved</span>
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
        snapGrid={[11, 11]}
        onNodesChange={handleNodesChange}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={() => onClearSelection()}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
        minZoom={0.35}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.2}
          color={isDark ? '#334155' : '#cbd5e1'}
        />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>

      {/* Protocol Legend & Read-Only / Edit status pill */}
      <div className="pointer-events-auto absolute bottom-3 left-14 z-10 hidden sm:flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/92 dark:bg-slate-900/92 backdrop-blur-xs px-3 py-1.5 shadow-xs">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Trunks
        </span>
        {usedProtocols.map((protocol) => {
          const meta = PROTOCOL_META[protocol];
          return (
            <span
              key={protocol}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200"
            >
              <span
                style={{ backgroundColor: isDark ? meta.darkColor : meta.color }}
                className="h-2 w-4 rounded-full"
              />
              {meta.shortLabel}
            </span>
          );
        })}
        <span className="mx-1 h-3.5 w-px bg-slate-200 dark:bg-slate-700" />
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
          className="pointer-events-auto absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 shadow-sm hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-400 transition-colors cursor-pointer"
        >
          <PanelRightOpen className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
          <span className="max-w-[190px] truncate">{collapsedInspectLabel}</span>
        </button>
      )}
    </div>
  );
}
