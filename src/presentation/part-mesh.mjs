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
          // A builder may supply a simpler silhouette than every crease of its geometry.
          mesh.userData.outlineSource ?? new THREE.EdgesGeometry(mesh.geometry, 25),
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
  // The outline now owns that geometry and disposes it; keep no second reference.
  delete mesh.userData.outlineSource;
  mesh.traverse((object) => {
    object.userData.partId = part.id;
  });
}
// Cosmetic gear body, drawn entirely inward of the canonical solid: nothing reaches past the
// collider radius (pitchRadius - module) or the two faces, so no feature can imply contact the
// simulation does not resolve, and the bounding box, collider, mass and picking are unchanged.
const PRESSURE_ANGLE = Math.PI / 9;
const involute = (angle) => Math.tan(angle) - angle;

// The drawn tooth is a true 20 degree involute of a standard gear with the same tooth count whose
// tip circle is the collider radius: tooth module 2R/(z+2). The gear's own module cannot be used
// directly -- its base circle, pitchRadius * cos 20, lies outside the collider radius, where no
// involute exists. When pitchRadius = z * module / 2 this tooth module is module * (z-2)/(z+2), and
// its full depth, 2.25 of it, equals the depth referenced to pitchRadius + module that was chosen
// from rendered comparisons. Because the tooth module depends on the tooth count, two meshed gears
// of different counts draw slightly different pitches (about 10% for 12 against 24), so a meshed
// pair does not visually interlock; the physics never depended on it.
// Everything is a fraction of the collider radius, a multiple of that tooth module or a fraction of
// the face half-width -- never a constant tied to a tooth count -- so the same drawing serves any
// resolved gear and holds at any authored scale.
//
// Every helper here takes one resolved facts object, {teeth, module, pitchRadius, colliderRadius,
// halfWidth, shaftRadius}, and never reads the catalog: createPartMesh builds it at a single site.
export function gearBodyDimensions(facts) {
  const radius = facts.colliderRadius,
    halfLength = facts.halfWidth;
  const module = (2 * radius) / (facts.teeth + 2),
    root = radius - 2.25 * module,
    rimInner = root - 0.6 * module;
  // The bore clears the widest shaft the gear is drawn around, so an axle visibly passes through.
  // Only a gear too small to keep a rim of 1.5 tooth modules around that bore draws a smaller one,
  // and then still a clear hole: on the coarsest gears the tooth root is no wider than the axle.
  const bore = Math.min(1.1 * facts.shaftRadius, root - 1.5 * module),
    keyway = { width: 0.35 * bore, depth: 0.3 * bore };
  // The hub is whichever is larger: a proportion that looks right on a big gear, or a wall of one
  // tooth module around the keyed bore, which is what holds a small gear's hub together.
  const hub = Math.max(0.38 * radius, bore + keyway.depth + module);
  // The web is recessed in proportion to how wide it is, from nothing at one tooth module to 30% of
  // the face half-width at three, so the look deepens with the gear instead of flipping at one
  // tooth count. A web narrower than that leaves the face flush, which on a coarse gear is also
  // what a real one looks like.
  const web = rimInner - hub,
    recess = 0.3 * halfLength * Math.min(1, Math.max(0, (web - module) / (2 * module)));
  return {
    toothModule: module,
    base: ((facts.teeth * module) / 2) * Math.cos(PRESSURE_ANGLE),
    root,
    rimInner,
    hub,
    bore,
    keyway,
    recessed: recess > 0,
    webHalfWidth: halfLength - recess,
    chamfer: 0.12 * module,
  };
}

// Rounding is interpolated in polar coordinates, never as a Cartesian curve: a Cartesian fillet
// cuts a chord inside the root circle and a Cartesian tip round could not be proved inside R.
// Here every radius is a convex blend of two radii already inside [root, R]. Each fillet segment
// turns under 25 degrees, so neither the crease normals nor the selection outline break a round
// into facets.
const rise = (t) => Math.sin((t * Math.PI) / 2);
const settle = (t) => 1 - Math.cos((t * Math.PI) / 2);
const steps = (segments) => Array.from({ length: segments - 1 }, (_, i) => (i + 1) / segments);

