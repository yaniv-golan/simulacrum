import { finiteOr } from "./finite-or.js";

function immutable(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const entry of Object.values(value)) immutable(entry);
  return Object.freeze(value);
}

export function challengeEvidence(telemetry, options) {
  return immutable({
    channelId: String(options.channelId),
    unit: String(options.unit),
    frame: String(options.frame),
    tick: Math.max(
      0,
      Math.round(finiteOr(telemetry?.tick, finiteOr(telemetry?.time) * 120)),
    ),
    validity: String(options.validity),
    provenance: structuredClone(options.provenance || {}),
  });
}

export function challengeCriterion(id, label, current, target, met, evidence) {
  return immutable({
    id,
    label,
    current,
    target,
    met: Boolean(met),
    evidence,
  });
}

function targetMeasurement(telemetry, objective, candidate) {
  const partIds = new Set(candidate?.partIds || []),
    controllers = Object.values(telemetry?.systems?.sensors?.controllers || {});
  return (
    controllers
      .flatMap((controller) => controller.__bindings || [])
      .filter(
        (measurement) =>
          measurement.valid === true &&
          measurement.bound === true &&
          partIds.has(measurement.endpointPartId) &&
          measurement.hitBodyId === objective.targetBodyId &&
          Number.isFinite(Number(measurement.rangeM)) &&
          Number.isFinite(Number(measurement.rangeRateMps)),
      )
      .sort(
        (left, right) =>
          Number(left.rangeM) - Number(right.rangeM) ||
          String(left.bindingId).localeCompare(String(right.bindingId)),
      )[0] || null
  );
}

function mechanismRatioMeasurement(telemetry, binding) {
  const mechanism = telemetry?.systems?.mechanisms,
    poses = mechanism ? mechanism.poses || [] : [],
    mechanismBinding = binding?.kind === "mechanism" ? binding : null,
    inputId = mechanismBinding ? mechanismBinding.inputPartId : null,
    outputId = mechanismBinding ? mechanismBinding.outputPartId : null,
    input = poses.find((pose) => pose.id === inputId),
    output = poses.find((pose) => pose.id === outputId),
    movingOutput = output && Math.abs(output.phase) > 0.001,
    ratio = input && movingOutput ? Math.abs(input.phase / output.phase) : 0;
  return { inputId, outputId, input, output, ratio };
}

function gearRatioEvaluation(context) {
  const { telemetry, objective, binding, dt, holdS } = context,
    measurement = mechanismRatioMeasurement(telemetry, binding),
    { inputId, outputId, input, output, ratio } = measurement,
    valid =
      input &&
      output &&
      ratio > objective.ratio * 0.95 &&
      ratio < objective.ratio * 1.05 &&
      input.phase * output.phase < 0,
    nextHoldS = valid ? holdS + dt : 0,
    objectiveMet = nextHoldS >= objective.holdS;
  return immutable({
    holdS: nextHoldS,
    progress: Math.min(1, nextHoldS / objective.holdS),
    objectiveMet,
    criteria: [
      challengeCriterion(
        "ratio",
        "OPPOSITE GEAR RATIO",
        ratio ? `${ratio.toFixed(2)}:1` : "NO ROTATION",
        `${objective.ratio.toFixed(2)}:1 FOR ${objective.holdS} S`,
        objectiveMet,
        challengeEvidence(telemetry, {
          channelId: `mechanism:${inputId ?? "unbound"}:${outputId ?? "unbound"}`,
          unit: "ratio",
          frame: "mechanism-phase",
          validity: input && output ? "valid" : "unavailable",
          provenance: { inputPartId: inputId, outputPartId: outputId },
        }),
      ),
    ],
  });
}

