import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileJson,
  ShieldCheck,
  UploadCloud,
  X,
} from 'lucide-react';
import type { RigDocument } from '../../schema/rig';
import { resolveNodeName } from '../../schema/helpers';
import { parseWingSnap, type ParsedWingSnapshot } from '../../parser/wingSnapParser';
import { computeSnapMergeDiff, resolveTargetConsoleId } from '../../parser/merge';

interface SnapImportModalProps {
  rig: RigDocument;
  onClose: () => void;
  onApplyMerge: (parsed: ParsedWingSnapshot, targetConsoleId?: string) => void;
}

export function SnapImportModal({ rig, onClose, onApplyMerge }: SnapImportModalProps) {
  const [parsed, setParsed] = useState<ParsedWingSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const consoleNodes = useMemo(
    () => rig.nodes.filter((n) => n.kind === 'console'),
    [rig.nodes],
  );

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const result = parseWingSnap(text, { fileName: file.name });
      setParsed(result);
      const autoTarget = resolveTargetConsoleId(rig, result);
      setSelectedTargetId(autoTarget);
    } catch (err) {
      setParsed(null);
      setError(err instanceof Error ? err.message : 'Failed to parse .snap file.');
    }
  };

  const diff = useMemo(() => {
    if (!parsed) return null;
    const targetId = selectedTargetId === '__new__' ? parsed.consoleNode.id : selectedTargetId || undefined;
    return computeSnapMergeDiff(rig, parsed, targetId);
  }, [rig, parsed, selectedTargetId]);

  const handleApply = () => {
    if (!parsed) return;
    const targetId = selectedTargetId === '__new__' ? parsed.consoleNode.id : selectedTargetId || undefined;
    onApplyMerge(parsed, targetId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Import Behringer WING Snapshot (.snap)
            </h2>
            <p className="text-[11.5px] text-slate-500">
              Parsed 100% locally in your browser. Friendly names, positions & manual gear stay intact.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* File Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer ${
              isDragging
                ? 'border-sky-500 bg-sky-50'
                : parsed
                  ? 'border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50/70'
                  : 'border-slate-300 bg-slate-50/70 hover:border-sky-400 hover:bg-sky-50/40'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".snap,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleFile(file);
              }}
              className="hidden"
            />
            {parsed ? (
              <>
                <FileJson className="h-7 w-7 text-emerald-600" />
                <div className="mt-2 text-xs font-bold text-slate-900">
                  {parsed.metadata.fileName} — {parsed.metadata.creatorName}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-slate-600">
                  {parsed.metadata.snapshotType} · {parsed.metadata.creator}{' '}
                  {parsed.metadata.creatorVersion} · {parsed.consoleNode.model}
                </div>
                <div className="mt-1.5 text-[11px] text-sky-700 underline">
                  Click or drop another .snap file to replace
                </div>
              </>
            ) : (
              <>
                <UploadCloud className="h-8 w-8 text-slate-400" />
                <div className="mt-2 text-xs font-semibold text-slate-800">
                  Drop a Behringer WING <code className="font-mono">.snap</code> file here, or click to browse
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Supports WING Edit & WING Console JSON snapshots (verified on snapshot.11)
                </div>
              </>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
              <strong>Parse error:</strong> {error}
            </div>
          )}

          {/* Pre-Apply Diff Preview */}
          {parsed && diff && (
            <div className="space-y-4">
              {/* Target console picker */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                    Target Console in Rig
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Matched automatically from snapshot <code className="font-mono">creator_name</code>
                  </div>
                </div>
                <select
                  value={selectedTargetId}
                  onChange={(e) => setSelectedTargetId(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-sky-500 focus:outline-none"
                >
                  {consoleNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      Update: {resolveNodeName(rig, n)} ({n.rawName})
                    </option>
                  ))}
                  <option value="__new__">
                    + Add as New Console ({parsed.metadata.creatorName})
                  </option>
                </select>
              </div>

              {/* Parsed Snapshot Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="font-mono text-base font-bold text-slate-900">
                    {parsed.stats.activeInputs}
                  </div>
                  <div className="text-[10.5px] text-slate-500">Active Inputs</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="font-mono text-base font-bold text-slate-900">
                    {parsed.stats.activeOutputs}
                  </div>
                  <div className="text-[10.5px] text-slate-500">Patched Outputs</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="font-mono text-base font-bold text-amber-700">
                    {parsed.stats.passthroughOutputs}
                  </div>
                  <div className="text-[10.5px] text-slate-500">Direct Splits / Pass-thru</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="font-mono text-base font-bold text-sky-700">
                    {parsed.stats.namedBuses}
                  </div>
                  <div className="text-[10.5px] text-slate-500">Mix Buses</div>
                </div>
              </div>

              {/* Layer 2 Preservation Guarantee */}
              <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <div className="text-xs text-emerald-900">
                  <strong>Layer 2 Annotations Protected:</strong> {diff.preservedAnnotationsCount}{' '}
                  friendly labels, cable tags, notes, and layout positions will be preserved, along
                  with all manual external gear.
                </div>
              </div>

              {/* Channel & Bus Diff Summary */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="border-b border-slate-100 bg-slate-50 px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  Pre-Apply Diff Preview — {diff.targetConsoleName}
                </div>
                <div className="p-3.5 space-y-3 text-xs">
                  <div className="grid grid-cols-3 gap-2 font-mono">
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-emerald-800">
                      +{diff.addedChannels.length} ch added
                    </div>
                    <div className="rounded-lg bg-sky-50 border border-sky-200 px-2.5 py-1.5 text-sky-800">
                      ~{diff.updatedChannels.length} ch updated
                    </div>
                    <div className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1.5 text-slate-700">
                      -{diff.removedChannels.length} ch removed
                    </div>
                  </div>

                  {diff.updatedChannels.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-slate-600 mb-1">
                        Sample Channel Updates
                      </div>
                      <ul className="space-y-0.5 font-mono text-[11px] text-slate-700">
                        {diff.updatedChannels.slice(0, 6).map((item) => (
                          <li key={item.id} className="truncate">
                            • {item.label} <span className="text-slate-400">({item.detail})</span>
                          </li>
                        ))}
                        {diff.updatedChannels.length > 6 && (
                          <li className="text-slate-400">
                            + {diff.updatedChannels.length - 6} more updated channels
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {diff.trunkSummaries.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-slate-600 mb-1">
                        Connected Trunks Synced
                      </div>
                      <div className="space-y-1">
                        {diff.trunkSummaries.map((ts) => (
                          <div
                            key={ts.trunkId}
                            className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-2.5 py-1 text-[11px]"
                          >
                            <span className="font-medium text-slate-800">
                              {ts.label}
                              {ts.isNew && (
                                <span className="ml-1.5 rounded bg-emerald-100 px-1 text-[9.5px] font-mono text-emerald-800">
                                  NEW
                                </span>
                              )}
                            </span>
                            <span className="font-mono text-slate-600 inline-flex items-center gap-1">
                              {ts.beforeForward}/{ts.beforeReturn}
                              <ArrowRight className="w-3 h-3 text-slate-400" />
                              <strong className="text-slate-900">
                                {ts.afterForward}/{ts.afterReturn}
                              </strong>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {diff.newOrphans.length > 0 && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        {diff.newOrphans.length} Annotated Item(s) Will Move to Archived Orphans
                      </div>
                      <ul className="mt-1 space-y-0.5 font-mono text-[10.5px] text-amber-900">
                        {diff.newOrphans.map((o) => (
                          <li key={o.key}>
                            • {o.friendlyName || o.lastKnownName} ({o.key})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!parsed}
            onClick={handleApply}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-40 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Apply Snapshot Merge
          </button>
        </div>
      </div>
    </div>
  );
}
