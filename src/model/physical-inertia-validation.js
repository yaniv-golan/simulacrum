/**
 * Rejects tensors that cannot be the inertia of a positive-mass 3D body.
 * Positive definiteness is necessary but not sufficient: the equivalent
 * second-moment matrix must also be positive semidefinite, which enforces the
 * principal-moment triangle inequalities without choosing principal axes.
 */
export function validatePhysicalInertiaTensor(matrix, label = "inertia") {
  if (
    !Array.isArray(matrix) ||
    matrix.length !== 3 ||
    !matrix.every(
      (row) =>
        Array.isArray(row) && row.length === 3 && row.every(Number.isFinite),
    )
  )
    throw new TypeError(`${label} must be a finite 3x3 matrix`);
  const scale = Math.max(...matrix.flat().map(Math.abs));
  if (!(scale > 0)) throw new RangeError(`${label} must be positive definite`);
  const relativeTolerance = 64 * Number.EPSILON;
  for (let row = 0; row < 3; row++)
    for (let column = row + 1; column < 3; column++)
      if (
        Math.abs(matrix[row][column] - matrix[column][row]) >
        relativeTolerance * scale
      )
        throw new RangeError(`${label} must be symmetric`);

  // Evaluate homogeneous definiteness and moment inequalities after scaling
  // out the tensor magnitude. Direct quadratic/cubic products underflow for
  // physically valid micro-scale bodies and overflow for very large ones.
  const normalized = matrix.map((row) => row.map((value) => value / scale)),
    [a, b, c] = normalized,
    leading2 = a[0] * b[1] - a[1] * b[0],
    determinant =
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (!(a[0] > 0 && leading2 > 0 && determinant > 0))
    throw new RangeError(`${label} must be positive definite`);

  const halfTrace = (a[0] + b[1] + c[2]) / 2,
    secondMoment = normalized.map((row, rowIndex) =>
      row.map((value, columnIndex) =>
        rowIndex === columnIndex ? halfTrace - value : -value,
      ),
    ),
    principal2 = [
      secondMoment[0][0] * secondMoment[1][1] -
        secondMoment[0][1] * secondMoment[1][0],
      secondMoment[0][0] * secondMoment[2][2] -
        secondMoment[0][2] * secondMoment[2][0],
      secondMoment[1][1] * secondMoment[2][2] -
        secondMoment[1][2] * secondMoment[2][1],
    ],
    secondMomentDeterminant =
      secondMoment[0][0] *
        (secondMoment[1][1] * secondMoment[2][2] -
          secondMoment[1][2] * secondMoment[2][1]) -
      secondMoment[0][1] *
        (secondMoment[1][0] * secondMoment[2][2] -
          secondMoment[1][2] * secondMoment[2][0]) +
      secondMoment[0][2] *
        (secondMoment[1][0] * secondMoment[2][1] -
          secondMoment[1][1] * secondMoment[2][0]),
    linearTolerance = relativeTolerance,
    quadraticTolerance = relativeTolerance,
    cubicTolerance = relativeTolerance;
  if (
    secondMoment.some((row, index) => row[index] < -linearTolerance) ||
    principal2.some((minor) => minor < -quadraticTolerance) ||
    secondMomentDeterminant < -cubicTolerance
  )
    throw new RangeError(`${label} violates physical moment inequalities`);
  return matrix;
}
