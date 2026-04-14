import { v4 as uuidv4 } from 'uuid';
import { useModelerStore } from '../../store/modelerStore';
import type { SDFNodeUI } from '../../types/operations';

function n(kind: string, label: string, params: Record<string, number>, children: SDFNodeUI[] = []): SDFNodeUI {
  return { id: uuidv4(), kind, label, params, children, enabled: true };
}

interface PresetCategory {
  category: string;
  presets: { name: string; description: string; build: () => SDFNodeUI }[];
}

const PRESET_CATEGORIES: PresetCategory[] = [
  {
    category: 'Enclosures',
    presets: [
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
        name: 'Arduino Uno Case',
        description: '74x30x59mm enclosure with screw mounts',
        build: () =>
          n('union', 'Arduino Case', { smooth: 0 }, [
            n('shell', 'Shell', { thickness: 2 }, [
              n('round', 'Round', { radius: 2 }, [
                n('box', 'Body', { width: 74, height: 30, depth: 59 }),
              ]),
            ]),
            n('mirror', 'Mount Points', { mirrorX: 1, mirrorY: 0, mirrorZ: 1 }, [
              n('translate', 'Mount Pos', { x: 31, y: -13, z: 24 }, [
                n('subtract', 'Standoff', { smooth: 0 }, [
                  n('cylinder', 'Post', { radius: 3, height: 6 }),
                  n('cylinder', 'M3 Hole', { radius: 1.6, height: 8 }),
                ]),
              ]),
            ]),
          ]),
      },
      {
        name: 'Cylindrical Container',
        description: 'Round container with lid lip',
        build: () =>
          n('shell', 'Hollow', { thickness: 2 }, [
            n('union', 'Body + Lip', { smooth: 0.5 }, [
              n('cylinder', 'Body', { radius: 25, height: 40 }),
              n('translate', 'Lip', { x: 0, y: 20, z: 0 }, [
                n('cylinder', 'Lip Ring', { radius: 27, height: 4 }),
              ]),
            ]),
          ]),
      },
      {
        name: 'Raspberry Pi Case',
        description: '90x62x30mm with ventilation',
        build: () =>
          n('subtract', 'Case with Vents', { smooth: 0 }, [
            n('shell', 'Shell', { thickness: 2 }, [
              n('round', 'Round', { radius: 2 }, [
                n('box', 'Body', { width: 90, height: 30, depth: 62 }),
              ]),
            ]),
            n('translate', 'Vent Position', { x: 0, y: 10, z: 30 }, [
              n('linearPattern', 'Vent Slots', { axisX: 1, axisY: 0, axisZ: 0, count: 8, spacing: 6 }, [
                n('round', 'Round Slot', { radius: 0.5 }, [
                  n('box', 'Slot', { width: 3, height: 15, depth: 4 }),
                ]),
              ]),
            ]),
          ]),
      },
    ],
  },
  {
    category: 'Fasteners & Mounts',
    presets: [
      {
        name: 'M3 Screw Standoff',
        description: 'Cylinder with 3.2mm clearance hole',
        build: () =>
          n('subtract', 'Standoff', { smooth: 0 }, [
            n('cylinder', 'Post', { radius: 4, height: 8 }),
            n('cylinder', 'M3 Hole', { radius: 1.6, height: 10 }),
          ]),
      },
      {
        name: 'M4 Screw Standoff',
        description: 'Cylinder with 4.2mm clearance hole',
        build: () =>
          n('subtract', 'Standoff', { smooth: 0 }, [
            n('cylinder', 'Post', { radius: 5, height: 10 }),
            n('cylinder', 'M4 Hole', { radius: 2.1, height: 12 }),
          ]),
      },
      {
        name: '4x Screw Mount Pattern',
        description: 'Four standoffs in a rectangle',
        build: () =>
          n('mirror', 'Mirror XZ', { mirrorX: 1, mirrorY: 0, mirrorZ: 1 }, [
            n('translate', 'Position', { x: 25, y: 0, z: 15 }, [
              n('subtract', 'Standoff', { smooth: 0 }, [
                n('cylinder', 'Post', { radius: 4, height: 8 }),
                n('cylinder', 'M3 Hole', { radius: 1.6, height: 10 }),
              ]),
            ]),
          ]),
      },
      {
        name: 'Wall Mount Bracket',
        description: 'L-bracket with screw holes',
        build: () =>
          n('subtract', 'Bracket', { smooth: 0 }, [
            n('union', 'L-Shape', { smooth: 2 }, [
              n('box', 'Vertical', { width: 30, height: 40, depth: 4 }),
              n('translate', 'Horizontal', { x: 0, y: -18, z: 13 }, [
                n('box', 'Base', { width: 30, height: 4, depth: 30 }),
              ]),
            ]),
            n('mirror', 'Holes', { mirrorX: 0, mirrorY: 1, mirrorZ: 0 }, [
              n('translate', 'Hole Pos', { x: 0, y: 10, z: 0 }, [
                n('cylinder', 'Screw Hole', { radius: 2.1, height: 10 }),
              ]),
            ]),
          ]),
      },
      {
        name: 'Snap-Fit Clip',
        description: 'Cantilever snap-fit clip',
        build: () =>
          n('union', 'Snap Clip', { smooth: 0.5 }, [
            n('box', 'Beam', { width: 3, height: 12, depth: 2 }),
            n('translate', 'Hook', { x: 0, y: 6, z: 1 }, [
              n('box', 'Hook', { width: 3, height: 2, depth: 3 }),
            ]),
          ]),
      },
    ],
  },
  {
    category: 'Ventilation & Patterns',
    presets: [
      {
        name: 'Vent Grid (Linear)',
        description: 'Row of rounded vent slots',
        build: () =>
          n('linearPattern', 'Vent Array', { axisX: 1, axisY: 0, axisZ: 0, count: 5, spacing: 6 }, [
            n('round', 'Rounded Slot', { radius: 0.5 }, [
              n('box', 'Slot', { width: 3, height: 20, depth: 2 }),
            ]),
          ]),
      },
      {
        name: 'Vent Grid (Circular)',
        description: 'Radial array of vent holes',
        build: () =>
          n('circularPattern', 'Radial Vents', { axisX: 0, axisY: 0, axisZ: 1, count: 8 }, [
            n('translate', 'Hole Pos', { x: 12, y: 0, z: 0 }, [
              n('capsule', 'Vent Hole', { radius: 2, height: 6 }),
            ]),
          ]),
      },
      {
        name: 'Honeycomb Pattern',
        description: 'Circular array of hex-ish holes',
        build: () =>
          n('circularPattern', 'Hex Ring', { axisX: 0, axisY: 0, axisZ: 1, count: 6 }, [
            n('translate', 'Pos', { x: 10, y: 0, z: 0 }, [
              n('cylinder', 'Hex Hole', { radius: 3, height: 4 }),
            ]),
          ]),
      },
    ],
  },
  {
    category: 'Structural',
    presets: [
      {
        name: 'Rounded Box',
        description: 'Box with filleted edges',
        build: () =>
          n('round', 'Rounded', { radius: 3 }, [
            n('box', 'Box', { width: 40, height: 40, depth: 40 }),
          ]),
      },
      {
        name: 'Tube',
        description: 'Hollow cylinder',
        build: () =>
          n('shell', 'Tube', { thickness: 2 }, [
            n('cylinder', 'Cylinder', { radius: 15, height: 40 }),
          ]),
      },
      {
        name: 'Flanged Tube',
        description: 'Tube with flange at one end',
        build: () =>
          n('shell', 'Hollow', { thickness: 2 }, [
            n('union', 'Body + Flange', { smooth: 1 }, [
              n('cylinder', 'Tube', { radius: 10, height: 30 }),
              n('translate', 'Flange Pos', { x: 0, y: -15, z: 0 }, [
                n('cylinder', 'Flange', { radius: 18, height: 4 }),
              ]),
            ]),
          ]),
      },
      {
        name: 'T-Joint',
        description: 'Two cylinders joined at 90 degrees',
        build: () =>
          n('union', 'T-Joint', { smooth: 2 }, [
            n('cylinder', 'Vertical', { radius: 8, height: 40 }),
            n('rotate', 'Horizontal', { x: 0, y: 0, z: 90 }, [
              n('cylinder', 'Cross', { radius: 8, height: 30 }),
            ]),
          ]),
      },
      {
        name: 'Dome',
        description: 'Half sphere on a cylinder base',
        build: () =>
          n('intersect', 'Dome', { smooth: 0 }, [
            n('union', 'Shape', { smooth: 2 }, [
              n('sphere', 'Dome', { radius: 20 }),
              n('translate', 'Base Pos', { x: 0, y: -10, z: 0 }, [
                n('cylinder', 'Base', { radius: 20, height: 20 }),
              ]),
            ]),
            n('halfSpace', 'Cut Bottom', { axis: 1, position: -20 }),
          ]),
      },
    ],
  },
  {
    category: 'Functional Parts',
    presets: [
      {
        name: 'Knob',
        description: 'Knurled grip with shaft hole',
        build: () =>
          n('subtract', 'Knob', { smooth: 0 }, [
            n('union', 'Body', { smooth: 1 }, [
              n('cylinder', 'Grip', { radius: 12, height: 15 }),
              n('translate', 'Top', { x: 0, y: 7, z: 0 }, [
                n('sphere', 'Dome', { radius: 12 }),
              ]),
            ]),
            n('cylinder', 'Shaft Hole', { radius: 3, height: 20 }),
          ]),
      },
      {
        name: 'Phone Stand',
        description: 'Angled stand for a phone',
        build: () =>
          n('union', 'Phone Stand', { smooth: 2 }, [
            n('box', 'Base', { width: 60, height: 5, depth: 40 }),
            n('translate', 'Back', { x: 0, y: 20, z: -15 }, [
              n('rotate', 'Angle', { x: 15, y: 0, z: 0 }, [
                n('box', 'Support', { width: 60, height: 40, depth: 5 }),
              ]),
            ]),
            n('translate', 'Lip', { x: 0, y: 5, z: 10 }, [
              n('box', 'Lip', { width: 60, height: 8, depth: 5 }),
            ]),
          ]),
      },
      {
        name: 'Cable Clip',
        description: 'C-shaped clip for cable management',
        build: () =>
          n('subtract', 'Cable Clip', { smooth: 0 }, [
            n('union', 'Body', { smooth: 1 }, [
              n('cylinder', 'Ring', { radius: 8, height: 10 }),
              n('translate', 'Mount', { x: 0, y: 0, z: -8 }, [
                n('box', 'Tab', { width: 16, height: 10, depth: 4 }),
              ]),
            ]),
            n('cylinder', 'Cable Hole', { radius: 5, height: 12 }),
            n('translate', 'Gap', { x: 0, y: 8, z: 0 }, [
              n('box', 'Opening', { width: 4, height: 8, depth: 12 }),
            ]),
          ]),
      },
      {
        name: 'Hinge Knuckle',
        description: 'One half of a barrel hinge',
        build: () =>
          n('subtract', 'Hinge', { smooth: 0 }, [
            n('union', 'Body', { smooth: 0.5 }, [
              n('rotate', 'Barrel', { x: 0, y: 0, z: 90 }, [
                n('cylinder', 'Barrel', { radius: 4, height: 10 }),
              ]),
              n('translate', 'Leaf', { x: 0, y: 0, z: -8 }, [
                n('box', 'Leaf', { width: 10, height: 20, depth: 2 }),
              ]),
            ]),
            n('rotate', 'Pin Hole', { x: 0, y: 0, z: 90 }, [
              n('cylinder', 'Pin', { radius: 1.5, height: 12 }),
            ]),
          ]),
      },
      {
        name: 'Gear',
        description: '12-tooth gear with axle hole',
        build: () =>
          n('subtract', 'Gear', { smooth: 0 }, [
            n('union', 'Body', { smooth: 0 }, [
              n('cylinder', 'Hub', { radius: 10, height: 5 }),
              n('circularPattern', 'Teeth', { axisX: 0, axisY: 1, axisZ: 0, count: 12 }, [
                n('translate', 'Tooth Pos', { x: 11, y: 0, z: 0 }, [
                  n('box', 'Tooth', { width: 4, height: 5, depth: 3 }),
                ]),
              ]),
            ]),
            n('cylinder', 'Axle Hole', { radius: 2.5, height: 8 }),
          ]),
      },
    ],
  },
  {
    category: 'PCB & Electronics',
    presets: [
      {
        name: 'PCB Tray',
        description: 'Tray with standoffs for a standard PCB',
        build: () =>
          n('union', 'PCB Tray', { smooth: 0 }, [
            n('shell', 'Tray Shell', { thickness: 2 }, [
              n('round', 'Rounded', { radius: 2 }, [
                n('box', 'Tray', { width: 75, height: 15, depth: 55 }),
              ]),
            ]),
            n('mirror', 'Standoffs', { mirrorX: 1, mirrorY: 0, mirrorZ: 1 }, [
              n('translate', 'Pos', { x: 30, y: -5, z: 22 }, [
                n('cylinder', 'Standoff', { radius: 2.5, height: 5 }),
              ]),
            ]),
          ]),
      },
      {
        name: 'USB Port Cutout',
        description: 'Rounded rectangle for USB-A port',
        build: () =>
          n('round', 'Rounded', { radius: 1 }, [
            n('box', 'USB Cutout', { width: 14, height: 7, depth: 10 }),
          ]),
      },
      {
        name: 'Button Cap',
        description: 'Push button cap with stem',
        build: () =>
          n('union', 'Button', { smooth: 0.5 }, [
            n('round', 'Top', { radius: 1 }, [
              n('cylinder', 'Cap', { radius: 5, height: 3 }),
            ]),
            n('translate', 'Stem', { x: 0, y: -3, z: 0 }, [
              n('cylinder', 'Stem', { radius: 2, height: 4 }),
            ]),
          ]),
      },
    ],
  },
];

interface Props {
  onClose: () => void;
}

export function ComponentLibrary({ onClose }: Props) {
  const setTree = useModelerStore((s) => s.setTree);
  const tree = useModelerStore((s) => s.tree);

  const handleSelect = (preset: PresetCategory['presets'][0]) => {
    const component = preset.build();
    if (!tree) {
      setTree(component);
    } else {
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
    <div className="max-h-80 overflow-y-auto p-2 space-y-3"
         style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
      {PRESET_CATEGORIES.map((cat) => (
        <div key={cat.category}>
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase px-1 mb-1" style={{ color: 'var(--text-muted)' }}>
            {cat.category}
          </div>
          <div className="space-y-1">
            {cat.presets.map((preset) => (
              <button
                key={preset.name}
                onClick={() => handleSelect(preset)}
                className="w-full text-left px-2 py-1.5 rounded transition-colors"
                style={{ background: 'var(--bg-elevated)' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-elevated)'}
              >
                <div className="text-xs" style={{ color: 'var(--text-primary)' }}>{preset.name}</div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{preset.description}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
