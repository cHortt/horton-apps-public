import { useEffect, useState } from 'react';

export type SheetDetent = 'peek' | 'half' | 'full';

export const SHEET_PEEK_PX = 76;
export const SHEET_HALF_RATIO = 0.48;
export const SHEET_FULL_RATIO = 0.88;
export const SHEET_MIN_HALF_PX = 250;
export const SHEET_FLICK_VELOCITY_THRESHOLD = 0.42; // px per ms

const DETENT_ORDER: readonly SheetDetent[] = ['peek', 'half', 'full'];

/**
 * Computes pixel heights for the 3 mobile bottom sheet detents given the
 * available `<main>` container height.
 */
export function getSheetDetentHeights(containerHeightPx: number): Record<SheetDetent, number> {
  const safeContainer = Math.max(containerHeightPx, 320);
  const peek = Math.min(SHEET_PEEK_PX, Math.round(safeContainer * 0.22));
  const full = Math.max(peek + 120, Math.round(safeContainer * SHEET_FULL_RATIO));
  const rawHalf = Math.max(SHEET_MIN_HALF_PX, Math.round(safeContainer * SHEET_HALF_RATIO));
  const half = Math.min(full - 64, Math.max(peek + 80, rawHalf));

  return { peek, half, full };
}

/**
 * Clamps an active drag height inside comfortable bounds so the handle never
 * disappears off-screen or collapses to 0px.
 */
export function clampSheetHeightPx(heightPx: number, containerHeightPx: number): number {
  const heights = getSheetDetentHeights(containerHeightPx);
  const minPx = Math.max(58, heights.peek - 16);
  const maxPx = Math.min(Math.max(containerHeightPx - 16, heights.full), Math.round(containerHeightPx * 0.93));
  return Math.min(maxPx, Math.max(minPx, heightPx));
}

/**
 * Cycles detent when tapping the grabber pill: peek -> half -> full -> peek.
 */
export function cycleSheetDetent(current: SheetDetent): SheetDetent {
  const idx = DETENT_ORDER.indexOf(current);
  return DETENT_ORDER[(idx + 1) % DETENT_ORDER.length];
}

/**
 * Resolves the target detent after a touch/pointer drag ends.
 * - Fast upward flicks (`velocityPxPerMs < -threshold`) step up one detent.
 * - Fast downward flicks (`velocityPxPerMs > threshold`) step down one detent.
 * - Slow drags snap to the closest detent height.
 */
export function resolveSheetSnapDetent(params: {
  currentDetent: SheetDetent;
  endHeightPx: number;
  containerHeightPx: number;
  /** Positive means dragging downward (shrinking sheet); negative means dragging upward (expanding sheet). */
  velocityPxPerMs: number;
}): SheetDetent {
  const { currentDetent, endHeightPx, containerHeightPx, velocityPxPerMs } = params;
  const heights = getSheetDetentHeights(containerHeightPx);
  const curIdx = DETENT_ORDER.indexOf(currentDetent);

  if (velocityPxPerMs <= -SHEET_FLICK_VELOCITY_THRESHOLD) {
    // Fast flick upward
    if (endHeightPx > (heights.half + heights.full) / 2) return 'full';
    return DETENT_ORDER[Math.min(DETENT_ORDER.length - 1, curIdx + 1)];
  }

  if (velocityPxPerMs >= SHEET_FLICK_VELOCITY_THRESHOLD) {
    // Fast flick downward
    if (endHeightPx < (heights.peek + heights.half) / 2) return 'peek';
    return DETENT_ORDER[Math.max(0, curIdx - 1)];
  }

  // Slow release: pick nearest detent height
  let best: SheetDetent = 'half';
  let bestDist = Infinity;
  for (const detent of DETENT_ORDER) {
    const dist = Math.abs(endHeightPx - heights[detent]);
    if (dist < bestDist) {
      bestDist = dist;
      best = detent;
    }
  }
  return best;
}

/**
 * Matches Tailwind's `lg` breakpoint (`min-width: 1024px`) so desktop keeps the
 * classic right-hand SideInspector while phones/tablets get the 3-detent sheet.
 */
export function useIsDesktopViewport(minWidthPx = 1024): boolean {
  const getMatches = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return true;
    }
    return window.matchMedia(`(min-width: ${minWidthPx}px)`).matches;
  };

  const [isDesktop, setIsDesktop] = useState<boolean>(getMatches);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(min-width: ${minWidthPx}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [minWidthPx]);

  return isDesktop;
}
