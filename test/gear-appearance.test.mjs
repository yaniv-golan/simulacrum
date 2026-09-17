import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CATALOG } from '../src/model/catalog.mjs';
import { gearFacts } from '../src/model/gear-geometry.mjs';
import { partPrimitives } from '../src/model/geometry.mjs';
import { createPart } from '../src/model/blueprint.mjs';
import { PART_HELP } from '../src/presentation/part-help-content.mjs';
import {
  createPartMesh,
  disposePart,
  gearBodyDimensions,
  gearBodyGeometry,
  gearRimProfile,
} from '../src/presentation/part-mesh.mjs';

// The drawing takes resolved gear facts, never the catalog, so it is exercised across the
// authored range: both ends, and counts that do not divide by 4, which is what decides whether a
// tip lands on every axis.
const TOOTH_COUNTS = [12, 13, 24, 35, 36];
// Counts drawn through createPartMesh, so the drawn body is proved to follow the parameters and
// not a catalog constant. Each divides by 4, so its bounding box fills the canonical solid.
const AUTHORED_COUNTS = [12, 24, 36];
const MODULE = 0.01,
  HALF_WIDTH = 0.01,
  // The widest shaft a gear is drawn around: the steel axle's half-section.
  SHAFT_RADIUS = CATALOG.steelAxle.primitives[0].halfExtents[1];
// A resolved gear as a parametric catalog would give it: pitch radius z*m/2 and the collider one
// module inside it.
function factsFor(teeth, scale = 1) {
  const pitchRadius = (teeth * MODULE) / 2;
  return {
    teeth,
    module: MODULE,
    pitchRadius,
    colliderRadius: (pitchRadius - MODULE) * scale,
    halfWidth: HALF_WIDTH,
    shaftRadius: SHAFT_RADIUS,
  };
}
// An ordinary authored gear, and the facts createPartMesh's one read site builds from it.
function gearPart(teeth) {
  const part = createPart('spurGear', 'gear', [0, 0, 0]);
  if (teeth !== undefined) part.parameters.teeth = teeth;
  return part;
}
function partFacts(part) {
  const resolved = gearFacts(part),
    [halfWidth, colliderRadius] = partPrimitives(part)[0].halfExtents;
  return { ...resolved, colliderRadius, halfWidth, shaftRadius: SHAFT_RADIUS };
}

// The drawn tooth is the standard full depth, 2.25 modules, referenced to the tip circle
// (pitchRadius + module) and applied as a fraction of the drawn radius, so it scales: 16.1 mm
// on the 12T and 19.0 mm on the 24T. Stated from the facts so the test states the rule rather
// than repeating the implementation's arithmetic. The tips themselves sit at the collider radius
// (pitchRadius - module), which is what the profile is cut inward from.
const expectedDepth = (facts) =>
  (facts.colliderRadius * (2.25 * facts.module)) / (facts.pitchRadius + facts.module);

// The drawn tooth is a true 20 degree involute of a standard gear with the same tooth count whose
// tip circle is the collider radius: tooth module 2R/(z+2). Its full depth, 2.25 of that module,
// is the depth above whenever pitchRadius = z*m/2, which the involute test asserts.
const PRESSURE = Math.PI / 9;
const inv = (angle) => Math.tan(angle) - angle;
function involute(facts) {
  const { teeth, colliderRadius: radius } = facts,
    module = (2 * radius) / (teeth + 2);
  const base = ((teeth * module) / 2) * Math.cos(PRESSURE);
  // Half the tooth's angular thickness at radius r, measured from the tooth centreline.
  const halfAngle = (r) => Math.PI / (2 * teeth) + inv(PRESSURE) - inv(Math.acos(base / r));
  return { module, base, root: radius - 2.25 * module, halfAngle };
}
// Signed angle of a profile-plane point from the centreline of the nearest tooth. Tooth k's
// centreline is at k pitches in the profile plane, for every tooth count.
function fromCentreline(point, teeth) {
  const pitch = (2 * Math.PI) / teeth,
    angle = Math.atan2(point.y, point.x);
  const offset = angle - Math.round(angle / pitch) * pitch;
  return Math.atan2(Math.sin(offset), Math.cos(offset));
}
// The body is extruded in the profile plane and turned onto local X: a profile point (px, py)
// lies at mesh (y = py, z = -px). These two convert, so angles in tests stay in the profile plane
// whether or not the tooth count divides by 4.
const toProfile = (y, z) => new THREE.Vector2(-z, y);
const meshRay = (angle, r) =>
  new THREE.Raycaster(
    new THREE.Vector3(0.5, Math.sin(angle) * r, -Math.cos(angle) * r),
    new THREE.Vector3(-1, 0, 0),
  );

