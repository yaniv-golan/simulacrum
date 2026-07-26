# Changelog

## Unreleased

- Adds explicit pneumatic tire chambers, conserved dry-air mass and energy,
  pressure-coupled contact support, powered compressor/three-way-valve control,
  tire-pressure sensing, telemetry, dynamic gas mass, and exact checkpoint v2
  state while preserving the explicit fixed-compliance tire law. Checkpoint v1
  is rejected because it cannot contain the required `pneumatic-gas` owner.
- Adds strict authored-assembly projection and fingerprint contracts plus
  immutable direct component-relationship and authored-preflight inspection
  APIs. These additive APIs are queued for the next minor `0.x` release; the
  source workspace remains `0.1.0` until that release transaction.
- Adds deterministic endpoint-aware power, signal, and resource route evidence,
  bounded live session tokens, and digest-matched owner queries without making
  path witnesses into flow or controller-causality claims.
- Advances the existing `material-resources` checkpoint owner to version 2 for
  atomic allocation sequence/last-tick state and advances the checkpoint-state
  digest domain. Pre-cutover owner-v1 checkpoints are intentionally rejected by
  the strict current decoder; the top-level checkpoint remains version 1.
- Adds the `flexible-line-v1` compiler/runtime contract, one-to-many physical
  entity ownership, tension-only constraints, strict Rope materials, completed
  telemetry, failure evidence, and exact checkpoint state.
- Adds `TestSiteTelemetrySystem` and `TestCourseSystem` to the DOM-free
  fixed-step surface for canonical proving-ground state and type-independent
  guided-trial evaluation.
- Extends mobility telemetry with exact support-material identities and laws,
  soft-surface sinkage, and rolling-resistance multipliers.
- Adds strict fixed-pitch rotor model/compiler/runtime contracts and exact
  solver-row motor-energy settlement with checkpointed work, loss, heat, and
  completed propulsion provenance.

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
