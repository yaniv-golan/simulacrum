# Extending Simulacrum Core

The public core is capability-oriented: consumers supply catalog records,
standard port contracts, ordered simulation systems, sensor adapters,
declarative challenge definitions, sandboxed controller programs, and telemetry
readers. These examples import only `@yaniv-golan/simulacrum-core`; the game uses
the same entry point.

Run every example with:

```sh
npm run core:build
npm run examples:core
```

## Component

[`component.mjs`](../examples/core-extensions/component.mjs) adds a Ballast Pod
through a consumer-owned catalog. Its required `geometryContract` is a
data-only definition for the body and collision primitives, canonical port
frames, scale policy, and any anchored physical features. The shared resolver
validates that definition and produces immutable `GeometryDescriptorV2`
instances with separate collision, body, feature, selection, and overall
physical bounds. Passing the same catalog to `compileAssembly()` keeps editor
placement, analysis, connection validation, simulation topology, and any host
renderer on the same geometry authority.

There is no generic fallback for an alternate catalog entry. Call
`validateComponentGeometryDefinitionOrThrow()` when registering one and
`validateGeometryDescriptorOrThrow()` at an untrusted descriptor boundary.
Spatial mechanical connections must satisfy the canonical port-frame rule;
asset authors migrate the authored part transform or explicit permitted anchor,
not a renderer offset. Network-only ports remain intentionally frameless.
Descriptor v2 ships in Core `0.2.0` and is not serialized into portable wire
envelopes. Its body union is closed over analytic and bounded parametric
primitives; custom catalogs cannot supply arbitrary triangle meshes or
presentation-only fallback geometry.

The public inspection foundation uses the same strict portable field allowlist.
`decodeAuthoredAssemblyContentOrThrow()` rejects unknown editor snapshot fields,
`fingerprintComponentInspectionAssembly()` produces canonical authored identity,
and `ComponentRelationshipIndex` exposes bounded direct counterparts and
controller-binding references without importing presentation or reconstructing
resolved simulation routes. `analyzeComponentPreflight()` reports authored
checks and keeps runtime outcome explicitly `not-checked`.

The ownership boundary is intentional:

| Contract                                                                                                 | Ownership                       |
| -------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Authored decoder/projectors, fingerprint bytes/hash, direct relationship index, and authored preflight   | Reusable, DOM-free Core API     |
| Selected inspection view model, existing-data observation adapters, and selected-context command catalog | Application-private composition |
| Inspector markup, focus, editable controls, and action event binding                                     | Presentation-only               |
| Network route index/digest and bounded owner witness                                                     | Reusable, DOM-free Core API     |
| Live opaque-token archive, route overlay, and progressive port actions                                   | Session/presentation private    |

Application and presentation records are not exported from Core. Resolved
power/signal reachability and physical outcomes remain owner-supplied evidence;
the direct relationship index never upgrades adjacency into a causal claim.
See [`route-evidence.mjs`](../examples/core-extensions/route-evidence.mjs) for
the digest-matched owner query. Do not reconstruct routes from raw connections.

## Port behavior

[`port-behavior.mjs`](../examples/core-extensions/port-behavior.mjs) declares a
custom generator and payload using the standard `POWER OUT` / `POWER IN`
contracts. `validatePortConnection()` enforces direction, medium, multiplicity,
and catalog membership before a connection is authored. New physical media
require a reviewed core contract rather than arbitrary executable callbacks in
blueprint data.

## Flexible line

[`flexible-line.mjs`](../examples/core-extensions/flexible-line.mjs) compiles an
ordinary free-ended Rope through `flexible-line-v1`. The result owns plural
distributed physical entities, internal tension-only edges, two explicit free
boundaries, and a stable discretization identity without inventing a rigid
proxy body. Hosts that run it create `FlexibleLineRuntime` in the same Cannon
world and fixed-step session as their rigid-body runtime.

## Simulation system

[`simulation-system.mjs`](../examples/core-extensions/simulation-system.mjs)
implements the public `{ phase, initialize?, step?, dispose? }` lifecycle. The
radiation system participates in the ordinary fixed-step schedule and publishes
its result through `TelemetrySystem`; it does not access rendering or the DOM.

## Sensor adapter

[`sensor-adapter.mjs`](../examples/core-extensions/sensor-adapter.mjs) supplies a
new radiation reading through the `readSensors` service consumed by
`SensorSystem`. Controllers still receive the previous completed snapshot, so a
custom adapter cannot introduce a same-tick feedback loop.

## Environment body and proximity sensing

[`environment-body.mjs`](../examples/core-extensions/environment-body.mjs)
registers an engine-neutral moving sphere and measures its nearest surface with
the public conical proximity contract. The result includes quantized range,
range rate, relative velocity, and the stable body ID; neither the registry nor
the measurement creates a renderer object or mission-specific state.

## Challenge

[`challenge.mjs`](../examples/core-extensions/challenge.mjs) defines a reusable
two-to-one gear challenge and evaluates ordinary mechanism telemetry with
`ChallengeRun`. Challenge identity changes scoring and criteria only; it never
selects a physics path.

## Controller program

[`controller-program.mjs`](../examples/core-extensions/controller-program.mjs)
compiles a bounded TypeScript altitude controller to the validated control IR.
The example supplies the same canonically indexed endpoint-binding manifest
used by Visual Logic and WAT. Use `prepareTypeScriptController(source,
bindingManifest)` when a host is ready to instantiate the sandboxed WebAssembly
program; executable identity changes when the physical endpoint map changes.

## Alternate telemetry consumer

[`telemetry-consumer.mjs`](../examples/core-extensions/telemetry-consumer.mjs)
maps an immutable `TelemetrySnapshot` into a tiny alternate HUD model. HUDs,
automation, replay, and external tools can share this read model without
reading engine objects or application state.