/** createPartMesh reaches for a canvas through finishPart's face labels. */
function withDocument(body) {
  const original = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      getContext: () =>
        new Proxy(
          {},
          {
            get: (target, key) => target[key] ?? (() => {}),
            set: (target, key, value) => {
              target[key] = value;
              return true;
            },
          },
        ),
    }),
  };
  try {
    return body();
  } finally {
    globalThis.document = original;
  }
}

// Contiguous runs, because a tooth holds its tip and root lands across several vertices: a
// plateau is one tooth, not several.
function runs(profile, radius) {
  const atRadius = profile.map((point) => Math.abs(point.length() - radius) < 1e-9);
  return atRadius.filter(
    (here, index) => here && !atRadius[(index - 1 + atRadius.length) % atRadius.length],
  ).length;
}

const size = (geometry) => {
  geometry.computeBoundingBox();
  return geometry.boundingBox.getSize(new THREE.Vector3()).toArray();
};

test('gear teeth are cut one per tooth count, tipped at the collider radius', () => {
  // A gear whose tooth count divides by 4 fills its canonical solid exactly: a tip sits on
  // every axis, and the solid is the one the authored parameters resolve to.
  for (const teeth of AUTHORED_COUNTS) {
    const part = gearPart(teeth),
      facts = partFacts(part),
      geometry = gearBodyGeometry(facts);
    const extents = partPrimitives(part)[0].halfExtents.map((value) => 2 * value);
    size(geometry).forEach((value, axis) =>
      assert.ok(Math.abs(value - extents[axis]) < 1e-7, teeth + 'T exact bbox axis ' + axis),
    );
    geometry.dispose();
  }
  for (const teeth of TOOTH_COUNTS) {
    const facts = factsFor(teeth),
      radius = facts.colliderRadius;
    const profile = gearRimProfile(facts);
    const radii = profile.map((point) => point.length());
    const valley = radius - expectedDepth(facts);
    assert.equal(runs(profile, radius), teeth, teeth + 'T tips');
    assert.equal(runs(profile, valley), teeth, teeth + 'T valleys');
    // The invariant that matters for collider, mass and picking: the teeth reach the collider
    // radius exactly and never pass it.
    assert.ok(Math.abs(Math.max(...radii) - radius) < 1e-9, teeth + 'T tip radius');
    assert.ok(Math.abs(Math.min(...radii) - valley) < 1e-9, teeth + 'T valley radius');
    assert.ok(
      profile.some((point) => Math.abs(point.x - radius) < 1e-9 && Math.abs(point.y) < 1e-9),
      teeth + 'T first tooth is centred on the profile axis',
    );
    // The drawn body may fall short of the canonical solid on an axis no tip lands on, which is
    // any tooth count not divisible by 4, but never exceeds it.
    const geometry = gearBodyGeometry(facts),
      extents = [2 * facts.halfWidth, 2 * radius, 2 * radius];
    size(geometry).forEach((value, axis) =>
      assert.ok(value <= extents[axis] + 1e-7, teeth + 'T bbox axis ' + axis),
    );
    geometry.dispose();
  }
  // A 12T and a 24T profile are not interchangeable, and the difference comes from the authored
  // parameters of the same catalog row.
  assert.notEqual(
    gearRimProfile(partFacts(gearPart(12))).length,
    gearRimProfile(partFacts(gearPart(24))).length,
  );
});

