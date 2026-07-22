import { completeMassProperties } from "./mechanism-geometry-compiler.js";
import { DomainValidationError } from "./primitives.js";

const ZERO = Object.freeze([
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
const scaleMatrix = (matrix, scalar) =>
  matrix.map((row) => row.map((value) => value * scalar));

function parallelAxis(massKg, offset) {
  const distanceSquared = offset.reduce((sum, value) => sum + value * value, 0);
  return ZERO.map((row, rowIndex) =>
    row.map(
      (_, columnIndex) =>
        massKg *
        (distanceSquared * (rowIndex === columnIndex ? 1 : 0) -
          offset[rowIndex] * offset[columnIndex]),
    ),
  );
}

function bladderSolid(store, remainingMassKg) {
  if (remainingMassKg <= 0) return null;
  const axisIndex = store.storageAxisPart.findIndex(
    (value) => Math.abs(value) > 1 - 1e-9,
  );
  if (
    axisIndex < 0 ||
    store.storageAxisPart.some(
      (value, index) => index !== axisIndex && Math.abs(value) > 1e-9,
    )
  )
    throw new DomainValidationError(
      "UNSUPPORTED_MATERIAL_STORAGE_AXIS",
      "Positive-displacement bladder v1 requires a principal part axis",
      { details: { storageAxisPart: store.storageAxisPart } },
    );
  if (remainingMassKg > store.capacityKg + 1e-9)
    throw new DomainValidationError(
      "MATERIAL_STORE_MASS_EXCEEDS_CAPACITY",
      "Remaining material mass may not exceed the compiled store capacity",
      { details: { remainingMassKg, capacityKg: store.capacityKg } },
    );
  const fullSizeM = [...store.storageSolid.fullSizeM],
    storageCenterPartM = [...store.storageSolid.centerPartM],
    crossSectionM2 = fullSizeM.reduce(
      (area, dimension, index) =>
        index === axisIndex ? area : area * dimension,
      1,
    ),
    occupiedLengthM = Math.min(
      fullSizeM[axisIndex],
      remainingMassKg / store.densityKgM3 / crossSectionM2,
    ),
    sizeM = [...fullSizeM],
    centerPartM = [...storageCenterPartM];
  sizeM[axisIndex] = occupiedLengthM;
  centerPartM[axisIndex] +=
    Math.sign(store.storageAxisPart[axisIndex]) *
    (fullSizeM[axisIndex] - occupiedLengthM) *
    0.5;
  const [x, y, z] = sizeM;
  return {
    massKg: remainingMassKg,
    volumeM3: remainingMassKg / store.densityKgM3,
    centerPartM,
    sizeM,
    inertiaAtCenter: [
      [(remainingMassKg * (y * y + z * z)) / 12, 0, 0],
      [0, (remainingMassKg * (x * x + z * z)) / 12, 0],
      [0, 0, (remainingMassKg * (x * x + y * y)) / 12],
    ],
  };
}

/**
 * Composes immutable dry/ablative mass with the remaining outlet-anchored
 * bladder volume. The returned frame and tensor are authoritative for the next
 * fixed tick.
 */
export function deriveDynamicMassProperties(
  bodyDescriptor,
  { structuralMassKg, materialStore = null },
) {
  const base = bodyDescriptor.massProperties,
    structuralMass = Math.max(0.001, Number(structuralMassKg)),
    structuralScale = structuralMass / Math.max(0.001, base.massKg),
    structuralCom = [...base.comPositionPartM],
    storedMass = Math.max(0, Number(materialStore?.remainingMassKg || 0)),
    bladder = materialStore ? bladderSolid(materialStore, storedMass) : null,
    massKg = structuralMass + (bladder?.massKg || 0),
    comPositionPartM = structuralCom.map(
      (value, axis) =>
        (value * structuralMass +
          (bladder?.centerPartM[axis] || 0) * (bladder?.massKg || 0)) /
        massKg,
    ),
    structuralOffset = structuralCom.map(
      (value, axis) => value - comPositionPartM[axis],
    );
  let inertia = addMatrices(
    scaleMatrix(tensorMatrix(base.inertiaTensorAtComPartKgM2), structuralScale),
    parallelAxis(structuralMass, structuralOffset),
  );
  if (bladder) {
    const offset = bladder.centerPartM.map(
      (value, axis) => value - comPositionPartM[axis],
    );
    inertia = addMatrices(
      inertia,
      addMatrices(
        bladder.inertiaAtCenter,
        parallelAxis(bladder.massKg, offset),
      ),
    );
  }
  return completeMassProperties({
    sourceKind: "dynamic-dry-ablation-bladder-v1",
    massEvaluationPolicy: "single-post-thermal-transaction-v1",
    massKg,
    volumeM3: base.volumeM3,
    comPositionPartM,
    inertiaTensorAtComPartKgM2: tensorRecord(inertia),
    contributingSolidIds: [
      ...(base.contributingSolidIds || []),
      ...(bladder ? [`material-store:${bodyDescriptor.partId}`] : []),
    ],
    dynamicMaterialStore: bladder
      ? {
          partId: bodyDescriptor.partId,
          remainingMassKg: bladder.massKg,
          centerPartM: bladder.centerPartM,
          sizeM: bladder.sizeM,
        }
      : null,
  });
}
