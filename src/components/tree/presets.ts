import { v4 as uuidv4 } from 'uuid';
import type { SDFNodeUI } from '../../types/operations';

/**
 * The preset library.
 *
 * ## Conventions
 *
 * **Units are millimetres**, everywhere, with no exceptions. Every primitive
 * parameter in this app is a millimetre count (`src/llm/systemPrompt.ts`
 * annotates them as such to the model, and the property panel labels them the
 * same way); presets add no unit of their own.
 *
 * **Dimensions are nominal, not as-printed.** No shrinkage, elephant-foot or
 * die-swell compensation is applied. A slicer's horizontal expansion setting is
 * the right place for that, because it depends on the machine and material, not
 * on the model.
 *
 * **Fastener clearance follows ISO 273 "medium".** M3 → 3.4 mm, M4 → 4.5 mm.
 * The medium series rather than close/fine because FDM holes come out 0.1–0.3 mm
 * *under* nominal — the perimeter is laid down inside the path and the inner
 * corner of each layer bulges — so the close series (M3 → 3.2) leaves a hole a
 * screw will not pass without reaming. Where a preset wants an interference fit
 * it says so and gives the number it is fitting.
 *
 * **`size` is a guaranteed outer envelope**, in the same X/Y/Z order the box
 * primitive uses, and Y is up. It is not a claim that the part fills that box —
 * it is a claim that no part of the model escapes it, and that the model comes
 * within 0.5 mm of every face of it. Both halves are enforced by
 * `presets.test.ts`: the upper half against `computeBounds` (the sound bound
 * proved in `src/worker/sdf/bounds.ts`), the lower half by sampling the field.
 *
 * The upper half is the one that matters historically. `round` is a pure
 * outward offset — `d - radius` in both evaluators — and `box` size is the full
 * extent, so wrapping a 74 mm box in `round(2)` yields a 78 mm part. Every
 * rounded preset in the previous library advertised the inner box and shipped
 * the outer one. Descriptions cannot restate a size by hand any more: the UI
 * appends `size` itself, and the test rejects a description that tries.
 *
 * ## Sourcing
 *
 * Every number below is one of: a published dimension (cited inline), a value
 * from a standard (cited inline), or a free choice that the part's own geometry
 * defines and nothing external has to match. Numbers that were none of these
 * are gone — see the deletions noted at the bottom of this file.
 */

export interface Preset {
  name: string;
  /** What the part is for. Never restates a dimension — the UI appends `size`. */
  desc: string;
  /** Guaranteed outer envelope [x, y, z] in mm. Enforced by presets.test.ts. */
  size: [number, number, number];
  build: () => SDFNodeUI;
}

export interface PresetCategory {
  category: string;
  items: Preset[];
}

/**
 * Render an envelope for display. The UI appends this itself so a description
 * never has to repeat a dimension — the mechanism by which every size in the
 * previous library drifted away from the geometry it described.
 */
export function formatSize(size: [number, number, number]): string {
  const round1 = (v: number) => (Math.round(v * 10) / 10).toString();
  return `${size.map(round1).join(' × ')} mm`;
}

function n(kind: string, label: string, params: Record<string, number>, children: SDFNodeUI[] = []): SDFNodeUI {
  return { id: uuidv4(), kind, label, params, children, enabled: true };
}

const box = (label: string, width: number, height: number, depth: number) =>
  n('box', label, { width, height, depth });
const cyl = (label: string, radius: number, height: number) =>
  n('cylinder', label, { radius, height });
const at = (label: string, x: number, y: number, z: number, child: SDFNodeUI) =>
  n('translate', label, { x, y, z }, [child]);
const cut = (label: string, solid: SDFNodeUI, tool: SDFNodeUI) =>
  n('subtract', label, { smooth: 0 }, [solid, tool]);
const join = (label: string, a: SDFNodeUI, b: SDFNodeUI) =>
  n('union', label, { smooth: 0 }, [a, b]);
const round = (label: string, radius: number, child: SDFNodeUI) =>
  n('round', label, { radius }, [child]);