test('gear flanks are involute curves with rounded tips, not straight trapezoids', () => {
  for (const teeth of TOOTH_COUNTS) {
    const facts = factsFor(teeth),
      radius = facts.colliderRadius;
    const { module, base, root, halfAngle } = involute(facts);
    // The depth identity: the involute gear's full depth is the approved depth.
    assert.ok(Math.abs(radius - root - expectedDepth(facts)) < 1e-12, teeth + 'T depth');
    const profile = gearRimProfile(facts);
    // Clear of the root fillet and the tip rounding, every flank vertex lies on the involute.
    const band = profile.filter((point) => {
      const r = point.length();
      return r > Math.max(base, root + 0.3 * module) + 1e-9 && r < radius - 0.3 * module;
    });
    assert.ok(band.length >= 4 * teeth, teeth + 'T needs sampled flanks, two per side per tooth');
    for (const point of band)
      assert.ok(
        Math.abs(Math.abs(fromCentreline(point, teeth)) - halfAngle(point.length())) < 1e-9,
        teeth + 'T flank vertex off the involute at r=' + point.length(),
      );
    // A sharp involute tip keeps its land out to halfAngle(R); rounding pulls the land in.
    const pitch = (2 * Math.PI) / teeth;
    for (let tooth = 0; tooth < teeth; tooth++) {
      const land = profile.filter(
        (point) =>
          Math.abs(point.length() - radius) < 1e-9 &&
          Math.abs(Math.round(Math.atan2(point.y, point.x) / pitch) - tooth) % teeth === 0,
      );
      const widest = Math.max(...land.map((point) => Math.abs(fromCentreline(point, teeth))));
      assert.ok(widest < halfAngle(radius) - 1e-4, teeth + 'T tooth ' + tooth + ' tip not rounded');
    }
  }
});

test('gear teeth never leave the collider radius at any scale', () => {
  for (const teeth of TOOTH_COUNTS)
    for (const scale of [0.5, 1, 5]) {
      const facts = factsFor(teeth, scale),
        radius = facts.colliderRadius;
      const profile = gearRimProfile(facts);
      for (const point of profile) {
        assert.ok(point.length() <= radius + 1e-9, teeth + 'T protrudes at scale ' + scale);
        assert.ok(Math.abs(point.x) <= radius + 0.0007, teeth + 'T box bound x at ' + scale);
        assert.ok(Math.abs(point.y) <= radius + 0.0007, teeth + 'T box bound y at ' + scale);
      }
      // The teeth are cut in proportion, so a larger gear is not a smooth disc.
      const depth = radius - Math.min(...profile.map((point) => point.length()));
      assert.ok(Math.abs(depth - expectedDepth(facts)) < 1e-9, teeth + 'T depth at ' + scale);
    }
  // The drawn body, chamfers and all, stays inside the canonical solid: every vertex of the real
  // geometry, not only the 2D profile, since an outward bevel would break this. Positions are
  // Float32 and the transforms round them again, so a correct vertex on the tip circle can read a
  // few 1e-9 over R: compare relatively. An outward bevel protrudes by a whole chamfer.
  const within = (geometry, facts, label) => {
    const position = geometry.attributes.position,
      tolerance = facts.colliderRadius * 1e-6;
    for (let i = 0; i < position.count; i++) {
      const r = Math.hypot(position.getY(i), position.getZ(i));
      assert.ok(r <= facts.colliderRadius + tolerance, label + ' beyond the collider radius: ' + r);
      assert.ok(Math.abs(position.getX(i)) <= facts.halfWidth + tolerance, label + ' past a face');
    }
  };
  for (const teeth of TOOTH_COUNTS) {
    const facts = factsFor(teeth),
      geometry = gearBodyGeometry(facts);
    within(geometry, facts, teeth + 'T body');
    geometry.dispose();
  }
  withDocument(() => {
    for (const teeth of AUTHORED_COUNTS) {
      const part = gearPart(teeth),
        mesh = createPartMesh(part);
      within(mesh.geometry, partFacts(part), teeth + 'T part mesh');
      disposePart(mesh);
    }
  });
});

