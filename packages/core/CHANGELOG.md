# Changelog

## Unreleased

- Close the first-principles rigid-cluster mass/checkpoint authority boundary:
  the existing public runtime/registry mass setters now fail closed while the
  package-internal transaction accepts projections only from the coordinated
  material, pneumatic, and ablative owner. It detaches and validates one plain
  finite data graph, requires exact contributor order and finite engine
  reciprocals, and restores complete body, collision-cache, solver-mass, and
  fixed-frame state after any late engine exception. Runtime start performs the
  same finite reciprocal projection before adding the first engine body.
  Initialization, every fixed tick, and checkpoint reconstruction require each
  mutable owner to expose the exact compiled typed-ID sequence with no missing,
  duplicate, extraneous, reordered, or wrong-kind record; material-resource
  iteration now uses that same total order, and the aerothermal mass port emits
  only actually ablative parts. Checkpoint capture fully validates live body,
  frame, shape, scalar mass/inertia, reciprocal, and constraint state and rejects
  registry/physics mass disagreement before digesting; restore requires every
  compiled mutable-mass owner, accepts only canonical absent-owner payloads,
  validates nested tire state and physical connection-load identities, and
  preserves exact body-to-constraint linkage in `BodyRegistry`. Registry
  checkpoint restore is package-internal and validates load provenance against
  constructor-owned connection identities. Its public revision is a digest of
  exact owned content rather than a live-history counter, so rewind and late
  rollback cannot leak a future revision. Constraint checkpoint scalars enforce
  physical energy, dissipation, temperature, and derate ranges.
  Restore prevalidation derives target mass, COM, inertia, and pneumatic-gas
  inertia directly from validated target owner payloads, so an older valid
  checkpoint need not match live mutable mass before the transaction starts.
  Live Cannon body/shape geometry and policy, constraint frames/equations,
  world membership, and collision exclusions are checked against private
  compiled authority. Startup and direct import roll back exact installed or
  imported engine state after injected late failures, and restart while running
  fails before mutation. The checkpoint cutover uses owner version 2 for every
  owner except the exact version-1 `flexible-line-runtime` and
  `release-couplers` projections.
  Stable equation authority includes exact row bodies, enabled state, SPOOK
  coefficients, restitution, and owned force bounds. Compiled physical identity
  preserves canonical runtime collection order, and direct compiler stages
  consume only detached snapshot and catalog plain-data graphs. Command-bus
  targets and external input-trace checkpoints/wire/playback use injective
  typed IDs, preventing numeric and
  same-spelling string identities from sharing command or state authority.
  Input-trace wire version 2 stores numeric and string target IDs without
  coercion; ambiguous version-1 traces fail closed instead of being guessed.
  Explicit compiler-authored `condensed-connector-v1` and
  `direct-connection-v1` classes preserve finite-solver insertion policy
  without inferring it from provenance cardinality. Public checkpoint, direct
  owner, controller, and WAT imports accept only serialized JSON or an
  exporter/parser-issued deeply frozen root. Arbitrary objects, accessors, and
  Proxies are rejected by identity before property or structural inspection.
  Direct assembly compilation, multibody startup, component catalogs, and
  checkpoint runtime identities use the same zero-trap boundary. Solver/tire
  owner projections are closed and cross-checked against physics; derived
  power and signal read models are reconstructed from the run graph rather
  than restored as mutable checkpoint state. Session accumulators and
  body/world counters reject finite but unreachable states. Checkpoint JSON
  decoding returns the same issued immutable form. Pneumatic graph nodes
  preserve numeric/string identity.
  The world adapter checkpoints and live-attests fixed step, solver iterations,
  and tolerance; integration/capture reject drift, import restores the profile,
  and run identity hashes that effective projection. Ablation projections
  conserve initial mass exactly at the generic positive dynamic-body residual
  and reject rather than clamp a below-residual value. Checkpoint mass planning and mutation remain
  package-internal functions rather than public `MassPropertyCommitSystem`
  methods.

- Replaces the runtime's part-metadata material callback with
  `materialForKey`. Every Cannon shape now receives the material authored by its
  compiled collision primitive, and contact coefficients come from canonical
  symmetric material-pair laws. Demo identity and presentation `rigRole`
  metadata no longer select friction or contact behavior.

- Makes generic powered rotary coordinates execute the complete authored
  position-impedance law. Normalized targets map through the authored command
  range, while stiffness, damping, maximum speed, torque, allocated electrical
  power, motoring efficiency, idle draw, and winding thermal limits bound the
  Cannon motor row. Solver-metered positive work is settled against source
  energy, unsupported regeneration becomes heat in exactly one thermal owner,
  and checkpoint restore requires electrical input to equal net mechanical
  work plus dissipation. Flexible-line constraint evidence also retains
  injective numeric/string source-connection identity.

- Adds engine-neutral authored fixed-attachment frames and endpoint-specific
  failure ownership to compiled assembly constraints. Constraint solvers retain
  their existing reference frames; reaction wrenches are translated to each
  physical attachment before structural-capacity evaluation. Structural
  detachment severs boundary connections while preserving connections internal
  to the separated physical component.
