# Simulacrum Core

`@yaniv-golan/simulacrum-core` is the DOM-free, versioned reuse surface behind
the Simulacrum engineering sandbox. It exposes assembly and blueprint models,
the deterministic simulation session and systems, controller compilers,
challenge evaluation, failure/replay analysis, and immutable telemetry. Runtime
power and signal availability is evaluated only from completed telemetry, never
inferred from a demo or editor state.

The canonical `PhysicalAssemblyIndex`, per-component
`MobilityTelemetrySystem`, and semantic remote-action contracts preserve
authored frame/member identity and structural lineage. Exact remote targets
remain independent across multiple or split assemblies, and profile names
never select behavior. Environment-body descriptors, deterministic registries,
proximity measurement, and compiled range sensors apply to any sensed world
object without mission-specific physics.

Powered two-flange release couplers compile into load-rated constraints and
exact actuator endpoints. `ReleaseCouplerSystem` consumes resolved power and
commands, spends the authored latch energy, and opens only its flanges plus
explicitly declared breakaway routes. It adds no hidden separation impulse;
checkpoint v1 restores its private state through the `release-couplers` owner.

The public fixed-step surface uses narrow `AerodynamicSystem`, `ThermalSystem`,
and `PhysicalFlightTelemetrySystem` phases. They consume explicit host services, preserve the
single integration transaction, and keep mutable temperature/ablation state
separate from derived forces and completed telemetry. Checkpoint v1 accepts
only owner-version-1 records and persists that mutable state under
`thermal-ablation`; it does not persist physical grouping or read models.

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
