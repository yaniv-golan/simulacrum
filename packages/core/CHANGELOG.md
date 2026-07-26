# Changelog

## Unreleased

- Replaces the public component geometry descriptor with strict
  `GeometryDescriptorV2`: one model-owned projection now supplies collision and
  physical-body primitives, canonical port frames, anchored physical features,
  class-specific deformation/runtime contracts, provenance, and separately
  named bounds. Alternate catalogs must register the same complete contract;
  missing geometry and invalid connection frames fail closed. This intentional
  API cutover and the corresponding authored-asset migration are queued for
  Core `0.2.0`; no portable wire schema changes.
- Adds strict authored-assembly projection and fingerprint contracts plus
  immutable direct component-relationship and authored-preflight inspection
  APIs. These additive APIs are queued for the next minor `0.x` release; the
  source workspace remains `0.1.0` until that release transaction.
- Adds the `flexible-line-v1` compiler/runtime contract, one-to-many physical
  entity ownership, tension-only constraints, strict Rope materials, completed
  telemetry, failure evidence, and exact checkpoint state.
- Adds `TestSiteTelemetrySystem` and `TestCourseSystem` to the DOM-free
  fixed-step surface for canonical proving-ground state and type-independent
  guided-trial evaluation.
- Extends mobility telemetry with exact support-material identities and laws,
  soft-surface sinkage, and rolling-resistance multipliers.

## 0.1.0 - 2026-07-22

- Introduces the DOM-free Simulacrum Core facade for strict blueprints,
  workspaces, reusable assemblies, share packages, controller programs,
  mechanism artifacts, runtime checkpoints, and telemetry playback.
- Provides the fixed-step `SimulationSession`, component-resolved power,
  signals, actuators, constraints, terrain, fluids, aerodynamics, structural
  failure, thermal behavior, and ablation systems.
- Provides TypeScript, Visual Logic, and WAT controller tooling with explicit
  endpoint bindings, bounded execution, physical power and signal routing,
  conflict detection, and deterministic sensor snapshots.
- Provides extension hooks, engineering analysis, challenge proof contracts,
  sharing identities, and package examples for browser and Node consumers.
