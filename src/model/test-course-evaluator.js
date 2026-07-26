import { deepFreeze, DomainValidationError } from "./primitives.js";
import {
  testSiteShapeBounds,
  testSiteShapeContains,
} from "./test-site-shapes.js";

function localSegment(shape, start, end) {
  const cosine = Math.cos(shape.rotationRad),
    sine = Math.sin(shape.rotationRad),
    transform = (point) => {
      const dx = point.x - shape.centerM[0],
        dz = point.z - shape.centerM[1];
      return {
        x: dx * cosine + dz * sine,
        z: -dx * sine + dz * cosine,
      };
    };
  return { start: transform(start), end: transform(end) };
}

function rectangleEntry(shape, start, end) {
  const local = localSegment(shape, start, end),
    halfX = shape.sizeM[0] / 2,
    halfZ = shape.sizeM[1] / 2,
    delta = {
      x: local.end.x - local.start.x,
      z: local.end.z - local.start.z,
    };
  let entry = 0,
    exit = 1;
  for (const [origin, direction, half] of [
    [local.start.x, delta.x, halfX],
    [local.start.z, delta.z, halfZ],
  ]) {
    if (Math.abs(direction) < 1e-12) {
      if (Math.abs(origin) > half) return null;
      continue;
    }
    const first = (-half - origin) / direction,
      second = (half - origin) / direction,
      near = Math.min(first, second),
      far = Math.max(first, second);
    entry = Math.max(entry, near);
    exit = Math.min(exit, far);
    if (entry > exit) return null;
  }
  return entry >= 0 && entry <= 1 ? entry : null;
}

function ellipseEntry(shape, start, end) {
  const local = localSegment(shape, start, end),
    radiusX = shape.sizeM[0] / 2,
    radiusZ = shape.sizeM[1] / 2,
    x0 = local.start.x / radiusX,
    z0 = local.start.z / radiusZ,
    dx = (local.end.x - local.start.x) / radiusX,
    dz = (local.end.z - local.start.z) / radiusZ;
  if (x0 * x0 + z0 * z0 <= 1) return 0;
  const a = dx * dx + dz * dz,
    b = 2 * (x0 * dx + z0 * dz),
    c = x0 * x0 + z0 * z0 - 1,
    discriminant = b * b - 4 * a * c;
  if (a < 1e-12 || discriminant < 0) return null;
  const root = Math.sqrt(discriminant),
    entries = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(
      (value) => value >= 0 && value <= 1,
    );
  return entries.length ? Math.min(...entries) : null;
}

export function sweptTestSiteShapeEntry(shape, start, end) {
  if (shape.kind === "rectangle") return rectangleEntry(shape, start, end);
  if (shape.kind === "ellipse") return ellipseEntry(shape, start, end);
  if (testSiteShapeContains(shape, start.x, start.z)) return 0;
  const bounds = testSiteShapeBounds(shape),
    span = Math.max(
      0.25,
      Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 4,
    ),
    distance = Math.hypot(end.x - start.x, end.z - start.z),
    steps = Math.min(512, Math.max(8, Math.ceil(distance / span)));
  let previous = 0;
  for (let index = 1; index <= steps; index++) {
    const amount = index / steps,
      x = start.x + (end.x - start.x) * amount,
      z = start.z + (end.z - start.z) * amount;
    if (!testSiteShapeContains(shape, x, z)) {
      previous = amount;
      continue;
    }
    let outside = previous,
      inside = amount;
    for (let iteration = 0; iteration < 30; iteration++) {
      const middle = (outside + inside) / 2,
        middleX = start.x + (end.x - start.x) * middle,
        middleZ = start.z + (end.z - start.z) * middle;
      if (testSiteShapeContains(shape, middleX, middleZ)) inside = middle;
      else outside = middle;
    }
    return inside;
  }
  return null;
}

function telemetryComponent(telemetry, targetPartId) {
  const components = telemetry?.systems?.testSite?.components || [],
    boundPartId =
      targetPartId ??
      telemetry?.systems?.challengeBinding?.payloadPartId ??
      telemetry?.systems?.challengeBinding?.rootPartId;
  if (boundPartId != null)
    return components.find(({ partIds }) => partIds.includes(boundPartId));
  return [...components].sort(
    (left, right) =>
      right.partIds.length - left.partIds.length ||
      String(left.componentId).localeCompare(String(right.componentId)),
  )[0];
}

function damageCount(telemetry) {
  const structures = telemetry?.systems?.structures;
  return (
    (Number(structures?.failedCount) || 0) +
    (structures?.detachedPartIds?.length || 0)
  );
}

