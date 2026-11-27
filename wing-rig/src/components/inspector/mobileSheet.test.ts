import { describe, expect, it } from 'vitest';
import {
  clampSheetHeightPx,
  cycleSheetDetent,
  getSheetDetentHeights,
  resolveSheetSnapDetent,
} from './mobileSheet';

describe('mobileSheet helpers', () => {
  it('computes strictly increasing peek < half < full heights for standard phone viewports', () => {
    for (const h of [520, 640, 740, 844]) {
      const heights = getSheetDetentHeights(h);
      expect(heights.peek).toBeGreaterThanOrEqual(64);
      expect(heights.peek).toBeLessThan(heights.half);
      expect(heights.half).toBeLessThan(heights.full);
      expect(heights.full).toBeLessThanOrEqual(h);
    }
  });

  it('clamps extreme drag heights safely inside container bounds', () => {
    const container = 640;
    expect(clampSheetHeightPx(-50, container)).toBeGreaterThanOrEqual(58);
    expect(clampSheetHeightPx(999, container)).toBeLessThan(container);
  });

  it('cycles detents predictably peek -> half -> full -> peek', () => {
    expect(cycleSheetDetent('peek')).toBe('half');
    expect(cycleSheetDetent('half')).toBe('full');
    expect(cycleSheetDetent('full')).toBe('peek');
  });

  it('snaps to nearest detent on slow release', () => {
    const container = 640;
    const heights = getSheetDetentHeights(container);

    expect(
      resolveSheetSnapDetent({
        currentDetent: 'half',
        endHeightPx: heights.peek + 20,
        containerHeightPx: container,
        velocityPxPerMs: 0.05,
      }),
    ).toBe('peek');

    expect(
      resolveSheetSnapDetent({
        currentDetent: 'peek',
        endHeightPx: heights.half + 15,
        containerHeightPx: container,
        velocityPxPerMs: -0.05,
      }),
    ).toBe('half');

    expect(
      resolveSheetSnapDetent({
        currentDetent: 'half',
        endHeightPx: heights.full - 30,
        containerHeightPx: container,
        velocityPxPerMs: -0.05,
      }),
    ).toBe('full');
  });

  it('steps up or down one detent on fast flick gestures', () => {
    const container = 640;
    const heights = getSheetDetentHeights(container);

    // Fast upward flick from peek -> half
    expect(
      resolveSheetSnapDetent({
        currentDetent: 'peek',
        endHeightPx: heights.peek + 45,
        containerHeightPx: container,
        velocityPxPerMs: -0.8,
      }),
    ).toBe('half');

    // Fast upward flick from half -> full
    expect(
      resolveSheetSnapDetent({
        currentDetent: 'half',
        endHeightPx: heights.half + 40,
        containerHeightPx: container,
        velocityPxPerMs: -0.75,
      }),
    ).toBe('full');

    // Fast downward flick from full -> half
    expect(
      resolveSheetSnapDetent({
        currentDetent: 'full',
        endHeightPx: heights.full - 50,
        containerHeightPx: container,
        velocityPxPerMs: 0.9,
      }),
    ).toBe('half');

    // Fast downward flick from half -> peek
    expect(
      resolveSheetSnapDetent({
        currentDetent: 'half',
        endHeightPx: heights.half - 40,
        containerHeightPx: container,
        velocityPxPerMs: 0.8,
      }),
    ).toBe('peek');
  });
});
