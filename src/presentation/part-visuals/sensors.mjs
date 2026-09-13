import * as THREE from 'three';

// Printed instrument faces and coatings only: no additional solid, aperture,
// sensor channel, binding or live indicator is introduced by these resources.
const identities = {
  rangeSensor: ['RANGE +Z', 'FIRST HIT', '#60bdcf'],
  contactSensor: ['TOUCH / LOAD', '+Z PAD', '#dfaa65'],
  targetSensor: ['PAIRED CENTRES', 'DISTANCE', '#ad97d8'],
  linearMotionSensor: ['LOCAL VELOCITY', 'm/s', '#78bda1'],
  tiltSensor: ['GRAVITY / RATE', 'LOCAL AXES', '#83b8d9'],
  jointAngleSensor: ['BOUND JOINT', 'ZERO / SIGN', '#d4b775'],
  rotationSensor: ['LOCAL X RATE', 'rad/s', '#8bb8b5'],
  travelSensor: ['BOUND SPRING', 'LENGTH / SPEED', '#cf9875'],
  loadCellSensor: ['ATTACHMENT FORCE', 'A → B / +X', '#87b8cb'],
};

function drawFace(context, type, parameters, side) {
  const [defaultTitle, subtitle, accent] = identities[type];
  const axis = ['X', 'Y', 'Z'][parameters.axis ?? 0] ?? 'X';
  const title = type === 'rotationSensor' ? `LOCAL ${axis} RATE` : defaultTitle;
  const contactFace = type === 'contactSensor' && !side;
  context.fillStyle = contactFace ? '#70634f' : '#26363d';
  context.fillRect(0, 0, 512, 256);
  if (contactFace) {
    context.strokeStyle = '#8d7c60';
    context.lineWidth = 3;
    for (let x = 0; x <= 512; x += 16) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, 256);
      context.stroke();
    }
  }
  // A double printed case border reads as an instrument insert, never a hole.
  context.strokeStyle = '#809397';
  context.lineWidth = 3;
  context.strokeRect(9, 9, 494, 238);
  context.strokeStyle = '#142329';
  context.strokeRect(15, 15, 482, 226);
  context.fillStyle = accent;
  context.fillRect(26, 24, 5, 70);
  context.fillRect(481, 24, 5, 70);
  context.strokeStyle = accent;
  context.fillStyle = accent;
  context.lineWidth = 10;
  const line = (x1, y1, x2, y2) => {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  };
  const circle = (x, y, r, fill = false) => {
    context.beginPath();
    context.arc(x, y, r, 0, 2 * Math.PI);
    fill ? context.fill() : context.stroke();
  };
  const arrow = (x1, y1, x2, y2) => {
    line(x1, y1, x2, y2);
    const a = Math.atan2(y2 - y1, x2 - x1);
    line(x2, y2, x2 - 12 * Math.cos(a - 0.5), y2 - 12 * Math.sin(a - 0.5));
    line(x2, y2, x2 - 12 * Math.cos(a + 0.5), y2 - 12 * Math.sin(a + 0.5));
  };
  // Identity marks sit above the socket bank. The range aperture itself is
  // drawn below, centred at the real ray origin between the front sockets.
  if (type === 'rangeSensor') {
    if (side) {
      line(158, 38, 158, 86);
      arrow(345, 62, 183, 62);
      line(360, 38, 360, 86);
    }
  } else if (type === 'contactSensor' && side) {
    // The side is nonsensing: a printed direction marker points to +Z.
    arrow(335, 63, 178, 63);
    context.font = 'bold 22px sans-serif';
    context.textAlign = 'center';
    context.fillText('FRONT +Z', 256, 29);
  } else if (type === 'targetSensor') {
    // Printed centre marks, not a pair of lenses or a receiver component.
    for (const x of [158, 354]) {
      context.strokeRect(x - 17, 46, 34, 34);
      line(x - 25, 63, x + 25, 63);
      line(x, 38, x, 88);
    }
    line(191, 63, 321, 63);
    line(191, 55, 191, 71);
    line(321, 55, 321, 71);
  } else if (type === 'tiltSensor') {
    // A fixed gravity graticule identifies an inclinometer, not a live reading.
    // No pointer, bubble, compass heading or pose-derived decoration.
    line(150, 62, 232, 27);
    line(232, 27, 314, 62);
    line(314, 62, 232, 97);
    line(232, 97, 150, 62);
    for (const [y, width] of [
      [45, 35],
      [62, 70],
      [79, 35],
    ])
      line(232 - width, y, 232 + width, y);
    arrow(362, 32, 362, 82);
    context.font = 'bold 20px sans-serif';
    context.textAlign = 'center';
    context.fillText('g REF', 420, 63);
  } else if (type === 'linearMotionSensor') {
    // Orthographic local axes for the actual coated plane. On +Z, screen-right
    // is +X; on +X, screen-left is +Z. Circle-dot denotes the outward axis.
    const direction = side ? -1 : 1;
    arrow(256, 81, 256 + direction * 92, 81);
    arrow(256, 81, 256, 29);
    circle(256, 81, 13);
    circle(256, 81, 4, true);
    context.font = 'bold 21px sans-serif';
    context.textAlign = 'center';
    context.fillText(side ? 'Z' : 'X', 256 + direction * 114, 86);
    context.fillText('Y', 256, 24);
    context.fillText(side ? 'X' : 'Z', 286, 91);
  } else if (type === 'jointAngleSensor' || type === 'rotationSensor') {
    // An engraved scale or rate arrow: no moving pointer or decorative shaft.
    context.beginPath();
    context.arc(256, 91, 54, Math.PI, 2 * Math.PI);
    context.stroke();
    if (type === 'jointAngleSensor') {
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI + (i * Math.PI) / 8;
        line(
          256 + 46 * Math.cos(a),
          91 + 46 * Math.sin(a),
          256 + 54 * Math.cos(a),
          91 + 54 * Math.sin(a),
        );
      }
      context.font = 'bold 20px sans-serif';
      context.textAlign = 'center';
      context.fillText('0', 256, 27);
    } else {
      arrow(292, 49, 309, 80);
      context.font = 'bold 27px sans-serif';
      context.textAlign = 'center';
      context.fillText(axis, 256, 80);
    }
  } else if (type === 'loadCellSensor') {
    // On +Z, screen-right is local +X (A to B). On the +X end face,
    // +X points out of the printed plane, so identify B without a tangent arrow.
    if (side) {
      context.strokeRect(225, 32, 62, 62);
      context.font = 'bold 38px sans-serif';
      context.textAlign = 'center';
      context.fillText('B', 256, 77);
    } else {
      line(158, 36, 158, 90);
      line(354, 36, 354, 90);
      arrow(180, 63, 332, 63);
      context.font = 'bold 25px sans-serif';
      context.textAlign = 'center';
      context.fillText('A', 119, 72);
      context.fillText('B', 393, 72);
    }
  } else if (type === 'travelSensor') {
    line(133, 49, 379, 49);
    line(133, 83, 379, 83);
    for (let i = 0; i <= 12; i++) {
      const x = 133 + i * 20.5;
      line(x, 49, x, i % 3 === 0 ? 69 : 59);
    }
    line(133, 75, 133, 91);
    line(379, 75, 379, 91);
  }
  // Unpainted-looking horizontal band leaves the actual socket hardware clear.
  if (!contactFace) {
    context.fillStyle = '#26363d';
    context.fillRect(25, 103, 462, 47);
  }
  if (type === 'rangeSensor' && !side) {
    context.fillStyle = '#131e25';
    circle(256, 128, 29, true);
    context.strokeStyle = '#587985';
    circle(256, 128, 29);
    context.strokeStyle = '#2d4658';
    circle(256, 128, 20);
    context.fillStyle = '#487681';
    context.fillRect(246, 112, 12, 4);
  }
  context.fillStyle = '#e3e9e7';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = 'bold 27px sans-serif';
  context.fillText(title, 256, 177);
  context.fillStyle = accent;
  context.font = '20px sans-serif';
  context.fillText(type === 'loadCellSensor' && side ? 'B / +X OUTWARD' : subtitle, 256, 213);
}