test('gear bodies have a keyed bore that clears the axle, a hub, a proportionally recessed web and chamfered tooth ends', () => {
  let previous = null;
  for (const teeth of TOOTH_COUNTS) {
    const facts = factsFor(teeth),
      radius = facts.colliderRadius,
      halfLength = facts.halfWidth;
    const mesh = new THREE.Mesh(gearBodyGeometry(facts), new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    const tolerance = radius * 1e-6;
    const near = (actual, expected, label) =>
      assert.ok(
        actual !== null && Math.abs(actual - expected) < tolerance,
        teeth + 'T ' + label + ': ' + actual + ' vs ' + expected,
      );
    const body = gearBodyDimensions(facts);
    // The bore clears the axle so a shaft visibly passes, wherever a rim of material can still
    // surround it; only a gear too small for that draws a smaller bore, and then still a hole.
    const room = body.root - 1.5 * body.toothModule;
    if (1.1 * facts.shaftRadius <= room)
      assert.ok(body.bore > facts.shaftRadius, teeth + 'T bore clears the axle');
    else assert.ok(body.bore >= 0.2 * radius, teeth + 'T too small for the axle: still a hole');
    assert.ok(body.bore + body.keyway.depth < body.root, teeth + 'T keyed bore inside the root');
    if (body.recessed)
      assert.ok(
        body.bore + body.keyway.depth < body.hub &&
          body.hub < body.rimInner &&
          body.rimInner < body.root &&
          body.webHalfWidth < halfLength,
        teeth + 'T keyed bore < hub < rim inner < root',
      );
    else assert.equal(body.webHalfWidth, halfLength, teeth + 'T flush face');
    // The drawn geometry of a plain mesh: there is no picking override here.
    const firstFace = (angle, r) => {
      const hits = [];
      mesh.raycast(meshRay(angle, r), hits);
      return hits.sort((a, b) => a.distance - b.distance)[0]?.point.x ?? null;
    };
    // The keyway is cut on the profile plane's +Y side. Aim at the opposite side, a little off
    // every sampled direction, so no ray runs along a triangulation edge.
    const clear = -Math.PI / 2 + 0.123;
    assert.equal(firstFace(clear, 0.3 * body.bore), null, teeth + 'T bore is open');
    assert.equal(
      firstFace(Math.PI / 2, body.bore + body.keyway.depth / 2),
      null,
      teeth + 'T keyway is cut into the bore',
    );
    const around = body.recessed ? body.hub : body.root;
    near(
      firstFace(clear, (body.bore + around) / 2),
      halfLength,
      'material around the bore at the face',
    );
    if (body.recessed) {
      near(firstFace(clear, (body.hub + body.rimInner) / 2), body.webHalfWidth, 'web face');
      near(firstFace(clear, (body.rimInner + body.root) / 2), halfLength, 'rim at the face plane');
    }
    const position = mesh.geometry.attributes.position,
      normal = mesh.geometry.attributes.normal;
    // The bore's wall faces the axis. A hole wound the wrong way would face outward, be culled
    // and leave the bore invisible.
    let wall = 0;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i),
        z = position.getZ(i),
        r = Math.hypot(y, z);
      if (Math.abs(r - body.bore) > tolerance || Math.abs(normal.getX(i)) > 0.5) continue;
      if (Math.abs(Math.atan2(z, y)) < 0.5) continue; // the keyway's corners, on mesh +Y
      wall += 1;
      const inward = -(normal.getY(i) * y + normal.getZ(i) * z) / r;
      assert.ok(inward > 0.9, teeth + 'T bore wall faces the axis: ' + inward);
    }
    assert.ok(wall > 0, teeth + 'T bore wall must exist');
    // Chamfered tooth ends, from vertex data: on the face plane a tooth tip is drawn inside R;
    // behind the chamfer a tooth reaches R.
    let atFace = 0,
      inside = 0;
    for (let i = 0; i < position.count; i++) {
      const point = toProfile(position.getY(i), position.getZ(i));
      if (Math.abs(fromCentreline(point, teeth)) > 1e-6) continue;
      const r = point.length();
      if (r < body.root) continue;
      if (Math.abs(Math.abs(position.getX(i)) - halfLength) < tolerance)
        atFace = Math.max(atFace, r);
      else inside = Math.max(inside, r);
    }
    assert.ok(atFace > 0 && atFace < radius - body.chamfer / 2, teeth + 'T tooth ends chamfered');
    near(inside, radius, 'tooth reaches R behind the chamfer');
    mesh.geometry.dispose();
    mesh.material.dispose();
    previous = body;
  }
  assert.ok(previous, 'tooth counts were exercised');
  // The part mesh draws exactly this body from the facts its single read site resolves, so the
  // drawn teeth follow the authored count. A drawing keyed to a catalog constant would repeat
  // the default count's vertex total at every authored count.
  withDocument(() => {
    const counts = new Set();
    for (const teeth of AUTHORED_COUNTS) {
      const part = gearPart(teeth),
        mesh = createPartMesh(part),
        expected = gearBodyGeometry(partFacts(part));
      assert.equal(
        mesh.geometry.attributes.position.count,
        expected.attributes.position.count,
        teeth + 'T draws the body built from its resolved facts',
      );
      counts.add(mesh.geometry.attributes.position.count);
      expected.dispose();
      disposePart(mesh);
    }
    assert.equal(counts.size, AUTHORED_COUNTS.length, 'each authored count draws its own body');
  });
});