/** ISO 273 medium-series clearance holes, as radii. */
const M3_CLEARANCE_R = 1.7;
const M4_CLEARANCE_R = 2.25;

/**
 * Phone Stand back rest. Kept as expressions rather than typed-in decimals
 * because the advertised envelope depends on all four of them: raking a plate
 * grows its bounding box in Y by half its thickness times sin(rake), which is
 * precisely the kind of arithmetic a hand-written size gets wrong.
 */
const RAKE_DEG = 15;
const RAKE_C = Math.cos((RAKE_DEG * Math.PI) / 180);
const RAKE_S = Math.sin((RAKE_DEG * Math.PI) / 180);
const REST_H = 60;
const REST_T = 8;
/** Puts the plate's front-bottom edge at the base's top surface, z = 0. */
const REST_TY = (REST_H / 2) * RAKE_C - (REST_T / 2) * RAKE_S;
const REST_TZ = -((REST_H / 2) * RAKE_S + (REST_T / 2) * RAKE_C);

/**
 * A post with a clearance hole down its axis. The hole runs proud of the post
 * at both ends so the boolean leaves no film of material capping it.
 */
function standoff(label: string, postR: number, height: number, holeR: number): SDFNodeUI {
  return cut(label, cyl('Post', postR, height), cyl('Hole', holeR, height + 2));
}

/**
 * Arduino Uno R3 mounting holes, in millimetres from the board's lower-left
 * corner, per the published board outline: (13.97, 2.54), (15.24, 50.8),
 * (66.04, 7.62), (66.04, 35.56) on a 68.6 x 53.4 mm board.
 *
 * The pattern is famously *not* symmetric — the whole reason the previous
 * preset's mirrored (+-31, +-24) rectangle could not accept a board. Recorded
 * here relative to the board centre, with the board's X mapped to the app's X
 * and the board's Y to the app's Z, since Y is up here and the board lies flat.
 */
const UNO_BOARD_X = 68.6;
const UNO_BOARD_Z = 53.4;
const UNO_HOLES: [number, number][] = [
  [13.97 - UNO_BOARD_X / 2, 2.54 - UNO_BOARD_Z / 2],
  [15.24 - UNO_BOARD_X / 2, 50.8 - UNO_BOARD_Z / 2],
  [66.04 - UNO_BOARD_X / 2, 7.62 - UNO_BOARD_Z / 2],
  [66.04 - UNO_BOARD_X / 2, 35.56 - UNO_BOARD_Z / 2],
];

/**
 * A tray: a rounded solid with a cavity subtracted that runs out through the
 * top, leaving four walls, a floor and an open top.
 *
 * The cavity is deliberately narrower than the rounded solid's top face, so a
 * rim of material survives at full height. Widening it past that face would
 * eat the rim and quietly shorten the part below its advertised height — the
 * envelope test catches exactly that.
 */
function openTray(
  outer: { x: number; y: number; z: number },
  wall: number,
  floor: number,
  edgeRadius: number,
): SDFNodeUI {
  const core = box('Body', outer.x - 2 * edgeRadius, outer.y - 2 * edgeRadius, outer.z - 2 * edgeRadius);
  const shellSolid = round('Round', edgeRadius, core);
  // Spans from the floor's top surface out past the rim, so the top is open.
  const cavityY = outer.y; // taller than the solid: guarantees it breaks through
  const cavityCentreY = -outer.y / 2 + floor + cavityY / 2;
  const cavity = at('Cavity', 0, cavityCentreY, 0, box('Void', outer.x - 2 * wall, cavityY, outer.z - 2 * wall));
  return cut('Tray', shellSolid, cavity);
}

