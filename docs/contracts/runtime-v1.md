# Runtime contract v1

The workshop has one strict machine format, one command surface and one read model.
All production advancement uses 1/120 s ticks. A tick publishes only after its nine
phases complete: sensor snapshot, controller commands, power/signals,
actuators/constraints, environment/forces, integration/contacts, structure/failure,
thermal/ablation, telemetry. Controllers at tick t consume the completed sensor
snapshot from t-1. Tick zero has a declared initial snapshot.

## Observation and edits

`observe(scope, detail, cursor)` returns immutable values and a cursor
`{session, epoch, revision, tick}`. Revision increases for each published tick and
accepted paused edit, even if tick does not change. Restore starts a new epoch and
publishes a full snapshot; tick may go backwards, revision never does. A foreign
session, old epoch, future revision or expired delta window returns `RESYNC_REQUIRED`
with a full snapshot. Tick alone is never an observation cursor. Rejected commands
publish no mutation. Scope and detail select views of the same read model.

`act(command)` returns `{ok, reasonCode, path}` with model-owned enum codes. UI text
maps each code to a useful sentence. Build, connect, configure, program and run use
this surface. Checkpoint and restore are player capabilities, disabled during an
unbroken qualifying run. No callback observes partially integrated state. Each step, elapsed-time or runUntil call
accepts at most 28,800 ticks; callers can continue interactively with further bounded calls.

## Saves and checkpoints

A save envelope declares the single current format version (3). Load rejects
other versions explicitly. This pre-release product carries no historical save
readers or migration chain; bundled blueprints and tests use the current schema.
Runtime readers validate that current schema before accepting authored data.

A completed-tick checkpoint contains all state affecting future execution: library
snapshot, networks, controller state, previous sensor snapshot, input queue, clock
accumulator, random generator, evaluator state and recorder anchor. Admission and
restore validate before replacing state. No live library object escapes the physics
door. A failed tick poisons the session; it publishes failure evidence, cannot continue
or issue a checkpoint, and may recover only by validated restore or a new session.

## Bounded failure evidence

Interactive history is a rolling replay window, not an unlimited tick-zero log.
Every 1,200 completed ticks create a replay anchor, retaining at most two intervals
and 600 detailed telemetry frames. Each anchor embeds the complete checkpoint,
blueprint, programs, environment, configuration and implementation identity needed
for its interval. Inputs carry epoch, tick, sequence and payload. Admission is bounded
at 64 commands/tick and 64 KiB/command; exceeding either fails `INPUT_LIMIT` without
mutation. Blueprint/program size bounds belong to the runtime schema. Evidence records
its retained start tick explicitly and does not claim earlier history is present.
The failure bundle contains that anchor plus every accepted input through failure;
no interval is silently truncated. Failed step inputs are retained with their outcome.

Qualification is a bounded exception: retain the full input history from tick zero
for at most 28,800 active ticks (240 s), plus the declared initial hold. Only initial
Go and the fixture's frozen disturbance schedule are permitted. Resets, edits,
restores and unscheduled inputs invalidate the attempt. Bundle identity covers
source/build, runtime/library versions, blueprint, programs, environment, evaluator,
configuration, renaming seed and input trace. Hashes are integrity identities, not a
substitute for embedded inputs or preserved executable builds.

Determinism initially means the same runtime and library binary across two processes
and both clock drivers. A declared model projection includes authoritative state and
excludes wall-clock timing and diagnostic labels. Per-phase timings remain in the
same telemetry frame outside that projection. Performance and cross-runtime portability
are distinct claims, measured separately.

## Delivery order

The manifest owns milestone allocation. M1 decides the physics library and proves
fixed-step replay before M2 expands authoring. M3b delivers a playable loop and needs
real designated-player acceptance under F1 v2 plus instrumented F2 before progression. M4 isolates programs;
M4b demonstrates every physical feasibility stage before M5 breadth. M5 freezes the
Course apparatus and proves rover L0. M7 requires L1a, L1b and L1c. M8b integrates
WebMCP through the player's command surface. M9 requires the unbroken legged Course,
held-out robustness and all final product gates on one final source identity.

Ascent failures retain competing plant, power, controller, terrain, evaluator and
engine hypotheses. Torque, charge, clearance and contact traces decide the repair.
A green invariant battery reports only that no checked defect fired.

## Powered component slice

