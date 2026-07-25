# Changelog

## Unreleased

### Added

- Added the component-inspection foundation: deterministic S0 question,
  scenario, task, viewport, and 300-part/3,000-connection baselines; a versioned
  immutable selected-component read model; strict authored-content projection
  and fingerprints; bounded direct relationships and authored-only preflight;
  current-data observation adapters; and portable/live performance gates.
- Added a selected-context Inspector action model with exact selection scope,
  external-connection and controller-binding impact, explicit multi-selection
  primary choice, complete-selection `F` framing, and transient **Isolate** /
  **Show All** views that restore the prior camera without changing authored or
  simulated machine state.
- Added Rope as an ordinary player-authored `flexible-line-v1` component with
  zero-, one-, and two-ended attachment, distributed mass and contact,
  tension-only response, sag, endpoint/internal failure, deterministic split
  checkpoints, completed telemetry/replay, exact picked anchors, atomic
  two-part rigging, strict portable reuse, and a DOM-free Core surface.
- Added the full 480 m x 360 m Workshop Test Reserve as one connected campus
  around the construction board and operations building. Its closed road
  network joins nine physical districts with 22 authored surface regions, 11
  measurable terrain features, a four-sided workshop apron transition, a
  shallow ford, an irregular deep pond and dry
  island, a physical bridge, dense collidable woodland, a 254 m runway, a
  helipad, staging pads, and ten machine-independent guided trials.
- Made the strict immutable `test-site-definition-v2` the single authority for
  terrain, surface materials, water, fixtures, vegetation, deployment, maps,
  rendering, telemetry, and route evaluation; obsolete version-1 definitions
  are rejected rather than inferred.
- Added the reserve's environment-art pass with material-specific surface
  treatment, rocks, logs, steps, curbs, markers, signs, seeded trees and
  undergrowth, water banks, bounded contact effects, and distance-scaled detail
  that preserves all gameplay-relevant terrain and collision.
- Added exact-start test deployment and retry, route-bound personal best and
  reliability records, and portable proof evidence bound to the site,
  materials, route, build, controller programs, and deployment.
- Added DOM-free `TestSiteTelemetrySystem` and `TestCourseSystem` contracts,
  multimodal course journeys, and dedicated performance, lifecycle, browser,
  physics-authority, and mutation coverage.
- Added a searchable Keyboard & commands surface with physical-key labels,
  session-scoped remapping, primary and secondary bindings, deterministic
  reset, and exact reserved-key and conflict diagnostics.
- Added complete keyboard navigation for workshop menus, tablists, toolbars,
  dialogs, drawers, and the assembly entity tree, including roving focus,
  type-ahead, and opener restoration.

### Changed

- Routed existing Inspector identity, status, ports, power, charge,
  misalignment, structural-load, controller, sensor, and selection-scope facts
  through the application inspection boundary and the shared text debug model
  without changing their visible labels. Portable optional authored fields now
  survive blueprint load, editor sync, duplicate/mirror, Undo/Redo, workspace
  persistence, My Parts, and share exchange.
- Adopted `C` for duplicate and `X` for selected-component deletion while
  retaining `Ctrl/Cmd+D`, `Delete`, and `Backspace` aliases; Exploded View moves
  to `Shift+X`. Duplicate now places the complete selected group in the first
  deterministic snapped clear position from the hovered face or toward the
  camera, enforces the board edge for board-authored selections while
  preserving intentional Test Reserve coordinates, preserves internal
  connections and controller bindings, enters Move, reports bounded placement
  evidence, and rolls back atomically if cloning fails. Visible hints and
  `aria-keyshortcuts` follow live remaps.
- Assigned number-row 1, 2, and 3 exclusively to Build, Connect, and Simulate,
  and moved front, side, and top camera views to Numpad 1, 3, and 7.
- Reduced workshop clutter with mutually exclusive component-library and
  inspector drawers at laptop widths, compact Direct Control disclosure outside
  Simulate, larger challenge diagnostics, and a focused Mechanism Lab workspace
  with its own exact assembly outliner.
- Split the Inspector's entity tree and selected-component details into bounded
  scroll regions, keeping identity, action impact, Frame, and Isolate visible
  at laptop widths while retaining the exact keyboard-navigable entity tree.

### Fixed

- Removed controller bindings that target deleted components as part of the
  same undoable selection deletion; Undo restores both the component and the
  exact binding manifest.

- Replaced the workshop build plate's 0.65 m vertical perimeter ledge with four
  authored, continuously graded concrete apron ramps. Tire contacts also now
  zero Cannon friction rows that were already queued before the authored brush
  law took ownership, preventing driven wheels from locking after they reach
  the triangulated Test Reserve terrain.
- Prevented a one-ended Rope attached to a wheel-like component from starting
  inside the wheel or build plate and injecting launch energy. The endpoint now
  follows its exact anchor: an axis attachment does not wind Rope, while an
  off-axis attachment produces ordinary centerline motion, force, torque, and
  contact.
- Updated transitive PostCSS from 8.5.17 to 8.5.23 and Nano ID from 3.3.15 to
  3.3.16, resolving GHSA-r28c-9q8g-f849; the supported-runtime npm audit now
  reports zero vulnerabilities.
- Prevented the Suspension Rover from shedding wheels during an ordinary
  workshop-platform drop by matching Wheel carcass travel to its authored
  tire/rim geometry, resolving every joint-reaction row at its actual anchor
  (including spring/damper travel limits), and covering the complete four-wheel
  landing rather than the first field contact.
- Corrected the Suspension Rover's semantic left/right steering bindings and
  added signed trajectory coverage for both deterministic and browser input
  paths.
- Restored responsive steering in the Suspension Rover by giving its front
  linear guides physical clearance from the steering knuckles and hub motors,
  with a stable steering range and deterministic collision/turn-response
  regression coverage.
- Reorganized the public documentation around a central audience-based index,
  clarified that Simulacrum Core is currently source-checkout-only, and corrected
  stale engineering-analysis, mechanism-coverage, import, sensor, tutorial, and
  contributor guidance.
- Made ground support and rolling resistance resolve from the canonical contact
  point and material law across tires, feet, skids, landing legs, and loose
  parts, including bounded soft-surface compliance and sinkage.
- Made focused native and composite widgets retain their conventional keys,
  while canvas-only camera and machine controls remain scoped to the 3D
  workspace.
- Released every held camera, Remote, and Direct Control command on key or
  pointer release, cancellation, focus or visibility loss, reset, rerender, and
  disposal so hidden or interrupted controls cannot remain active.
- Made Demos, Challenges, Environment, Remote, and Logic Workbench mutually
  exclusive across toolbar and Learning Center entry paths, preventing hidden
  panels from intercepting actions or retaining live commands.

## 0.1.0 - 2026-07-22

First public release of Simulacrum: a component-driven engineering sandbox for
building, programming, simulating, testing, sharing, and diagnosing mechanical
systems in a continuous Earth-scale environment.