function gateStateMet(requirement, component) {
  return (
    (requirement.grounded === null ||
      component.grounded === requirement.grounded) &&
    component.speedMps >= requirement.minSpeedMps &&
    component.speedMps <= requirement.maxSpeedMps
  );
}

/** Stateful ordered-route evaluator driven only by completed immutable telemetry. */
export class TestCourseRun {
  constructor({ testSite, routeId, targetPartId = null }) {
    const route = testSite.routes.find(({ id }) => id === routeId);
    if (!route)
      throw new DomainValidationError(
        "UNKNOWN_TEST_COURSE",
        `Unknown test-site route ${routeId}`,
      );
    this.siteId = testSite.id;
    this.route = route;
    this.targetPartId = targetPartId;
    this.gates = route.gateIds.map((gateId) =>
      testSite.zones.find(({ id }) => id === gateId),
    );
    this.status = "ready";
    this.passedGateIds = [];
    this.previousPosition = null;
    this.lastTick = -1;
    this.failureReason = null;
    this.current = null;
    this.finishHoldS = 0;
    this.visitedMaterialKeys = new Set();
    this.visitedFluidIds = new Set();
    this.maximumDamage = 0;
    this.pneumaticEvidence = new Map();
  }

  capturePneumaticEvidence(telemetry) {
    const pneumatics = telemetry?.systems?.pneumatics,
      wheelStates = new Map(
        (telemetry?.systems?.mobility?.assemblies || [])
          .flatMap(({ wheelStates = [] }) => wheelStates)
          .map((wheel) => [wheel.partId, wheel]),
      );
    for (const chamber of pneumatics?.chambers || []) {
      if (chamber.controlVolumeKind !== "tire-chamber-v1") continue;
      const wheel = wheelStates.get(chamber.partId) || {},
        current = this.pneumaticEvidence.get(chamber.partId) || {
          partId: chamber.partId,
          firstTransactionId: pneumatics.transactionId,
          minimumGaugePressurePa: Infinity,
          maximumGaugePressurePa: -Infinity,
          maximumDeflectionM: 0,
          maximumRimLoadN: 0,
          maximumRollingLossCoefficient: 0,
          maximumTemperatureK: 0,
          initialGasMassKg: chamber.gasMassKg,
          finalGasMassKg: chamber.gasMassKg,
        };
      current.lastTransactionId = pneumatics.transactionId;
      current.minimumGaugePressurePa = Math.min(
        current.minimumGaugePressurePa,
        Number(chamber.gaugePressurePa) || 0,
      );
      current.maximumGaugePressurePa = Math.max(
        current.maximumGaugePressurePa,
        Number(chamber.gaugePressurePa) || 0,
      );
      current.maximumDeflectionM = Math.max(
        current.maximumDeflectionM,
        Number(wheel.carcassDeflectionM) || 0,
      );
      current.maximumRimLoadN = Math.max(
        current.maximumRimLoadN,
        Number(wheel.rimLoadN) || 0,
      );
      current.maximumRollingLossCoefficient = Math.max(
        current.maximumRollingLossCoefficient,
        Number(wheel.effectiveRollingResistanceCoefficient) || 0,
      );
      current.maximumTemperatureK = Math.max(
        current.maximumTemperatureK,
        Number(chamber.temperatureK) || 0,
      );
      current.finalGasMassKg = Number(chamber.gasMassKg) || 0;
      current.failureMode = chamber.failureMode || null;
      this.pneumaticEvidence.set(chamber.partId, current);
    }
  }

