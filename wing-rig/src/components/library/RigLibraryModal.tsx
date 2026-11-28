import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Edit3,
  FolderOpen,
  GitCompare,
  Package,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { RigLibraryEntry, RigLibrarySummary } from '../../store/rigLibraryDb';

interface RigLibraryModalProps {
  entries: RigLibraryEntry[];
  summaries: RigLibrarySummary[];
  activeProfileId: string;
  onClose: () => void;
  onSwitchProfile: (profileId: string) => void;
  onDuplicateProfile: (
    sourceProfileId: string,
    options?: { name?: string; notes?: string; tags?: string[]; resetBaselineToCurrent?: boolean },
  ) => void;
  onCreateNewProfile: (options?: { name?: string; venue?: string; notes?: string }) => void;
  onUpdateProfileMeta: (
    profileId: string,
    patch: { name?: string; venue?: string; notes?: string; tags?: string[] },
  ) => void;
  onDeleteProfile: (profileId: string) => boolean;
  onExportBundle: (profileId: string) => { ok: true; fileName: string } | { ok: false; error: string };
  onImportBundleOrRig: (
    rawText: string,
    options?: { mode?: 'new-profile' | 'replace-active' },
  ) =>
    | { ok: true; kind: 'bundle' | 'rig'; profileName: string; baselineCount: number }
    | { ok: false; error: string };
  onCompareProfile: (profileId: string) => void;
}

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function formatKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function RigLibraryModal({
  entries,
  summaries,
  activeProfileId,
  onClose,
  onSwitchProfile,
  onDuplicateProfile,
  onCreateNewProfile,
  onUpdateProfileMeta,
  onDeleteProfile,
  onExportBundle,
  onImportBundleOrRig,
  onCompareProfile,
}: RigLibraryModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [statusMessage, setStatusMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );
  const [dupTargetId, setDupTargetId] = useState<string | null>(null);
  const [dupName, setDupName] = useState('');
  const [dupNotes, setDupNotes] = useState('');
  const [dupResetBaseline, setDupResetBaseline] = useState(true);

  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editVenue, setEditVenue] = useState('');
  const [editNotes, setEditNotes] = useState('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const res = onImportBundleOrRig(text, { mode: 'new-profile' });
    if (res.ok) {
      setStatusMessage({
        tone: 'ok',
        text:
          res.kind === 'bundle'
            ? `Imported full rig bundle "${res.profileName}" (${res.baselineCount} raw .snap baseline(s) restored).`
            : `Imported "${res.profileName}" as a new library entry.`,
      });
    } else {
      setStatusMessage({ tone: 'err', text: res.error });
    }
  };

  const handleStartDuplicate = (summary: RigLibrarySummary) => {
    setEditTargetId(null);
    setDupTargetId(summary.id);
    setDupName(`${summary.name} — Special Event`);
    setDupNotes(summary.notes ?? '');
    setDupResetBaseline(true);
  };

  const handleConfirmDuplicate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dupTargetId) return;
    onDuplicateProfile(dupTargetId, {
      name: dupName.trim() || undefined,
      notes: dupNotes.trim() || undefined,
      tags: ['Event'],
      resetBaselineToCurrent: dupResetBaseline,
    });
    setDupTargetId(null);
    setStatusMessage({
      tone: 'ok',
      text: `Created and switched to "${dupName.trim() || 'Copy'}". Original baseline remains untouched.`,
    });
  };

  const handleStartEdit = (summary: RigLibrarySummary) => {
    setDupTargetId(null);
    setEditTargetId(summary.id);
    setEditName(summary.name);
    setEditVenue(summary.venue);
    setEditNotes(summary.notes ?? '');
  };

  const handleConfirmEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTargetId) return;
    onUpdateProfileMeta(editTargetId, {
      name: editName.trim() || 'Untitled Rig',
      venue: editVenue.trim(),
      notes: editNotes.trim() || undefined,
    });
    setEditTargetId(null);
    setStatusMessage({ tone: 'ok', text: 'Updated profile details.' });
  };

  const handleExport = (profileId: string) => {
    const res = onExportBundle(profileId);
    if (res.ok) {
      setStatusMessage({
        tone: 'ok',
        text: `Downloaded portable bundle ${res.fileName} (includes rig, annotations, raw .snap baselines, and staged edits).`,
      });
    } else {
      setStatusMessage({ tone: 'err', text: res.error });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rig-library-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 dark:bg-black/75 backdrop-blur-xs p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] shadow-2xl overflow-hidden"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.wingrig.json,.rig.json"
          onChange={handleImportFile}
          className="hidden"
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-3.5 bg-slate-50 dark:bg-[#0b111d]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              style={{ clipPath: 'polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%)' }}
              className="flex h-8 w-8 shrink-0 items-center justify-center bg-slate-900 dark:bg-sky-500 text-sky-400 dark:text-slate-950"
            >
              <FolderOpen className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="rig-library-modal-title"
                className="font-display text-base font-bold text-slate-900 dark:text-slate-100"
              >
                Rig Library &amp; Portable Bundles
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Store multiple setups locally (Sunday Standard, Special Events) and export complete `.wingrig.json` bundles.
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Close library"
            onClick={onClose}
            className="rounded-[2px] p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Top Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 px-5 py-2.5 bg-white dark:bg-[#111827]">
          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {summaries.length} saved rig{summaries.length === 1 ? '' : 's'} · 100% local browser IndexedDB
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Import Bundle / .rig.json
            </button>
            <button
              type="button"
              onClick={() => {
                onCreateNewProfile({ name: `New Rig ${summaries.length + 1}` });
                setStatusMessage({ tone: 'ok', text: 'Created a fresh rig profile in your library.' });
              }}
              className="inline-flex items-center gap-1.5 rounded-[2px] bg-sky-600 dark:bg-sky-500 px-2.5 py-1.5 text-xs font-semibold text-white dark:text-slate-950 hover:bg-sky-700 dark:hover:bg-sky-400 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              New Rig Profile
            </button>
          </div>
        </div>

        {statusMessage && (
          <div
            className={`mx-5 mt-3 flex items-center justify-between gap-2 rounded-[2px] border px-3 py-2 text-xs ${
              statusMessage.tone === 'ok'
                ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200'
                : 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200'
            }`}
          >
            <span>{statusMessage.text}</span>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="shrink-0 opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Profile List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {summaries.map((s) => {
            const isActive = s.id === activeProfileId;
            const fullEntry = entries.find((e) => e.id === s.id);
            const totalBaselineBytes = fullEntry
              ? Object.values(fullEntry.baselines).reduce((sum, b) => sum + b.byteLength, 0)
              : 0;

            return (
              <div
                key={s.id}
                className={`rounded-[2px] border p-3.5 space-y-2.5 transition-colors ${
                  isActive
                    ? 'border-sky-500 dark:border-sky-500 bg-sky-50/40 dark:bg-sky-950/25'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                        {s.name}
                      </h3>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 rounded-[1px] bg-sky-600 dark:bg-sky-500 px-1.5 py-0 font-mono text-[9.5px] font-bold uppercase text-white dark:text-slate-950">
                          <Check className="w-2.5 h-2.5" />
                          Active
                        </span>
                      )}
                      {s.stagedCount > 0 && (
                        <span className="rounded-[1px] border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0 font-mono text-[9.5px] font-semibold text-amber-800 dark:text-amber-200">
                          {s.stagedCount} staged edit{s.stagedCount === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
                      {s.venue || 'No venue set'} · {s.nodeCount} devices · {s.trunkCount} trunks · Updated{' '}
                      {formatDateShort(s.updatedAt)}
                    </div>
                    {s.notes && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 pt-0.5">{s.notes}</p>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => {
                          onSwitchProfile(s.id);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1 rounded-[2px] bg-slate-900 dark:bg-sky-500 px-2.5 py-1 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-sky-400 cursor-pointer"
                      >
                        Open
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleStartDuplicate(s)}
                      title="Clone this rig (including .snap baselines and annotations) for a special event"
                      className="inline-flex items-center gap-1 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      Duplicate
                    </button>

                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => {
                          onCompareProfile(s.id);
                          onClose();
                        }}
                        title="Compare this saved rig against your currently active rig"
                        className="inline-flex items-center gap-1 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-300 cursor-pointer"
                      >
                        <GitCompare className="w-3 h-3" />
                        Compare
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleExport(s.id)}
                      title="Export entire library entry (.wingrig.json) including .snap baselines and staged patches"
                      className="inline-flex items-center gap-1 rounded-[2px] border border-emerald-300 dark:border-emerald-700/80 bg-emerald-50/70 dark:bg-emerald-950/40 px-2 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-950/70 cursor-pointer"
                    >
                      <Package className="w-3 h-3" />
                      Bundle
                      <Download className="w-2.5 h-2.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleStartEdit(s)}
                      title="Rename or edit notes"
                      className="inline-flex items-center justify-center rounded-[2px] border border-slate-200 dark:border-slate-700 p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    {summaries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete "${s.name}" from your local Rig Library?`)) {
                            onDeleteProfile(s.id);
                          }
                        }}
                        title="Delete profile"
                        className="inline-flex items-center justify-center rounded-[2px] border border-slate-200 dark:border-slate-700 p-1 text-slate-500 hover:border-rose-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* .snap Baselines summary */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800/80 font-mono text-[10.5px]">
                  <span className="text-slate-500 dark:text-slate-400">Baselines:</span>
                  {s.baselineMetas.length > 0 ? (
                    <>
                      {s.baselineMetas.map((b) => (
                        <span
                          key={b.consoleNodeId}
                          className="rounded-[1px] border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 px-1.5 py-0 text-emerald-800 dark:text-emerald-300"
                        >
                          {b.fileName} ({formatKb(b.byteLength)})
                        </span>
                      ))}
                      <span className="text-slate-400 dark:text-slate-500">
                        · Bundle ~{formatKb(totalBaselineBytes + 25_000)}
                      </span>
                    </>
                  ) : (
                    <span className="italic text-slate-400 dark:text-slate-500">
                      No raw .snap baselines attached yet
                    </span>
                  )}
                </div>

                {/* Inline Duplicate Form */}
                {dupTargetId === s.id && (
                  <form
                    onSubmit={handleConfirmDuplicate}
                    className="mt-2 rounded-[2px] border border-sky-300 dark:border-sky-700 bg-white dark:bg-[#0b111d] p-3 space-y-2"
                  >
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                      Duplicate &ldquo;{s.name}&rdquo; as New Setup / Special Event
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        required
                        value={dupName}
                        onChange={(e) => setDupName(e.target.value)}
                        placeholder="e.g., Easter Orchestra 2026"
                        className="rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#111827] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                      <input
                        type="text"
                        value={dupNotes}
                        onChange={(e) => setDupNotes(e.target.value)}
                        placeholder="Optional event notes..."
                        className="rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#111827] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dupResetBaseline}
                        onChange={(e) => setDupResetBaseline(e.target.checked)}
                      />
                      Snapshot current state as the new profile&apos;s starting baseline (recommended for event delta checklists)
                    </label>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="submit"
                        className="rounded-[2px] bg-sky-600 dark:bg-sky-500 px-3 py-1 text-xs font-semibold text-white dark:text-slate-950 hover:bg-sky-700 cursor-pointer"
                      >
                        Create &amp; Switch
                      </button>
                      <button
                        type="button"
                        onClick={() => setDupTargetId(null)}
                        className="rounded-[2px] border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {/* Inline Edit Form */}
                {editTargetId === s.id && (
                  <form
                    onSubmit={handleConfirmEdit}
                    className="mt-2 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b111d] p-3 space-y-2"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Rig Name"
                        className="rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#111827] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                      <input
                        type="text"
                        value={editVenue}
                        onChange={(e) => setEditVenue(e.target.value)}
                        placeholder="Venue / Room"
                        className="rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#111827] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <input
                      type="text"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Profile notes..."
                      className="w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#111827] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="submit"
                        className="rounded-[2px] bg-slate-900 dark:bg-sky-500 px-3 py-1 text-xs font-semibold text-white dark:text-slate-950 cursor-pointer"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditTargetId(null)}
                        className="rounded-[2px] border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