- Adds deterministic `fixed-rigid-cluster-v1` compiler descriptors with
  authored member transforms, aggregate mass and inertia, fixed and outgoing
  boundaries, mutable-mass membership, and unique tree cut partitions. A pure
  Newton-Euler verifier reconstructs parent-on-subtree cut wrenches from
  measured accelerations and external loads; rigid loops fail closed instead
  of inventing a statically indeterminate load split. Compiled physical IDs
  remain injective across valid numeric/string source IDs, tree availability
  and connection telemetry, tree availability requires exact
  member/edge/cut/frame authority, release elements retain their two real
  endpoint owners, ambiguous pair delimiters use typed identities,
  failure-evidence retention preserves mixed-type source IDs, member tensors
  are physically validated and principal-decomposed at normalized scale before
  composition, and nested provenance retains endpoint point masses. The public
  reconstruction oracle accepts the complete cluster descriptor and current
  root pose, derives its cut points from authored child frames, and does not
  trust caller-supplied world cut positions; two-ended release provenance is
  bound to physical A/B endpoint order.
  Cluster cuts and emitted frames share one total numeric-aware compiled-ID
  ordering. Per-attachment source identities prevent coordinated summary-array
  relabeling; descriptor identity, root anchoring, source mass, and aggregate
  mass properties are re-derived before use. Fixed-edge capacity,
  outgoing-endpoint, and runtime-mass capability witnesses rederive all
  fixed/failure/boundary/dynamic summary sets, while nested endpoint point-mass
  provenance is validated before composition. Non-finite attachment/world,
  aggregate mass, or Newton-Euler results, invalid singleton poses, and
  mismatched descriptor/state membership fail closed. Physics restore
  authenticates exact body identity against both compiled and live ownership,
  authenticates the exact collision-exclusion identity set, derives required
  activity from restored constraints, and validates its solver-contact
  cross-owner witness before mutation. All runtime-consumed compiler
  collections now use one total authority order, making solver construction and
  checkpoint continuation independent of authored array order. Constraints use
  canonical source-connection identity before derived kind/ID so implementation
  prefixes do not perturb finite-iteration convergence. Direct
  multibody restore validates closed finite body, frame, mass, inertia, shape,
  and constraint candidates before live mutation. Collision frames are
  re-derived from compiled geometry and target mass authority, immutable
  endpoint point-mass provenance must match compiled topology, and restore
  preserves other owners' relative solver-constraint order. Dynamic mass is
  purely reconstructed from target owners before any importer runs and then
  committed owner-first; physics and registry projections must match it exactly.
  Fixed frames, per-kind constraint scalars, and tire-state
  schemas are closed. Direct compiler and body-registry constructor input
  reject duplicate part identities before constructing physical maps.
  Body-registry restore also
  rejects duplicate or contradictory bindings and atomically swaps only a
  completely validated, frozen candidate. The
  compiler result is recursively immutable, and public cluster oracles accept
  only its live compiler-owned descriptors; detached coordinated forgeries
  fail closed. Closed nested mass/inertia schemas and finite completed
  principal decomposition prevent opaque or overflowed mass authority. Run and
  replay identity now hash canonical complete compiled physical semantics, and
  the `compiled-topology`, `physics-world`, and `solver-contact` checkpoint
  owners advance to version 2 with the same semantic witness. Body-registry
  body and constraint replacement validate and freeze their complete candidates
  before atomically changing ownership maps or cached-snapshot revisions.
  Compiler provenance is a private `compileAssembly()` capability rather than a
  general immutable-value marker, and endpoint point-mass records authenticate
  their source and target ports, target part, and part-frame owner against the
  active physical connection before composition.
  The public verifier takes the live compiler-owned descriptor separately from
  serialized root/member/load state and requires explicit gravity and uniquely identified
  external loads with explicit application points and couples. It records the
  complete canonical gravity, force, point, and couple assumptions, labels
  every computed result conditional, and exposes
  `failureAuthority: false`; caller-supplied loads cannot prove completeness.

## 0.2.0 - 2026-07-30

- Extends `GeometryDescriptorV2` with the closed `rounded-box-v1`,
  `spur-gear-v1`, `helical-spring-v1`, and `extruded-profile-v1` body
  primitives. Built-in mechanisms now declare visible-body recipes separately
  from collision approximations.
- Replaces pose-owned axial scale values with stable completed mechanism
  `coordinateId`/`coordinateM` samples. `mechanismDeformationTransforms()` is
  the shared pure transform authority for rendered bodies and deformed bounds.

- Advances the owned Cannon solver transaction identity for the canonical
  rolling-support registration and pre-annotation heightfield contact seam.
  The public Cannon adapter and transaction also expose additive `dispose()`
  lifecycle methods for releasing transaction-owned pools and registrations.
  Checkpoints carrying the previous transaction identity are intentionally
  rejected as part of the Core `0.2.0` cutover.
- Adds explicit pneumatic tire chambers, conserved dry-air mass and energy,
  pressure-coupled contact support, powered compressor/three-way-valve control,
  tire-pressure sensing, telemetry, dynamic gas mass, and exact checkpoint v2
  state while preserving the explicit fixed-compliance tire law. Checkpoint v1
  is rejected because it cannot contain the required `pneumatic-gas` owner.
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
  contract ships in Core `0.2.0`.
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
