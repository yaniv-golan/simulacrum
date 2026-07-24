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
