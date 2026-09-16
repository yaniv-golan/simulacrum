import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CATALOG } from '../src/model/catalog.mjs';
import { createPart } from '../src/model/blueprint.mjs';
import { PART_HELP } from '../src/presentation/part-help-content.mjs';
import { createPartMesh, disposePart, gearRimProfile } from '../src/presentation/part-mesh.mjs';

const gearTypes = ['gear12', 'gear24'];
// The drawn tooth is the standard full depth, 2.25 modules, referenced to the tip circle
// (pitchRadius + module) and applied as a fraction of the drawn radius, so it scales: 16.1 mm
// on the 12T and 19.0 mm on the 24T. Stated from catalog facts so the test states the rule
// rather than repeating the implementation's arithmetic. The tips themselves sit at the
// collider radius (pitchRadius - module), which is what the profile is cut inward from.
const expectedDepth = (gear, radius) =>
  (radius * (2.25 * gear.module)) / (gear.pitchRadius + gear.module);

const radiusOf = (type) => CATALOG[type].primitives[0].halfExtents[1];

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

// Contiguous runs, because a trapezoidal tooth holds its tip and valley across several
// vertices: a plateau is one tooth, not three.
function runs(profile, radius) {
  const atRadius = profile.map((point) => Math.abs(point.length() - radius) < 1e-9);
  return atRadius.filter(
    (here, index) => here && !atRadius[(index - 1 + atRadius.length) % atRadius.length],
  ).length;
}

test('gear teeth are cut one per catalog tooth count, tipped at the canonical root radius', () => {
  for (const type of gearTypes) {
    const gear = CATALOG[type].gear,
      radius = radiusOf(type);
    const profile = gearRimProfile(radius, gear);
    const radii = profile.map((point) => point.length());
    const valley = radius - expectedDepth(gear, radius);
    assert.equal(runs(profile, radius), gear.teeth, type + ' tips');
    assert.equal(runs(profile, valley), gear.teeth, type + ' valleys');
    assert.ok(Math.abs(Math.max(...radii) - radius) < 1e-9, type + ' tip radius');
    assert.ok(Math.abs(Math.min(...radii) - valley) < 1e-9, type + ' valley radius');
    // A tooth is centred on every quarter turn only because 12 and 24 divide by 4. That
    // is what puts a full-radius vertex on each axis and keeps the bounding box the
    // canonical solid's; a tooth count that did not divide by 4 would fall short of it.
    assert.equal(gear.teeth % 4, 0, type + ' tooth count must put a tip on each axis');
    for (const axis of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2])
      assert.ok(
        profile.some(
          (point) =>
            Math.abs(point.x - Math.cos(axis) * radius) < 1e-9 &&
            Math.abs(point.y - Math.sin(axis) * radius) < 1e-9,
        ),
        type + ' tip vertex on axis ' + axis,
      );
  }
  // A 12T and a 24T profile are not interchangeable.
  assert.notEqual(
    gearRimProfile(radiusOf('gear12'), CATALOG.gear12.gear).length,
    gearRimProfile(radiusOf('gear12'), CATALOG.gear24.gear).length,
  );
});

test('gear teeth never leave the canonical root radius at any scale', () => {
  for (const type of gearTypes)
    for (const scale of [0.5, 1, 5]) {
      const gear = CATALOG[type].gear,
        radius = radiusOf(type) * scale;
      const profile = gearRimProfile(radius, gear);
      for (const point of profile) {
        assert.ok(point.length() <= radius + 1e-9, type + ' protrudes at scale ' + scale);
        assert.ok(Math.abs(point.x) <= radius + 0.0007, type + ' box bound x at scale ' + scale);
        assert.ok(Math.abs(point.y) <= radius + 0.0007, type + ' box bound y at scale ' + scale);
      }
      // The teeth are cut in proportion, so a larger gear is not a smooth disc.
      const depth = radius - Math.min(...profile.map((point) => point.length()));
      assert.ok(
        Math.abs(depth - expectedDepth(gear, radius)) < 1e-9,
        type + ' depth at scale ' + scale,
      );
    }
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

test('a click in a tooth valley still picks the gear', () => {
  withDocument(() => {
    for (const type of gearTypes) {
      const mesh = createPartMesh(createPart(type, 'gear', [0, 0, 0]));
      mesh.updateMatrixWorld(true);
      const gear = CATALOG[type].gear,
        radius = radiusOf(type);
      // Half a pitch from a tip centre is the middle of a valley for any tooth count.
      // The ray runs down the axis onto the ring the teeth cut away, so the drawn disc
      // has no surface there: what is under test is the raycast override on the root
      // mesh, not the ray's position. Aim mid-band so neither edge is grazed.
      const angle = Math.PI / gear.teeth;
      const aim = radius - expectedDepth(gear, radius) / 2;
      const hits = new THREE.Raycaster(
        new THREE.Vector3(0.5, Math.cos(angle) * aim, Math.sin(angle) * aim),
        new THREE.Vector3(-1, 0, 0),
        // Non-recursive, exactly as every selection path picks: a recursive search would
        // also hit the selection outline and could answer with it instead.
      ).intersectObjects([mesh], false);
      assert.ok(hits.length > 0, type + ' valley must still pick the gear');
      assert.equal(hits[0].object, mesh, type + ' reports the gear, not a proxy');
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
  for (const type of gearTypes) {
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
