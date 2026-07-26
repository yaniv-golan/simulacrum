import { portDefinition, portIds, portsCompatible } from "../model/ports.js";
import { immutableClone } from "../model/primitives.js";
import { isSensorPart } from "../model/sensor-contracts.js";
import { componentHasControlContract } from "../model/component-contracts.js";
import { powerContract } from "../model/actuator-contracts.js";
import {
  createRouteEvidenceIndex,
  routeWitnessFromIndex,
} from "./route-evidence-index.js";

const stableId = (value) => `${typeof value}:${String(value)}`;
const compareId = (left, right) =>
  stableId(left).localeCompare(stableId(right), "en");

function directedEndpoints(connection, byId, catalog) {
  if (connection.kind !== "signal" || connection.failed) return [];
  const left = byId.get(connection.a),
    right = byId.get(connection.b);
  if (
    !left ||
    !right ||
    left.detached ||
    right.detached ||
    !connection.portA ||
    !connection.portB ||
    !portIds(left, catalog).includes(connection.portA) ||
    !portIds(right, catalog).includes(connection.portB) ||
    !portsCompatible(left, connection.portA, right, connection.portB, catalog)
  )
    return [];
  const leftPort = portDefinition(left, connection.portA, catalog),
    rightPort = portDefinition(right, connection.portB, catalog);
  if (leftPort.kind !== "signal" || rightPort.kind !== "signal") return [];
  const directions = [];
  if (
    ["source", "bidirectional"].includes(leftPort.direction) &&
    ["sink", "bidirectional"].includes(rightPort.direction)
  )
    directions.push({
      connectionId: connection.id,
      sourceId: left.id,
      sourcePortId: connection.portA,
      targetId: right.id,
      targetPortId: connection.portB,
    });
  if (
    ["source", "bidirectional"].includes(rightPort.direction) &&
    ["sink", "bidirectional"].includes(leftPort.direction)
  )
    directions.push({
      connectionId: connection.id,
      sourceId: right.id,
      sourcePortId: connection.portB,
      targetId: left.id,
      targetPortId: connection.portA,
    });
  return directions;
}

/** @param {(id:number|string)=>boolean} [canTraverse] */
function reachableRoutes(sourceId, outgoing, canTraverse = () => true) {
  const reached = new Map(),
    expanded = new Set(),
    queue = (outgoing.get(sourceId) || []).map((edge) => ({
      ...edge,
      originPortId: edge.sourcePortId,
    }));
  while (queue.length) {
    const route = queue.shift(),
      targetId = route.targetId,
      entry = reached.get(targetId) || {
        originPortIds: new Set(),
        targetPortIds: new Set(),
      };
    entry.originPortIds.add(route.originPortId);
    entry.targetPortIds.add(route.targetPortId);
    reached.set(targetId, entry);
    const expansionKey = `${stableId(targetId)}:${route.originPortId}`;
    if (expanded.has(expansionKey) || !canTraverse(targetId)) continue;
    expanded.add(expansionKey);
    queue.push(
      ...(outgoing.get(targetId) || []).map((edge) => ({
        ...edge,
        originPortId: route.originPortId,
      })),
    );
  }
  return reached;
}

/** Directed, failure-aware signal routes for one authoritative graph revision. */
export class SignalNetwork {
  #catalog;
  #routesByTarget = new Map();
  #targetsByController = new Map();
  #sensorsByController = new Map();
  #targetEndpointsByController = new Map();
  #sensorEndpointsByController = new Map();
  #controllersBySensor = new Map();
  #graphRevision = -1;
  #evidenceIndex = null;

  constructor(catalog = {}) {
    this.#catalog = catalog;
  }

