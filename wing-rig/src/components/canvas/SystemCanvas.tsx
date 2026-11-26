import { useCallback, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type EdgeTypes,
  type NodeMouseHandler,
  type NodeTypes,
  type OnNodeDrag,
} from '@xyflow/react';
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
  selection: SelectionState;
  trace: TraceResult | null;
  onSelectNode: (id: string) => void;
  onSelectTrunk: (id: string) => void;
  onClearSelection: () => void;
  onClearTrace: () => void;
  onNodePositionChange: (nodeId: string, pos: Point2D) => void;
}

const nodeTypes: NodeTypes = {
  hardware: HardwareNodeCard,
};

const edgeTypes: EdgeTypes = {
  trunk: TrunkEdge,
};

function chooseHandles(
  doc: RigDocument,
  trunk: TrunkConnection,
): { sourceHandle: string; targetHandle: string } {
  const srcNode = doc.nodes.find((n) => n.id === trunk.sourceNodeId);
  const tgtNode = doc.nodes.find((n) => n.id === trunk.targetNodeId);
  if (!srcNode || !tgtNode) {
    return { sourceHandle: 'right', targetHandle: 'left' };
  }
  const srcPos = resolveNodePosition(doc, srcNode);
  const tgtPos = resolveNodePosition(doc, tgtNode);
  const dx = tgtPos.x - srcPos.x;
  const dy = tgtPos.y - srcPos.y;

  // Vertical connection when nodes are stacked in the same column (e.g. Stage WING -> IEM Rack, Media PC -> FOH WING)
  if (Math.abs(dx) < 120 && Math.abs(dy) > 120) {
    if (dy > 0) {
      return { sourceHandle: 'bottom-source', targetHandle: 'top-target' };
    }
    return { sourceHandle: 'top-source', targetHandle: 'bottom-target' };
  }
  return { sourceHandle: 'right', targetHandle: 'left' };
}

export function SystemCanvas({
  rig,
  editMode,
  selection,
  trace,
  onSelectNode,
  onSelectTrunk,
  onClearSelection,
  onClearTrace,
  onNodePositionChange,
}: SystemCanvasProps) {
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
          position: resolveNodePosition(rig, node),
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
    [rig, editMode, selection, trace, activeNodeSet, snapshotNodeIds, onSelectNode],
  );

  const flowEdges: TrunkFlowEdge[] = useMemo(
    () =>
      rig.trunks.map((trunk) => {
        const traceState = !trace
          ? 'none'
          : activeTrunkSet.has(trunk.id)
            ? 'active'
            : 'dimmed';
        const { sourceHandle, targetHandle } = chooseHandles(rig, trunk);
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
            traceState,
            onSelect: onSelectTrunk,
          },
        };
      }),
    [rig, selection, trace, activeTrunkSet, onSelectTrunk],
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

  return (
    <div className="relative h-full w-full bg-slate-50">
      {trace && (
        <TraceBanner
          trace={trace}
          onClear={onClearTrace}
          onSelectNode={onSelectNode}
          onSelectTrunk={onSelectTrunk}
        />
      )}

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={editMode}
        nodesConnectable={false}
        elementsSelectable={true}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={() => onClearSelection()}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
        minZoom={0.35}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#cbd5e1" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="bottom-right"
          nodeStrokeWidth={2}
          nodeColor={(n) => {
            const d = n.data as HardwareFlowNode['data'] | undefined;
            if (!d) return '#94a3b8';
            if (d.traceState === 'active') return '#0284c7';
            if (d.hardware.kind === 'console') return '#0f172a';
            return '#cbd5e1';
          }}
          maskColor="rgba(248, 250, 252, 0.72)"
        />
      </ReactFlow>

      {/* Protocol Legend & Read-Only / Edit status pill */}
      <div className="pointer-events-auto absolute bottom-3 left-14 z-10 hidden sm:flex items-center gap-2 rounded-lg border border-slate-200 bg-white/92 backdrop-blur-xs px-3 py-1.5 shadow-xs">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Trunks
        </span>
        {usedProtocols.map((protocol) => {
          const meta = PROTOCOL_META[protocol];
          return (
            <span
              key={protocol}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700"
            >
              <span
                style={{ backgroundColor: meta.color }}
                className="h-2 w-4 rounded-full"
              />
              {meta.shortLabel}
            </span>
          );
        })}
        <span className="mx-1 h-3.5 w-px bg-slate-200" />
        <span className="text-[11px] text-slate-500">
          {editMode ? 'Drag devices to arrange' : 'Click any device or trunk to inspect & trace'}
        </span>
      </div>
    </div>
  );
}
