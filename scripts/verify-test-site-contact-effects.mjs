import * as THREE from "three";
import { assert } from "./lib/assert.mjs";
import {
  createTestSiteContactEffects,
  testSiteContactEffectKind,
} from "../src/presentation/test-site-contact-effects.js";

const wheel = (overrides = {}) => ({
  partId: 7,
  touching: true,
  supportMaterialKeys: ["dry-asphalt"],
  longitudinalSlipMPerS: 0,
  lateralSlipMPerS: 0,
  frictionEllipseUtilization: 0,
  surfaceSinkageM: 0,
  groundY: 0,
  inPond: false,
  ...overrides,
});

assert.deepEqual(testSiteContactEffectKind(wheel({ touching: false }), 10), {
  mark: null,
  particle: null,
});
assert.deepEqual(
  testSiteContactEffectKind(
    wheel({
      supportMaterialKeys: ["dry-sand"],
      surfaceSinkageM: 0.03,
    }),
    3,
  ),
  { mark: "rut", particle: "dust" },
);
assert.deepEqual(
  testSiteContactEffectKind(wheel({ longitudinalSlipMPerS: 0.8 }), 4),
  { mark: "skid", particle: null },
);
assert.deepEqual(
  testSiteContactEffectKind(wheel({ supportMaterialKeys: ["wet-asphalt"] }), 3),
  { mark: "wet-track", particle: "spray" },
);
assert.deepEqual(
  testSiteContactEffectKind(
    wheel({
      supportMaterialKeys: ["dry-sand"],
      surfaceSinkageM: 0.02,
    }),
    0.2,
  ),
  { mark: "rut", particle: null },
);

const parent = new THREE.Group(),
  partMesh = new THREE.Object3D(),
  effects = createTestSiteContactEffects({
    parent,
    partById: (id) => (id === 7 ? { mesh: partMesh } : null),
    reducedMotion: () => false,
  });
parent.add(partMesh);
for (let frame = 0; frame < 260; frame++) {
  partMesh.position.set(frame * 0.4, 0.4, 0);
  effects.present({
    time: frame * 0.1,
    systems: {
      mobility: {
        assemblies: [
          {
            signedSpeed: 3,
            wheelStates: [
              wheel({
                supportMaterialKeys: ["dry-sand"],
                surfaceSinkageM: 0.03,
              }),
            ],
          },
        ],
      },
    },
  });
}
assert.deepEqual(effects.snapshot().capacity, {
  marks: 192,
  particles: 96,
});
assert.equal(effects.snapshot().visibleMarks, 192);
assert.ok(effects.snapshot().visibleParticles <= 96);
effects.clear();
assert.equal(effects.snapshot().visibleMarks, 0);
assert.equal(effects.snapshot().visibleParticles, 0);

const reduced = createTestSiteContactEffects({
  parent: new THREE.Group(),
  partById: () => ({ mesh: partMesh }),
  reducedMotion: () => true,
});
reduced.present({
  time: 1,
  systems: {
    mobility: {
      assemblies: [
        {
          signedSpeed: 3,
          wheelStates: [
            wheel({
              supportMaterialKeys: ["wet-asphalt"],
              inPond: true,
            }),
          ],
        },
      ],
    },
  },
});
assert.equal(reduced.snapshot().visibleParticles, 0);

console.log(
  "test-site contact effects are telemetry-driven and resource-bounded",
);
