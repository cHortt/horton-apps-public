import { useMemo, useState } from 'react';
import {
  Check,
  GitBranch,
  Pencil,
  Search,
  Sliders,
  Unlink,
  Zap,
} from 'lucide-react';
import type { MixBusSummary, RigDocument, TraceTarget } from '../../schema/rig';
import {
  WING_COLORS,
  type ConsoleBaselineMeta,
  type ConsoleLinkConfig,
  type PathAuditIssue,
  type StagedPatchEntry,
} from '../../schema/patch';
import { formatGain, resolveBusName, resolveNodeName } from '../../schema/helpers';
import { createStagedEntry, getStereoPartnerSlot } from '../../parser/snapPatcher';
import { buildCrossConsoleMatrix, type CrossConsoleMatrixRow } from '../../parser/snapVerifier';

interface PatchMatrixViewProps {
  rig: RigDocument;
  linkConfig: ConsoleLinkConfig;
  baselines: Record<string, ConsoleBaselineMeta>;
  auditIssues: PathAuditIssue[];
  patchUnlocked: boolean;
  onStagePatches: (entries: StagedPatchEntry[]) => void;
  onTraceOnSchematic: (target: TraceTarget) => void;
}

export function PatchMatrixView({
  rig,
  linkConfig,
  baselines,
  auditIssues,
  patchUnlocked,
  onStagePatches,
  onTraceOnSchematic,
}: PatchMatrixViewProps) {
  const [subTab, setSubTab] = useState<'io' | 'buses'>('io');
  const [filter, setFilter] = useState('');
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftGain, setDraftGain] = useState(0);
  const [draftPhantom, setDraftPhantom] = useState(false);

  const [selectedBusConsoleId, setSelectedBusConsoleId] = useState<string>(
    linkConfig.stageConsoleId,
  );
  const [editingBusId, setEditingBusId] = useState<string | null>(null);
  const [busNameDraft, setBusNameDraft] = useState('');
  const [busMonoDraft, setBusMonoDraft] = useState(false);
  const [busMutedDraft, setBusMutedDraft] = useState(false);
  const [busColorDraft, setBusColorDraft] = useState<number>(1);
  const [monSrcDraft, setMonSrcDraft] = useState('');

  const consoles = useMemo(() => rig.nodes.filter((n) => n.kind === 'console'), [rig.nodes]);
  const stageNode = consoles.find((c) => c.id === linkConfig.stageConsoleId);
  const fohNode = linkConfig.fohConsoleId
    ? consoles.find((c) => c.id === linkConfig.fohConsoleId)
    : undefined;
  const hasStageBaseline = Boolean(stageNode && baselines[stageNode.id]);
  const hasFohBaseline = Boolean(fohNode && baselines[fohNode.id]);
  const stageOwnsHeadamp = linkConfig.headampOwnerConsoleId === linkConfig.stageConsoleId;

  const matrixRows = useMemo(
    () => buildCrossConsoleMatrix(rig, linkConfig, auditIssues),
    [rig, linkConfig, auditIssues],
  );

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return matrixRows;
    return matrixRows.filter(
      (r) =>
        r.sourceName.toLowerCase().includes(q) ||
        `${r.inputGroup}.${r.inputSlot}`.toLowerCase().includes(q) ||
        (r.stageChannel?.toLowerCase().includes(q) ?? false) ||
        (r.splitLabel?.toLowerCase().includes(q) ?? false) ||
        (r.fohChannel?.toLowerCase().includes(q) ?? false) ||
        (q.includes('48') && Boolean(r.phantom48v)),
    );
  }, [matrixRows, filter]);

  const startEditRow = (row: CrossConsoleMatrixRow) => {
    setEditingRowKey(row.key);
    setDraftName(row.sourceName);
    setDraftGain(row.gainDb ?? 0);
    setDraftPhantom(Boolean(row.phantom48v));
  };

  const saveEditRow = (row: CrossConsoleMatrixRow) => {
    if (!stageNode || !hasStageBaseline) return;
    const entries: StagedPatchEntry[] = [];
    const nameTrim = draftName.trim();
    entries.push(
      createStagedEntry(
        stageNode.id,
        `Update ${row.inputGroup}.${row.inputSlot} "${nameTrim}"${stageOwnsHeadamp ? ` (${formatGain(draftGain)}${draftPhantom ? ', +48V' : ''})` : ''}`,
        {
          type: 'set-input',
          group: row.inputGroup,
          slot: row.inputSlot,
          pairStereoSlot: row.mode === 'ST',
          name: nameTrim,
          mode: row.mode,
          gainDb: stageOwnsHeadamp ? draftGain : undefined,
          phantom48v: stageOwnsHeadamp ? draftPhantom : undefined,
        },
      ),
    );
    if (fohNode && hasFohBaseline && row.splitSlot !== undefined) {
      entries.push(
        createStagedEntry(
          fohNode.id,
          `Sync FOH ${linkConfig.fohReceivePort}.${row.splitSlot} label → "${nameTrim}"`,
          {
            type: 'set-input',
            group: linkConfig.fohReceivePort,
            slot: row.splitSlot,
            pairStereoSlot: row.mode === 'ST',
            name: nameTrim,
            mode: row.mode,
          },
        ),
      );
    }
    onStagePatches(entries);
    setEditingRowKey(null);
  };

  const unpatchSplit = (row: CrossConsoleMatrixRow) => {
    if (!stageNode || !hasStageBaseline || row.splitSlot === undefined) return;
    const entries: StagedPatchEntry[] = [
      createStagedEntry(
        stageNode.id,
        `Unpatch Split Out ${linkConfig.stageSplitPort}.${row.splitSlot} → OFF`,
        {
          type: 'set-output',
          group: linkConfig.stageSplitPort,
          slot: row.splitSlot,
          sourceGroup: 'OFF',
          sourceSlot: 1,
        },
      ),
    ];
    if (row.mode === 'ST') {
      const partner = getStereoPartnerSlot(row.splitSlot);
      entries.push(
        createStagedEntry(
          stageNode.id,
          `Unpatch Split Out ${linkConfig.stageSplitPort}.${partner} (ST R) → OFF`,
          {
            type: 'set-output',
            group: linkConfig.stageSplitPort,
            slot: partner,
            sourceGroup: 'OFF',
            sourceSlot: 1,
          },
        ),
      );
    }
    onStagePatches(entries);
  };

  const activeBusConsole =
    consoles.find((c) => c.id === selectedBusConsoleId) ?? stageNode ?? consoles[0];
  const hasActiveBusBaseline = Boolean(activeBusConsole && baselines[activeBusConsole.id]);

  const startEditBus = (bus: MixBusSummary) => {
    setEditingBusId(bus.id);
    setBusNameDraft(bus.rawName);
    setBusMonoDraft(bus.mono);
    setBusMutedDraft(bus.muted);
    setBusColorDraft(bus.colorIndex ?? 1);
    setMonSrcDraft(bus.monitorSource?.rawRef ?? 'BUS.1');
  };

  const saveEditBus = (bus: MixBusSummary) => {
    if (!activeBusConsole || !hasActiveBusBaseline) return;
    if (bus.kind === 'mon') {
      onStagePatches([
        createStagedEntry(
          activeBusConsole.id,
          `Set Monitor ${bus.index} tap → ${monSrcDraft.toUpperCase()}`,
          {
            type: 'set-monitor-source',
            monitorIndex: bus.index === 2 ? 2 : 1,
            sourceRef: monSrcDraft,
          },
        ),
      ]);
    } else {
      onStagePatches([
        createStagedEntry(
          activeBusConsole.id,
          `Update ${bus.kind.toUpperCase()} ${bus.index} "${busNameDraft.trim()}"${bus.kind === 'bus' ? ` (${busMonoDraft ? 'Mono' : 'Stereo'})` : ''}`,
          {
            type: 'set-bus',
            kind: bus.kind,
            index: bus.index,
            name: busNameDraft.trim(),
            mono: bus.kind === 'bus' ? busMonoDraft : undefined,
            muted: busMutedDraft,
            colorIndex: busColorDraft,
          },
        ),
      ]);
    }
    setEditingBusId(null);
  };

  return (
    <div className="space-y-3">
      {/* Sub-tab bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-1">
          <button
            type="button"
            onClick={() => setSubTab('io')}
            className={`rounded-[2px] px-3 py-1.5 text-xs font-semibold cursor-pointer ${
              subTab === 'io'
                ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Cross-Console I/O &amp; Split Matrix ({matrixRows.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('buses')}
            className={`inline-flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 text-xs font-semibold cursor-pointer ${
              subTab === 'buses'
                ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Mix Buses, Mains, Matrices &amp; Monitors
          </button>
        </div>

        {subTab === 'io' ? (
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter slot, source, CH #, +48V..."
              className="w-full rounded-[2px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">Console:</span>
            <select
              value={activeBusConsole?.id ?? ''}
              onChange={(e) => setSelectedBusConsoleId(e.target.value)}
              className="rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100"
            >
              {consoles.map((c) => (
                <option key={c.id} value={c.id}>
                  {resolveNodeName(rig, c)} ({c.mixBuses.length} mixes)
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {subTab === 'io' ? (
        <div className="rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-[#f3f5f8] dark:bg-[#090d14]/60 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-3 font-mono">Input</th>
                  <th className="py-2.5 px-3">Source Name</th>
                  <th className="py-2.5 px-3 font-mono">Preamp</th>
                  <th className="py-2.5 px-3 font-mono">Stage Ch</th>
                  <th className="py-2.5 px-3 font-mono">Split ({linkConfig.stageSplitPort})</th>
                  <th className="py-2.5 px-3 font-mono">FOH Ch</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-8 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      No matching input slots found.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const isEditing = editingRowKey === row.key;
                    const colorHex = WING_COLORS.find((c) => c.index === row.colorIndex)?.hex;
                    return (
                      <tr
                        key={row.key}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-2 px-3 font-mono font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            {colorHex && (
                              <span
                                style={{ backgroundColor: colorHex }}
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                              />
                            )}
                            {row.inputGroup}.{row.inputSlot}
                            {row.mode === 'ST' ? `–${getStereoPartnerSlot(row.inputSlot)}` : ''}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          {isEditing ? (
                            <input
                              type="text"
                              value={draftName}
                              onChange={(e) => setDraftName(e.target.value)}
                              className="w-40 rounded-[1px] border border-sky-500 bg-white dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-900 dark:text-slate-100"
                            />
                          ) : (
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {row.sourceName}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {isEditing && stageOwnsHeadamp ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                step={0.5}
                                value={draftGain}
                                onChange={(e) => setDraftGain(Number(e.target.value))}
                                className="w-16 rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-xs"
                              />
                              <label className="inline-flex items-center gap-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={draftPhantom}
                                  onChange={(e) => setDraftPhantom(e.target.checked)}
                                />
                                48V
                              </label>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <span>{row.mode}</span>
                              {row.gainDb !== undefined && <span>{formatGain(row.gainDb)}</span>}
                              {row.phantom48v && (
                                <span className="inline-flex items-center gap-0.5 rounded-[1px] bg-rose-50 dark:bg-rose-950/70 px-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                  <Zap className="w-2.5 h-2.5" />
                                  48V
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">
                          {row.stageChannel ?? '—'}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">
                          {row.splitLabel ?? (
                            <span className="text-slate-400 dark:text-slate-500">OFF</span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">
                          {row.fohChannel ?? '—'}
                        </td>
                        <td className="py-2 px-3">
                          {row.status === 'ok' && (
                            <span className="inline-flex rounded-[1px] bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                              Verified
                            </span>
                          )}
                          {row.status === 'single' && (
                            <span className="inline-flex rounded-[1px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-600 dark:text-slate-400">
                              Stage Only
                            </span>
                          )}
                          {row.status === 'warning' && (
                            <span
                              title={row.statusNote}
                              className="inline-flex rounded-[1px] bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-800 dark:text-amber-300"
                            >
                              Warning
                            </span>
                          )}
                          {row.status === 'error' && (
                            <span
                              title={row.statusNote}
                              className="inline-flex rounded-[1px] bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-700 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-700 dark:text-rose-300"
                            >
                              Conflict
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {isEditing ? (
                              <button
                                type="button"
                                onClick={() => saveEditRow(row)}
                                className="inline-flex items-center gap-1 rounded-[1px] bg-sky-600 dark:bg-sky-500 px-2 py-1 text-[11px] font-semibold text-white dark:text-slate-950 cursor-pointer"
                              >
                                <Check className="w-3 h-3" />
                                Stage
                              </button>
                            ) : (
                              <>
                                {patchUnlocked && hasStageBaseline && (
                                  <button
                                    type="button"
                                    title="Edit source label/preamp"
                                    onClick={() => startEditRow(row)}
                                    className="rounded-[1px] p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 cursor-pointer"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {patchUnlocked && hasStageBaseline && row.splitSlot !== undefined && (
                                  <button
                                    type="button"
                                    title="Unpatch inter-console split (set Out to OFF)"
                                    onClick={() => unpatchSplit(row)}
                                    className="rounded-[1px] p-1 text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                                  >
                                    <Unlink className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  title="Trace end-to-end on Interactive Schematic"
                                  onClick={() =>
                                    stageNode &&
                                    onTraceOnSchematic({
                                      type: 'channel',
                                      nodeId: stageNode.id,
                                      portDirection: 'in',
                                      group: row.inputGroup,
                                      slot: row.inputSlot,
                                      channelId: row.stageChannelId,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-[1px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-0.5 text-[10.5px] font-semibold text-sky-700 dark:text-sky-400 hover:border-sky-400 cursor-pointer"
                                >
                                  <GitBranch className="w-3 h-3" />
                                  Trace
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* MIX BUSES / MAINS / MATRICES / MONITORS MANAGER */
        <div className="rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {(activeBusConsole?.mixBuses ?? []).map((bus) => {
              const isEditing = editingBusId === bus.id;
              const colorHex = WING_COLORS.find((c) => c.index === bus.colorIndex)?.hex;
              return (
                <div
                  key={bus.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {colorHex && (
                        <span
                          style={{ backgroundColor: colorHex }}
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                        />
                      )}
                      <span className="rounded-[1px] bg-slate-900 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-white dark:text-sky-300">
                        {bus.kind} {bus.index}
                      </span>
                      {isEditing ? (
                        bus.kind === 'mon' ? (
                          <input
                            type="text"
                            value={monSrcDraft}
                            onChange={(e) => setMonSrcDraft(e.target.value)}
                            placeholder="BUS.7"
                            className="w-28 rounded-[1px] border border-sky-500 bg-white dark:bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                          />
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={busNameDraft}
                              onChange={(e) => setBusNameDraft(e.target.value)}
                              className="w-40 rounded-[1px] border border-sky-500 bg-white dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-900 dark:text-slate-100"
                            />
                            {bus.kind === 'bus' && (
                              <label className="inline-flex items-center gap-1 text-xs cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={busMonoDraft}
                                  onChange={(e) => setBusMonoDraft(e.target.checked)}
                                />
                                Mono
                              </label>
                            )}
                            <label className="inline-flex items-center gap-1 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={busMutedDraft}
                                onChange={(e) => setBusMutedDraft(e.target.checked)}
                              />
                              Muted
                            </label>
                            <select
                              value={busColorDraft}
                              onChange={(e) => setBusColorDraft(Number(e.target.value))}
                              className="rounded-[1px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-xs"
                            >
                              {WING_COLORS.map((c) => (
                                <option key={c.index} value={c.index}>
                                  {c.index}: {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )
                      ) : (
                        <>
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            {resolveBusName(rig, bus)}
                          </span>
                          <span className="rounded-[1px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:text-slate-300">
                            {bus.mono ? 'MONO' : 'STEREO'}
                          </span>
                          {bus.muted && (
                            <span className="rounded-[1px] bg-rose-50 dark:bg-rose-950/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-700 dark:text-rose-300">
                              MUTED
                            </span>
                          )}
                          {bus.monitorSource && (
                            <span className="font-mono text-[11px] text-amber-700 dark:text-amber-300">
                              taps {bus.monitorSource.rawRef}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 font-mono text-[10.5px] text-slate-500 dark:text-slate-400">
                      {bus.outputs.length > 0
                        ? bus.outputs.map((o) => (
                            <span
                              key={`${o.group}-${o.slot}`}
                              className="rounded-[1px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-1.5 py-0.5"
                            >
                              Out {o.group}.{o.slot}
                              {o.stereoSide ? ` (${o.stereoSide})` : ''}
                            </span>
                          ))
                        : 'No direct physical outputs assigned'}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isEditing ? (
                      <button
                        type="button"
                        onClick={() => saveEditBus(bus)}
                        className="inline-flex items-center gap-1 rounded-[1px] bg-sky-600 dark:bg-sky-500 px-2.5 py-1 text-xs font-semibold text-white dark:text-slate-950 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Stage
                      </button>
                    ) : (
                      patchUnlocked &&
                      hasActiveBusBaseline && (
                        <button
                          type="button"
                          onClick={() => startEditBus(bus)}
                          className="inline-flex items-center gap-1 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-sky-400 cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                      )
                    )}
                    {activeBusConsole && (
                      <button
                        type="button"
                        onClick={() =>
                          onTraceOnSchematic({
                            type: 'bus',
                            nodeId: activeBusConsole.id,
                            busKind: bus.kind,
                            busIndex: bus.index,
                            busId: bus.id,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:text-sky-400 hover:border-sky-400 cursor-pointer"
                      >
                        <GitBranch className="w-3 h-3" />
                        Trace
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
