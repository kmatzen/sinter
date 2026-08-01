/**
 * Export-pipeline benchmark (#88, item C1).
 *
 * `npm run bench` — runs the real export stages over a fixed corpus and prints
 * per-stage milliseconds. `npm run bench -- --json` emits the same numbers as
 * JSON for CI.
 *
 * The issue's own instruction is that nothing here should be optimized without
 * a number before and after, and that the table in the issue was produced with
 * a throwaway script that should not have been necessary. This is that script,
 * kept.
 *
 * ## Reading the output honestly
 *
 * These are wall-clock timings on whatever machine runs them, so they are
 * comparable *within* a run and not across machines. A stage that is 40% of
 * the total on one machine will be roughly 40% on another; the absolute
 * milliseconds will not match, and a run on a loaded machine can be several
 * times slower across the board. Compare shares and ratios, not absolutes,
 * unless both runs are back to back on an idle machine.
 *
 * Resolution defaults to 128 rather than the export's 256 so a run takes
 * seconds rather than minutes. Cost is cubic, so a stage's *share* is what
 * carries over; pass `--res=256` to reproduce the export exactly.
 */
import { toSDFNode } from '../src/worker/sdf/convert';
import { computeBounds } from '../src/worker/sdf/bounds';
import { verifiedBounds } from '../src/worker/sdf/interval';
import { evaluateSDF } from '../src/worker/sdf/evaluate';
import { dualContour } from '../src/worker/sdf/dualContour';
import { simplifyMesh } from '../src/worker/sdf/simplify';
import { removeDegenerateTriangles, projectVerticesToSurface } from '../src/worker/sdf/meshRepair';
import { PRESET_CATEGORIES } from '../src/components/tree/presets';
import type { SDFNode, BBox } from '../src/worker/sdf/types';
import type { SDFNodeUI } from '../src/types/operations';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const resArg = args.find((a) => a.startsWith('--res='));
const RES = resArg ? parseInt(resArg.slice(6), 10) : 128;
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
/**
 * Repeats per stage, reported as the *minimum*.
 *
 * A mean is the wrong statistic on a shared machine: noise only ever adds
 * time, so the mean tracks whatever else the OS was doing, while the minimum
 * converges on the cost of the work itself. On an idle machine one repeat is
 * enough; on a loaded one, three or five is the difference between a usable
 * comparison and a coin flip. This exists because a first attempt at measuring
 * an evaluator change on a load-average-48 machine reported the optimised
 * build as *slower*, which was entirely the machine.
 */
const REPEAT = Number(args.find((a) => a.startsWith('--repeat='))?.slice(9) ?? 1);

function preset(name: string): SDFNodeUI {
  for (const cat of PRESET_CATEGORIES) {
    for (const item of cat.items) if (item.name === name) return item.build();
  }
  throw new Error(`no preset named ${name}`);
}

const n = (kind: string, params: Record<string, number>, children: SDFNodeUI[] = []): SDFNodeUI => ({
  id: `${kind}-${children.length}-${Object.values(params).join('_')}`,
  kind, label: kind, params, children, enabled: true,
});

/**
 * The corpus. Chosen so each entry stresses a different stage — a model that
 * is only ever a single primitive would say nothing about pattern cost or
 * about how boolean depth compounds through the evaluator's recursion.
 */
const CORPUS: { name: string; why: string; tree: SDFNodeUI }[] = [
  {
    name: 'primitive',
    why: 'Floor: one node, so this is the cost of the grid and the mesher with the evaluator contributing almost nothing.',
    tree: n('sphere', { radius: 30 }),
  },
  {
    name: 'enclosure',
    why: 'The shape a user actually exports: booleans over a rounded solid, from the shipping preset library.',
    tree: preset('Open-Top Enclosure'),
  },
  {
    name: 'patterned',
    why: 'A pattern inside a pattern. Every sample walks the child window twice over, which is where per-call allocation compounds.',
    tree: n('linearPattern', { axisX: 1, axisY: 0, axisZ: 0, count: 6, spacing: 14 }, [
      n('circularPattern', { axisX: 0, axisY: 1, axisZ: 0, count: 8 }, [
        n('translate', { x: 16, y: 0, z: 0 }, [n('cylinder', { radius: 3, height: 24 })]),
      ]),
    ]),
  },
  {
    name: 'deep-boolean',
    why: 'Twelve nested booleans: measures dispatch depth rather than geometry, since the surface stays simple.',
    tree: (() => {
      let t = n('box', { width: 60, height: 60, depth: 60 });
      for (let i = 0; i < 12; i++) {
        t = n('subtract', { smooth: 0 }, [
          t,
          n('translate', { x: 30 - i * 5, y: (i % 3) * 12 - 12, z: (i % 4) * 10 - 15 }, [
            n('sphere', { radius: 9 }),
          ]),
        ]);
      }
      return t;
    })(),
  },
];

