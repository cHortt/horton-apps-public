import { useMemo, useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import type { HardwareNode, RigDocument, RigZone, TrunkProtocol } from '../../schema/rig';
import {
  PROTOCOL_META,
  buildNodeTopologySummary,
  formatGain,
  resolveBusName,
  resolveChannelName,
  resolveNodeName,
  resolveNodePosition,
  resolveNodeZone,
  resolveTrunkCableTag,
  resolveTrunkName,
  type NodeTopologySummary,
} from '../../schema/helpers';

interface PrintViewProps {
  rig: RigDocument;
  onBack: () => void;
}

const PRINT_ZONE_COLOR: Record<RigZone, string> = {
  Stage: '#059669',
  'Stage Rack': '#0284c7',
  'FOH Booth': '#4f46e5',
  'Amp Vault': '#b45309',
  Broadcast: '#e11d48',
  Custom: '#475569',
};

function truncateSvgText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

function chamferPoints(x: number, y: number, w: number, h: number, cut = 14): string {
  return `${x},${y} ${x + w - cut},${y} ${x + w},${y + cut} ${x + w},${y + h} ${x},${y + h}`;
}

function SchematicSvg({ rig, monochrome }: { rig: RigDocument; monochrome: boolean }) {
  const PAD = 56;
  const ROW_H = 19;
  const ROW_GAP = 4;

  const { viewBox, nodeBoxes } = useMemo(() => {
    const boxes = rig.nodes.map((node) => {
      const pos = resolveNodePosition(rig, node);
      const summary: NodeTopologySummary = buildNodeTopologySummary(rig, node);
      const w = summary.role === 'hub' ? 274 : 248;
      const rowCount = Math.max(1, summary.rows.length);
      const wellsHeight = rowCount * ROW_H + Math.max(0, rowCount - 1) * ROW_GAP + 14;
      const h = 68 + wellsHeight + 22;
      return { node, summary, x: pos.x, y: pos.y, w, h };
    });

    if (boxes.length === 0) {
      return { viewBox: '0 0 1000 560', nodeBoxes: [] };
    }

    const minX = Math.min(...boxes.map((b) => b.x)) - PAD;
    const minY = Math.min(...boxes.map((b) => b.y)) - PAD;
    const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + PAD;
    const maxY = Math.max(...boxes.map((b) => b.y + b.h)) + PAD;

    return {
      viewBox: `${minX} ${minY} ${Math.max(820, maxX - minX)} ${Math.max(440, maxY - minY)}`,
      nodeBoxes: boxes,
    };
  }, [rig]);

  const boxMap = useMemo(
    () => new Map(nodeBoxes.map((b) => [b.node.id, b])),
    [nodeBoxes],
  );

  const isDashedInMono = (protocol: TrunkProtocol) =>
    protocol === 'analog-xlr' || protocol === 'analog-trs';

  return (
    <svg
      viewBox={viewBox}
      className="w-full h-auto max-h-[5.75in] border border-slate-900 bg-white"
      role="img"
      aria-label={`${rig.name} system block diagram`}
    >
      {/* Subtle Broadcast Patchbay hairline grid */}
      <defs>
        <pattern id="print-grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path
            d="M 28 0 L 0 0 0 28"
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="0.6"
          />
        </pattern>
      </defs>
      <rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#print-grid)" />

      {/* Trunks (orthogonal Broadcast Patchbay runs behind nodes) */}
      {rig.trunks.map((trunk) => {
        const src = boxMap.get(trunk.sourceNodeId);
        const tgt = boxMap.get(trunk.targetNodeId);
        if (!src || !tgt) return null;

        const proto = PROTOCOL_META[trunk.protocol];
        const strokeColor = monochrome
          ? isDashedInMono(trunk.protocol)
            ? '#475569'
            : '#0f172a'
          : proto.color;

        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const isVertical = Math.abs(dy) > Math.abs(dx) * 1.15 && Math.abs(dy) > 90;

        let x1: number;
        let y1: number;
        let x2: number;
        let y2: number;
        let pathD: string;
        let srcStampX: number;
        let srcStampY: number;
        let tgtStampX: number;
        let tgtStampY: number;

        if (isVertical) {
          x1 = src.x + src.w / 2;
          x2 = tgt.x + tgt.w / 2;
          if (dy > 0) {
            y1 = src.y + src.h;
            y2 = tgt.y;
            srcStampX = x1;
            srcStampY = y1 + 12;
            tgtStampX = x2;
            tgtStampY = y2 - 12;
          } else {
            y1 = src.y;
            y2 = tgt.y + tgt.h;
            srcStampX = x1;
            srcStampY = y1 - 12;
            tgtStampX = x2;
            tgtStampY = y2 + 12;
          }
          const midY = (y1 + y2) / 2;
          pathD = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
        } else if (dx < -40) {
          x1 = src.x;
          y1 = src.y + src.h / 2;
          x2 = tgt.x + tgt.w;
          y2 = tgt.y + tgt.h / 2;
          const midX = (x1 + x2) / 2;
          pathD = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
          srcStampX = x1 - 16;
          srcStampY = y1;
          tgtStampX = x2 + 16;
          tgtStampY = y2;
        } else {
          x1 = src.x + src.w;
          y1 = src.y + src.h / 2;
          x2 = tgt.x;
          y2 = tgt.y + tgt.h / 2;
          const midX = (x1 + x2) / 2;
          pathD = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
          srcStampX = x1 + 16;
          srcStampY = y1;
          tgtStampX = x2 - 16;
          tgtStampY = y2;
        }

        const labelX = (x1 + x2) / 2;
        const labelY = (y1 + y2) / 2;
        const tag = resolveTrunkCableTag(rig, trunk);
        const countText =
          trunk.returnChannels.length > 0
            ? `${trunk.channels.length} ⇄ ${trunk.returnChannels.length}`
            : `${trunk.channels.length} ch →`;
        const protoLabel = proto.shortLabel;
        const leftW = Math.max(36, protoLabel.length * 6.4 + 10);
        const rightW = Math.max(46, countText.length * 5.8 + 12);
        const totalW = Math.max(leftW + rightW, tag ? tag.length * 5.4 + 14 : 0);
        const adjRightW = totalW - leftW;
        const calloutH = tag ? 32 : 19;
        const topY = labelY - calloutH / 2;
        const leftX = labelX - totalW / 2;

        const spanDist = Math.hypot(x2 - x1, y2 - y1);
        const showStamps = spanDist >= 92;
        const srcStampW = Math.max(16, trunk.sourcePortGroup.length * 5.8 + 8);
        const tgtStampW = Math.max(16, trunk.targetPortGroup.length * 5.8 + 8);

        return (
          <g key={trunk.id}>
            <path
              d={pathD}
              fill="none"
              stroke={strokeColor}
              strokeWidth={2.2}
              strokeDasharray={monochrome && isDashedInMono(trunk.protocol) ? '6 3.5' : undefined}
            />

            {/* Port Endpoint Stamps */}
            {showStamps && (
              <>
                <rect
                  x={srcStampX - srcStampW / 2}
                  y={srcStampY - 7}
                  width={srcStampW}
                  height={14}
                  fill="#ffffff"
                  stroke={strokeColor}
                  strokeWidth={1}
                />
                <text
                  x={srcStampX}
                  y={srcStampY + 3}
                  textAnchor="middle"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize={8}
                  fontWeight={700}
                  fill={strokeColor}
                >
                  {trunk.sourcePortGroup}
                </text>

                <rect
                  x={tgtStampX - tgtStampW / 2}
                  y={tgtStampY - 7}
                  width={tgtStampW}
                  height={14}
                  fill="#ffffff"
                  stroke={strokeColor}
                  strokeWidth={1}
                />
                <text
                  x={tgtStampX}
                  y={tgtStampY + 3}
                  textAnchor="middle"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize={8}
                  fontWeight={700}
                  fill={strokeColor}
                >
                  {trunk.targetPortGroup}
                </text>
              </>
            )}

            {/* Split Two-Tone Broadcast Patchbay Trunk Callout */}
            <rect
              x={leftX}
              y={topY}
              width={totalW}
              height={calloutH}
              fill="#ffffff"
              stroke={strokeColor}
              strokeWidth={1.15}
            />
            <rect x={leftX} y={topY} width={leftW} height={19} fill={strokeColor} />
            <text
              x={leftX + leftW / 2}
              y={topY + 12.5}
              textAnchor="middle"
              fontFamily="JetBrains Mono, monospace"
              fontSize={8.5}
              fontWeight={700}
              fill="#ffffff"
            >
              {protoLabel}
            </text>
            <text
              x={leftX + leftW + adjRightW / 2}
              y={topY + 12.5}
              textAnchor="middle"
              fontFamily="JetBrains Mono, monospace"
              fontSize={8.8}
              fontWeight={600}
              fill="#0f172a"
            >
              {countText}
            </text>
            {tag && (
              <>
                <line
                  x1={leftX}
                  y1={topY + 19}
                  x2={leftX + totalW}
                  y2={topY + 19}
                  stroke="#cbd5e1"
                  strokeWidth={0.8}
                />
                <rect x={leftX + 0.5} y={topY + 19.5} width={totalW - 1} height={12} fill="#f8fafc" />
                <text
                  x={labelX}
                  y={topY + 28.5}
                  textAnchor="middle"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize={7.8}
                  fontWeight={500}
                  fill="#475569"
                >
                  {truncateSvgText(tag, 22)}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* Hardware Nodes (Chamfered Broadcast Patchbay × Role-Adaptive) */}
      {nodeBoxes.map(({ node, summary, x, y, w, h }) => {
        const name = resolveNodeName(rig, node);
        const zone = resolveNodeZone(rig, node);
        const isHub = summary.role === 'hub';
        const zoneColor = monochrome ? '#0f172a' : PRINT_ZONE_COLOR[zone];
        const statusColor = monochrome
          ? '#0f172a'
          : summary.statusTone === 'sky'
            ? '#0284c7'
            : summary.statusTone === 'indigo'
              ? '#4f46e5'
              : summary.statusTone === 'rose'
                ? '#be123c'
                : summary.statusTone === 'amber'
                  ? '#b45309'
                  : '#475569';

        const wellsTop = y + 68;
        const footerTop = y + h - 22;
        const wellsH = footerTop - wellsTop;
        const rowsToRender = summary.rows.length > 0 ? summary.rows : [];

        return (
          <g key={node.id}>
            {/* Outer chamfered polygon */}
            <polygon
              points={chamferPoints(x, y, w, h, 14)}
              fill="#ffffff"
              stroke={isHub ? '#0f172a' : '#64748b'}
              strokeWidth={isHub ? 1.8 : 1.2}
            />

            {/* Top metadata rail */}
            <rect x={x + 10} y={y + 8.5} width={6} height={6} fill={zoneColor} />
            <text
              x={x + 21}
              y={y + 14.5}
              fontFamily="Barlow Semi Condensed, Barlow, sans-serif"
              fontSize={9.5}
              fontWeight={700}
              fill="#475569"
              letterSpacing="0.06em"
            >
              {zone.toUpperCase()}
            </text>
            <text
              x={x + w - 18}
              y={y + 14.5}
              textAnchor="end"
              fontFamily="JetBrains Mono, monospace"
              fontSize={8.5}
              fontWeight={700}
              fill={statusColor}
            >
              {truncateSvgText(summary.statusText, 16)}
            </text>
            <line x1={x} y1={y + 22} x2={x + w} y2={y + 22} stroke="#e2e8f0" strokeWidth={1} />

            {/* Device Identity */}
            <text
              x={x + 10}
              y={y + 42}
              fontFamily="Barlow Semi Condensed, Barlow, sans-serif"
              fontSize={14}
              fontWeight={700}
              fill="#0f172a"
            >
              {truncateSvgText(name, isHub ? 30 : 26)}
            </text>
            <text
              x={x + 10}
              y={y + 57}
              fontFamily="Barlow, sans-serif"
              fontSize={9.8}
              fontWeight={500}
              fill="#64748b"
            >
              {truncateSvgText(summary.subtitle, isHub ? 38 : 34)}
            </text>

            {/* Recessed Terminal / Feed Wells */}
            <rect x={x + 1} y={wellsTop} width={w - 2} height={wellsH} fill="#f8fafc" />
            <line x1={x} y1={wellsTop} x2={x + w} y2={wellsTop} stroke="#e2e8f0" strokeWidth={1} />

            {rowsToRender.length > 0 ? (
              rowsToRender.map((row, idx) => {
                const ry = wellsTop + 7 + idx * (ROW_H + ROW_GAP);
                const rowAccent = monochrome ? '#0f172a' : PROTOCOL_META[row.protocol].color;
                return (
                  <g key={`${node.id}-print-row-${idx}`}>
                    <rect
                      x={x + 8}
                      y={ry}
                      width={w - 16}
                      height={ROW_H}
                      fill="#ffffff"
                      stroke="#cbd5e1"
                      strokeWidth={0.85}
                    />
                    <rect x={x + 8} y={ry} width={3} height={ROW_H} fill={rowAccent} />
                    <text
                      x={x + 16}
                      y={ry + 12.8}
                      fontFamily="JetBrains Mono, monospace"
                      fontSize={8.8}
                      fontWeight={700}
                      fill="#0f172a"
                    >
                      {truncateSvgText(row.left, 12)}
                    </text>
                    <text
                      x={x + w - 14}
                      y={ry + 12.8}
                      textAnchor="end"
                      fontFamily="JetBrains Mono, monospace"
                      fontSize={8.6}
                      fontWeight={500}
                      fill="#475569"
                    >
                      {truncateSvgText(row.right, isHub ? 24 : 20)}
                    </text>
                  </g>
                );
              })
            ) : (
              <text
                x={x + 10}
                y={wellsTop + 18}
                fontFamily="JetBrains Mono, monospace"
                fontSize={8.5}
                fill="#94a3b8"
              >
                No channels patched
              </text>
            )}

            {/* Footer: 1-line Operational Note + Binder Section Reference */}
            <line x1={x} y1={footerTop} x2={x + w} y2={footerTop} stroke="#e2e8f0" strokeWidth={1} />
            <text
              x={x + 10}
              y={footerTop + 14}
              fontFamily="JetBrains Mono, monospace"
              fontSize={8}
              fill="#64748b"
            >
              {truncateSvgText(summary.noteLine ?? node.model, isHub ? 34 : 28)}
            </text>
            <text
              x={x + w - 10}
              y={footerTop + 14}
              textAnchor="end"
              fontFamily="JetBrains Mono, monospace"
              fontSize={8.5}
              fontWeight={700}
              fill={zoneColor}
            >
              {summary.sheetRef}
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
  const [printColorMode, setPrintColorMode] = useState<'color' | 'bw'>('color');

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

  const isMono = printColorMode === 'bw';

  return (
    <div className="min-h-full bg-[#f3f5f8] dark:bg-[#090d14] pb-12 print:bg-white print:pb-0">
      {/* On-screen Print Preview Control Bar */}
      <div className="no-print sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 dark:border-slate-800 bg-white dark:bg-[#111827] px-5 py-3 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Interactive Schematic
          </button>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Page 1: Landscape Block Diagram · Pages 2+: Portrait Binder Patch Sheets
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Color vs B&W Print Palette Toggle */}
          <div className="inline-flex rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 p-0.5 font-mono text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setPrintColorMode('color')}
              className={`px-2 py-0.5 cursor-pointer transition-colors ${
                !isMono
                  ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Color
            </button>
            <button
              type="button"
              onClick={() => setPrintColorMode('bw')}
              className={`px-2 py-0.5 cursor-pointer transition-colors ${
                isMono
                  ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              B&amp;W
            </button>
          </div>

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
            className="inline-flex items-center gap-1.5 rounded-[2px] bg-slate-900 dark:bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-sky-400 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* PAGE 1: LANDSCAPE SYSTEM BLOCK DIAGRAM */}
      <section className="print-page-landscape mx-auto mt-6 max-w-[10.4in] border border-slate-400 dark:border-slate-700 bg-white text-slate-900 p-6 shadow-xs">
        <div className="flex items-end justify-between border-b-2 border-slate-900 pb-3 mb-4">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Page 1 · System Block Diagram (Landscape) · §1 Stage Inputs · §2 Trunks · §3 Local I/O · §4 Monitors &amp; PA
            </div>
            <h1 className="font-display text-2xl font-bold text-slate-900 leading-tight">{rig.name}</h1>
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

        <SchematicSvg rig={rig} monochrome={isMono} />

        {/* Protocol Legend Footer */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-2.5 text-[10.5px] text-slate-600">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono font-bold uppercase tracking-wider text-slate-500">Protocol Key:</span>
            {usedProtocols.map((p) => {
              const dashed = isMono && (p === 'analog-xlr' || p === 'analog-trs');
              const swatchColor = isMono ? (dashed ? '#475569' : '#0f172a') : PROTOCOL_META[p].color;
              return (
                <span key={p} className="inline-flex items-center gap-1.5 font-mono">
                  <span
                    style={
                      dashed
                        ? { borderTop: `2px dashed ${swatchColor}` }
                        : { backgroundColor: swatchColor }
                    }
                    className="inline-block h-1.5 w-4"
                  />
                  {PROTOCOL_META[p].label}
                </span>
              );
            })}
          </div>
          <div className="font-mono text-[10px] text-slate-500">
            WING Rig Visualizer · Binder Reference Sheet
          </div>
        </div>
      </section>

      {/* PAGES 2+: PORTRAIT BINDER-READY PATCH TABLES */}
      <section className="print-page-portrait mx-auto mt-6 max-w-[8.1in] border border-slate-400 dark:border-slate-700 bg-white text-slate-900 p-6 shadow-xs space-y-6">
        <div className="flex items-end justify-between border-b-2 border-slate-900 pb-2.5">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Pages 2+ · Binder Patch Tables (Portrait)
            </div>
            <h2 className="font-display text-xl font-bold text-slate-900">{rig.name} — Patch Sheets</h2>
          </div>
          <div className="font-mono text-[10.5px] text-slate-500">{printedDate}</div>
        </div>

        {/* 1. Stage Inputs */}
        {includeStageInputs && stageInputGroups.length > 0 && (
          <div className="print-section">
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-2">
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
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-2">
              2. Digital & Analog Signal Trunks (Forward & Return)
            </h3>
            <div className="space-y-4">
              {rig.trunks.map((trunk) => {
                const src = rig.nodes.find((n) => n.id === trunk.sourceNodeId);
                const tgt = rig.nodes.find((n) => n.id === trunk.targetNodeId);
                const cableTag = resolveTrunkCableTag(rig, trunk);
                const trunkNotes = rig.annotations.trunks[trunk.id]?.notes;
                return (
                  <div key={trunk.id} className="border border-slate-300 rounded-[2px] p-2.5">
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
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-2">
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
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-300 pb-1 mb-2">
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
