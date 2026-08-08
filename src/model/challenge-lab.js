import { physicalComponents } from "./physical-components.js";
import { ChallengeBindingResolver } from "./challenge-binding-resolver.js";
import { compileAssemblyFromIssuedRoots } from "./assembly-compiler.js";
import { TYPES } from "./component-catalog.js";
import {
  componentElectricalSource,
  componentIsPayload,
} from "./component-contracts.js";
import {
  challengeCriterion,
  challengeEvidence,
  evaluateChallengeConstraints,
  evaluateChallengeObjective,
  evaluateReferenceControlAvailability,
  transitionChallengeStatus,
} from "./challenge-evaluators.js";
import { scoreChallengeResult } from "./challenge-score.js";
import { resolveReferenceInitialControls } from "./challenge-reference-controls.js";
import { finiteOr as finite } from "./finite-or.js";
import {
  projectPortableAuthoredConnection,
  projectPortableAuthoredPart,
} from "./authored-assembly-content.js";

const PHYSICAL_KINDS = new Set(["mechanical", "mesh"]);

function horizontalDistance(position, origin) {
  return Math.hypot(position.x - origin.x, position.z - origin.z);
}

function machineMetrics(machine = {}) {
  const parts = machine.parts || [],
    connections = machine.connections || [],
    batteries = parts.filter((part) => componentElectricalSource(part)),
    energy = batteries.reduce(
      (sum, part) =>
        sum +
        (part.energyJ != null
          ? finite(part.energyJ) / 3600
          : finite(part.storedEnergyWh, part.config?.capacityWh)),
      0,
    ),
    mass = parts.reduce(
      (sum, part) => sum + finite(part.mass, part.config?.mass),
      0,
    ),
    payloads = parts.filter((part) => componentIsPayload(part)),
    securedPayloads = payloads.filter((payload) =>
      connections.some(
        (connection) =>
          PHYSICAL_KINDS.has(connection.kind) &&
          !connection.failed &&
          (connection.a === payload.id || connection.b === payload.id),
      ),
    );
  return {
    partCount: parts.length,
    mass,
    energy,
    payloadCount: payloads.length,
    payloadSecured: securedPayloads.length > 0,
  };
}

function damageMetrics(candidate = {}) {
  const failed = candidate.failedConnectionIds?.length || 0,
    detached = candidate.detachedPartIds?.length || 0;
  return {
    failed,
    detached,
    worstFatigue: finite(candidate.worstFatigue),
  };
}

function boundCandidate(run, telemetry, binding) {
  if (!binding || binding.kind === "mechanism") return null;
  const components = physicalComponents(telemetry),
    identityPartId =
      binding.kind === "payload" ? binding.payloadPartId : binding.rootPartId,
    candidate = components.find((component) =>
      component.partIds.includes(identityPartId),
    );
  if (!candidate) return null;
  if (!run.origin) {
    run.origin = { ...candidate.position };
    run.initialEnergyWh = candidate.energyWh;
  }
  const origin = run.origin,
    distanceM = horizontalDistance(candidate.position, origin),
    altitudeM = Math.max(0, candidate.position.y - origin.y);
  return {
    ...candidate,
    distanceM,
    altitudeM,
    verificationEligible: true,
  };
}

function mechanismCandidate(initial) {
  return {
    kind: "mechanism",
    label: "MECHANICAL TRANSMISSION",
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    distanceM: 0,
    altitudeM: 0,
    grounded: true,
    fallen: false,
    inWater: false,
    payloadSecured: false,
    failedConnectionIds: [],
    detachedPartIds: [],
    worstFatigue: 0,
    verificationEligible: true,
    partCount: initial.partCount,
    massKg: initial.mass,
    energyWh: initial.energy,
    partIds: [],
  };
}

/**
 * Capability-based challenge evaluator. It reads physical telemetry and an
 * assembly view; it never selects a demo, mutates physics, or knows a stock
 * machine topology.
 */
export class ChallengeRun {
  #bindingResolver;
  #referenceControls;