export const PRESET_CATEGORIES: PresetCategory[] = [
  {
    category: 'Enclosures',
    items: [
      {
        name: 'Open-Top Enclosure',
        desc: '3 mm walls, open top, 1.5 mm rounded edges',
        size: [80, 30, 60],
        build: () => openTray({ x: 80, y: 30, z: 60 }, 3, 3, 1.5),
      },
      {
        name: 'Round Container',
        desc: '2.5 mm wall, open top',
        size: [50, 40, 50],
        build: () =>
          cut(
            'Container',
            cyl('Body', 25, 40),
            // Floor 2.5 mm; the cavity runs out through the top.
            at('Cavity', 0, 2.5, 0, cyl('Void', 22.5, 40)),
          ),
      },
      {
        // Every interior number here is the board's, not an invention: the
        // cavity is the 68.6 x 53.4 mm outline plus 0.7 mm of clearance per
        // side, and the posts sit under the four published hole positions.
        name: 'Arduino Uno R3 Case',
        desc: 'Tray for an Uno R3 on four M3 standoffs',
        size: [75, 24, 60],
        build: () => {
          const posts = UNO_HOLES.map(([x, z], i) =>
            at(`Mount ${i + 1}`, x, -6.5, z, standoff('Standoff', 3, 5, M3_CLEARANCE_R)),
          );
          return join(
            'Case',
            openTray({ x: 75, y: 24, z: 60 }, 2.5, 3, 1.5),
            join('Mounts', join('Mounts A', posts[0], posts[1]), join('Mounts B', posts[2], posts[3])),
          );
        },
      },
    ],
  },
  {
    category: 'Fasteners',
    items: [
      {
        name: 'M3 Standoff',
        desc: 'Ø8 post, 3.4 mm ISO 273 medium clearance',
        size: [8, 10, 8],
        build: () => standoff('M3 Standoff', 4, 10, M3_CLEARANCE_R),
      },
      {
        name: 'M4 Standoff',
        desc: 'Ø10 post, 4.5 mm ISO 273 medium clearance',
        size: [10, 12, 10],
        build: () => standoff('M4 Standoff', 5, 12, M4_CLEARANCE_R),
      },
      {
        name: '4x M3 Mount Pattern',
        desc: 'Standoffs on a 50 x 30 mm rectangle',
        size: [58, 10, 38],
        build: () =>
          n('mirror', 'Mirror XZ', { mirrorX: 1, mirrorY: 0, mirrorZ: 1 }, [
            at('Pos', 25, 0, 15, standoff('Standoff', 4, 10, M3_CLEARANCE_R)),
          ]),
      },
      {
        // The previous version subtracted a plain cylinder from a plate that
        // was thin in Z. Cylinders run along Y, so it cut an oblong slot down
        // the face instead of a hole through it. Both plates now get a hole,
        // each on the axis normal to its own face.
        name: 'Wall Bracket',
        desc: 'L-bracket, 4 mm plates, one M4 hole per plate',
        size: [30, 40, 34],
        build: () => {
          const vertical = box('Wall Plate', 30, 40, 4);
          const base = at('Base', 0, -18, 17, box('Base Plate', 30, 4, 30));
          const wallHole = at('Wall Hole', 0, 10, 0, n('rotate', 'To Z', { x: 90, y: 0, z: 0 }, [
            cyl('M4', M4_CLEARANCE_R, 8),
          ]));
          const baseHole = at('Base Hole', 0, -18, 22, cyl('M4', M4_CLEARANCE_R, 8));
          return cut('Bracket', cut('Drill', join('L', vertical, base), wallHole), baseHole);
        },
      },
      {
        name: 'Snap-Fit Clip',
        desc: 'Cantilever beam with a catch',
        size: [3, 13, 3.5],
        build: () =>
          join('Clip', box('Beam', 3, 12, 2), at('Hook', 0, 6, 1, box('Catch', 3, 2, 3))),
      },
    ],
  },
  {
    category: 'Patterns',
    items: [
      {
        name: 'Vent Grid',
        desc: 'Five 3 x 20 mm slots on a 6 mm pitch',
        size: [28, 21, 3],
        build: () =>
          at('Centre', -12, 0, 0,
            n('linearPattern', 'Vents', { axisX: 1, axisY: 0, axisZ: 0, count: 5, spacing: 6 }, [
              round('Round', 0.5, box('Slot', 3, 20, 2)),
            ])),
      },
      {
        // The envelope is the rotated corner's sweep radius, so it is not a
        // round number: eight 4 mm-square vents whose outer corner sits at
        // sqrt(14^2 + 2^2) from the axis.
        name: 'Circular Vent Ring',
        desc: 'Eight 4 mm vents on a Ø24 bolt circle',
        size: [2 * Math.hypot(14, 2), 6, 2 * Math.hypot(14, 2)],
        build: () =>
          n('circularPattern', 'Vents', { axisX: 0, axisY: 1, axisZ: 0, count: 8 }, [
            at('Pos', 12, 0, 0, box('Vent', 4, 6, 4)),
          ]),
      },
    ],
  },
  {
    category: 'Functional',
    items: [
      {
        // 6 mm is the shaft diameter of the common panel potentiometer and
        // rotary encoder (Alps RK09/EC11 and their clones), so the bore is a
        // clearance fit on that rather than a free choice.
        name: 'Knob',
        desc: 'Ø24 grip, 6 mm shaft bore',
        size: [24, 20, 24],
        build: () => cut('Knob', round('Grip', 2, cyl('Body', 10, 16)), cyl('Shaft', 3, 22)),
      },
      {
        // The slot is 11 mm because a phone is ~8 mm and a case adds 2-3. The
        // previous version left ~20 mm between the lip and the back plate, so
        // a phone dropped in it touched nothing and fell flat.
        name: 'Phone Stand',
        desc: '11 mm slot, back raked 15°',
        size: [70, 4 + REST_H * RAKE_C, 60],
        build: () => {
          const base = box('Base', 70, 8, 60);
          // Translated so the plate's front-bottom edge lands on the base's top
          // surface at z = 0, which is what makes the slot exactly 11 mm at the
          // point the phone actually rests.
          const back = at('Back', 0, REST_TY, REST_TZ, n('rotate', 'Rake', { x: -RAKE_DEG, y: 0, z: 0 }, [
            box('Rest', 70, REST_H, REST_T),
          ]));
          const lip = at('Lip', 0, 3, 14, box('Lip', 70, 14, 6));
          return join('Stand', join('Body', base, back), lip);
        },
      },
      {
        // Sized for a 6 mm cable (a typical 3-core mains flex or a braided
        // USB lead). The mouth is 5 mm, so the cable snaps past a lip it can
        // deflect rather than one it has to split.
        //
        // The mouth faces +X, not +Z. Facing it +Z would cut away the ring's
        // crown, which is the only material at the envelope's +Z face — the
        // part would then be shorter than it advertised, and the envelope test
        // says so.
        name: 'Cable Clip',
        desc: 'Ø6 cable channel, 5 mm mouth, M3 screw tab',
        size: [16, 12, 16],
        build: () => {
          const body = join('Body', cyl('Ring', 6, 12), at('Tab', 0, 0, -8, box('Tab', 16, 12, 4)));
          const channel = cyl('Channel', 3, 14);
          const mouth = at('Mouth', 6, 0, 0, box('Opening', 8, 14, 5));
          const screw = at('Screw', 0, 0, -8, n('rotate', 'To Z', { x: 90, y: 0, z: 0 }, [
            cyl('M3', M3_CLEARANCE_R, 6),
          ]));
          return cut('Clip', cut('Mouth Cut', cut('Bore', body, channel), mouth), screw);
        },
      },
    ],
  },
];

/**
 * Deleted rather than guessed at, per the rule at the top of this file:
 *
 * - **Gear.** Twelve rectangular blocks on a circular pattern is not a gear.
 *   It has no module, no pressure angle, no involute flank and no backlash, so
 *   it cannot mesh with a copy of itself, and the primitives here cannot
 *   express an involute profile. A gear generator is a node, not a preset.
 * - **Honeycomb.** A single ring of six cylinders is neither hexagonal nor
 *   tileable. A real hex grid is two interleaved lattices offset by half a
 *   pitch and by pitch*sqrt(3)/2, which wants a dedicated pattern node rather
 *   than a hand-nested pair of linear patterns.
 * - **ComponentLibrary.tsx.** A second, larger preset list that nothing
 *   imported, diverged from this one, and carried the same rounding defect.
 */
