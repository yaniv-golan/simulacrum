# Architecture and policy owners

<!-- doc-review {"version":1,"fingerprint":"110fd9e0caa147deb732d831e02807fe5881bdf8d2b290d8ed9bba9d7859ba34","dependencies":"docs/development/.reviews/architecture/architecture-and-policy-owners.json","dependencyDigest":"e36cfcbdfefdf64c0b0924d39ba6124dc208b3fb8092cc3aea032c7b9a9d244e","disposition":"still accurate","rationale":"AGENTS adds a discovery entry point without changing runtime ownership, layer boundaries, or manifest milestone authority."} -->

The [runtime contract](../contracts/runtime-v1.md) owns clocks, cursors, replay and
state ownership. [AGENTS.md](../../AGENTS.md) defines allowed layer edges. The
[manifest](../../scripts/manifest.json) owns milestone allocation and check metadata.

## Trace an edit

<!-- doc-review {"version":1,"fingerprint":"8714c87aea654755ab5e20da7ef7af561619a5bf621e6c85ab1afd74435a3225","dependencies":"docs/development/.reviews/architecture/trace-an-edit.json","dependencyDigest":"655619db3c2d5c62a1fd2f21630bb44fd57cab5fbdbc1d55faf85b9da9f5961a","disposition":"updated","rationale":"The application composition link now uses implementation coverage, excluding arbitrary remote payload bytes. Core admission, snapshots and fixed simulation phases are unchanged."} -->

1. [Workshop application](../../src/application/workshop-app.mjs#implementation) composes the DOM view, clock and core.
2. [Workshop view](../../src/presentation/workshop-view.mjs) turns player input into ordinary commands. Surface and mirror controls keep previews outside authored state.
3. [createWorkshop](../../src/core/workshop.mjs#symbol=createWorkshop) admits commands, prepares a candidate and commits accepted edits as one history operation. Rejected/no-op edits preserve their specified cursor/history effects; Undo/Redo restores authored candidates.
4. [validateBlueprint](../../src/model/blueprint.mjs#symbol=validateBlueprint), [placement admission](../../src/model/surfaces.mjs) and [compileAssembly](../../src/model/assembly.mjs#symbol=compileAssembly) validate stored values, physical intersections and connection geometry before simulation receives configuration.
5. [Session](../../src/simulation/session.mjs) owns stepping, checkpoint and completed publication. [Controllers](../../src/simulation/controllers.mjs) produce commands; [power](../../src/simulation/power.mjs) resolves circuits; the [physics door](../../src/simulation/physics/world.mjs) alone imports the physics library.
6. [Observation store](../../src/model/observation.mjs) publishes immutable completed snapshots. Presentation consumes these observations, never a live physics object.

The application link covers composition code and declared dependencies, not remote runtime payload contents.

Build edits may replace the admitted configuration; Run uses the fixed simulation
path and forbids authoring edits. Returning to Build restores the editable starting
machine. A preview is a proposed edit, not a body pose write. Disposal must end owned
input operations and release handlers/resources; input cancellation also runs on blur,
lost capture and pause where applicable.

## Reuse canonical decisions

<!-- doc-review {"version":1,"fingerprint":"115c61101fd8fdded6e0fddd64eaffb82ff6176d39793c7fbc068c794eaa5b7b","dependencies":"docs/development/.reviews/architecture/reuse-canonical-decisions.json","dependencyDigest":"7323e7037bde6810cbce2d6ebb352cd407539c1bc1d56086af63489a957e5836","disposition":"still accurate","rationale":"Only developer tooling and package scripts changed. The named geometry, graph, render, diagnostic and command policy owners remain the production implementations."} -->

| Decision                                       | Production owner                                                                                                                                                                                                                                             | Example consumer                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Authored geometry and decoration boundary      | [partPrimitives](../../src/model/geometry.mjs#symbol=partPrimitives) / [shaftSegments](../../src/model/geometry.mjs#symbol=shaftSegments), [CATALOG](../../src/model/catalog.mjs#symbol=CATALOG) / [MATERIALS](../../src/model/catalog.mjs#symbol=MATERIALS) | assembly compiler and workshop renderer                                   |
| Quaternion math and world directions           | [transforms](../../src/model/transforms.mjs)                                                                                                                                                                                                                 | surfaces, assembly, mirror                                                |
| Unique player-visible names                    | [availablePartName](../../src/model/blueprint.mjs#symbol=availablePartName)                                                                                                                                                                                  | core insertion/copy/rename                                                |
| Surface frames and collision admission         | [resolveSurfaceEndpoint](../../src/model/surfaces.mjs#symbol=resolveSurfaceEndpoint) / [validatePlacementGeometry](../../src/model/surfaces.mjs#symbol=validatePlacementGeometry)                                                                            | compiler and surface proposal                                             |
| Candidate attachment                           | [snapConnection](../../src/model/assembly.mjs#symbol=snapConnection) / [proposeSurfaceMount](../../src/model/assembly.mjs#symbol=proposeSurfaceMount)                                                                                                        | core and surface preview                                                  |
| Mechanical membership and selection boundaries | [connection graph](../../src/model/connection-graph.mjs)                                                                                                                                                                                                     | authoring, mount admission, manipulation scope and mirror selection       |
| Rigid authoring transforms                     | [transformGroup](../../src/model/editing.mjs#symbol=transformGroup), [frame math](../../src/model/transforms.mjs)                                                                                                                                            | core transforms and connection snapping                                   |
| Connection overlay specification/resources     | [checked spec producer](../../src/presentation/connection-render.mjs), [renderer](../../src/presentation/connection-view.mjs)                                                                                                                                | workshop display; exact diagnostic edge IDs come from connectionTestPaths |
| Mirror reflection and omitted edges            | [proposeMirroredAssembly](../../src/model/mirror-assembly.mjs#symbol=proposeMirroredAssembly)                                                                                                                                                                | mirror UI and core command                                                |
| Command effects, cursor and history            | [createWorkshop](../../src/core/workshop.mjs#symbol=createWorkshop)                                                                                                                                                                                          | all authoring interfaces                                                  |
| Placement commitment and cancellation          | [createPlacementLifecycle](../../src/presentation/placement-lifecycle.mjs#symbol=createPlacementLifecycle)                                                                                                                                                   | surface controls                                                          |
| Canvas direct drag lifetime                    | [createDirectDrag](../../src/presentation/direct-drag.mjs#symbol=createDirectDrag)                                                                                                                                                                           | workshop view                                                             |
| Receiver keyboard/override ownership           | [createVehicleControls](../../src/presentation/vehicle-controls.mjs#symbol=createVehicleControls)                                                                                                                                                            | [Connect & test](../../src/presentation/connection-test.mjs)              |
| Diagnostics from completed data                | [diagnoseMotion](../../src/model/motion-diagnostics.mjs#symbol=diagnoseMotion), [connection paths](../../src/model/connection-test-paths.mjs)                                                                                                                | inspector and Check machine                                               |

Use `node scripts/navigate.mjs <owner-symbol>` to discover current consumers and tests.
These links explain policy responsibilities, not a second inventory of module edges.
Render-only decoration may illustrate a hub; it must not imply an authorable hole or
replace the collision geometry. Preserve independent physical test calculations when
sharing production policy: an oracle that calls the implementation proves little.

A cell can supply multiple motors; multiple cells on one circuit remain unsupported.
Shared motor torque accounting and the completed energy ledger belong to simulation.
Ground contact and workshop motion are not Course qualification.