export function gearRimProfile(facts) {
  const radius = facts.colliderRadius;
  const { toothModule: module, base, root } = gearBodyDimensions(facts);
  const teeth = facts.teeth,
    pitch = (2 * Math.PI) / teeth;
  // Half the tooth's angular thickness at radius r, from the tooth centreline.
  const halfAngle = (r) =>
    Math.PI / (2 * teeth) + involute(PRESSURE_ANGLE) - involute(Math.acos(Math.min(1, base / r)));
  const tipRound = 0.2 * module,
    fillet = 0.2 * module,
    shoulder = radius - tipRound,
    // Below the base circle a flank has no involute; it runs radially down to the fillet.
    foot = Math.max(base, root + fillet),
    flank = -halfAngle(foot),
    land = -halfAngle(radius) + tipRound / radius,
    filletStart = flank - fillet / root;
  // One side of a tooth as [radius, angle from the centreline]; negative is the leading side and
  // the trailing side mirrors it. The tip vertex on the centreline sits at exactly R.
  const side = [
    [root, filletStart],
    ...steps(4).map((t) => [
      root + fillet * settle(t),
      filletStart + (flank - filletStart) * rise(t),
    ]),
    [root + fillet, flank],
    // On a fine gear the fillet already ends above the base circle; never emit that point twice.
    ...(foot > root + fillet ? [[foot, flank]] : []),
    ...[1 / 3, 2 / 3, 1].map((t) => {
      const r = foot + (shoulder - foot) * t;
      return [r, -halfAngle(r)];
    }),
    ...steps(3).map((t) => [
      shoulder + tipRound * rise(t),
      -halfAngle(shoulder) + (land + halfAngle(shoulder)) * settle(t),
    ]),
    [radius, land],
  ];
  const points = [];
  for (let tooth = 0; tooth < teeth; tooth++) {
    const centre = tooth * pitch;
    const at = (r, angle) =>
      new THREE.Vector2(Math.cos(centre + angle) * r, Math.sin(centre + angle) * r);
    points.push(at(root, -pitch / 2));
    for (const [r, angle] of side) points.push(at(r, angle));
    points.push(at(radius, 0));
    for (const [r, angle] of [...side].reverse()) points.push(at(r, -angle));
  }
  return points;
}

// Seams between pieces must be sampled identically on both sides, or they leave see-through
// slivers: every circle comes from this one function with the same count and phase.
const RING_SEGMENTS = 48;
const ring = (radius) =>
  Array.from({ length: RING_SEGMENTS }, (_, i) => {
    const angle = (2 * Math.PI * i) / RING_SEGMENTS;
    return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
  });

// The bore with its keyway cut on the +Y side of the extrusion plane. No other piece shares this
// contour, so it need not follow RING_SEGMENTS; its own 32 arc segments keep it round at any size.
function keyedBore({ bore, keyway }) {
  const half = keyway.width / 2,
    edge = Math.asin(half / bore),
    start = Math.PI / 2 + edge,
    end = Math.PI / 2 - edge + 2 * Math.PI,
    points = [];
  for (let i = 0; i <= 32; i++) {
    const angle = start + ((end - start) * i) / 32;
    points.push(new THREE.Vector2(Math.cos(angle) * bore, Math.sin(angle) * bore));
  }
  points.push(
    new THREE.Vector2(half, bore + keyway.depth),
    new THREE.Vector2(-half, bore + keyway.depth),
  );
  return points;
}

// ExtrudeGeometry's default UVs are world coordinates, which would sample the shared roughness
// grain (0..1 wrapped four times) over a few hundredths of a tile and leave the gear alone with a
// flat sheen. Map into the same 0..1 range as every other solid. Around a circular wall the angle
// wraps once; a quad spanning that wrap is unwrapped so it does not smear the whole grain across.
function surfaceUV(span, width) {
  return {
    generateTopUV: (_geometry, vertices, a, b, c) =>
      [a, b, c].map(
        (i) => new THREE.Vector2(vertices[i * 3] / span + 0.5, vertices[i * 3 + 1] / span + 0.5),
      ),
    generateSideWallUV: (_geometry, vertices, a, b, c, d) => {
      const u = [a, b, c, d].map(
        (i) => Math.atan2(vertices[i * 3 + 1], vertices[i * 3]) / (2 * Math.PI) + 0.5,
      );
      const wraps = Math.max(...u) - Math.min(...u) > 0.5;
      return [a, b, c, d].map(
        (i, k) =>
          new THREE.Vector2(wraps && u[k] < 0.5 ? u[k] + 1 : u[k], vertices[i * 3 + 2] / width),
      );
    },
  };
}

// Extrude across the face width, centred. A chamfer is a single inward bevel: with bevelOffset
// equal to minus bevelSize the middle contour is the shape itself and only the faces are inset,
// and the bevel thickness is taken out of the depth so the extent stays exactly +-halfWidth.
function extrudeAcross(shape, halfWidth, chamfer, UVGenerator) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 2 * halfWidth - 2 * chamfer,
    bevelEnabled: chamfer > 0,
    bevelThickness: chamfer,
    bevelSize: chamfer,
    bevelOffset: -chamfer,
    bevelSegments: 1,
    UVGenerator,
  });
  geometry.translate(0, 0, chamfer - halfWidth);
  return geometry;
}

// One non-indexed geometry for the root mesh, so its bounding box, selection outline, picking
// proxy and disposal stay exactly as they are for every other part.
function concatenate(geometries) {
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const arrays = geometries.map((geometry) => geometry.attributes[name].array);
    const array = new Float32Array(arrays.reduce((length, part) => length + part.length, 0));
    arrays.reduce((offset, part) => (array.set(part, offset), offset + part.length), 0);
    merged.setAttribute(
      name,
      new THREE.BufferAttribute(array, geometries[0].attributes[name].itemSize),
    );
  }
  for (const geometry of geometries) geometry.dispose();
  return merged;
}

