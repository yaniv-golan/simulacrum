import { rotateVector } from '../../model/transforms.mjs';
/** Numeric descriptor admission. Meshes couple independently supported rotors;
 * they never supply the missing bearing or turn a fixed edge into mobility. */
export function admitGearTopology(bodies, joints) {
  const parent = bodies.map((_, i) => i),
    root = (i) => {
      while (parent[i] !== i) i = parent[i];
      return i;
    };
  for (const j of joints) if (j.kind === 'fixed') parent[root(j.b)] = root(j.a);
  const meshes = joints.filter((j) => j.kind === 'gear');
  if (meshes.length > 8) throw new RangeError('at most 8 gear meshes');
  const carrier = (body, gearAxis, gearCentre) => {
    const rotor = root(body),
      supports = joints.filter(
        (j) =>
          j.kind !== 'gear' &&
          root(j.a) !== root(j.b) &&
          (root(j.a) === rotor || root(j.b) === rotor),
      );
    if (
      bodies.some((b, i) => b.fixed && root(i) === rotor) ||
      !supports.length ||
      supports.some((j) => j.kind !== 'revolute' || j.limits)
    )
      throw new RangeError('gear requires an independently supported revolute rotor');
    const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
    for (const support of supports)
      for (const [index, localAxis, localAnchor] of [
        [support.a, support.axisA, support.anchorA],
        [support.b, support.axisB, support.anchorB],
      ]) {
        const axis = rotateVector(bodies[index].rotation, localAxis),
          point = rotateVector(bodies[index].rotation, localAnchor).map(
            (x, i) => x + bodies[index].position[i],
          ),
          offset = point.map((x, i) => x - gearCentre[i]),
          axial = dot(offset, gearAxis);
        if (
          Math.abs(dot(axis, gearAxis)) < 0.99999 ||
          Math.hypot(...offset.map((x, i) => x - axial * gearAxis[i])) > 1e-5
        )
          throw new RangeError('gear bearing support must be coaxial');
      }
    const others = new Set(supports.map((j) => (root(j.a) === rotor ? root(j.b) : root(j.a))));
    if (others.size !== 1) throw new RangeError('ambiguous gear carrier');
    return [...others][0];
  };
  const tree = new Map(),
    tr = (i) => {
      while (tree.has(i)) i = tree.get(i);
      return i;
    };
  for (const j of meshes) {
    const supportFor = (body, axis, anchor) =>
      carrier(
        body,
        rotateVector(bodies[body].rotation, axis),
        rotateVector(bodies[body].rotation, anchor).map((x, i) => x + bodies[body].position[i]),
      );
    if (
      root(j.a) === root(j.b) ||
      supportFor(j.a, j.axisA, j.anchorA) !== supportFor(j.b, j.axisB, j.anchorB)
    )
      throw new RangeError('gear rotors must share a rigid carrier');
    const a = tr(root(j.a)),
      b = tr(root(j.b));
    if (a === b) throw new RangeError('gear mesh loops unsupported');
    tree.set(b, a);
  }
}
