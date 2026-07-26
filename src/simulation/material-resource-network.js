import { DomainValidationError, immutableClone } from "../model/primitives.js";

const stableId = (value) => `${typeof value}:${String(value)}`;
const compareId = (left, right) =>
  stableId(left).localeCompare(stableId(right), "en");

function resourceDescriptors(compiled) {
  return (compiled?.bodies || [])
    .map((body) => ({
      partId: body.partId,
      bodyId: body.id,
      contract: body.capabilities?.materialStore || null,
    }))
    .filter((entry) => entry.contract)
    .sort((left, right) => compareId(left.partId, right.partId));
}

function resourceNodes(compiled) {
  return (compiled?.bodies || [])
    .filter((body) => body.capabilities?.materialPorts?.length)
    .map((body) => ({
      partId: body.partId,
      ports: body.capabilities.materialPorts,
    }))
    .sort((left, right) => compareId(left.partId, right.partId));
}

/**
 * Authoritative finite material state and failure-aware resource topology.
 * Allocation debits one deterministic fixed-tick transaction; propulsion may
 * consume only the resulting immutable allocation record.
 */
export class MaterialResourceNetwork {
  #compiled;
  #stores = new Map();
  #components = [];
  #componentByConsumerMedium = new Map();
  #graphRevision = -1;
  #lastAllocation = [];

