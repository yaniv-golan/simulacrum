import * as THREE from 'three';

const FACES = {
  logicController: ['LOGIC', 'RULE / PROGRAM', '#527f8c'],
  learningController: ['LEARNED CONTROL', 'TRAINED MODEL', '#867caa'],
  commandReceiver: ['COMMAND', 'CONTROL INPUT', '#779786'],
  positionRegulator: ['POSITION', 'SPRING TARGET', '#97846b'],
  distributionBus: ['POWER BUS', 'SHARED CONNECTION', '#bda36d'],
  powerCell: ['POWER CELL', 'ELECTRICAL STORAGE', '#bb924f'],
};

// Printed enclosure seams and silkscreen only. No telemetry, new electrical
// endpoints, bores, controls or physical material regions are created here.
export function createElectronicsDetails({ type, halfExtents, ports }) {
  const identity = FACES[type];
  if (!identity) return null;
  const group = new THREE.Group();
  const [hx, hy, hz] = halfExtents;
  for (const face of ['top', 'front', 'back']) {
    const top = face === 'top',
      back = face === 'back';
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 384;
    const ctx = canvas.getContext('2d');
    const [title, subtitle, accent] = identity;
    // The unpainted border exposes the player's selected body material. Inset
    // outlines depict a closed lid joint, never a cutout or attachment surface.
    ctx.clearRect(0, 0, 768, 384);
    ctx.strokeStyle = '#344048';
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 12, 744, 360);
    ctx.fillStyle = top ? '#29373c' : '#35444a';
    ctx.fillRect(26, 26, 716, 332);
    ctx.fillStyle = accent;
    ctx.fillRect(26, 26, 716, top ? 24 : 12);
    ctx.strokeStyle = '#748387';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(36, 350);
    ctx.lineTo(732, 350);
    ctx.stroke();
    const selected = ports.filter((port) => {
      if (top) return Math.abs(port.position[1] - hy) < 1e-8;
      return Math.abs(port.position[2] - (back ? -hz : hz)) < 1e-8;
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e0e5df';
    ctx.font = `600 ${top ? 53 : 37}px sans-serif`;
    ctx.fillText(
      top
        ? title
        : selected.length
          ? selected[0].kind === 'power'
            ? 'POWER'
            : selected[0].direction === 'input'
              ? 'INPUT'
              : 'OUTPUT'
          : title,
      384,
      top ? 123 : 83,
    );
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#bfcac8';
    ctx.fillText(
      top
        ? subtitle
        : selected.length
          ? `${selected.length} ${selected.length === 1 ? 'CONNECTION' : 'CONNECTIONS'}`
          : subtitle,
      384,
      top ? 174 : 125,
    );
    if (top) {
      // A printed circuit trace identifies an electronics enclosure at small
      // size. It is deliberately static and has no lamp/display appearance.
      ctx.strokeStyle = accent;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(168, 277);
      ctx.lineTo(275, 277);
      ctx.lineTo(303, 243);
      ctx.lineTo(465, 243);
      ctx.lineTo(493, 277);
      ctx.lineTo(600, 277);
      ctx.stroke();
    }
    for (const port of selected) {
      // Marks are small ink leaders beside real sockets, never substitute
      // sockets. Mirrored back-face projection preserves authored x positions.
      const u = (1 + ((back ? -1 : 1) * port.position[0]) / hx) * 384;
      const v = top ? (1 + port.position[2] / hz) * 192 : (1 - port.position[1] / hy) * 192;
      ctx.fillStyle = accent;
      ctx.fillRect(u - 2, v + 33, 4, 21);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      roughness: 0.72,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * hx, top ? 2 * hz : 2 * hy), material);
    if (top) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = hy + 0.0004;
    } else {
      mesh.rotation.y = back ? Math.PI : 0;
      mesh.position.z = (back ? -1 : 1) * (hz + 0.0004);
    }
    mesh.name = `electronics-${face}-paint`;
    mesh.raycast = () => {};
    mesh.userData.finishOnly = true;
    mesh.userData.portMarks = selected.map((port) => ({
      id: port.id,
      position: [...port.position],
    }));
    group.add(mesh);
  }
  return group;
}
