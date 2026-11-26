import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  Cpu,
  GripHorizontal,
  Headphones,
  MonitorPlay,
  Radio,
  Server,
  Sliders,
  Speaker,
  Zap,
} from 'lucide-react';
import type { HardwareNode, HardwareNodeKind, RigZone } from '../../schema/rig';

export interface HardwareNodeData extends Record<string, unknown> {
  hardware: HardwareNode;
  displayName: string;
  displayZone: RigZone;
  notes?: string;
  editMode: boolean;
  isSelected: boolean;
  traceState: 'none' | 'active' | 'dimmed';
  hasSnapshotSync: boolean;
  onSelect: (id: string) => void;
}

export type HardwareFlowNode = Node<HardwareNodeData, 'hardware'>;

const ZONE_STYLES: Record<RigZone, string> = {
  Stage: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800/80',
  'Stage Rack': 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/70 dark:text-sky-300 dark:border-sky-800/80',
  'FOH Booth': 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800/80',
  'Amp Vault': 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/80',
  Broadcast: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800/80',
  Custom: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};

const KIND_ACCENT: Record<HardwareNodeKind, string> = {
  console: 'bg-slate-900 text-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:border dark:border-sky-500/30',
  stagebox: 'bg-emerald-700 text-white dark:bg-emerald-600/90',
  wireless: 'bg-amber-600 text-white dark:bg-amber-600/90',
  iem: 'bg-cyan-700 text-white dark:bg-cyan-600/90',
  media: 'bg-indigo-700 text-white dark:bg-indigo-600/90',
  amp: 'bg-slate-700 text-amber-300 dark:bg-slate-800 dark:text-amber-300 dark:border dark:border-slate-700',
  external: 'bg-slate-600 text-white dark:bg-slate-700',
};

function DeviceIcon({ kind }: { kind: HardwareNodeKind }) {
  const cls = 'w-4 h-4';
  switch (kind) {
    case 'console':
      return <Sliders className={cls} />;
    case 'stagebox':
      return <Server className={cls} />;
    case 'wireless':
      return <Radio className={cls} />;
    case 'iem':
      return <Headphones className={cls} />;
    case 'media':
      return <MonitorPlay className={cls} />;
    case 'amp':
      return <Speaker className={cls} />;
    default:
      return <Cpu className={cls} />;
  }
}

export const HardwareNodeCard = memo(function HardwareNodeCard({
  data,
}: NodeProps<HardwareFlowNode>) {
  const { hardware, displayName, displayZone, notes, editMode, isSelected, traceState, hasSnapshotSync } =
    data;

  const inputCount = hardware.portGroups
    .filter((pg) => pg.direction !== 'output')
    .reduce((sum, pg) => sum + pg.channels.length, 0);
  const outputCount = hardware.portGroups
    .filter((pg) => pg.direction !== 'input')
    .reduce((sum, pg) => sum + pg.channels.length, 0);
  const phantomCount = hardware.portGroups
    .filter((pg) => pg.direction !== 'output')
    .reduce(
      (sum, pg) => sum + pg.channels.filter((c) => Boolean(c.phantom48v)).length,
      0,
    );
  const busCount = hardware.mixBuses.filter((b) => b.kind === 'bus' || b.kind === 'mtx').length;

  const isConsole = hardware.kind === 'console';

  const containerRing =
    traceState === 'active'
      ? 'border-sky-600 dark:border-sky-400 ring-4 ring-sky-500/20 dark:ring-sky-400/25 shadow-md'
      : isSelected
        ? 'border-slate-900 dark:border-slate-200 ring-3 ring-slate-900/10 dark:ring-slate-200/15 shadow-md'
        : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 shadow-xs';

  const opacityClass = traceState === 'dimmed' ? 'opacity-25 saturate-50' : 'opacity-100';

  return (
    <div
      className={`group relative rounded-xl border bg-white dark:bg-slate-900 transition-all duration-150 select-none ${
        isConsole ? 'w-[272px]' : 'w-[238px]'
      } ${containerRing} ${opacityClass} ${editMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
    >
      {/* Left / Right / Top / Bottom bidirectional schematic connection handles */}
      <Handle
        id="left"
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-slate-400 dark:!bg-slate-500 !border-2 !border-white dark:!border-slate-900"
      />
      <Handle
        id="left-source"
        type="source"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-slate-400 dark:!bg-slate-500 !border-2 !border-white dark:!border-slate-900 !opacity-0"
      />
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-slate-400 dark:!bg-slate-500 !border-2 !border-white dark:!border-slate-900"
      />
      <Handle
        id="right-target"
        type="target"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-slate-400 dark:!bg-slate-500 !border-2 !border-white dark:!border-slate-900 !opacity-0"
      />
      <Handle
        id="top-target"
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-slate-300 dark:!bg-slate-600 !border !border-white dark:!border-slate-900"
      />
      <Handle
        id="bottom-source"
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-slate-300 dark:!bg-slate-600 !border !border-white dark:!border-slate-900"
      />
      <Handle
        id="top-source"
        type="source"
        position={Position.Top}
        className="!w-2 !h-2 !bg-slate-300 dark:!bg-slate-600 !border !border-white dark:!border-slate-900 !opacity-0"
      />
      <Handle
        id="bottom-target"
        type="target"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-slate-300 dark:!bg-slate-600 !border !border-white dark:!border-slate-900 !opacity-0"
      />

      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-2 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-1.5 min-w-0">
          {editMode && (
            <GripHorizontal
              aria-hidden="true"
              className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            />
          )}
          <span
            className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-md border ${ZONE_STYLES[displayZone]}`}
          >
            {displayZone}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {hasSnapshotSync && (
            <span
              title="Synced from Behringer WING .snap snapshot"
              className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-sky-50 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/80"
            >
              .snap
            </span>
          )}
          {phantomCount > 0 && (
            <span
              title={`${phantomCount} channel(s) with +48V phantom power`}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/80"
            >
              <Zap className="w-2.5 h-2.5" />
              48V
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${KIND_ACCENT[hardware.kind]}`}
          >
            <DeviceIcon kind={hardware.kind} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold leading-tight text-slate-900 dark:text-slate-100">
              {displayName}
            </div>
            <div className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5">
              {hardware.model}
            </div>
          </div>
        </div>

        {/* Port groups & bus metrics */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px]">
          {inputCount > 0 && (
            <span className="inline-flex items-center rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-slate-700 dark:text-slate-300">
              {inputCount} IN
            </span>
          )}
          {outputCount > 0 && (
            <span className="inline-flex items-center rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-slate-700 dark:text-slate-300">
              {outputCount} OUT
            </span>
          )}
          {busCount > 0 && (
            <span className="inline-flex items-center rounded bg-sky-50 dark:bg-sky-950/70 px-1.5 py-0.5 text-sky-800 dark:text-sky-300 border border-sky-200/70 dark:border-sky-800/70">
              {busCount} BUS
            </span>
          )}
          {hardware.portGroups.slice(0, 3).map((pg) => (
            <span
              key={pg.id}
              className="inline-flex items-center rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400"
            >
              {pg.code}
            </span>
          ))}
        </div>

        {notes && (
          <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-1.5">
            {notes}
          </p>
        )}
      </div>
    </div>
  );
});
