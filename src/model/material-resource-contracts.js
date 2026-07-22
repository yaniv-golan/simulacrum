import { componentMaterialStore } from "./component-contracts.js";
import { TYPES } from "./component-catalog.js";
import { geometryDescriptorForPart } from "./geometry-descriptors.js";
import { materialMedium } from "./material-media.js";
import { DomainValidationError, immutableClone } from "./primitives.js";
import { portDefinition } from "./ports.js";

const finitePositive = (value, field, partId) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    throw new DomainValidationError(
      "INVALID_MATERIAL_STORE_CONTRACT",
      `${field} must be finite and positive`,
      { path: ["parts", partId, "config", field] },
    );
  return number;
};

function configured(part, descriptor, field) {
  return part.config?.[descriptor[field]];
}

function normalizedAxis(value, partId) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((entry) => !Number.isFinite(entry))
  )
    throw new DomainValidationError(
      "INVALID_MATERIAL_STORAGE_AXIS",
      "Material storage axis must contain three finite values",
      { path: ["parts", partId, "materialStore", "storageAxisPart"] },
    );
  const length = Math.hypot(...value);
  if (length <= 1e-9)
    throw new DomainValidationError(
      "INVALID_MATERIAL_STORAGE_AXIS",
      "Material storage axis must have non-zero length",
      { path: ["parts", partId, "materialStore", "storageAxisPart"] },
    );
  return value.map((entry) => entry / length);
}

function storageBox(descriptor, geometry, storageAxisPart, partId) {
  const dimensions = geometry?.dimensions,
    sizeFraction = descriptor.storageSolid?.sizeFraction,
    centerFraction = descriptor.storageSolid?.centerFraction;
  if (
    !Array.isArray(dimensions) ||
    dimensions.length !== 3 ||
    !Array.isArray(sizeFraction) ||
    sizeFraction.length !== 3 ||
    !Array.isArray(centerFraction) ||
    centerFraction.length !== 3
  )
    throw new DomainValidationError(
      "INVALID_MATERIAL_STORAGE_SOLID",
      "Material storage requires three-dimensional interior size and center fractions",
      { path: ["parts", partId, "materialStore", "storageSolid"] },
    );
  for (let axis = 0; axis < 3; axis++) {
    if (
      !Number.isFinite(dimensions[axis]) ||
      dimensions[axis] <= 0 ||
      !Number.isFinite(sizeFraction[axis]) ||
      sizeFraction[axis] <= 0 ||
      sizeFraction[axis] > 1 ||
      !Number.isFinite(centerFraction[axis]) ||
      Math.abs(centerFraction[axis]) + sizeFraction[axis] / 2 > 0.5 + 1e-12
    )
      throw new DomainValidationError(
        "INVALID_MATERIAL_STORAGE_SOLID",
        "Material storage box must remain inside the compiled body bounds",
        {
          path: ["parts", partId, "materialStore", "storageSolid", axis],
        },
      );
  }
  const axisIndex = storageAxisPart.findIndex(
    (value) => Math.abs(value) > 1 - 1e-9,
  );
  if (
    axisIndex < 0 ||
    storageAxisPart.some(
      (value, index) => index !== axisIndex && Math.abs(value) > 1e-9,
    )
  )
    throw new DomainValidationError(
      "UNSUPPORTED_MATERIAL_STORAGE_AXIS",
      "Positive-displacement bladder v1 requires a principal part axis",
      { path: ["parts", partId, "materialStore", "storageAxisPart"] },
    );
  const fullSizeM = dimensions.map(
      (dimension, axis) => dimension * sizeFraction[axis],
    ),
    centerPartM = dimensions.map(
      (dimension, axis) => dimension * centerFraction[axis],
    ),
    outletAnchorPartM = [...centerPartM];
  outletAnchorPartM[axisIndex] +=
    storageAxisPart[axisIndex] * fullSizeM[axisIndex] * 0.5;
  return {
    kind: "box-v1",
    fullSizeM,
    centerPartM,
    outletAnchorPartM,
  };
}