/** Best of REPEAT runs — see the comment on REPEAT for why the minimum. */
function ms(fn: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < REPEAT; i++) {
    const t0 = performance.now();
    fn();
    const dt = performance.now() - t0;
    if (dt < best) best = dt;
  }
  return best;
}

/** The export's grid pass, transcribed without the progress plumbing. */
function evaluateGrid(root: SDFNode, bbox: BBox, res: number): Float32Array {
  const grid = new Float32Array(res * res * res);
  const dx = (bbox.max[0] - bbox.min[0]) / res;
  const dy = (bbox.max[1] - bbox.min[1]) / res;
  const dz = (bbox.max[2] - bbox.min[2]) / res;
  const r2 = res * res;
  for (let z = 0; z < res; z++) {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        grid[z * r2 + y * res + x] = evaluateSDF(root, [
          bbox.min[0] + (x + 0.5) * dx,
          bbox.min[1] + (y + 0.5) * dy,
          bbox.min[2] + (z + 0.5) * dz,
        ]);
      }
    }
  }
  return grid;
}

interface StageTimes {
  name: string;
  bounds: number;
  grid: number;
  contour: number;
  simplify: number;
  project: number;
  total: number;
  triangles: number;
  trianglesBeforeSimplify: number;
}

function run(name: string, tree: SDFNodeUI): StageTimes {
  const root = toSDFNode(tree)!;

  let bbox!: BBox;
  const bounds = ms(() => { bbox = verifiedBounds(root, computeBounds(root)) ?? computeBounds(root); });

  const voxel = Math.max(
    (bbox.max[0] - bbox.min[0]) / RES,
    (bbox.max[1] - bbox.min[1]) / RES,
    (bbox.max[2] - bbox.min[2]) / RES,
  );

  let grid!: Float32Array;
  const gridMs = ms(() => { grid = evaluateGrid(root, bbox, RES); });

  let raw!: ReturnType<typeof dualContour>;
  const contour = ms(() => { raw = dualContour(grid, RES, bbox, root); });

  const cleaned = removeDegenerateTriangles(raw);
  const before = cleaned.indices.length / 3;

  let simplified!: typeof cleaned;
  const simplify = ms(() => { simplified = simplifyMesh(cleaned, { maxError: voxel * 0.05 }); });

  let projected!: typeof simplified;
  const project = ms(() => { projected = projectVerticesToSurface(simplified, root, voxel * 0.5); });

  return {
    name,
    bounds, grid: gridMs, contour, simplify, project,
    total: bounds + gridMs + contour + simplify + project,
    triangles: projected.indices.length / 3,
    trianglesBeforeSimplify: before,
  };
}

const results: StageTimes[] = [];
for (const c of CORPUS) {
  if (only && c.name !== only) continue;
  results.push(run(c.name, c.tree));
}

if (asJson) {
  console.log(JSON.stringify({ resolution: RES, results }, null, 2));
} else {
  const pad = (s: string | number, w: number) => String(s).padStart(w);
  console.log(`\nExport pipeline, resolution ${RES}, best of ${REPEAT}\n`);
  console.log(
    `${'model'.padEnd(14)}${pad('bounds', 9)}${pad('grid', 9)}${pad('contour', 9)}` +
    `${pad('simplify', 10)}${pad('project', 9)}${pad('total', 10)}${pad('tris', 9)}`,
  );
  console.log('-'.repeat(79));
  for (const r of results) {
    console.log(
      `${r.name.padEnd(14)}${pad(r.bounds.toFixed(0), 9)}${pad(r.grid.toFixed(0), 9)}` +
      `${pad(r.contour.toFixed(0), 9)}${pad(r.simplify.toFixed(0), 10)}${pad(r.project.toFixed(0), 9)}` +
      `${pad(r.total.toFixed(0), 10)}${pad(r.triangles, 9)}`,
    );
  }
  console.log('\nAll times in ms. Comparable within a run, not across machines.');
  const worst = results.reduce((a, b) => (a.total > b.total ? a : b));
  const stages = (['bounds', 'grid', 'contour', 'simplify', 'project'] as const)
    .map((k) => ({ k, pct: (worst[k] / worst.total) * 100 }))
    .sort((a, b) => b.pct - a.pct);
  console.log(
    `Slowest model "${worst.name}": ` + stages.map((s) => `${s.k} ${s.pct.toFixed(0)}%`).join(', '),
  );
  console.log(
    `Simplification kept ${worst.triangles} of ${worst.trianglesBeforeSimplify} triangles ` +
    `(${((worst.triangles / worst.trianglesBeforeSimplify) * 100).toFixed(0)}%).\n`,
  );
}
