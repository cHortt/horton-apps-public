import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Download,
  FileUp,
  Lock,
  ShieldCheck,
  Sliders,
  Table2,
  Undo2,
  Unlock,
  Wrench,
} from 'lucide-react';
import type { PortGroupCode, RigDocument, TraceTarget } from '../../schema/rig';
import type {
  ConsoleBaselineMeta,
  ConsoleLinkConfig,
  PathAuditIssue,
  StagedPatchEntry,
} from '../../schema/patch';
import { resolveNodeName } from '../../schema/helpers';
import { SourceReturnWizard } from './SourceReturnWizard';
import { PatchMatrixView } from './PatchMatrixView';
import { PathAuditView } from './PathAuditView';
import { SnapExportView } from './SnapExportView';

type PatchTab = 'wizard' | 'matrix' | 'audit' | 'export';

interface PatchStudioProps {
  rig: RigDocument;
  baselines: Record<string, ConsoleBaselineMeta>;
  stagedPatches: StagedPatchEntry[];
  linkConfig: ConsoleLinkConfig;
  auditIssues: PathAuditIssue[];
  patchUnlocked: boolean;
  onTogglePatchUnlocked: () => void;
  onUpdateLinkConfig: (patch: Partial<ConsoleLinkConfig>) => void;
  onStagePatches: (entries: StagedPatchEntry[]) => void;
  onRemoveStagedPatch: (patchId: string) => void;
  onUndoLastStagedPatch: () => void;
  onDiscardStagedPatches: (consoleNodeId?: string) => void;
  onExportPatchedSnap: (
    consoleNodeId: string,
    customFileName?: string,
  ) => { ok: true; fileName: string } | { ok: false; error: string };
  onCommitConsoleBaseline: (consoleNodeId: string, newFileName?: string) => boolean;
  onOpenSnapImport: (targetConsoleId?: string) => void;
  onTraceOnSchematic: (target: TraceTarget) => void;
}

const SPLIT_PORTS: PortGroupCode[] = ['A', 'B', 'C', 'SC', 'CRD', 'MOD', 'USB'];

