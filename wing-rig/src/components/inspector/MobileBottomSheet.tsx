import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Layers } from 'lucide-react';
import {
  clampSheetHeightPx,
  cycleSheetDetent,
  getSheetDetentHeights,
  resolveSheetSnapDetent,
  type SheetDetent,
} from './mobileSheet';

interface MobileBottomSheetProps {
  detent: SheetDetent;
  onDetentChange: (next: SheetDetent) => void;
  title: string;
  subtitle: string;
  hasSelection: boolean;
  onClearSelection: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

const DETENT_OPTIONS: readonly { id: SheetDetent; label: string }[] = [
  { id: 'peek', label: 'Peek' },
  { id: 'half', label: 'Half' },
  { id: 'full', label: 'Full' },
];

export function MobileBottomSheet({
  detent,
  onDetentChange,
  title,
  subtitle,
  hasSelection,
  onClearSelection,
  containerRef,
  children,
}: MobileBottomSheetProps) {
  const [containerHeight, setContainerHeight] = useState<number>(() =>
    typeof window !== 'undefined' ? Math.max(420, window.innerHeight - 52) : 640,
  );
  const [dragHeightPx, setDragHeightPx] = useState<number | null>(null);

  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    lastY: number;
    lastTime: number;
    velocity: number;
    moved: boolean;
    currentHeight: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const h = el.getBoundingClientRect().height;
      if (h > 100) setContainerHeight(h);
    };

    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [containerRef]);

  const heights = getSheetDetentHeights(containerHeight);
  const targetHeightPx = dragHeightPx ?? heights[detent];
  const isDragging = dragHeightPx !== null;
  const isPeek = !isDragging && detent === 'peek';

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Allow buttons inside the handle header to process normal clicks without hijacking
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const startHeight = heights[detent];
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startHeight,
      lastY: e.clientY,
      lastTime: performance.now(),
      velocity: 0,
      moved: false,
      currentHeight: startHeight,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture errors on synthetic events
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const deltaY = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaY) < 6) return;

    const now = performance.now();
    const dt = Math.max(1, now - drag.lastTime);
    const instantVelocity = (e.clientY - drag.lastY) / dt;
    drag.velocity = drag.velocity * 0.4 + instantVelocity * 0.6;
    drag.lastY = e.clientY;
    drag.lastTime = now;
    drag.moved = true;

    const nextHeight = clampSheetHeightPx(drag.startHeight - deltaY, containerHeight);
    drag.currentHeight = nextHeight;
    setDragHeightPx(nextHeight);
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }

    if (drag.moved) {
      const snapped = resolveSheetSnapDetent({
        currentDetent: detent,
        endHeightPx: drag.currentHeight,
        containerHeightPx: containerHeight,
        velocityPxPerMs: drag.velocity,
      });
      setDragHeightPx(null);
      onDetentChange(snapped);
    } else {
      setDragHeightPx(null);
    }
  };

  return (
    <>
      {/* Subtle scrim over top canvas strip when sheet is Full; tap drops to Half */}
      {detent === 'full' && !isDragging && (
        <div
          aria-hidden="true"
          onClick={() => onDetentChange('half')}
          className="absolute inset-0 z-20 bg-slate-950/20 dark:bg-black/45 transition-opacity"
        />
      )}

      <section
        aria-label="Rig Inspector Sheet"
        style={{ height: `${targetHeightPx}px` }}
        className={`absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-xl border-t border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] shadow-[0_-8px_28px_rgba(15,23,42,0.18)] dark:shadow-[0_-10px_32px_rgba(0,0,0,0.55)] pb-[env(safe-area-inset-bottom)] ${
          isDragging ? '' : 'transition-[height] duration-200 ease-out'
        }`}
      >
        {/* Drag Handle & Detent Bar */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          className="shrink-0 touch-none select-none border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] px-3 pt-1.5 pb-2 cursor-grab active:cursor-grabbing"
        >
          {/* Grabber Pill */}
          <div className="flex justify-center pb-1.5">
            <button
              type="button"
              onClick={() => onDetentChange(cycleSheetDetent(detent))}
              aria-label={`Resize Rig Inspector sheet (currently ${detent})`}
              title="Tap or drag to resize Rig Inspector"
              className="group flex items-center justify-center px-8 py-1 -my-1 cursor-pointer"
            >
              <span className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600 group-hover:bg-sky-500 transition-colors" />
            </button>
          </div>

          {/* Summary (Peek) or Navigation + Detent Pills (Half/Full) */}
          <div className="flex items-center justify-between gap-2">
            {isPeek ? (
              <button
                type="button"
                onClick={() => onDetentChange('half')}
                className="min-w-0 flex-1 text-left cursor-pointer"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {!hasSelection && (
                    <Layers className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                  )}
                  <span className="font-display text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                    {title}
                  </span>
                </div>
                <div className="font-mono text-[10.5px] text-slate-500 dark:text-slate-400 truncate tabular-nums">
                  {subtitle}
                </div>
              </button>
            ) : hasSelection ? (
              <button
                type="button"
                onClick={onClearSelection}
                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                <span>Rig Overview</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5 min-w-0">
                <Layers className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400 shrink-0" />
                <span className="font-display text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                  Rig Overview
                </span>
              </div>
            )}

            {/* 1-Tap Detent Quick-Snap Pills */}
            <div
              role="group"
              aria-label="Sheet height"
              className="inline-flex shrink-0 rounded-[2px] border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0b111d] p-0.5 font-mono text-[10.5px]"
            >
              {DETENT_OPTIONS.map((opt) => {
                const active = detent === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onDetentChange(opt.id)}
                    aria-pressed={active}
                    className={`rounded-[1px] px-2 py-0.5 font-semibold transition-colors cursor-pointer ${
                      active
                        ? 'bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Keep inspector mounted so active tab/filter state survives Peek <-> Half/Full */}
        <div className={`min-h-0 flex-1 flex flex-col overflow-hidden ${isPeek ? 'hidden' : ''}`}>
          {children}
        </div>
      </section>
    </>
  );
}
