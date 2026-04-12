import { v4 as uuidv4 } from 'uuid';
import { useModelerStore } from '../../store/modelerStore';
import type { SDFNodeUI } from '../../types/operations';

function n(kind: string, label: string, params: Record<string, number>, children: SDFNodeUI[] = []): SDFNodeUI {
  return { id: uuidv4(), kind, label, params, children, enabled: true };
}

const PRESETS: { name: string; description: string; build: () => SDFNodeUI }[] = [
  {
    name: 'Rounded Enclosure',
    description: 'Box with rounded edges and hollow interior',
    build: () =>
      n('shell', 'Hollow', { thickness: 2 }, [
        n('round', 'Round Edges', { radius: 3 }, [
          n('box', 'Enclosure', { width: 80, height: 30, depth: 60 }),
        ]),
      ]),
  },
  {
    name: 'Screw Standoff',
    description: 'Cylinder with hole for M3 screw',
    build: () =>
      n('subtract', 'Standoff', { smooth: 0 }, [
        n('cylinder', 'Post', { radius: 4, height: 8 }),
        n('cylinder', 'Hole', { radius: 1.6, height: 10 }),
      ]),
  },
  {
    name: '4x Screw Mount Pattern',
    description: 'Four screw standoffs in a rectangular pattern',
    build: () =>
      n('mirror', 'Mirror XZ', { mirrorX: 1, mirrorY: 0, mirrorZ: 1 }, [
        n('translate', 'Position', { x: 25, y: 0, z: 15 }, [
          n('subtract', 'Standoff', { smooth: 0 }, [
            n('cylinder', 'Post', { radius: 4, height: 8 }),
            n('cylinder', 'Hole', { radius: 1.6, height: 10 }),
          ]),
        ]),
      ]),
  },
  {
    name: 'Vent Grid',
    description: 'Linear pattern of vent slots',
    build: () =>
      n('linearPattern', 'Vent Array', { axisX: 1, axisY: 0, axisZ: 0, count: 5, spacing: 6 }, [
        n('round', 'Rounded Slot', { radius: 0.5 }, [
          n('box', 'Slot', { width: 3, height: 20, depth: 2 }),
        ]),
      ]),
  },
  {
    name: 'Snap-Fit Clip',
    description: 'Simple cantilever snap-fit clip',
    build: () =>
      n('union', 'Snap Clip', { smooth: 0.5 }, [
        n('box', 'Beam', { width: 3, height: 12, depth: 2 }),
        n('translate', 'Hook Position', { x: 0, y: 6, z: 1 }, [
          n('box', 'Hook', { width: 3, height: 2, depth: 3 }),
        ]),
      ]),
  },
  {
    name: 'PCB Tray',
    description: 'Tray sized for a standard PCB with standoffs',
    build: () =>
      n('union', 'PCB Tray Assembly', { smooth: 0 }, [
        n('shell', 'Tray Shell', { thickness: 2 }, [
          n('round', 'Rounded Tray', { radius: 2 }, [
            n('box', 'Tray', { width: 75, height: 15, depth: 55 }),
          ]),
        ]),
        n('mirror', '4x Standoffs', { mirrorX: 1, mirrorY: 0, mirrorZ: 1 }, [
          n('translate', 'Standoff Pos', { x: 30, y: -5, z: 22 }, [
            n('cylinder', 'Standoff', { radius: 2.5, height: 5 }),
          ]),
        ]),
      ]),
  },
];

interface Props {
  onClose: () => void;
}

export function ComponentLibrary({ onClose }: Props) {
  const setTree = useModelerStore((s) => s.setTree);
  const tree = useModelerStore((s) => s.tree);

  const handleSelect = (preset: typeof PRESETS[0]) => {
    const component = preset.build();
    if (!tree) {
      setTree(component);
    } else {
      // Union with existing tree
      const unionNode: SDFNodeUI = {
        id: uuidv4(),
        kind: 'union',
        label: 'Union',
        params: { smooth: 0 },
        children: [tree, component],
        enabled: true,
      };
      setTree(unionNode);
    }
    onClose();
  };

  return (
    <div className="border-b border-zinc-700 bg-zinc-800/90 p-2 max-h-64 overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-1 mb-2">Components</div>
      <div className="space-y-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => handleSelect(preset)}
            className="w-full text-left px-2 py-1.5 bg-zinc-700/50 hover:bg-zinc-600/50 rounded"
          >
            <div className="text-xs text-zinc-200">{preset.name}</div>
            <div className="text-[10px] text-zinc-500">{preset.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
