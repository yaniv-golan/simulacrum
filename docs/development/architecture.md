# Architecture and policy owners

The [runtime contract](../contracts/runtime-v1.md) owns clocks, cursors, replay and
state ownership. [AGENTS.md](../../AGENTS.md) defines allowed layer edges. The
[manifest](../../scripts/manifest.json) owns milestone allocation and check metadata.

## Trace an edit

1. [Workshop application](../../src/application/workshop-app.mjs) composes the DOM view, clock and core.
2. [Workshop view](../../src/presentation/workshop-view.mjs) turns player input into ordinary commands. Surface and mirror controls keep previews outside authored state.
3. [createWorkshop](../../src/core/workshop.mjs) admits commands, prepares a candidate and commits accepted edits as one history operation. Rejected/no-op edits preserve their specified cursor/history effects; Undo/Redo restores authored candidates.
4. [validateBlueprint](../../src/model/blueprint.mjs), [placement admission](../../src/model/surfaces.mjs) and [compileAssembly](../../src/model/assembly.mjs) validate stored values, physical intersections and connection geometry before simulation receives configuration.
5. [Session](../../src/simulation/session.mjs) owns stepping, checkpoint and completed publication. [Controllers](../../src/simulation/controllers.mjs) produce commands; [power](../../src/simulation/power.mjs) resolves circuits; the [physics door](../../src/simulation/physics/world.mjs) alone imports the physics library.
6. [Observation store](../../src/model/observation.mjs) publishes immutable completed snapshots. Presentation consumes these observations, never a live physics object.

Build edits may replace the admitted configuration; Run uses the fixed simulation
path and forbids authoring edits. Returning to Build restores the editable starting
machine. A preview is a proposed edit, not a body pose write. Disposal must end owned
input operations and release handlers/resources; input cancellation also runs on blur,
lost capture and pause where applicable.

## Reuse canonical decisions

| Decision | Production owner | Example consumer |
| --- | --- | --- |
| Authored geometry and decoration boundary | [partPrimitives / shaftSegments](../../src/model/geometry.mjs), [CATALOG / MATERIALS](../../src/model/catalog.mjs) | assembly compiler and workshop renderer |
| Quaternion math and world directions | [transforms](../../src/model/transforms.mjs) | surfaces, assembly, mirror |
| Unique player-visible names | [availablePartName](../../src/model/blueprint.mjs) | core insertion/copy/rename |
| Surface frames and collision admission | [resolveSurfaceEndpoint / validatePlacementGeometry](../../src/model/surfaces.mjs) | compiler and surface proposal |
| Candidate attachment | [snapConnection / proposeSurfaceMount](../../src/model/assembly.mjs) | core and surface preview |
| Connected transform membership | [mechanicalGroup / transformGroup](../../src/model/editing.mjs) | core transforms |
| Mirror reflection and omitted edges | [proposeMirroredAssembly](../../src/model/mirror-assembly.mjs) | mirror UI and core command |
| Command effects, cursor and history | [createWorkshop](../../src/core/workshop.mjs) | all authoring interfaces |
| Placement commitment and cancellation | [createPlacementLifecycle](../../src/presentation/placement-lifecycle.mjs) | surface controls |
| Canvas direct drag lifetime | [createDirectDrag](../../src/presentation/direct-drag.mjs) | workshop view |
| Receiver keyboard/override ownership | [createVehicleControls](../../src/presentation/vehicle-controls.mjs) | [Connect & test](../../src/presentation/connection-test.mjs) |
| Diagnostics from completed data | [diagnoseMotion](../../src/model/motion-diagnostics.mjs), [connection paths](../../src/model/connection-test-paths.mjs) | inspector and Check machine |

Use `node scripts/navigate.mjs <owner-symbol>` to discover current consumers and tests.
These links explain policy responsibilities, not a second inventory of module edges.
Render-only decoration may illustrate a hub; it must not imply an authorable hole or
replace the collision geometry. Preserve independent physical test calculations when
sharing production policy: an oracle that calls the implementation proves little.

A cell can supply multiple motors; multiple cells on one circuit remain unsupported.
Shared motor torque accounting and the completed energy ledger belong to simulation.
Ground contact and workshop motion are not Course qualification.
