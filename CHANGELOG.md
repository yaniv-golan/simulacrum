# Changelog

## Unreleased

### Added

- Added the full 480 m x 360 m Workshop Test Reserve as one connected campus
  around the construction board and operations building. Its closed road
  network joins nine physical districts with 22 authored surface regions, 11
  measurable terrain features, a shallow ford, an irregular deep pond and dry
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

- Assigned number-row 1, 2, and 3 exclusively to Build, Connect, and Simulate,
  and moved front, side, and top camera views to Numpad 1, 3, and 7.
- Reduced workshop clutter with mutually exclusive component-library and
  inspector drawers at laptop widths, compact Direct Control disclosure outside
  Simulate, larger challenge diagnostics, and a focused Mechanism Lab workspace
  with its own exact assembly outliner.

### Fixed

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
