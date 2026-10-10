import type { SDFNodeUI } from '../../src/types/operations';

/**
 * The model created during the October 2026 computer-use stress session.
 *
 * Its long left-associated smooth-union chain plus four final subtractions
 * made Chromium's viewport replacement stall/fail and exposed that the app
 * discarded the prior good shader before the replacement was accepted. Keep
 * this as a realistic renderer/optimizer corpus rather than reducing it to a
 * synthetic pile of spheres: transforms, smooth booleans, small facial cuts,
 * and widely different feature scales are all part of the workload.
 */
let serial = 0;
const id = (kind: string) => `stress-cow-${kind}-${++serial}`;
const leaf = (kind: string, label: string, params: Record<string, number>): SDFNodeUI =>
  ({ id: id(kind), kind, label, params, children: [], enabled: true });
const unary = (kind: string, label: string, params: Record<string, number>, child: SDFNodeUI): SDFNodeUI =>
  ({ id: id(kind), kind, label, params, children: [child], enabled: true });
const move = (label: string, at: [number, number, number], child: SDFNodeUI) =>
  unary('translate', `${label} position`, { x: at[0], y: at[1], z: at[2] }, child);
const ellipsoid = (label: string, size: [number, number, number], at: [number, number, number]) =>
  move(label, at, leaf('ellipsoid', label, { width: size[0], height: size[1], depth: size[2] }));
const capsule = (label: string, radius: number, height: number, at: [number, number, number], angles?: [number, number, number]) => {
  let node = leaf('capsule', label, { radius, height });
  if (angles) node = unary('rotate', `${label} angle`, { x: angles[0], y: angles[1], z: angles[2] }, node);
  return move(label, at, node);
};
const sphere = (label: string, radius: number, at: [number, number, number]) => move(label, at, leaf('sphere', label, { radius }));
const cone = (label: string, radius: number, height: number, at: [number, number, number], angles: [number, number, number]) =>
  move(label, at, unary('rotate', `${label} angle`, { x: angles[0], y: angles[1], z: angles[2] }, leaf('cone', label, { radius, height })));
const join = (a: SDFNodeUI, b: SDFNodeUI): SDFNodeUI =>
  ({ id: id('union'), kind: 'union', label: 'Cow assembly', params: { smooth: 3.5 }, children: [a, b], enabled: true });

export function createRendererStressCow(): SDFNodeUI {
  serial = 0;
  const parts = [
    ellipsoid('Ribcage', [76, 50, 112], [0, 49, 0]),
    ellipsoid('Shoulders', [68, 54, 54], [0, 52, -36]),
    ellipsoid('Hips', [70, 52, 50], [0, 52, 38]),
    capsule('Neck', 18, 39, [0, 66, -50], [-35, 0, 0]),
    ellipsoid('Head', [47, 42, 52], [0, 70, -77]),
    ellipsoid('Muzzle', [38, 24, 32], [0, 58, -101]),
    ...([-1, 1] as const).flatMap((side) => [
      capsule(`${side < 0 ? 'Left' : 'Right'} front upper leg`, 8.5, 27, [side * 24, 27, -34], [0, 0, side * 5]),
      capsule(`${side < 0 ? 'Left' : 'Right'} front lower leg`, 6.3, 29, [side * 22, 4, -36], [0, 0, side * -3]),
      capsule(`${side < 0 ? 'Left' : 'Right'} rear thigh`, 10, 29, [side * 24, 29, 35], [8, 0, side * 7]),
      capsule(`${side < 0 ? 'Left' : 'Right'} rear hock`, 6.5, 30, [side * 21, 4, 40], [-10, 0, side * -4]),
      ellipsoid(`${side < 0 ? 'Left' : 'Right'} ear`, [23, 7, 14], [side * 29, 79, -76]),
      cone(`${side < 0 ? 'Left' : 'Right'} horn`, 4.5, 19, [side * 14, 93, -74], [0, 0, side * 18]),
      ellipsoid(`${side < 0 ? 'Left' : 'Right'} front outer claw`, [9, 8, 20], [side * 26, -15, -40]),
      ellipsoid(`${side < 0 ? 'Left' : 'Right'} front inner claw`, [9, 8, 20], [side * 18, -15, -40]),
      ellipsoid(`${side < 0 ? 'Left' : 'Right'} rear outer claw`, [9, 8, 21], [side * 25, -15, 43]),
      ellipsoid(`${side < 0 ? 'Left' : 'Right'} rear inner claw`, [9, 8, 21], [side * 17, -15, 43]),
    ]),
    ellipsoid('Udder', [30, 18, 34], [0, 22, 25]),
    capsule('Tail base', 4.8, 29, [0, 60, 65], [68, 0, 0]),
    capsule('Tail lower', 3.5, 29, [0, 49, 84], [-38, 0, 0]),
    ellipsoid('Tail tuft', [12, 19, 11], [0, 37, 95]),
  ];
  let tree = parts.reduce(join);
  for (const cut of [
    sphere('Left eye socket', 4.2, [-15, 72, -101]),
    sphere('Right eye socket', 4.2, [15, 72, -101]),
    sphere('Left nostril', 2.7, [-8, 59, -116]),
    sphere('Right nostril', 2.7, [8, 59, -116]),
  ]) {
    tree = { id: id('subtract'), kind: 'subtract', label: 'Facial detail', params: { smooth: 0.8 }, children: [tree, cut], enabled: true };
  }
  tree.label = 'Renderer stress cow';
  return tree;
}

export const rendererStressCow = createRendererStressCow();
