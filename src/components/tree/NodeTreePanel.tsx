import { useModelerStore } from '../../store/modelerStore';
import { TreeNode } from './TreeNode';
import { AddNodeMenu } from './AddNodeMenu';
import { ComponentLibrary } from './ComponentLibrary';
import { useState } from 'react';

export function NodeTreePanel() {
  const tree = useModelerStore((s) => s.tree);
  const [showAdd, setShowAdd] = useState(false);
  const [showComponents, setShowComponents] = useState(false);

  return (
    <div className="w-70 border-r border-zinc-700 flex flex-col" style={{ backgroundColor: '#1a1a2e' }}>
      <div className="px-3 py-2 border-b border-zinc-700 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-300">Node Tree</span>
        <div className="flex gap-1">
          <button
            onClick={() => { setShowComponents(!showComponents); setShowAdd(false); }}
            className="text-xs px-2 py-1 bg-amber-600 hover:bg-amber-500 rounded text-white"
          >
            Presets
          </button>
          <button
            onClick={() => { setShowAdd(!showAdd); setShowComponents(false); }}
            className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white"
          >
            + Add
          </button>
        </div>
      </div>

      {showAdd && <AddNodeMenu onClose={() => setShowAdd(false)} />}
      {showComponents && <ComponentLibrary onClose={() => setShowComponents(false)} />}

      <div className="flex-1 overflow-y-auto py-1">
        {!tree && (
          <div className="p-4 text-sm text-zinc-500 text-center">
            No model yet. Click "Presets" for common components, "+ Add" for primitives, or use AI Chat.
          </div>
        )}
        {tree && <TreeNode node={tree} depth={0} />}
      </div>
    </div>
  );
}
