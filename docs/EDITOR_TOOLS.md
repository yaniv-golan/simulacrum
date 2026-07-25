# Reusable assemblies and engineering editor

This editor tier is built around ordinary `AssemblyModel` data. It does not add
demo identity, hidden constraints, or renderer objects to the persistent model.

## Reusable subassemblies

`src/model/subassemblies.js` defines the versioned `simulacrum-subassembly`
format. Creating one:

1. filters the current assembly to the selected part IDs;
2. retains only connections whose two endpoints are selected;
3. verifies that all selected parts form one connected graph;
4. converts transforms to a placement-origin-relative frame; and
5. retains configuration, scale, color, energy, articulated role, and controller
   source buffers.

Instantiation is pure. It remaps local IDs to fresh application IDs, rebuilds
every internal endpoint, resets failure/fatigue state, and returns `nextId`.
The presentation controller then materializes those records through the same
`addPart()` path used by catalog components. The complete placement is one undo
entry and the new parts remain selected as a group.

Portable reusable assets use strict subassembly v1, including one-part
components. Local library wrappers keep origin and acquisition context outside
the asset so controller trust is reassessed on placement. Invalid local records
are isolated with a startup diagnostic. Machine blueprints use strict version 1.

## High-throughput selection and arrangement

`MarqueeSelector` works in viewport space but selects actual projected Three.js
bounds:

- left-to-right requires full containment;
- right-to-left selects crossing bounds;
- Ctrl/Cmd/Shift preserves the current set; and
- a six-pixel threshold keeps neutral clicks distinct from a drag.

Arrangement math is in `src/model/selection-transforms.js`. Exact positioning
translates every part by one pivot delta. Alignment copies the mint primary
component's chosen coordinate. Distribution sorts centers on an axis, preserves
the two endpoints, and equalizes the intervals between them. Presentation owns
inputs, history labels, and gizmo/wire refresh.

Exact positions use the authored **Workshop frame** in metres, with the
workshop-board center as origin: positive X is east, positive Y is up, and
positive Z is north. The workbench is therefore the XZ plane. The displayed
position is the arithmetic selection pivot, not clearance above the workbench or
terrain. Yaw is rotation about Workshop Y. Axis letters, direction words, and
accessible names remain present so color is never the only cue.

The Inspector makes that scope explicit. Its header identifies every selection's
primary component and, for a multi-selection, lets the player change the primary
without changing membership. The selected-context command catalog reports the
exact selected IDs plus external connection and controller-binding impact.
`F`/Frame derives one camera bound from the complete selected set. Isolate/Show
All is a transient presentation filter: it snapshots mesh/wire visibility and
the camera, never enters authored state or history, and is cleared before a
selected-context edit, a changed selection, or a simulation transition.

## Engineering analysis

`analyzeAssembly()` is DOM-free and deterministic:

- center of mass is the compiled-body-mass-weighted position, including each
  body's authored center-of-mass offset;
- center of buoyancy is the compiled solid-displacement-volume-weighted center;
- nominal thrust sums every compiled `pressure-nozzle-v1` capability at maximum
  authored mass flow and sea-level ambient pressure, using each part's stored
  orientation, nozzle axis, and pressure-nozzle performance law; and
- interference applies a 15-axis separating-axis test to oriented component
  collision proxies, excluding directly connected mechanical interfaces.

The Engineering drawer replaces the catalog instead of covering more canvas.
Its Three.js markers, force arrow, and clash boxes are disposable presentation
objects; they never enter a blueprint, compiler snapshot, or simulation step.
The complete numeric read model is also exposed in `render_game_to_text()` so
automated tests and the visible panel cannot diverge.

## Verification

`scripts/verify-core-model.mjs` pins extraction, ID remapping, strict decoding,
alignment/distribution, mass, displacement, and thrust math.
`scripts/verify-editor-tools.mjs` exercises save, clear, place, marquee, exact
position, alignment, distribution, overlay toggles, missile thrust, responsive
drawer priority, persistence, screenshots, and console health in Chromium.
`scripts/verify-component-selection-actions.mjs` pins command scope, live
bindings, framing, and transient visibility. The component-selection browser
suites pin focus recovery, text/DOM parity, authored-state invariance, exact
controller-binding deletion impact, cleanup, and Undo.
