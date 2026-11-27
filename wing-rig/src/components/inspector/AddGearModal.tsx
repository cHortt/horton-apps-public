import { useState } from 'react';
import { Cable, Cpu, Plus, X } from 'lucide-react';
import type {
  ChannelPatch,
  HardwareNode,
  HardwareNodeKind,
  PortGroupCode,
  RigDocument,
  RigZone,
  TrunkConnection,
  TrunkProtocol,
} from '../../schema/rig';
import { PROTOCOL_META, resolveNodeName } from '../../schema/helpers';

interface AddGearModalProps {
  rig: RigDocument;
  onClose: () => void;
  onAddNode: (node: HardwareNode, friendlyName?: string, notes?: string) => void;
  onAddTrunk: (trunk: TrunkConnection, cableTag?: string, notes?: string) => void;
}

const NODE_KINDS: Array<{ value: HardwareNodeKind; label: string }> = [
  { value: 'external', label: 'External Outboard / Rack' },
  { value: 'stagebox', label: 'Stage Box (DL32 / S32)' },
  { value: 'wireless', label: 'Wireless Mic Rack' },
  { value: 'iem', label: 'IEM Transmitter Rack' },
  { value: 'media', label: 'Media / Playback PC' },
  { value: 'amp', label: 'PA Amp / DSP Rack' },
  { value: 'console', label: 'Mixing Console' },
];

const ZONES: RigZone[] = ['Stage', 'Stage Rack', 'FOH Booth', 'Amp Vault', 'Broadcast', 'Custom'];
const PROTOCOLS: TrunkProtocol[] = [
  'aes50',
  'analog-xlr',
  'analog-trs',
  'dante',
  'usb',
  'stageconnect',
  'network',
];

function makeStarterChannels(prefix: string, count: number, labelBase: string): ChannelPatch[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `${prefix}:${idx + 1}`,
    slot: idx + 1,
    rawName: `${labelBase} ${idx + 1}`,
    mode: 'M' as const,
  }));
}

