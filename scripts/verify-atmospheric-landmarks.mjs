import * as THREE from "three";
import { assert } from "./lib/assert.mjs";
import {
  CLOUD_LAYERS,
  createAtmosphericLandmarks,
} from "../src/presentation/atmospheric-landmarks.js";

const scene = new THREE.Scene(),
  created = createAtmosphericLandmarks({ scene, fieldSurfaceY: -0.65 });
assert.equal(created.root.parent, scene);
assert.equal(created.root.name, "physicalHorizonEnvironment");
assert.equal(created.clouds.length, CLOUD_LAYERS.length);

const mountain = created.root.children.find((child) =>
  child.name.startsWith("Distant mountain"),
);
assert.ok(mountain?.isMesh, "physical mountain heightfield is missing");
const positions = mountain.geometry.attributes.position;
let minimumRadius = Infinity,
  maximumRadius = 0,
  maximumElevation = -Infinity;
for (let index = 0; index < positions.count; index++) {
  const x = positions.getX(index),
    y = positions.getY(index),
    z = positions.getZ(index),
    radius = Math.hypot(x, z);
  minimumRadius = Math.min(minimumRadius, radius);
  maximumRadius = Math.max(maximumRadius, radius);
  maximumElevation = Math.max(maximumElevation, y);
}
assert.ok(Math.abs(minimumRadius - 9_000) < 1);
assert.ok(Math.abs(maximumRadius - 23_000) < 1);
assert.ok(maximumElevation > 2_000);

const matrix = new THREE.Matrix4(),
  position = new THREE.Vector3(),
  rotation = new THREE.Quaternion(),
  scale = new THREE.Vector3();
for (const [index, cloud] of created.clouds.entries()) {
  const layer = CLOUD_LAYERS[index];
  assert.equal(cloud.layer, layer);
  assert.equal(cloud.mesh.count, layer.clusters * layer.lobes);
  for (let instance = 0; instance < cloud.mesh.count; instance++) {
    cloud.mesh.getMatrixAt(instance, matrix);
    matrix.decompose(position, rotation, scale);
    assert.ok(position.y >= layer.baseM && position.y <= layer.topM);
    assert.ok(scale.x > 0 && scale.y > 0 && scale.z > 0);
  }
}

const second = createAtmosphericLandmarks({
  scene: new THREE.Scene(),
  fieldSurfaceY: -0.65,
});
assert.notEqual(
  second.clouds,
  created.clouds,
  "cloud state leaked between scenes",
);
assert.deepEqual(
  second.clouds.map((cloud) => cloud.mesh.count),
  created.clouds.map((cloud) => cloud.mesh.count),
);

console.log(
  `atmospheric landmarks passed (${created.clouds.length} cloud layers, ${Math.round(minimumRadius / 1000)}-${Math.round(maximumRadius / 1000)} km terrain)`,
);
