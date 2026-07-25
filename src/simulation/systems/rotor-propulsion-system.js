/** Applies shaft-derived rotor force before the single rigid-body solve. */
export class RotorPropulsionSystem {
  phase = "environment";

  step(context) {
    context.services.rotorForceOwner?.step(context);
  }

  dispose(context) {
    context.services.rotorForceOwner?.dispose();
  }
}
