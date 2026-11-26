import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
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
    borderRadius: 16,
  });

  if (!data) return null;

  const { trunk, displayName, cableTag, isSelected, isDark, traceState, onSelect } = data;
  const proto = PROTOCOL_META[trunk.protocol];
  const fwdCount = trunk.channels.length;
  const retCount = trunk.returnChannels.length;
  const isBidirectional = retCount > 0;

  const strokeWidth = traceState === 'active' ? 3.5 : isSelected ? 3 : 2.25;
  const opacity = traceState === 'dimmed' ? 0.18 : 1;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: isDark ? proto.darkColor : proto.color,
          strokeWidth,
          opacity,
          transition: 'opacity 150ms ease, stroke-width 150ms ease',
        }}
      />
      <EdgeLabelRenderer>
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
            onClick={(e) => {
              e.stopPropagation();
              onSelect(trunk.id);
            }}
            className={`group flex flex-col items-center gap-0.5 rounded-lg border px-2.5 py-1 text-left shadow-xs transition-all cursor-pointer ${
              traceState === 'active'
                ? 'bg-sky-50 dark:bg-sky-950/90 border-sky-600 dark:border-sky-400 ring-3 ring-sky-500/20 dark:ring-sky-400/25 shadow-sm'
                : isSelected
                  ? 'bg-white dark:bg-slate-900 border-slate-900 dark:border-slate-200 ring-2 ring-slate-900/10 dark:ring-slate-200/15 shadow-sm'
                  : 'bg-white/95 dark:bg-slate-900/95 border-slate-300 dark:border-slate-700 hover:border-slate-500 dark:hover:border-slate-500 hover:bg-white dark:hover:bg-slate-900'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                style={{
                  backgroundColor: isDark ? proto.darkBg : proto.bg,
                  color: isDark ? proto.darkText : proto.text,
                  borderColor: isDark ? proto.darkBorder : proto.border,
                }}
                className="inline-flex items-center rounded border px-1.5 py-0 text-[9.5px] font-mono font-semibold uppercase tracking-wide leading-4"
              >
                {proto.shortLabel}
              </span>
              <span className="max-w-[148px] truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                {displayName}
              </span>
            </div>

            <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-600 dark:text-slate-400">
              {isBidirectional ? (
                <span className="inline-flex items-center gap-1">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{fwdCount}</span>
                  <ArrowLeftRight className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{retCount}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{fwdCount} ch</span>
                  <ArrowRight className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                </span>
              )}
              {cableTag && (
                <span className="rounded bg-slate-100 dark:bg-slate-800 px-1 text-[9.5px] text-slate-500 dark:text-slate-400">
                  {cableTag}
                </span>
              )}
            </div>
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
