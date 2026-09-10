/** Classify elastic mobility without excluding native cyclic components. Descriptors must already be validated. */
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
  const fixed = sets();
  for (const j of joints) {
    if (j.kind === 'fixed') fixed.join(j.a, j.b);
  }
  const groundedFixed = new Set(bodies.flatMap((b, i) => (b.fixed ? [fixed.root(i)] : [])));
  const immobile = (a, b) =>
    fixed.root(a) === fixed.root(b) ||
    (groundedFixed.has(fixed.root(a)) && groundedFixed.has(fixed.root(b)));
  const activeElastic = joints.flatMap((j, i) =>
    j.kind === 'spring' && j.stiffness > 0 && !immobile(j.a, j.b) ? [i] : [],
  );
  return Object.freeze({ activeElastic: Object.freeze(activeElastic), isRigidPair: immobile });
}
