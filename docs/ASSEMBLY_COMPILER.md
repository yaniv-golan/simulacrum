# General multi-body assembly compiler

## Purpose

Simulacrum construction data describes parts, transforms, ports, and
connections. It must not describe a rover, humanoid, drone, or missile runtime.
The assembly compiler turns that reusable construction graph into physical
bodies, constraints, force elements, and drivetrain couplings.

This is the boundary between persistent blueprints and transient physics:

```text
AssemblyModel snapshot
  -> strict explicit endpoint validation
  -> physical topology compiler
  -> engine-neutral rigid and flexible compiled assembly
  -> Cannon runtime adapter
  -> immutable poses, loads, and diagnostics
```

The compiler is deterministic and DOM/renderer-free. A future server solver,
WASM solver, replay worker, or alternate renderer can consume the same compiled
topology.

## Connection contract

Every connection stores `portA` and `portB`; endpoints are never inferred.
Physical mechanical and mesh edges additionally store a `capacity` with
positive `ultimateForceN` and `ultimateTorqueNm`. Multi-use structural surfaces
also carry distinct local-metre anchors. Power and signal edges forbid
structural capacity. Missing, unknown, incompatible, or occupied endpoints are
rejected before compilation.

Connection medium and physical behavior are deliberately separate:

- `power` and `signal` produce network edges, never physical constraints;
- `resource` connects only opposite-direction ports declaring the same
  non-empty material medium and produces a failure-aware feed-topology edge;
- a fixed mechanical attachment produces a breakable fixed constraint;
- a shaft/axle mount produces a revolute constraint;
- a gear mesh produces a compliant ratio coupling and reaction loads;
- a hinge connected to two bodies produces one limited revolute joint;
- a spring connected to two bodies produces one spring-damper force element;
- a lever pivot produces a revolute joint and its link produces a linkage.
- a `flexible-line-v1` component produces plural distributed physical entities,
  tension-only internal edges, and exactly two explicit free or point-attached
  boundaries; it never produces a rigid proxy body.

Ambiguous or incomplete mechanisms remain in the compiled result with a
diagnostic. They do not gain hidden supports or demo-specific behavior. For
example, an unsupported output gear is not silently pinned to the world.

## Runtime invariants

1. Physics never reads demo identity, rendering objects, or DOM state.
2. All compiled bodies use blueprint transforms and catalog mass/geometry.
3. Forces and torques have equal-and-opposite reactions.
4. Motors consume routed electrical energy and apply bounded torque to a
   revolute drivetrain; they do not directly animate meshes.
5. Gear ratios arise from pitch-motion constraints, including tooth compliance,
   damping, and reaction torque.
6. Springs use displacement and relative velocity, not elapsed-time animation.
7. Presentation consumes part poses and joint telemetry keyed by model part ID.
8. Structural failures can remove the originating compiled constraint without
   rebuilding unrelated bodies.
9. Connector components such as hinges are virtual constraint bindings in the
   shared body registry, not duplicate rigid bodies.
10. Articulated control reads the previous completed body/contact snapshot.
    Stance comes from identified external contacts, normals, impulses, relative
    velocity, the support polygon, and capture-point stability.
11. Finite material stores derive capacity, initial usable mass, outlet, fill
    law, storage solid, and storage axis from strict component contracts;
    density and available specific energy come only from the model-owned medium
    registry. Pressure nozzles derive flow and force from their compiled inlet,
    rated curve, axis, application point, delivered material, and ambient
    pressure. Store depletion and ablation change mass, COM, and inertia through
    the single post-thermal mass-property transaction.
12. A mass-changing part may use fixed attachments but compilation rejects
    non-fixed constraints whose local-frame remapping is not yet supported.
    Valid-looking assemblies never defer that topology failure until runtime.
13. Flexible-line discretization is deterministic and recorded as
    `flexible-line-discretization-v1`; one Rope is bounded to 64 axial elements
    (65 nodes) and an assembly to 512 flexible entities.
14. One authored part may own multiple physical entities. After an internal
    edge fails, those entities may belong to separate derived physical
    components while preserving the same source-part provenance.