test('a gear web deepens with its size instead of flipping at one tooth count', () => {
  // Across the whole parametric range the recess never jumps by more than a tenth of the face
  // half-width between neighbouring tooth counts; a threshold rule would jump by its full depth.
  let last = null;
  for (let teeth = 12; teeth <= 36; teeth++) {
    const depth = HALF_WIDTH - gearBodyDimensions(factsFor(teeth)).webHalfWidth;
    if (last !== null)
      assert.ok(
        Math.abs(depth - last) <= 0.1 * HALF_WIDTH + 1e-12,
        teeth - 1 + 'T to ' + teeth + 'T recess jumps by ' + Math.abs(depth - last),
      );
    last = depth;
  }
  // And the largest gears in the range are recessed at all.
  assert.ok(last > 0, '36T web is recessed');
});

test('curved gear walls shade as one surface while faces and chamfers keep their own normal', () => {
  const facts = factsFor(24),
    geometry = gearBodyGeometry(facts),
    body = gearBodyDimensions(facts);
  const position = geometry.attributes.position,
    normal = geometry.attributes.normal,
    tolerance = facts.colliderRadius * 1e-6;
  // Every copy of one bore-wall vertex, one per adjacent triangle, carries the same averaged
  // normal; flat per-triangle normals would differ by the angle between wall segments.
  const copies = new Map();
  let faceNormals = 0;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    if (Math.abs(Math.abs(x) - facts.halfWidth) < tolerance) {
      // On the face plane the flat face meets a 45 degree chamfer. That crease stays sharp: each
      // copy keeps the face's own +-x normal or the chamfer's (|x| about 0.71), never a blend.
      const nx = Math.abs(normal.getX(i));
      assert.ok(Math.abs(nx - 1) < 1e-6 || nx < 0.8, 'face normal blended with a chamfer: ' + nx);
      if (Math.abs(nx - 1) < 1e-6) faceNormals += 1;
    }
    if (Math.abs(Math.hypot(y, z) - body.bore) > tolerance || Math.abs(normal.getX(i)) > 0.3)
      continue;
    if (Math.abs(Math.atan2(z, y)) < 0.5) continue; // the keyway, on mesh +Y
    const key = [x, y, z].map((value) => Math.round(value * 1e7)).join(',');
    if (!copies.has(key)) copies.set(key, []);
    copies.get(key).push(i);
  }
  const shared = [...copies.values()].filter((indices) => indices.length > 1);
  assert.ok(shared.length > 0, 'bore wall vertices are shared by adjacent triangles');
  assert.ok(faceNormals > 0, 'face-plane vertices keep the face normal');
  for (const indices of shared)
    for (const index of indices)
      for (const axis of ['getX', 'getY', 'getZ'])
        assert.ok(
          Math.abs(normal[axis](index) - normal[axis](indices[0])) < 1e-6,
          'bore wall vertex normals differ: not averaged',
        );
  geometry.dispose();
});

test('a selected gear is outlined by its tooth silhouette on both faces, not every crease of its body', () => {
  withDocument(() => {
    for (const teeth of AUTHORED_COUNTS) {
      const part = gearPart(teeth),
        mesh = createPartMesh(part),
        facts = partFacts(part),
        type = teeth + 'T';
      const position = mesh.userData.selectionOutline.geometry.attributes.position;
      // One closed silhouette loop per face: hub, web, bore and chamfer creases would add loops the
      // player does not need to see which part is selected.
      const profile = gearRimProfile(facts);
      assert.equal(position.count / 2, 2 * profile.length, type + ' outline segments');
      // And the silhouette is the drawn body's own profile, on its face planes.
      const key = (point) => `${Math.round(point.x * 1e6)},${Math.round(point.y * 1e6)}`;
      const drawn = new Set(profile.map(key));
      for (let i = 0; i < position.count; i++) {
        assert.ok(
          Math.abs(Math.abs(position.getX(i)) - facts.halfWidth) < facts.colliderRadius * 1e-6,
          type + ' outline vertex off a face plane',
        );
        assert.ok(
          drawn.has(key(toProfile(position.getY(i), position.getZ(i)))),
          type + ' outline vertex is not on the drawn profile',
        );
      }
      assert.equal(mesh.userData.outlineSource, undefined, type + ' builder keeps no source');
      disposePart(mesh);
    }
  });
});

