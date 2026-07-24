import * as THREE from "three";

/** Static authoring preview; run presentation replaces this with solved telemetry. */
export function buildFlexibleLine({ g, accent, visualDescriptor }) {
  const lengthM = visualDescriptor.lengthM,
    diameterM = visualDescriptor.diameterM,
    points = [
      new THREE.Vector3(0, lengthM / 2, 0),
      new THREE.Vector3(0.04 * lengthM, lengthM / 4, 0),
      new THREE.Vector3(0.04 * lengthM, -lengthM / 4, 0),
      new THREE.Vector3(0, -lengthM / 2, 0),
    ],
    curve = new THREE.CatmullRomCurve3(points),
    line = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 24, diameterM / 2, 6, false),
      accent,
    );
  line.name = "Flexible line authoring preview";
  line.userData.flexibleLinePreview = true;
  g.add(line);
  const maximumEdgeCount = 64,
    runtimeGeometry = new THREE.CylinderGeometry(
      diameterM / 2,
      diameterM / 2,
      1,
      6,
      1,
      false,
    ),
    runtimeTube = new THREE.InstancedMesh(
      runtimeGeometry,
      accent,
      maximumEdgeCount,
    );
  runtimeTube.count = 0;
  runtimeTube.name = "Flexible line solved tube";
  runtimeTube.visible = false;
  runtimeTube.frustumCulled = false;
  runtimeTube.userData.flexibleLineRuntime = true;
  runtimeTube.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  g.add(runtimeTube);
  g.userData.flexibleLineVisual = {
    preview: line,
    runtime: runtimeTube,
    maximumEdgeCount,
  };
  return g;
}
