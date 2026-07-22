import { DomainValidationError } from "../../model/primitives.js";

/** Runs actuator commands exclusively through the compiled physical runtime. */
export class MechanismSystem {
  phase = "actuators";

  initialize(context) {
    if (!context.services.multibodyRuntime?.compiled)
      throw new DomainValidationError(
        "MISSING_COMPILED_MULTIBODY_RUNTIME",
        "MechanismSystem requires a started MultibodyRuntime",
      );
  }

  step(context, dt) {
    context.telemetry.mechanisms =
      context.services.multibodyRuntime.stepActuators(context, dt);
  }
}