15. Every rigid body belongs to one deterministic `fixed-rigid-cluster-v1`
    descriptor. Tree clusters expose independently reachable child partitions
    and authored attachment frames for Newton-Euler cut balance. Cluster-frame
    attachments are composed from each member transform and authored part
    frame, then revalidated before use. The topology carries the complete fixed
    edge identities and endpoints used to prove connectivity and cycle rank
    rather than trusting a duplicate count. Rigid loops expose their cycle rank
    and no unique cut wrench until compliance or an authored load-sharing law
    makes that distribution determinate.
    The complete compiler result and every cluster descendant are recursively
    frozen before publication. Public cut-frame and cut-wrench oracles accept
    only the live compiler-owned cluster object; detached or reconstructed
    records are data copies, not physical authority, and fail closed. The
    provenance registry is private to `compileAssembly()`; no exported marker
    or registration helper can promote a caller-frozen clone into authority.
16. Compiled physical identifiers remain injective when valid numeric and
    string IDs coexist. A namespace with an exact cross-type collision uses a
    deterministic length-prefixed projection for all of its string IDs; no
    body, constraint, provenance source, cut identity, or connection telemetry
    key is silently merged. Pair identifiers retain the legacy delimiter form
    only when both endpoint tokens are delimiter-safe; otherwise they use the
    typed length-prefixed pair encoding.
17. A tree cut oracle is available only when member states, parent ownership,
    `N - 1` cuts, descendant partitions, and the complete cluster descriptor
    form one exact connected tree. The oracle takes the current cluster-root
    pose and derives world cut points from the descriptor's revalidated authored
    child frames; caller-supplied cut positions are not an authority. Each fixed
    cut also has exactly two physical endpoint owners. A direct fixed connection
    owns both endpoints, while a compiled two-ended rigid element records its
    source connections in physical A-then-B order and retains one source at each
    real endpoint. Each attachment frame independently carries its source
    connection identity, so swapping summary and failure arrays together cannot
    relabel the physical endpoints. Missing, duplicate, contradictory, or unused
    authority fails closed. The root member is the exact cluster-frame origin,
    descriptor identity and aggregate mass are derived from member authority,
    and aggregate mass properties are recomposed before use. Fixed-edge
    capacities, outgoing endpoint records, and per-member runtime-mass
    capability kinds rederive the descriptor's fixed, failure, boundary, and
    dynamic-mass summaries. Nested endpoint point-mass provenance carries both
    source and target parts and ports plus the owner of `positionPartM`; the
    compiler re-derives that complete relationship and target-side frame from
    the active connection graph before composition. Descriptor membership must
    match the supplied dynamic member-state set exactly, including singleton
    clusters; singleton root poses are still validated. Frame/world emission,
    aggregate COM/volume, and Newton-Euler force/torque/magnitude calculations
    are finite-result closed: representational overflow fails before use. The
    public oracle requires explicit gravity and uniquely identified external
    loads with explicit application points and couples. Its result is always
    conditional supplied-load evidence with `failureAuthority: false`; only a
    future runtime-owned complete load ledger could authorize failure decisions.
18. Positive-definiteness, physical moment inequalities, and principal-axis
    decomposition are evaluated after scaling out the inertia tensor magnitude,
    avoiding overflow or underflow without introducing a model-size threshold.
    Nested mass-property and inertia records have closed field sets, and the
    completed principal moments and axes must remain finite.
19. Cluster members, edges, cuts, and emitted cut frames share one total
    numeric-aware compiled-ID comparator. Solver constraints preserve the
    explicit `condensed-connector-v1` class before the
    `direct-connection-v1` class, then use canonical authored source identity
    within each class. The compiler stage authors this numerical class;
    provenance cardinality is never interpreted as solver policy. This keeps
    equivalent authored arrays on one finite-solver conditioning order without
    dispatching on component or demo identity. Existing
    collision-exclusion array
    ordering remains on its frozen legacy projection; checkpoint import
    authenticates the exact exclusion identity set before mutating physics and
    derives every restored exclusion's required activity from the restored
    constraint state rather than trusting a serialized boolean. Physics body
    identities must be a unique exact match for both compiler-owned bodies and
    the live runtime registry. Every runtime-consumed compiler collection is
    emitted in one total ID order; authored array order therefore cannot alter
    Cannon body/constraint insertion or continuation. The physical-semantics
    fingerprint preserves those canonical execution arrays, so a forged
    body/constraint/network reordering changes run and checkpoint identity.
    Direct multibody import validates a closed,
    detached, finite, physically consistent candidate before touching any live
    solver object. Run identity and all
    compiled-topology, physics-world, and solver-contact checkpoint owners bind
    a canonical fingerprint of the complete compiled physical semantics rather
    than an ID-only topology summary.