  constructor(challenge, machine = {}) {
    this.challenge = structuredClone(challenge);
    const startMachine = structuredClone(machine),
      // Remote-control UI state is not compiled physical authority. Keep the
      // evaluator's complete detached machine view, but give the compiler only
      // the persisted assembly tree it owns.
      startAssembly = {
        revision: startMachine.revision ?? 0,
        parts: (startMachine.parts || []).map((part) =>
          projectPortableAuthoredPart({
            ...part,
            pos: Array.isArray(part.pos) ? part.pos : [0, 0, 0],
            orientation: part.orientation || [0, 0, 0, 1],
            scale: part.scale || { x: 1, y: 1, z: 1 },
          }),
        ),
        connections: (startMachine.connections || []).map((connection) => ({
          ...projectPortableAuthoredConnection(connection),
          ...(connection.failed ? { failed: true } : {}),
        })),
      },
      remoteProfiles = startMachine.remoteProfiles || {},
      compiled = compileAssemblyFromIssuedRoots(
        JSON.stringify(startAssembly),
        TYPES,
      );
    this.#referenceControls = resolveReferenceInitialControls(
      this.challenge,
      remoteProfiles,
    ).map((entry) => ({
      ...entry,
      targetId: remoteProfiles[entry.profileId].controls.find(
        (control) => control.id === entry.controlId,
      ).targetId,
    }));
    this.#bindingResolver = new ChallengeBindingResolver({
      assembly: startAssembly,
      compiled,
      objective: this.challenge.objective,
      payload: this.challenge.payload,
    });
    this.origin = null;
    this.initialEnergyWh = null;
    this.elapsedS = 0;
    this.holdS = 0;
    this.touchedWater = false;
    this.apexM = 0;
    this.status = "ready";
    this.solution = "UNRESOLVED";
    this.verificationEligible = true;
    // Evaluation observes the complete detached machine view, including live
    // energy and measured mass. The authored projection above exists only to
    // delimit compiler authority; catalog defaults must not overwrite live
    // evidence supplied to the evaluator.
    this.initial = machineMetrics(startMachine);
    this.last = this.makeResult({
      criteria: this.challenge.payload
        ? [
            challengeCriterion(
              "payload",
              "MISSION PAYLOAD SECURED",
              this.initial.payloadSecured ? "ATTACHED" : "UNATTACHED",
              `${this.challenge.payload.massKg || 80} KG CARGO`,
              this.initial.payloadSecured,
              challengeEvidence(
                {},
                {
                  channelId: "assembly:payload-secured",
                  unit: "boolean",
                  frame: "assembly-graph",
                  validity: "valid",
                  provenance: {},
                },
              ),
            ),
          ]
        : [],
      machineState: this.initial,
      damage: { failed: 0, detached: 0, worstFatigue: 0 },
    });
  }

  /** @returns {({kind:"component",policyVersion:1,rootPartId:number,initialComponentId:string}|{kind:"payload",policyVersion:1,rootPartId:number,payloadPartId:number,initialComponentId:string}|{kind:"mechanism",policyVersion:1,inputPartId:number,outputPartId:number})|null} */
  resolveBinding(telemetry) {
    return this.#bindingResolver.resolve(telemetry);
  }

  step(telemetry, dt = 0) {
    if (["complete", "failed"].includes(this.status)) return this.last;
    this.status = "running";
    this.elapsedS = Math.max(this.elapsedS, finite(telemetry?.time));
    const objective = this.challenge.objective || {},
      binding = telemetry?.systems?.challengeBinding || null,
      components = physicalComponents(telemetry),
      candidate =
        objective.kind === "gear-ratio"
          ? mechanismCandidate(this.initial)
          : boundCandidate(this, telemetry, binding),
      damage = damageMetrics(
        candidate ||
          components.find((component) =>
            component.partIds.includes(
              binding?.payloadPartId ?? binding?.rootPartId,
            ),
          ),
      );
    if (!candidate) return this.#recordPending(telemetry, binding, damage);
    return this.#evaluateCandidate({
      telemetry,
      objective,
      binding,
      candidate,
      damage,
      dt,
    });
  }

  #recordPending(telemetry, binding, damage) {
    if (this.challenge.payload) this.lastCandidatePayloadSecured = false;
    const criteria = [];
    if (this.challenge.payload)
      criteria.push(
        challengeCriterion(
          "payload",
          "MISSION PAYLOAD SECURED",
          "UNATTACHED",
          `${this.challenge.payload.massKg || 80} KG CARGO`,
          false,
          challengeEvidence(telemetry, {
            channelId: "physical-component:payload-secured",
            unit: "boolean",
            frame: "assembly-graph",
            validity: "unavailable",
            provenance: {},
          }),
        ),
      );
    criteria.push(
      challengeCriterion(
        "motion",
        "PHYSICAL MOTION SYSTEM",
        binding ? "BOUND COMPONENT LOST" : "AWAITING MOTION",
        "ONE MOVING PHYSICAL COMPONENT",
        false,
        challengeEvidence(telemetry, {
          channelId: "physical-component:binding",
          unit: "identity",
          frame: "assembly-graph",
          validity: binding ? "lost" : "unavailable",
          provenance: { binding: structuredClone(binding) },
        }),
      ),
    );
    this.last = this.makeResult({
      progress: 0,
      criteria,
      machineState: this.initial,
      damage,
    });
    return this.last;
  }

  #evaluateCandidate({ telemetry, objective, binding, candidate, damage, dt }) {
    this.solution = candidate.label;
    this.verificationEligible &&= candidate.verificationEligible === true;
    this.lastCandidatePayloadSecured = Boolean(candidate.payloadSecured);
    this.touchedWater ||= candidate.inWater;
    this.apexM = Math.max(this.apexM, candidate.altitudeM);
    const candidateState = {
      partCount: candidate.partCount,
      mass: candidate.massKg,
      energy: candidate.energyWh,
      payloadSecured: candidate.payloadSecured,
    };
    const payloadRequired = Boolean(this.challenge.payload),
      criteria = [];
    if (payloadRequired)
      criteria.push(
        challengeCriterion(
          "payload",
          "MISSION PAYLOAD SECURED",
          candidate.payloadSecured ? "ATTACHED" : "UNATTACHED",
          `${this.challenge.payload.massKg || 80} KG CARGO`,
          candidate.payloadSecured,
          challengeEvidence(telemetry, {
            channelId: "physical-component:payload-secured",
            unit: "boolean",
            frame: "assembly-graph",
            validity: "valid",
            provenance: { partIds: candidate.partIds },
          }),
        ),
      );
    const evaluation = evaluateChallengeObjective({
      telemetry,
      objective,
      binding,
      candidate,
      dt,
      holdS: this.holdS,
      apexM: this.apexM,
      touchedWater: this.touchedWater,
    });
    this.holdS = evaluation.holdS;
    criteria.push(...evaluation.criteria);
    criteria.push(
      ...evaluateReferenceControlAvailability(
        telemetry,
        this.#referenceControls,
      ),
    );
    criteria.push(
      ...evaluateChallengeConstraints({
        telemetry,
        constraints: this.challenge.constraints,
        damage,
      }),
    );
    this.status = transitionChallengeStatus({
      currentStatus: this.status,
      candidate,
      constraints: this.challenge.constraints,
      damage,
      objectiveMet: evaluation.objectiveMet,
      criteria,
    });

    this.last = this.makeResult({
      progress: evaluation.progress,
      criteria,
      machineState: candidateState,
      damage,
    });
    return this.last;
  }

  /** @param {any} [options] */
  makeResult(options = {}) {
    const { progress = 0, criteria = [], machineState, damage } = options;
    const machineNow = machineState || this.initial,
      damageNow = damage || { failed: 0, detached: 0, worstFatigue: 0 },
      initialEnergy = this.initialEnergyWh ?? this.initial.energy,
      { score, breakdown, energyUsed } = scoreChallengeResult({
        elapsedS: this.elapsedS,
        initialEnergyWh: initialEnergy,
        machine: machineNow,
        damage: damageNow,
      });
    return {
      status: this.status,
      progress: Math.max(0, Math.min(1, progress)),
      elapsedS: this.elapsedS,
      holdS: this.holdS,
      solution: this.solution,
      verificationEligible: this.verificationEligible,
      criteria: structuredClone(criteria),
      score,
      breakdown,
      metrics: {
        massKg: machineNow.mass,
        partCount: machineNow.partCount,
        energyUsed,
        damage: damageNow.failed + damageNow.detached,
        worstFatigue: damageNow.worstFatigue,
        apexM: this.apexM,
        touchedWater: this.touchedWater,
        payloadSecured: Boolean(
          this.lastCandidatePayloadSecured ?? machineNow.payloadSecured,
        ),
        candidate: this.#bindingResolver.snapshot()
          ? {
              ...this.#bindingResolver.snapshot(),
              policy:
                this.#bindingResolver.snapshot().kind === "payload"
                  ? "follow-payload"
                  : this.#bindingResolver.snapshot().kind === "component"
                    ? "follow-mission-root"
                    : "follow-mechanism",
              initialEnergyWh: this.initialEnergyWh,
            }
          : null,
        proofBinding: this.#bindingResolver.snapshot(),
      },
    };
  }

  abort() {
    if (!["complete", "failed"].includes(this.status)) {
      this.status = "failed";
      this.last = { ...this.last, status: "failed" };
    }
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(
      this.last ||
        this.makeResult({
          machineState: this.initial,
          damage: { failed: 0, detached: 0, worstFatigue: 0 },
        }),
    );
  }
}

export function challengeReliability(records = [], challengeId) {
  const attempts = records.filter((record) => record.id === challengeId),
    successes = attempts.filter((record) => record.success);
  return {
    attempts: attempts.length,
    successes: successes.length,
    reliability: attempts.length ? successes.length / attempts.length : 0,
    solutions: [...new Set(successes.map((record) => record.solution))],
    best: Math.max(0, ...successes.map((record) => record.score || 0)),
  };
}
