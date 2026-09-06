# ADR 0001: deterministic Rapier behind the physics boundary

Date: 2026-09-05. Status: accepted for M1; later contact and powered-articulation probes remain required.

## Decision

Use the exact package `@dimforge/rapier3d-deterministic-compat@0.20.0`, with a lockfile integrity of
`sha512-kODprI9mdSm6idjbCuyRmwyVbSqFL3wvY7wOvu//eJqbqRjYc9pUMI0bSLBZt/IV+Vwzkh/Xi9nGVBJLnJgWOg==`.
The public registry metadata and downloaded package declarations were inspected. M1 subsequently verified analytical free fall, exact snapshot continuation, rejected malformed and foreign-plant snapshots, four-process Node traces, two real browser animation-clock traces, and failure replay. The executable gate preserves its source identity in artifacts/m1/qualification.json. The package embeds WASM and supplies ESM and CommonJS entrypoints. The compatibility build avoids a separate runtime WASM asset request, at the cost of a larger JavaScript download. [Published package](https://www.npmjs.com/package/@dimforge/rapier3d-deterministic-compat), [upstream package variants](https://www.npmjs.com/package/@dimforge/rapier3d-compat).

Choose the explicitly deterministic variant. Current package documentation distinguishes it from ordinary and SIMD variants; the older JavaScript determinism guide's blanket guarantee is insufficient evidence for choosing an ordinary package. D1 initially qualifies only the same runtime and library binary, across two processes and both clock drivers. Cross-browser portability remains a separate test: deterministic physics does not make host transcendental functions, input construction or iteration order portable. [Determinism conditions](https://rapier.rs/docs/user_guides/javascript/determinism/).

## Alternatives

| Option | Useful properties | Cost or unresolved obligation |
| --- | --- | --- |
| cannon-es | JavaScript ESM/CommonJS, direct fixed stepping, hinge motors, accessible solver implementation. | Public mutable bodies, vectors, equations and collision caches require an especially careful ownership boundary. The documented World API has no complete snapshot/restore pair; exact continuation would require a separately maintained state contract. |
| Rapier deterministic compatibility | Official WASM bindings, numeric object handles, whole-world snapshots and reconstruction, revolute joints and bounded motor API. | JavaScript wrappers still mutate live state and must stay private. Binary/version-specific checkpoints and host-state reconstruction need verification. Contact and joint observability must satisfy physical power and failure accounting. |
| Jolt JavaScript | WASM bindings, BodyIDs, broad articulation support; native engine documents deterministic execution and rollback. | Explicit destruction/reference counting increase lifecycle work. SaveState covers engine-modified state; structural changes require separate restoration. Exact JavaScript build options and Node/browser initialization need independent verification. |

The cannon-es judgments follow its [World API](https://pmndrs.github.io/cannon-es/docs/classes/World.html), [Body API](https://pmndrs.github.io/cannon-es/docs/classes/Body.html), [hinge API](https://pmndrs.github.io/cannon-es/docs/classes/HingeConstraint.html) and [distribution description](https://github.com/pmndrs/cannon-es). Rapier documents [joints](https://rapier.rs/docs/user_guides/javascript/joints/) and [snapshot reconstruction](https://rapier.rs/javascript3d/classes/World.html). Jolt documents [JavaScript ownership](https://github.com/jrouwe/JoltPhysics.js) and [determinism/rollback conditions](https://github.com/jrouwe/JoltPhysics/blob/master/Docs/Architecture.md#deterministic-simulation). These are API comparisons, not comparative performance measurements.

## Boundary and checkpoint contract

Only `simulation/physics/` imports Rapier. It retains every World, RigidBody, Collider, Joint and WASM-backed view. Other layers receive copied numeric values and owned snapshot bytes. Numeric handles do not authorize physical properties to depend on identity: admission still derives each primitive's properties only from geometry and player-authored choices.

The pinned declarations expose this initialization and snapshot sequence:

```js
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 120;
// Session phase 6 alone calls world.step().
const bytes = world.takeSnapshot();
const candidate = RAPIER.World.restoreSnapshot(bytes);
// Validate candidate and session envelope before replacing the owned world.
// Free discarded worlds with world.free().
```

This is an API sketch, not a tested implementation. The API is `takeSnapshot`, not the older guide's `createSnapshot`. Awaiting initialization is mandatory. [Initialization guide](https://rapier.rs/docs/user_guides/javascript/getting_started_js/), [World API](https://rapier.rs/javascript3d/classes/World.html).

Checkpoints exist only after completed ticks. The runtime envelope must additionally retain every non-library state item required by [runtime v1](../contracts/runtime-v1.md). A failed tick poisons the session; it does not publish partial state or pretend to roll back mid-step observers. Recovery constructs and validates a replacement world from a completed checkpoint. No library wrapper may survive replacement outside the physics boundary.

## Execution requirements by milestone

1. Initialize the pinned package in Node and the browser; run the same 1/120 s session path. Verify finite fall trajectory against an analytical error bound.
2. At M1, compare complete per-tick deterministic projections across fresh processes and both clock drivers and verify free-body snapshot continuation. At M4b, extend continuation checks to contact and joint motion; exercise sleeping and topology changes when those capabilities are introduced.
3. Verify returned values cannot mutate physics; reject malformed snapshots without replacing healthy state; inject a tick failure and verify poison/recovery behavior.
4. Before powered articulation, verify `setMotorMaxForce` units and achieved mechanical work against current/torque/thermal accounting. If solver motors cannot supply honest bounded work accounting, use physically owned torque inputs; never grant an unlimited servo.
5. Measure initialization, per-phase runtime and checkpoint cost on actual fixtures. Later contact/material and articulation experiments must establish feasibility; this ADR does not establish walking or Course reachability.

Reopen the library decision if snapshot continuation, authority, observable power limits or articulated-contact feasibility fail and a bounded adapter repair cannot satisfy the contract.
