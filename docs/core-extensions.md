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
through a consumer-owned catalog. The shared descriptor compiler derives its
collision shape, render dimensions, mass, displacement, aerodynamic surface,
and port frames. Passing the same catalog to `compileAssembly()` keeps analysis
and simulation topology consistent.

## Port behavior

[`port-behavior.mjs`](../examples/core-extensions/port-behavior.mjs) declares a
custom generator and payload using the standard `POWER OUT` / `POWER IN`
contracts. `validatePortConnection()` enforces direction, medium, multiplicity,
and catalog membership before a connection is authored. New physical media
require a reviewed core contract rather than arbitrary executable callbacks in
blueprint data.

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
