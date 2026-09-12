import * as THREE from 'three';
/** Selected sensor overlay uses completed telemetry only. It never performs a ray query. */
export function createSensorView(scene) {
  const group = new THREE.Group();
  group.name = 'sensor-measurement-preview';
  scene.add(group);
  const arrows = Array.from({ length: 3 }, () => {
    const a = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(),
      0.15,
      0x8de9ed,
    );
    group.add(a);
    return a;
  });
  const geometry = new THREE.BufferGeometry().setFromPoints(
    [
      [-0.025, -0.015, 0.025],
      [0.025, -0.015, 0.025],
      [0.025, 0.015, 0.025],
      [-0.025, 0.015, 0.025],
      [-0.025, -0.015, 0.025],
    ].map((v) => new THREE.Vector3(...v)),
  );
  const pad = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color: 0xffd36b, depthTest: false }),
  );
  group.add(pad);
  return {
    update(frame, id) {
      const node = frame.metadata.blueprint.parts.findIndex((p) => p.id === id),
        part = frame.metadata.blueprint.parts[node],
        body = frame.sensors.bodies[node],
        reading = frame.sensors.readings.find((r) => r.node === node);
      group.visible = Boolean(
        body &&
          part &&
          [
            'rangeSensor',
            'linearMotionSensor',
            'tiltSensor',
            'rotationSensor',
            'contactSensor',
          ].includes(part.type),
      );
      if (!group.visible) return;
      group.position.fromArray(body.position);
      group.quaternion.fromArray(body.rotation);
      pad.visible = part.type === 'contactSensor';
      arrows.forEach((a) => (a.visible = false));
      if (pad.visible) {
        pad.material.color.setHex(reading?.channels.touching?.value === 1 ? 0xffd36b : 0x8de9ed);
        return;
      }
      if (part.type === 'rangeSensor') {
        const a = arrows[0];
        a.visible = true;
        a.position.set(0, 0, 0.025);
        a.setDirection(new THREE.Vector3(0, 0, 1));
        const distance = reading?.channels.distance?.value ?? part.parameters.range;
        a.setLength(
          Math.max(0.005, distance),
          Math.min(0.05, Math.max(0.002, distance / 10)),
          0.02,
        );
        a.setColor(reading?.channels.distance?.status === 'ok' ? 0xffd36b : 0x8de9ed);
      } else {
        const axes = part.type === 'rotationSensor' ? [part.parameters.axis] : [0, 1, 2];
        axes.forEach((axis, i) => {
          const a = arrows[i];
          a.visible = true;
          a.position.set(0, 0, part.type === 'linearMotionSensor' ? 0.025 : 0);
          const v = new THREE.Vector3();
          v.setComponent(axis, 1);
          a.setDirection(v);
          a.setLength(0.15, 0.04, 0.02);
          a.setColor([0xf0a1a1, 0xaee6ad, 0x9acdf2][axis]);
        });
      }
    },
    dispose() {
      scene.remove(group);
      geometry.dispose();
      pad.material.dispose();
      arrows.forEach((a) => {
        a.line.geometry.dispose();
        a.line.material.dispose();
        a.cone.geometry.dispose();
        a.cone.material.dispose();
      });
    },
  };
}
