import { assert } from "./lib/assert.mjs";
import { sampleWindVelocity } from "../src/simulation/environment/wind-field.js";

const calm = sampleWindVelocity(
  { x: 120, y: 10, z: -80 },
  { enabled: false, elapsedSeconds: 20 },
);
assert.deepEqual(calm, { x: 0, y: 0, z: 0 });

const surface = sampleWindVelocity(
    { x: 0, y: 10, z: 0 },
    { elapsedSeconds: 0 },
  ),
  repeated = sampleWindVelocity({ x: 0, y: 10, z: 0 }, { elapsedSeconds: 0 }),
  jet = sampleWindVelocity({ x: 0, y: 10_000, z: 0 }, { elapsedSeconds: 0 });
assert.deepEqual(surface, repeated, "wind field is not deterministic");
assert.ok(Math.hypot(surface.x, surface.z) > 2);
assert.ok(Math.hypot(surface.x, surface.z) < 8);
assert.ok(Math.hypot(jet.x, jet.z) > 30);
assert.ok(Math.hypot(jet.x, jet.z) < 50);

const gustA = sampleWindVelocity({ x: 0, y: 800, z: 0 }, { elapsedSeconds: 0 }),
  gustB = sampleWindVelocity(
    { x: 400, y: 800, z: -300 },
    { elapsedSeconds: 8 },
  );
assert.notDeepEqual(gustA, gustB, "wind turbulence ignored space and time");
for (const sample of [surface, jet, gustA, gustB])
  for (const component of Object.values(sample))
    assert.ok(Number.isFinite(component), "wind emitted a non-finite velocity");

console.log(
  `wind field passed (surface ${Math.hypot(surface.x, surface.z).toFixed(2)} m/s, jet ${Math.hypot(jet.x, jet.z).toFixed(2)} m/s)`,
);
