import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Columns2,
  GitBranch,
  LayoutGrid,
  List,
  Search,
  Sliders,
  X,
  Zap,
} from 'lucide-react';
import type { HardwareNode, PortGroupCode, RigDocument, TraceTarget } from '../../schema/rig';
import { WING_COLORS, type PatchPrefillIntent } from '../../schema/patch';
import { formatGain, resolveBusName, resolveNodeName } from '../../schema/helpers';
import {
  buildConsoleStripRows,
  padSlot,
  resolveStripUpstreamOrigin,
  type InspectorStripRow,
} from '../inspector/inspectorHelpers';

interface ConsoleStripsViewProps {
  rig: RigDocument;
  lockedReadOnly: boolean;
  onTraceOnSchematic: (target: TraceTarget) => void;
  onPatchHere?: (intent: PatchPrefillIntent) => void;
}

type BankKey = 'all' | 'ch-1-8' | 'ch-9-16' | 'ch-17-24' | 'ch-25-32' | 'ch-33-40' | 'aux-1-8';

const BANKS: Array<{ key: BankKey; label: string; kind?: 'ch' | 'aux'; start?: number; end?: number }> = [
  { key: 'all', label: 'All (48)' },
  { key: 'ch-1-8', label: 'CH 1–8', kind: 'ch', start: 1, end: 8 },
  { key: 'ch-9-16', label: 'CH 9–16', kind: 'ch', start: 9, end: 16 },
  { key: 'ch-17-24', label: 'CH 17–24', kind: 'ch', start: 17, end: 24 },
  { key: 'ch-25-32', label: 'CH 25–32', kind: 'ch', start: 25, end: 32 },
  { key: 'ch-33-40', label: 'CH 33–40', kind: 'ch', start: 33, end: 40 },
  { key: 'aux-1-8', label: 'AUX 1–8', kind: 'aux', start: 1, end: 8 },
];

const WING_COLOR_MAP = new Map(WING_COLORS.map((c) => [c.index, c.hex]));

function inBank(row: InspectorStripRow, bank: BankKey): boolean {
  if (bank === 'all') return true;
  const spec = BANKS.find((b) => b.key === bank);
  if (!spec || !spec.kind || spec.start === undefined || spec.end === undefined) return true;
  return row.kind === spec.kind && row.index >= spec.start && row.index <= spec.end;
}

function getWingColorHex(colorIndex?: number): string {
  if (!colorIndex) return '#64748b';
  return WING_COLOR_MAP.get(colorIndex) ?? '#64748b';
}

interface ConsoleBoardProps {
  rig: RigDocument;
  consoleNode: HardwareNode;
  bank: BankKey;
  query: string;
  onlyPhantom: boolean;
  showVacant: boolean;
  layoutMode: 'banks' | 'table';
  lockedReadOnly: boolean;
  onTraceOnSchematic: (target: TraceTarget) => void;
  onPatchHere?: (intent: PatchPrefillIntent) => void;
}