  resolve(runGraph, powerNetwork) {
    this.#routesByTarget.clear();
    this.#targetsByController.clear();
    this.#sensorsByController.clear();
    this.#targetEndpointsByController.clear();
    this.#sensorEndpointsByController.clear();
    this.#controllersBySensor.clear();
    this.#graphRevision = runGraph.graphRevision;
    const parts = runGraph.parts(),
      connections = runGraph.connections(),
      byId = new Map(parts.map((part) => [part.id, part])),
      outgoing = new Map(parts.map((part) => [part.id, []]));
    for (const connection of connections)
      for (const edge of directedEndpoints(connection, byId, this.#catalog))
        outgoing.get(edge.sourceId).push(edge);
    for (const targets of outgoing.values())
      targets.sort((left, right) => compareId(left.targetId, right.targetId));

    const controllers = parts
      .filter(
        (part) =>
          componentHasControlContract(
            part,
            "controller-target-v1",
            this.#catalog,
          ) &&
          !part.detached &&
          powerNetwork.isPowered(part.id),
      )
      .sort((a, b) => compareId(a.id, b.id));
    for (const controller of controllers) {
      const reachable = reachableRoutes(
          controller.id,
          outgoing,
          (id) =>
            !componentHasControlContract(
              byId.get(id),
              "controller-target-v1",
              this.#catalog,
            ),
        ),
        targets = [...reachable.keys()].filter((id) => {
          const target = byId.get(id);
          if (
            !target ||
            componentHasControlContract(
              target,
              "controller-target-v1",
              this.#catalog,
            ) ||
            isSensorPart(target)
          )
            return false;
          const electrical = powerContract(target, this.#catalog);
          return !electrical || powerNetwork.isPowered(target.id);
        });
      const routedTargets = new Set([controller.id, ...targets]);
      this.#targetsByController.set(controller.id, routedTargets);
      this.#targetEndpointsByController.set(
        controller.id,
        new Map(targets.map((targetId) => [targetId, reachable.get(targetId)])),
      );
      for (const targetId of routedTargets) {
        if (!this.#routesByTarget.has(targetId))
          this.#routesByTarget.set(targetId, new Set());
        this.#routesByTarget.get(targetId).add(controller.id);
      }
    }

    for (const sensor of parts.filter(isSensorPart)) {
      const electrical = powerContract(sensor, this.#catalog);
      if (sensor.detached || (electrical && !powerNetwork.isPowered(sensor.id)))
        continue;
      const reachable = reachableRoutes(
        sensor.id,
        outgoing,
        (id) =>
          !componentHasControlContract(
            byId.get(id),
            "controller-target-v1",
            this.#catalog,
          ),
      );
      for (const controller of controllers)
        if (reachable.has(controller.id)) {
          if (!this.#sensorsByController.has(controller.id))
            this.#sensorsByController.set(controller.id, new Set());
          this.#sensorsByController.get(controller.id).add(sensor.id);
          if (!this.#controllersBySensor.has(sensor.id))
            this.#controllersBySensor.set(sensor.id, new Set());
          this.#controllersBySensor.get(sensor.id).add(controller.id);
          if (!this.#sensorEndpointsByController.has(controller.id))
            this.#sensorEndpointsByController.set(controller.id, new Map());
          this.#sensorEndpointsByController
            .get(controller.id)
            .set(sensor.id, reachable.get(controller.id));
        }
    }
    const evidenceEdges = [...outgoing.values()].flat().map((edge) => ({
      connectionId: edge.connectionId,
      from: { partId: edge.sourceId, portId: edge.sourcePortId },
      to: { partId: edge.targetId, portId: edge.targetPortId },
    }));
    this.#evidenceIndex = createRouteEvidenceIndex({
      medium: "signal",
      runGraph,
      edges: evidenceEdges,
      sourcePartIds: [
        ...controllers.map((controller) => controller.id),
        ...this.#controllersBySensor.keys(),
      ],
      targetPartIds: [
        ...this.#routesByTarget.keys(),
        ...this.#sensorsByController.keys(),
      ],
      terminalPartIds: controllers.map((controller) => controller.id),
      blockingConnectionIds: connections
        .filter(
          (connection) => connection.kind === "signal" && connection.failed,
        )
        .map((connection) => connection.id),
      blockerEvidence: "known",
      resultFacts: {
        routes: [...this.#routesByTarget]
          .sort(([left], [right]) => compareId(left, right))
          .map(([targetId, controllerIds]) => ({
            targetId,
            controllerIds: [...controllerIds].sort(compareId),
          })),
        controllerSensors: [...this.#sensorsByController]
          .sort(([left], [right]) => compareId(left, right))
          .map(([controllerId, sensorIds]) => ({
            controllerId,
            sensorIds: [...sensorIds].sort(compareId),
          })),
      },
    });
    return this;
  }

  evidenceIndex() {
    return this.#evidenceIndex;
  }

  routeWitness(query, expectedNetworkResultDigest) {
    return routeWitnessFromIndex(
      this.#evidenceIndex,
      query,
      expectedNetworkResultDigest,
    );
  }

  controllersForTarget(targetId) {
    return Object.freeze(
      [...(this.#routesByTarget.get(targetId) || [])].sort(compareId),
    );
  }

  targetsForController(controllerId) {
    return Object.freeze(
      [...(this.#targetsByController.get(controllerId) || [])].sort(compareId),
    );
  }

  sensorsForController(controllerId) {
    return Object.freeze(
      [...(this.#sensorsByController.get(controllerId) || [])].sort(compareId),
    );
  }

  controllersForSensor(sensorId) {
    return Object.freeze(
      [...(this.#controllersBySensor.get(sensorId) || [])].sort(compareId),
    );
  }

  hasRoute(controllerId, targetId, targetPortId = null) {
    if (!this.#targetsByController.get(controllerId)?.has(targetId))
      return false;
    return targetPortId
      ? Boolean(
          this.#targetEndpointsByController
            .get(controllerId)
            ?.get(targetId)
            ?.targetPortIds.has(targetPortId),
        )
      : true;
  }

  hasSensorRoute(controllerId, sensorId, sensorPortId = null) {
    const route = this.#sensorEndpointsByController
      .get(controllerId)
      ?.get(sensorId);
    return sensorPortId
      ? Boolean(route?.originPortIds.has(sensorPortId))
      : Boolean(route);
  }

  telemetry() {
    return immutableClone({
      graphRevision: this.#graphRevision,
      routes: [...this.#routesByTarget]
        .sort(([left], [right]) => compareId(left, right))
        .map(([targetId, controllers]) => ({
          targetId,
          controllerIds: [...controllers].sort(compareId),
        })),
      controllerTargets: [...this.#targetsByController]
        .sort(([left], [right]) => compareId(left, right))
        .map(([controllerId, targets]) => ({
          controllerId,
          targetIds: [...targets].sort(compareId),
        })),
      controllerSensors: [...this.#sensorsByController]
        .sort(([left], [right]) => compareId(left, right))
        .map(([controllerId, sensors]) => ({
          controllerId,
          endpoints: [...sensors].sort(compareId).map((partId) => ({
            partId,
            portIds: [
              ...(this.#sensorEndpointsByController
                .get(controllerId)
                ?.get(partId)?.originPortIds || []),
            ].sort(),
          })),
        })),
    });
  }
}
