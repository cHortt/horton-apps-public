import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  ShieldAlert,
  Wrench,
  Zap,
} from 'lucide-react';
import type { TraceTarget } from '../../schema/rig';
import type { PathAuditIssue, StagedPatchEntry } from '../../schema/patch';
import { createStagedEntry } from '../../parser/snapPatcher';

interface PathAuditViewProps {
  issues: PathAuditIssue[];
  patchUnlocked: boolean;
  onUnlockPatching: () => void;
  onStagePatches: (entries: StagedPatchEntry[]) => void;
  onTraceOnSchematic: (target: TraceTarget) => void;
}

export function PathAuditView({
  issues,
  patchUnlocked,
  onUnlockPatching,
  onStagePatches,
  onTraceOnSchematic,
}: PathAuditViewProps) {
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;
  const fixableIssues = issues.filter((i) => i.suggestedFixes && i.suggestedFixes.length > 0);

  const stageIssueFixes = (issue: PathAuditIssue) => {
    if (!patchUnlocked || !issue.suggestedFixes?.length) return;
    onStagePatches(
      issue.suggestedFixes.map((f) => createStagedEntry(f.consoleNodeId, f.summary, f.op)),
    );
  };

  const stageAllSafeFixes = () => {
    if (!patchUnlocked || fixableIssues.length === 0) return;
    const entries: StagedPatchEntry[] = [];
    for (const issue of fixableIssues) {
      for (const f of issue.suggestedFixes ?? []) {
        entries.push(createStagedEntry(f.consoleNodeId, f.summary, f.op));
      }
    }
    onStagePatches(entries);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Cross-Console Signal Integrity Verifier
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Validates dead-end AES50 splits, stereo/mono pairing, label drift, unrouted active buses, and +48V changes across your live staged rig.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[1px] border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 px-2 py-1 font-mono text-xs font-semibold text-rose-700 dark:text-rose-300">
            {errorCount} Errors
          </span>
          <span className="rounded-[1px] border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-2 py-1 font-mono text-xs font-semibold text-amber-800 dark:text-amber-300">
            {warningCount} Warnings
          </span>
          <span className="rounded-[1px] border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 px-2 py-1 font-mono text-xs font-semibold text-sky-700 dark:text-sky-300">
            {infoCount} +48V Alerts
          </span>

          {fixableIssues.length > 0 && (
            <button
              type="button"
              onClick={patchUnlocked ? stageAllSafeFixes : onUnlockPatching}
              className="inline-flex items-center gap-1.5 rounded-[2px] bg-sky-600 dark:bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white dark:text-slate-950 hover:bg-sky-700 dark:hover:bg-sky-400 cursor-pointer"
            >
              <Wrench className="w-3.5 h-3.5" />
              {patchUnlocked
                ? `Stage All Suggested Fixes (${fixableIssues.length})`
                : 'Unlock Staging to Auto-Fix'}
            </button>
          )}
        </div>
      </div>

      {issues.length === 0 ? (
        <div className="rounded-[2px] border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/30 p-8 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-600 dark:text-emerald-400" />
          <div className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
            All Signal Paths Verified Clean
          </div>
          <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80 max-w-md mx-auto">
            Zero dead-end splits, stereo mismatches, label drifts, or unrouted active mix buses found across your rig.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {issues.map((issue) => {
            const borderCls =
              issue.severity === 'error'
                ? 'border-rose-300 dark:border-rose-800/80 bg-rose-50/40 dark:bg-rose-950/25'
                : issue.severity === 'warning'
                  ? 'border-amber-300 dark:border-amber-800/80 bg-amber-50/40 dark:bg-amber-950/25'
                  : 'border-sky-200 dark:border-sky-800/80 bg-sky-50/40 dark:bg-sky-950/25';

            return (
              <div
                key={issue.id}
                className={`rounded-[2px] border p-4 flex flex-wrap items-start justify-between gap-3 ${borderCls}`}
              >
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  {issue.severity === 'error' ? (
                    <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" />
                  ) : issue.severity === 'warning' ? (
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <Zap className="w-4 h-4 mt-0.5 shrink-0 text-sky-600 dark:text-sky-400" />
                  )}
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-[1px] ${
                          issue.severity === 'error'
                            ? 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200'
                            : issue.severity === 'warning'
                              ? 'bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200'
                              : 'bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-200'
                        }`}
                      >
                        {issue.code.replace(/_/g, ' ')}
                      </span>
                      <h3 className="font-display text-xs font-bold text-slate-900 dark:text-slate-100">
                        {issue.title}
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {issue.detail}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {issue.traceTarget && (
                    <button
                      type="button"
                      onClick={() => onTraceOnSchematic(issue.traceTarget!)}
                      className="inline-flex items-center gap-1 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] px-2.5 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-400 hover:border-sky-400 cursor-pointer"
                    >
                      <GitBranch className="w-3.5 h-3.5" />
                      Trace
                    </button>
                  )}
                  {issue.suggestedFixes && issue.suggestedFixes.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        patchUnlocked ? stageIssueFixes(issue) : onUnlockPatching()
                      }
                      className="inline-flex items-center gap-1 rounded-[2px] bg-slate-900 dark:bg-sky-500 px-2.5 py-1.5 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-sky-400 cursor-pointer"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      {patchUnlocked ? 'Stage Fix' : 'Unlock to Fix'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