function targetEvaluation(context) {
  const { telemetry, objective, candidate, dt, holdS } = context,
    measurement = targetMeasurement(telemetry, objective, candidate),
    inRange =
      measurement && Number(measurement.rangeM) <= objective.maximumRangeM,
    stable =
      inRange &&
      Math.abs(Number(measurement.rangeRateMps)) <=
        objective.maximumRangeRateMps,
    nextHoldS = stable ? holdS + dt : 0,
    objectiveMet = nextHoldS >= objective.holdS,
    approachProgress = measurement
      ? 1 -
        Math.min(
          1,
          Number(measurement.rangeM) /
            Math.max(objective.progressRangeM, objective.maximumRangeM),
        )
      : 0,
    progress = objectiveMet
      ? 1
      : Math.min(
          0.98,
          approachProgress * 0.8 +
            Math.min(1, nextHoldS / objective.holdS) * 0.2,
        );
  return immutable({
    holdS: nextHoldS,
    progress,
    objectiveMet,
    criteria: [
      challengeCriterion(
        "target",
        "RENDEZVOUS TARGET",
        measurement
          ? `${Number(measurement.rangeM).toFixed(1)} M · ${Number(measurement.rangeRateMps).toFixed(1)} M/S`
          : "NO POWERED SENSOR FIX",
        `≤ ${objective.maximumRangeM} M · ≤ ${objective.maximumRangeRateMps} M/S FOR ${objective.holdS} S`,
        objectiveMet,
        challengeEvidence(telemetry, {
          channelId: measurement?.bindingId || "rangefinder:unavailable",
          unit: "m,m/s",
          frame: "sensor-ray",
          validity: measurement ? "valid" : "unavailable",
          provenance: {
            endpointPartId: measurement?.endpointPartId ?? null,
            targetBodyId: objective.targetBodyId,
          },
        }),
      ),
    ],
  });
}

function safeReturnEvaluation(context) {
  const { telemetry, objective, candidate, apexM, holdS } = context,
    reachedApex = apexM >= objective.altitudeM,
    safeGround =
      reachedApex &&
      candidate.grounded &&
      Math.abs(candidate.velocity.y) <= objective.maxLandingSpeedMps,
    progress = reachedApex
      ? 0.55 + (safeGround ? 0.45 : 0)
      : Math.min(0.55, (apexM / objective.altitudeM) * 0.55);
  return immutable({
    holdS,
    progress,
    objectiveMet: safeGround,
    criteria: [
      challengeCriterion(
        "apex",
        "MISSION APEX",
        `${apexM.toFixed(1)} M`,
        `${objective.altitudeM} M`,
        reachedApex,
        challengeEvidence(telemetry, {
          channelId: "physical-component:apex",
          unit: "m",
          frame: "challenge-origin",
          validity: "valid",
          provenance: { partIds: candidate.partIds },
        }),
      ),
      challengeCriterion(
        "return",
        "CONTROLLED RETURN",
        candidate.grounded
          ? `${Math.abs(candidate.velocity.y).toFixed(1)} M/S`
          : "AIRBORNE",
        `GROUND ≤ ${objective.maxLandingSpeedMps} M/S`,
        safeGround,
        challengeEvidence(telemetry, {
          channelId: "physical-component:vertical-velocity",
          unit: "m/s",
          frame: "world",
          validity: "valid",
          provenance: { partIds: candidate.partIds },
        }),
      ),
    ],
  });
}

function deliveryMotion(candidate, objective) {
  const speed = Math.hypot(
      candidate.velocity.x,
      candidate.velocity.y,
      candidate.velocity.z,
    ),
    withinSpeed = !objective.maxSpeedMps || speed <= objective.maxSpeedMps,
    supported = !objective.finishGrounded || candidate.grounded;
  return { speed, stable: withinSpeed && supported };
}

