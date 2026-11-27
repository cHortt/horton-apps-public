import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { ArrowLeftRight, ArrowRight } from 'lucide-react';
import type { TrunkConnection } from '../../schema/rig';
import { PROTOCOL_META } from '../../schema/helpers';

export interface TrunkEdgeData extends Record<string, unknown> {
  trunk: TrunkConnection;
  displayName: string;
  cableTag?: string;
  isSelected: boolean;
  isDark?: boolean;
  traceState: 'none' | 'active' | 'dimmed';
  onSelect: (id: string) => void;
}

export type TrunkFlowEdge = Edge<TrunkEdgeData, 'trunk'>;

function offsetFromHandle(x: number, y: number, position: Position, dist: number): { x: number; y: number } {
  switch (position) {
    case Position.Right:
      return { x: x + dist, y };
    case Position.Left:
      return { x: x - dist, y };
    case Position.Bottom:
      return { x, y: y + dist };
    case Position.Top:
      return { x, y: y - dist };
    default:
      return { x, y };
  }
}

export const TrunkEdge = memo(function TrunkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<TrunkFlowEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 2,
  });

  if (!data) return null;

  const { trunk, displayName, cableTag, isSelected, isDark, traceState, onSelect } = data;
  const proto = PROTOCOL_META[trunk.protocol];
  const strokeColor = isDark ? proto.darkColor : proto.color;
  const fwdCount = trunk.channels.length;
  const retCount = trunk.returnChannels.length;
  const isBidirectional = retCount > 0;

  const strokeWidth = traceState === 'active' ? 3.25 : isSelected ? 2.75 : 2.15;
  const opacity = traceState === 'dimmed' ? 0.16 : 1;

  // Show port-endpoint stamps when there's comfortable visual runway between nodes
  const spanDist = Math.hypot(targetX - sourceX, targetY - sourceY);
  const showEndpointStamps = spanDist >= 110;
  const srcStampPos = offsetFromHandle(sourceX, sourceY, sourcePosition, 16);
  const tgtStampPos = offsetFromHandle(targetX, targetY, targetPosition, 16);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth,
          opacity,
          transition: 'opacity 150ms ease, stroke-width 150ms ease',
        }}
      />
      <EdgeLabelRenderer>
        {/* Port Endpoint Stamps */}
        {showEndpointStamps && (
          <>
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${srcStampPos.x}px, ${srcStampPos.y}px)`,
                pointerEvents: 'none',
                opacity,
                borderColor: strokeColor,
                color: strokeColor,
              }}
              className="border bg-white dark:bg-[#090d14] px-1 py-0.5 font-mono text-[8.5px] font-bold leading-none uppercase tracking-tight"
            >
              {trunk.sourcePortGroup}
            </div>
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${tgtStampPos.x}px, ${tgtStampPos.y}px)`,
                pointerEvents: 'none',
                opacity,
                borderColor: strokeColor,
                color: strokeColor,
              }}
              className="border bg-white dark:bg-[#090d14] px-1 py-0.5 font-mono text-[8.5px] font-bold leading-none uppercase tracking-tight"
            >
              {trunk.targetPortGroup}
            </div>
          </>
        )}

        {/* Broadcast Patchbay Split Two-Tone Trunk Callout */}
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            opacity,
            transition: 'opacity 150ms ease',
          }}
          className="nodrag nopan"
        >
          <button
            type="button"
            title={`${displayName}${cableTag ? ` (${cableTag})` : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(trunk.id);
            }}
            style={{
              borderColor:
                traceState === 'active'
                  ? strokeColor
                  : isSelected
                    ? isDark
                      ? '#f1f5f9'
                      : '#0f172a'
                    : strokeColor,
            }}
            className={`group flex flex-col items-stretch rounded-[1px] border bg-white dark:bg-[#111827] text-left transition-all cursor-pointer ${
              traceState === 'active'
                ? 'ring-2 ring-sky-500/30 dark:ring-sky-400/35 shadow-sm'
                : isSelected
                  ? 'ring-2 ring-slate-900/15 dark:ring-slate-100/20 shadow-sm'
                  : 'hover:shadow-xs'
            }`}
          >
            {/* Primary split bar: solid protocol block | channel counts */}
            <div className="flex items-stretch font-mono text-[10px]">
              <span
                style={{
                  backgroundColor: strokeColor,
                  color: isDark ? '#090d14' : '#ffffff',
                }}
                className="inline-flex items-center px-1.5 py-0.5 font-bold uppercase tracking-wider leading-none"
              >
                {proto.shortLabel}
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 font-semibold text-slate-900 dark:text-slate-100 leading-none">
                {isBidirectional ? (
                  <>
                    <span>{fwdCount}</span>
                    <ArrowLeftRight className="w-2.5 h-2.5 text-slate-400 dark:text-slate-500" />
                    <span>{retCount}</span>
                  </>
                ) : (
                  <>
                    <span>{fwdCount} ch</span>
                    <ArrowRight className="w-2.5 h-2.5 text-slate-400 dark:text-slate-500" />
                  </>
                )}
              </span>
            </div>

            {/* Secondary cable tag or concise trunk name strip */}
            {(cableTag || displayName) && (
              <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b111d] px-1.5 py-0.5 font-mono text-[8.5px] text-slate-600 dark:text-slate-400 max-w-[152px] truncate text-center leading-tight">
                {cableTag ?? displayName}
              </div>
            )}
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
