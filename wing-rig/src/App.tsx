import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useRigStore } from './store/useRigStore';
import { useTheme } from './store/useTheme';
import { TopBar } from './components/TopBar';
import { SystemCanvas } from './components/canvas/SystemCanvas';
import { SideInspector } from './components/inspector/SideInspector';
import { AddGearModal } from './components/inspector/AddGearModal';
import { SnapImportModal } from './components/import/SnapImportModal';
import { PrintView } from './components/print/PrintView';
import { PatchStudio } from './components/patch/PatchStudio';
import type { SearchHit } from './schema/rig';

export function App() {
  const store = useRigStore();
  const { isDark, toggleTheme } = useTheme();
  const [snapModalOpen, setSnapModalOpen] = useState(false);
  const [snapTargetConsoleId, setSnapTargetConsoleId] = useState<string | undefined>(undefined);
  const [addGearModalOpen, setAddGearModalOpen] = useState(false);

  const openSnapModal = (targetConsoleId?: string) => {
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
    <div className="flex h-full flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <TopBar
        rig={store.rig}
        editMode={store.editMode}
        view={store.view}
        isDark={isDark}
        stagedCount={store.stagedPatches.length}
        auditAlertCount={auditAlertCount}
        onToggleTheme={toggleTheme}
        onToggleEditMode={() => store.setEditMode(!store.editMode)}
        onUpdateRigName={(name) => store.updateRigMeta({ name })}
        onToggleView={store.setView}
        onOpenSnapImport={() => openSnapModal()}
        onOpenAddGear={() => setAddGearModalOpen(true)}
        onExportRigJson={store.exportRigJson}
        onImportRigJson={store.importRigJson}
        onSelectSearchHit={handleSelectSearchHit}
      />

      {store.view === 'print' ? (
        <main className="flex-1 overflow-y-auto">
          <PrintView rig={store.rig} onBack={() => store.setView('canvas')} />
        </main>
      ) : store.view === 'patch' ? (
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
          <div className="relative min-h-[380px] flex-1">
            <ReactFlowProvider>
              <SystemCanvas
                rig={store.rig}
                editMode={store.editMode}
                isDark={isDark}
                selection={store.selection}
                trace={store.trace}
                onSelectNode={store.selectNode}
                onSelectTrunk={store.selectTrunk}
                onClearSelection={store.clearSelection}
                onClearTrace={store.clearTrace}
                onNodePositionChange={store.updateNodePosition}
              />
            </ReactFlowProvider>
          </div>

          <div className="h-[46vh] lg:h-auto lg:w-[410px] xl:w-[440px] shrink-0 overflow-hidden">
            <SideInspector
              rig={store.rig}
              editMode={store.editMode}
              isDark={isDark}
              selection={store.selection}
              trace={store.trace}
              onSelectNode={store.selectNode}
              onSelectTrunk={store.selectTrunk}
              onClearSelection={store.clearSelection}
              onRunTrace={store.runTrace}
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
        </main>
      )}

      {snapModalOpen && (
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

      {addGearModalOpen && (
        <AddGearModal
          rig={store.rig}
          onClose={() => setAddGearModalOpen(false)}
          onAddNode={store.addManualNode}
          onAddTrunk={store.addManualTrunk}
        />
      )}
    </div>
  );
}

export default App;