function deliveryState(context) {
  const { telemetry, objective, candidate, touchedWater, dt, holdS } = context,
    distanceMet = candidate.distanceM >= (objective.distanceM || 0),
    altitudeMet = candidate.altitudeM >= (objective.altitudeM || 0),
    waterMet = !objective.requireWater || touchedWater,
    clearWater = !objective.finishClearOfWater || !candidate.inWater,
    { speed, stable } = deliveryMotion(candidate, objective),
    valid = distanceMet && altitudeMet && waterMet && clearWater && stable,
    nextHoldS = valid ? holdS + dt : 0,
    objectiveMet = nextHoldS >= (objective.holdS || 0),
    distanceProgress = objective.distanceM
      ? candidate.distanceM / objective.distanceM
      : 1,
    altitudeProgress = objective.altitudeM
      ? candidate.altitudeM / objective.altitudeM
      : 1;
  return {
    telemetry,
    objective,
    candidate,
    touchedWater,
    distanceMet,
    altitudeMet,
    waterMet,
    clearWater,
    speed,
    stable,
    nextHoldS,
    objectiveMet,
    progress: Math.min(1, Math.min(distanceProgress, altitudeProgress)),
  };
}

function deliveryCriteria(state) {
  const {
      telemetry,
      objective,
      candidate,
      touchedWater,
      distanceMet,
      altitudeMet,
      waterMet,
      clearWater,
      speed,
      stable,
    } = state,
    criteria = [],
    componentProvenance = { partIds: candidate.partIds };
  if (objective.distanceM)
    criteria.push(
      challengeCriterion(
        "distance",
        "DELIVERY DISTANCE",
        `${candidate.distanceM.toFixed(1)} M`,
        `${objective.distanceM} M`,
        distanceMet,
        challengeEvidence(telemetry, {
          channelId: "physical-component:horizontal-distance",
          unit: "m",
          frame: "challenge-origin",
          validity: "valid",
          provenance: componentProvenance,
        }),
      ),
    );
  if (objective.altitudeM)
    criteria.push(
      challengeCriterion(
        "altitude",
        "DELIVERY ALTITUDE",
        `${candidate.altitudeM.toFixed(1)} M`,
        `${objective.altitudeM} M`,
        altitudeMet,
        challengeEvidence(telemetry, {
          channelId: "physical-component:altitude",
          unit: "m",
          frame: "challenge-origin",
          validity: "valid",
          provenance: componentProvenance,
        }),
      ),
    );
  if (objective.requireWater)
    criteria.push(
      challengeCriterion(
        "water",
        "WATER TRANSIT",
        touchedWater ? "CONTACT PROVEN" : "DRY",
        objective.finishClearOfWater ? "ENTER AND EXIT" : "CONTACT WATER",
        waterMet && clearWater,
        challengeEvidence(telemetry, {
          channelId: "physical-component:water-contact",
          unit: "boolean",
          frame: "world",
          validity: "valid",
          provenance: componentProvenance,
        }),
      ),
    );
  if (objective.finishGrounded || objective.maxSpeedMps)
    criteria.push(
      challengeCriterion(
        "stable",
        "CONTROLLED FINISH",
        candidate.grounded
          ? `GROUNDED · ${speed.toFixed(1)} M/S`
          : `${speed.toFixed(1)} M/S`,
        objective.finishGrounded
          ? "GROUNDED"
          : `≤ ${objective.maxSpeedMps} M/S`,
        stable,
        challengeEvidence(telemetry, {
          channelId: "physical-component:speed-and-support",
          unit: "m/s,boolean",
          frame: "world",
          validity: "valid",
          provenance: componentProvenance,
        }),
      ),
    );
  return criteria;
}

function deliveryEvaluation(context) {
  const state = deliveryState(context);
  return immutable({
    holdS: state.nextHoldS,
    progress: state.progress,
    objectiveMet: state.objectiveMet,
    criteria: deliveryCriteria(state),
  });
}

const EVALUATORS = Object.freeze({
  "gear-ratio": gearRatioEvaluation,
  target: targetEvaluation,
  "safe-return": safeReturnEvaluation,
  delivery: deliveryEvaluation,
});

export function evaluateChallengeObjective(context) {
  const kind = context.objective?.kind || "delivery",
    evaluator = EVALUATORS[kind];
  if (evaluator) return evaluator(context);
  return immutable({
    holdS: 0,
    progress: 0,
    objectiveMet: false,
    criteria: [
      challengeCriterion(
        "objective",
        "SUPPORTED OBJECTIVE",
        `UNKNOWN · ${kind}`,
        "KNOWN OBJECTIVE KIND",
        false,
        challengeEvidence(context.telemetry, {
          channelId: "challenge:objective",
          unit: "kind",
          frame: "challenge-definition",
          validity: "invalid",
          provenance: { kind },
        }),
      ),
    ],
  });
}