  constructor(compiled) {
    this.#compiled = compiled;
    for (const { partId, bodyId, contract } of resourceDescriptors(compiled))
      this.#stores.set(partId, {
        partId,
        bodyId,
        mediumId: contract.mediumId,
        capacityKg: contract.capacityKg,
        remainingMassKg: contract.initialUsableMassKg,
        densityKgM3: contract.densityKgM3,
        specificAvailableEnergyJkg: contract.specificAvailableEnergyJkg,
        outletPortId: contract.outletPortId,
        fillLaw: contract.fillLaw.kind,
        storageSolid: structuredClone(contract.storageSolid),
        storageAxisPart: [...contract.storageAxisPart],
      });
  }

  resolve(runGraph) {
    if (this.#graphRevision === runGraph.graphRevision) return this;
    const activeParts = new Map(
        runGraph
          .parts()
          .filter((part) => !part.detached)
          .map((part) => [part.id, part]),
      ),
      compiledEdges = new Map(
        (this.#compiled?.networks?.resource || []).map((edge) => [
          edge.id,
          edge,
        ]),
      ),
      activeEdges = runGraph
        .connections()
        .filter(
          (connection) =>
            connection.kind === "resource" &&
            !connection.failed &&
            activeParts.has(connection.a) &&
            activeParts.has(connection.b) &&
            compiledEdges.get(connection.id)?.transport?.kind ===
              "finite-allocation-v1",
        )
        .map((connection) => compiledEdges.get(connection.id))
        .sort((left, right) => compareId(left.id, right.id)),
      nodes = resourceNodes(this.#compiled),
      nodeById = new Map(nodes.map((node) => [node.partId, node])),
      nodeIds = new Set(
        nodes.map((node) => node.partId).filter((id) => activeParts.has(id)),
      ),
      adjacency = new Map();
    for (const edge of activeEdges) {
      nodeIds.add(edge.a);
      nodeIds.add(edge.b);
      if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
      if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
      adjacency.get(edge.a).push({ id: edge.b, edge });
      adjacency.get(edge.b).push({ id: edge.a, edge });
    }
    for (const neighbors of adjacency.values())
      neighbors.sort((left, right) => compareId(left.id, right.id));
    const visited = new Set(),
      components = [];
    for (const seed of [...nodeIds].sort(compareId)) {
      if (visited.has(seed)) continue;
      const queue = [seed],
        partIds = [],
        edgeIds = new Set(),
        mediumIds = new Set();
      visited.add(seed);
      while (queue.length) {
        const id = queue.shift();
        partIds.push(id);
        for (const neighbor of adjacency.get(id) || []) {
          edgeIds.add(neighbor.edge.id);
          mediumIds.add(neighbor.edge.mediumId);
          if (visited.has(neighbor.id)) continue;
          visited.add(neighbor.id);
          queue.push(neighbor.id);
        }
      }
      partIds.sort(compareId);
      const storePartIds = partIds.filter((id) => this.#stores.has(id)),
        mediumId =
          [...mediumIds].sort()[0] ||
          this.#stores.get(storePartIds[0])?.mediumId ||
          nodeById.get(partIds[0])?.ports[0]?.mediumId ||
          null;
      components.push({
        id: `resource:${mediumId || "none"}:${partIds.map(stableId).join("|")}`,
        mediumId,
        partIds,
        storePartIds,
        connectionIds: [...edgeIds].sort(compareId),
      });
    }
    this.#components = components;
    this.#componentByConsumerMedium = new Map(
      components.flatMap((component) =>
        component.partIds.map((partId) => [
          `${stableId(partId)}\0${component.mediumId}`,
          component,
        ]),
      ),
    );
    this.#graphRevision = runGraph.graphRevision;
    return this;
  }

  remainingMass(partId) {
    return this.#stores.get(partId)?.remainingMassKg ?? null;
  }

  stores() {
    return immutableClone(
      [...this.#stores.values()].sort((left, right) =>
        compareId(left.partId, right.partId),
      ),
    );
  }

  /**
   * Debits one fixed tick of mass-flow demand through the resolved topology.
   * Every consumer on one ideal manifold receives the same availability
   * fraction, independent of request or part insertion order.
   * @param {Array<{consumerPartId:any,mediumId:string,requestedMassKg:number}>} requests
   * @param {{tick?:number,dt?:number}} options
   */
  allocate(requests = [], options = {}) {
    const { tick, dt } = options;
    if (!Array.isArray(requests))
      throw new DomainValidationError(
        "INVALID_MATERIAL_REQUESTS",
        "Material allocation requests must be an array",
      );
    if (
      !Number.isSafeInteger(tick) ||
      tick < 0 ||
      !Number.isFinite(dt) ||
      dt <= 0
    )
      throw new DomainValidationError(
        "INVALID_MATERIAL_ALLOCATION_TICK",
        "Material allocation requires a non-negative safe tick and positive fixed duration",
        { details: { tick, dt } },
      );
    const allocationKey = (request) =>
        `${stableId(request.consumerPartId)}\0${request.mediumId}`,
      transactionId = `material-allocation:${tick}:${this.#graphRevision}`,
      ordered = requests
        .map((request, index) => {
          const requestedMassKg = Number(request.requestedMassKg);
          if (
            request.consumerPartId == null ||
            !/^[A-Za-z0-9._:-]{1,64}$/.test(String(request.mediumId || "")) ||
            !Number.isFinite(requestedMassKg) ||
            requestedMassKg < 0
          )
            throw new DomainValidationError(
              "INVALID_MATERIAL_REQUEST",
              "Material request requires a consumer, medium, and finite non-negative mass",
              { path: ["requests", index] },
            );
          return {
            consumerPartId: request.consumerPartId,
            mediumId: String(request.mediumId),
            requestedMassKg,
          };
        })
        .sort(
          (left, right) =>
            compareId(left.consumerPartId, right.consumerPartId) ||
            left.mediumId.localeCompare(right.mediumId, "en"),
        ),
      identities = new Set(ordered.map(allocationKey));
    if (identities.size !== ordered.length)
      throw new DomainValidationError(
        "DUPLICATE_MATERIAL_REQUEST",
        "A consumer may submit only one request per medium in a fixed tick",
      );
    const allocationByConsumer = new Map(),
      requestsByComponent = new Map();
    for (const request of ordered) {
      const key = allocationKey(request),
        allocationId = `${transactionId}:${stableId(request.consumerPartId)}:${request.mediumId}`,
        component = this.#componentByConsumerMedium.get(key);
      if (!component) {
        allocationByConsumer.set(key, {
          ...request,
          allocationId,
          transactionId,
          tick,
          dt,
          graphRevision: this.#graphRevision,
          componentId: null,
          deliveredMassKg: 0,
          availabilityFraction: 0,
          specificAvailableEnergyJkg: 0,
          allocatedChemicalEnergyJ: 0,
          storeDebits: [],
          reason: "no reachable same-medium manifold",
        });
        continue;
      }
      if (!requestsByComponent.has(component.id))
        requestsByComponent.set(component.id, { component, requests: [] });
      requestsByComponent.get(component.id).requests.push(request);
    }
    for (const { component, requests: componentRequests } of [
      ...requestsByComponent.values(),
    ].sort((left, right) =>
      left.component.id.localeCompare(right.component.id),
    )) {
      const stores = component.storePartIds
          .map((id) => this.#stores.get(id))
          .filter(
            (store) =>
              store?.mediumId === component.mediumId &&
              store.remainingMassKg > 0,
          )
          .sort((left, right) => compareId(left.partId, right.partId)),
        requestedTotalKg = componentRequests.reduce(
          (sum, request) => sum + request.requestedMassKg,
          0,
        ),
        availableTotalKg = stores.reduce(
          (sum, store) => sum + store.remainingMassKg,
          0,
        ),
        deliveredTotalKg = Math.min(requestedTotalKg, availableTotalKg),
        availabilityFraction =
          requestedTotalKg > 0 ? deliveredTotalKg / requestedTotalKg : 1,
        storeDebits = [];
      let remainingDebitKg = deliveredTotalKg;
      for (
        let index = 0;
        deliveredTotalKg > 0 && index < stores.length;
        index++
      ) {
        const store = stores[index],
          debitKg =
            index === stores.length - 1
              ? Math.max(0, remainingDebitKg)
              : Math.min(
                  remainingDebitKg,
                  deliveredTotalKg * (store.remainingMassKg / availableTotalKg),
                );
        store.remainingMassKg = Math.max(0, store.remainingMassKg - debitKg);
        remainingDebitKg -= debitKg;
        storeDebits.push({
          storePartId: store.partId,
          massKg: debitKg,
          specificAvailableEnergyJkg: store.specificAvailableEnergyJkg,
        });
      }
      const specificAvailableEnergyJkg =
        deliveredTotalKg > 0
          ? storeDebits.reduce(
              (sum, debit) =>
                sum + debit.massKg * debit.specificAvailableEnergyJkg,
              0,
            ) / deliveredTotalKg
          : 0;
      for (const request of componentRequests) {
        const key = allocationKey(request),
          allocationId = `${transactionId}:${stableId(request.consumerPartId)}:${request.mediumId}`,
          deliveredMassKg = request.requestedMassKg * availabilityFraction,
          requestStoreDebits = storeDebits.map((debit) => ({
            storePartId: debit.storePartId,
            massKg:
              deliveredTotalKg > 0
                ? debit.massKg * (deliveredMassKg / deliveredTotalKg)
                : 0,
          }));
        allocationByConsumer.set(key, {
          ...request,
          allocationId,
          transactionId,
          tick,
          dt,
          graphRevision: this.#graphRevision,
          componentId: component.id,
          deliveredMassKg,
          availabilityFraction,
          specificAvailableEnergyJkg,
          allocatedChemicalEnergyJ:
            deliveredMassKg * specificAvailableEnergyJkg,
          storeDebits: requestStoreDebits,
          reason:
            request.requestedMassKg === 0
              ? "zero request"
              : deliveredMassKg > 0
                ? availabilityFraction < 1
                  ? "shared reachable stores exhausted"
                  : "delivered"
                : "reachable stores empty",
        });
      }
    }
    this.#lastAllocation = ordered.map((request) =>
      allocationByConsumer.get(allocationKey(request)),
    );
    return immutableClone(this.#lastAllocation);
  }

  telemetry() {
    return immutableClone({
      version: 1,
      graphRevision: this.#graphRevision,
      allocationPolicy: "ideal-manifold-v1",
      stores: [...this.#stores.values()]
        .sort((left, right) => compareId(left.partId, right.partId))
        .map((store) => ({ ...store })),
      components: this.#components.map((component) => ({ ...component })),
      allocations: this.#lastAllocation.map((allocation) => ({
        ...allocation,
      })),
    });
  }

  exportState() {
    return immutableClone({
      version: 1,
      graphRevision: this.#graphRevision,
      stores: [...this.#stores.values()]
        .sort((left, right) => compareId(left.partId, right.partId))
        .map(({ partId, mediumId, capacityKg, remainingMassKg }) => ({
          partId,
          mediumId,
          capacityKg,
          remainingMassKg,
        })),
    });
  }

  importState(state, runGraph) {
    if (state?.version !== 1 || !Array.isArray(state.stores))
      throw new DomainValidationError(
        "INVALID_MATERIAL_RESOURCE_CHECKPOINT",
        "Material resource checkpoint must use version 1",
      );
    const records = new Map(
      state.stores.map((record) => [record.partId, record]),
    );
    if (records.size !== this.#stores.size)
      throw new DomainValidationError(
        "MATERIAL_RESOURCE_CHECKPOINT_IDENTITY_MISMATCH",
        "Material resource checkpoint store set changed",
      );
    const validated = [];
    for (const store of this.#stores.values()) {
      const record = records.get(store.partId);
      if (
        !record ||
        record.mediumId !== store.mediumId ||
        record.capacityKg !== store.capacityKg ||
        !Number.isFinite(record.remainingMassKg) ||
        record.remainingMassKg < 0 ||
        record.remainingMassKg > store.capacityKg
      )
        throw new DomainValidationError(
          "MATERIAL_RESOURCE_CHECKPOINT_IDENTITY_MISMATCH",
          `Material resource checkpoint does not match store ${store.partId}`,
        );
      validated.push([store, record.remainingMassKg]);
    }
    for (const [store, remainingMassKg] of validated)
      store.remainingMassKg = remainingMassKg;
    this.#graphRevision = -1;
    this.#componentByConsumerMedium.clear();
    this.#lastAllocation = [];
    this.resolve(runGraph);
  }
}
