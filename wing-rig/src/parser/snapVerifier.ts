import type { HardwareNode, PortGroupCode, RigDocument } from '../schema/rig';
import type {
  ConsoleBaselineMeta,
  ConsoleLinkConfig,
  PathAuditIssue,
  StagedPatchEntry,
} from '../schema/patch';
import { resolveBusName, resolveChannelName, resolveNodeName } from '../schema/helpers';
import { getStereoPartnerSlot } from './snapPatcher';

/**
 * Auto-infers a ConsoleLinkConfig from the RigDocument's console nodes and inter-console trunks.
 */
export function inferConsoleLinkConfig(rig: RigDocument): ConsoleLinkConfig {
  const consoles = rig.nodes.filter((n) => n.kind === 'console');
  if (consoles.length === 0) {
    return {
      stageConsoleId: '',
      stageSplitPort: 'C',
      fohReceivePort: 'C',
      headampOwnerConsoleId: '',
    };
  }

  const stageCandidate =
    consoles.find(
      (c) =>
        c.id.includes('stage') ||
        c.zone === 'Stage Rack' ||
        /mon|stage/i.test(c.rawName) ||
        /mon|stage/i.test(c.snapshotCreatorName ?? ''),
    ) ?? consoles[0];

  const fohCandidate = consoles.find((c) => c.id !== stageCandidate.id);

  let stageSplitPort: PortGroupCode = 'C';
  let fohReceivePort: PortGroupCode = 'C';

  if (fohCandidate) {
    const linkTrunk = rig.trunks.find(
      (t) =>
        (t.sourceNodeId === stageCandidate.id && t.targetNodeId === fohCandidate.id) ||
        (t.sourceNodeId === fohCandidate.id && t.targetNodeId === stageCandidate.id),
    );
    if (linkTrunk) {
      if (linkTrunk.sourceNodeId === stageCandidate.id) {
        stageSplitPort = linkTrunk.sourcePortGroup;
        fohReceivePort = linkTrunk.targetPortGroup;
      } else {
        stageSplitPort = linkTrunk.targetPortGroup;
        fohReceivePort = linkTrunk.sourcePortGroup;
      }
    }
  }

  return {
    stageConsoleId: stageCandidate.id,
    fohConsoleId: fohCandidate?.id,
    stageSplitPort,
    fohReceivePort,
    headampOwnerConsoleId: stageCandidate.id,
  };
}

function getPortGroupChannels(
  node: HardwareNode | undefined,
  code: PortGroupCode,
  direction: 'input' | 'output',
) {
  if (!node) return [];
  const pg = node.portGroups.find((g) => g.code === code && g.direction === direction);
  return pg?.channels ?? [];
}

/**
 * Deterministic cross-console and single-console audio signal integrity verifier ("Audio Linter").
 * Runs against the live (effective) RigDocument + staged patches to surface dead-end splits,
 * stereo mismatches, label drift, unrouted buses, and +48V safety alerts with 1-click fixes.
 */
