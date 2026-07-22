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

## Engineering analysis

`analyzeAssembly()` is DOM-free and deterministic:

- center of mass is the component-mass-weighted position;
- center of buoyancy is the solid-displacement-volume-weighted position, using
  the same material density table imported by `RoverRuntime`;
- nominal thrust sums every Vector Thruster's neutral local +Y force after its
  stored rotation, using the flight runtime's `power × 240 N` rating; and
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
