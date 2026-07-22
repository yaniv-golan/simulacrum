import { physicalComponents } from "./physical-components.js";
import { finiteOr as finite } from "./finite-or.js";

const PHYSICAL_CONNECTION_KINDS = new Set(["mechanical", "mesh"]);
const NON_FAILURE_TRANSITION_MODES = new Set(["commanded-release"]);

/** Immutable, source-addressed failure evidence shared by reports and replay. */
export class FailureEvent {
  /** @param {any} data */
  constructor(data) {
    const value = structuredClone(data);
    /** @type {string} */
    this.id = value.id;
    /** @type {number} */
    this.timeS = value.timeS;
    /** @type {string|number|null} */
    this.connectionId = value.connectionId;
    /** @type {{id:number|null,type:string,name:string}} */
    this.partA = value.partA;
    /** @type {{id:number|null,type:string,name:string}} */
    this.partB = value.partB;
    /** @type {string} */
    this.mode = value.mode;
    /** @type {string} */
    this.reason = value.reason;
    /** @type {{peakN:number,ratedN:number,peakTorqueNm:number,ratedTorqueNm:number,utilization:number}} */
    this.load = value.load;
    /** @type {number} */
    this.fatigue = value.fatigue;
    /** @type {{x:number,y:number,z:number}} */
    this.worldPosition = value.worldPosition;
    /** @type {number[]} */
    this.detachedPartIds = value.detachedPartIds;
    /** @type {{surface:string|null,inWater:boolean,impactSpeedMps:number,mach:number,temperatureC:number}} */
    this.environment = value.environment;
    /** @type {number} */
    this.severity = value.severity;
    /** @type {Array<{label:string,value:string}>} */
    this.causalChain = value.causalChain;
    /** @type {{channelId:string,unit:string,frame:string,tick:number,validity:string,provenance:Record<string,unknown>}} */
    this.evidence = value.evidence;
    immutable(this);
  }
}

function immutable(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const entry of Object.values(value)) immutable(entry);
  return Object.freeze(value);
}

function connectionKey(connection) {
  return String(
    connection?.id ??
      `${Math.min(connection?.a || 0, connection?.b || 0)}:${Math.max(connection?.a || 0, connection?.b || 0)}`,
  );
}

function bodyIndexes(snapshot) {
  const bodies = snapshot?.bodies?.bodies || [],
    byId = new Map(bodies.map((body) => [body.bodyId, body])),
    byPart = new Map(
      (snapshot?.bodies?.bodyByPart || []).map((entry) => [
        entry.partId,
        byId.get(entry.bodyId),
      ]),
    );
  return { byPart };
}

function partPosition(parts, id) {
  const value = parts.find((part) => part.id === id)?.pos;
  if (Array.isArray(value)) return value.map((entry) => finite(entry));
  return [finite(value?.x), finite(value?.y), finite(value?.z)];
}

function positionForPart(snapshot, partId) {
  const body = bodyIndexes(snapshot).byPart.get(partId);
  return body
    ? [
        finite(body.pose?.position?.x),
        finite(body.pose?.position?.y),
        finite(body.pose?.position?.z),
      ]
    : partPosition(snapshot?.run?.parts || [], partId);
}

function componentScope(components, partIds) {
  const ids = new Set(partIds),
    matches = components.filter((component) =>
      component.partIds.some((id) => ids.has(id)),
    );
  return {
    partIds: [...new Set(matches.flatMap((component) => component.partIds))],
    detachedPartIds: [
      ...new Set(matches.flatMap((component) => component.detachedPartIds)),
    ],
    inWater: matches.some((component) => component.inWater),
  };
}

function evidenceForParts(snapshot, partIds) {
  const ids = new Set(partIds),
    { byPart } = bodyIndexes(snapshot),
    bodies = [...new Set([...ids].map((id) => byPart.get(id)).filter(Boolean))],
    contacts = bodies.flatMap((body) => body.contacts || []),
    impactSpeedMps = Math.max(
      0,
      ...contacts.map((contact) =>
        Math.hypot(
          finite(contact.relativeVelocity?.x),
          finite(contact.relativeVelocity?.y),
          finite(contact.relativeVelocity?.z),
        ),
      ),
    ),
    relevantThermal = (snapshot?.systems?.aerothermal?.parts || []).filter(
      (part) => ids.has(part.id),
    ),
    temperatureC = Math.max(
      0,
      ...relevantThermal.map(
        (part) => finite(part.thermal?.temperatureK) - 273.15,
      ),
    ),
    aerodynamicForceN = relevantThermal.reduce(
      (sum, part) => sum + finite(part.aerodynamicForceN),
      0,
    );
  return {
    surface: contacts.find((contact) => contact.surface)?.surface || null,
    impactSpeedMps,
    aerodynamicForceN,
    temperatureC,
  };
}

