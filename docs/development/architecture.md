# Architecture and policy owners

## Overview
<!-- doc-review {"version":1,"fingerprint":"e3ecec4c1985abba40cc3907bc71dc18acbc6be9ede83899c93d40136d0f9c72","dependencies":"docs/development/.reviews/architecture/overview.json","dependencyDigest":"3e5639271768ee2579a5250864c6b5dfb613b5e1ad0483b02308a5a5701a84bc","disposition":"updated","rationale":"The overview describes registry-reader ownership with direct source coverage; current rule and gate values are obtained through their commands rather than binding this composition explanation to every manifest entry."} -->

The [runtime contract](../contracts/runtime-v1.md) owns clocks, cursors, replay and
state ownership. [AGENTS.md](../../AGENTS.md) defines allowed layer edges. The
[registry reader](../../scripts/validate-manifest.mjs#source) loads the canonical `scripts/manifest.json` for milestone allocation and check metadata. This overview identifies that owner; use `npm run gate` and `npm run rules` for its current entries.

## Trace an edit

<!-- doc-review {"version":1,"fingerprint":"602d206e57dcd98ea5c8f5f17e85ce60d6480a38723ed09f0d53ef00523b2064","dependencies":"docs/development/.reviews/architecture/trace-an-edit.json","dependencyDigest":"3f406d4578414600631bb416c1efac0007a3f3d1be0f789c1a5794c26501736c","disposition":"still accurate","rationale":"Only the package dependency/configuration inputs of this section changed. Cloud capture consumes events from the application; core admission, previews, history, telemetry publication and physical stepping owners remain unchanged."} -->

1. [Workshop application](../../src/application/workshop-app.mjs#source) composes the DOM view, clock and core.
2. [Workshop view](../../src/presentation/workshop-view.mjs#source) turns player input into ordinary commands. [Surface controls](../../src/presentation/surface-controls.mjs#source), their [placement lifecycle](../../src/presentation/placement-lifecycle.mjs#source), and [mirror controls](../../src/presentation/assembly-mirror.mjs#source) keep previews outside authored state. Assembly capture and placement forms also remain transient; their accepted edits use the same core.
3. [createWorkshop](../../src/core/workshop.mjs#symbol=createWorkshop) admits commands, prepares a candidate and commits accepted edits as one history operation. Rejected/no-op edits preserve their specified cursor/history effects; Undo/Redo restores authored candidates.
4. [validateBlueprint](../../src/model/blueprint.mjs#symbol=validateBlueprint), [placement admission](../../src/model/surfaces.mjs) and [compileAssembly](../../src/model/assembly.mjs#symbol=compileAssembly) validate stored values, physical intersections and connection geometry before simulation receives configuration.
5. [Session](../../src/simulation/session.mjs) owns stepping, checkpoint and completed publication. [Controllers](../../src/simulation/controllers.mjs) produce commands; [power](../../src/simulation/power.mjs) resolves circuits; the [physics door](../../src/simulation/physics/world.mjs) alone imports the physics library.
6. [Observation store](../../src/model/observation.mjs) publishes immutable completed snapshots. Presentation consumes these observations, never a live physics object.

The [assembly library](../../src/application/assembly-library.mjs#implementation) owns
browser persistence and validates definitions with the model. The
[assembly panel](../../src/presentation/assembly-library.mjs#source) displays
named and ordinary endpoints, receiver keys and independent instances. Named mounts
open the surface preview; interface edits use core admission. Placed instances and
saved snapshots have separate views, and saved authored settings are inspectable. Machine saves
embed all internals; simulation has no library dependency.

The application/view links cover their own composition and input routing code. The core, model and simulation links separately bind the admitted behavior; remote payload contents are outside these claims.

Build edits may replace the admitted configuration; Run uses the fixed simulation
path and forbids authoring edits. Returning to Build restores the editable starting
machine. A preview is a proposed edit, not a body pose write. Disposal must end owned
input operations and release handlers/resources. [Direct drag](../../src/presentation/direct-drag.mjs#source),
[editing controls](../../src/presentation/editing-controls.mjs#source), and
[vehicle controls](../../src/presentation/vehicle-controls.mjs#source) own their respective
input lifetimes; input cancellation runs on blur, lost capture and pause where applicable.

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

<!-- doc-review {"version":1,"fingerprint":"4c991049cfa90e6b1a7a062f71cf0c3051090b1afcd05dd6aac5e0dbfe9bc9fe","dependencies":"docs/development/.reviews/architecture/reuse-canonical-decisions.json","dependencyDigest":"3c6d118cb5bc109c74954ef033ab17f7cc9d1fd674421e28342626ed8432deca","disposition":"still accurate","rationale":"The added deployment dependencies do not alter geometry, material, naming, receiver, diagnostic or shared-power policy owners in this table. Capture storage does not become an authority for authored decisions."} -->

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
| Receiver keyboard/override ownership           | [createVehicleControls](../../src/presentation/vehicle-controls.mjs#symbol=createVehicleControls)                                                                                                                                                            | [Connect & test](../../src/presentation/connection-test.mjs#source)              |
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
