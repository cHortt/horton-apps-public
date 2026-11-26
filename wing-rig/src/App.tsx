import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useRigStore } from './store/useRigStore';
import { TopBar } from './components/TopBar';
import { SystemCanvas } from './components/canvas/SystemCanvas';
import { SideInspector } from './components/inspector/SideInspector';
import { AddGearModal } from './components/inspector/AddGearModal';
import { SnapImportModal } from './components/import/SnapImportModal';
import { PrintView } from './components/print/PrintView';
import type { SearchHit } from './schema/rig';

export function App() {
  const store = useRigStore();
  const [snapModalOpen, setSnapModalOpen] = useState(false);
  const [addGearModalOpen, setAddGearModalOpen] = useState(false);

  const handleSelectSearchHit = (hit: SearchHit) => {
    if (hit.trunkId) {
      store.selectTrunk(hit.trunkId);
    } else {
      store.selectNode(hit.nodeId);
    }
    store.runTrace(hit.traceTarget);
  };

  return (
    <div className="flex h-full flex-col bg-slate-50 text-slate-900">
      <TopBar
        rig={store.rig}
        editMode={store.editMode}
        view={store.view}
        onToggleEditMode={() => store.setEditMode(!store.editMode)}
        onUpdateRigName={(name) => store.updateRigMeta({ name })}
        onToggleView={store.setView}
        onOpenSnapImport={() => setSnapModalOpen(true)}
        onOpenAddGear={() => setAddGearModalOpen(true)}
        onExportRigJson={store.exportRigJson}
        onImportRigJson={store.importRigJson}
        onSelectSearchHit={handleSelectSearchHit}
      />

      {store.view === 'print' ? (
        <main className="flex-1 overflow-y-auto">
          <PrintView rig={store.rig} onBack={() => store.setView('canvas')} />
        </main>
      ) : (
        <main className="no-print flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative min-h-[380px] flex-1">
            <ReactFlowProvider>
              <SystemCanvas
                rig={store.rig}
                editMode={store.editMode}
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
              onOpenSnapImport={() => setSnapModalOpen(true)}
              onResetDemo={store.resetToDemoRig}
            />
          </div>
        </main>
      )}

      {snapModalOpen && (
        <SnapImportModal
          rig={store.rig}
          onClose={() => setSnapModalOpen(false)}
          onApplyMerge={(parsed, targetConsoleId) => {
            store.applySnapshot(parsed, targetConsoleId);
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