function failureMode(connection, evidence = {}) {
  const reason = String(
      connection.failureMode || connection.failureReason || "",
    ).toLowerCase(),
    impact = finite(evidence.impactSpeedMps),
    aero = finite(evidence.aerodynamicForceN);
  if (/ablat|thermal|heat|temperature/.test(reason)) return "thermal";
  if (/aero|pressure|drag/.test(reason)) return "aerodynamic";
  if (/collision|impact|landing/.test(reason)) return "impact";
  if (finite(connection.fatigue) >= 0.99) return "fatigue";
  if (impact > 0) return "impact";
  if (aero > 0) return "aerodynamic";
  return "overload";
}

function causalChain(mode, event) {
  const modeCause = {
      impact: "Contact impulse entered the assembly",
      aerodynamic: "Air load acted on the exposed structure",
      thermal: "Material temperature or ablation crossed its limit",
      fatigue: "Repeated cyclic loading accumulated damage",
      overload: "Applied force exceeded the attachment capacity",
    }[mode],
    chain = [{ label: "INITIATING EVENT", value: modeCause }];
  if (event.load.peakN > 0)
    chain.push({
      label: "PEAK TRANSMITTED LOAD",
      value: `${Math.round(event.load.peakN).toLocaleString()} N`,
    });
  if (event.load.ratedN > 0)
    chain.push({
      label: "ATTACHMENT CAPACITY",
      value: `${Math.round(event.load.ratedN).toLocaleString()} N · ${(event.load.utilization * 100).toFixed(0)}% utilized`,
    });
  chain.push({
    label: "FIRST PHYSICAL FAILURE",
    value: event.connectionId
      ? `${event.partA.name} ↔ ${event.partB.name}`
      : event.reason,
  });
  if (event.detachedPartIds.length)
    chain.push({
      label: "CONSEQUENCE",
      value: `${event.detachedPartIds.length} component${event.detachedPartIds.length === 1 ? "" : "s"} detached`,
    });
  return chain;
}

function extractionEvidence(snapshot, options) {
  return immutable({
    channelId: String(options.channelId),
    unit: String(options.unit),
    frame: String(options.frame),
    tick: Math.max(
      0,
      Math.round(finite(snapshot?.tick, finite(snapshot?.time) * 120)),
    ),
    validity: String(options.validity),
    provenance: structuredClone(options.provenance || {}),
  });
}

export function observeConnectionFailure(connection, previousPeak = 0) {
  if (!PHYSICAL_CONNECTION_KINDS.has(connection?.kind)) return null;
  if (NON_FAILURE_TRANSITION_MODES.has(connection.failureMode)) return null;
  const rating = Math.max(0, finite(connection.capacity?.ultimateForceN, 0)),
    torqueRating = Math.max(
      0,
      finite(connection.capacity?.ultimateTorqueNm, 0),
    ),
    witnessed = Math.max(
      finite(connection.peakLoadN),
      finite(connection.lastLoadN),
      finite(connection.stress) * rating,
    );
  return Object.freeze({
    key: connectionKey(connection),
    rating,
    torqueRating,
    peak: Math.max(previousPeak, witnessed),
    failed: Boolean(connection.failed),
  });
}

function displayPart(catalog, part, id) {
  const type = part?.type || "unknown";
  return {
    id,
    type,
    name: catalog[type]?.name || part?.type || `Part ${id}`,
  };
}

function connectionLoad(connection, observation) {
  const peakTorqueNm = Math.max(
      finite(connection.peakTorqueNm),
      finite(connection.lastTorqueNm),
    ),
    forceUtilization = observation.rating
      ? observation.peak / observation.rating
      : 0,
    torqueUtilization = observation.torqueRating
      ? peakTorqueNm / observation.torqueRating
      : 0;
  return {
    peakN: observation.peak,
    ratedN: observation.rating,
    peakTorqueNm,
    ratedTorqueNm: observation.torqueRating,
    utilization: Math.max(forceUtilization, torqueUtilization),
  };
}

function connectionExtractionContext(snapshot, connection, catalog) {
  const parts = snapshot?.run?.parts || [],
    byId = new Map(parts.map((part) => [part.id, part])),
    components = physicalComponents(snapshot),
    aPosition = positionForPart(snapshot, connection.a),
    bPosition = positionForPart(snapshot, connection.b),
    component = componentScope(components, [connection.a, connection.b]),
    evidence = evidenceForParts(
      snapshot,
      component.partIds.length
        ? component.partIds
        : [connection.a, connection.b],
    );
  return {
    partA: displayPart(catalog, byId.get(connection.a), connection.a),
    partB: displayPart(catalog, byId.get(connection.b), connection.b),
    component,
    evidence,
    worldPosition: {
      x: (aPosition[0] + bPosition[0]) / 2,
      y: (aPosition[1] + bPosition[1]) / 2,
      z: (aPosition[2] + bPosition[2]) / 2,
    },
  };
}

