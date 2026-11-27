import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { GripHorizontal } from 'lucide-react';
import type { HardwareNode, RigZone } from '../../schema/rig';
import { PROTOCOL_META, type NodeTopologySummary } from '../../schema/helpers';

export interface HardwareNodeData extends Record<string, unknown> {
  hardware: HardwareNode;
  displayName: string;
  displayZone: RigZone;
  summary: NodeTopologySummary;
  isDark: boolean;
  editMode: boolean;
  isSelected: boolean;
  traceState: 'none' | 'active' | 'dimmed';
  hasSnapshotSync: boolean;
  onSelect: (id: string) => void;
}

export type HardwareFlowNode = Node<HardwareNodeData, 'hardware'>;

const ZONE_ACCENT: Record<RigZone, { light: string; dark: string }> = {
  Stage: { light: '#059669', dark: '#34d399' },
  'Stage Rack': { light: '#0284c7', dark: '#38bdf8' },
  'FOH Booth': { light: '#4f46e5', dark: '#818cf8' },
  'Amp Vault': { light: '#b45309', dark: '#fbbf24' },
  Broadcast: { light: '#e11d48', dark: '#fb7185' },
  Custom: { light: '#475569', dark: '#94a3b8' },
};

const STATUS_TONE_CLASS: Record<NodeTopologySummary['statusTone'], string> = {
  sky: 'text-sky-700 dark:text-sky-300',
  indigo: 'text-indigo-700 dark:text-indigo-300',
  rose: 'text-rose-700 dark:text-rose-300',
  amber: 'text-amber-700 dark:text-amber-300',
  slate: 'text-slate-600 dark:text-slate-400',
};

