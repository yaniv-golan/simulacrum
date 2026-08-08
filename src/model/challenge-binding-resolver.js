import { TYPES } from "./component-catalog.js";
import { compileAssemblyFromIssuedRoots } from "./assembly-compiler.js";
import { physicalComponents } from "./physical-components.js";
import {
  componentDefinition,
  componentIsPayload,
  componentPropulsion,
} from "./component-contracts.js";

const PHYSICAL_KINDS = new Set(["mechanical", "mesh"]),
  ROTARY_KINDS = new Set(["gear", "revolute", "suspension"]),
  MEANINGFUL_LINEAR_SPEED_MPS = 0.05,
  MEANINGFUL_ROTATION_RAD = 0.001;

function compareIds(left, right) {
  return (
    Number(left) - Number(right) || String(left).localeCompare(String(right))
  );
}

function componentId(partIds) {
  return `component:${[...partIds].sort(compareIds).join("|")}`;
}

function rootPriority(part) {
  if (componentIsPayload(part)) return 4;
  if (componentDefinition(part)?.cat === "structure") return 1;
  if (componentPropulsion(part)) return 2;
  return 3;
}

function chooseRoot(parts, excluded = new Set()) {
  return parts
    .filter((part) => !excluded.has(part.id))
    .sort(
      (left, right) =>
        rootPriority(left) - rootPriority(right) ||
        Number(componentDefinition(right)?.mass || 0) -
          Number(componentDefinition(left)?.mass || 0) ||
        compareIds(left.id, right.id),
    )[0]?.id;
}

