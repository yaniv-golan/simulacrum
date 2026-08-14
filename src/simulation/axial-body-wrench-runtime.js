import * as CANNON from "cannon-es";
import { DomainValidationError } from "../model/primitives.js";
import {
  activeFixedCluster,
  partFrame,
  validateLiveMultibodyEngineAuthority,
} from "./multibody-runtime.js";
import { axialState } from "./two-frame-mechanisms.js";

/**
 * Derives direct two-frame actuator wrench columns from current runtime
 * geometry, then solves a bounded target-frame effort allocation. This
 * simulation-internal authority does not publish actuator commands and is not
 * exported through Core.
 */
export function deriveAxialBodyWrenchObservation(runtime, parsed) {
  const integratedTick =
      runtime.worldAdapter?.telemetry().integratedTick ?? null,
    invalid = (reason) => ({
      valid: false,
      reason,
      tick: integratedTick,
      targetFrameWorld: null,
      columns: [],
    });
  if (!runtime.compiled) return invalid("runtime-not-started-v1");
  if (!Number.isSafeInteger(integratedTick) || integratedTick < 1)
    return invalid("no-completed-integration-v1");
  if (integratedTick !== parsed.observationTick)
    return invalid("stale-observation-tick-v1");
  validateLiveMultibodyEngineAuthority(runtime);
  const targetBody = runtime.bodyByPart.get(parsed.targetPartId);
  // Live authority already proves every owned body's typed identity and mass
  // frame. The remaining valid absence is a requested part with no body.
  if (!targetBody) return invalid("missing-target-body-v1");
  const targetFrame = partFrame(targetBody),
    targetFrameValues = [
      targetFrame.position.x,
      targetFrame.position.y,
      targetFrame.position.z,
      targetFrame.quaternion.x,
      targetFrame.quaternion.y,
      targetFrame.quaternion.z,
      targetFrame.quaternion.w,
    ];
  if (!targetFrameValues.every(Number.isFinite))
    return invalid("invalid-target-frame-v1");

  const columns = [];
  for (const requested of parsed.actuators) {
    const matches = runtime.constraintEntries.filter(
      (entry) =>
        entry.kind === "axial-actuator-v1" &&
        entry.descriptor.sourcePartId === requested.actuatorPartId,
    );
    if (matches.length !== 1)
      return invalid("missing-or-ambiguous-actuator-v1");
    const entry = matches[0],
      descriptor = entry.descriptor;
    if (entry.active === false) return invalid("inactive-actuator-v1");
    // Runtime startup proves force-command-v1 and absolute-effort-row
    // presence are equivalent, and live authority preserves the exact row.
    if (descriptor.mechanism.commandLaw.kind !== "force-command-v1")
      return invalid("unsupported-actuator-v1");
    const targetIsA = descriptor.a === parsed.targetPartId,
      targetIsB = descriptor.b === parsed.targetPartId;
    if (targetIsA === targetIsB)
      return invalid("target-not-exactly-one-endpoint-v1");
    if (
      activeFixedCluster(runtime.constraintEntries, descriptor.a).has(
        descriptor.b,
      )
    )
      return invalid("internal-actuator-v1");
    const bodyA = runtime.bodyByPart.get(descriptor.a),
      bodyB = runtime.bodyByPart.get(descriptor.b);
    // The live-authority check proves compiled constraint endpoint bodies are
    // present. Request parsing already confines bounds to the exact ordinary
    // linear_force_n envelope used by force-command-v1 actuators.
    let state;
    try {
      state = axialState(bodyA, bodyB, entry.localAnchorA, entry.localAnchorB);
    } catch (error) {
      if (
        error instanceof DomainValidationError &&
        error.code === "DEGENERATE_MECHANISM_AXIS"
      )
        return invalid("degenerate-actuator-axis-v1");
      throw error;
    }
    const targetEndpoint = targetIsA ? "A" : "B",
      sign = targetIsA ? -1 : 1,
      forceWorld = state.axis.scale(sign),
      worldToTargetPart = targetFrame.quaternion.conjugate(
        new CANNON.Quaternion(),
      ),
      forcePart = worldToTargetPart.vmult(forceWorld),
      localAnchor = targetIsA ? entry.localAnchorA : entry.localAnchorB,
      massFrame = targetBody.userData.massFrame,
      applicationPointPart = massFrame.principalToPart
        .vmult(localAnchor)
        .vadd(massFrame.comPart),
      momentPart = applicationPointPart.cross(forcePart),
      values = [
        applicationPointPart.x,
        applicationPointPart.y,
        applicationPointPart.z,
        forcePart.x,
        forcePart.y,
        forcePart.z,
        momentPart.x,
        momentPart.y,
        momentPart.z,
        state.rateMPerS,
      ];
    if (!values.every(Number.isFinite))
      return invalid("invalid-runtime-geometry-v1");
    columns.push({
      actuatorPartId: requested.actuatorPartId,
      targetEndpoint,
      otherPartId: targetIsA ? descriptor.b : descriptor.a,
      applicationPointPartM: [
        applicationPointPart.x,
        applicationPointPart.y,
        applicationPointPart.z,
      ],
      forcePerNewtonPart: [forcePart.x, forcePart.y, forcePart.z],
      momentPerNewtonPart: [momentPart.x, momentPart.y, momentPart.z],
      coordinateRateMPerS: state.rateMPerS,
    });
  }
  return {
    valid: true,
    reason: "current-runtime-geometry-v1",
    tick: integratedTick,
    targetFrameWorld: {
      positionM: [
        targetFrame.position.x,
        targetFrame.position.y,
        targetFrame.position.z,
      ],
      quaternionWorldFromPart: [
        targetFrame.quaternion.x,
        targetFrame.quaternion.y,
        targetFrame.quaternion.z,
        targetFrame.quaternion.w,
      ],
    },
    columns,
  };
}
