# Simulacrum Core

`@yaniv-golan/simulacrum-core` is the DOM-free, versioned reuse surface behind
the Simulacrum engineering sandbox. It exposes assembly and blueprint models,
the deterministic simulation session and systems, controller compilers,
challenge evaluation, failure/replay analysis, and immutable telemetry. Runtime
power and signal availability is evaluated only from completed telemetry, never
inferred from a demo or editor state.

The component-inspection foundation exposes strict authored-content projection,
canonical authored fingerprints, immutable direct relationship indexes, and
authored-only preflight records. Resolved network paths remain owned by the
simulation networks rather than being reconstructed by consumers.

Component geometry resolves through the strict, immutable
`GeometryDescriptorV2` contract. Collision primitives, rendered physical-body
primitives, port frames, physical-interface features, and their explicitly
named bounds all come from one model-owned catalog definition. Alternate
catalogs must register a complete geometry contract; missing geometry and
geometrically invalid connections fail closed instead of receiving a centered
port or generic visual fallback. Presentation may add classified decoration,
but decoration is never physical evidence.

Core `0.2.0` includes canonical rounded boxes, common-law spur gears, helical
springs, bounded extruded profiles, and rounded wheels. Mechanism body recipes
remain independent from collision approximations, and completed
`coordinateId`/`coordinateM` samples feed the same pure deformation transform
used for body bounds and host presentation. Projection clamps those samples to
the authored coordinate range; the simulation read model remains responsible
for preserving and diagnosing any raw physical overtravel.

The canonical `PhysicalAssemblyIndex`, per-component
`MobilityTelemetrySystem`, and semantic remote-action contracts preserve
authored frame/member identity and structural lineage. Exact remote targets
remain independent across multiple or split assemblies, and profile names
never select behavior. Environment-body descriptors, deterministic registries,
proximity measurement, and compiled range sensors apply to any sensed world
object without mission-specific physics.

Engine contact materials are projected from each compiled collision
primitive's authored `materialKey` through `MultibodyRuntime.materialForKey`.
The canonical symmetric material-pair table owns contact laws; demo names and
presentation roles never select friction or restitution.

Powered rotary coordinates execute their authored position-impedance law
directly: command range, stiffness, damping, maximum speed, torque, power,
efficiency, idle draw, and winding thermal limits all bound the generic Cannon
motor row. Solver-measured positive work is settled against physical source
energy, unsupported regeneration becomes actuator heat, and checkpoints require
the electrical, net-mechanical, and dissipated-energy ledger to conserve.
Flexible-line solver provenance preserves numeric and same-spelling string
connection identities injectively.

`MobilityTelemetrySystem` also publishes exact support-material identities and
laws, bounded soft-surface sinkage, and rolling-resistance multipliers.
`TestSiteTelemetrySystem` projects canonical proving-ground districts,
surfaces, terrain, fluids, and zones from completed physical poses, while
`TestCourseSystem` evaluates immutable route contracts without dispatching on
demo or machine type. The repository's
[`docs/TEST_GROUND.md`](../../docs/TEST_GROUND.md) describes the host workflow
and evidence contract that use these systems.

`PneumaticNetwork` owns conserved dry-air chamber mass and internal energy,
compressible resource topology, powered compressor/valve dynamics, sensor
readings, leaks, and bounded flow transactions. `PneumaticSystem` resolves flow
before contact; `PneumaticCommitSystem` applies solved pressure-volume work and
gas/carcass heat after integration. Completed pressure telemetry feeds tire
contact, controllers, presentation, evidence, and checkpoint v2 without a
second calculation. Public pure helpers expose the same ideal-gas, volume,
support/tangent, rolling-loss, and choked-flow laws used by the runtime.

Powered two-flange release couplers compile into load-rated constraints and
exact actuator endpoints. `ReleaseCouplerSystem` consumes resolved power and
commands, spends the authored latch energy, and opens only its flanges plus
explicitly declared breakaway routes. It adds no hidden separation impulse;
checkpoint v2 restores its private state through the owner-version-1
`release-couplers` record.

Network owners expose immutable `evidenceIndex()` records and bounded
digest-matched `routeWitness()` queries. `SimulationSession.routeEvidence()`
resolves completed live evidence through opaque telemetry tokens; tokens never
enter checkpoints or portable formats. Material allocation state is version 2
inside the existing `material-resources` checkpoint owner so same-tick duplicate
debits remain rejected after restore.

Executable checkpoint imports accept serialized JSON or the deeply frozen root
returned by the matching exporter/decoder. Raw mutable objects are not
inspected: this prevents accessors and Proxy structural traps from becoming
checkpoint authority. Simulation, clock, and Cannon world time are exact
projections of integer committed tick and fixed timestep.
The assembly compiler and `MultibodyRuntime.start()` use the same boundary for
assembly snapshots and component catalogs. Built-in `TYPES` and
`AssemblyModel.snapshot()` are package-issued roots; custom external inputs are
serialized first. Checkpoint capture/restore runtime identities are exact
serialized three-fingerprint projections.

`flexible-line-v1` components compile into deterministic distributed entities
and unilateral internal edges, not rigid proxy bodies. `FlexibleLineRuntime`
shares the host Cannon world and fixed integration transaction; the flexible
line actuator, structure, and telemetry systems preserve phase order. Plural
entity ownership and split lineage remain in `BodyRegistry` and
`PhysicalAssemblyIndex`, while completed telemetry and checkpoints expose the
same centreline, loads, contacts, failure, and restore truth to every consumer.
Registry checkpoint import is coordinator-owned, validates connection
provenance against the running topology, and derives its public revision from
the exact owned state so rewind and rollback remain exact.

The public fixed-step surface uses narrow `AerodynamicSystem`, `ThermalSystem`,
and `PhysicalFlightTelemetrySystem` phases. They consume explicit host services, preserve the
single integration transaction, and keep mutable temperature/ablation state
separate from derived forces and completed telemetry. Checkpoint v2 requires
the current exact per-owner versions: every owner is version 2 except
`flexible-line-runtime` and `release-couplers`, which remain version 1. Mutable
thermal state is persisted under `thermal-ablation`; physical grouping and read
models are re-derived.

## Availability

`@yaniv-golan/simulacrum-core` is not published to npm yet. Use it from a
Simulacrum source checkout:

```sh
npm ci
npm run core:build
```

The root workspace resolves the package name to this package, so examples and
the game exercise the same public facade that will eventually be published.

## Minimal session

```js
import {
  AssemblyModel,
  SensorSystem,
  SimulationSession,
  TelemetrySystem,
} from "@yaniv-golan/simulacrum-core";

const assembly = AssemblyModel.fromBlueprint({
  format: "simulacrum-blueprint",
  version: 1,
  name: "Empty machine",
  created: new Date().toISOString(),
  parts: [],
  connections: [],
  remoteProfiles: {},
  defaultRemoteProfile: null,
});
const session = new SimulationSession({
  systems: [new SensorSystem(), new TelemetrySystem()],
});

session.start(assembly.snapshot());
session.stepFixed();
console.log(session.telemetry());
session.dispose();
```

See [`docs/core-extensions.md`](../../docs/core-extensions.md) in the repository
for executable extension examples. Public compatibility and release rules are
defined in [SEMVER.md](./SEMVER.md).
