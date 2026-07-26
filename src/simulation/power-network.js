import { portDefinition, portIds, portsCompatible } from "../model/ports.js";
import { immutableClone } from "../model/primitives.js";
import {
  powerContract,
  sourcePowerContract,
} from "../model/actuator-contracts.js";
import {
  createRouteEvidenceIndex,
  routeWitnessFromIndex,
} from "./route-evidence-index.js";

const stableId = (value) => `${typeof value}:${String(value)}`;
const compareId = (left, right) =>
  stableId(left).localeCompare(stableId(right), "en");

function validPowerConnection(connection, byId, catalog) {
  if (connection.kind !== "power" || connection.failed) return false;
  const left = byId.get(connection.a),
    right = byId.get(connection.b);
  if (!left || !right || left.detached || right.detached) return false;
  if (!connection.portA || !connection.portB) return false;
  if (
    !portIds(left, catalog).includes(connection.portA) ||
    !portIds(right, catalog).includes(connection.portB)
  )
    return false;
  return (
    portDefinition(left, connection.portA, catalog).kind === "power" &&
    portDefinition(right, connection.portB, catalog).kind === "power" &&
    portsCompatible(left, connection.portA, right, connection.portB, catalog)
  );
}

function powerComponents(parts, connections, catalog) {
  const byId = new Map(parts.map((part) => [part.id, part])),
    adjacency = new Map(parts.map((part) => [part.id, []]));
  for (const connection of connections) {
    if (!validPowerConnection(connection, byId, catalog)) continue;
    adjacency.get(connection.a).push(connection.b);
    adjacency.get(connection.b).push(connection.a);
  }
  const components = [],
    visited = new Set();
  for (const part of [...parts].sort((a, b) => compareId(a.id, b.id))) {
    if (visited.has(part.id) || part.detached) continue;
    const queue = [part.id],
      ids = [];
    visited.add(part.id);
    while (queue.length) {
      const id = queue.shift();
      ids.push(id);
      for (const neighbor of adjacency.get(id) || []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(ids.sort(compareId));
  }
  return { byId, components };
}

function powerEvidenceEdges(connections, byId, catalog) {
  return connections
    .filter((connection) => validPowerConnection(connection, byId, catalog))
    .flatMap((connection) => [
      {
        connectionId: connection.id,
        from: { partId: connection.a, portId: connection.portA },
        to: { partId: connection.b, portId: connection.portB },
      },
      {
        connectionId: connection.id,
        from: { partId: connection.b, portId: connection.portB },
        to: { partId: connection.a, portId: connection.portA },
      },
    ]);
}

/**
 * One fixed-tick electrical allocation over the authoritative run graph.
 * Allocation is deterministic and pro rata under shortage. Actual energy is
 * debited only when consumers draw their allocation.
 */
export class PowerNetwork {
  #catalog;
  #runGraph = null;
  #fixedDt = 1 / 120;
  #consumers = new Map();
  #sources = new Map();
  #powered = new Set();
  #graphRevision = -1;
  #evidenceIndex = null;

  constructor(catalog = {}) {
    this.#catalog = catalog;
  }

  resolve(runGraph, fixedDt = 1 / 120) {
    this.#runGraph = runGraph;
    this.#fixedDt = Math.max(1e-9, Number(fixedDt) || 1 / 120);
    this.#consumers.clear();
    this.#sources.clear();
    this.#powered.clear();
    this.#graphRevision = runGraph.graphRevision;
    const parts = runGraph.parts(),
      connections = runGraph.connections(),
      { byId, components } = powerComponents(parts, connections, this.#catalog),
      declaredSourcePartIds = parts
        .filter(
          (part) => !part.detached && sourcePowerContract(part, this.#catalog),
        )
        .map((part) => part.id);

    for (const ids of components) {
      const sources = ids
          .map((id) => byId.get(id))
          .map((part) => ({
            part,
            contract: sourcePowerContract(part, this.#catalog),
          }))
          .filter(({ part, contract }) => contract && part.energyJ > 0)
          .map(({ part, contract }) => {
            const deliverableW = Math.min(
                contract.maxOutputW,
                (part.energyJ * contract.efficiency) / this.#fixedDt,
              ),
              source = {
                id: part.id,
                availableW: deliverableW,
                allocatedW: 0,
                deliveredW: 0,
                energyDrawJ: 0,
                efficiency: contract.efficiency,
              };
            this.#sources.set(part.id, source);
            return source;
          })
          .sort((a, b) => compareId(a.id, b.id)),
        consumers = ids
          .map((id) => byId.get(id))
          .map((part) => ({
            part,
            contract: powerContract(part, this.#catalog),
          }))
          .filter(({ contract }) => contract)
          .sort((a, b) => compareId(a.part.id, b.part.id));
      if (!sources.length) {
        for (const { part, contract } of consumers)
          this.#consumers.set(part.id, {
            id: part.id,
            requestedW: contract.requestW,
            allocatedW: 0,
            deliveredW: 0,
            unmetW: contract.requestW,
            minimumW: contract.minimumW,
            baselineW: contract.baselineW,
            sourceShares: new Map(),
          });
        continue;
      }
      for (const source of sources) this.#powered.add(source.id);
      const availableW = sources.reduce(
          (sum, source) => sum + source.availableW,
          0,
        ),
        requestedW = consumers.reduce(
          (sum, entry) => sum + entry.contract.requestW,
          0,
        ),
        ratio = requestedW > 0 ? Math.min(1, availableW / requestedW) : 0;
      let allocatedTotal = 0;
      for (const { part, contract } of consumers) {
        const allocatedW = contract.requestW * ratio,
          sourceShares = new Map(
            sources.map((source) => [
              source.id,
              availableW > 0
                ? allocatedW * (source.availableW / availableW)
                : 0,
            ]),
          );
        allocatedTotal += allocatedW;
        this.#consumers.set(part.id, {
          id: part.id,
          requestedW: contract.requestW,
          allocatedW,
          deliveredW: 0,
          unmetW: Math.max(0, contract.requestW - allocatedW),
          minimumW: contract.minimumW,
          baselineW: contract.baselineW,
          sourceShares,
        });
        if (allocatedW + 1e-9 >= contract.minimumW) this.#powered.add(part.id);
      }
      // Assign only floating-point remainder, never preferential capacity.
      const residual = Math.min(availableW, requestedW) - allocatedTotal,
        receiver = consumers.at(0)?.part.id;
      if (receiver != null && residual > 0 && residual < 1e-7) {
        const record = this.#consumers.get(receiver);
        record.allocatedW += residual;
        record.unmetW = Math.max(0, record.requestedW - record.allocatedW);
      }
      for (const source of sources)
        source.allocatedW = consumers.reduce(
          (sum, entry) =>
            sum +
            (this.#consumers.get(entry.part.id).sourceShares.get(source.id) ||
              0),
          0,
        );
    }

    // Electronics consume their explicit quiescent load even when actuators
    // are idle. Motors, lamps, joints, and gyros draw in their owning systems.
    for (const record of this.#consumers.values())
      if (record.baselineW > 0)
        this.drawPower(record.id, record.baselineW, this.#fixedDt);
    this.#evidenceIndex = createRouteEvidenceIndex({
      medium: "power",
      runGraph,
      edges: powerEvidenceEdges(connections, byId, this.#catalog),
      sourcePartIds: declaredSourcePartIds,
      targetPartIds: [...this.#consumers.keys()],
      blockingConnectionIds: connections
        .filter(
          (connection) => connection.kind === "power" && connection.failed,
        )
        .map((connection) => connection.id),
      blockerEvidence: "known",
      resultFacts: {
        poweredPartIds: [...this.#powered].sort(compareId),
        declaredSources: declaredSourcePartIds.sort(compareId),
        availableSources: [...this.#sources.keys()].sort(compareId),
        consumers: [...this.#consumers.values()]
          .sort((left, right) => compareId(left.id, right.id))
          .map(({ id, requestedW, allocatedW, minimumW }) => ({
            id,
            requestedW,
            allocatedW,
            minimumW,
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

  isPowered(partId) {
    return this.#powered.has(partId);
  }

  allocationFor(partId) {
    const record = this.#consumers.get(partId);
    return record
      ? immutableClone({
          allocationId: `power-allocation:${this.#graphRevision}:${String(partId)}`,
          requestedW: record.requestedW,
          allocatedW: record.allocatedW,
          deliveredW: record.deliveredW,
          unmetW: record.unmetW,
          operational: this.isPowered(partId),
          sourceIds: [...record.sourceShares.keys()].sort(compareId),
        })
      : null;
  }

  sourceIdsFor(partId) {
    const record = this.#consumers.get(partId);
    return Object.freeze(
      record ? [...record.sourceShares.keys()].sort(compareId) : [],
    );
  }

  /** Returns delivered electrical watts and debits source joules exactly once. */
  drawPower(partId, requestedW, dt = this.#fixedDt) {
    const record = this.#consumers.get(partId),
      request = Math.max(0, Number(requestedW) || 0),
      duration = Math.max(0, Number(dt) || 0);
    if (!record || !this.#runGraph || request <= 0 || duration <= 0) return 0;
    const remainingW = Math.max(0, record.allocatedW - record.deliveredW),
      deliveredW = Math.min(request, remainingW);
    if (deliveredW <= 0) return 0;
    const shareTotal = [...record.sourceShares.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    for (const [sourceId, shareW] of record.sourceShares) {
      const source = this.#sources.get(sourceId);
      if (!source || shareTotal <= 0) continue;
      const sourceDeliveredW = deliveredW * (shareW / shareTotal),
        energyDrawJ = (sourceDeliveredW * duration) / source.efficiency,
        consumedJ = this.#runGraph.consumeEnergy(sourceId, energyDrawJ);
      source.deliveredW +=
        duration > 0 ? (consumedJ * source.efficiency) / duration : 0;
      source.energyDrawJ += consumedJ;
    }
    record.deliveredW += deliveredW;
    return deliveredW;
  }

  telemetry() {
    return immutableClone({
      graphRevision: this.#graphRevision,
      poweredPartIds: [...this.#powered].sort(compareId),
      sources: [...this.#sources.values()]
        .sort((a, b) => compareId(a.id, b.id))
        .map((source) => ({ ...source })),
      consumers: [...this.#consumers.values()]
        .sort((a, b) => compareId(a.id, b.id))
        .map((consumer) => ({
          id: consumer.id,
          requestedW: consumer.requestedW,
          allocatedW: consumer.allocatedW,
          unmetW: consumer.unmetW,
          deliveredW: consumer.deliveredW,
          operational: this.isPowered(consumer.id),
          sourceIds: [...consumer.sourceShares.keys()].sort(compareId),
        })),
      requestedW: [...this.#consumers.values()].reduce(
        (sum, entry) => sum + entry.requestedW,
        0,
      ),
      allocatedW: [...this.#consumers.values()].reduce(
        (sum, entry) => sum + entry.allocatedW,
        0,
      ),
      deliveredW: [...this.#consumers.values()].reduce(
        (sum, entry) => sum + entry.deliveredW,
        0,
      ),
      unmetW: [...this.#consumers.values()].reduce(
        (sum, entry) => sum + entry.unmetW,
        0,
      ),
    });
  }
}