test('only gears are given teeth: other cylinders keep their three rotation marks', () => {
  withDocument(() => {
    const cylinders = Object.keys(CATALOG).filter(
      (type) => CATALOG[type].primitives[0].kind === 'cylinder',
    );
    assert.ok(
      cylinders.some((type) => !CATALOG[type].gear),
      'a non-gear cylinder must exist',
    );
    for (const type of cylinders) {
      const mesh = createPartMesh(createPart(type, 'part', [0, 0, 0]));
      const marks = [];
      mesh.traverse((object) => {
        // Exactly Line: the selection outline is LineSegments and is not a mark.
        if (object.type === 'Line') marks.push(object);
      });
      // Two faces times three marks is the established treatment for a plain cylinder.
      assert.equal(marks.length, CATALOG[type].gear ? 0 : 6, type + ' rotation marks');
      disposePart(mesh);
    }
  });
});

test('a click in a tooth valley, the bore or the recessed web still picks the gear', () => {
  withDocument(() => {
    for (const teeth of AUTHORED_COUNTS) {
      const part = gearPart(teeth),
        mesh = createPartMesh(part),
        type = teeth + 'T';
      mesh.updateMatrixWorld(true);
      const facts = partFacts(part),
        body = gearBodyDimensions(facts);
      // Each ray runs down the axis onto a place the drawn body has cut away -- mid-valley (half a
      // pitch from a tip centre, for any tooth count), the open bore, the web -- so what is under
      // test is the raycast override on the root mesh, not the ray's position.
      const clear = -Math.PI / 2 + 0.123;
      const targets = [
        ['valley', Math.PI / facts.teeth, facts.colliderRadius - expectedDepth(facts) / 2],
        // Off-centre: the proxy's cap is a fan whose centre vertex every triangle shares.
        ['bore', clear, 0.3 * body.bore],
        ['web', clear, (body.hub + body.rimInner) / 2],
      ];
      for (const [label, angle, aim] of targets) {
        // Non-recursive, exactly as every selection path picks: a recursive search would also hit
        // the selection outline and could answer with it instead.
        const hits = meshRay(angle, aim).intersectObjects([mesh], false);
        assert.ok(hits.length > 0, type + ' ' + label + ' must still pick the gear');
        assert.equal(hits[0].object, mesh, type + ' ' + label + ' reports the gear, not a proxy');
        // Picking is the full collider face, exactly as before the body was shaped.
        assert.ok(
          Math.abs(hits[0].point.x - facts.halfWidth) < facts.colliderRadius * 1e-6,
          type + ' ' + label + ' picks at the collider face',
        );
      }
      // The proxy is a picking volume, never a drawn child, and owns only its geometry.
      const proxy = mesh.userData.pickProxy;
      assert.equal(proxy.parent, null, type + ' proxy must never be parented');
      let released = 0;
      proxy.geometry.addEventListener('dispose', () => (released += 1));
      disposePart(mesh);
      assert.equal(released, 1, type + ' proxy geometry must be released exactly once');
    }
  });
});

test('gear help copy calls the teeth cosmetic and explains the gap where the physics touches', () => {
  for (const type of ['spurGear']) {
    const explanation = PART_HELP[type].explanation;
    assert.doesNotMatch(explanation, /Tooth marks show actual body rotation/, type);
    assert.match(explanation, /cosmetic/i, type + ' says the teeth are cosmetic');
    assert.match(
      explanation,
      /inside the .*collision|collision cylinder/i,
      type + ' places them inside',
    );
    assert.match(explanation, /gap/i, type + ' explains the visible gap');
  }
});
