import { readActuatorCommand } from "../../model/actuator-contracts.js";
import { DomainValidationError } from "../../model/primitives.js";

function descriptors(context) {
  return (context.services.multibodyRuntime?.compiled?.actuators || [])
    .filter((descriptor) => descriptor.kind === "release-coupler-v1")
    .sort((left, right) => left.sourcePartId - right.sourcePartId);
}

function initialActuationState() {
  return { previousCommand: 0, accumulatedEnergyJ: 0 };
}

/**
 * Opens authored electromechanical latches. The structural graph mutation is
 * committed before integration; no force or separation impulse is introduced.
 */
export class ReleaseCouplerSystem {
  phase = "actuators";
  checkpointOwner = "release-couplers";
  #actuationByPart = new Map();

  initialize(context) {
    this.#actuationByPart = new Map(
      descriptors(context).map((descriptor) => [
        descriptor.sourcePartId,
        initialActuationState(),
      ]),
    );
  }

  step(context, fixedDt) {
    const runtime = context.services.multibodyRuntime,
      connections = new Map(
        context.runGraph
          .connections()
          .map((connection) => [connection.id, connection]),
      ),
      states = [];
    for (const descriptor of descriptors(context)) {
      const part = context.runGraph.part(descriptor.sourcePartId),
        law = descriptor.law,
        actuation =
          this.#actuationByPart.get(part.id) || initialActuationState(),
        command = readActuatorCommand(
          context.commandBus,
          part,
          law.commandChannel,
          0,
        ).value,
        commanded = command > law.commandThreshold,
        wasCommanded = actuation.previousCommand > law.commandThreshold,
        risingEdge = command > law.commandThreshold && !wasCommanded,
        released = descriptor.sourceConnectionIds.some(
          (connectionId) => connections.get(connectionId)?.failed,
        ),
        remainingEnergyJ = Math.max(
          0,
          law.actuationEnergyJ - actuation.accumulatedEnergyJ,
        ),
        requestedW =
          commanded && !released
            ? Math.min(law.maximumElectricalPowerW, remainingEnergyJ / fixedDt)
            : 0,
        deliveredW =
          requestedW > 0
            ? context.powerNetwork?.drawPower(part.id, requestedW, fixedDt) || 0
            : 0,
        deliveredEnergyJ = deliveredW * fixedDt,
        accumulatedEnergyJ =
          commanded && !released
            ? Math.min(
                law.actuationEnergyJ,
                actuation.accumulatedEnergyJ + deliveredEnergyJ,
              )
            : 0,
        energySatisfied =
          accumulatedEnergyJ + Number.EPSILON >= law.actuationEnergyJ,
        shouldRelease = commanded && !released && energySatisfied;
      let structuralEvent = null,
        detachedConstraints = [];
      if (shouldRelease) {
        structuralEvent = context.runGraph.applyStructuralEvent({
          failedConnectionIds: [
            ...descriptor.sourceConnectionIds,
            ...descriptor.breakawayConnectionIds,
          ],
          reason: `release coupler ${String(part.id)} opened`,
          mode: "commanded-release",
          time: context.time,
        });
        detachedConstraints =
          runtime?.applyConnectionFailures(context.runGraph.connections()) ||
          [];
        for (const connectionId of descriptor.sourceConnectionIds)
          context.bodyRegistry.removeConstraint(connectionId);
      }
      this.#actuationByPart.set(part.id, {
        previousCommand: command,
        accumulatedEnergyJ: shouldRelease ? 0 : accumulatedEnergyJ,
      });
      states.push({
        actuatorId: descriptor.id,
        partId: part.id,
        command,
        risingEdge,
        requestedW,
        deliveredW,
        deliveredEnergyJ,
        accumulatedEnergyJ,
        requiredEnergyJ: law.actuationEnergyJ,
        released: released || Boolean(structuralEvent?.changed),
        failedConnectionIds: structuralEvent?.failedConnectionIds || [],
        detachedConstraints,
      });
    }
    context.telemetry.releaseCouplers = { states };
  }

  exportState(context) {
    return {
      version: 1,
      states: descriptors(context).map((descriptor) => {
        const state =
          this.#actuationByPart.get(descriptor.sourcePartId) ||
          initialActuationState();
        return {
          partId: descriptor.sourcePartId,
          previousCommand: state.previousCommand,
          accumulatedEnergyJ: state.accumulatedEnergyJ,
        };
      }),
    };
  }

  importState(context, checkpoint) {
    const expected = descriptors(context),
      states = checkpoint?.states;
    if (
      checkpoint?.version !== 1 ||
      !Array.isArray(states) ||
      states.length !== expected.length
    )
      throw new DomainValidationError(
        "INVALID_RELEASE_COUPLER_CHECKPOINT",
        "Release-coupler checkpoint does not match the compiled actuator set",
      );
    const restored = new Map();
    for (let index = 0; index < expected.length; index++) {
      const descriptor = expected[index],
        state = states[index];
      if (
        state?.partId !== descriptor.sourcePartId ||
        !Number.isFinite(state.previousCommand) ||
        state.previousCommand < -1 ||
        state.previousCommand > 1 ||
        !Number.isFinite(state.accumulatedEnergyJ) ||
        state.accumulatedEnergyJ < 0 ||
        state.accumulatedEnergyJ > descriptor.law.actuationEnergyJ
      )
        throw new DomainValidationError(
          "INVALID_RELEASE_COUPLER_CHECKPOINT",
          "Release-coupler checkpoint contains invalid actuator state",
          { path: ["states", index] },
        );
      restored.set(state.partId, {
        previousCommand: state.previousCommand,
        accumulatedEnergyJ: state.accumulatedEnergyJ,
      });
    }
    this.#actuationByPart = restored;
  }
}
