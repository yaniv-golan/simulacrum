import { readActuatorCommand } from "../model/actuator-contracts.js";
import { compareCanonicalIds, identityToken } from "../model/primitives.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../model/plain-data-contract.js";
import { dynamicMassContributorIdentity } from "../model/dynamic-mass-properties.js";
import { standardAtmosphere } from "./environment/atmosphere.js";
import {
  compressibleOrificeMassFlowKgS,
  createPneumaticState,
  DRY_AIR,
  DRY_AIR_MEDIUM_ID,
  gasAbsolutePressurePa,
  gasTemperatureK,
  pneumaticChamberVolume,
} from "./pneumatic-gas.js";

const EPSILON = 1e-12;
const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
const nodePartPrefix = (partId) =>
  `${identityToken(partId, { typedStrings: true })}\0`;
const nodeId = (partId, portId) =>
  `${nodePartPrefix(partId)}${identityToken(portId, { typedStrings: true })}`;
const PNEUMATIC_CHAMBER_FAILURE_MODES = new Set([
  "burst-v1",
  "chamber-overtemperature-v1",
  "puncture-v1",
]);
const PNEUMATIC_CHAMBER_CHECKPOINT_FIELDS = Object.freeze([
  "partId",
  "state",
  "ambientPressurePa",
  "ambientTemperatureK",
  "massInKg",
  "massOutKg",
  "boundaryEnergyJ",
  "mechanicalWorkJ",
  "heatToCarcassJ",
  "failureMode",
  "leakAreaM2",
  "damageImpulseNs",
]);
const PNEUMATIC_FAILURE_CHECKPOINT_FIELDS = Object.freeze([
  "eventId",
  "mode",
  "partId",
  "chamberPartId",
  "connectionId",
  "absolutePressurePa",
  "internalEnergyJ",
  "gasMassKg",
  "leakAreaM2",
  "transactionId",
  "timeS",
  "causal",
]);

