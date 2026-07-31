/** Critical numeric decisions shared by validation, deformation, and tests. */
export const equalRadialScale = (scaleX, scaleY) =>
  Math.abs(scaleX - scaleY) <= 1e-12;

export const gearPitchConsistent = (pitchRadiusM, moduleM, toothCount) =>
  Math.abs(pitchRadiusM - (moduleM * toothCount) / 2) <= 1e-9;

export const deformationAxialScale = (coordinateM, referenceBodyLengthM) =>
  coordinateM / referenceBodyLengthM;

export const deformationAxialTranslation = (
  coordinateM,
  referenceCoordinateM,
  gainMPerM,
) => (coordinateM - referenceCoordinateM) * gainMPerM;

export const clampMechanismCoordinate = (coordinateM, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, coordinateM));
