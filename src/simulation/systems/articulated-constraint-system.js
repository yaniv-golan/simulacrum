import { ArticulatedAssemblyController } from "../articulated-assembly-controller.js";

/**
 * Plans powered joint targets and balance torque for every compiled articulated
 * graph. The controller consumes registered bodies and completed contacts; it
 * never creates bodies, constraints, or integration steps.
 */
export class ArticulatedConstraintSystem {
  phase = "actuators";

  initialize(context) {
    const runtime = context.services.multibodyRuntime;
    if (!runtime?.hasArticulation?.()) return;
    context.services.articulatedController = new ArticulatedAssemblyController(
      runtime,
    );
  }

  step(context, dt) {
    const controller = context.services.articulatedController;
    if (!controller?.active()) return;
    context.telemetry.articulated = controller.prepare(context, dt);
  }

  dispose(context) {
    context.services.articulatedController?.dispose();
    context.services.articulatedController = null;
  }
}
