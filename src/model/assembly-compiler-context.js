import { geometryDescriptorForPart } from "./geometry-descriptors.js";
import {
  cloneCompiledValue,
  PHYSICAL_CONNECTION_KINDS,
} from "./assembly-compiler-shared.js";
import { portDefinition } from "./ports.js";

export function createCompilationContext(snapshot, catalog) {
  const parts = (snapshot?.parts || []).map((part) => cloneCompiledValue(part)),
    connections = (snapshot?.connections || []).map((connection, index) => ({
      ...cloneCompiledValue(connection),
      id: connection.id ?? `connection-${index}`,
    })),
    geometryByPart = new Map();
  /** @type {Array<
   * {severity: string, code: string, connectionId: any, message: string, partId?: undefined, axisWorldA?: undefined, axisWorldB?: undefined} |
   * {severity: string, code: string, partId: any, message: string, connectionId?: undefined, axisWorldA?: undefined, axisWorldB?: undefined} |
   * {severity: string, code: string, partId: any, connectionId: any, message: string, axisWorldA?: undefined, axisWorldB?: undefined} |
   * {severity: string, code: string, connectionId: any, message: string, axisWorldA: number[], axisWorldB: number[], partId?: undefined}
   * >} */
  const diagnostics = [];
  /** @type {Array<{
   * id: string, partId: any, type: any, mass: any, massProperties: any,
   * position: any[], orientation: number[], geometry: any,
   * capabilities: {
   *   actuator: any,
   *   sensor: {readings: any[]},
   *   controller: {kind: string},
   *   propulsion: {
   *     kind: any, localAxis: any, maximumMassFlowKgS: number,
   *     exitAreaM2: number, gimbalRangeRad: number
   *   },
   *   materialStore: {
   *     kind: string, mediumId: string, capacityKg: number,
   *     initialUsableMassKg: number, densityKgM3: number,
   *     specificAvailableEnergyJkg: number, outletPortId: string,
   *     fillLaw: {kind: string}, storageSolid: any,
   *     storageAxisPart: number[]
   *   } | null,
   *   materialPorts: Array<{
   *     id: string, mediumId: string, direction: string, multiplicity: string
   *   }>,
   *   aerodynamics: {surfaces: any}, aerothermal: any
   * },
   * linearDamping: any, angularDamping: any
   * }>} */
  const bodies = [];
  /** @type {Array<
   * {kind: string, mechanism: any, id: string, sourcePartId: any, sourceConnectionIds: any[], a: any, b: any, anchorA: any[], anchorB: any[], breakForce: number, breakTorque: number} |
   * {id: string, kind: string, sourcePartId: any, sourceConnectionIds: any[], a: any, b: any, anchor: any[], axis: any[], axisWorld: number[], limits: any[], damping: any, maxTorque: any, motorId: any, driveLaw: {kind: string, noLoadSpeedRadPerS: number, direction: number, maximumElectricalPowerW: number}, controlled: boolean, rotorId: any, mechanism: any, breakForce: any, breakTorque: any} |
   * {id: string, kind: string, sourcePartId: any, sourceConnectionIds: any[], a: any, b: any, anchorA: any[], anchorB: any[], axis: number[], axisWorld: number[], coordinateOffsetM: any, limits: any[], mechanism: any, breakForce: any, breakTorque: any} |
   * {id: string, kind: string, sourceConnectionIds: any[], a: any, b: any, axisA: any[], axisB: any[], ratio: number, teethA: any, teethB: any, pitchRadiusA: any, pitchRadiusB: any, stiffness: any, damping: any, breakForce: any, breakTorque: any, sensorId?: undefined, targetId?: undefined, sourcePartId?: undefined, anchor?: undefined, axis?: undefined, limits?: undefined, maxTorque?: undefined, restLength?: undefined} |
   * {id: string, kind: string, sourceConnectionIds: any[], a: any, b: any, sensorId: any, targetId: any, axisA?: undefined, axisB?: undefined, ratio?: undefined, teethA?: undefined, teethB?: undefined, pitchRadiusA?: undefined, pitchRadiusB?: undefined, stiffness?: undefined, damping?: undefined, breakForce?: undefined, breakTorque?: undefined, sourcePartId?: undefined, anchor?: undefined, axis?: undefined, limits?: undefined, maxTorque?: undefined, restLength?: undefined} |
   * {id: string, kind: string, sourcePartId: any, sourceConnectionIds: any[], a: any, b: any, anchor: any[], axis: number[], limits: number[], damping: any, maxTorque: any, axisA?: undefined, axisB?: undefined, ratio?: undefined, teethA?: undefined, teethB?: undefined, pitchRadiusA?: undefined, pitchRadiusB?: undefined, stiffness?: undefined, breakForce?: undefined, breakTorque?: undefined, sensorId?: undefined, targetId?: undefined, restLength?: undefined} |
   * {id: string, kind: string, sourceConnectionIds: any[], a: any, b: any, restLength: number, breakForce: any, breakTorque: any, axisA?: undefined, axisB?: undefined, ratio?: undefined, teethA?: undefined, teethB?: undefined, pitchRadiusA?: undefined, pitchRadiusB?: undefined, stiffness?: undefined, damping?: undefined, sensorId?: undefined, targetId?: undefined, sourcePartId?: undefined, anchor?: undefined, axis?: undefined, limits?: undefined, maxTorque?: undefined} |
   * {id: string, kind: string, sourceConnectionIds: any[], a: any, b: any, breakForce: any, breakTorque: any, axisA?: undefined, axisB?: undefined, ratio?: undefined, teethA?: undefined, teethB?: undefined, pitchRadiusA?: undefined, pitchRadiusB?: undefined, stiffness?: undefined, damping?: undefined, sensorId?: undefined, targetId?: undefined, sourcePartId?: undefined, anchor?: undefined, axis?: undefined, limits?: undefined, maxTorque?: undefined, restLength?: undefined}
   * >} */
  const constraints = [];
  /** @type {{power: any[], signal: any[], resource: any[]}} */
  const networks = { power: [], signal: [], resource: [] };
  /** @type {Array<{id: string, kind: string, sourcePartId: any, constraintId: string, law: any}>} */
  const forceElements = [];
  /** @type {any[]} */
  const flexibleLines = [];
  /** @type {any[]} */
  const actuators = [];
  /** @type {Array<{
   * id: string, kind: string, sourcePartId: any, bodyId: string,
   * regionId: any, localAxleAxis: number[], radiusM: any, widthM: any,
   * shoulderRadiusM: any, semanticRegions: any, tireConstitutiveLaw: any
   * }>} */
  const contactRegions = [];
  const context = {
    snapshot,
    catalog,
    parts,
    connections,
    partById: new Map(parts.map((part) => [part.id, part])),
    diagnostics,
    bodies,
    constraints,
    networks,
    forceElements,
    flexibleLines,
    actuators,
    contactRegions,
    collisionExclusions: /** @type {any[]} */ ([]),
    consumedConnections: new Set(),
    forceElementParts: new Set(),
    flexibleLineParts: new Set(),
    endpointPointMasses: new Map(),
    geometryFor(part) {
      if (!geometryByPart.has(part.id))
        geometryByPart.set(part.id, geometryDescriptorForPart(part, catalog));
      return geometryByPart.get(part.id);
    },
  };
  return context;
}