export function verifyRigPaths(
  rig: RigDocument,
  link: ConsoleLinkConfig,
  baselines: Record<string, ConsoleBaselineMeta>,
  stagedPatches: StagedPatchEntry[],
): PathAuditIssue[] {
  const issues: PathAuditIssue[] = [];
  const stageNode = rig.nodes.find((n) => n.id === link.stageConsoleId);
  const fohNode = link.fohConsoleId ? rig.nodes.find((n) => n.id === link.fohConsoleId) : undefined;
  const hasStageBaseline = Boolean(stageNode && baselines[stageNode.id]);
  const hasFohBaseline = Boolean(fohNode && baselines[fohNode.id]);

  // 1. Cross-console AES50/Trunk split checks (when both Stage and FOH consoles exist)
  if (stageNode && fohNode) {
    const stageSplitsOut = getPortGroupChannels(stageNode, link.stageSplitPort, 'output');
    const stageSplitsBySlot = new Map(stageSplitsOut.map((c) => [c.slot, c]));

    const fohReceivesIn = getPortGroupChannels(fohNode, link.fohReceivePort, 'input');
    const fohReceivesBySlot = new Map(fohReceivesIn.map((c) => [c.slot, c]));

    // 1a. FOH channel strip listens to inter-console receive slot N, but Stage out.<splitPort>.N is OFF
    for (const fohStrip of fohNode.channelStrips ?? []) {
      if (fohStrip.sourceGroup !== link.fohReceivePort || fohStrip.sourceSlot <= 0) continue;
      const splitOut = stageSplitsBySlot.get(fohStrip.sourceSlot);
      if (!splitOut) {
        // See if Stage has an obvious matching input on A.<slot> to offer a 1-click fix
        const stageAesA = getPortGroupChannels(stageNode, 'A', 'input').find(
          (c) => c.slot === fohStrip.sourceSlot,
        );
        issues.push({
          id: `dead-end-foh-${fohStrip.kind}-${fohStrip.index}-${fohStrip.sourceSlot}`,
          severity: 'error',
          code: 'DEAD_END_SPLIT',
          title: `Dead-End Split on ${link.fohReceivePort}.${fohStrip.sourceSlot} (${fohStrip.resolvedName})`,
          detail: `${resolveNodeName(rig, fohNode)} ${fohStrip.kind.toUpperCase()} ${fohStrip.index} listens to ${link.fohReceivePort}.${fohStrip.sourceSlot}, but ${resolveNodeName(rig, stageNode)} Out ${link.stageSplitPort}.${fohStrip.sourceSlot} is unpatched (OFF) — FOH will receive silence.`,
          consoleNodeId: stageNode.id,
          traceTarget: {
            type: 'channel',
            nodeId: fohNode.id,
            portDirection: 'in',
            group: link.fohReceivePort,
            slot: fohStrip.sourceSlot,
          },
          suggestedFixes:
            hasStageBaseline && stageAesA
              ? [
                  {
                    consoleNodeId: stageNode.id,
                    summary: `Patch Stage Out ${link.stageSplitPort}.${fohStrip.sourceSlot} ← A.${stageAesA.slot} (${stageAesA.rawName})`,
                    op: {
                      type: 'set-output',
                      group: link.stageSplitPort,
                      slot: fohStrip.sourceSlot,
                      sourceGroup: 'A',
                      sourceSlot: stageAesA.slot,
                    },
                  },
                ]
              : undefined,
        });
      }
    }

    // 1b. Compare Stage split outputs against FOH receive inputs (Stereo mismatch + Label drift)
    for (const splitOut of stageSplitsOut) {
      const fohIn = fohReceivesBySlot.get(splitOut.slot);

      // Check stereo pair completeness on Stage split output
      if (splitOut.mode === 'ST' && splitOut.slot % 2 === 1) {
        const partnerSlot = getStereoPartnerSlot(splitOut.slot);
        if (!stageSplitsBySlot.has(partnerSlot) && splitOut.passthroughFrom) {
          const srcGrp = splitOut.passthroughFrom.group;
          const isPortGroup =
            srcGrp !== 'BUS' && srcGrp !== 'MAIN' && srcGrp !== 'MTX' && srcGrp !== 'MON';
          issues.push({
            id: `half-stereo-split-${splitOut.slot}`,
            severity: 'error',
            code: 'STEREO_MISMATCH',
            title: `Incomplete Stereo Split on ${link.stageSplitPort}.${splitOut.slot} (${splitOut.rawName})`,
            detail: `${resolveNodeName(rig, stageNode)} Out ${link.stageSplitPort}.${splitOut.slot} is Stereo (L), but partner slot ${link.stageSplitPort}.${partnerSlot} (R) is not routed.`,
            consoleNodeId: stageNode.id,
            traceTarget: {
              type: 'channel',
              nodeId: stageNode.id,
              portDirection: 'out',
              group: link.stageSplitPort,
              slot: splitOut.slot,
              channelId: splitOut.id,
            },
            suggestedFixes:
              hasStageBaseline && isPortGroup
                ? [
                    {
                      consoleNodeId: stageNode.id,
                      summary: `Patch Stage Out ${link.stageSplitPort}.${partnerSlot} ← ${srcGrp}.${splitOut.passthroughFrom.slot + 1} (ST R)`,
                      op: {
                        type: 'set-output',
                        group: link.stageSplitPort,
                        slot: partnerSlot,
                        sourceGroup: srcGrp,
                        sourceSlot: splitOut.passthroughFrom.slot + 1,
                      },
                    },
                  ]
                : undefined,
          });
        }
      }

      if (!fohIn) continue;

      // Stereo/Mono mismatch between Stage split out and FOH receive in
      if (splitOut.mode !== fohIn.mode) {
        issues.push({
          id: `st-mismatch-${splitOut.slot}`,
          severity: 'warning',
          code: 'STEREO_MISMATCH',
          title: `Mono/Stereo Mismatch on Slot ${splitOut.slot} (${splitOut.rawName})`,
          detail: `${resolveNodeName(rig, stageNode)} sends ${splitOut.mode} on ${link.stageSplitPort}.${splitOut.slot}, while ${resolveNodeName(rig, fohNode)} ${link.fohReceivePort}.${splitOut.slot} is set to ${fohIn.mode}.`,
          consoleNodeId: fohNode.id,
          traceTarget: {
            type: 'channel',
            nodeId: fohNode.id,
            portDirection: 'in',
            group: link.fohReceivePort,
            slot: splitOut.slot,
            channelId: fohIn.id,
          },
          suggestedFixes: hasFohBaseline
            ? [
                {
                  consoleNodeId: fohNode.id,
                  summary: `Set FOH ${link.fohReceivePort}.${splitOut.slot} mode → ${splitOut.mode}`,
                  op: {
                    type: 'set-input',
                    group: link.fohReceivePort,
                    slot: splitOut.slot,
                    pairStereoSlot: splitOut.mode === 'ST',
                    mode: splitOut.mode,
                  },
                },
              ]
            : undefined,
        });
      }

      // Label drift between Stage split and FOH receive slot
      const stageLabel = splitOut.rawName.trim();
      const fohLabel = fohIn.rawName.trim();
      const isGeneric = (s: string) => /^(ch|a|b|c|lcl)\s*\.?\s*\d+$/i.test(s);
      if (
        stageLabel &&
        fohLabel &&
        !isGeneric(stageLabel) &&
        !isGeneric(fohLabel) &&
        stageLabel.toLowerCase() !== fohLabel.toLowerCase()
      ) {
        issues.push({
          id: `label-drift-${splitOut.slot}`,
          severity: 'warning',
          code: 'LABEL_DRIFT',
          title: `Label Drift on Split Slot ${splitOut.slot}: "${stageLabel}" vs "${fohLabel}"`,
          detail: `${resolveNodeName(rig, stageNode)} sends "${stageLabel}" on ${link.stageSplitPort}.${splitOut.slot}, but ${resolveNodeName(rig, fohNode)} labels ${link.fohReceivePort}.${splitOut.slot} as "${fohLabel}".`,
          consoleNodeId: fohNode.id,
          traceTarget: {
            type: 'channel',
            nodeId: fohNode.id,
            portDirection: 'in',
            group: link.fohReceivePort,
            slot: splitOut.slot,
            channelId: fohIn.id,
          },
          suggestedFixes: hasFohBaseline
            ? [
                {
                  consoleNodeId: fohNode.id,
                  summary: `Sync FOH ${link.fohReceivePort}.${splitOut.slot} label → "${stageLabel}"`,
                  op: {
                    type: 'set-input',
                    group: link.fohReceivePort,
                    slot: splitOut.slot,
                    pairStereoSlot: splitOut.mode === 'ST',
                    name: stageLabel,
                  },
                },
              ]
            : undefined,
        });
      }
    }
  }

  // 2. Single-console checks across all consoles in the rig
  for (const consoleNode of rig.nodes.filter((n) => n.kind === 'console')) {
    // 2a. Unrouted named active Mix Buses (not tapped by a Monitor either)
    const tappedBusRefs = new Set(
      consoleNode.mixBuses
        .filter((b) => b.kind === 'mon' && b.monitorSource)
        .map((b) => `${b.monitorSource!.kind}:${b.monitorSource!.index}`),
    );

    for (const bus of consoleNode.mixBuses) {
      if (bus.kind !== 'bus') continue;
      if (bus.muted) continue;
      if (bus.outputs.length > 0) continue;
      if (tappedBusRefs.has(`bus:${bus.index}`)) continue;
      const name = resolveBusName(rig, bus);
      if (!bus.rawName || bus.rawName === '.' || /^BUS\s+\d+$/i.test(name)) continue;

      issues.push({
        id: `unrouted-bus-${consoleNode.id}-${bus.index}`,
        severity: 'warning',
        code: 'UNROUTED_BUS',
        title: `Unrouted Mix Bus: ${name} (BUS ${bus.index})`,
        detail: `On ${resolveNodeName(rig, consoleNode)}, "${name}" is named and active, but has no physical output slot or Monitor tap assigned.`,
        consoleNodeId: consoleNode.id,
        traceTarget: {
          type: 'bus',
          nodeId: consoleNode.id,
          busKind: 'bus',
          busIndex: bus.index,
          busId: bus.id,
        },
      });
    }
  }

  // 3. Staged +48V phantom power safety summary
  const phantomEdits = stagedPatches.filter((p) => p.touchesPhantom48v);
  for (const entry of phantomEdits) {
    if (entry.op.type !== 'set-input') continue;
    const node = rig.nodes.find((n) => n.id === entry.consoleNodeId);
    const turnedOn = Boolean(entry.op.phantom48v);
    issues.push({
      id: `phantom-${entry.id}`,
      severity: 'info',
      code: 'PHANTOM_CHANGE',
      title: `+48V Phantom ${turnedOn ? 'ENABLED' : 'DISABLED'} on ${entry.op.group}.${entry.op.slot}`,
      detail: `${node ? resolveNodeName(rig, node) : entry.consoleNodeId}: ${entry.summary}. Confirm mic/DI phantom safety before loading onto live hardware.`,
      consoleNodeId: entry.consoleNodeId,
      traceTarget: {
        type: 'channel',
        nodeId: entry.consoleNodeId,
        portDirection: 'in',
        group: entry.op.group,
        slot: entry.op.slot,
      },
    });
  }

  // Sort: errors first, then warnings, then info
  const order = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return issues;
}

