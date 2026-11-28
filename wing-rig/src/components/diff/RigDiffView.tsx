import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  CheckSquare,
  ClipboardCheck,
  FileUp,
  GitBranch,
  GitCompare,
  Printer,
  RotateCcw,
  ShieldAlert,
  Square,
  Wrench,
  Zap,
} from 'lucide-react';
import type { RigDocument, TraceTarget } from '../../schema/rig';
import type { ConsoleBaselineMeta } from '../../schema/patch';
import { buildDefaultSnapExportName } from '../../parser/snapPatcher';
import { parseWingSnap } from '../../parser/wingSnapParser';
import { applySnapMerge } from '../../parser/merge';
import {
  computeRigDiff,
  type DeltaChecklistItem,
  type DiffCategory,
} from '../../parser/rigDiff';
import { parseRigOrBundleJson } from '../../store/rigBundle';
import {
  readDeltaChecksMap,
  writeDeltaChecksMap,
  type RigLibraryEntry,
} from '../../store/rigLibraryDb';

interface RigDiffViewProps {
  activeRig: RigDocument;
  baselineRig: RigDocument;
  baselineMetas: Record<string, ConsoleBaselineMeta>;
  libraryEntries: RigLibraryEntry[];
  activeProfileId: string;
  initialCompareProfileId?: string | null;
  onClearInitialCompare?: () => void;
  onMarkCurrentAsBaseline: () => void;
  onTraceOnSchematic: (target: TraceTarget) => void;
}

type CompareMode = 'baseline' | 'library' | 'file';
type DiffSubTab = 'checklist' | 'details';

const CATEGORY_LABELS: Record<DiffCategory | 'all', string> = {
  all: 'All Changes',
  physical: 'Physical I/O',
  phantom: '+48V & Preamp',
  splits: 'Splits & Trunks',
  strips: 'Console Strips',
  buses: 'Mix Buses',
  hardware: 'Hardware & Cables',
};

const ACTION_BADGE_META: Record<
  DeltaChecklistItem['actionType'],
  { label: string; cls: string }
> = {
  unplug: {
    label: 'UNPLUG',
    cls: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/70 dark:text-rose-200',
  },
  move: {
    label: 'MOVE CABLE',
    cls: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/70 dark:text-amber-200',
  },
  plug: {
    label: 'PLUG IN',
    cls: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-200',
  },
  relabel: {
    label: 'RE-PATCH',
    cls: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/70 dark:text-sky-200',
  },
  hardware: {
    label: 'HARDWARE',
    cls: 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-200',
  },
  'phantom-on': {
    label: '+48V ON',
    cls: 'border-rose-400 bg-rose-100 text-rose-900 dark:border-rose-600 dark:bg-rose-950 dark:text-rose-200',
  },
  'phantom-off': {
    label: '+48V OFF',
    cls: 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200',
  },
  preamp: {
    label: 'PREAMP',
    cls: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  },
  'console-load': {
    label: 'LOAD .SNAP',
    cls: 'border-sky-400 bg-sky-100 text-sky-900 dark:border-sky-600 dark:bg-sky-950 dark:text-sky-200',
  },
  verify: {
    label: 'VERIFY',
    cls: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  },
};