function ConsoleStripBoard({
  rig,
  consoleNode,
  bank,
  query,
  onlyPhantom,
  showVacant,
  layoutMode,
  lockedReadOnly,
  onTraceOnSchematic,
  onPatchHere,
}: ConsoleBoardProps) {
  const busLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of consoleNode.mixBuses) {
      map.set(`${b.kind}:${b.index}`, resolveBusName(rig, b));
    }
    return map;
  }, [rig, consoleNode.mixBuses]);

  const allRows = useMemo(
    () => buildConsoleStripRows(consoleNode, { includeVacant: true }),
    [consoleNode],
  );

  const enrichedRows = useMemo(() => {
    return allRows.map((row) => {
      const origin = row.strip ? resolveStripUpstreamOrigin(rig, consoleNode, row.strip) : null;
      return { row, origin };
    });
  }, [allRows, rig, consoleNode]);

  const occupiedCount = useMemo(
    () => allRows.filter((r) => !r.isVacant).length,
    [allRows],
  );
  const vacantCount = allRows.length - occupiedCount;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enrichedRows.filter(({ row, origin }) => {
      if (!inBank(row, bank)) return false;
      if (!showVacant && row.isVacant) return false;
      if (onlyPhantom && !origin?.phantom48v && !row.source?.channel.phantom48v) return false;
      if (!q) return true;

      const stripTag = `${row.kind} ${row.index}`;
      const stripTagPad = `${row.kind} ${padSlot(row.index)}`;
      if (row.isVacant) {
        return (
          'vacant'.includes(q) ||
          'open'.includes(q) ||
          stripTag.includes(q) ||
          stripTagPad.includes(q)
        );
      }

      const s = row.strip!;
      const busNames = s.busSends
        .map((b) => busLookup.get(`${b.busKind}:${b.busIndex}`) ?? `bus ${b.busIndex}`)
        .join(' ')
        .toLowerCase();

      return (
        stripTag.includes(q) ||
        stripTagPad.includes(q) ||
        s.resolvedName.toLowerCase().includes(q) ||
        s.rawName.toLowerCase().includes(q) ||
        (origin?.directSource.toLowerCase().includes(q) ?? false) ||
        (origin?.chainLabel.toLowerCase().includes(q) ?? false) ||
        (origin?.cableTag?.toLowerCase().includes(q) ?? false) ||
        busNames.includes(q)
      );
    });
  }, [enrichedRows, bank, showVacant, onlyPhantom, query, busLookup]);

  const groupedBanks = useMemo(() => {
    const bankList = bank === 'all' ? BANKS.filter((b) => b.key !== 'all') : BANKS.filter((b) => b.key === bank);
    return bankList
      .map((b) => ({
        bank: b,
        items: filtered.filter(({ row }) => inBank(row, b.key)),
      }))
      .filter((g) => g.items.length > 0);
  }, [bank, filtered]);

  const handleTrace = (row: InspectorStripRow) => {
    if (!row.strip) return;
    if (row.source) {
      onTraceOnSchematic({
        type: 'channel',
        nodeId: consoleNode.id,
        portDirection: 'in',
        group: row.source.portGroup.code,
        slot: row.source.channel.slot,
        channelId: row.source.channel.id,
      });
      return;
    }
    if (row.strip.sourceGroup !== 'OFF' && row.strip.sourceSlot > 0) {
      onTraceOnSchematic({
        type: 'channel',
        nodeId: consoleNode.id,
        portDirection: 'in',
        group: row.strip.sourceGroup as PortGroupCode,
        slot: row.strip.sourceSlot,
      });
    }
  };

  return (
    <section className="rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xs overflow-hidden">
      {/* Console Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-[#0b111d] px-4 py-2.5">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {consoleNode.zone} · {consoleNode.model}
          </div>
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
            {resolveNodeName(rig, consoleNode)}
          </h3>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="rounded-[1px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-0.5 text-slate-700 dark:text-slate-200">
            <strong>{occupiedCount}</strong> active
          </span>
          <span className="rounded-[1px] border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-0.5 text-slate-500 dark:text-slate-400">
            {vacantCount} vacant
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
          No channel strips match your current filter.
        </div>
      ) : layoutMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b111d] font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="py-2 px-3 w-20">Strip</th>
                <th className="py-2 px-3">Console Label</th>
                <th className="py-2 px-3">Input Patch &amp; Physical Origin</th>
                <th className="py-2 px-3 w-32">Preamp / Mode</th>
                <th className="py-2 px-3">Bus &amp; Main Routing</th>
                <th className="py-2 px-3 w-24 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filtered.map(({ row, origin }) => {
                const stripCode = `${row.kind.toUpperCase()} ${padSlot(row.index)}`;
                if (row.isVacant || !row.strip) {
                  return (
                    <tr key={row.key} className="bg-slate-50/40 dark:bg-[#0b111d]/40">
                      <td className="py-1.5 px-3 font-mono text-[11px] text-slate-400 dark:text-slate-500">
                        {stripCode}
                      </td>
                      <td className="py-1.5 px-3 italic text-slate-400 dark:text-slate-500">Vacant</td>
                      <td className="py-1.5 px-3 font-mono text-[11px] text-slate-400 dark:text-slate-600">
                        OFF
                      </td>
                      <td className="py-1.5 px-3 text-slate-400 dark:text-slate-600">—</td>
                      <td className="py-1.5 px-3 text-slate-400 dark:text-slate-600">—</td>
                      <td className="py-1.5 px-3 text-right">
                        {!lockedReadOnly && onPatchHere && (
                          <button
                            type="button"
                            onClick={() =>
                              onPatchHere({
                                kind: 'strip',
                                consoleNodeId: consoleNode.id,
                                stripKind: row.kind,
                                index: row.index,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-[1px] border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/70 cursor-pointer"
                          >
                            <span>Patch here</span>
                            <ArrowRight className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                }

                const s = row.strip;
                const colorHex = getWingColorHex(s.colorIndex ?? row.source?.channel.colorIndex);
                const phantom = Boolean(origin?.phantom48v ?? row.source?.channel.phantom48v);
                const gain = origin?.gainDb ?? row.source?.channel.gainDb;
                const mode = origin?.mode ?? row.source?.channel.mode;
                const isOverride = Boolean(s.rawName && s.rawName.trim() !== '' && !s.clink);

                return (
                  <tr
                    key={row.key}
                    className="hover:bg-slate-50/90 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          style={{ backgroundColor: colorHex }}
                          className="h-4 w-1 shrink-0 rounded-[0.5px]"
                        />
                        <span className="font-mono text-[11px] font-bold text-slate-800 dark:text-slate-100">
                          {stripCode}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {s.resolvedName}
                        </span>
                        {isOverride && (
                          <span
                            title="Custom console strip name (not inheriting source clink)"
                            className="rounded-[1px] border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1 py-0 font-mono text-[9.5px] text-slate-500 dark:text-slate-400"
                          >
                            override
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="font-mono text-[11px] text-slate-700 dark:text-slate-200">
                        {origin?.chainLabel ?? `${s.sourceGroup}.${s.sourceSlot}`}
                      </div>
                      {origin?.cableTag && (
                        <div className="font-mono text-[10px] text-sky-700 dark:text-sky-400">
                          Cable: {origin.cableTag}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1 flex-wrap font-mono text-[10.5px]">
                        {mode && (
                          <span className="rounded-[1px] border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1 py-0 text-slate-700 dark:text-slate-300">
                            {mode}
                          </span>
                        )}
                        {gain !== undefined && (
                          <span className="text-slate-600 dark:text-slate-300">{formatGain(gain)}</span>
                        )}
                        {phantom && (
                          <span className="inline-flex items-center gap-0.5 rounded-[1px] bg-rose-100 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-700 px-1 py-0 font-bold text-rose-700 dark:text-rose-300">
                            <Zap className="w-2.5 h-2.5" />
                            48V
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {s.mainSends.map((m) => (
                          <span
                            key={`m-${m}`}
                            className="rounded-[1px] bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 px-1.5 py-0 font-mono text-[10px] font-semibold text-indigo-700 dark:text-indigo-300"
                          >
                            M{m}
                          </span>
                        ))}
                        {s.busSends.slice(0, 6).map((b) => (
                          <span
                            key={`b-${b.busKind}-${b.busIndex}`}
                            title={busLookup.get(`${b.busKind}:${b.busIndex}`) ?? `Bus ${b.busIndex}`}
                            className="rounded-[1px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0 font-mono text-[10px] text-slate-700 dark:text-slate-300"
                          >
                            B{b.busIndex}
                          </span>
                        ))}
                        {s.busSends.length > 6 && (
                          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                            +{s.busSends.length - 6}
                          </span>
                        )}
                        {s.mainSends.length === 0 && s.busSends.length === 0 && (
                          <span className="text-slate-400 dark:text-slate-600">—</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleTrace(row)}
                        className="inline-flex items-center gap-1 rounded-[1px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-300 cursor-pointer"
                      >
                        <GitBranch className="w-2.5 h-2.5" />
                        Trace
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-4 space-y-5">
          {groupedBanks.map(({ bank: bankMeta, items }) => (
            <div key={bankMeta.key} className="space-y-2">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-1">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  {bankMeta.label}
                </span>
                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                  {items.filter((i) => !i.row.isVacant).length}/{items.length} patched
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {items.map(({ row, origin }) => {
                  const stripCode = `${row.kind.toUpperCase()} ${padSlot(row.index)}`;
                  if (row.isVacant || !row.strip) {
                    return (
                      <div
                        key={row.key}
                        className="flex flex-col justify-between gap-2 rounded-[2px] border border-dashed border-slate-300/90 dark:border-slate-700/80 bg-slate-50/50 dark:bg-[#0b111d]/50 p-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10.5px] font-semibold text-slate-400 dark:text-slate-500">
                            {stripCode}
                          </span>
                          <span className="font-mono text-[9.5px] uppercase text-slate-400 dark:text-slate-600">
                            Vacant
                          </span>
                        </div>
                        {!lockedReadOnly && onPatchHere ? (
                          <button
                            type="button"
                            onClick={() =>
                              onPatchHere({
                                kind: 'strip',
                                consoleNodeId: consoleNode.id,
                                stripKind: row.kind,
                                index: row.index,
                              })
                            }
                            className="inline-flex w-full items-center justify-center gap-1 rounded-[1px] border border-sky-300 dark:border-sky-700 bg-sky-50/80 dark:bg-sky-950/60 px-2 py-1 font-mono text-[10px] font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/70 cursor-pointer"
                          >
                            <span>Patch here</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        ) : (
                          <div className="text-[11px] italic text-slate-400 dark:text-slate-600">
                            Unassigned
                          </div>
                        )}
                      </div>
                    );
                  }

                  const s = row.strip;
                  const colorHex = getWingColorHex(s.colorIndex ?? row.source?.channel.colorIndex);
                  const phantom = Boolean(origin?.phantom48v ?? row.source?.channel.phantom48v);
                  const gain = origin?.gainDb ?? row.source?.channel.gainDb;
                  const mode = origin?.mode ?? row.source?.channel.mode;

                  return (
                    <div
                      key={row.key}
                      className="flex flex-col justify-between gap-2 rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] overflow-hidden shadow-2xs hover:border-sky-400 dark:hover:border-sky-600 transition-colors"
                    >
                      <div style={{ backgroundColor: colorHex }} className="h-1.5 w-full" />
                      <div className="px-2.5 pb-2.5 space-y-1.5 flex-1 flex flex-col justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="font-mono text-[10.5px] font-bold text-slate-500 dark:text-slate-400">
                              {stripCode}
                            </span>
                            <div className="flex items-center gap-1 font-mono text-[9.5px]">
                              {mode === 'ST' && (
                                <span className="rounded-[1px] bg-sky-100 dark:bg-sky-950 px-1 font-bold text-sky-700 dark:text-sky-300">
                                  ST
                                </span>
                              )}
                              {phantom && (
                                <span className="inline-flex items-center gap-0.5 rounded-[1px] bg-rose-100 dark:bg-rose-950 px-1 font-bold text-rose-700 dark:text-rose-300">
                                  <Zap className="w-2.5 h-2.5" />
                                  48V
                                </span>
                              )}
                              {gain !== undefined && (
                                <span className="text-slate-500 dark:text-slate-400">
                                  {formatGain(gain)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="font-display text-sm font-bold leading-snug text-slate-900 dark:text-slate-100 truncate" title={s.resolvedName}>
                            {s.resolvedName}
                          </div>

                          <div className="font-mono text-[10.5px] text-slate-600 dark:text-slate-300 truncate" title={origin?.chainLabel}>
                            {origin?.chainLabel ?? `${s.sourceGroup}.${s.sourceSlot}`}
                          </div>

                          {origin?.cableTag && (
                            <div className="font-mono text-[9.5px] text-sky-700 dark:text-sky-400 truncate">
                              Cable: {origin.cableTag}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                          <div className="flex items-center gap-1 flex-wrap min-w-0">
                            {s.mainSends.map((m) => (
                              <span
                                key={`m-${m}`}
                                className="rounded-[1px] bg-indigo-50 dark:bg-indigo-950/70 px-1 py-0 font-mono text-[9.5px] font-semibold text-indigo-700 dark:text-indigo-300"
                              >
                                M{m}
                              </span>
                            ))}
                            {s.busSends.length > 0 && (
                              <span
                                title={s.busSends
                                  .map((b) => busLookup.get(`${b.busKind}:${b.busIndex}`) ?? `Bus ${b.busIndex}`)
                                  .join(', ')}
                                className="rounded-[1px] bg-slate-100 dark:bg-slate-800 px-1 py-0 font-mono text-[9.5px] text-slate-600 dark:text-slate-300"
                              >
                                {s.busSends.length} bus{s.busSends.length === 1 ? '' : 'es'}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleTrace(row)}
                            className="inline-flex shrink-0 items-center gap-0.5 rounded-[1px] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/60 cursor-pointer"
                          >
                            <GitBranch className="w-2.5 h-2.5" />
                            Trace
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ConsoleStripsView({
  rig,
  lockedReadOnly,
  onTraceOnSchematic,
  onPatchHere,
}: ConsoleStripsViewProps) {
  const consoles = useMemo(() => rig.nodes.filter((n) => n.kind === 'console'), [rig.nodes]);

  const [selectedConsoleId, setSelectedConsoleId] = useState<string>(() => consoles[0]?.id ?? '');
  const [sideBySide, setSideBySide] = useState<boolean>(false);
  const [bank, setBank] = useState<BankKey>('all');
  const [query, setQuery] = useState('');
  const [onlyPhantom, setOnlyPhantom] = useState(false);
  const [showVacant, setShowVacant] = useState(true);
  const [layoutMode, setLayoutMode] = useState<'banks' | 'table'>('banks');

  const activeConsole =
    consoles.find((c) => c.id === selectedConsoleId) ?? consoles[0];

  const visibleConsoles = sideBySide && consoles.length >= 2 ? consoles.slice(0, 2) : activeConsole ? [activeConsole] : [];

  return (
    <div className="min-h-full bg-[#f3f5f8] dark:bg-[#090d14] p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* Header & Controls Bar */}
        <div className="rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 space-y-3 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                style={{ clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' }}
                className="flex h-9 w-9 shrink-0 items-center justify-center bg-slate-900 dark:bg-sky-500 text-sky-400 dark:text-slate-950"
              >
                <Sliders className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Console Channel Strips (CH 1–40 &amp; AUX 1–8)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Final console fader/strip mapping with resolved upstream stagebox &amp; AES50 split origins.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Console Switcher */}
              {consoles.length > 1 && (
                <div className="inline-flex rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 p-0.5">
                  {consoles.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSideBySide(false);
                        setSelectedConsoleId(c.id);
                      }}
                      className={`rounded-[1px] px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                        !sideBySide && activeConsole?.id === c.id
                          ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {resolveNodeName(rig, c)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSideBySide(true)}
                    className={`inline-flex items-center gap-1 rounded-[1px] px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                      sideBySide
                        ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Columns2 className="w-3.5 h-3.5" />
                    Side-by-Side
                  </button>
                </div>
              )}

              {/* Layout Toggle */}
              <div className="inline-flex rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 p-0.5">
                <button
                  type="button"
                  onClick={() => setLayoutMode('banks')}
                  className={`inline-flex items-center gap-1 rounded-[1px] px-2 py-1 text-xs font-semibold cursor-pointer ${
                    layoutMode === 'banks'
                      ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Banks
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode('table')}
                  className={`inline-flex items-center gap-1 rounded-[1px] px-2 py-1 text-xs font-semibold cursor-pointer ${
                    layoutMode === 'table'
                      ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  Table
                </button>
              </div>
            </div>
          </div>

          {/* Search, Bank Tabs & Facets */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
            <div className="flex flex-wrap items-center gap-1">
              {BANKS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => setBank(b.key)}
                  className={`rounded-[1px] border px-2 py-1 font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                    bank === b.key
                      ? 'border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-slate-950'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-56">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter strip, name, source, bus..."
                  className="w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0b111d] pl-8 pr-7 py-1 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear filter"
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setOnlyPhantom((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-[2px] border px-2 py-1 font-mono text-[11px] font-semibold cursor-pointer ${
                  onlyPhantom
                    ? 'border-rose-400 bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300'
                }`}
              >
                <Zap className="w-3 h-3" />
                +48V
              </button>

              <button
                type="button"
                onClick={() => setShowVacant((v) => !v)}
                className={`rounded-[2px] border px-2 py-1 font-mono text-[11px] font-semibold cursor-pointer ${
                  showVacant
                    ? 'border-emerald-500/80 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300'
                }`}
              >
                {showVacant ? 'Showing Vacant' : 'Hide Vacant'}
              </button>
            </div>
          </div>
        </div>

        {/* Boards */}
        {visibleConsoles.length === 0 ? (
          <div className="rounded-[2px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No Behringer WING consoles found in this rig yet. Import a `.snap` file to view channel strip mappings.
          </div>
        ) : (
          <div
            className={
              visibleConsoles.length >= 2
                ? 'grid grid-cols-1 xl:grid-cols-2 gap-4 items-start'
                : 'space-y-4'
            }
          >
            {visibleConsoles.map((c) => (
              <ConsoleStripBoard
                key={c.id}
                rig={rig}
                consoleNode={c}
                bank={bank}
                query={query}
                onlyPhantom={onlyPhantom}
                showVacant={showVacant}
                layoutMode={layoutMode}
                lockedReadOnly={lockedReadOnly}
                onTraceOnSchematic={onTraceOnSchematic}
                onPatchHere={onPatchHere}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