// Broad top identification paint stays legible from front or rear. The symbols
// are flat printed type emblems, not another sensing face or functional hardware.
function drawTop(context, type, halfExtents) {
  const accent = identities[type][2];
  context.fillStyle = '#26363d';
  context.fillRect(0, 0, 512, 512);
  context.fillStyle = accent;
  context.fillRect(0, 0, 512, 64);
  context.fillRect(0, 448, 512, 64);
  context.strokeStyle = '#edf2ed';
  context.fillStyle = '#edf2ed';
  context.lineWidth = 14;
  context.lineJoin = 'round';
  const line = (x1, y1, x2, y2) => {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  };
  for (const x of [96, 416]) {
    if (type === 'rangeSensor') {
      // Diverging brackets identify ranging, with no dark circular lens graphic.
      for (const offset of [-36, 0, 36]) {
        line(x + offset - 16, 188, x + offset + 12, 256);
        line(x + offset + 12, 256, x + offset - 16, 324);
      }
    } else if (type === 'loadCellSensor') {
      // Top screen-right is also +X; paired bearing marks frame a force arrow.
      line(x - 48, 210, x - 48, 302);
      line(x + 48, 210, x + 48, 302);
      line(x - 36, 256, x + 36, 256);
      line(x + 36, 256, x + 16, 236);
      line(x + 36, 256, x + 16, 276);
    } else if (type === 'contactSensor') {
      context.strokeRect(x - 48, 208, 96, 96);
      line(x - 35, 288, x + 35, 224);
    } else if (type === 'targetSensor') {
      context.strokeRect(x - 39, 160, 78, 68);
      context.strokeRect(x - 39, 284, 78, 68);
      line(x, 235, x, 277);
    } else if (type === 'linearMotionSensor') {
      line(x, 292, x, 188);
      line(x, 292, x + 52, 292);
      line(x, 292, x - 43, 241);
      line(x, 188, x - 16, 207);
      line(x, 188, x + 16, 207);
      line(x + 52, 292, x + 35, 276);
      line(x + 52, 292, x + 35, 308);
      line(x - 43, 241, x - 43, 264);
      line(x - 43, 241, x - 20, 241);
    } else if (type === 'tiltSensor') {
      line(x, 172, x + 58, 256);
      line(x + 58, 256, x, 340);
      line(x, 340, x - 58, 256);
      line(x - 58, 256, x, 172);
      line(x - 48, 256, x + 48, 256);
      line(x - 22, 224, x + 22, 224);
      line(x - 22, 288, x + 22, 288);
    } else if (type === 'jointAngleSensor') {
      context.beginPath();
      context.arc(x, 290, 57, Math.PI, 2 * Math.PI);
      context.stroke();
      for (const a of [Math.PI, Math.PI * 1.25, Math.PI * 1.5, Math.PI * 1.75, 2 * Math.PI])
        line(
          x + 45 * Math.cos(a),
          290 + 45 * Math.sin(a),
          x + 70 * Math.cos(a),
          290 + 70 * Math.sin(a),
        );
      line(x - 57, 307, x + 57, 307);
    } else if (type === 'rotationSensor') {
      context.beginPath();
      context.arc(x, 256, 57, 0.15, Math.PI * 1.8);
      context.stroke();
      line(x + 46, 223, x + 12, 219);
      line(x + 46, 223, x + 36, 191);
    } else if (type === 'travelSensor') {
      context.strokeRect(x - 38, 164, 76, 184);
      for (let i = 0; i < 7; i++) {
        const y = 182 + i * 25;
        line(x - 38, y, x + (i % 2 === 0 ? 15 : -5), y);
      }
    }
  }
  // Transparent centre preserves the one actual top electrical socket and body.
  // The hardware radius is at most 7 mm. Preserve the existing minimum ink
  // clearance, but size each texture axis independently for narrow housings.
  const clearSize = [halfExtents[0], halfExtents[2]].map((halfExtent) =>
    Math.max(172, Math.ceil((0.014 / (2 * halfExtent * 0.96)) * 512)),
  );
  context.clearRect(256 - clearSize[0] / 2, 256 - clearSize[1] / 2, ...clearSize);
}

/** Owned static resources. Callers must include parameters.axis in appearance
 * identity and dispose geometry, material and map when replacing this group. */
export function createSensorDetails({ type, halfExtents, parameters = {} }) {
  if (!Object.hasOwn(identities, type)) return null;
  const [hx, hy, hz] = halfExtents,
    group = new THREE.Group();
  for (const face of ['front', 'side', 'top']) {
    const side = face === 'side',
      top = face === 'top';
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = top ? 512 : 256;
    if (top) drawTop(canvas.getContext('2d'), type, halfExtents);
    else drawFace(canvas.getContext('2d'), type, parameters, side);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({
      map,
      transparent: top,
      roughness: 0.72,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const faceScale = type === 'contactSensor' && face === 'front' ? 1 : 0.96;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * (side ? hz : hx) * faceScale, 2 * (top ? hz : hy) * faceScale),
      material,
    );
    if (top) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = hy + 0.0005;
    } else if (side) {
      mesh.rotation.y = Math.PI / 2;
      mesh.position.x = hx + 0.0005;
    } else mesh.position.z = hz + 0.0005;
    mesh.raycast = () => {};
    group.add(mesh);
  }
  return group;
}