  step(telemetry) {
    const tick = Number(telemetry?.tick);
    if (!Number.isInteger(tick) || tick <= this.lastTick)
      throw new DomainValidationError(
        "NON_MONOTONIC_TEST_COURSE_TICK",
        "Test course telemetry ticks must increase monotonically",
      );
    const elapsedS = this.lastTick < 0 ? 0 : (tick - this.lastTick) / 120;
    this.lastTick = tick;
    if (["complete", "failed"].includes(this.status)) return this.snapshot();
    const component = telemetryComponent(telemetry, this.targetPartId);
    if (!component) {
      this.status = "running";
      this.failureReason = "component-telemetry-unavailable";
      return this.snapshot();
    }
    if (telemetry.systems.testSite.siteId !== this.siteId) {
      this.status = "failed";
      this.failureReason = "site-identity-mismatch";
      return this.snapshot();
    }
    this.status = "running";
    this.failureReason = null;
    this.current = component;
    if (component.materialKey)
      this.visitedMaterialKeys.add(component.materialKey);
    if (component.fluidId) this.visitedFluidIds.add(component.fluidId);
    this.maximumDamage = Math.max(this.maximumDamage, damageCount(telemetry));
    this.capturePneumaticEvidence(telemetry);
    const brokenIntegrity = this.route.requirements.find(
      (requirement) =>
        requirement.kind === "remain-intact" &&
        this.maximumDamage > requirement.maxDamage,
    );
    if (brokenIntegrity) {
      this.status = "failed";
      this.failureReason = "damage-limit-exceeded";
      return this.snapshot();
    }
    const end = component.position,
      start = this.previousPosition || end,
      intersections = this.gates
        .map((gate, index) => ({
          gate,
          index,
          entry: sweptTestSiteShapeEntry(gate.shape, start, end),
        }))
        .filter(({ index, entry }) => {
          const expectedIndex = this.passedGateIds.length;
          return (
            index >= expectedIndex &&
            entry != null &&
            (index === expectedIndex || entry > 1e-9)
          );
        })
        .sort(
          (left, right) => left.entry - right.entry || left.index - right.index,
        );
    for (const intersection of intersections) {
      const expectedIndex = this.passedGateIds.length;
      if (intersection.index !== expectedIndex) {
        this.status = "failed";
        this.failureReason = `out-of-order:${intersection.gate.id}`;
        break;
      }
      const gateRequirement = this.route.requirements.find(
        (requirement) =>
          requirement.kind === "gate-state" &&
          requirement.gateId === intersection.gate.id,
      );
      if (gateRequirement && !gateStateMet(gateRequirement, component)) {
        this.status = "failed";
        this.failureReason = `gate-condition:${intersection.gate.id}`;
        break;
      }
      this.passedGateIds.push(intersection.gate.id);
    }
    this.previousPosition = { x: end.x, z: end.z };
    if (this.passedGateIds.length === this.gates.length) {
      const finishGate = this.gates.at(-1),
        inFinish = testSiteShapeContains(finishGate.shape, end.x, end.z),
        controlled =
          inFinish &&
          (!this.route.finish.grounded || component.grounded) &&
          component.speedMps <= this.route.finish.maxSpeedMps;
      this.finishHoldS = controlled ? this.finishHoldS + elapsedS : 0;
      if (
        this.finishHoldS + 1e-12 >= this.route.finish.holdS &&
        this.requirements().every(({ met }) => met)
      )
        this.status = "complete";
    }
    return this.snapshot();
  }

  snapshot() {
    return deepFreeze({
      siteId: this.siteId,
      routeId: this.route.id,
      status: this.status,
      tick: this.lastTick,
      passedGateIds: [...this.passedGateIds],
      nextGateId: this.gates[this.passedGateIds.length]?.id || null,
      progress:
        this.passedGateIds.length === this.gates.length
          ? Math.min(
              1,
              0.85 +
                (this.route.finish.holdS
                  ? (this.finishHoldS / this.route.finish.holdS) * 0.15
                  : 0.15),
            )
          : this.gates.length
            ? (this.passedGateIds.length / this.gates.length) * 0.85
            : 1,
      finishHoldS: this.finishHoldS,
      failureReason: this.failureReason,
      districtId: this.current?.districtId || null,
      materialKey: this.current?.materialKey || null,
      fluidId: this.current?.fluidId || null,
      grounded: Boolean(this.current?.grounded),
      speedMps: Number(this.current?.speedMps) || 0,
      binding: this.current
        ? {
            componentId: this.current.componentId,
            partIds: [...this.current.partIds].sort(
              (left, right) => left - right,
            ),
            rootPartId: Math.min(...this.current.partIds),
          }
        : null,
      requirements: this.requirements(),
      ...(this.pneumaticEvidence.size
        ? {
            pneumaticEvidence: [...this.pneumaticEvidence.values()]
              .sort((left, right) => left.partId - right.partId)
              .map((record) => ({ ...record })),
          }
        : {}),
    });
  }

  requirements() {
    return this.route.requirements.map((requirement) => ({
      kind: requirement.kind,
      id:
        requirement.gateId ||
        requirement.fluidId ||
        requirement.materialKeys?.join("+") ||
        "remain-intact",
      met:
        requirement.kind === "gate-state"
          ? this.passedGateIds.includes(requirement.gateId)
          : requirement.kind === "visit-materials"
            ? requirement.materialKeys.every((key) =>
                this.visitedMaterialKeys.has(key),
              )
            : requirement.kind === "visit-fluid"
              ? this.visitedFluidIds.has(requirement.fluidId)
              : this.maximumDamage <= requirement.maxDamage,
    }));
  }
}
