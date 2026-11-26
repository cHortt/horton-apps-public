import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  FileUp,
  GitBranch,
  Lock,
  Plus,
  Printer,
  Search,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import type { RigDocument, SearchHit } from '../schema/rig';
import { searchRig } from '../schema/helpers';
import type { AppViewMode } from '../store/useRigStore';

interface TopBarProps {
  rig: RigDocument;
  editMode: boolean;
  view: AppViewMode;
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
    <header className="no-print relative z-30 flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 bg-white px-4 py-2.5 shadow-2xs">
      {/* Left: Brand & Rig Name */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sky-400 font-mono text-sm font-bold tracking-tight">
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
                className="w-48 sm:w-56 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-sm font-bold text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none"
              />
            ) : (
              <h1 className="truncate text-sm font-bold tracking-tight text-slate-900">
                {rig.name}
              </h1>
            )}
            <span className="hidden lg:inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600">
              WING Rig Visualizer
            </span>
          </div>
        </div>
      </div>

      {/* Center: Global Search-and-Trace */}
      {view === 'canvas' && (
        <div className="relative flex-1 max-w-md min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 160)}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search & trace any channel, bus, +48V, cable tag... (/)"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-8 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-500/15 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {searchFocused && query.trim().length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              {hits.length === 0 ? (
                <div className="px-3.5 py-4 text-center text-xs text-slate-500">
                  No matches for &ldquo;{query}&rdquo;
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
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
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-sky-50 transition-colors cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-semibold text-slate-900">
                              {hit.label}
                            </span>
                            {hit.badge && (
                              <span className="rounded bg-slate-100 px-1 py-0 font-mono text-[9.5px] font-semibold text-slate-600">
                                {hit.badge}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-slate-500">{hit.sublabel}</div>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
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
                  ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {editMode ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              <span>{editMode ? 'Edit Mode' : 'Read-Only'}</span>
            </button>

            {editMode && (
              <button
                type="button"
                onClick={onOpenAddGear}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Add Gear</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenSnapImport}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 shadow-2xs cursor-pointer"
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
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">.rig.json</span>
            </button>
            <button
              type="button"
              title="Export portable .rig.json"
              onClick={onExportRigJson}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Export</span>
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => onToggleView(view === 'canvas' ? 'print' : 'canvas')}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            view === 'print'
              ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
              : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
          }`}
        >
          <Printer className="w-3.5 h-3.5" />
          <span>{view === 'print' ? 'Back to Schematic' : 'Print / PDF'}</span>
        </button>
      </div>

      {importError && (
        <div className="w-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-800 flex items-center justify-between">
          <span>Could not import .rig.json: {importError}</span>
          <button
            type="button"
            onClick={() => setImportError(null)}
            className="text-rose-600 hover:text-rose-900 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </header>
  );
}
