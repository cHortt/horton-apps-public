import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  FileUp,
  Lock,
  Plus,
  Radio,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import type { ChannelMode, MixBusKind, PortGroupCode, RigDocument } from '../../schema/rig';
import {
  WING_COLORS,
  type ConsoleBaselineMeta,
  type ConsoleLinkConfig,
  type StagedPatchEntry,
} from '../../schema/patch';
import { resolveNodeName } from '../../schema/helpers';
import {
  buildDualSourcePatches,
  buildReturnOutputPatches,
  getStereoPartnerSlot,
} from '../../parser/snapPatcher';

interface SourceReturnWizardProps {
  rig: RigDocument;
  linkConfig: ConsoleLinkConfig;
  baselines: Record<string, ConsoleBaselineMeta>;
  patchUnlocked: boolean;
  onUnlockPatching: () => void;
  onStagePatches: (entries: StagedPatchEntry[]) => void;
  onOpenSnapImport: (targetConsoleId?: string) => void;
  onJumpToMatrix: () => void;
}

const INPUT_BANKS: Array<{ code: PortGroupCode; label: string }> = [
  { code: 'A', label: 'AES50-A (Stage Box)' },
  { code: 'LCL', label: 'Local Rack Preamps (LCL)' },
  { code: 'B', label: 'AES50-B' },
  { code: 'C', label: 'AES50-C' },
  { code: 'AUX', label: 'Aux Inputs (TRS)' },
  { code: 'SC', label: 'StageCONNECT (SC)' },
  { code: 'USB', label: 'USB Audio' },
  { code: 'CRD', label: 'WING-LIVE / Card' },
  { code: 'MOD', label: 'Expansion Module (Dante)' },
];

const OUTPUT_BANKS: Array<{ code: PortGroupCode; label: string }> = [
  { code: 'A', label: 'AES50-A (Stage Box Out)' },
  { code: 'C', label: 'AES50-C (Inter-Console)' },
  { code: 'LCL', label: 'Local XLR Out (LCL)' },
  { code: 'AUX', label: 'Aux Out (TRS)' },
  { code: 'B', label: 'AES50-B Out' },
  { code: 'SC', label: 'StageCONNECT Out' },
  { code: 'MOD', label: 'Expansion Module Out' },
  { code: 'USB', label: 'USB Out' },
];