/**
 * @param {{telemetry:any,constraints?:{noDamage?:boolean,maxFatigue?:number,failOnDamage?:boolean},damage:{failed:number,detached:number,worstFatigue:number}}} input
 */
export function evaluateChallengeConstraints({
  telemetry,
  constraints = {},
  damage,
}) {
  const criteria = [],
    intact = damage.failed === 0 && damage.detached === 0;
  if (constraints.noDamage)
    criteria.push(
      challengeCriterion(
        "damage",
        "STRUCTURAL INTEGRITY",
        intact
          ? "NO DAMAGE"
          : `${damage.failed} FAILED · ${damage.detached} DETACHED`,
        "INTACT",
        intact,
        challengeEvidence(telemetry, {
          channelId: "physical-component:structural-damage",
          unit: "count",
          frame: "assembly-graph",
          validity: "valid",
          provenance: {
            failed: damage.failed,
            detached: damage.detached,
          },
        }),
      ),
    );
  if (constraints.maxFatigue != null)
    criteria.push(
      challengeCriterion(
        "fatigue",
        "PEAK FATIGUE",
        `${(damage.worstFatigue * 100).toFixed(0)}%`,
        `≤ ${(constraints.maxFatigue * 100).toFixed(0)}%`,
        damage.worstFatigue <= constraints.maxFatigue,
        challengeEvidence(telemetry, {
          channelId: "physical-component:fatigue",
          unit: "ratio",
          frame: "assembly-graph",
          validity: "valid",
          provenance: { worstFatigue: damage.worstFatigue },
        }),
      ),
    );
  return Object.freeze(criteria);
}

export function evaluateReferenceControlAvailability(
  telemetry,
  referenceControls = [],
) {
  const powered = new Set(telemetry?.systems?.power?.poweredPartIds || []),
    routes = new Map(
      (telemetry?.systems?.signals?.routes || []).map((route) => [
        route.targetId,
        route.controllerIds || [],
      ]),
    );
  return Object.freeze(
    referenceControls.map((control) => {
      const poweredTarget = powered.has(control.targetId),
        routed = (routes.get(control.targetId) || []).length > 0,
        online = poweredTarget && routed;
      return challengeCriterion(
        `reference-control:${control.profileId}:${control.controlId}`,
        "REFERENCE CONTROL PATH",
        online
          ? `${control.controlId.toUpperCase()} · ONLINE`
          : !poweredTarget
            ? `${control.controlId.toUpperCase()} · NO POWER`
            : `${control.controlId.toUpperCase()} · NO SIGNAL ROUTE`,
        "POWERED AND SIGNAL-ROUTED",
        online,
        challengeEvidence(telemetry, {
          channelId: `${control.profileId}:${control.controlId}`,
          unit: "boolean",
          frame: "power-and-signal-networks",
          validity: online ? "valid" : "offline",
          provenance: {
            targetId: control.targetId,
            powered: poweredTarget,
            routed,
          },
        }),
      );
    }),
  );
}

/**
 * @param {{currentStatus:string,candidate:{fallen?:boolean},constraints?:{noDamage?:boolean,maxFatigue?:number,failOnDamage?:boolean},damage:{failed:number,detached:number},objectiveMet:boolean,criteria:Array<{met:boolean}>}} input
 */
export function transitionChallengeStatus({
  currentStatus,
  candidate,
  constraints = {},
  damage,
  objectiveMet,
  criteria,
}) {
  if (["complete", "failed"].includes(currentStatus)) return currentStatus;
  if (candidate.fallen) return "failed";
  if (constraints.failOnDamage && (damage.failed || damage.detached))
    return "failed";
  return objectiveMet && criteria.every((entry) => entry.met)
    ? "complete"
    : "running";
}