export function AddGearModal({ rig, onClose, onAddNode, onAddTrunk }: AddGearModalProps) {
  const [tab, setTab] = useState<'gear' | 'trunk'>('gear');

  // Gear form state
  const [gearName, setGearName] = useState('');
  const [gearModel, setGearModel] = useState('');
  const [gearKind, setGearKind] = useState<HardwareNodeKind>('external');
  const [gearZone, setGearZone] = useState<RigZone>('Stage Rack');
  const [gearInputs, setGearInputs] = useState(4);
  const [gearOutputs, setGearOutputs] = useState(4);
  const [gearNotes, setGearNotes] = useState('');

  // Trunk form state
  const [trunkLabel, setTrunkLabel] = useState('');
  const [trunkProtocol, setTrunkProtocol] = useState<TrunkProtocol>('analog-xlr');
  const [sourceNodeId, setSourceNodeId] = useState(rig.nodes[0]?.id ?? '');
  const [targetNodeId, setTargetNodeId] = useState(rig.nodes[1]?.id ?? rig.nodes[0]?.id ?? '');
  const [sourceGroup, setSourceGroup] = useState<PortGroupCode>('ANALOG');
  const [targetGroup, setTargetGroup] = useState<PortGroupCode>('ANALOG');
  const [fwdCount, setFwdCount] = useState(4);
  const [retCount, setRetCount] = useState(0);
  const [cableTag, setCableTag] = useState('');
  const [trunkNotes, setTrunkNotes] = useState('');

  const handleCreateGear = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = gearName.trim();
    if (!trimmed) return;
    const id = `manual-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36).slice(-4)}`;

    const portGroups = [];
    if (gearInputs > 0) {
      portGroups.push({
        id: `${id}:in:ANALOG`,
        code: 'ANALOG' as PortGroupCode,
        label: 'Inputs',
        direction: 'input' as const,
        capacity: gearInputs,
        channels: makeStarterChannels(`${id}:in`, gearInputs, 'In'),
      });
    }
    if (gearOutputs > 0) {
      portGroups.push({
        id: `${id}:out:ANALOG`,
        code: 'ANALOG' as PortGroupCode,
        label: 'Outputs',
        direction: 'output' as const,
        capacity: gearOutputs,
        channels: makeStarterChannels(`${id}:out`, gearOutputs, 'Out'),
      });
    }

    const node: HardwareNode = {
      id,
      kind: gearKind,
      rawName: trimmed,
      model: gearModel.trim() || 'Custom Hardware',
      zone: gearZone,
      position: {
        x: 340 + (rig.nodes.length % 3) * 80,
        y: 120 + (rig.nodes.length % 4) * 70,
      },
      sourceOrigin: 'manual',
      portGroups,
      mixBuses: [],
    };
    onAddNode(node, trimmed, gearNotes.trim() || undefined);
    onClose();
  };

  const handleCreateTrunk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return;
    const label = trunkLabel.trim() || `${PROTOCOL_META[trunkProtocol].shortLabel} Trunk`;
    const id = `trunk-manual-${Date.now().toString(36)}`;
    const trunk: TrunkConnection = {
      id,
      label,
      protocol: trunkProtocol,
      sourceNodeId,
      sourcePortGroup: sourceGroup,
      targetNodeId,
      targetPortGroup: targetGroup,
      sourceOrigin: 'manual',
      channels: makeStarterChannels(`${id}:fwd`, Math.max(1, fwdCount), 'Ch'),
      returnChannels: retCount > 0 ? makeStarterChannels(`${id}:ret`, retCount, 'Ret') : [],
    };
    onAddTrunk(trunk, cableTag.trim() || undefined, trunkNotes.trim() || undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 dark:bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-[2px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] shadow-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Add External Gear or Custom Trunk
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[2px] p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2 border-b border-slate-100 dark:border-slate-800 bg-[#f3f5f8] dark:bg-[#090d14]/60 px-5 py-2.5">
          <button
            type="button"
            onClick={() => setTab('gear')}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-[2px] py-1.5 text-xs font-semibold cursor-pointer ${
              tab === 'gear'
                ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 shadow-xs'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            External Hardware
          </button>
          <button
            type="button"
            onClick={() => setTab('trunk')}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-[2px] py-1.5 text-xs font-semibold cursor-pointer ${
              tab === 'trunk'
                ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 shadow-xs'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            <Cable className="w-3.5 h-3.5" />
            Custom Trunk
          </button>
        </div>

        {tab === 'gear' ? (
          <form onSubmit={handleCreateGear} className="p-5 space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Device Name *
                </label>
                <input
                  required
                  type="text"
                  value={gearName}
                  onChange={(e) => setGearName(e.target.value)}
                  placeholder="e.g. Livestream Encoder"
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Model
                </label>
                <input
                  type="text"
                  value={gearModel}
                  onChange={(e) => setGearModel(e.target.value)}
                  placeholder="e.g. Blackmagic ATEM / Focusrite"
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Device Type
                </label>
                <select
                  value={gearKind}
                  onChange={(e) => setGearKind(e.target.value as HardwareNodeKind)}
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  {NODE_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Zone
                </label>
                <select
                  value={gearZone}
                  onChange={(e) => setGearZone(e.target.value as RigZone)}
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  {ZONES.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Input Channels
                </label>
                <input
                  type="number"
                  min={0}
                  max={64}
                  value={gearInputs}
                  onChange={(e) => setGearInputs(Number(e.target.value))}
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Output Channels
                </label>
                <input
                  type="number"
                  min={0}
                  max={64}
                  value={gearOutputs}
                  onChange={(e) => setGearOutputs(Number(e.target.value))}
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Notes
              </label>
              <textarea
                rows={2}
                value={gearNotes}
                onChange={(e) => setGearNotes(e.target.value)}
                placeholder="Location, power, sample rate, or routing notes..."
                className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-[2px] border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-[2px] bg-slate-900 dark:bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-sky-400 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Hardware
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCreateTrunk} className="p-5 space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Trunk Name
                </label>
                <input
                  type="text"
                  value={trunkLabel}
                  onChange={(e) => setTrunkLabel(e.target.value)}
                  placeholder="e.g. Broadcast Dante Feed"
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Protocol
                </label>
                <select
                  value={trunkProtocol}
                  onChange={(e) => setTrunkProtocol(e.target.value as TrunkProtocol)}
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {PROTOCOL_META[p].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  From Device
                </label>
                <select
                  value={sourceNodeId}
                  onChange={(e) => setSourceNodeId(e.target.value)}
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  {rig.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {resolveNodeName(rig, n)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  To Device
                </label>
                <select
                  value={targetNodeId}
                  onChange={(e) => setTargetNodeId(e.target.value)}
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  {rig.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {resolveNodeName(rig, n)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="block text-[10.5px] font-semibold text-slate-600 dark:text-slate-400">
                  Src Port
                </label>
                <select
                  value={sourceGroup}
                  onChange={(e) => setSourceGroup(e.target.value as PortGroupCode)}
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                >
                  {(['ANALOG', 'A', 'B', 'C', 'LCL', 'AUX', 'USB', 'CRD', 'DANTE', 'SC'] as PortGroupCode[]).map(
                    (g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div>
                <label className="block text-[10.5px] font-semibold text-slate-600 dark:text-slate-400">
                  Tgt Port
                </label>
                <select
                  value={targetGroup}
                  onChange={(e) => setTargetGroup(e.target.value as PortGroupCode)}
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                >
                  {(['ANALOG', 'A', 'B', 'C', 'LCL', 'AUX', 'USB', 'CRD', 'DANTE', 'SC'] as PortGroupCode[]).map(
                    (g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div>
                <label className="block text-[10.5px] font-semibold text-slate-600 dark:text-slate-400">
                  Fwd Ch
                </label>
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={fwdCount}
                  onChange={(e) => setFwdCount(Number(e.target.value))}
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[10.5px] font-semibold text-slate-600 dark:text-slate-400">
                  Ret Ch
                </label>
                <input
                  type="number"
                  min={0}
                  max={64}
                  value={retCount}
                  onChange={(e) => setRetCount(Number(e.target.value))}
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Cable Tag
                </label>
                <input
                  type="text"
                  value={cableTag}
                  onChange={(e) => setCableTag(e.target.value)}
                  placeholder="e.g. DANTE-PRI-01"
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Notes
                </label>
                <input
                  type="text"
                  value={trunkNotes}
                  onChange={(e) => setTrunkNotes(e.target.value)}
                  placeholder="Optional run notes..."
                  className="mt-1 w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
              </div>
            </div>

            {sourceNodeId === targetNodeId && (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                Source and target devices must be different.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-[2px] border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sourceNodeId === targetNodeId}
                className="inline-flex items-center gap-1.5 rounded-[2px] bg-slate-900 dark:bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-sky-400 disabled:opacity-40 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Trunk
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