function checkpointKeysMatch(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(),
    expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function checkpointTreeIsFinite(value) {
  if (value == null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(checkpointTreeIsFinite);
  if (typeof value !== "object") return false;
  return Object.values(value).every(checkpointTreeIsFinite);
}

function gasMassContribution(record, massKg) {
  const model = record.massModel,
    centerPartM = [...model.centerPartM];
  let inertiaTensorAtCenterKgM2;
  if (model.kind === "elliptical-toroidal-gas-volume-v1") {
    const radialMomentKgM2 =
        massKg *
        (model.majorRadiusM ** 2 / 2 +
          (3 * model.radialSemiAxisM ** 2) / 8 +
          model.axialSemiAxisM ** 2 / 4),
      axialMomentKgM2 =
        massKg *
        (model.majorRadiusM ** 2 + (3 * model.radialSemiAxisM ** 2) / 4);
    inertiaTensorAtCenterKgM2 = {
      xx: radialMomentKgM2,
      yy: radialMomentKgM2,
      zz: axialMomentKgM2,
      xy: 0,
      xz: 0,
      yz: 0,
    };
  } else if (model.kind === "box-gas-volume-v1") {
    const [x, y, z] = model.sizeM;
    inertiaTensorAtCenterKgM2 = {
      xx: (massKg * (y * y + z * z)) / 12,
      yy: (massKg * (x * x + z * z)) / 12,
      zz: (massKg * (x * x + y * y)) / 12,
      xy: 0,
      xz: 0,
      yz: 0,
    };
  } else throw new TypeError("Unsupported pneumatic gas mass model");
  return {
    id: dynamicMassContributorIdentity("pneumatic-gas", record.partId),
    massKg,
    centerPartM,
    inertiaTensorAtCenterKgM2,
  };
}

function approach(current, target, maximumDelta) {
  return current + clamp(target - current, -maximumDelta, maximumDelta);
}

function interpolateMap(points, coordinate) {
  const ordered = points.map(([x, y]) => [Number(x), Number(y)]);
  if (coordinate <= ordered[0][0]) return ordered[0][1];
  for (let index = 1; index < ordered.length; index++) {
    const left = ordered[index - 1],
      right = ordered[index];
    if (coordinate <= right[0]) {
      const fraction =
        (coordinate - left[0]) / Math.max(EPSILON, right[0] - left[0]);
      return left[1] + (right[1] - left[1]) * fraction;
    }
  }
  return ordered.at(-1)[1];
}

function connect(adjacency, left, right) {
  if (!adjacency.has(left)) adjacency.set(left, new Set());
  if (!adjacency.has(right)) adjacency.set(right, new Set());
  adjacency.get(left).add(right);
  adjacency.get(right).add(left);
}

function reachable(adjacency, start) {
  const visited = new Set([start]),
    queue = [start];
  while (queue.length) {
    const node = queue.shift();
    for (const neighbor of adjacency.get(node) || [])
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
  }
  return visited;
}

function configValue(descriptor, field, fallback = 0) {
  const value = Number(descriptor.config?.[field]);
  return Number.isFinite(value) ? value : fallback;
}

/** Authoritative finite dry-air mass and energy for connected chambers. */
export class PneumaticNetwork {
  constructor(compiledAssembly = {}) {
    this.compiled = compiledAssembly;
    this.chambers = new Map();
    this.devices = new Map();
    this.lastDevices = [];
    this.lastSensors = [];
    this.lastTransfers = [];
    this.lastComponents = [];
    this.lastLineFailures = [];
    this.pendingLineFailures = [];
    this.failureEvents = [];
    this.lastFailureEvents = [];
    this.transactionCursor = 0;
    this.lastGraphRevision = 0;
    for (const body of compiledAssembly.bodies || []) {
      const capability = body.capabilities?.pneumatic;
      if (!capability) continue;
      if (
        capability.kind === "tire-chamber-v1" ||
        capability.kind === "ideal-gas-control-volume-v1"
      ) {
        const reservoir = capability.kind === "ideal-gas-control-volume-v1",
          authoredVolumeM3 = reservoir
            ? configValue(capability, capability.volumeField)
            : pneumaticChamberVolume(capability.chamber, 0),
          chamber = reservoir
            ? {
                kind: capability.kind,
                mediumId: DRY_AIR_MEDIUM_ID,
                portId: capability.portId,
                referenceInternalVolumeM3: authoredVolumeM3,
                minimumInternalVolumeM3: authoredVolumeM3,
                initialColdGaugePressurePa: configValue(
                  capability,
                  capability.initialGaugePressureField,
                ),
                initialGasTemperatureK: configValue(
                  capability,
                  capability.initialTemperatureField,
                ),
                volumeLaw: {
                  kind: "fixed-control-volume-v1",
                  quadraticVolumeLossM: 0,
                  cubicVolumeLoss: 0,
                },
                heatTransfer: {
                  kind: "lumped-conductance-v1",
                  gasToCarcassConductanceWPerK: configValue(
                    capability,
                    capability.gasToShellConductanceField,
                  ),
                },
                limits: {
                  minimumGaugePressurePa: -100_000,
                  maximumAbsolutePressurePa: configValue(
                    capability,
                    capability.maximumAbsolutePressureField,
                  ),
                  burstAbsolutePressurePa: configValue(
                    capability,
                    capability.burstAbsolutePressureField,
                  ),
                },
              }
            : capability.chamber,
          atmosphere = standardAtmosphere(
            Math.max(0, Number(body.position?.[1]) || 0),
          ),
          ambientPressurePa = atmosphere.pressure,
          volumeM3 = pneumaticChamberVolume(chamber, 0);
        this.chambers.set(body.partId, {
          partId: body.partId,
          bodyId: body.id,
          massContributorKind: capability.kind,
          controlVolumeKind: reservoir ? "reservoir-v1" : "tire-chamber-v1",
          portId: chamber.portId,
          chamber,
          massModel: reservoir
            ? {
                ...capability.massModel,
                sizeM: [...capability.config[capability.massModel.sizeField]],
              }
            : chamber.massModel,
          ambientPressurePa,
          ambientTemperatureK: atmosphere.temperature,
          state: createPneumaticState({
            absolutePressurePa:
              ambientPressurePa + chamber.initialColdGaugePressurePa,
            temperatureK: chamber.initialGasTemperatureK,
            volumeM3,
          }),
          massInKg: 0,
          massOutKg: 0,
          boundaryEnergyJ: 0,
          mechanicalWorkJ: 0,
          heatToCarcassJ: 0,
          failureMode: null,
          leakAreaM2: 0,
          damageImpulseNs: 0,
        });
      } else {
        const device = { ...capability, partId: body.partId };
        if (device.kind === "ambient-air-compressor-v1") {
          device.dynamicState = {
            spool: 0,
            motorTemperatureK: 293.15,
            overheated: false,
          };
        } else if (device.kind === "three-way-valve-v1") {
          device.dynamicState = {
            position: configValue(device, device.failPositionField),
          };
        }
        this.devices.set(body.partId, device);
      }
    }
    this.initialGasMassKg = [...this.chambers.values()].reduce(
      (sum, record) => sum + record.state.massKg,
      0,
    );
    this.initialInternalEnergyJ = [...this.chambers.values()].reduce(
      (sum, record) => sum + record.state.internalEnergyJ,
      0,
    );
  }

  #pressure(record) {
    return gasAbsolutePressurePa(record.state, record.state.volumeM3);
  }

  #edgeIsActive(edge, runGraph) {
    const connection = runGraph.connection(edge.id),
      partA = runGraph.part(edge.a),
      partB = runGraph.part(edge.b);
    return Boolean(
      connection &&
      !connection.failed &&
      partA &&
      !partA.detached &&
      partB &&
      !partB.detached,
    );
  }

  #adjacency(runGraph, openValveIds = new Set()) {
    const adjacency = new Map();
    for (const edge of this.compiled.networks?.resource || []) {
      if (
        edge.mediumId !== DRY_AIR_MEDIUM_ID ||
        edge.transport?.kind !== "compressible-gas-v1"
      )
        continue;
      if (!this.#edgeIsActive(edge, runGraph)) continue;
      connect(
        adjacency,
        nodeId(edge.a, edge.portA),
        nodeId(edge.b, edge.portB),
      );
    }
    for (const partId of openValveIds) {
      const valve = this.devices.get(partId);
      connect(
        adjacency,
        nodeId(partId, valve.supplyPortId),
        nodeId(partId, valve.tirePortId),
      );
    }
    return adjacency;
  }

  #components(adjacency) {
    const pending = new Set(adjacency.keys()),
      components = [];
    while (pending.size) {
      const first = pending.values().next().value,
        nodes = reachable(adjacency, first);
      for (const node of nodes) pending.delete(node);
      components.push(nodes);
    }
    return components;
  }

  #componentTransport(nodes, runGraph, valveTransports = new Map()) {
    const transports = (this.compiled.networks?.resource || [])
      .filter(
        (edge) =>
          edge.mediumId === DRY_AIR_MEDIUM_ID &&
          edge.transport?.kind === "compressible-gas-v1" &&
          this.#edgeIsActive(edge, runGraph) &&
          nodes.has(nodeId(edge.a, edge.portA)) &&
          nodes.has(nodeId(edge.b, edge.portB)),
      )
      .map((edge) => edge.transport);
    for (const [partId, transport] of valveTransports) {
      const valve = this.devices.get(partId);
      if (
        nodes.has(nodeId(partId, valve.supplyPortId)) &&
        nodes.has(nodeId(partId, valve.tirePortId))
      )
        transports.push(transport);
    }
    if (!transports.length) return null;
    return {
      effectiveOrificeAreaM2: Math.min(
        ...transports.map(({ effectiveOrificeAreaM2 }) =>
          Number(effectiveOrificeAreaM2),
        ),
      ),
      dischargeCoefficient: Math.min(
        ...transports.map(({ dischargeCoefficient }) =>
          Number(dischargeCoefficient),
        ),
      ),
      connectionIds: (this.compiled.networks?.resource || [])
        .filter(
          (edge) =>
            edge.mediumId === DRY_AIR_MEDIUM_ID &&
            edge.transport?.kind === "compressible-gas-v1" &&
            this.#edgeIsActive(edge, runGraph) &&
            nodes.has(nodeId(edge.a, edge.portA)) &&
            nodes.has(nodeId(edge.b, edge.portB)),
        )
        .map(({ id }) => id)
        .sort(compareCanonicalIds),
    };
  }

  #passiveTransfers(adjacency, runGraph, dt, valveTransports = new Map()) {
    const requests = [];
    for (const nodes of this.#components(adjacency)) {
      const chambers = this.#chambersIn(nodes).sort((left, right) =>
          compareCanonicalIds(left.partId, right.partId),
        ),
        transport = this.#componentTransport(nodes, runGraph, valveTransports);
      if (chambers.length < 2 || !transport) continue;
      for (let leftIndex = 0; leftIndex < chambers.length; leftIndex++)
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < chambers.length;
          rightIndex++
        ) {
          const left = chambers[leftIndex],
            right = chambers[rightIndex],
            leftPressurePa = this.#pressure(left),
            rightPressurePa = this.#pressure(right),
            source = leftPressurePa >= rightPressurePa ? left : right,
            destination = source === left ? right : left,
            upstreamPressurePa = Math.max(leftPressurePa, rightPressurePa),
            downstreamPressurePa = Math.min(leftPressurePa, rightPressurePa),
            upstreamTemperatureK = gasTemperatureK(source.state),
            requestedMassKg =
              compressibleOrificeMassFlowKgS({
                upstreamPressurePa,
                downstreamPressurePa,
                upstreamTemperatureK,
                dischargeCoefficient: transport.dischargeCoefficient,
                areaM2: transport.effectiveOrificeAreaM2,
              }) * dt,
            requestedEnergyJ =
              requestedMassKg *
              DRY_AIR.constantPressureHeatCapacityJPerKgK *
              upstreamTemperatureK;
          if (requestedMassKg > 0)
            requests.push({
              source,
              destination,
              requestedMassKg,
              requestedEnergyJ,
              connectionIds: transport.connectionIds,
            });
        }
    }
    const bySource = new Map();
    for (const request of requests) {
      if (!bySource.has(request.source.partId))
        bySource.set(request.source.partId, []);
      bySource.get(request.source.partId).push(request);
    }
    const transfers = [];
    for (const sourceRequests of bySource.values()) {
      const source = sourceRequests[0].source,
        requestedMassKg = sourceRequests.reduce(
          (sum, request) => sum + request.requestedMassKg,
          0,
        ),
        requestedEnergyJ = sourceRequests.reduce(
          (sum, request) => sum + request.requestedEnergyJ,
          0,
        ),
        scale = Math.min(
          1,
          Math.max(0, source.state.massKg - EPSILON) /
            Math.max(EPSILON, requestedMassKg),
          Math.max(0, source.state.internalEnergyJ - EPSILON) /
            Math.max(EPSILON, requestedEnergyJ),
        );
      for (const request of sourceRequests) {
        const deliveredMassKg = request.requestedMassKg * scale,
          deliveredEnergyJ = request.requestedEnergyJ * scale;
        source.state.massKg -= deliveredMassKg;
        source.state.internalEnergyJ -= deliveredEnergyJ;
        source.massOutKg += deliveredMassKg;
        request.destination.state.massKg += deliveredMassKg;
        request.destination.state.internalEnergyJ += deliveredEnergyJ;
        request.destination.massInKg += deliveredMassKg;
        transfers.push({
          transactionId: this.transactionCursor + 1,
          kind: "chamber-transfer-v1",
          sourcePartId: source.partId,
          destinationPartId: request.destination.partId,
          connectionIds: request.connectionIds,
          requestedMassKg: request.requestedMassKg,
          deliveredMassKg,
          deliveredEnergyJ,
          limitingReason: scale < 1 ? "source-bound" : null,
        });
      }
    }
    return transfers.sort(
      (left, right) =>
        compareCanonicalIds(left.sourcePartId, right.sourcePartId) ||
        compareCanonicalIds(left.destinationPartId, right.destinationPartId),
    );
  }

  #captureComponents(adjacency, runGraph) {
    return this.#components(adjacency).map((nodes, index) => {
      const transport = this.#componentTransport(nodes, runGraph),
        partIds = [...this.chambers.keys(), ...this.devices.keys()]
          .filter((partId) =>
            [...nodes].some((node) => node.startsWith(nodePartPrefix(partId))),
          )
          .sort(compareCanonicalIds);
      return {
        componentId: `pneumatic-component:${runGraph.graphRevision}:${index}`,
        partIds,
        chamberPartIds: this.#chambersIn(nodes)
          .map(({ partId }) => partId)
          .sort(compareCanonicalIds),
        connectionIds: transport?.connectionIds || [],
      };
    });
  }

  #linePressureFailures(adjacency, runGraph) {
    return (this.compiled.networks?.resource || [])
      .filter(
        (edge) =>
          edge.mediumId === DRY_AIR_MEDIUM_ID &&
          edge.transport?.kind === "compressible-gas-v1" &&
          this.#edgeIsActive(edge, runGraph),
      )
      .map((edge) => {
        const nodes = reachable(adjacency, nodeId(edge.a, edge.portA));
        return {
          connectionId: edge.id,
          peakAbsolutePressurePa: Math.max(
            0,
            ...this.#chambersIn(nodes).map((record) => this.#pressure(record)),
          ),
          maximumAbsolutePressurePa: edge.transport.maximumAbsolutePressurePa,
        };
      })
      .filter(
        (record) =>
          record.peakAbsolutePressurePa > record.maximumAbsolutePressurePa,
      )
      .sort((left, right) =>
        compareCanonicalIds(left.connectionId, right.connectionId),
      );
  }

  #chambersIn(nodes) {
    return [...this.chambers.values()].filter((record) =>
      nodes.has(nodeId(record.partId, record.portId)),
    );
  }

  #vent(record, { areaM2, dischargeCoefficient }, dt) {
    const pressurePa = this.#pressure(record),
      temperatureK = gasTemperatureK(record.state),
      flowKgS = compressibleOrificeMassFlowKgS({
        upstreamPressurePa: pressurePa,
        downstreamPressurePa: record.ambientPressurePa,
        upstreamTemperatureK: temperatureK,
        dischargeCoefficient,
        areaM2,
      }),
      requestedMassKg = flowKgS * dt,
      removedMassKg = Math.min(
        requestedMassKg,
        Math.max(0, record.state.massKg - EPSILON),
      ),
      specificEnthalpyJkg =
        DRY_AIR.constantPressureHeatCapacityJPerKgK * temperatureK,
      removedEnergyJ = Math.min(
        record.state.internalEnergyJ - EPSILON,
        removedMassKg * specificEnthalpyJkg,
      );
    record.state.massKg -= removedMassKg;
    record.state.internalEnergyJ -= Math.max(0, removedEnergyJ);
    record.massOutKg += removedMassKg;
    record.boundaryEnergyJ -= Math.max(0, removedEnergyJ);
    return {
      requestedMassKg,
      massKg: removedMassKg,
      energyJ: Math.max(0, removedEnergyJ),
    };
  }

  #recordFailure(record, mode, context = {}, causal = {}) {
    const event = {
      eventId: `pneumatic-failure:${this.transactionCursor}:${identityToken(record.partId, { typedStrings: true })}:${mode}`,
      mode,
      partId: record.partId,
      chamberPartId: record.partId,
      connectionId: causal.connectionId || null,
      absolutePressurePa: this.#pressure(record),
      internalEnergyJ: record.state.internalEnergyJ,
      gasMassKg: record.state.massKg,
      leakAreaM2: record.leakAreaM2,
      transactionId: this.transactionCursor,
      timeS: Number(context.time) || 0,
      causal: structuredClone(causal),
    };
    this.lastFailureEvents.push(event);
    this.failureEvents.push(event);
    if (this.failureEvents.length > 128)
      this.failureEvents.splice(0, this.failureEvents.length - 128);
    return event;
  }

  resolve(context, dt) {
    this.lastFailureEvents = [];
    for (const record of this.chambers.values()) {
      const body = context.services?.multibodyRuntime?.bodyByPart?.get(
        record.partId,
      );
      if (body) {
        const atmosphere = standardAtmosphere(
          Math.max(0, Number(body.position.y) || 0),
        );
        record.ambientPressurePa = atmosphere.pressure;
        record.ambientTemperatureK = atmosphere.temperature;
      }
    }
    const valveStates = [],
      compressorStates = [],
      openValveIds = new Set(),
      valveTransports = new Map();
    for (const device of this.devices.values()) {
      if (device.kind !== "three-way-valve-v1") continue;
      const part = context.runGraph.part(device.partId),
        commandRecord = readActuatorCommand(
          context.commandBus,
          part,
          "position",
          0,
        ),
        command = commandRecord.value,
        deadband = configValue(device, device.deadbandField),
        requestedPosition = Math.abs(command) > deadband ? command : 0,
        failPosition = configValue(device, device.failPositionField),
        requestedW =
          Math.abs(requestedPosition - failPosition) > deadband ||
          Math.abs(requestedPosition - device.dynamicState.position) > EPSILON
            ? configValue(device, device.electricalPowerField)
            : 0,
        allocation = context.powerNetwork?.allocationFor(part.id),
        deliveredW =
          requestedW && !part.detached && allocation?.operational
            ? context.powerNetwork.drawPower(part.id, requestedW, dt)
            : 0,
        powered = requestedW > 0 && deliveredW >= requestedW * 0.98,
        targetPosition = powered ? requestedPosition : failPosition,
        openingTimeS = configValue(device, device.openingTimeField),
        position = approach(
          device.dynamicState.position,
          targetPosition,
          (2 * dt) / openingTimeS,
        ),
        leakageAreaM2 = configValue(device, device.leakageAreaField),
        orificeAreaM2 = configValue(device, device.orificeAreaField),
        supplyAreaM2 =
          position > deadband ? leakageAreaM2 + orificeAreaM2 * position : 0;
      device.dynamicState.position = position;
      if (supplyAreaM2 > 0) {
        openValveIds.add(device.partId);
        valveTransports.set(device.partId, {
          effectiveOrificeAreaM2: supplyAreaM2,
          dischargeCoefficient: configValue(
            device,
            device.dischargeCoefficientField,
          ),
        });
      }
      valveStates.push({
        partId: device.partId,
        kind: device.kind,
        command,
        commandConflict: Boolean(commandRecord.conflict),
        position,
        targetPosition,
        requestedW,
        deliveredW,
        powered,
        limitingReason: part.detached
          ? "detached"
          : commandRecord.conflict
            ? "command-conflict"
            : !powered && Math.abs(requestedPosition) > deadband
              ? "power-loss"
              : null,
        connectedChamberPartIds: [],
      });
    }
    const adjacency = this.#adjacency(context.runGraph, openValveIds);
    this.transactionCursor++;
    this.lastGraphRevision = context.runGraph.graphRevision;
    this.lastTransfers = this.#passiveTransfers(
      adjacency,
      context.runGraph,
      dt,
      valveTransports,
    );
    this.lastComponents = this.#captureComponents(adjacency, context.runGraph);
    this.pendingLineFailures = this.#linePressureFailures(
      adjacency,
      context.runGraph,
    );

    for (const device of this.devices.values()) {
      if (device.kind !== "ambient-air-compressor-v1") continue;
      const part = context.runGraph.part(device.partId),
        commandRecord = readActuatorCommand(
          context.commandBus,
          part,
          "inflate",
          0,
        ),
        command = commandRecord.value,
        targets = this.#chambersIn(
          reachable(adjacency, nodeId(device.partId, device.outletPortId)),
        ),
        maximumGaugePressurePa = configValue(
          device,
          device.maximumGaugePressureField,
        ),
        reliefAbsolutePressurePa = configValue(
          device,
          device.reliefAbsolutePressureField,
        ),
        activeTargets = targets.filter(
          (record) =>
            this.#pressure(record) <
            Math.min(
              record.ambientPressurePa + maximumGaugePressurePa,
              reliefAbsolutePressurePa,
              record.chamber.limits.maximumAbsolutePressurePa,
            ),
        ),
        maximumMotorTemperatureK = configValue(
          device,
          device.maximumMotorTemperatureField,
        ),
        recovered =
          device.dynamicState.motorTemperatureK < maximumMotorTemperatureK - 10,
        overheated = device.dynamicState.overheated
          ? !recovered
          : device.dynamicState.motorTemperatureK >= maximumMotorTemperatureK,
        requestedW =
          command > 0 && activeTargets.length && !overheated
            ? configValue(device, device.electricalPowerField) * command
            : 0,
        allocation = context.powerNetwork?.allocationFor(part.id),
        deliveredW =
          requestedW && !part.detached && allocation?.operational
            ? context.powerNetwork.drawPower(part.id, requestedW, dt)
            : 0,
        powered = requestedW > 0 && deliveredW >= requestedW * 0.98,
        targetSpool = powered ? command : 0,
        responseTimeS = configValue(device, device.responseTimeField),
        spool = approach(
          device.dynamicState.spool,
          targetSpool,
          dt / responseTimeS,
        ),
        ratedMassFlowKgS = configValue(device, device.maximumMassFlowField),
        ratedShareKg = powered
          ? (ratedMassFlowKgS * spool * dt) / Math.max(1, activeTargets.length)
          : 0;
      device.dynamicState.spool = spool;
      device.dynamicState.overheated = overheated;
      let deliveredMassKg = 0,
        compressionWorkJ = 0;
      for (const record of activeTargets) {
        const pressureLimitPa = Math.min(
            record.ambientPressurePa + maximumGaugePressurePa,
            record.chamber.limits.maximumAbsolutePressurePa,
          ),
          pressurePa = this.#pressure(record),
          headFraction = clamp(
            (pressureLimitPa - pressurePa) /
              Math.max(EPSILON, pressureLimitPa - record.ambientPressurePa),
            0,
            1,
          ),
          pressureRatio = clamp(
            this.#pressure(record) /
              Math.max(EPSILON, record.ambientPressurePa),
            1,
            20,
          ),
          performanceFactor = interpolateMap(
            device.config?.[device.pressureRatioFlowMapField],
            pressureRatio,
          ),
          deliveryTemperatureK =
            record.ambientTemperatureK *
            pressureRatio **
              ((DRY_AIR.heatCapacityRatio - 1) / DRY_AIR.heatCapacityRatio),
          compressionWorkPerKgJ =
            DRY_AIR.constantPressureHeatCapacityJPerKgK *
            Math.max(0, deliveryTemperatureK - record.ambientTemperatureK),
          electricalEfficiency = configValue(
            device,
            device.electricalEfficiencyField,
          ),
          powerLimitedMassKg =
            compressionWorkPerKgJ > EPSILON
              ? (deliveredW * electricalEfficiency * dt) /
                Math.max(1, activeTargets.length) /
                compressionWorkPerKgJ
              : ratedShareKg,
          nodes = reachable(
            adjacency,
            nodeId(device.partId, device.outletPortId),
          ),
          transport = this.#componentTransport(
            nodes,
            context.runGraph,
            valveTransports,
          ),
          lineLimitedMassKg = transport
            ? compressibleOrificeMassFlowKgS({
                upstreamPressurePa: reliefAbsolutePressurePa,
                downstreamPressurePa: pressurePa,
                upstreamTemperatureK: deliveryTemperatureK,
                dischargeCoefficient: transport.dischargeCoefficient,
                areaM2: transport.effectiveOrificeAreaM2,
              }) * dt
            : 0,
          requestedMassKg = ratedShareKg * headFraction * performanceFactor,
          shareKg = Math.min(
            requestedMassKg,
            powerLimitedMassKg,
            lineLimitedMassKg,
          ),
          energyJ =
            shareKg *
            DRY_AIR.constantPressureHeatCapacityJPerKgK *
            deliveryTemperatureK;
        record.state.massKg += shareKg;
        record.state.internalEnergyJ += energyJ;
        record.massInKg += shareKg;
        record.boundaryEnergyJ += energyJ;
        deliveredMassKg += shareKg;
        compressionWorkJ += shareKg * compressionWorkPerKgJ;
        if (shareKg > 0)
          this.lastTransfers.push({
            transactionId: this.transactionCursor,
            kind: "ambient-intake-v1",
            sourcePartId: null,
            destinationPartId: record.partId,
            connectionIds: transport?.connectionIds || [],
            requestedMassKg,
            deliveredMassKg: shareKg,
            deliveredEnergyJ: energyJ,
            limitingReason:
              shareKg + EPSILON < requestedMassKg
                ? shareKg + EPSILON >= powerLimitedMassKg
                  ? "power-limited"
                  : shareKg + EPSILON >= lineLimitedMassKg
                    ? "line-limited"
                    : "backpressure"
                : null,
          });
      }
      const ambientTemperatureK =
          activeTargets[0]?.ambientTemperatureK || 293.15,
        wasteHeatJ = Math.max(0, deliveredW * dt - compressionWorkJ),
        coolingJ =
          configValue(device, device.motorCoolingField) *
          Math.max(
            0,
            device.dynamicState.motorTemperatureK - ambientTemperatureK,
          ) *
          dt,
        motorThermalMassJPerK = configValue(
          device,
          device.motorThermalMassField,
        );
      device.dynamicState.motorTemperatureK = Math.max(
        ambientTemperatureK,
        device.dynamicState.motorTemperatureK +
          (wasteHeatJ - coolingJ) / motorThermalMassJPerK,
      );
      compressorStates.push({
        partId: device.partId,
        kind: device.kind,
        command,
        commandConflict: Boolean(commandRecord.conflict),
        spool,
        requestedW,
        deliveredW,
        powered,
        connectedChamberPartIds: activeTargets.map(({ partId }) => partId),
        deliveredMassKg,
        compressionWorkJ,
        electricalEnergyJ: deliveredW * dt,
        motorTemperatureK: device.dynamicState.motorTemperatureK,
        overheated,
        reliefActive: Boolean(
          command > 0 && !activeTargets.length && targets.length,
        ),
        limitingReason: part.detached
          ? "detached"
          : commandRecord.conflict
            ? "command-conflict"
            : overheated
              ? "overtemperature"
              : !targets.length && command > 0
                ? "disconnected"
                : !activeTargets.length && command > 0
                  ? "relief-or-backpressure"
                  : !powered && command > 0
                    ? "power-loss"
                    : null,
      });
    }

    for (const state of valveStates) {
      const device = this.devices.get(state.partId),
        deadband = configValue(device, device.deadbandField);
      if (state.position >= -deadband) continue;
      const nodes = reachable(
          adjacency,
          nodeId(device.partId, device.tirePortId),
        ),
        targets = this.#chambersIn(nodes),
        lineTransport = this.#componentTransport(nodes, context.runGraph),
        deviceAreaM2 =
          configValue(device, device.leakageAreaField) +
          configValue(device, device.orificeAreaField) * -state.position,
        areaM2 = lineTransport
          ? Math.min(deviceAreaM2, lineTransport.effectiveOrificeAreaM2)
          : 0,
        dischargeCoefficient = lineTransport
          ? Math.min(
              configValue(device, device.dischargeCoefficientField),
              lineTransport.dischargeCoefficient,
            )
          : 0;
      for (const record of targets) {
        const vented = this.#vent(
          record,
          {
            dischargeCoefficient,
            areaM2,
          },
          dt,
        );
        if (vented.massKg > 0)
          this.lastTransfers.push({
            transactionId: this.transactionCursor,
            kind: "ambient-exhaust-v1",
            sourcePartId: record.partId,
            destinationPartId: null,
            connectionIds: lineTransport?.connectionIds || [],
            requestedMassKg: vented.requestedMassKg,
            deliveredMassKg: vented.massKg,
            deliveredEnergyJ: vented.energyJ,
            limitingReason: null,
          });
      }
      state.connectedChamberPartIds = targets.map(({ partId }) => partId);
    }
    for (const record of this.chambers.values()) {
      const pressurePa = this.#pressure(record),
        temperatureK = gasTemperatureK(record.state),
        damageLaw = record.chamber.damageLaw;
      if (
        !record.failureMode &&
        pressurePa >= record.chamber.limits.burstAbsolutePressurePa
      ) {
        record.failureMode = "burst-v1";
        record.leakAreaM2 =
          damageLaw?.burstLeakAreaM2 || Math.max(record.leakAreaM2, 0.00025);
        this.#recordFailure(record, record.failureMode, context, {
          criterion: "absolute-pressure-threshold",
          threshold: record.chamber.limits.burstAbsolutePressurePa,
        });
      } else if (
        !record.failureMode &&
        damageLaw &&
        temperatureK >= damageLaw.maximumGasTemperatureK
      ) {
        record.failureMode = "chamber-overtemperature-v1";
        record.leakAreaM2 = damageLaw.punctureLeakAreaM2;
        this.#recordFailure(record, record.failureMode, context, {
          criterion: "gas-temperature-threshold",
          threshold: damageLaw.maximumGasTemperatureK,
        });
      }
      if (record.leakAreaM2 > 0) {
        const leaked = this.#vent(
          record,
          { dischargeCoefficient: 0.82, areaM2: record.leakAreaM2 },
          dt,
        );
        if (leaked.massKg > 0)
          this.lastTransfers.push({
            transactionId: this.transactionCursor,
            kind: "damage-leak-v1",
            sourcePartId: record.partId,
            destinationPartId: null,
            connectionIds: [],
            requestedMassKg: leaked.requestedMassKg,
            deliveredMassKg: leaked.massKg,
            deliveredEnergyJ: leaked.energyJ,
            limitingReason: record.failureMode,
          });
      }
    }
    this.lastDevices = [...compressorStates, ...valveStates];
    this.lastSensors = [...this.devices.values()]
      .filter((device) => device.kind === "pressure-sensor-v1")
      .map((device) => {
        const part = context.runGraph.part(device.partId),
          measurement = this.measurementForPart(
            device.partId,
            context.runGraph,
          ),
          powered = Boolean(
            !part.detached &&
            (typeof context.powerNetwork?.isPowered === "function"
              ? context.powerNetwork.isPowered(device.partId)
              : context.powerNetwork?.allocationFor?.(device.partId)
                  ?.operational),
          );
        return {
          partId: device.partId,
          valid: Boolean(powered && measurement),
          powered,
          limitingReason: part.detached
            ? "detached"
            : !powered
              ? "power-loss"
              : !measurement
                ? "disconnected"
                : null,
          ...(measurement || {}),
        };
      });
  }

  commitMechanicalState(
    partId,
    {
      deflectionM = 0,
      carcassTemperatureK = 293.15,
      rimLoadN = 0,
      normalLoadN = 0,
      contactRoles = [],
    },
    dt,
    timeS = 0,
  ) {
    const record = this.chambers.get(partId);
    if (!record) return null;
    const previousVolumeM3 = record.state.volumeM3,
      nextVolumeM3 = pneumaticChamberVolume(record.chamber, deflectionM),
      meanVolumeM3 = (previousVolumeM3 + nextVolumeM3) / 2,
      pressurePa = gasAbsolutePressurePa(record.state, meanVolumeM3),
      mechanicalWorkJ = -pressurePa * (nextVolumeM3 - previousVolumeM3),
      gasTemperature = gasTemperatureK(record.state),
      heatToCarcassJ =
        record.chamber.heatTransfer.gasToCarcassConductanceWPerK *
        (gasTemperature - carcassTemperatureK) *
        dt;
    record.state.internalEnergyJ = Math.max(
      EPSILON,
      record.state.internalEnergyJ + mechanicalWorkJ - heatToCarcassJ,
    );
    record.state.volumeM3 = nextVolumeM3;
    record.mechanicalWorkJ += mechanicalWorkJ;
    record.heatToCarcassJ += heatToCarcassJ;
    const damageLaw = record.chamber.damageLaw;
    if (damageLaw && !record.failureMode) {
      const sidewallLoadN = contactRoles.includes("sidewall")
          ? Math.max(0, Number(normalLoadN) || 0)
          : 0,
        excessLoadN =
          Math.max(0, Number(rimLoadN) - damageLaw.rimLoadThresholdN) +
          Math.max(0, sidewallLoadN - damageLaw.sidewallLoadThresholdN);
      record.damageImpulseNs += excessLoadN * dt;
      if (record.damageImpulseNs >= damageLaw.excessLoadImpulseThresholdNs) {
        record.failureMode = "puncture-v1";
        record.leakAreaM2 = damageLaw.punctureLeakAreaM2;
        this.#recordFailure(
          record,
          record.failureMode,
          { time: timeS },
          {
            criterion: "excess-contact-load-impulse",
            damageImpulseNs: record.damageImpulseNs,
            threshold: damageLaw.excessLoadImpulseThresholdNs,
            rimLoadN: Number(rimLoadN) || 0,
            sidewallLoadN,
          },
        );
      }
    }
    return {
      state: { ...record.state },
      ambientPressurePa: record.ambientPressurePa,
      heatToCarcassJ,
    };
  }

  commitStaticThermal(dt) {
    for (const record of this.chambers.values()) {
      if (record.controlVolumeKind !== "reservoir-v1") continue;
      const heatToShellJ = clamp(
        record.chamber.heatTransfer.gasToCarcassConductanceWPerK *
          (gasTemperatureK(record.state) - record.ambientTemperatureK) *
          dt,
        -Infinity,
        record.state.internalEnergyJ - EPSILON,
      );
      record.state.internalEnergyJ -= heatToShellJ;
      record.heatToCarcassJ += heatToShellJ;
    }
  }

  commitStructuralFailures(context) {
    this.lastLineFailures = this.pendingLineFailures.map((failure) => {
      context.runGraph.failConnection(failure.connectionId, {
        reason: `Pneumatic line exceeded ${failure.maximumAbsolutePressurePa} Pa working pressure`,
        mode: "pneumatic-line-overpressure-v1",
        time: context.time || 0,
      });
      return { ...failure, mode: "pneumatic-line-overpressure-v1" };
    });
    this.pendingLineFailures = [];
    if (
      this.lastLineFailures.length ||
      this.lastGraphRevision !== context.runGraph.graphRevision
    ) {
      const openValveIds = new Set(
          this.lastDevices
            .filter(
              (device) =>
                device.kind === "three-way-valve-v1" && device.position > 0.01,
            )
            .map(({ partId }) => partId),
        ),
        adjacency = this.#adjacency(context.runGraph, openValveIds);
      this.lastGraphRevision = context.runGraph.graphRevision;
      this.lastComponents = this.#captureComponents(
        adjacency,
        context.runGraph,
      );
    }
    return structuredClone(this.lastLineFailures);
  }

  stateForPart(partId) {
    const record = this.chambers.get(partId);
    return record ? structuredClone(record.state) : null;
  }

  forEachChamberState(visitor) {
    for (const record of this.chambers.values())
      visitor(record.partId, record.state, record.ambientPressurePa);
  }

  gasMassForPart(partId) {
    return this.chambers.has(partId)
      ? this.chambers.get(partId).state.massKg
      : null;
  }

  massContributions() {
    return [...this.chambers.values()]
      .sort((left, right) => compareCanonicalIds(left.partId, right.partId))
      .map((record) => ({
        partId: record.partId,
        kind: record.massContributorKind,
        massKg: record.state.massKg,
        internalEnergyJ: record.state.internalEnergyJ,
        volumeM3: record.state.volumeM3,
      }));
  }

  gasMassContributionForPart(partId) {
    const record = this.chambers.get(partId);
    if (!record) return null;
    return gasMassContribution(record, record.state.massKg);
  }

  /** Purely projects gas mass and inertia from a validated checkpoint. */
  massProjectionForState(snapshot) {
    const { chamberStages } = this.validateState(snapshot),
      ordered = [...chamberStages].sort((left, right) =>
        compareCanonicalIds(left.record.partId, right.record.partId),
      );
    return {
      records: ordered.map(({ record, saved }) => ({
        partId: record.partId,
        kind: record.massContributorKind,
        massKg: saved.state.massKg,
        internalEnergyJ: saved.state.internalEnergyJ,
        volumeM3: saved.state.volumeM3,
      })),
      contributions: ordered.map(({ record, saved }) => ({
        partId: record.partId,
        contribution: gasMassContribution(record, saved.state.massKg),
      })),
    };
  }

  measurementForPart(partId, runGraph) {
    const sensor = this.devices.get(partId);
    if (sensor?.kind !== "pressure-sensor-v1") return null;
    const connected = this.#chambersIn(
      reachable(this.#adjacency(runGraph), nodeId(partId, sensor.portId)),
    )[0];
    if (!connected) return null;
    const absolutePressurePa = this.#pressure(connected);
    return {
      chamberPartId: connected.partId,
      absolutePressurePa,
      gaugePressurePa: absolutePressurePa - connected.ambientPressurePa,
      temperatureK: gasTemperatureK(connected.state),
    };
  }

  telemetry() {
    const records = [...this.chambers.values()],
      totalGasMassKg = records.reduce(
        (sum, record) => sum + record.state.massKg,
        0,
      ),
      totalInternalEnergyJ = records.reduce(
        (sum, record) => sum + record.state.internalEnergyJ,
        0,
      ),
      cumulativeMassBoundaryKg = records.reduce(
        (sum, record) => sum + record.massInKg - record.massOutKg,
        0,
      ),
      cumulativeEnergyBoundaryJ = records.reduce(
        (sum, record) => sum + record.boundaryEnergyJ,
        0,
      ),
      cumulativeMechanicalWorkJ = records.reduce(
        (sum, record) => sum + record.mechanicalWorkJ,
        0,
      ),
      cumulativeHeatOutJ = records.reduce(
        (sum, record) => sum + record.heatToCarcassJ,
        0,
      );
    return {
      valid: true,
      mediumId: DRY_AIR_MEDIUM_ID,
      chambers: [...this.chambers.values()].map((record) => {
        const absolutePressurePa = this.#pressure(record);
        return {
          partId: record.partId,
          bodyId: record.bodyId,
          controlVolumeKind: record.controlVolumeKind,
          absolutePressurePa,
          gaugePressurePa: absolutePressurePa - record.ambientPressurePa,
          ambientPressurePa: record.ambientPressurePa,
          ambientTemperatureK: record.ambientTemperatureK,
          temperatureK: gasTemperatureK(record.state),
          volumeM3: record.state.volumeM3,
          gasMassKg: record.state.massKg,
          internalEnergyJ: record.state.internalEnergyJ,
          massInKg: record.massInKg,
          massOutKg: record.massOutKg,
          boundaryEnergyJ: record.boundaryEnergyJ,
          mechanicalWorkJ: record.mechanicalWorkJ,
          heatToCarcassJ: record.heatToCarcassJ,
          pressureLimitExceeded:
            absolutePressurePa >
            record.chamber.limits.maximumAbsolutePressurePa,
          underpressure:
            absolutePressurePa - record.ambientPressurePa <
            record.chamber.limits.minimumGaugePressurePa,
          workingPressureMarginPa:
            record.chamber.limits.maximumAbsolutePressurePa -
            absolutePressurePa,
          burst: record.failureMode === "burst-v1",
          failureMode: record.failureMode,
          leakAreaM2: record.leakAreaM2,
          damageImpulseNs: record.damageImpulseNs,
        };
      }),
      devices: structuredClone(this.lastDevices),
      sensors: structuredClone(this.lastSensors),
      transfers: structuredClone(this.lastTransfers),
      components: structuredClone(this.lastComponents),
      lineFailures: structuredClone(this.lastLineFailures),
      newFailureEvents: structuredClone(this.lastFailureEvents),
      failureEvents: structuredClone(this.failureEvents),
      graphRevision: this.compiled.topology?.fingerprint || null,
      runGraphRevision: this.lastGraphRevision,
      transactionId: this.transactionCursor,
      conservation: {
        totalGasMassKg,
        totalInternalEnergyJ,
        massResidualKg:
          totalGasMassKg - (this.initialGasMassKg + cumulativeMassBoundaryKg),
        energyResidualJ:
          totalInternalEnergyJ -
          (this.initialInternalEnergyJ +
            cumulativeEnergyBoundaryJ +
            cumulativeMechanicalWorkJ -
            cumulativeHeatOutJ),
        massToleranceKg: 1e-10,
        energyToleranceJ: 1e-6,
      },
    };
  }

  exportState() {
    return issueInertPlainData({
      version: 1,
      transactionCursor: this.transactionCursor,
      failureEvents: structuredClone(this.failureEvents),
      chambers: [...this.chambers.values()].map((record) => ({
        partId: record.partId,
        state: structuredClone(record.state),
        ambientPressurePa: record.ambientPressurePa,
        ambientTemperatureK: record.ambientTemperatureK,
        massInKg: record.massInKg,
        massOutKg: record.massOutKg,
        boundaryEnergyJ: record.boundaryEnergyJ,
        mechanicalWorkJ: record.mechanicalWorkJ,
        heatToCarcassJ: record.heatToCarcassJ,
        failureMode: record.failureMode,
        leakAreaM2: record.leakAreaM2,
        damageImpulseNs: record.damageImpulseNs,
      })),
      devices: [...this.devices.values()]
        .filter((device) => device.dynamicState)
        .map((device) => ({
          partId: device.partId,
          dynamicState: structuredClone(device.dynamicState),
        })),
    });
  }

  validateState(snapshot) {
    snapshot = requireInertPlainData(snapshot, {
      code: "INVALID_PNEUMATIC_CHECKPOINT_PLAIN_DATA",
      message:
        "Pneumatic checkpoint must be serialized JSON or an exported immutable state",
    });
    if (
      snapshot?.version !== 1 ||
      !checkpointKeysMatch(snapshot, [
        "version",
        "transactionCursor",
        "failureEvents",
        "chambers",
        "devices",
      ]) ||
      !Number.isSafeInteger(snapshot.transactionCursor) ||
      snapshot.transactionCursor < 0 ||
      !Array.isArray(snapshot.chambers) ||
      !Array.isArray(snapshot.devices) ||
      !Array.isArray(snapshot.failureEvents)
    )
      throw new TypeError("Invalid pneumatic network checkpoint");
    const dynamicDevices = [...this.devices.values()].filter(
        (device) => device.dynamicState,
      ),
      chamberIds = new Set(snapshot.chambers.map(({ partId }) => partId)),
      deviceIds = new Set(snapshot.devices.map(({ partId }) => partId)),
      failureEventIds = new Set(
        snapshot.failureEvents.map(({ eventId }) => eventId),
      );
    if (
      chamberIds.size !== this.chambers.size ||
      snapshot.chambers.length !== this.chambers.size ||
      [...this.chambers.keys()].some((partId) => !chamberIds.has(partId)) ||
      deviceIds.size !== dynamicDevices.length ||
      snapshot.devices.length !== dynamicDevices.length ||
      dynamicDevices.some(({ partId }) => !deviceIds.has(partId))
    )
      throw new TypeError("Pneumatic checkpoint identity mismatch");
    if (
      snapshot.failureEvents.length > 128 ||
      failureEventIds.size !== snapshot.failureEvents.length ||
      snapshot.failureEvents.some(
        (event) =>
          !event ||
          !checkpointKeysMatch(event, PNEUMATIC_FAILURE_CHECKPOINT_FIELDS) ||
          typeof event.eventId !== "string" ||
          !PNEUMATIC_CHAMBER_FAILURE_MODES.has(event.mode) ||
          !this.chambers.has(event.chamberPartId) ||
          event.partId !== event.chamberPartId ||
          (event.connectionId !== null &&
            typeof event.connectionId !== "string" &&
            !Number.isSafeInteger(event.connectionId)) ||
          !Number.isFinite(event.absolutePressurePa) ||
          event.absolutePressurePa <= 0 ||
          !Number.isFinite(event.internalEnergyJ) ||
          event.internalEnergyJ <= 0 ||
          !Number.isFinite(event.gasMassKg) ||
          event.gasMassKg <= 0 ||
          !Number.isFinite(event.leakAreaM2) ||
          event.leakAreaM2 < 0 ||
          !Number.isSafeInteger(event.transactionId) ||
          event.transactionId < 0 ||
          event.transactionId > snapshot.transactionCursor ||
          !Number.isFinite(event.timeS) ||
          event.timeS < 0 ||
          !checkpointTreeIsFinite(event.causal),
      )
    )
      throw new TypeError("Invalid pneumatic failure checkpoint history");
    const numericLedgerKeys = [
        "massInKg",
        "massOutKg",
        "boundaryEnergyJ",
        "mechanicalWorkJ",
        "heatToCarcassJ",
        "leakAreaM2",
        "damageImpulseNs",
        "ambientPressurePa",
        "ambientTemperatureK",
      ],
      chamberStages = snapshot.chambers.map((saved) => {
        const values = [
          saved.state?.massKg,
          saved.state?.internalEnergyJ,
          saved.state?.volumeM3,
          ...numericLedgerKeys.map((key) => saved[key]),
        ];
        if (
          !checkpointKeysMatch(saved, PNEUMATIC_CHAMBER_CHECKPOINT_FIELDS) ||
          !checkpointKeysMatch(saved.state, [
            "massKg",
            "internalEnergyJ",
            "volumeM3",
          ]) ||
          values.some((value) => !Number.isFinite(value)) ||
          saved.state.massKg <= 0 ||
          saved.state.internalEnergyJ <= 0 ||
          saved.state.volumeM3 <= 0 ||
          saved.ambientPressurePa <= 0 ||
          saved.ambientTemperatureK <= 0 ||
          saved.leakAreaM2 < 0 ||
          saved.damageImpulseNs < 0 ||
          (saved.failureMode !== null &&
            !PNEUMATIC_CHAMBER_FAILURE_MODES.has(saved.failureMode))
        )
          throw new TypeError("Invalid pneumatic chamber checkpoint state");
        return {
          record: this.chambers.get(saved.partId),
          saved: structuredClone(saved),
        };
      }),
      deviceStages = snapshot.devices.map((saved) => {
        const device = this.devices.get(saved.partId),
          state = saved.dynamicState;
        if (
          !checkpointKeysMatch(saved, ["partId", "dynamicState"]) ||
          !device?.dynamicState ||
          !checkpointKeysMatch(state, Object.keys(device.dynamicState))
        )
          throw new TypeError("Invalid pneumatic device checkpoint state");
        if (
          device.kind === "three-way-valve-v1" &&
          (!Number.isFinite(state.position) || Math.abs(state.position) > 1)
        )
          throw new TypeError("Invalid pneumatic valve checkpoint state");
        if (
          device.kind === "ambient-air-compressor-v1" &&
          (!Number.isFinite(state.spool) ||
            state.spool < 0 ||
            state.spool > 1 ||
            !Number.isFinite(state.motorTemperatureK) ||
            state.motorTemperatureK <= 0 ||
            typeof state.overheated !== "boolean")
        )
          throw new TypeError("Invalid pneumatic compressor checkpoint state");
        return { device, state: structuredClone(state) };
      });
    return {
      chamberStages,
      deviceStages,
      numericLedgerKeys,
      transactionCursor: snapshot.transactionCursor,
      failureEvents: structuredClone(snapshot.failureEvents),
    };
  }

  importState(snapshot) {
    const validated = this.validateState(snapshot),
      { chamberStages, deviceStages, numericLedgerKeys } = validated;
    for (const { record, saved } of chamberStages) {
      record.state = structuredClone(saved.state);
      for (const key of numericLedgerKeys) record[key] = saved[key];
      record.failureMode = saved.failureMode || null;
    }
    for (const { device, state } of deviceStages)
      device.dynamicState = structuredClone(state);
    this.transactionCursor = validated.transactionCursor;
    this.failureEvents = validated.failureEvents;
    this.lastFailureEvents = [];
  }
}
