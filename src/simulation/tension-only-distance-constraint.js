import * as CANNON from "cannon-es";

/**
 * A unilateral maximum-distance constraint. It may pull two physical entities
 * together after the authored rest length is exceeded, but its solver row is
 * forbidden from producing the positive multiplier that would push them apart.
 */
export class TensionOnlyDistanceConstraint extends CANNON.DistanceConstraint {
  constructor(
    bodyA,
    bodyB,
    {
      restLengthM,
      maximumTensionN,
      stiffnessNPerM = 1e7,
      relaxation = 4,
      timeStepS = 1 / 120,
    },
  ) {
    if (!(restLengthM > 0) || !Number.isFinite(restLengthM))
      throw new TypeError("restLengthM must be finite and greater than zero");
    if (!(maximumTensionN > 0) || !Number.isFinite(maximumTensionN))
      throw new TypeError(
        "maximumTensionN must be finite and greater than zero",
      );
    if (!(stiffnessNPerM > 0) || !Number.isFinite(stiffnessNPerM))
      throw new TypeError(
        "stiffnessNPerM must be finite and greater than zero",
      );
    if (!(relaxation >= 0) || !Number.isFinite(relaxation))
      throw new TypeError("relaxation must be finite and non-negative");
    if (!(timeStepS > 0) || !Number.isFinite(timeStepS))
      throw new TypeError("timeStepS must be finite and greater than zero");

    super(bodyA, bodyB, restLengthM, maximumTensionN);
    this.restLengthM = restLengthM;
    this.maximumTensionN = maximumTensionN;
    this.distanceEquation.minForce = -maximumTensionN;
    this.distanceEquation.maxForce = 0;
    this.distanceEquation.setSpookParams(stiffnessNPerM, relaxation, timeStepS);
  }

  tensionN() {
    return Math.max(0, -this.distanceEquation.multiplier);
  }

  extensionM() {
    return Math.max(
      0,
      this.bodyA.position.distanceTo(this.bodyB.position) - this.restLengthM,
    );
  }
}