export function SourceReturnWizard({
  rig,
  linkConfig,
  baselines,
  patchUnlocked,
  onUnlockPatching,
  onStagePatches,
  onOpenSnapImport,
  onJumpToMatrix,
}: SourceReturnWizardProps) {
  const [wizardMode, setWizardMode] = useState<'forward' | 'return'>('forward');

  const consoles = useMemo(() => rig.nodes.filter((n) => n.kind === 'console'), [rig.nodes]);
  const stageNode = consoles.find((c) => c.id === linkConfig.stageConsoleId);
  const fohNode = linkConfig.fohConsoleId
    ? consoles.find((c) => c.id === linkConfig.fohConsoleId)
    : undefined;

  const hasStageBaseline = Boolean(stageNode && baselines[stageNode.id]);
  const hasFohBaseline = Boolean(fohNode && baselines[fohNode.id]);
  const stageOwnsHeadamp = linkConfig.headampOwnerConsoleId === linkConfig.stageConsoleId;

  // Compute occupied slots for helpful collision warnings
  const occupiedStageStrips = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of stageNode?.channelStrips ?? []) {
      if (s.sourceGroup !== 'OFF') {
        map.set(`${s.kind}:${s.index}`, `${s.resolvedName} (${s.sourceGroup}.${s.sourceSlot})`);
      }
    }
    return map;
  }, [stageNode]);

  const occupiedFohStrips = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of fohNode?.channelStrips ?? []) {
      if (s.sourceGroup !== 'OFF') {
        map.set(`${s.kind}:${s.index}`, `${s.resolvedName} (${s.sourceGroup}.${s.sourceSlot})`);
      }
    }
    return map;
  }, [fohNode]);

  const occupiedSplitSlots = useMemo(() => {
    const map = new Map<number, string>();
    const pg = stageNode?.portGroups.find(
      (g) => g.code === linkConfig.stageSplitPort && g.direction === 'output',
    );
    for (const ch of pg?.channels ?? []) {
      map.set(ch.slot, ch.rawName);
    }
    return map;
  }, [stageNode, linkConfig.stageSplitPort]);

  const nextFreeSplitSlot = useMemo(() => {
    for (let i = 1; i <= 48; i++) {
      if (!occupiedSplitSlots.has(i)) return i;
    }
    return 24;
  }, [occupiedSplitSlots]);

  // --- Forward Source Form State ---
  const [sourceName, setSourceName] = useState('New Stage Source');
  const [inputGroup, setInputGroup] = useState<PortGroupCode>('A');
  const [inputSlot, setInputSlot] = useState<number>(24);
  const [mode, setMode] = useState<ChannelMode>('M');
  const [gainDb, setGainDb] = useState<number>(18);
  const [phantom48v, setPhantom48v] = useState<boolean>(false);
  const [colorIndex, setColorIndex] = useState<number>(14);
  const [tags, setTags] = useState<string>('');

  const [stageStripKind, setStageStripKind] = useState<'ch' | 'aux'>('ch');
  const [stageStripIndex, setStageStripIndex] = useState<number>(28);
  const [stageStripClink, setStageStripClink] = useState<boolean>(true);
  const [stageStripOverrideName, setStageStripOverrideName] = useState<string>('');
  const [stageBusSends, setStageBusSends] = useState<number[]>([]);
  const [stageMainSends, setStageMainSends] = useState<number[]>([1]);

  const [splitToFoh, setSplitToFoh] = useState<boolean>(Boolean(fohNode));
  const [splitSlot, setSplitSlot] = useState<number>(nextFreeSplitSlot);

  const [fohStripKind, setFohStripKind] = useState<'ch' | 'aux'>('ch');
  const [fohStripIndex, setFohStripIndex] = useState<number>(28);
  const [fohStripClink, setFohStripClink] = useState<boolean>(true);
  const [fohStripOverrideName, setFohStripOverrideName] = useState<string>('');
  const [fohMainSends, setFohMainSends] = useState<number[]>([1]);

  // --- Return / Bus Output Form State ---
  const [originConsoleId, setOriginConsoleId] = useState<string>(
    fohNode?.id ?? stageNode?.id ?? '',
  );
  const [busKind, setBusKind] = useState<MixBusKind>('mtx');
  const [busIndex, setBusIndex] = useState<number>(1);
  const [busName, setBusName] = useState<string>('Sub / Fill Feed');
  const [busMono, setBusMono] = useState<boolean>(true);
  const [busColorIndex, setBusColorIndex] = useState<number>(8);
  const [monitorSourceRef, setMonitorSourceRef] = useState<string>('BUS.7');
  const [originOutGroup, setOriginOutGroup] = useState<PortGroupCode>('C');
  const [originOutSlot, setOriginOutSlot] = useState<number>(48);
  const [stereoOutput, setStereoOutput] = useState<boolean>(false);
  const [enableRelay, setEnableRelay] = useState<boolean>(Boolean(fohNode && stageNode));
  const [relayOutGroup, setRelayOutGroup] = useState<PortGroupCode>('A');
  const [relayOutSlot, setRelayOutSlot] = useState<number>(16);

  const forwardPreviewPatches = useMemo(() => {
    if (!stageNode) return [];
    return buildDualSourcePatches({
      stageConsoleId: stageNode.id,
      fohConsoleId: fohNode?.id,
      headampOwnerConsoleId: linkConfig.headampOwnerConsoleId,
      stageSplitPort: linkConfig.stageSplitPort,
      fohReceivePort: linkConfig.fohReceivePort,
      hasStageBaseline: true, // Preview shows full JSON paths even before upload
      hasFohBaseline: Boolean(fohNode),
      sourceName,
      inputGroup,
      inputSlot,
      mode,
      gainDb,
      phantom48v,
      colorIndex,
      tags: tags.trim() || undefined,
      stageStripKind,
      stageStripIndex,
      stageStripClink,
      stageStripOverrideName,
      stageBusSendIds: stageBusSends,
      stageMainSendIds: stageMainSends,
      splitToFoh,
      splitSlot,
      fohStripKind,
      fohStripIndex,
      fohStripClink,
      fohStripOverrideName,
      fohBusSendIds: [],
      fohMainSendIds: fohMainSends,
    });
  }, [
    stageNode,
    fohNode,
    linkConfig,
    sourceName,
    inputGroup,
    inputSlot,
    mode,
    gainDb,
    phantom48v,
    colorIndex,
    tags,
    stageStripKind,
    stageStripIndex,
    stageStripClink,
    stageStripOverrideName,
    stageBusSends,
    stageMainSends,
    splitToFoh,
    splitSlot,
    fohStripKind,
    fohStripIndex,
    fohStripClink,
    fohStripOverrideName,
    fohMainSends,
  ]);

  const forwardGuardrails = useMemo(() => {
    const warnings: Array<{ level: 'error' | 'warn'; text: string }> = [];
    const stageStripOccupant =
      stageStripIndex > 0 ? occupiedStageStrips.get(`${stageStripKind}:${stageStripIndex}`) : undefined;
    if (stageStripOccupant) {
      warnings.push({
        level: 'warn',
        text: `Stage ${stageStripKind.toUpperCase()} ${stageStripIndex} is already patched to ${stageStripOccupant} — staging will reassign it.`,
      });
    }
    if (splitToFoh) {
      const splitOcc = occupiedSplitSlots.get(splitSlot);
      if (splitOcc) {
        warnings.push({
          level: 'warn',
          text: `Inter-console Out ${linkConfig.stageSplitPort}.${splitSlot} currently carries "${splitOcc}".`,
        });
      }
      if (mode === 'ST') {
        const partner = getStereoPartnerSlot(splitSlot);
        const partnerOcc = occupiedSplitSlots.get(partner);
        if (partnerOcc) {
          warnings.push({
            level: 'warn',
            text: `Stereo partner Out ${linkConfig.stageSplitPort}.${partner} currently carries "${partnerOcc}".`,
          });
        }
      }
    } else if (fohNode && fohStripIndex > 0) {
      warnings.push({
        level: 'error',
        text: `FOH ${fohStripKind.toUpperCase()} ${fohStripIndex} is selected, but Stage → FOH split pass-through is disabled (FOH will receive silence).`,
      });
    }
    if (fohNode && fohStripIndex > 0) {
      const fohOcc = occupiedFohStrips.get(`${fohStripKind}:${fohStripIndex}`);
      if (fohOcc) {
        warnings.push({
          level: 'warn',
          text: `FOH ${fohStripKind.toUpperCase()} ${fohStripIndex} is currently assigned to ${fohOcc}.`,
        });
      }
    }
    if (phantom48v) {
      warnings.push({
        level: 'warn',
        text: `+48V phantom power will be enabled on ${inputGroup}.${inputSlot}${mode === 'ST' ? `–${getStereoPartnerSlot(inputSlot)}` : ''} (Headamp Owner only).`,
      });
    }
    return warnings;
  }, [
    occupiedStageStrips,
    occupiedFohStrips,
    occupiedSplitSlots,
    stageStripKind,
    stageStripIndex,
    splitToFoh,
    splitSlot,
    mode,
    linkConfig.stageSplitPort,
    fohNode,
    fohStripKind,
    fohStripIndex,
    phantom48v,
    inputGroup,
    inputSlot,
  ]);

  const relayConsole = consoles.find((c) => c.id !== originConsoleId);
  const relayReceiveGroup: PortGroupCode =
    originConsoleId === linkConfig.fohConsoleId
      ? linkConfig.stageSplitPort
      : linkConfig.fohReceivePort;

  const returnPreviewPatches = useMemo(() => {
    if (!originConsoleId) return [];
    return buildReturnOutputPatches({
      originConsoleId,
      hasOriginBaseline: true,
      busKind,
      busIndex,
      busName,
      busMono,
      busColorIndex,
      monitorSourceRef: busKind === 'mon' ? monitorSourceRef : undefined,
      originOutGroup,
      originOutSlot,
      stereoOutput,
      relayConsoleId: enableRelay ? relayConsole?.id : undefined,
      hasRelayBaseline: Boolean(enableRelay && relayConsole),
      relayReceiveGroup: enableRelay ? relayReceiveGroup : undefined,
      relayOutGroup: enableRelay ? relayOutGroup : undefined,
      relayOutSlot: enableRelay ? relayOutSlot : undefined,
      relayInputLabel: busName,
    });
  }, [
    originConsoleId,
    busKind,
    busIndex,
    busName,
    busMono,
    busColorIndex,
    monitorSourceRef,
    originOutGroup,
    originOutSlot,
    stereoOutput,
    enableRelay,
    relayConsole,
    relayReceiveGroup,
    relayOutGroup,
    relayOutSlot,
  ]);

  const handleStageForward = () => {
    if (!stageNode || !patchUnlocked) return;
    const entries = buildDualSourcePatches({
      stageConsoleId: stageNode.id,
      fohConsoleId: fohNode?.id,
      headampOwnerConsoleId: linkConfig.headampOwnerConsoleId,
      stageSplitPort: linkConfig.stageSplitPort,
      fohReceivePort: linkConfig.fohReceivePort,
      hasStageBaseline,
      hasFohBaseline,
      sourceName,
      inputGroup,
      inputSlot,
      mode,
      gainDb,
      phantom48v,
      colorIndex,
      tags: tags.trim() || undefined,
      stageStripKind,
      stageStripIndex,
      stageStripClink,
      stageStripOverrideName,
      stageBusSendIds: stageBusSends,
      stageMainSendIds: stageMainSends,
      splitToFoh,
      splitSlot,
      fohStripKind,
      fohStripIndex,
      fohStripClink,
      fohStripOverrideName,
      fohBusSendIds: [],
      fohMainSendIds: fohMainSends,
    });
    if (entries.length > 0) {
      onStagePatches(entries);
      onJumpToMatrix();
    }
  };

  const handleStageReturn = () => {
    if (!originConsoleId || !patchUnlocked) return;
    const entries = buildReturnOutputPatches({
      originConsoleId,
      hasOriginBaseline: Boolean(baselines[originConsoleId]),
      busKind,
      busIndex,
      busName,
      busMono,
      busColorIndex,
      monitorSourceRef: busKind === 'mon' ? monitorSourceRef : undefined,
      originOutGroup,
      originOutSlot,
      stereoOutput,
      relayConsoleId: enableRelay ? relayConsole?.id : undefined,
      hasRelayBaseline: Boolean(enableRelay && relayConsole && baselines[relayConsole.id]),
      relayReceiveGroup: enableRelay ? relayReceiveGroup : undefined,
      relayOutGroup: enableRelay ? relayOutGroup : undefined,
      relayOutSlot: enableRelay ? relayOutSlot : undefined,
      relayInputLabel: busName,
    });
    if (entries.length > 0) {
      onStagePatches(entries);
      onJumpToMatrix();
    }
  };

  const toggleNumber = (list: number[], val: number, setList: (next: number[]) => void) => {
    setList(list.includes(val) ? list.filter((x) => x !== val) : [...list, val].sort((a, b) => a - b));
  };

  const canStageForward = patchUnlocked && (hasStageBaseline || hasFohBaseline);
  const canStageReturn =
    patchUnlocked &&
    (Boolean(baselines[originConsoleId]) ||
      Boolean(enableRelay && relayConsole && baselines[relayConsole.id]));

  return (
    <div className="space-y-4">
      {/* Direction Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
          <button
            type="button"
            onClick={() => setWizardMode('forward')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              wizardMode === 'forward'
                ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            Configure Input Source (Stage → Split → FOH)
          </button>
          <button
            type="button"
            onClick={() => setWizardMode('return')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              wizardMode === 'return'
                ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Configure Bus / Output Return (FOH ↔ Stage)
          </button>
        </div>

        {!patchUnlocked && (
          <button
            type="button"
            onClick={onUnlockPatching}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-950 cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" />
            Unlock Patch Staging to Stage Edits
          </button>
        )}
      </div>

      {wizardMode === 'forward' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Form */}
          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Add / Reconfigure Source Across Consoles
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Atomically writes preamp input, Stage strip, AES50 split pass-through, and FOH receive strip.
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 font-mono text-[10.5px] text-slate-600 dark:text-slate-300">
                <Lock className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                Headamp Owner:{' '}
                {stageNode && linkConfig.headampOwnerConsoleId === stageNode.id
                  ? resolveNodeName(rig, stageNode)
                  : fohNode
                    ? resolveNodeName(rig, fohNode)
                    : 'Primary'}
              </span>
            </div>

            {/* Baseline availability notice */}
            {(!hasStageBaseline || (fohNode && !hasFohBaseline)) && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 dark:border-sky-800/80 bg-sky-50/70 dark:bg-sky-950/40 px-3 py-2 text-xs text-sky-900 dark:text-sky-200">
                <span>
                  {!hasStageBaseline && !hasFohBaseline
                    ? 'Import at least one console .snap baseline to stage lossless patches.'
                    : !hasFohBaseline && fohNode
                      ? `Stage .snap loaded. Upload ${resolveNodeName(rig, fohNode)} .snap to also patch FOH simultaneously.`
                      : `FOH .snap loaded. Upload ${stageNode ? resolveNodeName(rig, stageNode) : 'Stage'} .snap to also patch Stage simultaneously.`}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onOpenSnapImport(!hasStageBaseline ? stageNode?.id : fohNode?.id)
                  }
                  className="inline-flex items-center gap-1 rounded-md bg-sky-600 dark:bg-sky-500 px-2.5 py-1 text-[11px] font-semibold text-white dark:text-slate-950 hover:bg-sky-700 dark:hover:bg-sky-400 cursor-pointer"
                >
                  <FileUp className="w-3 h-3" />
                  Import .snap
                </button>
              </div>
            )}

            {/* Source identity + physical slot */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-5">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Source Name (synced via clink)
                </label>
                <input
                  type="text"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder="e.g. Acoustic Gtr 2"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Physical Input Bank
                </label>
                <select
                  value={inputGroup}
                  onChange={(e) => setInputGroup(e.target.value as PortGroupCode)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  {INPUT_BANKS.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Slot {mode === 'ST' ? `(${inputSlot}–${getStereoPartnerSlot(inputSlot)})` : '(1–48)'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={inputSlot}
                  onChange={(e) => setInputSlot(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Format, Gain, +48V, Color & Tags */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Channel Format
                </label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMode('M')}
                    className={`flex-1 rounded-md border py-1 font-mono text-xs font-semibold cursor-pointer ${
                      mode === 'M'
                        ? 'border-slate-900 bg-slate-900 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-slate-950'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Mono (M)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('ST')}
                    className={`flex-1 rounded-md border py-1 font-mono text-xs font-semibold cursor-pointer ${
                      mode === 'ST'
                        ? 'border-slate-900 bg-slate-900 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-slate-950'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Stereo (ST)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Preamp Gain:{' '}
                  <span className="font-mono text-slate-900 dark:text-slate-100">
                    {gainDb >= 0 ? `+${gainDb}` : gainDb} dB
                  </span>
                </label>
                <input
                  type="range"
                  min={-6}
                  max={45}
                  step={0.5}
                  value={gainDb}
                  onChange={(e) => setGainDb(Number(e.target.value))}
                  className="w-full mt-1.5 accent-sky-600 dark:accent-sky-400"
                />
              </div>

              <div className="flex flex-col justify-between">
                <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Phantom Power
                </span>
                <label className="inline-flex items-center gap-2 py-1 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={phantom48v}
                    onChange={(e) => setPhantom48v(e.target.checked)}
                    className="h-4 w-4 accent-rose-600"
                  />
                  <span className="inline-flex items-center gap-1 font-mono text-rose-700 dark:text-rose-300">
                    <Zap className="w-3.5 h-3.5" />
                    +48V
                  </span>
                </label>
              </div>
            </div>

            {/* Color & Tags */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-8">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  WING Scribble Strip Color
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {WING_COLORS.slice(0, 12).map((c) => (
                    <button
                      key={c.index}
                      type="button"
                      title={`${c.index}: ${c.name}`}
                      onClick={() => setColorIndex(c.index)}
                      style={{ backgroundColor: c.hex }}
                      className={`h-5 w-5 rounded-md cursor-pointer transition-transform ${
                        colorIndex === c.index
                          ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white dark:ring-offset-slate-900 scale-110'
                          : 'opacity-80 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div className="sm:col-span-4">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  WING Tags (optional)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="#BAND,#VOX"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>
            </div>

            {/* 3-Column Console Routing Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Stage Strip */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    1. Stage Strip
                  </span>
                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                    {hasStageBaseline ? '.snap ready' : 'no .snap'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={stageStripKind}
                    onChange={(e) => setStageStripKind(e.target.value as 'ch' | 'aux')}
                    className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 font-mono text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="ch">CH</option>
                    <option value="aux">AUX</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={stageStripKind === 'ch' ? 40 : 8}
                    value={stageStripIndex}
                    onChange={(e) => setStageStripIndex(Math.max(0, Number(e.target.value) || 0))}
                    title="0 = do not patch a Stage channel strip"
                    className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stageStripClink}
                    onChange={(e) => setStageStripClink(e.target.checked)}
                  />
                  Inherit source name (clink)
                </label>
                {!stageStripClink && (
                  <input
                    type="text"
                    value={stageStripOverrideName}
                    onChange={(e) => setStageStripOverrideName(e.target.value)}
                    placeholder="Stage strip override name"
                    className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                  />
                )}
                <div>
                  <div className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">
                    Enable Stage Bus Sends
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => toggleNumber(stageBusSends, b, setStageBusSends)}
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold cursor-pointer ${
                          stageBusSends.includes(b)
                            ? 'bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        B{b}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stageMainSends.includes(1)}
                    onChange={() => toggleNumber(stageMainSends, 1, setStageMainSends)}
                  />
                  Send to Main 1
                </label>
              </div>

              {/* Inter-Console Split */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2.5">
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  2. {linkConfig.stageSplitPort} → {linkConfig.fohReceivePort} Split
                </div>
                <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={splitToFoh}
                    onChange={(e) => setSplitToFoh(e.target.checked)}
                  />
                  Pass-through to FOH
                </label>
                {splitToFoh && (
                  <>
                    <div>
                      <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">
                        Split Out Slot ({linkConfig.stageSplitPort}.
                        {mode === 'ST' ? `${splitSlot}–${getStereoPartnerSlot(splitSlot)}` : splitSlot})
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={48}
                        value={splitSlot}
                        onChange={(e) => setSplitSlot(Math.max(1, Number(e.target.value) || 1))}
                        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-mono text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setSplitSlot(nextFreeSplitSlot)}
                      className="text-[11px] font-medium text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                    >
                      Use next free slot ({linkConfig.stageSplitPort}.{nextFreeSplitSlot})
                    </button>
                  </>
                )}
              </div>

              {/* FOH Strip */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    3. FOH Strip
                  </span>
                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                    {!fohNode ? 'single console' : hasFohBaseline ? '.snap ready' : 'no .snap'}
                  </span>
                </div>
                {fohNode ? (
                  <>
                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        value={fohStripKind}
                        onChange={(e) => setFohStripKind(e.target.value as 'ch' | 'aux')}
                        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 font-mono text-xs text-slate-900 dark:text-slate-100"
                      >
                        <option value="ch">CH</option>
                        <option value="aux">AUX</option>
                      </select>
                      <input
                        type="number"
                        min={0}
                        max={fohStripKind === 'ch' ? 40 : 8}
                        value={fohStripIndex}
                        onChange={(e) => setFohStripIndex(Math.max(0, Number(e.target.value) || 0))}
                        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-mono text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={fohStripClink}
                        onChange={(e) => setFohStripClink(e.target.checked)}
                      />
                      Inherit label (clink)
                    </label>
                    {!fohStripClink && (
                      <input
                        type="text"
                        value={fohStripOverrideName}
                        onChange={(e) => setFohStripOverrideName(e.target.value)}
                        placeholder="FOH strip override name"
                        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                      />
                    )}
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={fohMainSends.includes(1)}
                        onChange={() => toggleNumber(fohMainSends, 1, setFohMainSends)}
                      />
                      Route to FOH Main L/R
                    </label>
                    {stageOwnsHeadamp && (
                      <div className="rounded bg-slate-200/70 dark:bg-slate-900/70 px-2 py-1 text-[10px] font-mono text-slate-600 dark:text-slate-400">
                        Gain/+48V locked (Trim only)
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Single-console rig detected. Add or import a second WING console to enable dual-console patching.
                  </p>
                )}
              </div>
            </div>

            {/* Guardrails Banner */}
            {forwardGuardrails.length > 0 ? (
              <div className="rounded-lg border border-amber-300 dark:border-amber-700/80 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 space-y-1">
                {forwardGuardrails.map((g, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-1.5 text-xs ${
                      g.level === 'error'
                        ? 'text-rose-700 dark:text-rose-300 font-semibold'
                        : 'text-amber-900 dark:text-amber-200'
                    }`}
                  >
                    {g.level === 'error' ? (
                      <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    )}
                    <span>{g.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/40 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>No slot collisions detected across Stage, split trunk, or FOH.</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Staged edits update the Schematic &amp; Click-to-Trace immediately.
              </span>
              <button
                type="button"
                disabled={!canStageForward}
                onClick={handleStageForward}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 dark:bg-sky-500 px-4 py-2 text-xs font-semibold text-white dark:text-slate-950 hover:bg-sky-700 dark:hover:bg-sky-400 disabled:opacity-40 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Stage Source Patch
              </button>
            </div>
          </div>

          {/* Right Live Path Preview */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Live End-to-End Signal Preview
                </h3>
                <span className="font-mono text-[10.5px] font-semibold text-sky-700 dark:text-sky-400">
                  {forwardPreviewPatches.length} patch ops
                </span>
              </div>

              <div className="space-y-2">
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/60 dark:bg-emerald-950/30 p-2.5 text-xs">
                  <div className="font-mono text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400">
                    1 · Physical Source ({inputGroup}.{inputSlot}
                    {mode === 'ST' ? `–${getStereoPartnerSlot(inputSlot)}` : ''})
                  </div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {sourceName || 'Unnamed'} · {mode} · {gainDb >= 0 ? `+${gainDb}` : gainDb} dB
                    {phantom48v ? ' · +48V' : ''}
                  </div>
                </div>

                {stageStripIndex > 0 && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-2.5 text-xs">
                    <div className="font-mono text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                      2 · {stageNode ? resolveNodeName(rig, stageNode) : 'Stage WING'}
                    </div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      {stageStripKind.toUpperCase()} {stageStripIndex} ← {inputGroup}.{inputSlot}
                      {stageBusSends.length > 0 ? ` → Buses ${stageBusSends.join(', ')}` : ''}
                    </div>
                  </div>
                )}

                {splitToFoh && (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800/80 bg-amber-50/60 dark:bg-amber-950/30 p-2.5 text-xs">
                    <div className="font-mono text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400">
                      3 · Direct Pass-Through Split
                    </div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      Out {linkConfig.stageSplitPort}.{splitSlot}
                      {mode === 'ST' ? `–${getStereoPartnerSlot(splitSlot)}` : ''} ← {inputGroup}.
                      {inputSlot}
                      {mode === 'ST' ? `–${getStereoPartnerSlot(inputSlot)}` : ''}
                    </div>
                  </div>
                )}

                {fohNode && fohStripIndex > 0 && (
                  <div className="rounded-lg border border-sky-200 dark:border-sky-800/80 bg-sky-50/60 dark:bg-sky-950/30 p-2.5 text-xs">
                    <div className="font-mono text-[10px] font-bold uppercase text-sky-700 dark:text-sky-400">
                      4 · {resolveNodeName(rig, fohNode)}
                    </div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      {fohStripKind.toUpperCase()} {fohStripIndex} ← {linkConfig.fohReceivePort}.
                      {splitSlot}
                      {fohMainSends.includes(1) ? ' → Main L/R' : ''}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Verified .snap JSON Paths
              </div>
              <ul className="space-y-1 font-mono text-[10.5px] text-slate-700 dark:text-slate-300">
                {forwardPreviewPatches.map((p) => (
                  <li key={p.id} className="truncate">
                    <span className="text-sky-700 dark:text-sky-400">[{p.consoleNodeId}]</span>{' '}
                    {p.jsonPaths.join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        /* RETURN / BUS OUTPUT ROUTING WIZARD */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
            <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Configure Mix Bus / Main / Matrix / Monitor Output &amp; Return Relay
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Route a mix bus or PA feed to physical outputs—or relay a cross-console return (e.g., FOH Sub on C.48 → Stage DL32 Out A.16).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Origin Console
                </label>
                <select
                  value={originConsoleId}
                  onChange={(e) => setOriginConsoleId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                >
                  {consoles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {resolveNodeName(rig, c)} {baselines[c.id] ? '✓' : '(no .snap)'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Source Mix Type
                </label>
                <select
                  value={busKind}
                  onChange={(e) => setBusKind(e.target.value as MixBusKind)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="bus">Mix Bus (BUS 1–16)</option>
                  <option value="main">Main (MAIN 1–4)</option>
                  <option value="mtx">Matrix (MTX 1–8)</option>
                  <option value="mon">Monitor (MON 1–2)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Mix Index
                </label>
                <input
                  type="number"
                  min={1}
                  max={busKind === 'bus' ? 16 : busKind === 'mtx' ? 8 : busKind === 'main' ? 4 : 2}
                  value={busIndex}
                  onChange={(e) => setBusIndex(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {busKind === 'mon' ? (
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Monitor Source Tap (ae_data.cfg.mon.{busIndex}.src)
                  </label>
                  <input
                    type="text"
                    value={monitorSourceRef}
                    onChange={(e) => setMonitorSourceRef(e.target.value)}
                    placeholder="e.g. BUS.7 or MAIN.1"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              ) : (
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Bus / Feed Label
                  </label>
                  <input
                    type="text"
                    value={busName}
                    onChange={(e) => setBusName(e.target.value)}
                    placeholder="e.g. Stage Sub Feed"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}

              <div className="flex flex-col justify-end">
                <label className="inline-flex items-center gap-2 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stereoOutput}
                    onChange={(e) => {
                      setStereoOutput(e.target.checked);
                      if (busKind === 'bus') setBusMono(!e.target.checked);
                    }}
                  />
                  Stereo Output Pair (L+R)
                </label>
              </div>
            </div>

            {busKind !== 'mon' && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Mix Bus Scribble Strip Color
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {WING_COLORS.slice(0, 12).map((c) => (
                    <button
                      key={c.index}
                      type="button"
                      title={`${c.index}: ${c.name}`}
                      onClick={() => setBusColorIndex(c.index)}
                      style={{ backgroundColor: c.hex }}
                      className={`h-5 w-5 rounded-md cursor-pointer transition-transform ${
                        busColorIndex === c.index
                          ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white dark:ring-offset-slate-900 scale-110'
                          : 'opacity-80 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Origin Output Bank + Slot */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Origin Output Bank
                </label>
                <select
                  value={originOutGroup}
                  onChange={(e) => setOriginOutGroup(e.target.value as PortGroupCode)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                >
                  {OUTPUT_BANKS.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Origin Output Slot {stereoOutput ? `(${originOutSlot}–${originOutSlot + 1})` : ''}
                </label>
                <input
                  type="number"
                  min={1}
                  max={48}
                  value={originOutSlot}
                  onChange={(e) => setOriginOutSlot(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {/* Cross-Console Return Pass-Through */}
            {relayConsole && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 space-y-2.5">
                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableRelay}
                    onChange={(e) => setEnableRelay(e.target.checked)}
                  />
                  Relay through {resolveNodeName(rig, relayConsole)} (Cross-Console Return Pass-Through)
                </label>
                {enableRelay && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[10.5px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        Relay Destination Output Bank
                      </label>
                      <select
                        value={relayOutGroup}
                        onChange={(e) => setRelayOutGroup(e.target.value as PortGroupCode)}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                      >
                        {OUTPUT_BANKS.map((b) => (
                          <option key={b.code} value={b.code}>
                            {b.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10.5px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        Relay Output Slot {stereoOutput ? `(${relayOutSlot}–${relayOutSlot + 1})` : ''}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={48}
                        value={relayOutSlot}
                        onChange={(e) => setRelayOutSlot(Math.max(1, Number(e.target.value) || 1))}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                disabled={!canStageReturn}
                onClick={handleStageReturn}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 dark:bg-sky-500 px-4 py-2 text-xs font-semibold text-white dark:text-slate-950 hover:bg-sky-700 dark:hover:bg-sky-400 disabled:opacity-40 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Stage Return / Output Patch
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-4">
            <div className="space-y-2.5">
              <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Return Signal Chain Preview
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <span className="rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-1 text-indigo-800 dark:text-indigo-200">
                  {busKind.toUpperCase()} {busIndex} ({busKind === 'mon' ? monitorSourceRef : busName})
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="rounded-md border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 px-2 py-1 text-sky-800 dark:text-sky-200">
                  Out {originOutGroup}.{originOutSlot}
                  {stereoOutput ? `–${originOutSlot + 1}` : ''}
                </span>
                {enableRelay && relayConsole && (
                  <>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                    <span className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-2 py-1 text-amber-800 dark:text-amber-200">
                      {resolveNodeName(rig, relayConsole)} Out {relayOutGroup}.{relayOutSlot}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Verified .snap JSON Paths
              </div>
              <ul className="space-y-1 font-mono text-[10.5px] text-slate-700 dark:text-slate-300">
                {returnPreviewPatches.map((p) => (
                  <li key={p.id} className="truncate">
                    <span className="text-sky-700 dark:text-sky-400">[{p.consoleNodeId}]</span>{' '}
                    {p.jsonPaths.join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
