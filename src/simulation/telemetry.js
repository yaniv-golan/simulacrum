import { deepFreeze } from "../model/primitives.js";
import { registerOwnedImmutable } from "../model/owned-immutable-value.js";

const ROUTE_SLOT_NAMES = Object.freeze([
  "power",
  "signal",
  "resourceReachability",
  "resourceAllocation",
]);

export function unsupportedRouteEvidenceDescriptor(source = null) {
  return deepFreeze({
    version: 1,
    token: null,
    slots: Object.fromEntries(
      ROUTE_SLOT_NAMES.map((name) => [
        name,
        {
          status: "unsupported",
          ...(source?.slots?.[name]?.identity
            ? { identity: structuredClone(source.slots[name].identity) }
            : {}),
        },
      ]),
    ),
  });
}

/** Clones telemetry without retaining a session-local evidence capability. */
export function stripRouteEvidenceCapabilities(telemetry) {
  if (!telemetry || typeof telemetry !== "object") return telemetry;
  const clone = structuredClone(telemetry),
    source = clone.systems?.routeEvidence || null;
  if (clone.systems)
    clone.systems.routeEvidence = unsupportedRouteEvidenceDescriptor(source);
  return deepFreeze(clone);
}

function telemetrySnapshot(
  {
    time = 0,
    tick = 0,
    systems = {},
    assembly = {},
    runGraph = null,
    bodyRegistry = null,
  } = {},
  { cloneSystems = true } = {},
) {
  const assemblyRecord = /** @type {any} */ (assembly),
    run = runGraph?.snapshot?.() || {
      schemaVersion: 1,
      revision: 0,
      graphRevision: 0,
      startAssemblyRevision: assemblyRecord.revision || 0,
      parts: [],
      connections: [],
      controllers: [],
      events: [],
    },
    bodies = bodyRegistry?.snapshot?.() || {
      schemaVersion: 1,
      revision: 0,
      tick,
      bodies: [],
      bodyByPart: [],
      constraints: [],
      constraintByPart: [],
    };
  // Public callers receive a detached value. The fixed-step publisher owns
  // the fresh per-tick projection and can freeze it in place, avoiding a full
  // telemetry clone on every 120 Hz step.
  const frozenSystems = deepFreeze(
    cloneSystems ? structuredClone(systems) : systems,
  );
  return registerOwnedImmutable(
    Object.freeze({
      schemaVersion: 1,
      tick,
      time,
      assemblyRevision: assemblyRecord.revision || 0,
      runRevision: runGraph?.revision || 0,
      graphRevision: runGraph?.graphRevision || 0,
      run,
      bodies,
      systems: frozenSystems,
    }),
  );
}

export function createTelemetrySnapshot({
  time = 0,
  tick = 0,
  systems = {},
  assembly = {},
  runGraph = null,
  bodyRegistry = null,
} = {}) {
  return telemetrySnapshot(
    { time, tick, systems, assembly, runGraph, bodyRegistry },
    { cloneSystems: true },
  );
}

/** Publishes one complete frame and attaches the run-locked challenge binding. */
export function publishTelemetrySnapshot(context, systems = {}) {
  let snapshot = telemetrySnapshot(
    {
      time: context.time,
      tick: context.clock.tick,
      assembly: context.runGraph.startSnapshot(),
      runGraph: context.runGraph,
      bodyRegistry: context.bodyRegistry,
      systems,
    },
    { cloneSystems: false },
  );
  const challengeBinding =
    context.services.resolveChallengeBinding?.(snapshot) || null;
  if (challengeBinding) {
    const systemsWithBinding = deepFreeze({
      ...snapshot.systems,
      challengeBinding: structuredClone(challengeBinding),
    });
    snapshot = registerOwnedImmutable(
      Object.freeze({ ...snapshot, systems: systemsWithBinding }),
    );
  }
  return snapshot;
}