20. `compileAssembly()` validates unique canonical part and connection
    identities itself before constructing any maps or emitted collections and
    accepts each assembly snapshot and component catalog only as serialized
    JSON or a package-issued immutable root. An arbitrary object is rejected by
    unforgeable root identity before property, prototype, key, or descriptor
    inspection; the accepted graph is detached before every later compiler
    stage, so no lazy lookup can observe a second revision;
    direct callers cannot bypass wire/model uniqueness and create last-wins
    physical authority. Checkpoint collision offsets and orientations are
    re-derived from the compiled collision primitives and the validated target
    mass frame, while endpoint point-mass provenance must exactly match the
    compiler-owned source/target topology. Dynamic mass is reconstructed by
    its exact material, pneumatic, or ablative target payload during pure
    prevalidation; direct physics state must equal that target projection before
    any owner is mutated and cannot mint contributor kinds. Fixed solver frames,
    complete per-kind constraint
    scalar sets, and the tire-state record schema are authenticated before
    mutation. Restoring this owner's active
    constraints replaces only its existing solver slots and preserves every
    other owner's relative order; if the whole block was inactive, its
    runtime-start predecessor boundary supplies the deterministic insertion
    point.
21. Engine startup preflights every compiled body through the same finite,
    positive mass/inertia and reciprocal projection used by dynamic commits;
    one unrepresentable body rejects the start before any body enters the world.
    Body, constraint, rolling-support, and exclusion installation is atomic and
    preserves pre-existing world owners after an injected failure. A running
    runtime rejects restart before mutation. Private live authority binds exact
    Cannon body/shape geometry and policies, stable constraint equation object,
    body, enabled, SPOOK, restitution, and force-bound authority,
    membership/activity, and collision exclusions; checkpoint capture fails if
    out-of-band engine mutation changes any of them.
    Initialization, each fixed tick, and checkpoint reconstruction compare each
    mutable-mass owner's complete record sequence against the compiled
    numeric-aware typed-ID authority. Missing, duplicate, extra, reordered, or
    wrong-kind records fail closed rather than collapsing through a `Map`.
    Ablative target state must conserve initial mass exactly and retain the
    positive residual required by a still-existing finite-inertia body.
    Checkpoint capture applies the full detached multibody validator to the live
    engine projection—including scalar and reciprocal mass state, frames,
    shapes, constraints, and compiled metadata—before any owner payload is
    digested. The world adapter also binds fixed step, iteration budget, and
    tolerance as live solver authority; integration/capture reject drift and
    checkpoint import restores the attested profile. Run configuration creation
    requires that effective adapter projection and hashes it directly.

## Planned evolution

The engine-neutral output uses explicit `kind` and `parameters` fields rather
than Cannon classes. Bearings and linear guides are current components;
linear-guide descriptors execute as prismatic constraints. Compatible future
additions include ball joints, universal joints, rack-and-pinion, belts/chains,
differentials, hydraulics, docking joints, and deformable connection
models.

The Cannon adapter currently implements fixed, revolute, prismatic/linear-guide,
spring, linkage, shaft/bearing, gear, wheel-suspension, and role-assisted
articulated behavior. `FlexibleLineRuntime` adds unilateral distributed Rope
constraints and contact inside the same world and integration transaction.
Wheels, articulated machines, Rope, propulsion, aerodynamics,
thermal response, ablation, structural failure, fluids, and terrain contact
share the descriptor-compiled bodies, body registry, and single fixed world
step. Aggregate vehicle telemetry is derived from those bodies and never owns
or integrates a second pose.

## Current physical coverage

The compiler and shared runtime now own arbitrary-topology diagnostics;
gearbox, lever, spring, wheel suspension, and tire forces; explicit articulated
hinges; distributed flexible lines; flight and aerodynamic forces; thermal
response; ablation; and
detachment. Rover, fixed-humanoid, and standalone-flight body owners no longer
exist. New mechanisms must extend the same descriptor, compiler, and shared
runtime contracts rather than add a model-specific body owner.
