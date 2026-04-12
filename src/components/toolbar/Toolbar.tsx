import { useModelerStore } from '../../store/modelerStore';
import { workerBridge } from '../../engine/workerBridge';
import { triggerDownload } from '../../utils/download';
import { useChatStore } from '../../store/chatStore';

export function Toolbar() {
  const projectName = useModelerStore((s) => s.projectName);
  const setProjectName = useModelerStore((s) => s.setProjectName);
  const tree = useModelerStore((s) => s.tree);
  const evaluating = useModelerStore((s) => s.evaluating);
  const undo = useModelerStore((s) => s.undo);
  const redo = useModelerStore((s) => s.redo);
  const toJSON = useModelerStore((s) => s.toJSON);
  const fromJSON = useModelerStore((s) => s.fromJSON);
  const toggleChat = useChatStore((s) => s.toggleOpen);
  const isChatOpen = useChatStore((s) => s.isOpen);

  const handleExportSTL = async () => {
    if (!tree) return;
    try {
      const blob = await workerBridge.exportSTL(tree);
      triggerDownload(blob, `${projectName}.stl`);
    } catch (err: any) {
      console.error('Export STL failed:', err);
    }
  };

  const handleExport3MF = async () => {
    if (!tree) return;
    try {
      const blob = await workerBridge.export3MF(tree);
      triggerDownload(blob, `${projectName}.3mf`);
    } catch (err: any) {
      console.error('Export 3MF failed:', err);
    }
  };

  const handleSave = () => {
    const json = toJSON();
    const blob = new Blob([json], { type: 'application/json' });
    triggerDownload(blob, `${projectName}.json`);
  };

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => fromJSON(reader.result as string);
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="h-10 bg-zinc-800 border-b border-zinc-700 flex items-center px-3 gap-2 shrink-0">
      <input
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        className="bg-transparent border-none text-sm text-zinc-200 font-medium w-40 focus:outline-none focus:bg-zinc-700 rounded px-1"
      />
      <div className="w-px h-5 bg-zinc-600 mx-1" />
      <Btn label="Save" onClick={handleSave} />
      <Btn label="Load" onClick={handleLoad} />
      <div className="w-px h-5 bg-zinc-600 mx-1" />
      <Btn label="Undo" onClick={undo} />
      <Btn label="Redo" onClick={redo} />
      <div className="flex-1" />
      <Btn label="Export STL" onClick={handleExportSTL} disabled={evaluating || !tree} />
      <Btn label="Export 3MF" onClick={handleExport3MF} disabled={evaluating || !tree} />
      <div className="w-px h-5 bg-zinc-600 mx-1" />
      <button
        onClick={toggleChat}
        className={`text-xs px-2 py-1 rounded ${isChatOpen ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'}`}
      >
        AI Chat
      </button>
    </div>
  );
}

function Btn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-zinc-300"
    >
      {label}
    </button>
  );
}
