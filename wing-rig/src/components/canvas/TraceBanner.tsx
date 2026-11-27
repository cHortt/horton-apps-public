import { ArrowRight, GitBranch, X } from 'lucide-react';
import type { TraceResult } from '../../schema/rig';

interface TraceBannerProps {
  trace: TraceResult;
  onClear: () => void;
  onSelectNode: (nodeId: string) => void;
  onSelectTrunk: (trunkId: string) => void;
}

const STEP_STYLE: Record<TraceResult['steps'][number]['kind'], string> = {
  source: 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/70 dark:border-emerald-800 dark:text-emerald-200',
  trunk: 'bg-sky-50 border-sky-200 text-sky-900 dark:bg-sky-950/70 dark:border-sky-800 dark:text-sky-200',
  console: 'bg-slate-100 border-slate-300 text-slate-900 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100',
  bus: 'bg-indigo-50 border-indigo-200 text-indigo-900 dark:bg-indigo-950/70 dark:border-indigo-800 dark:text-indigo-200',
  passthrough: 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/70 dark:border-amber-700 dark:text-amber-200',
  destination: 'bg-cyan-50 border-cyan-200 text-cyan-900 dark:bg-cyan-950/70 dark:border-cyan-800 dark:text-cyan-200',
};

export function TraceBanner({
  trace,
  onClear,
  onSelectNode,
  onSelectTrunk,
}: TraceBannerProps) {
  return (
    <div className="pointer-events-auto absolute top-2 left-2 right-2 lg:top-3 lg:left-3 lg:right-3 z-20 rounded-[2px] border border-sky-600 dark:border-sky-500/80 bg-white/95 dark:bg-[#111827]/95 backdrop-blur-sm shadow-sm px-2.5 py-1.5 lg:px-3.5 lg:py-2.5">
      <div className="flex items-center justify-between gap-2 lg:gap-3">
        <div className="flex items-center gap-1.5 lg:gap-2 min-w-0">
          <span className="inline-flex h-5 w-5 lg:h-6 lg:w-6 shrink-0 items-center justify-center rounded-[1px] bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950">
            <GitBranch className="w-3 h-3 lg:w-3.5 lg:h-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 lg:gap-2">
              <span className="hidden sm:inline font-mono text-[10.5px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
                Signal Trace
              </span>
              <span className="font-display truncate text-xs lg:text-sm font-bold text-slate-900 dark:text-slate-100">
                {trace.title}
              </span>
              <span className="hidden sm:inline text-xs font-mono text-slate-500 dark:text-slate-400">
                ({trace.subtitle})
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClear}
          className="inline-flex shrink-0 items-center gap-1 lg:gap-1.5 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 lg:px-2.5 lg:py-1 text-[11px] lg:text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
        >
          <span>Clear</span>
          <kbd className="hidden sm:inline rounded-[1px] bg-white dark:bg-slate-900 px-1 py-0.5 font-mono text-[10px] text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
            Esc
          </kbd>
          <X className="w-3 h-3 lg:w-3.5 lg:h-3.5" />
        </button>
      </div>

      {trace.steps.length > 0 && (
        <div className="mt-1.5 lg:mt-2 flex items-center gap-1 lg:gap-1.5 overflow-x-auto pb-0.5">
          {trace.steps.map((step, idx) => (
            <div key={`${step.order}-${step.detail}`} className="flex items-center gap-1 lg:gap-1.5 shrink-0">
              {idx > 0 && <ArrowRight className="w-3 h-3 lg:w-3.5 lg:h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />}
              <button
                type="button"
                onClick={() => {
                  if (step.trunkId) onSelectTrunk(step.trunkId);
                  else onSelectNode(step.nodeId);
                }}
                className={`rounded-[1px] border px-1.5 py-0.5 lg:px-2 lg:py-1 text-left transition-colors hover:brightness-95 dark:hover:brightness-110 cursor-pointer ${STEP_STYLE[step.kind]}`}
              >
                <div className="font-display text-[9.5px] lg:text-[10px] font-bold uppercase tracking-wider opacity-80 leading-tight">
                  {step.nodeLabel}
                </div>
                <div className="text-[10.5px] lg:text-[11px] font-mono leading-tight">{step.detail}</div>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
