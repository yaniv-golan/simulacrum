import { readActuatorCommand } from "../../model/actuator-contracts.js";

/** Advances declared non-constraint actuators through commands and power. */
export class ComponentActuatorSystem {
  phase = "actuators";

  step(context, dt) {
    const runtime = context.services.multibodyRuntime,
      descriptors = runtime?.compiled?.actuators || [],
      states = [];
    for (const descriptor of descriptors) {
      if (descriptor.kind !== "luminaire-v1") continue;
      const part = runtime.part(descriptor.sourcePartId),
        command = readActuatorCommand(
          context.commandBus,
          part,
          descriptor.channel,
          0,
        ).value,
        allocation = context.powerNetwork?.allocationFor(part.id),
        requestedW = command > 0 ? descriptor.electricalPowerW : 0,
        deliveredW =
          requestedW > 0 && allocation?.operational
            ? context.powerNetwork.drawPower(part.id, requestedW, dt)
            : 0,
        enabled = requestedW > 0 && deliveredW >= requestedW * 0.98;
      states.push({
        actuatorId: descriptor.id,
        partId: part.id,
        kind: descriptor.kind,
        command,
        requestedW,
        deliveredW,
        enabled,
        luminousFluxLm: enabled ? descriptor.luminousFluxLm : 0,
      });
    }
    context.telemetry.componentActuators = { states };
  }
}
