import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { AlertTriangle, Lock } from 'lucide-react';
import { useRigStore } from './store/useRigStore';
import { useTheme } from './store/useTheme';
import { TopBar } from './components/TopBar';
import { SystemCanvas } from './components/canvas/SystemCanvas';
import { SideInspector } from './components/inspector/SideInspector';
import { AddGearModal } from './components/inspector/AddGearModal';
import { SnapImportModal } from './components/import/SnapImportModal';
import { ShareRigModal } from './components/share/ShareRigModal';
import { PrintView } from './components/print/PrintView';
import { PatchStudio } from './components/patch/PatchStudio';
import type { SearchHit } from './schema/rig';

export function App() {
  const store = useRigStore();
  const { isDark, toggleTheme } = useTheme();
  const [snapModalOpen, setSnapModalOpen] = useState(false);
  const [snapTargetConsoleId, setSnapTargetConsoleId] = useState<string | undefined>(undefined);
  const [addGearModalOpen, setAddGearModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = store.lockedReadOnly
      ? `${store.rig.name} (Read-Only) — WING Rig Visualizer`
      : `${store.rig.name} — WING Rig Visualizer`;
  }, [store.rig.name, store.lockedReadOnly]);

  const openSnapModal = (targetConsoleId?: string) => {
    if (store.lockedReadOnly) return;
    setSnapTargetConsoleId(targetConsoleId);
    setSnapModalOpen(true);
  };

  const handleSelectSearchHit = (hit: SearchHit) => {
    if (hit.trunkId) {
      store.selectTrunk(hit.trunkId);
    } else {
      store.selectNode(hit.nodeId);
    }
    store.runTrace(hit.traceTarget);
  };

  const auditAlertCount = store.auditIssues.filter((i) => i.severity !== 'info').length;

  return (
    <div className="flex h-full flex-col bg-[#f3f5f8] text-slate-900 dark:bg-[#090d14] dark:text-slate-100">
      <TopBar
        rig={store.rig}
        lockedReadOnly={store.lockedReadOnly}
        shareSource={store.shareSource}
        editMode={store.editMode}
        view={store.view}
        isDark={isDark}
        inspectorCollapsed={store.inspectorCollapsed}
        stagedCount={store.stagedPatches.length}
        auditAlertCount={auditAlertCount}
        onToggleTheme={toggleTheme}
        onToggleInspector={store.toggleInspectorCollapsed}
        onToggleEditMode={() => store.setEditMode(!store.editMode)}
        onUpdateRigName={(name) => store.updateRigMeta({ name })}
        onToggleView={store.setView}
        onOpenSnapImport={() => openSnapModal()}
        onOpenAddGear={() => {
          if (!store.lockedReadOnly) setAddGearModalOpen(true);
        }}
        onOpenShare={() => {
          if (!store.lockedReadOnly) setShareModalOpen(true);
        }}
        onExportRigJson={store.exportRigJson}
        onImportRigJson={store.importRigJson}
        onSelectSearchHit={handleSelectSearchHit}
      />

      {store.sharedLoading ? (
        <main className="flex flex-1 items-center justify-center p-6">
          <div className="flex items-center gap-2.5 rounded-[2px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] px-4 py-3 text-xs font-mono text-slate-700 dark:text-slate-200 shadow-xs">
            <Lock className="w-4 h-4 text-sky-600 dark:text-sky-400 animate-pulse" />
            <span>Loading shared read-only rig...</span>
          </div>
        </main>
      ) : store.sharedLoadError ? (
        <main className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md w-full rounded-[2px] border border-rose-300 dark:border-rose-800/80 bg-white dark:bg-[#111827] p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="font-display text-sm font-bold">Unable to Open Shared Rig Link</h2>
            </div>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {store.sharedLoadError}
            </p>
            <div className="rounded-[2px] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b111d] px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
              Your browser&apos;s own saved rig data was not modified.
            </div>
          </div>
        </main>
      ) : store.view === 'print' ? (
        <main className="flex-1 overflow-y-auto">
          <PrintView rig={store.rig} onBack={() => store.setView('canvas')} />
        </main>
      ) : !store.lockedReadOnly && store.view === 'patch' ? (
        <main className="no-print flex-1 overflow-y-auto">
          <PatchStudio
            rig={store.rig}
            baselines={store.baselineMetas}
            stagedPatches={store.stagedPatches}
            linkConfig={store.linkConfig}
            auditIssues={store.auditIssues}
            patchUnlocked={store.patchUnlocked}
            onTogglePatchUnlocked={() => store.setPatchUnlocked(!store.patchUnlocked)}
            onUpdateLinkConfig={store.updateLinkConfig}
            onStagePatches={store.stagePatches}
            onRemoveStagedPatch={store.removeStagedPatch}
            onUndoLastStagedPatch={store.undoLastStagedPatch}
            onDiscardStagedPatches={store.discardStagedPatches}
            onExportPatchedSnap={store.exportPatchedSnap}
            onCommitConsoleBaseline={store.commitConsoleBaseline}
            onOpenSnapImport={(cid) => openSnapModal(cid)}
            onTraceOnSchematic={store.traceOnSchematic}
          />
        </main>
      ) : (
        <main className="no-print flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative min-h-0 flex-1">
            <ReactFlowProvider>
              <SystemCanvas
                rig={store.rig}
                editMode={store.editMode}
                isDark={isDark}
                inspectorCollapsed={store.inspectorCollapsed}
                selection={store.selection}
                trace={store.trace}
                onSelectNode={store.selectNode}
                onSelectTrunk={store.selectTrunk}
                onClearSelection={store.clearSelection}
                onClearTrace={store.clearTrace}
                onNodePositionChange={store.updateNodePosition}
                onExpandInspector={() => store.setInspectorCollapsed(false)}
              />
            </ReactFlowProvider>
          </div>

          {!store.inspectorCollapsed && (
            <div className="h-[46vh] lg:h-auto lg:w-[410px] xl:w-[440px] shrink-0 overflow-hidden">
              <SideInspector
                rig={store.rig}
                auditIssues={store.auditIssues}
                lockedReadOnly={store.lockedReadOnly}
                editMode={store.editMode}
                isDark={isDark}
                selection={store.selection}
                trace={store.trace}
                onSelectNode={store.selectNode}
                onSelectTrunk={store.selectTrunk}
                onClearSelection={store.clearSelection}
                onClearTrace={store.clearTrace}
                onCollapse={() => store.setInspectorCollapsed(true)}
                onRunTrace={store.runTrace}
                onTraceOnSchematic={store.traceOnSchematic}
                onUpdateNodeAnnotation={store.updateNodeAnnotation}
                onUpdateTrunkAnnotation={store.updateTrunkAnnotation}
                onUpdateChannelAnnotation={store.updateChannelAnnotation}
                onUpdateBusAnnotation={store.updateBusAnnotation}
                onDismissOrphan={store.dismissOrphan}
                onDeleteManualNode={store.deleteManualNode}
                onDeleteManualTrunk={store.deleteManualTrunk}
                onOpenSnapImport={() => openSnapModal()}
                onResetDemo={store.resetToDemoRig}
              />
            </div>
          )}
        </main>
      )}

      {!store.lockedReadOnly && snapModalOpen && (
        <SnapImportModal
          rig={store.rig}
          initialTargetConsoleId={snapTargetConsoleId}
          onClose={() => {
            setSnapModalOpen(false);
            setSnapTargetConsoleId(undefined);
          }}
          onApplyMerge={(parsed, targetConsoleId, rawSnapJson) => {
            store.applySnapshot(parsed, targetConsoleId, rawSnapJson);
          }}
        />
      )}

      {!store.lockedReadOnly && addGearModalOpen && (
        <AddGearModal
          rig={store.rig}
          onClose={() => setAddGearModalOpen(false)}
          onAddNode={store.addManualNode}
          onAddTrunk={store.addManualTrunk}
        />
      )}

      {!store.lockedReadOnly && shareModalOpen && (
        <ShareRigModal
          rig={store.rig}
          stagedCount={store.stagedPatches.length}
          onClose={() => setShareModalOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
