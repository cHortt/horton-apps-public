import { describe, expect, it } from 'vitest';
import { createMockRig } from '../schema/mockRig';
import { cloneRigDocument } from '../store/rigLibraryDb';
import { computeRigDiff } from './rigDiff';

describe('computeRigDiff & Physical Delta Checklist', () => {
  it('returns zero changes when comparing identical rigs', () => {
    const rig = createMockRig();
    const diff = computeRigDiff(rig, cloneRigDocument(rig));

    expect(diff.totalChanges).toBe(0);
    expect(diff.items).toHaveLength(0);
    expect(diff.checklist.every((s) => s.items.length === 0)).toBe(true);
  });

  it('detects added physical input with +48V, strip remap, and console load reminder', () => {
    const before = createMockRig();
    const after = cloneRigDocument(before);

    const stage = after.nodes.find((n) => n.id === 'stage-wing')!;
    const aesA = stage.portGroups.find((pg) => pg.code === 'A' && pg.direction === 'input')!;
    aesA.channels.push({
      id: 'stage-wing:in:A:35',
      slot: 35,
      rawName: 'Guest Acoustic DI',
      mode: 'M',
      gainDb: 20,
      phantom48v: true,
    });
    after.annotations.channels['stage-wing:in:A:35'] = {
      cableTag: 'XLR-35',
      notes: 'Stage Right Radial J48',
    };

    stage.channelStrips = [
      ...(stage.channelStrips ?? []),
      {
        id: 'stage-wing:strip:ch:28',
        kind: 'ch',
        index: 28,
        rawName: '',
        resolvedName: 'Guest Acoustic DI',
        clink: true,
        sourceGroup: 'A',
        sourceSlot: 35,
        busSends: [],
        mainSends: [1],
      },
    ];

    const diff = computeRigDiff(before, after);

    expect(diff.counts.physical).toBeGreaterThanOrEqual(1);
    expect(diff.counts.strips).toBeGreaterThanOrEqual(1);

    const physicalSec = diff.checklist.find((s) => s.key === 'physical')!;
    const safetySec = diff.checklist.find((s) => s.key === 'safety')!;
    const consoleSec = diff.checklist.find((s) => s.key === 'console')!;

    expect(physicalSec.items.some((i) => i.actionType === 'plug' && i.headline.includes('Guest Acoustic DI'))).toBe(true);
    expect(physicalSec.items.some((i) => i.cableTag === 'XLR-35')).toBe(true);
    expect(safetySec.items.some((i) => i.actionType === 'phantom-on' && i.headline.includes('A.35'))).toBe(true);
    expect(consoleSec.items.some((i) => i.actionType === 'console-load')).toBe(true);
  });

  it('detects a physical move when the same source label shifts slots on the same node', () => {
    const before = createMockRig();
    const after = cloneRigDocument(before);

    const stage = after.nodes.find((n) => n.id === 'stage-wing')!;
    const aesA = stage.portGroups.find((pg) => pg.code === 'A' && pg.direction === 'input')!;
    const first = aesA.channels[0];
    const originalSlot = first.slot;
    const movedSlot = 36;
    first.slot = movedSlot;
    first.id = `stage-wing:in:A:${movedSlot}`;

    const diff = computeRigDiff(before, after);

    expect(diff.items.some((i) => i.changeType === 'moved' && i.beforeValue === `A.${originalSlot}` && i.afterValue === `A.${movedSlot}`)).toBe(true);
    const physicalSec = diff.checklist.find((s) => s.key === 'physical')!;
    expect(physicalSec.items.some((i) => i.actionType === 'move')).toBe(true);
  });

  it('flags +48V safety flips and supports reverse teardown direction', () => {
    const sunday = createMockRig();
    const eventRig = cloneRigDocument(sunday);

    const stage = eventRig.nodes.find((n) => n.id === 'stage-wing')!;
    const aesA = stage.portGroups.find((pg) => pg.code === 'A' && pg.direction === 'input')!;
    const target = aesA.channels[0];
    target.phantom48v = !target.phantom48v;

    // Add manual external hardware for special event
    eventRig.nodes.push({
      id: 'ext-orchestra-submix',
      kind: 'external',
      rawName: 'Orchestra Submixer',
      model: 'Radial KL-8',
      zone: 'Stage',
      position: { x: 100, y: 100 },
      sourceOrigin: 'manual',
      portGroups: [],
      mixBuses: [],
    });

    const setupDiff = computeRigDiff(sunday, eventRig);
    expect(setupDiff.counts.phantom).toBe(1);
    expect(setupDiff.counts.hardware).toBe(1);
    expect(
      setupDiff.checklist
        .find((s) => s.key === 'physical')!
        .items.some((i) => i.headline.includes('Set up Orchestra Submixer')),
    ).toBe(true);

    // Reverse teardown back to Sunday Standard
    const teardownDiff = computeRigDiff(eventRig, sunday);
    expect(teardownDiff.counts.phantom).toBe(1);
    expect(teardownDiff.counts.hardware).toBe(1);
    expect(
      teardownDiff.checklist
        .find((s) => s.key === 'physical')!
        .items.some((i) => i.headline.includes('Disconnect / strike Orchestra Submixer')),
    ).toBe(true);
  });
});
