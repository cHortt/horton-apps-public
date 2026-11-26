import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  FileUp,
  GitBranch,
  Lock,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Printer,
  Search,
  Sun,
  Unlock,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import type { RigDocument, SearchHit } from '../schema/rig';
import { searchRig } from '../schema/helpers';
import type { AppViewMode } from '../store/useRigStore';

interface TopBarProps {
  rig: RigDocument;
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
  onExportRigJson: () => void;
  onImportRigJson: (text: string) => { ok: true } | { ok: false; error: string };
  onSelectSearchHit: (hit: SearchHit) => void;
}

export function TopBar({
  rig,
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
  onExportRigJson,
  onImportRigJson,
  onSelectSearchHit,
}: TopBarProps) {
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rigFileInputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => searchRig(rig, query), [rig, query]);

  // '/' keyboard shortcut focuses global search-and-trace
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'SELECT'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  return (
    <header className="no-print relative z-30 flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2.5 shadow-2xs">
      {/* Left: Brand & Rig Name */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 dark:bg-sky-500/15 dark:border dark:border-sky-400/30 text-sky-400 font-mono text-sm font-bold tracking-tight">
          W
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {editMode ? (
              <input
                type="text"
                aria-label="Rig name"
                value={rig.name}
                onChange={(e) => onUpdateRigName(e.target.value)}
                className="w-48 sm:w-56 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 text-sm font-bold text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
              />
            ) : (
              <h1 className="truncate text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {rig.name}
              </h1>
            )}
            <span className="hidden lg:inline-flex items-center rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600 dark:text-slate-400">
              WING Rig Visualizer
            </span>
          </div>
        </div>
      </div>

      {/* Center: Global Search-and-Trace */}
      {view === 'canvas' && (
        <div className="relative flex-1 max-w-md min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 160)}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search & trace any channel, bus, +48V, cable tag... (/)"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 pl-8 pr-8 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-sky-500/15 focus:outline-none"
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

          {searchFocused && query.trim().length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
              {hits.length === 0 ? (
                <div className="px-3.5 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  No matches for &ldquo;{query}&rdquo;
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {hits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          onSelectSearchHit(hit);
                          setQuery('');
                          setSearchFocused(false);
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-sky-50 dark:hover:bg-sky-950/60 transition-colors cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                              {hit.label}
                            </span>
                            {hit.badge && (
                              <span className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0 font-mono text-[9.5px] font-semibold text-slate-600 dark:text-slate-300">
                                {hit.badge}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {hit.sublabel}
                          </div>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-sky-50 dark:bg-sky-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                          <GitBranch className="w-3 h-3" />
                          Trace
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Right: Mode Toggle & Actions */}
      <div className="flex items-center gap-1.5 flex-wrap">
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
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                editMode
                  ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-600/60 dark:bg-amber-950/70 dark:text-amber-200 dark:hover:bg-amber-950'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {editMode ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              <span>{editMode ? 'Edit Mode' : 'Read-Only'}</span>
            </button>

            {editMode && (
              <button
                type="button"
                onClick={onOpenAddGear}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Add Gear</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenSnapImport}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-slate-950 shadow-2xs cursor-pointer"
            >
              <FileUp className="w-3.5 h-3.5" />
              <span>Import .snap</span>
            </button>

            <input
              ref={rigFileInputRef}
              type="file"
              accept=".json,.rig.json"
              onChange={handleRigFileChange}
              className="hidden"
            />
            <button
              type="button"
              title="Import portable .rig.json"
              onClick={() => rigFileInputRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">.rig.json</span>
            </button>
            <button
              type="button"
              title="Export portable .rig.json"
              onClick={onExportRigJson}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
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
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            view === 'patch'
              ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800 dark:border-sky-400 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400'
              : stagedCount > 0
                ? 'border-sky-400 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:border-sky-600 dark:bg-sky-950/60 dark:text-sky-200 dark:hover:bg-sky-950'
                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
          }`}
        >
          <Wrench className="w-3.5 h-3.5" />
          <span>{view === 'patch' ? 'Schematic' : 'Patch Studio'}</span>
          {stagedCount > 0 && (
            <span className="rounded-full bg-sky-600 dark:bg-sky-400 px-1.5 py-0 font-mono text-[10px] font-bold text-white dark:text-slate-950">
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
          onClick={() => onToggleView(view === 'print' ? 'canvas' : 'print')}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            view === 'print'
              ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800 dark:border-sky-400 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400'
              : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
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
            className={`inline-flex items-center justify-center rounded-lg border p-1.5 transition-colors cursor-pointer ${
              inspectorCollapsed
                ? 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-300 dark:hover:bg-sky-950'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
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
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 text-slate-700 dark:text-amber-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
        >
          {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
      </div>

      {importError && (
        <div className="w-full rounded-lg border border-rose-200 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/60 px-3 py-1.5 text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between">
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
