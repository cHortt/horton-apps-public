import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  FileUp,
  GitBranch,
  Lock,
  Moon,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Printer,
  Search,
  Share2,
  Sun,
  Unlock,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import type { RigDocument, SearchHit } from '../schema/rig';
import { searchRig } from '../schema/helpers';
import type { AppViewMode } from '../store/useRigStore';
import type { ShareSource } from '../store/shareLink';

interface TopBarProps {
  rig: RigDocument;
  lockedReadOnly: boolean;
  shareSource: ShareSource;
  editMode: boolean;
  view: AppViewMode;
  isDark: boolean;
  inspectorCollapsed: boolean;
  stagedCount: number;
  auditAlertCount: number;
  onToggleTheme: () => void;
  onToggleInspector: () => void;
  onToggleEditMode: () => void;
  onUpdateRigName: (name: string) => void;
  onToggleView: (view: AppViewMode) => void;
  onOpenSnapImport: () => void;
  onOpenAddGear: () => void;
  onOpenShare: () => void;
  onExportRigJson: () => void;
  onImportRigJson: (text: string) => { ok: true } | { ok: false; error: string };
  onSelectSearchHit: (hit: SearchHit) => void;
}

export function TopBar({
  rig,
  lockedReadOnly,
  shareSource,
  editMode,
  view,
  isDark,
  inspectorCollapsed,
  stagedCount,
  auditAlertCount,
  onToggleTheme,
  onToggleInspector,
  onToggleEditMode,
  onUpdateRigName,
  onToggleView,
  onOpenSnapImport,
  onOpenAddGear,
  onOpenShare,
  onExportRigJson,
  onImportRigJson,
  onSelectSearchHit,
}: TopBarProps) {
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const rigFileInputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => searchRig(rig, query), [rig, query]);

  // '/' keyboard shortcut focuses global search-and-trace; Escape closes mobile overlays
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mobileSearchOpen) {
          setMobileSearchOpen(false);
          setQuery('');
          setSearchFocused(false);
        }
        if (mobileMenuOpen) {
          setMobileMenuOpen(false);
        }
        return;
      }
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'SELECT'
      ) {
        e.preventDefault();
        if (searchInputRef.current && searchInputRef.current.offsetParent !== null) {
          searchInputRef.current.focus();
        } else {
          setMobileSearchOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileSearchOpen, mobileMenuOpen]);

  useEffect(() => {
    if (mobileSearchOpen) {
      mobileSearchInputRef.current?.focus();
    }
  }, [mobileSearchOpen]);

  // Close mobile overflow menu on outside pointer click
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [mobileMenuOpen]);

  const handleRigFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const res = onImportRigJson(text);
    if (!res.ok) {
      setImportError(res.error);
    } else {
      setImportError(null);
    }
  };

  const handlePickHit = (hit: SearchHit) => {
    onSelectSearchHit(hit);
    setQuery('');
    setSearchFocused(false);
    setMobileSearchOpen(false);
  };

  const renderSearchResults = () => (
    <div className="absolute left-0 right-0 top-full mt-1 max-h-80 overflow-y-auto rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] shadow-lg z-50">
      {hits.length === 0 ? (
        <div className="px-3.5 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
          No matches for &ldquo;{query}&rdquo;
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handlePickHit(hit);
                }}
                onClick={() => handlePickHit(hit)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 lg:py-2 text-left hover:bg-sky-50 dark:hover:bg-sky-950/60 transition-colors cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {hit.label}
                    </span>
                    {hit.badge && (
                      <span className="rounded-[1px] border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1 py-0 font-mono text-[9.5px] font-semibold text-slate-600 dark:text-slate-300">
                        {hit.badge}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {hit.sublabel}
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-[1px] border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                  <GitBranch className="w-3 h-3" />
                  Trace
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const mobileMenuHasBadge = !lockedReadOnly && (stagedCount > 0 || auditAlertCount > 0 || editMode);

  return (
    <header className="no-print relative z-40 border-b border-slate-300 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xs">
      {/* Shared hidden file input for .rig.json import */}
      <input
        ref={rigFileInputRef}
        type="file"
        accept=".json,.rig.json"
        onChange={handleRigFileChange}
        className="hidden"
      />

      {/* =================================================================== */}
      {/* Compact 1-Row Mobile / Tablet Header (< lg)                         */}
      {/* =================================================================== */}
      <div className="relative flex lg:hidden h-12 items-center justify-between gap-2 px-3">
        <div className="flex items-center gap-2 min-w-0">
          <div
            style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}
            className="flex h-7 w-7 shrink-0 items-center justify-center bg-slate-900 dark:bg-sky-500 text-sky-400 dark:text-slate-950 font-mono text-xs font-bold tracking-tight"
          >
            W
          </div>
          <div className="min-w-0">
            {!lockedReadOnly && editMode ? (
              <input
                type="text"
                aria-label="Rig name"
                value={rig.name}
                onChange={(e) => onUpdateRigName(e.target.value)}
                className="w-40 sm:w-52 rounded-[2px] border border-amber-400 dark:border-amber-600/80 bg-amber-50/60 dark:bg-[#0b111d] px-1.5 py-0.5 font-display text-sm font-bold text-slate-900 dark:text-slate-100 focus:border-sky-600 focus:outline-none"
              />
            ) : (
              <div className="flex items-center gap-1.5 min-w-0">
                <h1 className="font-display truncate text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {rig.name}
                </h1>
              </div>
            )}
            <div className="flex items-center gap-1.5 font-mono text-[10px] leading-tight text-slate-500 dark:text-slate-400">
              {lockedReadOnly ? (
                <span className="inline-flex items-center gap-0.5 text-sky-700 dark:text-sky-400 font-semibold">
                  <Lock className="w-2.5 h-2.5" />
                  {shareSource === 'embedded' ? 'Shared · Read-Only' : 'Read-Only'}
                </span>
              ) : editMode ? (
                <span className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-400 font-semibold">
                  <Unlock className="w-2.5 h-2.5" />
                  Edit Mode
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5">
                  <Lock className="w-2.5 h-2.5" />
                  Read-Only
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {view !== 'canvas' && (
            <button
              type="button"
              onClick={() => onToggleView('canvas')}
              className="inline-flex items-center gap-1 rounded-[2px] border border-slate-900 dark:border-sky-400 bg-slate-900 dark:bg-sky-500 px-2.5 py-1.5 text-xs font-semibold text-white dark:text-slate-950 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Schematic</span>
            </button>
          )}

          {view === 'canvas' && (
            <button
              type="button"
              aria-label="Search and trace rig"
              title="Search & trace any channel, bus, +48V, cable tag"
              onClick={() => {
                setMobileMenuOpen(false);
                setMobileSearchOpen(true);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
            >
              <Search className="w-4 h-4" />
            </button>
          )}

          <div ref={mobileMenuRef} className="relative">
            <button
              type="button"
              aria-label="More rig actions"
              aria-expanded={mobileMenuOpen}
              onClick={() => {
                setMobileSearchOpen(false);
                setMobileMenuOpen((open) => !open);
              }}
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
            >
              <MoreHorizontal className="w-4 h-4" />
              {mobileMenuHasBadge && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-[#111827]" />
              )}
            </button>

            {mobileMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-56 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] py-1 shadow-xl z-50 text-xs">
                {!lockedReadOnly && (
                  <>
                    {view === 'canvas' && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onToggleEditMode();
                            setMobileMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-semibold hover:bg-slate-50 dark:hover:bg-slate-800/70 cursor-pointer ${
                            editMode
                              ? 'text-amber-800 dark:text-amber-300'
                              : 'text-slate-800 dark:text-slate-100'
                          }`}
                        >
                          <span className="inline-flex items-center gap-2">
                            {editMode ? (
                              <Unlock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                            ) : (
                              <Lock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                            )}
                            <span>{editMode ? 'Return to Read-Only' : 'Unlock Edit Mode'}</span>
                          </span>
                        </button>

                        {editMode && (
                          <button
                            type="button"
                            onClick={() => {
                              onOpenAddGear();
                              setMobileMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/70 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                            <span>Add Gear / Trunk</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            onOpenSnapImport();
                            setMobileMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left font-semibold text-sky-700 dark:text-sky-400 hover:bg-sky-50/70 dark:hover:bg-sky-950/40 cursor-pointer"
                        >
                          <FileUp className="w-3.5 h-3.5" />
                          <span>Import WING .snap</span>
                        </button>

                        <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        onToggleView(view === 'patch' ? 'canvas' : 'patch');
                        setMobileMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/70 cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Wrench className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                        <span>{view === 'patch' ? 'Back to Schematic' : 'Patch Studio'}</span>
                      </span>
                      {stagedCount > 0 ? (
                        <span className="rounded-[1px] bg-sky-600 dark:bg-sky-400 px-1.5 py-0 font-mono text-[10px] font-bold text-white dark:text-slate-950">
                          {stagedCount}
                        </span>
                      ) : auditAlertCount > 0 && view !== 'patch' ? (
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                      ) : null}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onOpenShare();
                        setMobileMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/70 cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                      <span>Share Read-Only Link</span>
                    </button>

                    {view === 'canvas' && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setMobileMenuOpen(false);
                            rigFileInputRef.current?.click();
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/70 cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                          <span>Import .rig.json</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onExportRigJson();
                            setMobileMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/70 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                          <span>Export .rig.json</span>
                        </button>
                      </>
                    )}

                    <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                  </>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onToggleView(view === 'print' ? 'canvas' : 'print');
                    setMobileMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/70 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>{view === 'print' ? 'Back to Schematic' : 'Print / PDF Binder'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onToggleTheme();
                    setMobileMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/70 cursor-pointer"
                >
                  {isDark ? (
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <Moon className="w-3.5 h-3.5 text-slate-500" />
                  )}
                  <span>{isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Expandable Full-Width Mobile Global Search Overlay */}
        {mobileSearchOpen && view === 'canvas' && (
          <div className="absolute inset-0 z-50 flex items-center gap-2 bg-white dark:bg-[#111827] px-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <input
                ref={mobileSearchInputRef}
                type="text"
                value={query}
                onFocus={() => setSearchFocused(true)}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search & trace channel, bus, +48V..."
                className="w-full rounded-[2px] border border-sky-500 bg-[#f3f5f8] dark:bg-[#0b111d] pl-8 pr-7 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-[#090d14] focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {query.trim().length > 0 && renderSearchResults()}
            </div>

            <button
              type="button"
              onClick={() => {
                setMobileSearchOpen(false);
                setQuery('');
                setSearchFocused(false);
              }}
              className="shrink-0 rounded-[2px] px-2 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* Full Desktop Header (lg and up — unchanged desktop workflow)        */}
      {/* =================================================================== */}
      <div className="hidden lg:flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5">
        {/* Left: Brand & Rig Name */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            style={{ clipPath: 'polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%)' }}
            className="flex h-8 w-8 shrink-0 items-center justify-center bg-slate-900 dark:bg-sky-500 text-sky-400 dark:text-slate-950 font-mono text-sm font-bold tracking-tight"
          >
            W
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {!lockedReadOnly && editMode ? (
                <input
                  type="text"
                  aria-label="Rig name"
                  value={rig.name}
                  onChange={(e) => onUpdateRigName(e.target.value)}
                  className="w-48 sm:w-56 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0b111d] px-1.5 py-0.5 font-display text-base font-bold text-slate-900 dark:text-slate-100 focus:border-sky-600 focus:bg-white dark:focus:bg-[#090d14] focus:outline-none"
                />
              ) : (
                <h1 className="font-display truncate text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {rig.name}
                </h1>
              )}
              <span className="hidden lg:inline-flex items-center rounded-[1px] border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-[#0b111d] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                WING Rig Visualizer
              </span>
            </div>
          </div>
        </div>

        {/* Center: Global Search-and-Trace */}
        {view === 'canvas' && (
          <div className="relative flex-1 max-w-md min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 160)}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search & trace any channel, bus, +48V, cable tag... (/)"
              className="w-full rounded-[2px] border border-slate-300 dark:border-slate-700 bg-[#f3f5f8] dark:bg-[#0b111d] pl-8 pr-8 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-600 focus:bg-white dark:focus:bg-[#090d14] focus:ring-1 focus:ring-sky-500/25 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {searchFocused && query.trim().length > 0 && renderSearchResults()}
          </div>
        )}

        {/* Right: Mode Toggle & Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {lockedReadOnly ? (
            <span
              title="This view is locked to Read-Only mode. You can browse, search, trace signals, and print."
              className="inline-flex items-center gap-1.5 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 select-none"
            >
              <Lock className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>{shareSource === 'embedded' ? 'Shared · Read-Only' : 'Read-Only View'}</span>
            </span>
          ) : (
            <>
              {view === 'canvas' && (
                <>
                  <button
                    type="button"
                    onClick={onToggleEditMode}
                    title={
                      editMode
                        ? 'Editing unlocked — click to return to safe Read-Only mode'
                        : 'Read-Only Mode (volunteer-safe) — click to unlock layout & label editing'
                    }
                    className={`inline-flex items-center gap-1.5 rounded-[2px] border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      editMode
                        ? 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-600/70 dark:bg-amber-950/70 dark:text-amber-200 dark:hover:bg-amber-950'
                        : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {editMode ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    <span>{editMode ? 'Edit Mode' : 'Read-Only'}</span>
                  </button>

                  {editMode && (
                    <button
                      type="button"
                      onClick={onOpenAddGear}
                      className="inline-flex items-center gap-1 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Add Gear</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onOpenSnapImport}
                    className="inline-flex items-center gap-1.5 rounded-[2px] bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 cursor-pointer"
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    <span>Import .snap</span>
                  </button>

                  <button
                    type="button"
                    title="Import portable .rig.json"
                    onClick={() => rigFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span className="hidden xl:inline font-mono text-[11px]">.rig.json</span>
                  </button>
                  <button
                    type="button"
                    title="Export portable .rig.json"
                    onClick={onExportRigJson}
                    className="inline-flex items-center gap-1 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span className="hidden xl:inline">Export</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => onToggleView(view === 'patch' ? 'canvas' : 'patch')}
                title="Open WING Patch Studio to edit sources, splits, mix buses, verify paths, and export .snap files"
                className={`inline-flex items-center gap-1.5 rounded-[2px] border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  view === 'patch'
                    ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800 dark:border-sky-400 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400'
                    : stagedCount > 0
                      ? 'border-sky-500 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:border-sky-600 dark:bg-sky-950/60 dark:text-sky-200 dark:hover:bg-sky-950'
                      : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>{view === 'patch' ? 'Schematic' : 'Patch Studio'}</span>
                {stagedCount > 0 && (
                  <span className="rounded-[1px] bg-sky-600 dark:bg-sky-400 px-1.5 py-0 font-mono text-[10px] font-bold text-white dark:text-slate-950">
                    {stagedCount}
                  </span>
                )}
                {stagedCount === 0 && auditAlertCount > 0 && view !== 'patch' && (
                  <span
                    title={`${auditAlertCount} path verifier alert(s)`}
                    className="h-2 w-2 rounded-full bg-amber-500"
                  />
                )}
              </button>

              <button
                type="button"
                onClick={onOpenShare}
                title="Share a locked Read-Only link to your current rig"
                className="inline-flex items-center gap-1.5 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:border-sky-500 hover:bg-sky-50/60 dark:hover:border-sky-500 dark:hover:bg-sky-950/40 transition-colors cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <span>Share</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => onToggleView(view === 'print' ? 'canvas' : 'print')}
            className={`inline-flex items-center gap-1.5 rounded-[2px] border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              view === 'print'
                ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800 dark:border-sky-400 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400'
                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{view === 'print' ? 'Schematic' : 'Print / PDF'}</span>
          </button>

          {view === 'canvas' && (
            <button
              type="button"
              onClick={onToggleInspector}
              aria-label={inspectorCollapsed ? 'Expand Rig Inspector' : 'Collapse Rig Inspector'}
              title={
                inspectorCollapsed
                  ? 'Show Rig Inspector panel'
                  : 'Collapse Rig Inspector for full-screen topology view'
              }
              className={`inline-flex items-center justify-center rounded-[2px] border p-1.5 transition-colors cursor-pointer ${
                inspectorCollapsed
                  ? 'border-sky-500 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-300 dark:hover:bg-sky-950'
                  : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {inspectorCollapsed ? (
                <PanelRightOpen className="w-3.5 h-3.5" />
              ) : (
                <PanelRightClose className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex items-center justify-center rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 p-1.5 text-slate-700 dark:text-amber-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {importError && (
        <div className="mx-3 lg:mx-4 mb-2 rounded-[2px] border border-rose-300 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/60 px-3 py-1.5 text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between">
          <span>Could not import .rig.json: {importError}</span>
          <button
            type="button"
            onClick={() => setImportError(null)}
            className="text-rose-600 dark:text-rose-300 hover:text-rose-900 dark:hover:text-rose-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </header>
  );
}

