import * as THREE from "three";
import { compileTestSiteVegetation } from "../model/test-site-vegetation.js";

function grassGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -0.055, 0, 0, 0.055, 0, 0, 0.012, 0.48, 0, 0, 0, -0.055, 0, 0, 0.055, 0,
        0.43, 0.012, -0.04, 0, -0.04, 0.04, 0, 0.04, 0, 0.36, 0,
      ],
      3,
    ),
  );
  geometry.computeVertexNormals();
  return geometry;
}

/** Deterministic sub-collision vegetation with independent distance tiers. */
export function createTestSiteVegetationPresentation({
  parent,
  testSite,
  terrainHeightAt,
}) {
  const root = new THREE.Group(),
    vegetation = compileTestSiteVegetation(testSite),
    grassInstances = vegetation.filter(({ kind }) => kind === "grass-field"),
    shrubInstances = vegetation.filter(({ kind }) => kind === "shrub-field"),
    dummy = new THREE.Object3D();
  root.name = "testSiteVegetationPresentation";
  parent.add(root);

  const grassCapacity = grassInstances.length,
    grass = new THREE.InstancedMesh(
      grassGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x55743a,
        side: THREE.DoubleSide,
      }),
      grassCapacity,
    );
  grassInstances.forEach((instance, index) => {
    const [x, , z] = instance.pose.positionM;
    dummy.position.set(x, terrainHeightAt(x, z) + 0.012, z);
    dummy.rotation.set(0, instance.pose.headingRad, 0);
    dummy.scale.set(
      instance.radiusM / 0.055,
      instance.heightM / 0.48,
      instance.radiusM / 0.055,
    );
    dummy.updateMatrix();
    grass.setMatrixAt(index, dummy.matrix);
  });
  grass.instanceMatrix.needsUpdate = true;
  grass.receiveShadow = true;
  root.add(grass);

  const shrubCapacity = shrubInstances.length,
    shrubs = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.5, 0),
      new THREE.MeshLambertMaterial({
        color: 0x355f35,
      }),
      shrubCapacity,
    );
  shrubInstances.forEach((instance, index) => {
    const [x, , z] = instance.pose.positionM;
    dummy.position.set(x, terrainHeightAt(x, z) + instance.heightM / 2, z);
    dummy.rotation.set(0, instance.pose.headingRad, 0);
    dummy.scale.set(
      instance.radiusM * 2,
      instance.heightM,
      instance.radiusM * 2,
    );
    dummy.updateMatrix();
    shrubs.setMatrixAt(index, dummy.matrix);
  });
  shrubs.instanceMatrix.needsUpdate = true;
  shrubs.castShadow = true;
  shrubs.receiveShadow = true;
  root.add(shrubs);

  let performanceMode = false,
    detailLevel = "near";
  const apply = () => {
    grass.count = performanceMode
      ? 0
      : detailLevel === "near"
        ? grassCapacity
        : detailLevel === "mid"
          ? Math.min(grassCapacity, 1200)
          : 0;
    shrubs.count = performanceMode
      ? 0
      : detailLevel === "near"
        ? shrubCapacity
        : detailLevel === "mid"
          ? Math.min(shrubCapacity, 130)
          : Math.min(shrubCapacity, 54);
    root.visible = grass.count + shrubs.count > 0;
  };
  apply();

  return Object.freeze({
    root,
    setPerformanceMode(enabled) {
      performanceMode = Boolean(enabled);
      apply();
    },
    updateDetailLod(distanceM) {
      const next = distanceM > 140 ? "far" : distanceM > 45 ? "mid" : "near";
      if (next === detailLevel) return;
      detailLevel = next;
      apply();
    },
    snapshot: () => ({
      level: performanceMode ? "performance" : detailLevel,
      grassBladesVisible: grass.count,
      shrubsVisible: shrubs.count,
    }),
  });
}
