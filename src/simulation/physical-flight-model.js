import * as CANNON from "cannon-es";

const stableId = (value) => `${typeof value}:${String(value)}`;
const compareId = (left, right) =>
  stableId(left).localeCompare(stableId(right), "en");

function addScaled(target, source, scale) {
  target.x += source.x * scale;
  target.y += source.y * scale;
  target.z += source.z * scale;
}

function partRecord(part, descriptor, body) {
  const dimensions = descriptor.geometry.dimensions,
    capabilities = descriptor.capabilities;
  return Object.freeze({
    id: part.id,
    type: part.type,
    body,
    baseStructuralMassKg: Math.max(0.001, Number(descriptor.mass)),
    size: Object.freeze({
      x: Math.max(0.001, Number(dimensions[0] || 1)),
      y: Math.max(0.001, Number(dimensions[1] || 1)),
      z: Math.max(0.001, Number(dimensions[2] || 1)),
    }),
    authoredPosition: Object.freeze([...descriptor.position]),
    authoredOrientation: Object.freeze([...descriptor.orientation]),
    propulsion: capabilities.propulsion
      ? Object.freeze(structuredClone(capabilities.propulsion))
      : null,
    aerodynamics: Object.freeze(structuredClone(capabilities.aerodynamics)),
    aerothermal: Object.freeze(structuredClone(capabilities.aerothermal)),
  });
}

/**
 * Derived physical grouping and mass-weighted kinematics shared by the narrow
 * flight owners. Connectivity comes only from PhysicalAssemblyIndex.
 */
export class PhysicalFlightModel {
  #runtime;
  #physicalAssemblyIndex;
  #revision = null;
  #groups = [];

  constructor({ multibodyRuntime, physicalAssemblyIndex }) {
    this.#runtime = multibodyRuntime;
    this.#physicalAssemblyIndex = physicalAssemblyIndex;
    const descriptorByPart = new Map(
      (multibodyRuntime?.compiled?.bodies || []).map((descriptor) => [
        descriptor.partId,
        descriptor,
      ]),
    );
    this.parts = Object.freeze(
      (multibodyRuntime?.compiled?.parts || [])
        .filter((part) => multibodyRuntime.bodyByPart.has(part.id))
        .map((part) =>
          partRecord(
            part,
            descriptorByPart.get(part.id),
            multibodyRuntime.bodyByPart.get(part.id),
          ),
        ),
    );
    this.partById = new Map(this.parts.map((part) => [part.id, part]));
    this.bodyPositions = Object.freeze(
      this.parts.map((part) => part.body.position),
    );
  }

  get runtime() {
    return this.#runtime;
  }

  active() {
    return Boolean(this.#runtime?.compiled && this.parts.length);
  }

  flightCapable() {
    return this.parts.some(
      (part) => part.propulsion?.kind === "pressure-nozzle-v1",
    );
  }

  refresh(context) {
    const snapshot = this.#physicalAssemblyIndex?.refresh({
      runGraph: context.runGraph,
      constraintEntries: this.#runtime.constraintEntries || [],
      topologyRevision: this.#runtime.topologyRevision || 0,
    });
    if (!snapshot)
      throw new TypeError("PhysicalFlightModel requires PhysicalAssemblyIndex");
    const revision = `${snapshot.compiledIdentity}:${snapshot.graphRevision}:${snapshot.topologyRevision}`;
    if (revision === this.#revision) return this.#groups;
    this.#revision = revision;
    this.#groups = snapshot.components.map((component) => {
      const parts = component.bodyPartIds
          .map((partId) => this.partById.get(partId))
          .filter(Boolean),
        reference = [...parts].sort(
          (left, right) =>
            right.body.mass - left.body.mass || compareId(left.id, right.id),
        )[0];
      return {
        id: component.id,
        identity: component,
        partIds: Object.freeze([...component.bodyPartIds]),
        partIdSet: new Set(component.bodyPartIds),
        parts: Object.freeze(parts),
        referencePart: reference,
        measurement: {
          componentId: component.id,
          group: null,
          mass: 0,
          com: new CANNON.Vec3(),
          velocity: new CANNON.Vec3(),
          root: reference?.body || null,
        },
      };
    });
    for (const group of this.#groups) group.measurement.group = group;
    return this.#groups;
  }

  groups(context) {
    return this.refresh(context);
  }

  measure(group) {
    const measurement = group.measurement;
    let mass = 0;
    measurement.com.set(0, 0, 0);
    measurement.velocity.set(0, 0, 0);
    for (const part of group.parts) {
      const bodyMass = Math.max(0.001, part.body.mass);
      mass += bodyMass;
      addScaled(measurement.com, part.body.position, bodyMass);
      addScaled(measurement.velocity, part.body.velocity, bodyMass);
    }
    if (mass > 0) {
      measurement.com.scale(1 / mass, measurement.com);
      measurement.velocity.scale(1 / mass, measurement.velocity);
    }
    measurement.mass = mass;
    measurement.root = group.referencePart?.body || null;
    return measurement;
  }

  primary(context) {
    let best = null,
      bestFlightCapable = false;
    for (const group of this.refresh(context)) {
      const measurement = this.measure(group),
        flightCapable = group.parts.some((part) => part.propulsion);
      if (
        !best ||
        (flightCapable && !bestFlightCapable) ||
        (flightCapable === bestFlightCapable && measurement.mass > best.mass)
      ) {
        best = measurement;
        bestFlightCapable = flightCapable;
      }
    }
    return best;
  }

  dispose() {
    this.#runtime = null;
    this.#physicalAssemblyIndex = null;
    this.#groups.length = 0;
    this.partById.clear();
  }
}