function initialComponents(assembly) {
  const parts = assembly.parts || [],
    partById = new Map(parts.map((part) => [part.id, part])),
    adjacency = new Map(parts.map((part) => [part.id, new Set()]));
  for (const connection of assembly.connections || []) {
    if (
      connection.failed ||
      !PHYSICAL_KINDS.has(connection.kind) ||
      !adjacency.has(connection.a) ||
      !adjacency.has(connection.b)
    )
      continue;
    adjacency.get(connection.a).add(connection.b);
    adjacency.get(connection.b).add(connection.a);
  }
  const result = [],
    remaining = new Set(parts.map((part) => part.id));
  while (remaining.size) {
    const seed = [...remaining].sort(compareIds)[0],
      ids = [],
      queue = [seed];
    remaining.delete(seed);
    while (queue.length) {
      const id = queue.shift();
      ids.push(id);
      for (const neighbor of [...(adjacency.get(id) || [])].sort(compareIds)) {
        if (!remaining.has(neighbor)) continue;
        remaining.delete(neighbor);
        queue.push(neighbor);
      }
    }
    ids.sort(compareIds);
    result.push({
      id: componentId(ids),
      partIds: ids,
      parts: ids.map((id) => partById.get(id)).filter(Boolean),
    });
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function rotaryCandidates(assembly, compiled) {
  const adjacency = new Map(
    (assembly.parts || []).map((part) => [part.id, []]),
  );
  for (const constraint of compiled.constraints || []) {
    if (!ROTARY_KINDS.has(constraint.kind)) continue;
    adjacency.get(constraint.a)?.push(constraint.b);
    adjacency.get(constraint.b)?.push(constraint.a);
  }
  const driven = new Set(),
    queue = (compiled.constraints || [])
      .map((constraint) => constraint.motorId)
      .filter((id) => id != null)
      .sort(compareIds);
  for (const id of queue) driven.add(id);
  while (queue.length) {
    const id = queue.shift();
    for (const neighbor of [...(adjacency.get(id) || [])].sort(compareIds)) {
      if (driven.has(neighbor)) continue;
      driven.add(neighbor);
      queue.push(neighbor);
    }
  }
  return (compiled.constraints || [])
    .filter((constraint) => constraint.kind === "gear")
    .map((constraint) => {
      const aDriven = driven.has(constraint.a),
        bDriven = driven.has(constraint.b),
        inputPartId =
          aDriven !== bDriven
            ? aDriven
              ? constraint.a
              : constraint.b
            : [constraint.a, constraint.b].sort(compareIds)[0],
        outputPartId =
          inputPartId === constraint.a ? constraint.b : constraint.a;
      return { inputPartId, outputPartId };
    })
    .sort(
      (left, right) =>
        compareIds(left.inputPartId, right.inputPartId) ||
        compareIds(left.outputPartId, right.outputPartId),
    );
}

/**
 * @typedef {{kind:"component",policyVersion:1,rootPartId:number,initialComponentId:string}}
 *   ComponentChallengeBinding
 * @typedef {{kind:"payload",policyVersion:1,rootPartId:number,payloadPartId:number,initialComponentId:string}}
 *   PayloadChallengeBinding
 * @typedef {{kind:"mechanism",policyVersion:1,inputPartId:number,outputPartId:number}}
 *   MechanismChallengeBinding
 * @typedef {ComponentChallengeBinding|PayloadChallengeBinding|MechanismChallengeBinding}
 *   ChallengeBinding
 */

/**
 * Resolves one challenge target from immutable starting topology and completed
 * telemetry. The first valid observation locks the result for the whole run.
 */
export class ChallengeBindingResolver {
  #assembly;
  #compiled;
  #objective;
  #requiresPayload;
  #components;
  #locked;
  #rotaryCandidates;
  #componentCandidates;

  /** @param {{assembly:any,compiled?:any,objective?:Record<string,any>,payload?:Record<string,any>|null}} options */
  constructor({ assembly, compiled = null, objective = {}, payload = null }) {
    this.#assembly = structuredClone(
      assembly || { parts: [], connections: [] },
    );
    this.#compiled =
      compiled ||
      compileAssemblyFromIssuedRoots(JSON.stringify(this.#assembly), TYPES);
    this.#objective = /** @type {Record<string,any>} */ (
      structuredClone(objective || {})
    );
    this.#requiresPayload = Boolean(payload);
    this.#components = initialComponents(this.#assembly);
    this.#locked = /** @type {ChallengeBinding|null} */ (null);
    this.#rotaryCandidates =
      this.#objective.kind === "gear-ratio"
        ? rotaryCandidates(this.#assembly, this.#compiled)
        : [];
    this.#componentCandidates = this.#createComponentCandidates();
    if (payload) this.#locked = this.#payloadBinding();
  }

  #payloadBinding() {
    const candidates = /** @type {PayloadChallengeBinding[]} */ ([]);
    for (const component of this.#components) {
      for (const payloadPart of component.parts
        .filter(
          (part) => componentIsPayload(part) || part.config?.payload === true,
        )
        .sort((left, right) => compareIds(left.id, right.id))) {
        const physicallyAttached = (this.#assembly.connections || []).some(
          (connection) =>
            !connection.failed &&
            PHYSICAL_KINDS.has(connection.kind) &&
            (connection.a === payloadPart.id ||
              connection.b === payloadPart.id),
        );
        const rootPartId = chooseRoot(
          component.parts,
          new Set([payloadPart.id]),
        );
        if (!physicallyAttached || rootPartId == null) continue;
        candidates.push({
          kind: /** @type {const} */ ("payload"),
          policyVersion: /** @type {const} */ (1),
          rootPartId,
          payloadPartId: payloadPart.id,
          initialComponentId: component.id,
        });
      }
    }
    return (
      candidates.sort(
        (left, right) =>
          compareIds(left.payloadPartId, right.payloadPartId) ||
          compareIds(left.rootPartId, right.rootPartId),
      )[0] || null
    );
  }

  /** @returns {ComponentChallengeBinding[]} */
  #createComponentCandidates() {
    return /** @type {ComponentChallengeBinding[]} */ (
      this.#components
        .map((component) => ({
          kind: /** @type {const} */ ("component"),
          policyVersion: /** @type {const} */ (1),
          rootPartId: chooseRoot(component.parts),
          initialComponentId: component.id,
        }))
        .filter((candidate) => candidate.rootPartId != null)
        .sort(
          (left, right) =>
            left.initialComponentId.localeCompare(right.initialComponentId) ||
            compareIds(left.rootPartId, right.rootPartId),
        )
    );
  }

  /** @returns {({kind:"component",policyVersion:1,rootPartId:number,initialComponentId:string}|{kind:"payload",policyVersion:1,rootPartId:number,payloadPartId:number,initialComponentId:string}|{kind:"mechanism",policyVersion:1,inputPartId:number,outputPartId:number})|null} */
  resolve(telemetry) {
    if (this.#locked) return structuredClone(this.#locked);
    if (this.#requiresPayload) return null;
    if (this.#objective.kind === "gear-ratio") {
      const poses = new Map(
          (telemetry?.systems?.mechanisms?.poses || []).map((pose) => [
            pose.id,
            pose,
          ]),
        ),
        moving = this.#rotaryCandidates.filter((candidate) => {
          const input = poses.get(candidate.inputPartId),
            output = poses.get(candidate.outputPartId);
          return (
            Math.abs(Number(input?.phase) || 0) > MEANINGFUL_ROTATION_RAD &&
            Math.abs(Number(output?.phase) || 0) > MEANINGFUL_ROTATION_RAD
          );
        });
      if (moving.length)
        this.#locked = {
          kind: "mechanism",
          policyVersion: 1,
          ...moving[0],
        };
    } else {
      const liveComponents = physicalComponents(telemetry),
        moving = this.#componentCandidates.filter((candidate) => {
          const component = liveComponents.find((entry) =>
            entry.partIds.includes(candidate.rootPartId),
          );
          return component?.speedMps > MEANINGFUL_LINEAR_SPEED_MPS;
        });
      if (moving.length) this.#locked = moving[0];
    }
    return this.#locked ? structuredClone(this.#locked) : null;
  }

  /** @returns {({kind:"component",policyVersion:1,rootPartId:number,initialComponentId:string}|{kind:"payload",policyVersion:1,rootPartId:number,payloadPartId:number,initialComponentId:string}|{kind:"mechanism",policyVersion:1,inputPartId:number,outputPartId:number})|null} */
  snapshot() {
    return this.#locked ? structuredClone(this.#locked) : null;
  }
}
