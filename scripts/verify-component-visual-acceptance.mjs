import * as THREE from "three";
import { assert } from "./lib/assert.mjs";
import { TYPES } from "../src/model/component-catalog.js";
import {
  physicalFeaturePrimitivesForDescriptor,
  resolveComponentGeometryContractForType,
} from "../src/model/component-geometry-contract.js";
import { componentMesh } from "../src/presentation/component-mesh-factory.js";
import { disposeObject3D } from "../src/presentation/render-resources.js";

const ACCEPTANCE = Object.freeze({
  beam: { kinds: ["rounded-box-v1"], identity: "rounded-structural" },
  plate: { kinds: ["rounded-box-v1"], identity: "rounded-structural" },
  cargo: { kinds: ["rounded-box-v1"], decorations: ["recessed-fasteners-v1"] },
  nosecone: { kinds: ["cone-v1"] },
  heatshield: { kinds: ["cone-v1"] },
  fin: { kinds: ["extruded-profile-v1"] },
  axle: { kinds: ["cylinder-v1"] },
  bearing: { kinds: ["rounded-box-v1", "cylinder-v1"], minimumBodies: 2 },
  gear12: { kinds: ["spur-gear-v1"] },
  gear24: { kinds: ["spur-gear-v1"] },
  motor: { kinds: ["cylinder-v1"], features: ["shaft"] },
  rotor: { kinds: ["cylinder-v1", "extruded-profile-v1"], minimumBodies: 3 },
  hinge: { kinds: ["cylinder-v1"], minimumBodies: 3 },
  lever: { kinds: ["rounded-box-v1"], decorations: ["recessed-fasteners-v1"] },
  spring: { kinds: ["helical-spring-v1"], deformed: true },
  rope: { kinds: [], runtime: true },
  damper: { kinds: ["cylinder-v1"], minimumBodies: 6, deformed: true },
  "release-coupler": {
    kinds: ["cylinder-v1", "rounded-box-v1"],
    minimumBodies: 3,
  },
  "linear-guide": {
    kinds: ["box-v1", "rounded-box-v1"],
    minimumBodies: 5,
    deformed: true,
  },
  "linear-actuator": {
    kinds: ["cylinder-v1"],
    minimumBodies: 6,
    deformed: true,
  },
  wheel: {
    kinds: ["rounded-wheel-v1", "cylinder-v1"],
    minimumBodies: 2,
    decorations: ["tire-sidewall-rings-v1"],
  },
  aircompressor: {
    kinds: ["rounded-box-v1"],
    decorations: ["recessed-fasteners-v1", "enclosure-vents-v1"],
  },
  airreservoir: { kinds: ["cylinder-v1"], features: ["air-neck"] },
  pneumaticvalve: {
    kinds: ["rounded-box-v1"],
    decorations: ["recessed-fasteners-v1", "enclosure-vents-v1"],
  },
  computer: {
    kinds: ["rounded-box-v1"],
    decorations: ["recessed-fasteners-v1", "enclosure-vents-v1"],
  },
  receiver: {
    kinds: ["cylinder-v1"],
    decorations: ["equipment-label-plate-v1"],
  },
  navsensor: {
    kinds: ["cylinder-v1"],
    decorations: ["equipment-label-plate-v1"],
  },
  rangesensor: { kinds: ["cylinder-v1"], minimumBodies: 2 },
  sensor: { kinds: ["cylinder-v1"] },
  imu: { kinds: ["cylinder-v1"], decorations: ["equipment-label-plate-v1"] },
  contactsensor: { kinds: ["cylinder-v1"] },
  thermalprobe: { kinds: ["cylinder-v1"] },
  pressureprobe: { kinds: ["cylinder-v1", "cone-v1"], minimumBodies: 2 },
  tirepressureprobe: {
    kinds: ["rounded-box-v1"],
    decorations: ["recessed-fasteners-v1", "equipment-label-plate-v1"],
  },
  loadcell: { kinds: ["cylinder-v1"] },
  gyro: { kinds: ["cylinder-v1"] },
  battery: {
    kinds: ["rounded-box-v1"],
    decorations: ["recessed-fasteners-v1", "enclosure-vents-v1"],
  },
  propellanttank: {
    kinds: ["capsule-v1"],
    features: ["propellant-outlet-neck"],
  },
  powerbus: {
    kinds: ["rounded-box-v1"],
    decorations: ["recessed-fasteners-v1", "enclosure-vents-v1"],
  },
  headlight: {
    kinds: ["cylinder-v1"],
    decorations: ["headlight-emitter-v1"],
  },
  rocket: { kinds: ["cylinder-v1", "cone-v1"], minimumBodies: 2 },
  rcs: { kinds: ["rounded-box-v1", "cone-v1"], minimumBodies: 2 },
});