function validateOutletAlignment(
  geometry,
  outletPortId,
  storageAxisPart,
  storageSolid,
  partId,
) {
  const portPosition = geometry?.portFrames?.[outletPortId]?.position;
  if (!Array.isArray(portPosition) || portPosition.length !== 3)
    throw new DomainValidationError(
      "INVALID_MATERIAL_STORE_OUTLET_GEOMETRY",
      "Material store outlet requires a compiled physical port frame",
      { path: ["parts", partId, "materialStore", "outletPortId"] },
    );
  const offset = portPosition.map(
      (value, axis) => value - storageSolid.outletAnchorPartM[axis],
    ),
    axialDistanceM = offset.reduce(
      (sum, value, axis) => sum + value * storageAxisPart[axis],
      0,
    ),
    lateralDistanceM = Math.hypot(
      ...offset.map(
        (value, axis) => value - axialDistanceM * storageAxisPart[axis],
      ),
    );
  if (axialDistanceM < -1e-9 || lateralDistanceM > 1e-9)
    throw new DomainValidationError(
      "MISALIGNED_MATERIAL_STORE_OUTLET",
      "Material outlet must lie outward from the bladder anchor on its storage axis",
      {
        path: ["parts", partId, "materialStore", "outletPortId"],
        details: { axialDistanceM, lateralDistanceM },
      },
    );
}

/** Resolves and validates the model-owned finite material-store contract. */
export function materialStoreContract(part, catalog = TYPES, geometry = null) {
  const descriptor = componentMaterialStore(part, catalog);
  if (!descriptor) return null;
  if (
    descriptor.kind !== "propellant-store-v1" ||
    descriptor.fillLaw?.kind !== "positive-displacement-bladder-v1" ||
    descriptor.storageSolid?.kind !== "box-v1"
  )
    throw new DomainValidationError(
      "UNKNOWN_MATERIAL_STORE_CONTRACT",
      "Material stores require the supported propellant-store, box, and bladder contracts",
      { path: ["parts", part.id, "materialStore"] },
    );
  const mediumId = String(descriptor.mediumId || ""),
    outletPortId = String(descriptor.outletPortId || ""),
    port = portDefinition(part, outletPortId, catalog);
  if (
    !/^[A-Za-z0-9._:-]{1,64}$/.test(mediumId) ||
    port.kind !== "resource" ||
    port.behavior !== "material-resource" ||
    port.direction !== "source" ||
    port.mediumId !== mediumId
  )
    throw new DomainValidationError(
      "INVALID_MATERIAL_STORE_OUTLET",
      "Material store outlet must be a same-medium resource source port",
      { path: ["parts", part.id, "materialStore", "outletPortId"] },
    );
  const medium = materialMedium(mediumId),
    capacityKg = finitePositive(
      configured(part, descriptor, "capacityField"),
      descriptor.capacityField,
      part.id,
    ),
    initialUsableMassKg = Number(
      configured(part, descriptor, "initialMassField"),
    ),
    densityKgM3 = medium.densityKgM3,
    specificAvailableEnergyJkg = medium.specificAvailableEnergyJkg;
  if (
    !Number.isFinite(initialUsableMassKg) ||
    initialUsableMassKg < 0 ||
    initialUsableMassKg > capacityKg
  )
    throw new DomainValidationError(
      "INVALID_INITIAL_MATERIAL_MASS",
      "Initial usable material mass must be finite and within capacity",
      {
        path: ["parts", part.id, "config", descriptor.initialMassField],
        details: { initialUsableMassKg, capacityKg },
      },
    );
  const compiledGeometry = geometry || geometryDescriptorForPart(part, catalog),
    storageAxisPart = normalizedAxis(descriptor.storageAxisPart, part.id),
    storageSolid = storageBox(
      descriptor,
      compiledGeometry,
      storageAxisPart,
      part.id,
    ),
    availableVolumeM3 = storageSolid.fullSizeM.reduce(
      (volume, dimension) => volume * Number(dimension),
      1,
    ),
    requiredVolumeM3 = capacityKg / densityKgM3;
  if (requiredVolumeM3 > availableVolumeM3 + 1e-12)
    throw new DomainValidationError(
      "MATERIAL_CAPACITY_EXCEEDS_STORAGE_VOLUME",
      "Material capacity and density exceed the authored storage solid",
      {
        path: ["parts", part.id, "config", descriptor.capacityField],
        details: { requiredVolumeM3, availableVolumeM3 },
      },
    );
  validateOutletAlignment(
    compiledGeometry,
    outletPortId,
    storageAxisPart,
    storageSolid,
    part.id,
  );
  return immutableClone({
    kind: descriptor.kind,
    mediumId,
    outletPortId,
    capacityKg,
    initialUsableMassKg,
    densityKgM3,
    specificAvailableEnergyJkg,
    storageSolid,
    storageAxisPart,
    fillLaw: { kind: descriptor.fillLaw.kind },
  });
}
