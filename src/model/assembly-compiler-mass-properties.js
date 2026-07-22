import { completeMassProperties } from "./mechanism-geometry-compiler.js";
import { cloneCompiledValue } from "./assembly-compiler-shared.js";

const ZERO_MATRIX = Object.freeze([
  Object.freeze([0, 0, 0]),
  Object.freeze([0, 0, 0]),
  Object.freeze([0, 0, 0]),
]);

const tensorMatrix = (tensor) => [
  [tensor.xx, tensor.xy, tensor.xz],
  [tensor.xy, tensor.yy, tensor.yz],
  [tensor.xz, tensor.yz, tensor.zz],
];

const tensorRecord = (matrix) => ({
  xx: matrix[0][0],
  yy: matrix[1][1],
  zz: matrix[2][2],
  xy: (matrix[0][1] + matrix[1][0]) / 2,
  xz: (matrix[0][2] + matrix[2][0]) / 2,
  yz: (matrix[1][2] + matrix[2][1]) / 2,
});

const addMatrices = (left, right) =>
  left.map((row, rowIndex) =>
    row.map((value, columnIndex) => value + right[rowIndex][columnIndex]),
  );

function parallelAxis(massKg, offset) {
  const distanceSquared = offset.reduce(
    (total, value) => total + value * value,
    0,
  );
  return ZERO_MATRIX.map((row, rowIndex) =>
    row.map(
      (_, columnIndex) =>
        massKg *
        (distanceSquared * (rowIndex === columnIndex ? 1 : 0) -
          offset[rowIndex] * offset[columnIndex]),
    ),
  );
}

export function composePointMasses(base, pointMasses) {
  if (!pointMasses.length) return base;
  const massKg =
      base.massKg + pointMasses.reduce((sum, point) => sum + point.massKg, 0),
    weighted = base.comPositionPartM.map((value) => value * base.massKg);
  for (const point of pointMasses)
    for (let axis = 0; axis < 3; axis++)
      weighted[axis] += point.positionPartM[axis] * point.massKg;
  const comPositionPartM = weighted.map((value) => value / massKg),
    baseOffset = base.comPositionPartM.map(
      (value, axis) => value - comPositionPartM[axis],
    );
  let inertia = addMatrices(
    tensorMatrix(base.inertiaTensorAtComPartKgM2),
    parallelAxis(base.massKg, baseOffset),
  );
  for (const point of pointMasses) {
    const offset = point.positionPartM.map(
      (value, axis) => value - comPositionPartM[axis],
    );
    inertia = addMatrices(inertia, parallelAxis(point.massKg, offset));
  }
  return completeMassProperties({
    sourceKind: "base-solid-plus-endpoint-point-masses-v1",
    massEvaluationPolicy: "parallel-axis-exact-point-masses-v1",
    massKg,
    volumeM3: base.volumeM3,
    comPositionPartM,
    inertiaTensorAtComPartKgM2: tensorRecord(inertia),
    contributingSolidIds: [...(base.contributingSolidIds || [])],
    endpointPointMasses: cloneCompiledValue(pointMasses),
  });
}