assert.deepEqual(
  Object.keys(ACCEPTANCE).sort(),
  Object.keys(TYPES).sort(),
  "the visual acceptance matrix is not 42/42 current catalog types",
);

for (const [type, requirement] of Object.entries(ACCEPTANCE)) {
  const descriptor = resolveComponentGeometryContractForType(type),
    bodyKinds = new Set(
      descriptor.bodyPrimitives.map(({ geometry }) => geometry.kind),
    );
  for (const kind of requirement.kinds)
    assert.ok(bodyKinds.has(kind), `${type} lost required ${kind} identity`);
  assert.ok(
    descriptor.bodyPrimitives.length >= (requirement.minimumBodies || 1) ||
      requirement.runtime,
    `${type} lost required physical subparts`,
  );
  assert.equal(
    descriptor.geometryClass === "mechanism-deformed-v1",
    Boolean(requirement.deformed),
    `${type} deformation classification disagrees with acceptance`,
  );
  assert.equal(
    descriptor.geometryClass === "runtime-flexible-v1",
    Boolean(requirement.runtime),
    `${type} runtime geometry classification disagrees with acceptance`,
  );
  for (const featureId of requirement.features || [])
    assert.ok(
      descriptor.physicalFeatures.some(({ id }) => id === featureId),
      `${type} lost canonical physical feature ${featureId}`,
    );

  const projectedFeatures = physicalFeaturePrimitivesForDescriptor(descriptor);
  assert.equal(projectedFeatures.length, descriptor.physicalFeatures.length);
  for (const [index, feature] of descriptor.physicalFeatures.entries()) {
    const port = descriptor.portFrames[feature.anchor.portId];
    assert.ok(port, `${type}.${feature.id} lost its authored port frame`);
    const orientation = new THREE.Quaternion().fromArray(
        port.framePart.orientation,
      ),
      axis = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation),
      expected = new THREE.Vector3()
        .fromArray(port.framePart.positionM)
        .add(
          new THREE.Vector3()
            .fromArray(feature.anchor.offsetM)
            .applyQuaternion(orientation),
        ),
      axialOffset =
        feature.axialOrigin === "center-v1"
          ? 0
          : feature.axialOrigin === "start-v1"
            ? feature.dimensions.lengthM / 2
            : -feature.dimensions.lengthM / 2,
      projected = projectedFeatures[index];
    expected.addScaledVector(axis, axialOffset);
    assert.ok(
      new THREE.Vector3()
        .fromArray(projected.framePart.positionM)
        .distanceTo(expected) <= 1e-12,
      `${type}.${feature.id} drifted from authored port ${feature.anchor.portId}`,
    );
    assert.ok(
      new THREE.Quaternion()
        .fromArray(projected.framePart.orientation)
        .angleTo(orientation) <= 1e-12,
      `${type}.${feature.id} orientation drifted from its authored port frame`,
    );
  }

  const mesh = componentMesh(type, undefined, "hero"),
    decorationIds = new Set();
  mesh.updateMatrixWorld(true);
  assert.deepEqual(
    mesh.userData.geometryProjection.featurePrimitives,
    projectedFeatures,
    `${type} presentation disagrees with canonical feature projection`,
  );
  mesh.traverse((object) => {
    if (!object.userData?.decorativeGeometry) return;
    const recipeId = object.userData.decorationRecipeId;
    assert.ok(recipeId, `${type} has unclassified decoration`);
    assert.ok(
      Number.isInteger(object.userData.decorationMaximumInstanceCount) &&
        object.userData.decorationMaximumInstanceCount > 0,
      `${type}.${recipeId} has no bounded maximum count`,
    );
    assert.ok(
      object.userData.decorationAnchorSource,
      `${type}.${recipeId} has no canonical anchor source`,
    );
    decorationIds.add(recipeId);
    if (!object.geometry || !descriptor.bodyBoundsPartM) return;
    const bounds = new THREE.Box3().setFromObject(object),
      canonical = descriptor.bodyBoundsPartM,
      toleranceM = 1e-5;
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(
        bounds.min.getComponent(axis) >= canonical.minimumM[axis] - toleranceM,
        `${type}.${recipeId} escaped canonical minimum bounds`,
      );
      assert.ok(
        bounds.max.getComponent(axis) <= canonical.maximumM[axis] + toleranceM,
        `${type}.${recipeId} escaped canonical maximum bounds`,
      );
    }
  });
  for (const recipeId of requirement.decorations || [])
    assert.ok(
      decorationIds.has(recipeId),
      `${type} lost classified decoration ${recipeId}`,
    );
  const canonicalMaterialNames = [];
  mesh.traverse((object) => {
    if (object.userData?.canonicalGeometryRole === "body")
      canonicalMaterialNames.push(object.material?.name || "");
  });
  canonicalMaterialNames.sort();
  assert.ok(
    canonicalMaterialNames.every(Boolean),
    `${type} has a body primitive without a canonical material identity`,
  );
  for (const tier of ["standard", "performance"]) {
    const tierMesh = componentMesh(type, undefined, tier),
      tierBodyIds = [],
      tierMaterialNames = [];
    tierMesh.traverse((object) => {
      if (object.userData?.canonicalGeometryRole !== "body") return;
      tierBodyIds.push(object.userData.canonicalGeometryId);
      tierMaterialNames.push(object.material?.name || "");
    });
    assert.deepEqual(
      tierBodyIds.sort(),
      descriptor.bodyPrimitives.map(({ id }) => id).sort(),
      `${type}.${tier} lost canonical body identity`,
    );
    assert.deepEqual(
      tierMaterialNames.sort(),
      canonicalMaterialNames,
      `${type}.${tier} changed canonical material identity`,
    );
    disposeObject3D(tierMesh, { remove: false });
  }
  disposeObject3D(mesh, { remove: false });
}

const wheelDescriptor = resolveComponentGeometryContractForType("wheel"),
  wheelTire = wheelDescriptor.bodyPrimitives.find(
    ({ id }) => id === "tire-envelope",
  ),
  wheelRim = wheelDescriptor.bodyPrimitives.find(({ id }) => id === "rim");
assert.ok(
  wheelRim.geometry.axialLengthM > wheelTire.geometry.widthM,
  "wheel rim remained buried behind the tire sidewall",
);
assert.ok(
  wheelRim.geometry.axialLengthM / 2 - wheelTire.geometry.widthM / 2 <= 0.025,
  "wheel rim protrusion exceeded the bounded physical flange allowance",
);
const springDescriptor = resolveComponentGeometryContractForType("spring");
assert.deepEqual(springDescriptor.provenance.approximations, [
  { id: "housing", approximationOf: "spring-coil" },
]);

console.log(
  `component visual acceptance passed (${Object.keys(ACCEPTANCE).length}/42 catalog types)`,
);
