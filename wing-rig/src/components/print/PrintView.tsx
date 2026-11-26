import { useMemo, useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import type { HardwareNode, RigDocument, TrunkProtocol } from '../../schema/rig';
import {
  PROTOCOL_META,
  formatGain,
  resolveBusName,
  resolveChannelName,
  resolveNodeName,
  resolveNodePosition,
  resolveNodeZone,
  resolveTrunkCableTag,
  resolveTrunkName,
} from '../../schema/helpers';

interface PrintViewProps {
  rig: RigDocument;
  onBack: () => void;
}

function SchematicSvg({ rig }: { rig: RigDocument }) {
  const NODE_W = 240;
  const NODE_H = 104;
  const PAD = 56;

  const { viewBox, nodeBoxes } = useMemo(() => {
    const boxes = rig.nodes.map((node) => {
      const pos = resolveNodePosition(rig, node);
      return { node, x: pos.x, y: pos.y, w: NODE_W, h: NODE_H };
    });

    if (boxes.length === 0) {
      return { viewBox: '0 0 1000 560', nodeBoxes: [] };
    }

    const minX = Math.min(...boxes.map((b) => b.x)) - PAD;
    const minY = Math.min(...boxes.map((b) => b.y)) - PAD;
    const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + PAD;
    const maxY = Math.max(...boxes.map((b) => b.y + b.h)) + PAD;

    return {
      viewBox: `${minX} ${minY} ${Math.max(760, maxX - minX)} ${Math.max(400, maxY - minY)}`,
      nodeBoxes: boxes,
    };
  }, [rig]);

  const boxMap = useMemo(
    () => new Map(nodeBoxes.map((b) => [b.node.id, b])),
    [nodeBoxes],
  );

  return (
    <svg
      viewBox={viewBox}
      className="w-full h-auto max-h-[5.7in] border border-slate-300 rounded-lg bg-white"
      role="img"
      aria-label={`${rig.name} system block diagram`}
    >
      <defs>
        <marker
          id="print-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#475569" />
        </marker>
      </defs>

      {/* Trunks (rendered behind nodes) */}
      {rig.trunks.map((trunk) => {
        const src = boxMap.get(trunk.sourceNodeId);
        const tgt = boxMap.get(trunk.targetNodeId);
        if (!src || !tgt) return null;

        const proto = PROTOCOL_META[trunk.protocol];
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const isVertical = Math.abs(dy) > Math.abs(dx) * 1.15 && Math.abs(dy) > 90;

        let x1: number;
        let y1: number;
        let x2: number;
        let y2: number;
        let pathD: string;

        if (isVertical) {
          x1 = src.x + src.w / 2;
          x2 = tgt.x + tgt.w / 2;
          if (dy > 0) {
            y1 = src.y + src.h;
            y2 = tgt.y;
          } else {
            y1 = src.y;
            y2 = tgt.y + tgt.h;
          }
          pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
        } else if (dx < -40) {
          x1 = src.x;
          y1 = src.y + src.h / 2;
          x2 = tgt.x + tgt.w;
          y2 = tgt.y + tgt.h / 2;
          const midX = (x1 + x2) / 2;
          pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
        } else {
          x1 = src.x + src.w;
          y1 = src.y + src.h / 2;
          x2 = tgt.x;
          y2 = tgt.y + tgt.h / 2;
          const midX = (x1 + x2) / 2;
          pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
        }

        const labelX = (x1 + x2) / 2;
        const labelY = (y1 + y2) / 2;
        const tag = resolveTrunkCableTag(rig, trunk);
        const countText =
          trunk.returnChannels.length > 0
            ? `${trunk.channels.length} ↔ ${trunk.returnChannels.length}`
            : `${trunk.channels.length} ch →`;
        const pillText = `${proto.shortLabel} · ${countText}${tag ? ` · ${tag}` : ''}`;
        const pillW = Math.max(118, pillText.length * 6.2 + 16);

        return (
          <g key={trunk.id}>
            <path
              d={pathD}
              fill="none"
              stroke={proto.color}
              strokeWidth={2.5}
              markerEnd="url(#print-arrow)"
              markerStart={trunk.returnChannels.length > 0 ? 'url(#print-arrow)' : undefined}
            />
            <rect
              x={labelX - pillW / 2}
              y={labelY - 12}
              width={pillW}
              height={24}
              rx={6}
              fill="#ffffff"
              stroke={proto.color}
              strokeWidth={1.25}
            />
            <text
              x={labelX}
              y={labelY + 3.5}
              textAnchor="middle"
              fontFamily="IBM Plex Mono, monospace"
              fontSize={9.5}
              fontWeight={600}
              fill="#0f172a"
            >
              {pillText}
            </text>
          </g>
        );
      })}

      {/* Hardware Nodes */}
      {nodeBoxes.map(({ node, x, y, w, h }) => {
        const name = resolveNodeName(rig, node);
        const zone = resolveNodeZone(rig, node);
        const inCount = node.portGroups
          .filter((pg) => pg.direction !== 'output')
          .reduce((s, pg) => s + pg.channels.length, 0);
        const outCount = node.portGroups
          .filter((pg) => pg.direction !== 'input')
          .reduce((s, pg) => s + pg.channels.length, 0);
        const isConsole = node.kind === 'console';

        return (
          <g key={node.id}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={10}
              fill="#ffffff"
              stroke={isConsole ? '#0f172a' : '#64748b'}
              strokeWidth={isConsole ? 2.2 : 1.4}
            />
            {/* Top Header Strip */}
            <rect
              x={x + 1}
              y={y + 1}
              width={w - 2}
              height={24}
              rx={9}
              fill={isConsole ? '#0f172a' : '#f1f5f9'}
            />
            <text
              x={x + 12}
              y={y + 16.5}
              fontFamily="Inter, sans-serif"
              fontSize={9.5}
              fontWeight={700}
              fill={isConsole ? '#e0f2fe' : '#334155'}
            >
              {zone.toUpperCase()}
            </text>
            <text
              x={x + w - 12}
              y={y + 16.5}
              textAnchor="end"
              fontFamily="IBM Plex Mono, monospace"
              fontSize={9}
              fill={isConsole ? '#94a3b8' : '#64748b'}
            >
              {node.kind.toUpperCase()}
            </text>

            {/* Device Title & Model */}
            <text
              x={x + 12}
              y={y + 48}
              fontFamily="Inter, sans-serif"
              fontSize={13}
              fontWeight={700}
              fill="#0f172a"
            >
              {name.length > 26 ? `${name.slice(0, 25)}…` : name}
            </text>
            <text
              x={x + 12}
              y={y + 66}
              fontFamily="Inter, sans-serif"
              fontSize={10.5}
              fill="#475569"
            >
              {node.model.length > 30 ? `${node.model.slice(0, 29)}…` : node.model}
            </text>

            {/* Footer I/O Metrics */}
            <text
              x={x + 12}
              y={y + 88}
              fontFamily="IBM Plex Mono, monospace"
              fontSize={10}
              fontWeight={600}
              fill="#0369a1"
            >
              {inCount} IN · {outCount} OUT
              {node.mixBuses.length > 0 ? ` · ${node.mixBuses.length} MIX` : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function PrintView({ rig, onBack }: PrintViewProps) {
  const [includeStageInputs, setIncludeStageInputs] = useState(true);
  const [includeTrunks, setIncludeTrunks] = useState(true);
  const [includeLocalIo, setIncludeLocalIo] = useState(true);
  const [includeMonitors, setIncludeMonitors] = useState(true);

  const consoles = useMemo(() => rig.nodes.filter((n) => n.kind === 'console'), [rig.nodes]);

  // Stage inputs: primary AES50-A input group across consoles, or stagebox outputs
  const stageInputGroups = useMemo(() => {
    const groups: Array<{ node: HardwareNode; title: string; channels: HardwareNode['portGroups'][number]['channels'] }> = [];
    for (const c of consoles) {
      const aesA = c.portGroups.find((pg) => pg.code === 'A' && pg.direction === 'input');
      if (aesA && aesA.channels.length > 0) {
        groups.push({
          node: c,
          title: `${resolveNodeName(rig, c)} — ${aesA.label}`,
          channels: aesA.channels,
        });
      }
    }
    return groups;
  }, [consoles, rig]);

  // Local console I/O groups (LCL & AUX)
  const localIoGroups = useMemo(() => {
    const groups: Array<{
      node: HardwareNode;
      label: string;
      direction: string;
      channels: HardwareNode['portGroups'][number]['channels'];
    }> = [];
    for (const c of consoles) {
      for (const pg of c.portGroups) {
        if (pg.code === 'LCL' || pg.code === 'AUX') {
          groups.push({
            node: c,
            label: `${resolveNodeName(rig, c)} — ${pg.label}`,
            direction: pg.direction.toUpperCase(),
            channels: pg.channels,
          });
        }
      }
    }
    return groups;
  }, [consoles, rig]);

  const usedProtocols = useMemo(() => {
    const set = new Set<TrunkProtocol>();
    for (const t of rig.trunks) set.add(t.protocol);
    return [...set];
  }, [rig.trunks]);

  const printedDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="min-h-full bg-slate-100 dark:bg-slate-950 pb-12 print:bg-white print:pb-0">
      {/* On-screen Print Preview Control Bar */}
      <div className="no-print sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Interactive Schematic
          </button>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Page 1: Landscape Block Diagram · Pages 2+: Portrait Binder Patch Sheets
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeStageInputs}
              onChange={(e) => setIncludeStageInputs(e.target.checked)}
            />
            Stage Inputs
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeTrunks}
              onChange={(e) => setIncludeTrunks(e.target.checked)}
            />
            Digital Trunks
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeLocalIo}
              onChange={(e) => setIncludeLocalIo(e.target.checked)}
            />
            Local I/O
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeMonitors}
              onChange={(e) => setIncludeMonitors(e.target.checked)}
            />
            Monitors & PA
          </label>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-sky-400 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* PAGE 1: LANDSCAPE SYSTEM BLOCK DIAGRAM */}
      <section className="print-page-landscape mx-auto mt-6 max-w-[10.4in] rounded-xl border border-slate-300 dark:border-slate-700 bg-white text-slate-900 p-6 shadow-sm">
        <div className="flex items-end justify-between border-b-2 border-slate-900 pb-3 mb-4">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Page 1 · System Block Diagram (Landscape)
            </div>
            <h1 className="text-xl font-bold text-slate-900 leading-tight">{rig.name}</h1>
            <div className="text-xs text-slate-600">
              {rig.venue} · {rig.nodes.length} Hardware Blocks · {rig.trunks.length} Signal Trunks
            </div>
          </div>
          <div className="text-right font-mono text-[10.5px] text-slate-600">
            <div>Printed: {printedDate}</div>
            {rig.sourceSnapshots.length > 0 && (
              <div>
                Snapshot: {rig.sourceSnapshots.map((s) => `${s.creatorName} (${s.fileName})`).join(', ')}
              </div>
            )}
          </div>
        </div>

        <SchematicSvg rig={rig} />

        {/* Protocol Legend Footer */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-2.5 text-[10.5px] text-slate-600">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold uppercase tracking-wider text-slate-500">Protocol Key:</span>
            {usedProtocols.map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5 font-mono">
                <span
                  style={{ backgroundColor: PROTOCOL_META[p].color }}
                  className="inline-block h-2 w-4 rounded-full"
                />
                {PROTOCOL_META[p].label}
              </span>
            ))}
          </div>
          <div className="font-mono text-[10px] text-slate-500">
            WING Rig Visualizer · Binder Reference Sheet
          </div>
        </div>
      </section>

      {/* PAGES 2+: PORTRAIT BINDER-READY PATCH TABLES */}
      <section className="print-page-portrait mx-auto mt-6 max-w-[8.1in] rounded-xl border border-slate-300 dark:border-slate-700 bg-white text-slate-900 p-6 shadow-sm space-y-6">
        <div className="flex items-end justify-between border-b-2 border-slate-900 pb-2.5">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Pages 2+ · Binder Patch Tables (Portrait)
            </div>
            <h2 className="text-lg font-bold text-slate-900">{rig.name} — Patch Sheets</h2>
          </div>
          <div className="font-mono text-[10.5px] text-slate-500">{printedDate}</div>
        </div>

        {/* 1. Stage Inputs */}
        {includeStageInputs && stageInputGroups.length > 0 && (
          <div className="print-section">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-2">
              1. Stage Inputs (Stage Box / AES50-A)
            </h3>
            {stageInputGroups.map((group) => (
              <div key={group.title} className="mb-4 last:mb-0">
                <div className="text-[11px] font-semibold text-slate-700 mb-1.5">{group.title}</div>
                <table className="print-table w-full border-collapse text-left text-[11px]">
                  <thead>
                    <tr className="border-y border-slate-400 bg-slate-100 text-[10px] font-bold uppercase text-slate-700">
                      <th className="py-1 px-1.5 w-10">Slot</th>
                      <th className="py-1 px-1.5">Source Label</th>
                      <th className="py-1 px-1.5 w-14">Mode</th>
                      <th className="py-1 px-1.5 w-16">Gain</th>
                      <th className="py-1 px-1.5 w-12">+48V</th>
                      <th className="py-1 px-1.5 w-24">Console Ch</th>
                      <th className="py-1 px-1.5">Cable / Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {group.channels.map((ch) => {
                      const ann = rig.annotations.channels[ch.id];
                      return (
                        <tr key={ch.id}>
                          <td className="py-1 px-1.5 font-mono font-semibold">{ch.slot}</td>
                          <td className="py-1 px-1.5 font-medium text-slate-900">
                            {resolveChannelName(rig, ch)}
                          </td>
                          <td className="py-1 px-1.5 font-mono">
                            {ch.mode === 'ST' ? `ST ${ch.stereoSide ?? ''}` : 'M'}
                          </td>
                          <td className="py-1 px-1.5 font-mono">{formatGain(ch.gainDb)}</td>
                          <td className="py-1 px-1.5 font-mono font-bold">
                            {ch.phantom48v ? '+48V' : '—'}
                          </td>
                          <td className="py-1 px-1.5 font-mono">
                            {ch.consoleChannel ?? '—'}
                            {ch.channelStripName ? ` (${ch.channelStripName})` : ''}
                          </td>
                          <td className="py-1 px-1.5 text-slate-600">
                            {[ann?.cableTag, ann?.notes].filter(Boolean).join(' · ') || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {/* 2. Digital & Analog Trunks */}
        {includeTrunks && rig.trunks.length > 0 && (
          <div className="print-section">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-2">
              2. Digital & Analog Signal Trunks (Forward & Return)
            </h3>
            <div className="space-y-4">
              {rig.trunks.map((trunk) => {
                const src = rig.nodes.find((n) => n.id === trunk.sourceNodeId);
                const tgt = rig.nodes.find((n) => n.id === trunk.targetNodeId);
                const cableTag = resolveTrunkCableTag(rig, trunk);
                const trunkNotes = rig.annotations.trunks[trunk.id]?.notes;
                return (
                  <div key={trunk.id} className="border border-slate-300 rounded-lg p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-1.5 mb-2">
                      <div>
                        <span className="text-xs font-bold text-slate-900">
                          {resolveTrunkName(rig, trunk)}
                        </span>{' '}
                        <span className="font-mono text-[10px] text-slate-600">
                          [{PROTOCOL_META[trunk.protocol].shortLabel}
                          {cableTag ? ` · ${cableTag}` : ''}]
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-slate-600">
                        {src ? resolveNodeName(rig, src) : trunk.sourceNodeId} ({trunk.sourcePortGroup})
                        {trunk.returnChannels.length > 0 ? ' ↔ ' : ' → '}
                        {tgt ? resolveNodeName(rig, tgt) : trunk.targetNodeId} ({trunk.targetPortGroup})
                      </div>
                    </div>
                    {trunkNotes && (
                      <div className="mb-2 text-[10.5px] italic text-slate-600">{trunkNotes}</div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="font-mono text-[10px] font-bold uppercase text-slate-500 mb-1">
                          Forward ({trunk.channels.length} ch)
                        </div>
                        <table className="print-table w-full border-collapse text-[10.5px]">
                          <thead>
                            <tr className="border-y border-slate-300 bg-slate-50 text-[9.5px] uppercase text-slate-600">
                              <th className="py-0.5 px-1 w-8">Ch</th>
                              <th className="py-0.5 px-1">Signal</th>
                              <th className="py-0.5 px-1">Route / Split</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {trunk.channels.map((ch) => (
                              <tr key={ch.id}>
                                <td className="py-0.5 px-1 font-mono font-semibold">{ch.slot}</td>
                                <td className="py-0.5 px-1 font-medium">
                                  {resolveChannelName(rig, ch)}
                                </td>
                                <td className="py-0.5 px-1 font-mono text-[9.5px] text-slate-600">
                                  {ch.routeLabel ?? (ch.mode === 'ST' ? `ST ${ch.stereoSide ?? ''}` : 'M')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {trunk.returnChannels.length > 0 && (
                        <div>
                          <div className="font-mono text-[10px] font-bold uppercase text-slate-500 mb-1">
                            Return ({trunk.returnChannels.length} ch)
                          </div>
                          <table className="print-table w-full border-collapse text-[10.5px]">
                            <thead>
                              <tr className="border-y border-slate-300 bg-slate-50 text-[9.5px] uppercase text-slate-600">
                                <th className="py-0.5 px-1 w-8">Ch</th>
                                <th className="py-0.5 px-1">Return Signal</th>
                                <th className="py-0.5 px-1">Source</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {trunk.returnChannels.map((ch) => (
                                <tr key={ch.id}>
                                  <td className="py-0.5 px-1 font-mono font-semibold">{ch.slot}</td>
                                  <td className="py-0.5 px-1 font-medium">
                                    {resolveChannelName(rig, ch)}
                                  </td>
                                  <td className="py-0.5 px-1 font-mono text-[9.5px] text-slate-600">
                                    {ch.routeLabel ?? '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. Local Console I/O */}
        {includeLocalIo && localIoGroups.length > 0 && (
          <div className="print-section">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-2">
              3. Local Console I/O (Local XLR & Aux)
            </h3>
            <div className="space-y-3">
              {localIoGroups.map((grp) => (
                <div key={`${grp.node.id}-${grp.label}`}>
                  <div className="text-[11px] font-semibold text-slate-700 mb-1">
                    {grp.label} ({grp.direction})
                  </div>
                  <table className="print-table w-full border-collapse text-left text-[11px]">
                    <thead>
                      <tr className="border-y border-slate-400 bg-slate-100 text-[10px] font-bold uppercase text-slate-700">
                        <th className="py-1 px-1.5 w-10">Slot</th>
                        <th className="py-1 px-1.5">Label</th>
                        <th className="py-1 px-1.5 w-14">Mode</th>
                        <th className="py-1 px-1.5 w-16">Gain</th>
                        <th className="py-1 px-1.5 w-12">+48V</th>
                        <th className="py-1 px-1.5">Assignment / Route</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {grp.channels.map((ch) => (
                        <tr key={ch.id}>
                          <td className="py-1 px-1.5 font-mono font-semibold">{ch.slot}</td>
                          <td className="py-1 px-1.5 font-medium">{resolveChannelName(rig, ch)}</td>
                          <td className="py-1 px-1.5 font-mono">
                            {ch.mode === 'ST' ? `ST ${ch.stereoSide ?? ''}` : 'M'}
                          </td>
                          <td className="py-1 px-1.5 font-mono">{formatGain(ch.gainDb)}</td>
                          <td className="py-1 px-1.5 font-mono font-bold">
                            {ch.phantom48v ? '+48V' : '—'}
                          </td>
                          <td className="py-1 px-1.5 font-mono text-[10px] text-slate-600">
                            {ch.routeLabel ||
                              (ch.consoleChannel
                                ? `${ch.consoleChannel}${ch.channelStripName ? ` (${ch.channelStripName})` : ''}`
                                : '—')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. Monitor Mixes & PA Outputs */}
        {includeMonitors && consoles.some((c) => c.mixBuses.length > 0) && (
          <div className="print-section">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-2">
              4. Monitor Mixes & PA Outputs
            </h3>
            <div className="space-y-4">
              {consoles
                .filter((c) => c.mixBuses.length > 0)
                .map((c) => (
                  <div key={c.id}>
                    <div className="text-[11px] font-semibold text-slate-700 mb-1">
                      {resolveNodeName(rig, c)} ({c.model})
                    </div>
                    <table className="print-table w-full border-collapse text-left text-[11px]">
                      <thead>
                        <tr className="border-y border-slate-400 bg-slate-100 text-[10px] font-bold uppercase text-slate-700">
                          <th className="py-1 px-1.5 w-20">Bus / Out</th>
                          <th className="py-1 px-1.5">Mix Name</th>
                          <th className="py-1 px-1.5 w-16">Format</th>
                          <th className="py-1 px-1.5">Physical Output Destinations</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {c.mixBuses.map((bus) => (
                          <tr key={bus.id}>
                            <td className="py-1 px-1.5 font-mono font-semibold uppercase">
                              {bus.kind} {bus.index}
                            </td>
                            <td className="py-1 px-1.5 font-medium">
                              {resolveBusName(rig, bus)}
                              {bus.monitorSource && (
                                <span className="ml-1.5 font-mono text-[10px] text-slate-500">
                                  (taps {bus.monitorSource.rawRef})
                                </span>
                              )}
                            </td>
                            <td className="py-1 px-1.5 font-mono">
                              {bus.mono ? 'Mono' : 'Stereo'}
                            </td>
                            <td className="py-1 px-1.5 font-mono text-[10px] text-slate-700">
                              {bus.outputs.length > 0
                                ? bus.outputs
                                    .map(
                                      (o) =>
                                        `${o.group}.${o.slot}${o.stereoSide ? ` (${o.stereoSide})` : ''}`,
                                    )
                                    .join(', ')
                                : 'Internal / Monitor tap'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