Socket-based mechanical connections use catalog-owned local port frames; surface
mounts resolve catalog-owned regions and authored offsets as specified below. A fixed mount's local
+X axis is its outward surface normal; mating normals oppose with a half-turn
around local Y. Shaft frames coincide. Snapping moves the destination's entire
mechanically connected group rigidly, preserving existing joints. A loop whose
ports cannot already meet is rejected. Power and signal wires never move parts.
Port positions are the shared endpoints for authoring, physical joints and visible
connections; a wire is not a structural attachment.

Power cells, wires, motors, shaft joints, receivers and axis rotation sensors are
ordinary authored components. Connecting a cell to a motor defaults to full duty;
a wired receiver overrides that duty, including zero. Torque acts equally and
oppositely on the motor housing and its shaft load. Charge and dissipated energy
are checkpointed; cell heat and motor/driver heat are reported separately. The
current electrical solver admits one cell and one motor per connected power
component; unsupported parallel topology is refused explicitly. At M3, each
joint-connected assembly admits at most one powered motor. Coupled electrical
allocation must be implemented before the multi-joint M4b plant; a bare-body
inertia estimate does not bound acceleration under multiple coupled actuators.

The driver holds a bounded current for a tick, reducing effective motor voltage
and dissipating surplus energy. Post-integration shaft work is measured from
torque and midpoint relative speed. Copper, cell and driver dissipation are
separate quantities. An allocation that cannot pay for measured work and
resistive heat fails the energy invariant; no pose or force correction conceals
the failure. This accounting is not proof of total-world contact conservation.

M3 controller tests inject trusted host doubles at phase 2. Each sees only frozen
readings from sensors wired to its component and may command only wired receivers.
These doubles are not a player program runtime or sandbox evidence. Production
player programs remain gated on M4 isolation and fuel enforcement.

## Reversible construction

The construction surface supports strict `insert` of a fully authored part,
`disconnect`, connected-group `transform`, `undo` and `redo`. Insert passes the same
runtime blueprint validation as other authoring. The guide issues these ordinary
commands one step at a time; no runtime dispatch reads the guide or blueprint name.
Editor history retains at most 50 prior authored blueprints. Failed/no-op edits
leave history unchanged; new edits clear redo. Run/pause/reset do not add edits.
Load and checkpoint restoration explicitly clear editor history. Availability is
published as `metadata.editing`, part of the same read model. Gizmo previews are
separate render objects; accepted poses appear only after the authoring command.

The starter vehicle is a thirty-second construction feasibility fixture, not L0
or Course qualification. Its powered and powerless controls, housing clearance,
continued final-interval travel and checkpoint continuation are exercised in the
unit tier. The browser construction obligation also builds it through visible
controls and checks thirty seconds of travel, disconnect, group movement and undo.
The fixture turns; it does not provide steering. Canonical cylinder collision
approximation is documented in the physics contact ADR.

### Surface mounting (M3b)

Save version 3 represents every structural fixed connection with surface bindings
`{part, surface:{region,u,v,twist}}`. `{part,port}` bindings are only for power,
signal and shaft sockets. There is no duplicate fixed mounting socket path. Surface regions are catalog-declared planar mounting
faces. Their local X is the outward normal, Y is the u tangent, and Z is the v
tangent. Coordinates use metres and radians. A surface connection's a endpoint
is the receiving region and b is the centered source pad. Resolved normals oppose
using the existing fixed-joint convention. The compiler emits ordinary fixed
joints; surface placement grants no special force, support or power.

`surface-mount` atomically proposes and commits selected-group placement, optional
part insertion, and optional fixed attachment in Build. `replaceConnection`
removes the chosen fixed edge in a temporary graph before computing the moving
component. The selected source group moves; the receiving part remains fixed.
A remaining mechanical path to the receiver refuses adjustment. An optional
`expectedCursor` rejects stale requests. Preview is transient authoring state;
it does not write completed physical poses. Undo restores the entire transaction.

The catalog-declared source pad must fit on the receiving face; each source pad
is exclusive. A housing can overhang while its smaller declared pad remains fully
supported. Pad geometry is shown on the part and in its placement preview. Canonical body and exposed-shaft placement envelopes reject
intersection between the mounted group and surrounding parts. Cylinders currently
use conservative enclosing boxes for placement admission. Load and compiler apply
the same surface geometry admission. These checks are geometric admission, not
proof of load capacity or powered motion. Misaligned surface frames are diagnosed and do not produce a joint; they are
not silently repaired. Electrical and signal
wires never become structural attachments.