export const HardwareNodeCard = memo(function HardwareNodeCard({
  data,
}: NodeProps<HardwareFlowNode>) {
  const {
    hardware,
    displayName,
    displayZone,
    summary,
    isDark,
    editMode,
    isSelected,
    traceState,
    hasSnapshotSync,
  } = data;

  const isHub = summary.role === 'hub';
  const zoneColor = isDark ? ZONE_ACCENT[displayZone].dark : ZONE_ACCENT[displayZone].light;

  const frameColorClass =
    traceState === 'active'
      ? 'bg-sky-600 dark:bg-sky-400'
      : isSelected
        ? 'bg-slate-900 dark:bg-slate-100'
        : isHub
          ? 'bg-slate-700 dark:bg-slate-400 group-hover:bg-slate-900 dark:group-hover:bg-slate-200'
          : 'bg-slate-400 dark:bg-slate-600 group-hover:bg-slate-600 dark:group-hover:bg-slate-400';

  const framePadding = traceState === 'active' || isSelected || isHub ? 'p-[1.5px]' : 'p-[1px]';

  const outerShadow =
    traceState === 'active'
      ? 'drop-shadow-[0_0_8px_rgba(2,132,199,0.35)] dark:drop-shadow-[0_0_10px_rgba(56,189,248,0.35)]'
      : isSelected
        ? 'drop-shadow-[0_3px_6px_rgba(15,23,42,0.16)] dark:drop-shadow-[0_3px_8px_rgba(0,0,0,0.55)]'
        : 'drop-shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]';

  const opacityClass = traceState === 'dimmed' ? 'opacity-25 saturate-50' : 'opacity-100';

  return (
    <div
      className={`group relative transition-all duration-150 select-none ${
        isHub ? 'w-[274px]' : 'w-[248px]'
      } ${opacityClass} ${outerShadow} ${
        editMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      }`}
    >
      {/* Square Broadcast Patchbay connection terminals (kept outside clip-path so never clipped) */}
      <Handle
        id="left"
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !rounded-none !bg-slate-500 dark:!bg-slate-400 !border !border-white dark:!border-[#111827]"
      />
      <Handle
        id="left-source"
        type="source"
        position={Position.Left}
        className="!w-2 !h-2 !rounded-none !bg-slate-500 dark:!bg-slate-400 !border !border-white dark:!border-[#111827] !opacity-0"
      />
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !rounded-none !bg-slate-500 dark:!bg-slate-400 !border !border-white dark:!border-[#111827]"
      />
      <Handle
        id="right-target"
        type="target"
        position={Position.Right}
        className="!w-2 !h-2 !rounded-none !bg-slate-500 dark:!bg-slate-400 !border !border-white dark:!border-[#111827] !opacity-0"
      />
      <Handle
        id="top-target"
        type="target"
        position={Position.Top}
        className="!w-2 !h-1.5 !rounded-none !bg-slate-400 dark:!bg-slate-500 !border !border-white dark:!border-[#111827]"
      />
      <Handle
        id="bottom-source"
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-1.5 !rounded-none !bg-slate-400 dark:!bg-slate-500 !border !border-white dark:!border-[#111827]"
      />
      <Handle
        id="top-source"
        type="source"
        position={Position.Top}
        className="!w-2 !h-1.5 !rounded-none !bg-slate-400 dark:!bg-slate-500 !border !border-white dark:!border-[#111827] !opacity-0"
      />
      <Handle
        id="bottom-target"
        type="target"
        position={Position.Bottom}
        className="!w-2 !h-1.5 !rounded-none !bg-slate-400 dark:!bg-slate-500 !border !border-white dark:!border-[#111827] !opacity-0"
      />

      {/* Chamfered outer border shell */}
      <div className={`patchbay-chamfer transition-colors duration-150 ${frameColorClass} ${framePadding}`}>
        {/* Chamfered inner body */}
        <div className="patchbay-chamfer bg-white dark:bg-[#111827] text-slate-900 dark:text-slate-100">
          {/* Top metadata rail (padded right to clear 45° chamfer) */}
          <div className="flex items-center justify-between gap-2 pl-2.5 pr-5 py-1.5 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-1.5 min-w-0">
              {editMode && (
                <GripHorizontal
                  aria-hidden="true"
                  className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                />
              )}
              <span
                aria-hidden="true"
                style={{ backgroundColor: zoneColor }}
                className="w-1.5 h-1.5 shrink-0"
              />
              <span className="font-display text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
                {displayZone}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 font-mono text-[9.5px] font-bold">
              {hasSnapshotSync && (
                <span
                  title="Synced from Behringer WING .snap snapshot"
                  className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500 dark:bg-sky-400"
                />
              )}
              <span className={STATUS_TONE_CLASS[summary.statusTone]}>{summary.statusText}</span>
            </div>
          </div>

          {/* Device Identity Block */}
          <div className="px-2.5 pt-2 pb-1.5">
            <div
              title={displayName}
              className="font-display text-[15.5px] font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-50 truncate"
            >
              {displayName}
            </div>
            <div
              title={summary.subtitle}
              className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate mt-0.5"
            >
              {summary.subtitle}
            </div>
          </div>

          {/* Role-Adaptive Recessed Terminal / Feed Wells */}
          {summary.rows.length > 0 ? (
            <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-[#0b111d] p-1.5 space-y-1 font-mono text-[10px]">
              {summary.rows.map((row, idx) => {
                const proto = PROTOCOL_META[row.protocol];
                const accent = isDark ? proto.darkColor : proto.color;
                return (
                  <div
                    key={`${hardware.id}-row-${idx}-${row.left}`}
                    style={{ borderLeftColor: accent }}
                    className="flex items-center justify-between gap-2 bg-white dark:bg-[#111827] border border-slate-300/80 dark:border-slate-700/80 border-l-[3px] px-1.5 py-0.5"
                  >
                    <span className="font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                      {row.left}
                    </span>
                    <span
                      title={row.right}
                      className="text-slate-600 dark:text-slate-400 truncate text-right"
                    >
                      {row.right}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-[#0b111d] px-2.5 py-1.5 font-mono text-[10px] text-slate-400 dark:text-slate-500">
              No active channels patched
            </div>
          )}

          {/* Concise 1-line Operational Footer */}
          {summary.noteLine && (
            <div
              title={summary.noteLine}
              className="border-t border-slate-200 dark:border-slate-800 px-2.5 py-1 font-mono text-[9.5px] text-slate-500 dark:text-slate-400 truncate"
            >
              {summary.noteLine}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
