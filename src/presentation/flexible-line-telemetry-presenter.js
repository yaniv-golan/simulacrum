import * as THREE from "three";

/** Mirrors completed flexible-line centerlines into bounded instanced tubes. */
export function createFlexibleLineTelemetryPresenter({ parts }) {
  const start = new THREE.Vector3(),
    end = new THREE.Vector3(),
    delta = new THREE.Vector3(),
    midpoint = new THREE.Vector3(),
    scale = new THREE.Vector3(1, 1, 1),
    rotation = new THREE.Quaternion(),
    matrix = new THREE.Matrix4(),
    yAxis = new THREE.Vector3(0, 1, 0);
  return function presentFlexibleLines(telemetry) {
    for (const record of telemetry?.lines || []) {
      const part = parts().find(
          (candidate) => candidate.id === record.sourcePartId,
        ),
        visual = part?.mesh?.userData?.flexibleLineVisual;
      if (!part || !visual) continue;
      part.flexibleLineTelemetry = record;
      visual.preview.visible = false;
      visual.runtime.visible = true;
      part.mesh.updateWorldMatrix(true, false);
      const active = new Set(record.activeEdgeIds || []);
      let segment = 0;
      for (let index = 0; index < record.centerline.length - 1; index++) {
        if (!active.has(`flex:${record.sourcePartId}:edge:${index}`)) continue;
        const from = record.centerline[index],
          to = record.centerline[index + 1];
        start.set(from.x, from.y, from.z);
        end.set(to.x, to.y, to.z);
        part.mesh.worldToLocal(start);
        part.mesh.worldToLocal(end);
        delta.subVectors(end, start);
        const lengthM = delta.length();
        if (lengthM <= 1e-9) continue;
        midpoint.addVectors(start, end).multiplyScalar(0.5);
        rotation.setFromUnitVectors(yAxis, delta.multiplyScalar(1 / lengthM));
        scale.set(1, lengthM, 1);
        matrix.compose(midpoint, rotation, scale);
        visual.runtime.setMatrixAt(segment++, matrix);
      }
      visual.runtime.count = segment;
      visual.runtime.instanceMatrix.needsUpdate = true;
    }
  };
}