export function compileConnectionNetworks(context) {
  const { connections, diagnostics, networks, partById } = context;
  for (const connection of connections) {
    const a = partById.get(connection.a),
      b = partById.get(connection.b);
    if (!a || !b) {
      diagnostics.push({
        severity: "error",
        code: "DANGLING_CONNECTION",
        connectionId: connection.id,
        message: `Connection ${connection.id} references a missing part.`,
      });
      continue;
    }
    if (
      PHYSICAL_CONNECTION_KINDS.has(connection.kind) &&
      (!connection.portA || !connection.portB || !connection.capacity)
    ) {
      diagnostics.push({
        severity: "error",
        code: "INCOMPLETE_PHYSICAL_CONNECTION",
        connectionId: connection.id,
        message: `Physical connection ${connection.id} requires explicit ports and capacity.`,
      });
      continue;
    }
    if (connection.kind === "power" || connection.kind === "signal") {
      networks[connection.kind].push({
        id: connection.id,
        a: connection.a,
        b: connection.b,
      });
    } else if (connection.kind === "resource") {
      const portA = portDefinition(a, connection.portA, context.catalog),
        portB = portDefinition(b, connection.portB, context.catalog);
      networks.resource.push({
        id: connection.id,
        a: connection.a,
        b: connection.b,
        portA: connection.portA,
        portB: connection.portB,
        mediumId: portA.mediumId,
        directions: [portA.direction, portB.direction],
      });
    }
  }
}
