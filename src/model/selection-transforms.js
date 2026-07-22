const clonePosition = (part) => [...part.pos];

export function selectionPivot(parts) {
  if (!parts.length) return [0, 0, 0];
  return parts
    .reduce(
      (sum, part) => sum.map((value, axis) => value + part.pos[axis]),
      [0, 0, 0],
    )
    .map((value) => value / parts.length);
}

export function translateSelectionTo(parts, targetPivot) {
  const pivot = selectionPivot(parts),
    delta = targetPivot.map((value, axis) => value - pivot[axis]);
  return new Map(
    parts.map((part) => [
      part.id,
      part.pos.map((value, axis) => value + delta[axis]),
    ]),
  );
}

export function alignSelection(parts, primaryId, axis) {
  const primary = parts.find((part) => part.id === primaryId);
  if (!primary || ![0, 1, 2].includes(axis)) return new Map();
  return new Map(
    parts.map((part) => {
      const position = clonePosition(part);
      position[axis] = primary.pos[axis];
      return [part.id, position];
    }),
  );
}

export function distributeSelection(parts, axis) {
  if (parts.length < 3 || ![0, 1, 2].includes(axis)) return new Map();
  const sorted = [...parts].sort((a, b) => a.pos[axis] - b.pos[axis]),
    start = sorted[0].pos[axis],
    step = (sorted.at(-1).pos[axis] - start) / (sorted.length - 1);
  return new Map(
    sorted.map((part, index) => {
      const position = clonePosition(part);
      position[axis] = start + step * index;
      return [part.id, position];
    }),
  );
}
