/**
 * How far the mesher is allowed to move a vertex, as a fraction of one voxel.
 *
 * These live here rather than at their use sites because two places run this
 * pipeline: `sdfWorker.ts`, which is what a user's export actually executes,
 * and `bench/mesh.bench.ts`, which claims to measure it. Those had already
 * drifted — the bench went on timing a stage configuration the exporter no
 * longer used, and reported it as the export's cost. A benchmark that measures
 * something nobody runs is worse than no benchmark, because it is believed.
 */

/**
 * Budget for octree vertex clustering, during contouring.
 *
 * Half the simplifier's, because both stages move vertices and their errors
 * add: spending the whole allowance here would let QEM spend it again on top.
 * Splitting it keeps the total inside what the export promises, and this is the
 * cheaper half — clustering removes triangles before they exist, where QEM pays
 * to collapse them afterwards.
 */
export const CLUSTER_ERROR_VOXELS = 0.025;

/** Budget for QEM edge collapse, after contouring. */
export const SIMPLIFY_ERROR_VOXELS = 0.05;

/** How far `projectVerticesToSurface` may search for the isosurface. */
export const PROJECT_TOLERANCE_VOXELS = 0.5;