export interface CrossConsoleMatrixRow {
  key: string;
  inputGroup: PortGroupCode;
  inputSlot: number;
  sourceName: string;
  mode: 'M' | 'ST';
  gainDb?: number;
  phantom48v?: boolean;
  colorIndex?: number;
  stageChannel?: string;
  splitSlot?: number;
  splitLabel?: string;
  fohChannel?: string;
  fohInputName?: string;
  status: 'ok' | 'warning' | 'error' | 'single';
  statusNote?: string;
  stageChannelId?: string;
}

/**
 * Builds unified Stage -> Split -> FOH patch rows for the Cross-Console Patch Matrix view.
 */
export function buildCrossConsoleMatrix(
  rig: RigDocument,
  link: ConsoleLinkConfig,
  issues: PathAuditIssue[],
): CrossConsoleMatrixRow[] {
  const stageNode = rig.nodes.find((n) => n.id === link.stageConsoleId);
  const fohNode = link.fohConsoleId ? rig.nodes.find((n) => n.id === link.fohConsoleId) : undefined;
  if (!stageNode) return [];

  const stageSplitsOut = getPortGroupChannels(stageNode, link.stageSplitPort, 'output');
  const fohReceivesIn = getPortGroupChannels(fohNode, link.fohReceivePort, 'input');
  const fohInBySlot = new Map(fohReceivesIn.map((c) => [c.slot, c]));
  const fohStripBySlot = new Map(
    (fohNode?.channelStrips ?? [])
      .filter((s) => s.sourceGroup === link.fohReceivePort && s.sourceSlot > 0)
      .map((s) => [s.sourceSlot, s]),
  );

  // Map (inputGroup:inputSlot) -> stage split out channel
  const splitByInputKey = new Map<string, (typeof stageSplitsOut)[number]>();
  for (const outCh of stageSplitsOut) {
    if (outCh.passthroughFrom) {
      splitByInputKey.set(`${outCh.passthroughFrom.group}:${outCh.passthroughFrom.slot}`, outCh);
    }
  }

  const issueBySlot = new Map<number, PathAuditIssue>();
  for (const iss of issues) {
    if (iss.traceTarget?.slot !== undefined) {
      const existing = issueBySlot.get(iss.traceTarget.slot);
      if (!existing || (existing.severity !== 'error' && iss.severity === 'error')) {
        issueBySlot.set(iss.traceTarget.slot, iss);
      }
    }
  }

  const rows: CrossConsoleMatrixRow[] = [];
  const inputGroups = stageNode.portGroups.filter(
    (pg) => pg.direction !== 'output' && pg.code !== link.stageSplitPort,
  );

  for (const pg of inputGroups) {
    for (const ch of pg.channels) {
      // Collapse even stereo R partner rows into the odd L stereo row when paired
      if (ch.mode === 'ST' && ch.stereoSide === 'R') continue;

      const split = splitByInputKey.get(`${pg.code}:${ch.slot}`);
      const splitSlot = split?.slot;
      const fohIn = splitSlot !== undefined ? fohInBySlot.get(splitSlot) : undefined;
      const fohStrip = splitSlot !== undefined ? fohStripBySlot.get(splitSlot) : undefined;
      const slotIssue = splitSlot !== undefined ? issueBySlot.get(splitSlot) : undefined;

      let status: CrossConsoleMatrixRow['status'] = fohNode ? 'ok' : 'single';
      let statusNote: string | undefined;

      if (slotIssue) {
        status = slotIssue.severity === 'error' ? 'error' : 'warning';
        statusNote = slotIssue.title;
      } else if (fohNode && !split) {
        status = 'single';
        statusNote = 'Stage only (no split)';
      }

      rows.push({
        key: `${pg.code}:${ch.slot}`,
        inputGroup: pg.code,
        inputSlot: ch.slot,
        sourceName: resolveChannelName(rig, ch),
        mode: ch.mode,
        gainDb: ch.gainDb,
        phantom48v: ch.phantom48v,
        colorIndex: ch.colorIndex,
        stageChannel: ch.consoleChannel,
        splitSlot,
        splitLabel: splitSlot !== undefined ? `${link.stageSplitPort}.${splitSlot}` : undefined,
        fohChannel: fohStrip
          ? `${fohStrip.kind.toUpperCase()} ${fohStrip.index}`
          : fohIn?.consoleChannel,
        fohInputName: fohIn ? resolveChannelName(rig, fohIn) : undefined,
        status,
        statusNote,
        stageChannelId: ch.id,
      });
    }
  }

  return rows;
}