// ExtrudeGeometry is non-indexed, so its normals are flat per triangle and a sampled involute or
// bore reads as a polyline under the metal reflections. Average normals across a shared vertex
// only where the faces turn less than the crease angle, so curves shade smoothly while chamfers,
// faces and tooth corners stay sharp.
function creaseNormals(geometry, crease = Math.PI / 6) {
  const position = geometry.attributes.position,
    normal = geometry.attributes.normal;
  const faces = [],
    shared = new Map();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    // Same winding as BufferGeometry.computeVertexNormals.
    const face = c.clone().sub(b).cross(a.clone().sub(b)).normalize();
    for (let k = 0; k < 3; k++) {
      faces[i + k] = face;
      const p = [a, b, c][k];
      const key = `${Math.round(p.x * 1e7)},${Math.round(p.y * 1e7)},${Math.round(p.z * 1e7)}`;
      if (!shared.has(key)) shared.set(key, []);
      shared.get(key).push(i + k);
    }
  }
  const limit = Math.cos(crease),
    sum = new THREE.Vector3();
  for (const vertices of shared.values())
    for (const vertex of vertices) {
      sum.set(0, 0, 0);
      for (const other of vertices)
        if (faces[other].dot(faces[vertex]) >= limit) sum.add(faces[other]);
      sum.normalize();
      normal.setXYZ(vertex, sum.x, sum.y, sum.z);
    }
  normal.needsUpdate = true;
}

export function gearBodyGeometry(facts) {
  const radius = facts.colliderRadius,
    halfLength = facts.halfWidth;
  const body = gearBodyDimensions(facts),
    UVGenerator = surfaceUV(2 * radius, 2 * halfLength);
  const teeth = new THREE.Shape(gearRimProfile(facts));
  let pieces;
  if (body.recessed) {
    teeth.holes.push(new THREE.Path(ring(body.rimInner)));
    const web = new THREE.Shape(ring(body.rimInner));
    web.holes.push(new THREE.Path(ring(body.hub)));
    const hub = new THREE.Shape(ring(body.hub));
    hub.holes.push(new THREE.Path(keyedBore(body)));
    pieces = [
      extrudeAcross(teeth, halfLength, body.chamfer, UVGenerator),
      // The web is recessed on both faces; the hub is never raised above the face plane.
      extrudeAcross(web, body.webHalfWidth, 0, UVGenerator),
      extrudeAcross(hub, halfLength, body.chamfer, UVGenerator),
    ];
  } else {
    // A plain face, as on a small machined pinion: one piece, no seams.
    teeth.holes.push(new THREE.Path(keyedBore(body)));
    pieces = [extrudeAcross(teeth, halfLength, body.chamfer, UVGenerator)];
  }
  const geometry = concatenate(pieces);
  creaseNormals(geometry);
  // Extrusion runs on Z; move it onto the body's local X like every other cylinder.
  geometry.rotateY(Math.PI / 2);
  return geometry;
}

// The selection outline of a gear: its tooth silhouette on both face planes. Edge detection over
// the whole body would also trace every hub, web, bore and chamfer crease -- ten times the lines
// of the old disc, and half the cost of building the part -- which says nothing more about which
// part is selected. Same frame as the body: a profile point (px, py) lies at (y = py, z = -px).
export function gearOutlineGeometry(facts) {
  const profile = gearRimProfile(facts),
    positions = [];
  for (const x of [-facts.halfWidth, facts.halfWidth])
    profile.forEach((point, index) => {
      const next = profile[(index + 1) % profile.length];
      positions.push(x, point.y, -point.x, x, next.y, -next.x);
    });
  return new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
}

export function createPartMesh(part) {
  const definition = partPrimitives(part)[0],
    material = part.authoredMaterial[definition.id] ?? definition.materialKey;
  const [halfLength, radius] = definition.halfExtents;
  const catalogGear = definition.kind === 'cylinder' ? CATALOG[part.type].gear : undefined;
  // The only place gear facts are read. The drawing takes them resolved, so a parametric gear
  // swaps this one expression for a model helper and nothing else changes.
  const gear = catalogGear && {
    teeth: catalogGear.teeth,
    module: catalogGear.module,
    pitchRadius: catalogGear.pitchRadius,
    colliderRadius: radius,
    halfWidth: halfLength,
    // The widest shaft a gear is drawn around, so its bore visibly clears one.
    shaftRadius: CATALOG.steelAxle.primitives[0].halfExtents[1],
  };
  // CylinderGeometry starts on Y. Rotate the geometry, leaving the mesh frame
  // equal to the actual body frame with its cylinder along local X.
  const geometry =
    definition.kind === 'sphere'
      ? new THREE.SphereGeometry(radius, 32, 24)
      : definition.kind === 'cylinder'
        ? gear
          ? gearBodyGeometry(gear)
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
    mesh.userData.outlineSource = gearOutlineGeometry(gear);
    // Drawn inward of its canonical solid: on a tooth count not divisible by 4 no tip lands on some
    // axis, so the bounding box may fall short of the solid, though never past it.
    mesh.userData.drawnInward = true;
  }
  if (part.type === 'poweredLamp') {
    const lamp = createLampView();
    mesh.add(lamp.group);
    mesh.userData.lamp = lamp;
  }
  finishPart(mesh, part, definition);
  return mesh;
}