export function RigDiffView({
  activeRig,
  baselineRig,
  baselineMetas,
  libraryEntries,
  activeProfileId,
  initialCompareProfileId,
  onClearInitialCompare,
  onMarkCurrentAsBaseline,
  onTraceOnSchematic,
}: RigDiffViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const otherProfile = libraryEntries.find((e) => e.id !== activeProfileId);
  const [compareMode, setCompareMode] = useState<CompareMode>(() =>
    initialCompareProfileId ? 'library' : 'baseline',
  );
  const [beforeProfileId, setBeforeProfileId] = useState<string>(
    () => initialCompareProfileId ?? otherProfile?.id ?? activeProfileId,
  );
  const [afterProfileId, setAfterProfileId] = useState<string>(() => activeProfileId);
  const [uploadedRig, setUploadedRig] = useState<{ label: string; rig: RigDocument } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [swapFileDirection, setSwapFileDirection] = useState(false);

  const [subTab, setSubTab] = useState<DiffSubTab>('checklist');
  const [categoryFilter, setCategoryFilter] = useState<DiffCategory | 'all'>('all');
  const [checksMap, setChecksMap] = useState<Record<string, string[]>>(() => readDeltaChecksMap());
  const [baselineSavedToast, setBaselineSavedToast] = useState(false);

  useEffect(() => {
    if (initialCompareProfileId) {
      setCompareMode('library');
      setBeforeProfileId(initialCompareProfileId);
      setAfterProfileId(activeProfileId);
      onClearInitialCompare?.();
    }
  }, [initialCompareProfileId, activeProfileId, onClearInitialCompare]);

  const handleUploadCompareFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    const text = await file.text();

    // Try bundle or .rig.json first
    const asRigOrBundle = parseRigOrBundleJson(text);
    if (asRigOrBundle.ok) {
      const targetRig = asRigOrBundle.kind === 'bundle' ? asRigOrBundle.entry.rig : asRigOrBundle.rig;
      setUploadedRig({ label: `${file.name} (${targetRig.name})`, rig: targetRig });
      setCompareMode('file');
      return;
    }

    // Try parsing as a Behringer WING .snap merged onto the active rig
    try {
      const parsedSnap = parseWingSnap(text, { fileName: file.name });
      const merged = applySnapMerge(activeRig, parsedSnap);
      setUploadedRig({
        label: `${file.name} (${parsedSnap.metadata.creatorName || 'WING .snap'})`,
        rig: merged.rig,
      });
      setCompareMode('file');
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : 'File is not a valid .snap, .rig.json, or .wingrig.json file.',
      );
    }
  };

  const { beforeDoc, afterDoc, beforeLabel, afterLabel, comparisonKey } = useMemo(() => {
    if (compareMode === 'library') {
      const bEntry = libraryEntries.find((e) => e.id === beforeProfileId);
      const aEntry = libraryEntries.find((e) => e.id === afterProfileId);
      const bRig = bEntry ? (bEntry.id === activeProfileId ? activeRig : bEntry.rig) : baselineRig;
      const aRig = aEntry ? (aEntry.id === activeProfileId ? activeRig : aEntry.rig) : activeRig;
      return {
        beforeDoc: bRig,
        afterDoc: aRig,
        beforeLabel: bEntry?.name ?? bRig.name,
        afterLabel: aEntry?.name ?? aRig.name,
        comparisonKey: `lib:${beforeProfileId}->${afterProfileId}`,
      };
    }

    if (compareMode === 'file' && uploadedRig) {
      if (swapFileDirection) {
        return {
          beforeDoc: activeRig,
          afterDoc: uploadedRig.rig,
          beforeLabel: `${activeRig.name} (Current)`,
          afterLabel: uploadedRig.label,
          comparisonKey: `file:${activeProfileId}->${uploadedRig.label}`,
        };
      }
      return {
        beforeDoc: uploadedRig.rig,
        afterDoc: activeRig,
        beforeLabel: uploadedRig.label,
        afterLabel: `${activeRig.name} (Current)`,
        comparisonKey: `file:${uploadedRig.label}->${activeProfileId}`,
      };
    }

    return {
      beforeDoc: baselineRig,
      afterDoc: activeRig,
      beforeLabel: `${baselineRig.name} (Baseline)`,
      afterLabel: `${activeRig.name} (Current)`,
      comparisonKey: `baseline:${activeProfileId}`,
    };
  }, [
    compareMode,
    libraryEntries,
    beforeProfileId,
    afterProfileId,
    activeProfileId,
    activeRig,
    baselineRig,
    uploadedRig,
    swapFileDirection,
  ]);

  const diff = useMemo(() => {
    const exportNames: Record<string, string> = {};
    for (const [cid, meta] of Object.entries(baselineMetas)) {
      exportNames[cid] = buildDefaultSnapExportName(meta.fileName);
    }
    return computeRigDiff(beforeDoc, afterDoc, {
      beforeLabel,
      afterLabel,
      consoleExportFileNames: exportNames,
    });
  }, [beforeDoc, afterDoc, beforeLabel, afterLabel, baselineMetas]);

  const checkedSet = useMemo(
    () => new Set(checksMap[comparisonKey] ?? []),
    [checksMap, comparisonKey],
  );

  const toggleCheck = (itemId: string) => {
    setChecksMap((prev) => {
      const cur = new Set(prev[comparisonKey] ?? []);
      if (cur.has(itemId)) {
        cur.delete(itemId);
      } else {
        cur.add(itemId);
      }
      const next = { ...prev, [comparisonKey]: [...cur] };
      writeDeltaChecksMap(next);
      return next;
    });
  };

  const resetChecks = () => {
    setChecksMap((prev) => {
      const next = { ...prev };
      delete next[comparisonKey];
      writeDeltaChecksMap(next);
      return next;
    });
  };

  const totalChecklistItems = diff.checklist.reduce((sum, sec) => sum + sec.items.length, 0);
  const completedChecklistItems = diff.checklist.reduce(
    (sum, sec) => sum + sec.items.filter((item) => checkedSet.has(item.id)).length,
    0,
  );

  const filteredItems = useMemo(() => {
    if (categoryFilter === 'all') return diff.items;
    return diff.items.filter((i) => i.category === categoryFilter);
  }, [diff.items, categoryFilter]);

  const printedDate = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="min-h-full bg-[#f3f5f8] dark:bg-[#090d14] print:bg-white p-4 sm:p-6 print:p-0">
      <input
        ref={fileInputRef}
        type="file"
        accept=".snap,.json,.rig.json,.wingrig.json"
        onChange={handleUploadCompareFile}
        className="hidden"
      />

      <div className="mx-auto max-w-6xl space-y-4 print:max-w-none print:space-y-3">
        {/* Top Controls Card (hidden on print) */}
        <div className="no-print rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 space-y-3 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                style={{ clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' }}
                className="flex h-9 w-9 shrink-0 items-center justify-center bg-slate-900 dark:bg-sky-500 text-sky-400 dark:text-slate-950"
              >
                <GitCompare className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Diff Viewer &amp; In-Person Physical Delta Checklist
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Compare baseline vs. edited rig or any two library profiles, then check off or print physical cable &amp; +48V changes.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {compareMode === 'baseline' && diff.totalChanges > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onMarkCurrentAsBaseline();
                    resetChecks();
                    setBaselineSavedToast(true);
                    window.setTimeout(() => setBaselineSavedToast(false), 3000);
                  }}
                  title="Update this profile's clean baseline to match your current rig after implementing changes in-person"
                  className="inline-flex items-center gap-1.5 rounded-[2px] border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-950 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Mark Implemented (Update Baseline)
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setSubTab('checklist');
                  window.setTimeout(() => window.print(), 60);
                }}
                className="inline-flex items-center gap-1.5 rounded-[2px] bg-slate-900 dark:bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-sky-400 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Delta Checklist
              </button>
            </div>
          </div>

          {/* Mode Selector Row */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-100 dark:border-slate-800 pt-3">
            <div className="inline-flex rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 p-0.5">
              <button
                type="button"
                onClick={() => setCompareMode('baseline')}
                className={`rounded-[1px] px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                  compareMode === 'baseline'
                    ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Current Edits vs. Baseline
              </button>
              <button
                type="button"
                onClick={() => setCompareMode('library')}
                className={`rounded-[1px] px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                  compareMode === 'library'
                    ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Compare Library Profiles ({libraryEntries.length})
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`inline-flex items-center gap-1 rounded-[1px] px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                  compareMode === 'file'
                    ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <FileUp className="w-3 h-3" />
                Compare vs. File
              </button>
            </div>

            {/* Profile Picker when in Library Compare Mode */}
            {compareMode === 'library' && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-[10.5px] uppercase text-slate-500 dark:text-slate-400">
                  From:
                </span>
                <select
                  aria-label="Before profile"
                  value={beforeProfileId}
                  onChange={(e) => setBeforeProfileId(e.target.value)}
                  className="rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b111d] px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                >
                  {libraryEntries.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  title="Swap Before and After (e.g., Setup vs. Teardown back to Sunday Standard)"
                  onClick={() => {
                    const prevB = beforeProfileId;
                    setBeforeProfileId(afterProfileId);
                    setAfterProfileId(prevB);
                  }}
                  className="inline-flex items-center gap-1 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 font-mono text-[10.5px] font-semibold text-slate-700 dark:text-slate-200 hover:border-sky-500 cursor-pointer"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                  Swap
                </button>

                <span className="font-mono text-[10.5px] uppercase text-slate-500 dark:text-slate-400">
                  To:
                </span>
                <select
                  aria-label="After profile"
                  value={afterProfileId}
                  onChange={(e) => setAfterProfileId(e.target.value)}
                  className="rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b111d] px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                >
                  {libraryEntries.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {compareMode === 'file' && uploadedRig && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  {beforeLabel} → {afterLabel}
                </span>
                <button
                  type="button"
                  onClick={() => setSwapFileDirection((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-[2px] border border-slate-300 dark:border-slate-700 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                  Swap
                </button>
              </div>
            )}
          </div>

          {uploadError && (
            <div className="rounded-[2px] border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
              {uploadError}
            </div>
          )}

          {baselineSavedToast && (
            <div className="rounded-[2px] border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
              Baseline updated to match your current rig. Future edits will track cleanly from here.
            </div>
          )}
        </div>

        {/* Sub-Tabs (hidden on print) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSubTab('checklist')}
              className={`inline-flex items-center gap-1.5 rounded-[2px] border px-3.5 py-2 text-xs font-semibold cursor-pointer ${
                subTab === 'checklist'
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-slate-950'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-slate-700 dark:text-slate-200'
              }`}
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              In-Person Delta Checklist ({totalChecklistItems})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('details')}
              className={`inline-flex items-center gap-1.5 rounded-[2px] border px-3.5 py-2 text-xs font-semibold cursor-pointer ${
                subTab === 'details'
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-slate-950'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-slate-700 dark:text-slate-200'
              }`}
            >
              <GitCompare className="w-3.5 h-3.5" />
              Detailed Routing Diff ({diff.totalChanges})
            </button>
          </div>

          {subTab === 'checklist' && totalChecklistItems > 0 && (
            <div className="flex items-center gap-2 font-mono text-xs text-slate-600 dark:text-slate-300">
              <span>
                Progress: <strong>{completedChecklistItems}</strong> / {totalChecklistItems}
              </span>
              {completedChecklistItems > 0 && (
                <button
                  type="button"
                  onClick={resetChecks}
                  className="inline-flex items-center gap-1 rounded-[2px] border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Clear checks
                </button>
              )}
            </div>
          )}
        </div>

        {/* TAB 1: IN-PERSON PHYSICAL DELTA CHECKLIST (also print-ready!) */}
        {subTab === 'checklist' && (
          <section className="print-page-portrait rounded-[2px] border border-slate-200 dark:border-slate-800 print:border-none bg-white dark:bg-[#111827] print:bg-white p-5 sm:p-6 print:p-0 shadow-2xs space-y-5">
            {/* Checklist Header (appears on screen & print) */}
            <div className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-slate-900 dark:border-slate-600 print:border-slate-900 pb-3">
              <div>
                <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 print:text-slate-600">
                  In-Person Implementation Delta Checklist
                </div>
                <h3 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 print:text-slate-900">
                  {beforeLabel} → {afterLabel}
                </h3>
              </div>
              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 print:text-slate-600 text-right">
                <div>{printedDate}</div>
                <div>
                  {totalChecklistItems} action item{totalChecklistItems === 1 ? '' : 's'} ·{' '}
                  {diff.totalChanges} total diff{diff.totalChanges === 1 ? '' : 's'}
                </div>
              </div>
            </div>

            {totalChecklistItems === 0 ? (
              <div className="rounded-[2px] border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center space-y-2">
                <CheckCircle2 className="w-7 h-7 mx-auto text-emerald-500" />
                <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  No Physical or Console Changes Pending
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  {compareMode === 'baseline'
                    ? 'Your active rig matches its clean baseline. Stage edits in Patch Studio or modify gear/cables in Edit Mode to generate an in-person delta checklist automatically.'
                    : 'These two rig states have identical physical connections, +48V settings, and console routing.'}
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {diff.checklist
                  .filter((sec) => sec.items.length > 0)
                  .map((section) => (
                    <div key={section.key} className="print-section space-y-2">
                      <div className="border-b border-slate-300 dark:border-slate-700 print:border-slate-400 pb-1">
                        <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100 print:text-slate-900 flex items-center gap-1.5">
                          {section.key === 'safety' && (
                            <ShieldAlert className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                          )}
                          {section.key === 'console' && (
                            <Wrench className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                          )}
                          {section.title} ({section.items.length})
                        </h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 print:text-slate-600">
                          {section.subtitle}
                        </p>
                      </div>

                      <ul className="divide-y divide-slate-200 dark:divide-slate-800 print:divide-slate-300">
                        {section.items.map((item) => {
                          const checked = checkedSet.has(item.id);
                          const badge = ACTION_BADGE_META[item.actionType];
                          return (
                            <li
                              key={item.id}
                              className={`flex items-start justify-between gap-3 py-2.5 transition-opacity ${
                                checked ? 'opacity-55 print:opacity-100' : ''
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => toggleCheck(item.id)}
                                className="flex flex-1 items-start gap-2.5 text-left cursor-pointer"
                              >
                                <span className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400 print:text-slate-900">
                                  {checked ? (
                                    <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400 print:hidden" />
                                  ) : (
                                    <Square className="w-4 h-4 print:hidden" />
                                  )}
                                  <span className="hidden print:inline-block h-3.5 w-3.5 border border-slate-900" />
                                </span>

                                <div className="min-w-0 space-y-0.5">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span
                                      className={`rounded-[1px] border px-1.5 py-0 font-mono text-[9.5px] font-bold uppercase ${badge.cls} print:border-slate-700 print:bg-white print:text-slate-900`}
                                    >
                                      {badge.label}
                                    </span>
                                    <span
                                      className={`text-xs font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900 ${
                                        checked ? 'line-through print:no-underline' : ''
                                      }`}
                                    >
                                      {item.headline}
                                    </span>
                                  </div>
                                  <div className="text-[11.5px] text-slate-600 dark:text-slate-300 print:text-slate-700">
                                    {item.detail}
                                  </div>
                                  {(item.cableTag || item.notes) && (
                                    <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-sky-700 dark:text-sky-400 print:text-slate-800">
                                      {item.cableTag && <span>Cable: {item.cableTag}</span>}
                                      {item.notes && <span>Note: {item.notes}</span>}
                                    </div>
                                  )}
                                </div>
                              </button>

                              <div className="no-print flex shrink-0 items-center gap-1.5">
                                <span className="hidden sm:inline font-mono text-[10.5px] text-slate-500 dark:text-slate-400">
                                  {item.location}
                                </span>
                                {item.traceTarget && (
                                  <button
                                    type="button"
                                    onClick={() => onTraceOnSchematic(item.traceTarget!)}
                                    className="inline-flex items-center gap-1 rounded-[1px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-300 cursor-pointer"
                                  >
                                    <GitBranch className="w-2.5 h-2.5" />
                                    Trace
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 2: DETAILED ROUTING DIFF */}
        {subTab === 'details' && (
          <section className="no-print rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xs overflow-hidden">
            {/* Category Filter Chips */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-[#0b111d] px-4 py-2.5">
              {(Object.keys(CATEGORY_LABELS) as Array<DiffCategory | 'all'>).map((cat) => {
                const count = cat === 'all' ? diff.totalChanges : diff.counts[cat];
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`rounded-[1px] border px-2 py-0.5 font-mono text-[11px] font-semibold cursor-pointer ${
                      categoryFilter === cat
                        ? 'border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-slate-950'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {CATEGORY_LABELS[cat]} ({count})
                  </button>
                );
              })}
            </div>

            {filteredItems.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                No routing differences in this category.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                  >
                    <div className="min-w-0 space-y-1 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`rounded-[1px] px-1.5 py-0 font-mono text-[9.5px] font-bold uppercase ${
                            item.changeType === 'added'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                              : item.changeType === 'removed'
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                                : item.changeType === 'moved'
                                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                                  : 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
                          }`}
                        >
                          {item.changeType}
                        </span>
                        <span className="rounded-[1px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-1.5 py-0 font-mono text-[9.5px] text-slate-600 dark:text-slate-300">
                          {CATEGORY_LABELS[item.category]}
                        </span>
                        {item.severity === 'safety' && (
                          <span className="inline-flex items-center gap-0.5 rounded-[1px] bg-rose-100 dark:bg-rose-950 px-1.5 py-0 font-mono text-[9.5px] font-bold text-rose-700 dark:text-rose-300">
                            <Zap className="w-2.5 h-2.5" />
                            Safety
                          </span>
                        )}
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {item.title}
                        </span>
                      </div>

                      <p className="text-[11.5px] text-slate-600 dark:text-slate-300">{item.detail}</p>

                      {(item.beforeValue || item.afterValue) && (
                        <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px]">
                          {item.beforeValue && (
                            <span className="rounded-[1px] bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 px-1.5 py-0.5 text-rose-800 dark:text-rose-300">
                              − {item.beforeValue}
                            </span>
                          )}
                          {item.afterValue && (
                            <span className="rounded-[1px] bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/70 px-1.5 py-0.5 text-emerald-800 dark:text-emerald-300">
                              + {item.afterValue}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[10.5px] text-slate-500 dark:text-slate-400">
                        {item.location}
                      </span>
                      {item.traceTarget && (
                        <button
                          type="button"
                          onClick={() => onTraceOnSchematic(item.traceTarget!)}
                          className="inline-flex items-center gap-1 rounded-[1px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-300 cursor-pointer"
                        >
                          <GitBranch className="w-2.5 h-2.5" />
                          Trace
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
