import { ArrowRight, GitBranch, X } from 'lucide-react';
import type { TraceResult } from '../../schema/rig';

interface TraceBannerProps {
  trace: TraceResult;
  onClear: () => void;
  onSelectNode: (nodeId: string) => void;
  onSelectTrunk: (trunkId: string) => void;
}

const STEP_STYLE: Record<TraceResult['steps'][number]['kind'], string> = {
  source: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  trunk: 'bg-sky-50 border-sky-200 text-sky-900',
  console: 'bg-slate-100 border-slate-300 text-slate-900',
  bus: 'bg-indigo-50 border-indigo-200 text-indigo-900',
  passthrough: 'bg-amber-50 border-amber-300 text-amber-900',
  destination: 'bg-cyan-50 border-cyan-200 text-cyan-900',
};

export function TraceBanner({
  trace,
  onClear,
  onSelectNode,
  onSelectTrunk,
}: TraceBannerProps) {
  return (
    <div className="pointer-events-auto absolute top-3 left-3 right-3 z-20 rounded-xl border border-sky-300 bg-white/95 backdrop-blur-sm shadow-md px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sky-600 text-white">
            <GitBranch className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                Signal Trace
              </span>
              <span className="truncate text-sm font-semibold text-slate-900">{trace.title}</span>
              <span className="hidden sm:inline text-xs font-mono text-slate-500">
                ({trace.subtitle})
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClear}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
        >
          <span>Clear</span>
          <kbd className="rounded bg-white px-1 py-0.5 font-mono text-[10px] text-slate-500 border border-slate-200">
            Esc
          </kbd>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {trace.steps.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {trace.steps.map((step, idx) => (
            <div key={`${step.order}-${step.detail}`} className="flex items-center gap-1.5 shrink-0">
              {idx > 0 && <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
              <button
                type="button"
                onClick={() => {
                  if (step.trunkId) onSelectTrunk(step.trunkId);
                  else onSelectNode(step.nodeId);
                }}
                className={`rounded-md border px-2 py-1 text-left transition-colors hover:brightness-95 cursor-pointer ${STEP_STYLE[step.kind]}`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wide opacity-75">
                  {step.nodeLabel}
                </div>
                <div className="text-[11px] font-mono leading-tight">{step.detail}</div>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
