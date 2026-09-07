# Architecture and policy owners

## Overview
<!-- doc-review {"version":1,"fingerprint":"c7764dbe9838f93554dbdf671c252071311307632fd6287ff4af01ca221e97f5","dependencies":"docs/development/.reviews/architecture/overview.json","dependencyDigest":"49782bf274d7a79ff71ee0bbf9018c88ba41fe12036487ef30a67f2556da47e8","disposition":"still accurate","rationale":"The additional browser check registers existing M3b help behavior under runtime-contract; runtime ownership and milestone authority are unchanged."} -->

The [runtime contract](../contracts/runtime-v1.md) owns clocks, cursors, replay and
state ownership. [AGENTS.md](../../AGENTS.md) defines allowed layer edges. The
[manifest](../../scripts/manifest.json) owns milestone allocation and check metadata.

## Trace an edit

<!-- doc-review {"version":1,"fingerprint":"16a0e03af6b67b1cd4107bb21b9bcde0e43ca7827d7bfce97864dadabde55b21","dependencies":"docs/development/.reviews/architecture/trace-an-edit.json","dependencyDigest":"a5f3512528aea8932a84de279ff77e867f42cde70474a52cd58f41c97a86a0b8","disposition":"updated","rationale":"Documented retained reading state across close and catalog-wide thumbnail caching independent of palette membership; all state remains presentation-owned."} -->

1. [Workshop application](../../src/application/workshop-app.mjs#implementation) composes the DOM view, clock and core.
2. [Workshop view](../../src/presentation/workshop-view.mjs) turns player input into ordinary commands. Surface and mirror controls keep previews outside authored state. Assembly capture and placement forms also remain transient; their accepted edits use the same core.
3. [createWorkshop](../../src/core/workshop.mjs#symbol=createWorkshop) admits commands, prepares a candidate and commits accepted edits as one history operation. Rejected/no-op edits preserve their specified cursor/history effects; Undo/Redo restores authored candidates.
4. [validateBlueprint](../../src/model/blueprint.mjs#symbol=validateBlueprint), [placement admission](../../src/model/surfaces.mjs) and [compileAssembly](../../src/model/assembly.mjs#symbol=compileAssembly) validate stored values, physical intersections and connection geometry before simulation receives configuration.
5. [Session](../../src/simulation/session.mjs) owns stepping, checkpoint and completed publication. [Controllers](../../src/simulation/controllers.mjs) produce commands; [power](../../src/simulation/power.mjs) resolves circuits; the [physics door](../../src/simulation/physics/world.mjs) alone imports the physics library.
6. [Observation store](../../src/model/observation.mjs) publishes immutable completed snapshots. Presentation consumes these observations, never a live physics object.

The [assembly library](../../src/application/assembly-library.mjs#implementation) owns
browser persistence and validates definitions with the model. The
[assembly panel](../../src/presentation/assembly-library.mjs#implementation) displays
named and ordinary endpoints, receiver keys and independent instances. Named mounts
open the surface preview; interface edits use core admission. Placed instances and
saved snapshots have separate views, and saved authored settings are inspectable. Machine saves
embed all internals; simulation has no library dependency.

The application link covers composition code and declared dependencies, not remote runtime payload contents.

Build edits may replace the admitted configuration; Run uses the fixed simulation
path and forbids authoring edits. Returning to Build restores the editable starting
machine. A preview is a proposed edit, not a body pose write. Disposal must end owned
input operations and release handlers/resources; input cancellation also runs on blur,
lost capture and pause where applicable.

Part explanations, tooltip timers and the movable reference window live in
[part help](../../src/presentation/part-help.mjs). Window position, size and active tab
are presentation state. Closing retains the current type, tab and scroll for reopening;
choosing a different type resets the reading page. Catalog thumbnails are cached
independently of palette eligibility, so supported loaded-only parts have images too.
[Example diagrams](../../src/presentation/part-help-diagram.mjs)
render one node per example part and resize their connection paths with the window.
They never enter authored state or
history. The shared [help input scope](../../src/presentation/part-help-input.mjs)
precedes receiver capture and workshop shortcuts; entering it releases held receiver
input through the ordinary vehicle-controls command path. Returning to the workbench
requires a fresh key press. An open reference alone does not suppress controls.
Because the fixed heading is outside the scrolling content, part help forwards
reading keys from the header into the active page. Content focus keeps native
scrolling, while buttons and tab navigation retain their activation behavior.

## Reuse canonical decisions

<!-- doc-review {"version":1,"fingerprint":"7fe0ec1ae3210dbd824d0663dcaef1a6908373b50fe745f473de615ea79bdafd","dependencies":"docs/development/.reviews/architecture/reuse-canonical-decisions.json","dependencyDigest":"e69ece2a216f3c18bc8be72975eea1e7f78894a5b13812078d5e7e37320afcc8","disposition":"updated","rationale":"Added the extracted palette grouping and shared part-help/port wording owners; receiver input remains owned by vehicle controls."} -->

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
| Reusable definitions, aliases and instance transforms | [reusable assembly proposals](../../src/model/reusable-assemblies.mjs) | core commands and assembly library |
| Command effects, cursor and history            | [createWorkshop](../../src/core/workshop.mjs#symbol=createWorkshop)                                                                                                                                                                                          | all authoring interfaces                                                  |
| Placement commitment and cancellation          | [createPlacementLifecycle](../../src/presentation/placement-lifecycle.mjs#symbol=createPlacementLifecycle)                                                                                                                                                   | surface controls                                                          |
| Canvas direct drag lifetime                    | [createDirectDrag](../../src/presentation/direct-drag.mjs#symbol=createDirectDrag)                                                                                                                                                                           | workshop view                                                             |
| Receiver keyboard/override ownership           | [createVehicleControls](../../src/presentation/vehicle-controls.mjs#symbol=createVehicleControls)                                                                                                                                                            | [Connect & test](../../src/presentation/connection-test.mjs)              |
| Palette eligibility and grouping | [part palette](../../src/presentation/part-palette.mjs) | workshop palette; help coverage instead follows the catalog |
| Part teaching copy and port labels | [help content](../../src/presentation/part-help-content.mjs), [port wording](../../src/presentation/port-wording.mjs) | palette, inspector and static example diagrams |
| Diagnostics from completed data                | [diagnoseMotion](../../src/model/motion-diagnostics.mjs#symbol=diagnoseMotion), [connection paths](../../src/model/connection-test-paths.mjs)                                                                                                                | inspector and Check machine                                               |

Use `node scripts/navigate.mjs <owner-symbol>` to discover current consumers and tests.
These links explain policy responsibilities, not a second inventory of module edges.
Render-only decoration may illustrate a hub; it must not imply an authorable hole or
replace the collision geometry. Preserve independent physical test calculations when
sharing production policy: an oracle that calls the implementation proves little.

A cell can supply multiple motors; multiple cells on one circuit remain unsupported.
Shared motor torque accounting and the completed energy ledger belong to simulation.
Ground contact and workshop motion are not Course qualification.
