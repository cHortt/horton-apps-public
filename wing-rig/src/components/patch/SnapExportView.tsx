import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { RigDocument } from '../../schema/rig';
import type {
  ConsoleBaselineMeta,
  PathAuditIssue,
  StagedPatchEntry,
} from '../../schema/patch';
import { resolveNodeName } from '../../schema/helpers';
import { buildDefaultSnapExportName } from '../../parser/snapPatcher';

interface SnapExportViewProps {
  rig: RigDocument;
  baselines: Record<string, ConsoleBaselineMeta>;
  stagedPatches: StagedPatchEntry[];
  auditIssues: PathAuditIssue[];
  onRemoveStagedPatch: (patchId: string) => void;
  onDiscardStagedPatches: (consoleNodeId?: string) => void;
  onExportPatchedSnap: (
    consoleNodeId: string,
    customFileName?: string,
  ) => { ok: true; fileName: string } | { ok: false; error: string };
  onCommitConsoleBaseline: (consoleNodeId: string, newFileName?: string) => boolean;
  onOpenSnapImport: (targetConsoleId?: string) => void;
}

export function SnapExportView({
  rig,
  baselines,
  stagedPatches,
  auditIssues,
  onRemoveStagedPatch,
  onDiscardStagedPatches,
  onExportPatchedSnap,
  onCommitConsoleBaseline,
  onOpenSnapImport,
}: SnapExportViewProps) {
  const consoles = useMemo(() => rig.nodes.filter((n) => n.kind === 'console'), [rig.nodes]);

  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [confirmGuardrails, setConfirmGuardrails] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const errorCount = auditIssues.filter((i) => i.severity === 'error').length;
  const phantomChanges = stagedPatches.filter((p) => p.touchesPhantom48v);
  const requiresConfirmation = errorCount > 0 || phantomChanges.length > 0;
  const exportAllowed = !requiresConfirmation || confirmGuardrails;

  const getFileName = (consoleId: string): string => {
    if (fileNames[consoleId] !== undefined) return fileNames[consoleId];
    const meta = baselines[consoleId];
    return meta ? buildDefaultSnapExportName(meta.fileName) : 'WING-Edited.snap';
  };

  const modifiedConsoleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of stagedPatches) {
      if (baselines[p.consoleNodeId]) ids.add(p.consoleNodeId);
    }
    return [...ids];
  }, [stagedPatches, baselines]);

  const handleExportOne = (consoleId: string) => {
    if (!exportAllowed) return;
    const res = onExportPatchedSnap(consoleId, getFileName(consoleId));
    if (res.ok) {
      setStatusMessage(
        `Downloaded ${res.fileName} (lossless patch: untouched EQ, dynamics, FX, DCA & ce_data preserved 100%).`,
      );
    } else {
      setStatusMessage(`Export failed: ${res.error}`);
    }
  };

  const handleExportAllModified = () => {
    if (!exportAllowed || modifiedConsoleIds.length === 0) return;
    const exported: string[] = [];
    for (const cid of modifiedConsoleIds) {
      const res = onExportPatchedSnap(cid, getFileName(cid));
      if (res.ok) exported.push(res.fileName);
    }
    if (exported.length > 0) {
      setStatusMessage(`Exported ${exported.length} patched snapshot(s): ${exported.join(', ')}`);
    }
  };

  const handleCommitOne = (consoleId: string) => {
    const committed = onCommitConsoleBaseline(consoleId, getFileName(consoleId));
    if (committed) {
      setStatusMessage(
        `Committed staged edits as the new baseline for ${consoleId} and preserved all Layer 2 annotations.`,
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* Lossless Guarantee Banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/30 px-4 py-3 text-xs text-emerald-900 dark:text-emerald-200">
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div>
          <strong>Lossless Patch-Overlay Export:</strong> Only the staged{' '}
          <code className="font-mono">ae_data.*</code> routing/source/bus fields are patched onto each
          console&apos;s raw IndexedDB baseline. All EQ, compressors, FX racks, DCAs, mute groups, and{' '}
          <code className="font-mono">ce_data</code> fader layers remain untouched.
        </div>
      </div>

      {/* Guardrail confirmation bar if +48V changed or Verifier Errors exist */}
      {requiresConfirmation && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            Pre-Export Safety Check Required
          </div>
          <ul className="list-disc pl-5 text-xs text-amber-900/90 dark:text-amber-200/90 space-y-0.5">
            {phantomChanges.length > 0 && (
              <li>
                <strong className="inline-flex items-center gap-1">
                  <Zap className="w-3 h-3" /> {phantomChanges.length} +48V phantom power edit(s)
                </strong>{' '}
                staged — verify connected mics/DIs before loading onto hardware.
              </li>
            )}
            {errorCount > 0 && (
              <li>
                <strong>{errorCount} unresolved Path Verifier error(s)</strong> remain (review Tab 3
                to inspect or auto-fix).
              </li>
            )}
          </ul>
          <label className="inline-flex items-center gap-2 pt-1 text-xs font-semibold text-amber-950 dark:text-amber-100 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmGuardrails}
              onChange={(e) => setConfirmGuardrails(e.target.checked)}
              className="h-4 w-4 accent-amber-600"
            />
            I have reviewed these +48V / path checks and want to export patched .snap files.
          </label>
        </div>
      )}

      {/* Per-Console Diff & Export Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {consoles.map((consoleNode) => {
          const meta = baselines[consoleNode.id];
          const consolePatches = stagedPatches.filter((p) => p.consoleNodeId === consoleNode.id);
          return (
            <div
              key={consoleNode.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div className="min-w-0">
                    <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {consoleNode.zone} · {consoleNode.model}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                      {resolveNodeName(rig, consoleNode)}
                    </h3>
                    {meta ? (
                      <div className="mt-0.5 font-mono text-[10.5px] text-emerald-700 dark:text-emerald-400">
                        Baseline: {meta.fileName} ({Math.round(meta.byteLength / 1024)} KB ·{' '}
                        {meta.snapshotType})
                      </div>
                    ) : (
                      <div className="mt-0.5 font-mono text-[10.5px] text-amber-700 dark:text-amber-400">
                        No raw .snap baseline loaded in IndexedDB yet
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {consolePatches.length} staged
                  </span>
                </div>

                {!meta ? (
                  <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center space-y-2">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Upload this console&apos;s `.snap` file to enable lossless editing &amp; export.
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenSnapImport(consoleNode.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 dark:bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white dark:text-slate-950 hover:bg-sky-700 dark:hover:bg-sky-400 cursor-pointer"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      Import Baseline .snap
                    </button>
                  </div>
                ) : consolePatches.length === 0 ? (
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 px-3 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                    No pending edits staged for this console. Baseline matches exported state.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                    {consolePatches.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-2.5 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {entry.summary}
                          </div>
                          <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {entry.jsonPaths.join(', ')}
                          </div>
                        </div>
                        <button
                          type="button"
                          title="Remove this staged patch"
                          onClick={() => onRemoveStagedPatch(entry.id)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {meta && (
                <div className="space-y-2.5 border-t border-slate-200 dark:border-slate-800 pt-3">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">
                      Export Filename
                    </label>
                    <input
                      type="text"
                      value={getFileName(consoleNode.id)}
                      onChange={(e) =>
                        setFileNames((prev) => ({ ...prev, [consoleNode.id]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!exportAllowed}
                      onClick={() => handleExportOne(consoleNode.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 dark:bg-sky-500 px-3 py-2 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-sky-400 disabled:opacity-40 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download .snap
                    </button>
                    {consolePatches.length > 0 && (
                      <>
                        <button
                          type="button"
                          title="Make these patched changes the new committed baseline in IndexedDB"
                          onClick={() => handleCommitOne(consoleNode.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-950 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Commit Baseline
                        </button>
                        <button
                          type="button"
                          title="Discard staged patches for this console"
                          onClick={() => onDiscardStagedPatches(consoleNode.id)}
                          className="rounded-lg border border-slate-300 dark:border-slate-700 p-2 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Batch Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs">
          <div className="font-bold text-slate-900 dark:text-slate-100">
            Batch Export Modified Consoles ({modifiedConsoleIds.length})
          </div>
          <div className="text-slate-500 dark:text-slate-400 mt-0.5">
            {statusMessage ??
              'Downloads each modified console as a clean, USB-loadable Behringer WING .snap file.'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {stagedPatches.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onDiscardStagedPatches();
                setStatusMessage('All staged patches discarded — restored to committed baselines.');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Discard All ({stagedPatches.length})
            </button>
          )}
          <button
            type="button"
            disabled={!exportAllowed || modifiedConsoleIds.length === 0}
            onClick={handleExportAllModified}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 dark:bg-sky-500 px-4 py-2 text-xs font-semibold text-white dark:text-slate-950 hover:bg-sky-700 dark:hover:bg-sky-400 disabled:opacity-40 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export All Modified .snap ({modifiedConsoleIds.length})
          </button>
        </div>
      </div>
    </div>
  );
}