function connectionReason(connection, mode) {
  if (connection.failureReason) return connection.failureReason;
  return mode === "fatigue"
    ? "Accumulated fatigue reached the attachment limit"
    : "Physical attachment capacity was exceeded";
}

export function extractConnectionFailure({
  snapshot,
  connection,
  catalog,
  observation,
  eventId,
}) {
  if (!observation?.failed) return null;
  const context = connectionExtractionContext(snapshot, connection, catalog),
    mode = failureMode(connection, context.evidence),
    event = {
      id: eventId,
      timeS: finite(snapshot?.time),
      connectionId: connection.id ?? null,
      partA: context.partA,
      partB: context.partB,
      mode,
      reason: connectionReason(connection, mode),
      load: connectionLoad(connection, observation),
      fatigue: finite(connection.fatigue),
      worldPosition: context.worldPosition,
      detachedPartIds: [...context.component.detachedPartIds],
      environment: {
        surface: context.evidence.surface,
        inWater: context.component.inWater,
        impactSpeedMps: context.evidence.impactSpeedMps,
        mach: 0,
        temperatureC: context.evidence.temperatureC,
      },
      evidence: extractionEvidence(snapshot, {
        channelId: `connection:${observation.key}`,
        unit: "N,Nm,ratio",
        frame: "world-and-attachment",
        validity: "valid",
        provenance: {
          connectionId: connection.id ?? null,
          partIds: [connection.a, connection.b],
        },
      }),
    };
  event.severity = Math.max(
    1,
    event.load.utilization,
    event.detachedPartIds.length / 2,
  );
  event.causalChain = causalChain(mode, event);
  return new FailureEvent(event);
}

function isThermalFailure(thermalPart) {
  if (!thermalPart) return false;
  if (thermalPart.thermal?.consumed) return true;
  return (
    !thermalPart.thermal?.ablative &&
    finite(thermalPart.thermal?.health, 1) <= 0
  );
}

function thermalExtractionContext(snapshot, thermalPart, catalog) {
  const parts = snapshot?.run?.parts || [],
    failedPart = parts.find((part) => part.id === thermalPart.id),
    components = physicalComponents(snapshot),
    component = componentScope(components, [thermalPart.id]),
    evidence = evidenceForParts(
      snapshot,
      component.partIds.length ? component.partIds : [thermalPart.id],
    ),
    position = positionForPart(snapshot, thermalPart.id),
    type = failedPart?.type || "thermal";
  return {
    component,
    evidence,
    position,
    partA: {
      id: thermalPart.id,
      type,
      name: catalog[type]?.name || failedPart?.type || "Thermal protection",
    },
  };
}

export function extractThermalFailure({
  snapshot,
  thermalPart,
  catalog,
  eventId,
}) {
  if (!isThermalFailure(thermalPart)) return null;
  const context = thermalExtractionContext(snapshot, thermalPart, catalog),
    event = {
      id: eventId,
      timeS: finite(snapshot?.time),
      connectionId: null,
      partA: context.partA,
      partB: { id: null, type: "environment", name: "Atmosphere" },
      mode: "thermal",
      reason:
        "A non-ablative component exceeded its material temperature limit",
      load: {
        peakN: 0,
        ratedN: 0,
        peakTorqueNm: 0,
        ratedTorqueNm: 0,
        utilization: 0,
      },
      fatigue: 0,
      worldPosition: {
        x: context.position[0],
        y: context.position[1],
        z: context.position[2],
      },
      detachedPartIds: [...context.component.detachedPartIds],
      environment: {
        surface: context.evidence.surface,
        inWater: context.component.inWater,
        impactSpeedMps: context.evidence.impactSpeedMps,
        mach: 0,
        temperatureC: context.evidence.temperatureC,
      },
      severity: Math.max(1, context.evidence.temperatureC / 800),
      evidence: extractionEvidence(snapshot, {
        channelId: `aerothermal:${thermalPart.id}`,
        unit: "K,ratio",
        frame: "part-material",
        validity: "valid",
        provenance: { partId: thermalPart.id },
      }),
    };
  event.causalChain = causalChain("thermal", event);
  return new FailureEvent(event);
}

/** @param {FailureEvent[]} events @param {any} snapshot @returns {FailureEvent[]} */
export function enrichFailureDetachments(events, snapshot) {
  if (!(snapshot?.run?.parts || []).some((part) => part.detached))
    return events;
  const components = physicalComponents(snapshot);
  return events.map((stored) => {
    const event = structuredClone(stored),
      component = componentScope(components, [event.partA.id, event.partB.id]),
      eventDetached = component.detachedPartIds;
    event.detachedPartIds = [
      ...new Set([...event.detachedPartIds, ...eventDetached]),
    ];
    event.severity = Math.max(event.severity, event.detachedPartIds.length / 2);
    event.causalChain = causalChain(event.mode, event);
    return new FailureEvent(event);
  });
}