export function PatchStudio({
  rig,
  baselines,
  stagedPatches,
  linkConfig,
  auditIssues,
  patchUnlocked,
  onTogglePatchUnlocked,
  onUpdateLinkConfig,
  onStagePatches,
  onRemoveStagedPatch,
  onUndoLastStagedPatch,
  onDiscardStagedPatches,
  onExportPatchedSnap,
  onCommitConsoleBaseline,
  onOpenSnapImport,
  onTraceOnSchematic,
}: PatchStudioProps) {
  const [activeTab, setActiveTab] = useState<PatchTab>('wizard');

  const consoles = useMemo(() => rig.nodes.filter((n) => n.kind === 'console'), [rig.nodes]);
  const issueAlertCount = auditIssues.filter((i) => i.severity !== 'info').length;

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Studio Header & Staging Lock Bar */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950">
                <Wrench className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    WING Patch Studio
                  </h2>
                  <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600 dark:text-slate-300">
                    Lossless Dual-.snap Editor
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Configure sources, splits, returns &amp; mix buses across one or both consoles, verify paths live on the Schematic, and export patched .snap files.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onTogglePatchUnlocked}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  patchUnlocked
                    ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-600/60 dark:bg-amber-950/70 dark:text-amber-200'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {patchUnlocked ? (
                  <Unlock className="w-3.5 h-3.5" />
                ) : (
                  <Lock className="w-3.5 h-3.5" />
                )}
                <span>{patchUnlocked ? 'Patch Staging Unlocked' : 'Read-Only Inspector'}</span>
              </button>

              {stagedPatches.length > 0 && (
                <button
                  type="button"
                  onClick={onUndoLastStagedPatch}
                  title="Undo last staged patch"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  Undo
                </button>
              )}

              <button
                type="button"
                onClick={() => setActiveTab('export')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 dark:bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white dark:text-slate-950 hover:bg-sky-700 dark:hover:bg-sky-400 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Staged ({stagedPatches.length}) → Export</span>
              </button>
            </div>
          </div>

          {/* Console Baselines & Editable Link Config Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-100 dark:border-slate-800 pt-3 text-xs">
            {/* Baseline status pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {consoles.map((c) => {
                const meta = baselines[c.id];
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenSnapImport(c.id)}
                    title={
                      meta
                        ? `Baseline loaded: ${meta.fileName} — click to replace`
                        : `Click to import .snap baseline for ${resolveNodeName(rig, c)}`
                    }
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium cursor-pointer ${
                      meta
                        ? 'border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                        : 'border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 hover:border-sky-400'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        meta ? 'bg-emerald-500' : 'bg-slate-400'
                      }`}
                    />
                    <span className="font-semibold">{resolveNodeName(rig, c)}:</span>
                    <span className="font-mono text-[10.5px]">
                      {meta ? meta.fileName : 'Load .snap'}
                    </span>
                    {!meta && <FileUp className="w-3 h-3" />}
                  </button>
                );
              })}
            </div>

            {/* Editable Inter-Console Link & Headamp Authority */}
            {consoles.length >= 2 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-2.5 py-1 text-[11px]">
                <ArrowLeftRight className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Link:</span>
                <select
                  aria-label="Stage split port"
                  value={linkConfig.stageSplitPort}
                  onChange={(e) =>
                    onUpdateLinkConfig({ stageSplitPort: e.target.value as PortGroupCode })
                  }
                  className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-slate-900 dark:text-slate-100"
                >
                  {SPLIT_PORTS.map((p) => (
                    <option key={p} value={p}>
                      Stage Out {p}
                    </option>
                  ))}
                </select>
                <span className="text-slate-400">↔</span>
                <select
                  aria-label="FOH receive port"
                  value={linkConfig.fohReceivePort}
                  onChange={(e) =>
                    onUpdateLinkConfig({ fohReceivePort: e.target.value as PortGroupCode })
                  }
                  className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-slate-900 dark:text-slate-100"
                >
                  {SPLIT_PORTS.map((p) => (
                    <option key={p} value={p}>
                      FOH In {p}
                    </option>
                  ))}
                </select>
                <span className="h-3.5 w-px bg-slate-300 dark:bg-slate-700" />
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Headamps:</span>
                <select
                  aria-label="Headamp owner console"
                  value={linkConfig.headampOwnerConsoleId}
                  onChange={(e) =>
                    onUpdateLinkConfig({ headampOwnerConsoleId: e.target.value })
                  }
                  className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[11px] font-medium text-slate-900 dark:text-slate-100"
                >
                  {consoles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {resolveNodeName(rig, c)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* 4 Workflow Tabs */}
        <nav className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('wizard')}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'wizard'
                ? 'border-slate-900 bg-slate-900 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-slate-950'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            1. Configure Source &amp; Returns
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('matrix')}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'matrix'
                ? 'border-slate-900 bg-slate-900 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-slate-950'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Table2 className="w-3.5 h-3.5" />
            2. Patch Matrix &amp; Mix Buses
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'audit'
                ? 'border-slate-900 bg-slate-900 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-slate-950'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            3. Path Verifier
            {issueAlertCount > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 py-0 font-mono text-[10px] font-bold text-slate-950">
                {issueAlertCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'export'
                ? 'border-slate-900 bg-slate-900 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-slate-950'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            4. Lossless .snap Diff &amp; Export
            {stagedPatches.length > 0 && (
              <span className="rounded-full bg-sky-600 dark:bg-slate-900 px-1.5 py-0 font-mono text-[10px] font-bold text-white dark:text-sky-400">
                {stagedPatches.length}
              </span>
            )}
          </button>
        </nav>

        {/* Active Panel */}
        {activeTab === 'wizard' && (
          <SourceReturnWizard
            rig={rig}
            linkConfig={linkConfig}
            baselines={baselines}
            patchUnlocked={patchUnlocked}
            onUnlockPatching={onTogglePatchUnlocked}
            onStagePatches={onStagePatches}
            onOpenSnapImport={onOpenSnapImport}
            onJumpToMatrix={() => setActiveTab('matrix')}
          />
        )}

        {activeTab === 'matrix' && (
          <PatchMatrixView
            rig={rig}
            linkConfig={linkConfig}
            baselines={baselines}
            auditIssues={auditIssues}
            patchUnlocked={patchUnlocked}
            onStagePatches={onStagePatches}
            onTraceOnSchematic={onTraceOnSchematic}
          />
        )}

        {activeTab === 'audit' && (
          <PathAuditView
            issues={auditIssues}
            patchUnlocked={patchUnlocked}
            onUnlockPatching={onTogglePatchUnlocked}
            onStagePatches={onStagePatches}
            onTraceOnSchematic={onTraceOnSchematic}
          />
        )}

        {activeTab === 'export' && (
          <SnapExportView
            rig={rig}
            baselines={baselines}
            stagedPatches={stagedPatches}
            auditIssues={auditIssues}
            onRemoveStagedPatch={onRemoveStagedPatch}
            onDiscardStagedPatches={onDiscardStagedPatches}
            onExportPatchedSnap={onExportPatchedSnap}
            onCommitConsoleBaseline={onCommitConsoleBaseline}
            onOpenSnapImport={onOpenSnapImport}
          />
        )}
      </div>
    </div>
  );
}
