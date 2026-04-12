import { useModelerStore } from '../../store/modelerStore';
import { NODE_KINDS, NODE_LABELS } from '../../types/operations';

interface Props {
  onClose: () => void;
}

export function AddNodeMenu({ onClose }: Props) {
  const tree = useModelerStore((s) => s.tree);
  const selectedNodeId = useModelerStore((s) => s.selectedNodeId);
  const addPrimitive = useModelerStore((s) => s.addPrimitive);
  const wrapSelected = useModelerStore((s) => s.wrapSelected);

  const handleAddPrimitive = (kind: string) => {
    addPrimitive(kind);
    onClose();
  };

  const handleWrap = (kind: string) => {
    wrapSelected(kind);
    onClose();
  };

  return (
    <div className="border-b border-zinc-700 bg-zinc-800/80 p-2 space-y-2">
      {/* Primitives - always available */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-1 mb-1">Add Primitive</div>
        <div className="flex flex-wrap gap-1">
          {NODE_KINDS.primitives.map((kind) => (
            <button
              key={kind}
              onClick={() => handleAddPrimitive(kind)}
              className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-200"
            >
              {NODE_LABELS[kind]}
            </button>
          ))}
        </div>
      </div>

      {/* Wrap selected - only when something is selected */}
      {tree && selectedNodeId && (
        <>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-1 mb-1">Wrap Selected In</div>
            <div className="flex flex-wrap gap-1">
              {[...NODE_KINDS.modifiers, ...NODE_KINDS.patterns, ...NODE_KINDS.transforms].map((kind) => (
                <button
                  key={kind}
                  onClick={() => handleWrap(kind)}
                  className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-200"
                >
                  {NODE_LABELS[kind]}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
