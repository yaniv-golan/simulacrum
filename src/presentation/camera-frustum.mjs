import * as THREE from 'three';
import { CAMERA, opticalFrame } from '../model/camera.mjs';
/** Requested one-metre inspection guide in the workshop scene, never the optical scene. */
export function createCameraFrustum(scene) {
  const camera = new THREE.PerspectiveCamera(
    (2 *
      Math.atan((Math.tan((CAMERA.horizontalFov * Math.PI) / 360) * CAMERA.height) / CAMERA.width) *
      180) /
      Math.PI,
    CAMERA.width / CAMERA.height,
    CAMERA.near,
    1,
  );
  const helper = new THREE.CameraHelper(camera);
  helper.visible = false;
  scene.add(helper);
  let optics = null;
  return {
    update(frame, selected, requested, viewing) {
      const node =
        frame?.metadata.blueprint.parts.findIndex(
          (p) => p.id === selected && p.type === 'camera',
        ) ?? -1;
      helper.visible = node >= 0 && selected === requested && !viewing;
      if (!helper.visible) return;
      optics = opticalFrame(frame.physics[node]);
      camera.position.fromArray(optics.position);
      camera.up.fromArray(optics.up);
      camera.lookAt(
        new THREE.Vector3()
          .fromArray(optics.position)
          .add(new THREE.Vector3().fromArray(optics.forward)),
      );
      camera.updateMatrixWorld(true);
      helper.update();
      helper.updateMatrixWorld(true);
    },
    read() {
      const a = helper.geometry.attributes.position;
      return {
        visible: helper.visible,
        position: optics?.position ?? null,
        forward: optics?.forward ?? null,
        points: Array.from({ length: a.count }, (_, i) =>
          new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(helper.matrixWorld).toArray(),
        ),
      };
    },
    dispose() {
      scene.remove(helper);
      helper.dispose();
    },
  };
}
