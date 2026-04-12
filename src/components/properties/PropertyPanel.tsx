import { useModelerStore } from '../../store/modelerStore';
import { NODE_LABELS, type SDFNodeUI } from '../../types/operations';
import { NumberInput } from './NumberInput';

function findNode(tree: SDFNodeUI, id: string): SDFNodeUI | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function PropertyPanel() {
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const tree = useModelerStore((s) => s.tree);
  const updateParams = useModelerStore((s) => s.updateNodeParams);

  const node = tree && selectedId ? findNode(tree, selectedId) : null;

  if (!node) {
    return (
      <div className="w-80 border-l border-zinc-700 flex items-center justify-center" style={{ backgroundColor: '#1a1a2e' }}>
        <p className="text-sm text-zinc-500 text-center px-4">
          Select a node to edit its parameters
        </p>
      </div>
    );
  }

  const update = (params: Record<string, number>) => updateParams(node.id, params);

  return (
    <div className="w-80 border-l border-zinc-700 overflow-y-auto" style={{ backgroundColor: '#1a1a2e' }}>
      <div className="px-3 py-2 border-b border-zinc-700">
        <span className="text-sm font-medium text-zinc-300">
          {NODE_LABELS[node.kind] || node.kind} Properties
        </span>
      </div>
      <div className="p-3">
        <NodeEditor node={node} onUpdate={update} />
      </div>
    </div>
  );
}

function NodeEditor({ node, onUpdate }: { node: SDFNodeUI; onUpdate: (p: Record<string, number>) => void }) {
  const p = node.params;

  switch (node.kind) {
    case 'box':
      return (
        <>
          <NumberInput label="Width" value={p.width} min={0.1} onChange={(v) => onUpdate({ width: v })} />
          <NumberInput label="Height" value={p.height} min={0.1} onChange={(v) => onUpdate({ height: v })} />
          <NumberInput label="Depth" value={p.depth} min={0.1} onChange={(v) => onUpdate({ depth: v })} />
        </>
      );
    case 'sphere':
      return <NumberInput label="Radius" value={p.radius} min={0.1} onChange={(v) => onUpdate({ radius: v })} />;
    case 'cylinder':
      return (
        <>
          <NumberInput label="Radius" value={p.radius} min={0.1} onChange={(v) => onUpdate({ radius: v })} />
          <NumberInput label="Height" value={p.height} min={0.1} onChange={(v) => onUpdate({ height: v })} />
        </>
      );
    case 'torus':
      return (
        <>
          <NumberInput label="Major Radius" value={p.majorRadius} min={0.1} onChange={(v) => onUpdate({ majorRadius: v })} />
          <NumberInput label="Minor Radius" value={p.minorRadius} min={0.1} onChange={(v) => onUpdate({ minorRadius: v })} />
        </>
      );
    case 'union': case 'subtract': case 'intersect':
      return (
        <>
          <NumberInput label="Smooth (fillet)" value={p.smooth} min={0} step={0.5} unit="mm" onChange={(v) => onUpdate({ smooth: v })} />
          <div className="text-xs text-zinc-500 mt-1">0 = sharp, &gt;0 = fillet radius at the junction</div>
        </>
      );
    case 'shell':
      return <NumberInput label="Thickness" value={p.thickness} min={0.1} step={0.5} onChange={(v) => onUpdate({ thickness: v })} />;
    case 'offset':
      return <NumberInput label="Distance" value={p.distance} step={0.5} onChange={(v) => onUpdate({ distance: v })} />;
    case 'round':
      return <NumberInput label="Radius" value={p.radius} min={0} step={0.5} onChange={(v) => onUpdate({ radius: v })} />;
    case 'translate':
      return (
        <>
          <NumberInput label="X" value={p.x} unit="mm" onChange={(v) => onUpdate({ x: v })} />
          <NumberInput label="Y" value={p.y} unit="mm" onChange={(v) => onUpdate({ y: v })} />
          <NumberInput label="Z" value={p.z} unit="mm" onChange={(v) => onUpdate({ z: v })} />
        </>
      );
    case 'rotate':
      return (
        <>
          <NumberInput label="X" value={p.x} unit="deg" onChange={(v) => onUpdate({ x: v })} />
          <NumberInput label="Y" value={p.y} unit="deg" onChange={(v) => onUpdate({ y: v })} />
          <NumberInput label="Z" value={p.z} unit="deg" onChange={(v) => onUpdate({ z: v })} />
        </>
      );
    case 'scale':
      return (
        <>
          <NumberInput label="X" value={p.x} min={0.01} step={0.1} unit="x" onChange={(v) => onUpdate({ x: v })} />
          <NumberInput label="Y" value={p.y} min={0.01} step={0.1} unit="x" onChange={(v) => onUpdate({ y: v })} />
          <NumberInput label="Z" value={p.z} min={0.01} step={0.1} unit="x" onChange={(v) => onUpdate({ z: v })} />
        </>
      );
    case 'mirror':
      return (
        <div className="space-y-2">
          <div className="text-xs text-zinc-400 mb-1">Mirror across axes:</div>
          {(['mirrorX', 'mirrorY', 'mirrorZ'] as const).map((key) => (
            <label key={key} className="flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={!!p[key]}
                onChange={(e) => onUpdate({ [key]: e.target.checked ? 1 : 0 })}
                className="rounded"
              />
              {key.replace('mirror', '')} axis
            </label>
          ))}
        </div>
      );
    case 'linearPattern':
      return (
        <>
          <NumberInput label="Count" value={p.count} min={2} max={50} step={1} unit="" onChange={(v) => onUpdate({ count: Math.round(v) })} />
          <NumberInput label="Spacing" value={p.spacing} min={0.1} onChange={(v) => onUpdate({ spacing: v })} />
          <div className="text-xs text-zinc-400 mt-1 mb-1">Direction:</div>
          <NumberInput label="X" value={p.axisX} unit="" step={1} onChange={(v) => onUpdate({ axisX: v })} />
          <NumberInput label="Y" value={p.axisY} unit="" step={1} onChange={(v) => onUpdate({ axisY: v })} />
          <NumberInput label="Z" value={p.axisZ} unit="" step={1} onChange={(v) => onUpdate({ axisZ: v })} />
        </>
      );
    case 'circularPattern':
      return (
        <>
          <NumberInput label="Count" value={p.count} min={2} max={50} step={1} unit="" onChange={(v) => onUpdate({ count: Math.round(v) })} />
          <div className="text-xs text-zinc-400 mt-1 mb-1">Rotation axis:</div>
          <NumberInput label="X" value={p.axisX} unit="" step={1} onChange={(v) => onUpdate({ axisX: v })} />
          <NumberInput label="Y" value={p.axisY} unit="" step={1} onChange={(v) => onUpdate({ axisY: v })} />
          <NumberInput label="Z" value={p.axisZ} unit="" step={1} onChange={(v) => onUpdate({ axisZ: v })} />
        </>
      );
    default:
      return <div className="text-xs text-zinc-500">No editable parameters</div>;
  }
}
