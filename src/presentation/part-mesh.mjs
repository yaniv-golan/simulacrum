import { createLampView } from './lamp-view.mjs';
import { createSensorDetails } from './part-visuals/sensors.mjs';
import { createElectronicsDetails } from './part-visuals/electronics.mjs';
import { createMechanicalDetails } from './part-visuals/mechanical.mjs';
import * as THREE from 'three';
import { CATALOG } from '../model/catalog.mjs';
import { partPrimitives, shaftSegments, CYLINDER_SEGMENTS } from '../model/geometry.mjs';
import { surfaceRegions } from '../model/surfaces.mjs';
import { createSurfaceMaterial, createPortHardware } from './part-finish.mjs';

// Shared by the workbench, catalogue, help and reusable-assembly previews.
// Owns only presentation resources; all poses remain supplied by the caller.
export function disposePart(mesh) {
  mesh.traverse((object) => {
    if (object.isLight) object.dispose();
    object.geometry?.dispose();
    object.material?.map?.dispose();
    object.material?.dispose();
    // The gear picking proxy sits outside the scene graph and shares the body's
    // material, so only its own geometry is left to release.
    object.userData.pickProxy?.geometry.dispose();
  });
}
function finishPart(mesh, part, definition) {
  const [hx, hy, hz] = definition.halfExtents;
  function detail(geometry, color, position, exposedMaterial) {
    const item = new THREE.Mesh(
      geometry,
      createSurfaceMaterial(exposedMaterial, exposedMaterial ? {} : { paint: color }),
    );
    item.position.fromArray(position);
    mesh.add(item);
    return item;
  }
  function faceLabel(text, width, height, position, background = '#203844', color = '#ffdb9a') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    context.fillStyle = background;
    context.fillRect(0, 0, 512, 256);
    context.fillStyle = color;
    context.font = 'bold 74px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 256, 128);
    const texture = new THREE.CanvasTexture(canvas),
      label = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: texture }),
      );
    label.position.fromArray(position);
    mesh.add(label);
    return label;
  }
  if (part.type === 'powerCell') {
    for (const sign of [-1, 1])
      detail(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 16), sign > 0 ? 0xd38a55 : 0xa4b1bb, [
        sign * hx * 0.6,
        hy + 0.006,
        0,
      ]);
    const socket = CATALOG[part.type].ports.find((port) => port.kind === 'power').position;
    for (const sign of [-1, 1]) {
      const start = new THREE.Vector3(...socket),
        end = new THREE.Vector3(sign * hx * 0.6, hy + 0.012, 0),
        middle = start.clone().lerp(end, 0.5);
      middle.y += 0.018;
      detail(
        new THREE.TubeGeometry(
          new THREE.QuadraticBezierCurve3(start, middle, end),
          12,
          0.003,
          8,
          false,
        ),
        sign > 0 ? 0xcb7250 : 0x253641,
        [0, 0, 0],
      );
    }
  }
  if (part.type === 'wheelHub') {
    detail(new THREE.BoxGeometry(hx * 1.5, 0.001, 0.006), 0xf3bc68, [0, hy + 0.0006, 0]);
    faceLabel('HUB', hx * 1.7, hy * 0.65, [0, 0, hz + 0.0006]);
  }
  const authored = {
    type: part.type,
    halfExtents: definition.halfExtents,
  };
  const sensors = createSensorDetails({ ...authored, parameters: { axis: part.parameters.axis } });
  const mechanical = createMechanicalDetails(authored);
  const electronics = createElectronicsDetails({
    type: part.type,
    halfExtents: definition.halfExtents,
    ports: CATALOG[part.type].ports,
  });
  for (const details of [sensors, mechanical, electronics]) if (details) mesh.add(details);
  for (const region of surfaceRegions(part).filter((r) => r.padHalfSize)) {
    const [hu, hv] = region.padHalfSize,
      rotation = new THREE.Quaternion(...region.rotation),
      origin = new THREE.Vector3(...region.position),
      normal = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
    for (const [u, v] of [
      [-0.75, -0.75],
      [0.75, -0.75],
      [0.75, 0.75],
      [-0.75, 0.75],
    ]) {
      const position = new THREE.Vector3(0, u * hu, v * hv)
        .applyQuaternion(rotation)
        .add(origin)
        .addScaledVector(normal, 0.0006);
      const head = detail(new THREE.CircleGeometry(0.003, 8), 0xb9cbd2, position.toArray());
      head.quaternion
        .copy(rotation)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
    }
  }
  // Rendering and placement admission share the exact authored shaft segment.
  for (const shaft of shaftSegments(part)) {
    const shaftMesh = detail(
      new THREE.CylinderGeometry(0.012, 0.012, shaft.length, 20).rotateZ(-Math.PI / 2),
      0xc5d3d8,
      shaft.position,
      'steel',
    );
    shaftMesh.quaternion.fromArray(shaft.rotation);
  }
  const electricalPorts = CATALOG[part.type].ports.filter((port) =>
    ['power', 'signal'].includes(port.kind),
  );
  for (const port of electricalPorts)
    mesh.add(createPortHardware(port, electricalPorts, definition.halfExtents));
  const outline =
    partPrimitives(part)[0].kind === 'sphere'
      ? new THREE.Mesh(
          mesh.geometry.clone().scale(1.025, 1.025, 1.025),
          new THREE.MeshBasicMaterial({ color: 0xffc778, side: THREE.BackSide }),
        )
      : new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry, 25),
          new THREE.LineBasicMaterial({
            color: 0xffc778,
            depthTest: false,
            transparent: true,
            opacity: 0.95,
          }),
        );
  outline.renderOrder = 10;
  outline.visible = false;
  mesh.add(outline);
  mesh.userData.selectionOutline = outline;
  mesh.traverse((object) => {
    object.userData.partId = part.id;
  });
}
// Cosmetic gear teeth, cut inward from the collider radius (pitchRadius - module, the
// canonical primitive's radius) -- not the gear-geometry root radius, which would be
// pitchRadius - 1.25 * module. Nothing is drawn outside the cylinder that owns collision
// and mass, so a tooth can never imply contact the simulation does not resolve. A tip
// vertex sits on each axis, which keeps the bounding box the canonical solid's.
//
// Depth is the standard full depth of 2.25 modules referenced to the tip circle
// (pitchRadius + module) and applied as a fraction of the drawn radius, so it holds at
// any authored scale: 16.1 mm on the 12T and 19.0 mm on the 24T. Referencing the collider
// radius instead would cancel the fraction into an absolute 2.25 * module, 22.5 mm on
// both, which is 45% of the 12T's radius and draws it as a saw rather than a cog
// (decision of 2026-09-16, from rendered comparisons of both).
export function gearRimProfile(radius, gear) {
  const valley = radius - (radius * 2.25 * gear.module) / (gear.pitchRadius + gear.module);
  const pitch = (2 * Math.PI) / gear.teeth,
    points = [];
  for (let tooth = 0; tooth < gear.teeth; tooth++)
    for (const [fraction, distance] of [
      [-0.16, radius],
      [0, radius],
      [0.16, radius],
      [0.34, valley],
      [0.66, valley],
    ]) {
      const angle = (tooth + fraction) * pitch;
      points.push(new THREE.Vector2(Math.cos(angle) * distance, Math.sin(angle) * distance));
    }
  return points;
}
function gearDiscGeometry(gear, radius, halfLength) {
  // ExtrudeGeometry's default UVs are world coordinates, which would sample the shared
  // roughness grain (0..1 wrapped four times) over a few hundredths of a tile and leave
  // the gear alone with a flat sheen. Map into the same 0..1 range as every other solid.
  const span = 2 * radius,
    depth = 2 * halfLength;
  const uv = (x, y) => new THREE.Vector2(x, y);
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(gearRimProfile(radius, gear)), {
    depth,
    bevelEnabled: false,
    UVGenerator: {
      generateTopUV: (_geometry, vertices, a, b, c) =>
        [a, b, c].map((i) => uv(vertices[i * 3] / span + 0.5, vertices[i * 3 + 1] / span + 0.5)),
      generateSideWallUV: (_geometry, vertices, a, b, c, d) =>
        [a, b, c, d].map((i) =>
          uv(
            Math.atan2(vertices[i * 3 + 1], vertices[i * 3]) / (2 * Math.PI) + 0.5,
            vertices[i * 3 + 2] / depth,
          ),
        ),
    },
  });
  // Extrusion runs on Z; move it onto the body's local X like every other cylinder.
  geometry.translate(0, 0, -halfLength);
  geometry.rotateY(Math.PI / 2);
  return geometry;
}
export function createPartMesh(part) {
  const definition = partPrimitives(part)[0],
    material = part.authoredMaterial[definition.id] ?? definition.materialKey;
  const [halfLength, radius] = definition.halfExtents;
  const gear = definition.kind === 'cylinder' ? CATALOG[part.type].gear : undefined;
  // CylinderGeometry starts on Y. Rotate the geometry, leaving the mesh frame
  // equal to the actual body frame with its cylinder along local X.
  const geometry =
    definition.kind === 'sphere'
      ? new THREE.SphereGeometry(radius, 32, 24)
      : definition.kind === 'cylinder'
        ? gear
          ? gearDiscGeometry(gear, radius, halfLength)
          : new THREE.CylinderGeometry(radius, radius, 2 * halfLength, CYLINDER_SEGMENTS).rotateZ(
              -Math.PI / 2,
            )
        : new THREE.BoxGeometry(...definition.halfExtents.map((value) => value * 2));
  const mesh = new THREE.Mesh(
    geometry,
    createSurfaceMaterial(material, part.type === 'powerCell' ? { paint: 0x294c60 } : {}),
  );
  mesh.userData.partId = part.id;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (part.type === 'camera') {
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.011, 24),
      new THREE.MeshBasicMaterial({ color: 0x142b40 }),
    );
    lens.position.z = 0.0201;
    mesh.add(lens);
  }

  if (definition.kind === 'sphere') {
    const mark = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.01, 32, 16, 0, Math.PI / 5, 0.2, Math.PI - 0.4),
      new THREE.MeshStandardMaterial({ color: 0xffbf69, roughness: 0.7 }),
    );
    const band = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.01, 32, 4, 0, 2 * Math.PI, 1.2, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xffbf69, roughness: 0.7 }),
    );
    band.rotation.z = 0.55;
    mesh.add(mark, band);
    mesh.userData.rotationMark = mark;
  }
  if (definition.kind === 'cylinder' && !gear) {
    // Painted radial marks reveal real rotation. They inherit the body's full
    // transform; there is no separate animation or simulated wheel angle. A gear
    // needs no marks: its own tooth silhouette shows the same rotation.
    for (const side of [-1, 1])
      for (let spoke = 0; spoke < 3; spoke++) {
        const angle = (spoke * 2 * Math.PI) / 3,
          x = side * (halfLength + 0.0002);
        const points = [
          new THREE.Vector3(x, 0, 0),
          new THREE.Vector3(x, Math.cos(angle) * radius * 0.82, Math.sin(angle) * radius * 0.82),
        ];
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: spoke === 0 ? 0xffbf69 : 0xaabac2 }),
        );
        line.userData.partId = part.id;
        mesh.add(line);
      }
  }
  if (gear) {
    // The teeth are cosmetic, so picking stays what it was when the disc was smooth:
    // a click in a valley still selects the gear. The proxy carries the collider's own
    // full radius, is never added to the scene and is never drawn, so it admits no
    // material of its own and cannot change what the player selects as a surface.
    const proxy = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 2 * halfLength, CYLINDER_SEGMENTS).rotateZ(
        -Math.PI / 2,
      ),
      mesh.material,
    );
    mesh.userData.pickProxy = proxy;
    mesh.raycast = (raycaster, intersects) => {
      proxy.matrixWorld.copy(mesh.matrixWorld);
      const hits = [];
      proxy.raycast(raycaster, hits);
      for (const hit of hits) intersects.push({ ...hit, object: mesh });
    };
  }
  if (part.type === 'poweredLamp') {
    const lamp = createLampView();
    mesh.add(lamp.group);
    mesh.userData.lamp = lamp;
  }
  finishPart(mesh, part, definition);
  return mesh;
}
