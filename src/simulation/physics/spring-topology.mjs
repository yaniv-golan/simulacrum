/** Bounded native spring topology admission. Descriptors must already be validated. */
export function springTopologyDomain(bodies, joints) {
  const sets = () => {
    const parent = bodies.map((_, i) => i);
    const root = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    return {
      root,
      join(a, b) {
        a = root(a);
        b = root(b);
        if (a === b) return false;
        parent[b] = a;
        return true;
      },
    };
  };
  const fixed = sets(),
    mechanical = sets();
  for (const j of joints) {
    mechanical.join(j.a, j.b);
    if (j.kind === 'fixed') fixed.join(j.a, j.b);
  }
  const groundedFixed = new Set(bodies.flatMap((b, i) => (b.fixed ? [fixed.root(i)] : [])));
  const immobile = (a, b) =>
    fixed.root(a) === fixed.root(b) ||
    (groundedFixed.has(fixed.root(a)) && groundedFixed.has(fixed.root(b)));
  const activeElastic = joints.flatMap((j, i) =>
    j.kind === 'spring' && j.stiffness > 0 && !immobile(j.a, j.b) ? [i] : [],
  );
  const activeComponents = new Set(activeElastic.map((i) => mechanical.root(joints[i].a)));
  const forest = sets();
  // All immovable bodies refer to the same inertial ground. No authored joint
  // edge is consumed here: fixed joints and inactive guides still create rows.
  let ground;
  bodies.forEach((b, i) => {
    if (b.fixed) {
      if (ground === undefined) ground = i;
      else forest.join(ground, i);
    }
  });
  for (const [i, j] of joints.entries()) {
    if (!activeComponents.has(mechanical.root(j.a))) continue;
    if (!forest.join(j.a, j.b))
      throw Object.assign(new RangeError('SPRING_TOPOLOGY_UNQUALIFIED'), {
        reasonCode: 'SPRING_TOPOLOGY_UNQUALIFIED',
        jointIndex: i,
      });
  }
  return Object.freeze({ activeElastic: Object.freeze(activeElastic) });
}
