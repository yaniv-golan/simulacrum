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
accepted edit that changes state, even if tick does not change. A no-op edit does
not publish a new revision. Renaming changes metadata without rebuilding the physical
session. Restore starts a new epoch and
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
restore validate before replacing state. Session checkpoint version 3 includes receiver
arbitration state, optional bounded numeric program state, typed prior sensor readings,
range continuity history, prior Load Cell reaction evidence when configured, and the
signed constraint-work ledger. Physics envelope version 9 binds the pinned
native backend, gear memory, opened fixed joints, rope memory and work, and latest
completed joint reactions before deserialization. Older opaque checkpoints are
rejected explicitly. For configured Load Cells at completed tick k ≥ 1, physics
holds reaction k and the consumed sensor snapshot holds evidence for reaction k−1.
Each also retains opened-joint topology at that same age; an opened A or B mount
is disconnected, while opening a bypass can make B a measurable bridge.
At tick zero there is no completed force interval: supported joint receipts are
initializing, while sensor readings retain power, mounting and domain validity
precedence. Restore validates receipt ages and topology without advancing physics.
Session checkpoint and blueprint save versions remain 3.

Version 3 admits an optional `environment`: the unchanged legacy `flat` or
`rounded-bump` string, or authored `{objects,ground}` scene data. Omission means
flat. This is compatible admission within the current schema, not a historical
reader or migration chain. Old preset descriptors remain unchanged for visual
recordings and ordinary saves. Opaque checkpoints still require the exact admitted
configuration and runtime identity; no historical checkpoint conversion is added.

Authored scenes contain at most 32 explicitly fixed boxes or X-axis cylinders,
with stable IDs, names, dimensions, positions, quaternions, material, grip and
restitution. Inclined boxes provide straight ramps. Dimensions and transforms are
bounded by the schema; cylinders require equal radii and rotations must be unit.
Scene solids follow the material density and explicit contact selections. They are
outside machine membership, metrics and assembly capture. Matching face-adjacent
boxes with identical cross-section, orientation, density and contact properties
compile as their exact rectangular union, removing internal collision faces.
Individual objects remain independently editable and visible in recording review.
The combined machine bodies, distributed rope nodes, scene solids and floor cannot exceed 4097 physics bodies.
Recording remains a separate subset of at most 512 machine parts, subject to its
unchanged event and session byte limits.

`replace-scene` is a Build-only atomic edit requiring the source cursor. It preserves
the machine and enters chronological workshop history; a rejected edit preserves
both. `choose-environment` retains legacy command behavior. Full-workshop saves
carry both machine and scene, while scene-only library/import envelopes contain
version 1 and scene data only. Assembly insertion preserves the receiving scene.
Admission rejects machine/scene and scene/scene volume overlaps, including shaft
extensions; touching support surfaces and floor embedding remain permitted. The
compiler's explicit `ground: null` removes the floor only. These admission bounds
are not qualification of arbitrary machines, speeds or contact layouts.

No live library object escapes the physics
door. A failed tick poisons the session; it publishes failure evidence, cannot continue
or issue a checkpoint, and may recover only by validated restore or a new session.

### Reusable assembly metadata

Version 3 admits optional strict `assemblies` records with a name, unique ID,
nonempty disjoint part IDs and named one-to-one endpoint aliases. Each alias must
resolve to an ordinary endpoint of a member. Duplicate names (case-insensitive),
duplicate endpoint aliases, unknown members and overlapping groups are rejected.
Deleting a part removes its aliases and membership; empty groups disappear. Other
edits must leave aliases valid or fail atomically. `edit-assembly` changes membership,
name and aliases in one history transaction while preserving the group ID and ordinary
parts/connections. Assemblies create no physical joints.

Machine saves embed every ordinary part, connection and receiver binding. Assembly
names and membership remain authored metadata, never numerical physics configuration.
Library definitions use the same strict blueprint schema with exactly one group
covering every part, and contain only the selected internal connections. Crossing
connections are disclosed at capture and are not copied. Insertion makes fresh,
independent copies with rigid frame transforms and unchanged authored properties.
Receiver bindings retain their ordinary keys; identical keys can operate multiple
receivers, and editing one instance does not change another.

The application owns a separate version-1 browser library (50 items / 2 MiB of JSON
text). Invalid or unavailable storage is reported without replacing existing data.
Library additions, renames and removals are separate from machine Undo. A failed library write
can leave a successfully created group in the machine, with a visible retry path.
New snapshots receive distinct names and expose saved authored settings for inspection.
Saving edited internals as a library item affects future placements only. Loading,
replay and physical stepping require no library access.

## Bounded failure evidence

Interactive history is a rolling replay window, not an unlimited tick-zero log.
Every 1,200 completed ticks create a replay anchor, retaining at most two intervals
and 600 detailed telemetry frames. Each anchor embeds the complete checkpoint,
blueprint, programs, environment, configuration and implementation identity needed
for its interval. Inputs carry epoch, tick, sequence and payload. Admission is bounded
at 64 ordinary commands/tick and 64 KiB/command; exceeding either fails `INPUT_LIMIT` without
mutation. One additional idempotent suspension event is reserved so a full ordinary
input queue cannot prevent Pause or focus-loss cancellation. Blueprint/program size bounds belong to the runtime schema. Evidence records
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
same telemetry frame outside that projection. `tickTiming` also measures completed-tick frame construction (`frameMs`),
publication and periodic checkpoint work, with their total and remaining overhead.
Immutable static model metadata is shared only after admission by the immutable-copy
owner; a caller-frozen object is still copied and validated. Performance and cross-runtime portability
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
current electrical solver admits one cell and multiple motors and sensors per connected power
component; multiple connected cells are refused explicitly. Multiple circuits may
share a joint-connected assembly. Shared-cell voltage satisfies Vbus = Voc − Rcell × Q,
where Q is the sum of duty × winding current plus the sensor load currents. Cell heat is Rcell × Q² × dt,
including cross terms, and charge is debited once. A common winding-rating
fraction enforces total cell current and available energy without first-motor
priority. Bounded coordinate roots solve electrical droop against the ordered
mechanical kick response; nonconvergence rejects the tick rather than supplying
unfunded work. Convergence for every admitted ill-conditioned assembly is not proved.

The DC drive uses first-order operator splitting on the fixed 1/120 s path:
allocate bounded current from completed shaft speed, apply an equal/opposite
angular kick J = torque × dt, then integrate environment, contacts and joints
once. This is an approximation to continuous motor action, not a solved
continuous-current constraint. For the frozen application axis, the physics door
returns measured pre/post-kick speed and full-inertia kinetic energies. Kick work
is J × (speedBefore + speedAfter) / 2 and must agree with the independently
measured kinetic-energy change. Electrical allocation must fund kick work plus
copper and cell losses, with voltage headroom at the kick endpoint. Current,
voltage, charge limits and the existing energy tolerance remain enforced. No
later contact motion can rewrite the electrical allocation or motor work.

Motor kicks follow compiled motor order. Before allocating each current, the power
phase predicts earlier kicks on shared bodies using signed cross-axis inverse
inertia from the physics door. Each actuator receipt checks the actual pre-kick
speed and independently measured kinetic-energy change. The approximation is
order dependent at finite timestep; it does not claim a simultaneous continuous
current solution. Joint and contact redistribution occurs afterward, once per tick.

The completed observation's `energy` ledger separately reports kinetic and
gravitational potential energy (world center of mass), actuator work, external
impulse work, signed `integrationDeltaJ`, and `balanceResidualJ`, all in joules.
`integrationDeltaJ` is the measured mechanical-energy change during the single
integration call; it includes contact/constraint dissipation, stabilization and
gravity-integration error. It is **not driver heat**, and a positive value is
visible numerical energy injection, not a certified physical source. The balance
remainder exposes kick roundoff. These diagnostics do not certify conservative
contact behavior. Rapier's temporal solver subdivision count is frozen at four,
with thirty-two internal projected Gauss-Seidel passes for contact/joint convergence.
These are numerical solver settings applied uniformly to every world; there is
still exactly one production world.step per 1/120 s tick. Both iteration settings
are bound into checkpoint plant identity. Analytical freefall
and passive attached-inertia tests check separate integration effects.

Electrical funding uses the existing per-transfer Float32 tolerance. The
independent kinetic-energy subtraction check scales that same relative roundoff
factor by the endpoint kinetic energies, because subtraction at high spin can
lose precision even when the work is small. It does not enlarge the electrical
funding tolerance. Completed session checkpoints use version 3 and include this ledger;
older checkpoint versions are rejected, without migration. Machine save format
remains 3.

M3 controller tests inject trusted host doubles at phase 2. Each sees only frozen
readings from sensors wired to its component and may command only wired receivers.
These doubles are not a player program runtime or sandbox evidence. Production
Rules and editable TypeScript now use the scoped M3b bounded WASM runtime described below. The broader M4 S1 hostile-program qualification remains separate.

## Reversible construction

The construction surface supports strict `insert` of a fully authored part,
`disconnect`, connected-group `transform`, `undo` and `redo`. Insert passes the same
runtime blueprint validation as other authoring. The guide issues these ordinary
commands one step at a time; no runtime dispatch reads the guide or blueprint name.
Editor history retains at most 50 prior authored blueprints. Failed/no-op edits
leave history unchanged; new edits clear redo. Run/pause/reset do not add edits.
Load and checkpoint restoration explicitly clear editor history. Availability is
published as `metadata.editing`, part of the same read model. Optional `undoLabel`
and `redoLabel` identify a scene edit; restoration clears these with history. Gizmo previews are
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
component. Optional `assemblyId` requires the selected source to be a member of that
editor group and includes every member's mechanical component in the same rigid
transform and collision check. Without it, only the selected mechanical component
moves. The receiving part remains fixed.
A remaining mechanical path to the receiver refuses adjustment. An optional
`expectedCursor` rejects stale requests. Preview is transient authoring state;
it does not write completed physical poses. Undo restores the entire transaction.

The catalog-declared source pad must fit on the receiving face; each source pad
is exclusive. A housing can overhang while its smaller declared pad remains fully
supported. Pad geometry is shown on the part and in its placement preview. All
placement paths and loads reject intersections between canonical bodies and
exposed-shaft placement envelopes, including unattached parts. Bounds prune distant
pairs; cylinders use the same 64-sided convex hull as production collision geometry
for the final intersection test. A separation or contact within 1e-7 metres is
admitted as numerical contact tolerance. Failed edits preserve state and history.
This admission applies to authored starting geometry, not integrated runtime poses.
These checks are geometric admission, not
proof of load capacity or powered motion. Misaligned surface frames are diagnosed and do not produce a joint; they are
not silently repaired. Electrical and signal
wires never become structural attachments.

## Keyboard input ownership (M3b)

An optional strict `controlBinding` on a command receiver maps physical keyboard
codes through two signed input channels and gains to a clamped duty. Presets are
authoring conveniences, never vehicle-type dispatch. The default is held W/S or
up/down. Steering and differential mixing are explicit player configuration. A
custom action is a named receiver with custom keys; it still requires an ordinary
signal connection and actuator capable of that action. No payload-release physics
is implied by naming a receiver.

Bindings persist with the blueprint and support Undo/Redo. Selection does not
redirect keys. The presentation input owner tracks simultaneous held codes and
toggle rising edges, emitting ordinary recorded receiver commands. Keyboard
autorepeat does not retrigger toggles. Input focus, blur and leaving Run reset
keyboard outputs; release of one key preserves other held keys. A zero receiver
command lets a drive motor coast; a position actuator targets its zero angle.
Text fields and browser modifier shortcuts are excluded.
Physics reads receiver commands, never keys, binding names or vehicle labels.

### Assembly copying and actuator inspection (M3b)

`mirror-assembly` is an atomic Build edit over explicit part ids, a reference part
and one of that part's local center planes. It preserves authored physical
properties and internal connections, including mechanical attachments to the
reference, but does not duplicate other boundary connections. Preview and commit
use the same model proposal. Proper rotations must represent the reflected
canonical shapes and mechanical sockets; otherwise admission rejects the edit.
No runtime controller polarity is inferred from names, sides or blueprint identity.

Connection testing uses ordinary Run and receiver commands. It never suspends
gravity, anchors a machine, bypasses a signal owner or supplies hidden energy.
Keyboard and test holds share one receiver input owner. A test hold temporarily
overrides the receiver's keyboard output; releasing it restores that output.
Focus loss and mode changes clear both inputs. A wired script controller excludes
both keyboard and test overrides. A wired position regulator permits deliberate
manual takeover through the same input owner. Live
readouts come from completed telemetry. All-machine motion during a test is
explicit in the interface.

### Powered position joints and constrained work (M3b)

`poweredHinge` maps normalized input, after optional `inputPolarity` (−1 or +1,
default +1), to its authored lower/upper angular limits. Its PI-D voltage driver
uses continuous coefficients Kp (rad⁻¹), Kd (s/rad), and Ki (rad⁻¹s⁻¹). The fixed
1/120 s realization predicts implicit motor speed and midpoint angle. With
`h=dt/(I+k²dt/R)`, `A=kVoc/R`, `B=k²/R`, and `C=(Kp*dt/2+Kd)*h`, its duty is
`clamp((Kp*(target-angle)-(Kp*dt+Kd)*omega+trim+C*B*omega)/(1+C*A), -1, 1)`.
I is the prepared bilateral effective inertia; Voc is the connected source rating
used for prediction. The shared electrical solver independently owns actual
funded torque, voltage droop, current limits and heat. A locked shaft has internal
infinite effective inertia (zero mobility), consuming resistive energy without
mechanical work. Authored and checkpointed data remain finite.

Trim integrates `Ki*error*dt` while the sampled duty is unsaturated or the change
unwinds saturation, bounded to [−1,1]. It clears on target change, unavailable
power and error reversal. Completed hinge telemetry/checkpoint fields are
`angle`, `targetAngle`, `controlDuty`, and `integralDuty`. Feedback uses the prior
completed angle and prepared projected joint speed. Sensor/controller t→t+1
latency is unchanged. Angular stops remain physical constraints, never pose writes.

Power/signals prepares bilateral responses without changing physical state.
Actuators/constraints first applies passive velocity projection to every jointed
island, including unpowered assemblies. Fixed clusters use authored mass and
inertia with parallel-axis terms; free clusters conserve linear and angular
momentum. Revolute reactions share an anchor midpoint. Contacts and angular stops
remain in the single integration. Projected motor impulses include all bilaterally
connected bodies, and torque/midpoint-speed work receipts are checked against
whole-island kinetic change plus independently measured reaction work. For each
body, reaction work is the projected impulse minus the applied motor impulse, dotted
with actual midpoint velocity. It can have either sign because bilateral rows use
finite regularization. The power receipt checks `deltaK = motorWork + constraintWork`
without charging reaction work to the battery or classifying it as heat.
Passive projection loss is separately reported as
`energy.constraintDissipationJ`; it never becomes motor heat. The energy identity is
`deltaMechanical = actuatorWorkJ + constraintWorkJ + externalWorkJ + integrationDeltaJ

- constraintDissipationJ - dampingWorkJ + balanceResidualJ` (damping work is zero without springs).

## Guided springs (M3b)

A `spring` connection joins an ordinary Spring guide to a Spring carriage. Its
numeric physics joint permits axial translation and constrains the other five
relative degrees of freedom. The guide owns stiffness (N/m), damping (N s/m),
zero-force length and travel (m); edits are Build-only. Current save version 3
admits this additional connection and part vocabulary. Wrong pairings, invalid
travel and misaligned loaded endpoints reject before authoring publication.
Disconnecting removes both the guide constraint and elastic/damping interaction.
External mounts follow their respective bodies. No authored body becomes fixed.

The first representation uses solid pads and an ordinary solid open rail, with one
body per part. The coil and connector rod are decoration; their mass is lumped
into the pads, not charged again. They have no turn/rod collision or mounting
surfaces. There is no closed cylinder with a fictitious hollow interior. External pad
and rail collisions remain active, including the guide/carriage pair; ordinary
fixed mounts exclude contact within each transitive component of authored fixed
joints. Distinct grounded components and paths through bearings or spring guides
do not share that exclusion; their contacts and external support contacts remain active. Articulated ends use
ordinary passive bearings and solid axle adapters outside the unchanged five-DOF guide.
A passive pin admits axial twist while retaining axis alignment and collision checks;
rigid shaft connections retain full orientation alignment. Compound solids are not
part of this representation.

Elasticity uses SI `-k x` inside each of the four frozen native temporal
subdivisions (`h = dt/4`), alongside the bilateral joint solve and before unilateral
limits and contacts. Elastic and bilateral rows in each independent joint component
are solved together. Post-integration lever arms are refreshed without resampling
the elastic force. Scalar joint reactions use one common application point; normalized
quaternion basis arithmetic avoids a tiny guide force from representation error.
The single integration and nine phases are unchanged.

The undamped scalar oscillator preserves modified energy `E - h k x v / 2`,
up to numerical error, rather than suppressing the intended bounce. Admission retains
`dt² trace(K W) <= 0.09`; exceeding it produces preserved failure evidence before
impulses are applied. At most eight springs are admitted, with k=0–300 N/m,
c=0–100 N·s/m and 0.08–0.40 m travel. Limits must be ordered and contain the
zero-force length. Stops are unilateral prismatic limits, not pose clamps or a
breakage model. Isolated completed-tick impact bounds do not qualify unseen substep
penetration or actual mechanism clearances.

Active elastic components admit closed joint graphs. The double-precision native
response uses sparse tree factors and a Schur border for loop-closing rows, with
strict residual checks and bounded per-joint refinement. It retains the actual
authored body/joint limits; large loop-rank performance is not qualified. A fixed path, including
separate grounded fixed components, proves zero relative mobility: native elastic
actuation is then omitted while authored stiffness, rest length and potential remain.
Supported unbounded bilateral components use the same factorization even without an active elastic axis. Finite motor caps and unsupported mobility retain the bounded solver. Internal weld prestress
and fracture attribution are outside this model.

During power/signals, the physics door prepares passive projection and simultaneous
damper impulses without changing bodies. Their equation is
`(I + dt C W) J = -dt C v`, with constrained axial mobility `W` and diagonal damping
`C`. Power allocation includes that predicted dissipative impulse; actuators/constraints
applies the same prepared result before funded motor impulses. Elasticity follows in
integration, so it does not appear as a fictitious pre-motor kick. Intervening impulses
reject while an allocation awaits application. Prepared data is tick-local and discarded
on integration or restore. Spring worlds require completed preparation/application
before integration. Loaded sag and energy require independent physical verification;
a passing isolated oscillator is not suspension qualification.

Completed frames include `springs`. `speed` measures separation change over the
completed tick; `endpointVelocity` separately retains the instantaneous solver
velocity used by the law. The preceding sensor snapshot supplies the displacement
comparison, including after checkpoint restoration. At the initial frame speed is
zero. Length, extension, force estimate, travel and spring potential derive from
the completed state. Instantaneous force is an inspection estimate, not a contact
force or measured stop load.

For configurations containing springs, the energy ledger adds `springPotentialJ`
and `dampingWorkJ`. Initial strain is authored starting energy. Damper work is the
discrete `dt sum(c_i v'_i²)` from the simultaneous solve, not an independent
measurement of contact heat. Mechanical energy now includes elastic potential.
The balance becomes
`deltaMechanical = actuatorWorkJ + constraintWorkJ + externalWorkJ + integrationDeltaJ

- constraintDissipationJ - dampingWorkJ + balanceResidualJ`.
`integrationDeltaJ` includes kinetic and elastic changes through native integration,
  with damper work removed from that residual to avoid double counting. It remains
  an explicitly unattributed signed integration/contact residual: numerical error,
  gravity integration, stops and collisions are not separately identifiable heat.
  Checkpoint admission binds spring energy to restored geometry and configuration;
  completed spring values also enter deterministic projection.

## Completed contact observations (M3b)

The physics door returns copied numeric contact rows; the session publishes them
only with completed frames. `sampleTick` identifies the completed tick and
`intervalSeconds` is 1/120 s, or zero for the initial frame. Canonical `a < b` indices
refer to compiled physics bodies, including the explicitly appended environment body.
Each row retains local geometric points and signed separation. The normal is the
frozen solver manifold direction, not necessarily a final-pose geometric normal.
`normalImpulse`, `frictionImpulse` and `pureTwistImpulse` act on body b, with equal
and opposite reactions on a. Linear impulses use N s; pure twist uses N m s.
Pure twist excludes the moments of linear impulses and is not total angular impulse.

Normal and friction observations sum solved temporal subdivisions exactly once,
excluding the previous tick's retained warm-start seed. Legacy solver accumulators
remain unchanged. Friction is stored once per solver group, with `frictionGroupSize`
identifying its coverage; it must not be multiplied by contact-point count. Unselected
geometric points have absent impulses. Unprocessed manifolds, including sleeping
contacts without current writeback, are unavailable rather than measured zero.
A current measured zero and a predictive geometric contact do not establish support.

Collection runs inside integration/contacts and caps each sample at 4096 rows. Overflow
fails the diagnostic before completed publication; it is not reported as zero reaction.
Validation failures inside native contact callbacks return through wrapper cleanup and
then reject the whole sample, including unmapped colliders. An empty manifold has no
contact normal to validate; it still makes the sample unavailable if solver contacts
exist without current writeback. Rejected reads do not mutate the native world.
The application pins one CCD slice. Multiple slices are unavailable because the patch
does not retain disappeared pairs between CCD slices. These observations include
solver velocity stabilization; they do not measure continuous contact time or contact
heat. Support classification and qualification require independent apparatus and
error bounds beyond this numeric observation contract.

Opaque physics envelope version 9 binds the pinned f64 backend identity and requires
`gearState`, `opened`, `ropeState`, `ropeWork` and `reactions`, including empty
collections when a feature is absent. The `opened` field is a strictly increasing
list of authored fixed-joint indices; indices retain their original configuration
meaning after removal. Extra or missing fields, unsupported versions and backend
identities reject before native snapshot deserialization. Native motor configuration
is included in physical-plant restoration validation. This replaces the earlier
variant envelopes whose version numbers had different meanings across feature branches.

The power network owns each coupler's completed funding and opened state; the physics
door owns the corresponding native joint removals. Session restore requires the
physics `opened` list to equal the sorted joints of opened couplers in the separately
validated power checkpoint. Physics restore admits the remaining gear support and
unchanged spring-activation classification, checks the resulting spring frequency
bound where applicable, and requires the native plant to match the original admitted
plant with only the declared fixed joints removed. Body/collider identity and retained
joint properties remain validated. Rejected admission leaves the live completed state
unchanged. Restoring an admitted released snapshot refreshes contact-filter membership
and response topology; it does not recreate a closed latch or reset body motion.
Rope work and force readings are validated independently of opened-joint state, and
both families are admitted before the native state is swapped. Numeric rope links
remain outside bilateral native constraint groups; their spherical anchors remain
native joints after a fixed latch opens. Release commits before the rope force solve,
which uses the prepared post-release response. One ordinary integration follows.
Snapshots are available only at completed boundaries, after a planned release has
committed and the tick's single integration has finished.

Native contact observations serialize with the solver;
restore validates their structure, interval semantics and canonical references before
swapping owners. Solver iteration and CCD settings and exposed joint limits must
match the admitted plant. Immediate and subsequent
completed projections must match uninterrupted execution. This establishes structural
admissibility and continuation, not historical truth of arbitrary self-consistent
checkpoint bytes; qualified history must rerun declared tick-zero inputs independently.

## Suspension controls and physical examples (M3b)

A Travel sensor has an explicit spring-connection binding. It reports signed axial
length and speed from completed geometry; a missing binding is invalid, never an
identity-based fallback. Copying remaps an internal binding and clears an external
one. A Position regulator receives that sensor through an ordinary signal wire
and drives a receiver through another wire. Its fixed proportional/derivative
controller uses authored target bounds, polarity, neutral and output slew rate.
It controls spring extension, not world height, and creates no direct force.

Receivers start in Manual. Automatic requires an enabled, correctly wired regulator
and a valid previous-tick sample. An invalid sample latches Off. A deliberate
manual command, including zero, takes ownership; key release changes the manual
level without implicitly returning to Automatic. Off wins a simultaneous request
and disables the driver before position control, producing zero active current,
torque and work. Off is neither a brake nor the hinge's zero-angle target.
Pause, browser blur and hidden-tab events latch Automatic Off and clear Manual
output; a fresh explicit action is required to rearm. Merely focusing a target
field does not cancel Automatic. Modes, targets, queued events and output slew
state are checkpointed and replayed; script output cannot forge manual provenance.

The guided cart, pin-ended bench, powered upper-rocker suspension and launcher
are ordinary editable blueprints. Reusable guided modules expose normal chassis,
wheel, power and command endpoints. The launcher uses an actual powered hinge
gate to retain an authored compressed spring and releases a separate rolling wheel
through contact. It is a one-shot experiment reset through Build. No example name
changes physics, creates a fixed support or supplies a release impulse.

## Shared sensing and controller programs

Sensors are ordinary independently mounted and powered components. The shared model
channel descriptors define SI units, sign, frame and fixed learning scales. Rotation
measures signed local-axis angular speed; travel measures total bound spring length
and signed rate; linear motion measures sensor-point velocity in local axes relative
to the stationary world, including angular motion. Tilt uses gravity-relative X/Z
lean in −π…π and local angular velocity; a singular lean axis or zero gravity is
unavailable. Joint encoding measures its explicitly bound revolute joint, subtracts
the authored zero, applies its sign and wraps to −π…π. It adds no joint-target actuator.

Range is one local +Z ray from the sensor front face. It excludes only the owning
body and includes other ordinary collision shapes and the environment. The first
surface wins; exact distance ties use compiled body order. An origin inside another
shape returns distance zero; a hit at the maximum range is included. Closing speed
is positive for decreasing range and requires two consecutive returns from the same
physical collider. Reset, power loss, no return or a changed surface restarts that
history. Collider identity stays inside sampling/checkpoint state, never policy inputs.

Contact senses only the exposed local +Z pad rectangle with an outward matching
normal. Contact uses transformed completed anchors (cached manifold distance can be stale). A positive current normal impulse establishes touch within the solver contact skin; otherwise a 1e-7 m separation tolerance admits resting roundoff;
other casing faces do not count. Normal load is accumulated normal impulse divided
by 1/120 s for that completed interval. The physics door indexes one completed contact read per step for all pads; stepping and restoring invalidate that cache. Touch is not a support or stability predicate.

Each numeric sensor has a declared 1000 ohm load and 1 V minimum operating voltage. Source
droop, current/energy caps and all sensor/limiter terminal heat use the shared power
solver. Signal connections supply no electricity. Tick zero is unpowered; the first
power phase establishes supply for the next sampled reading. Old unpowered sensor
saves retain their wiring and report no power. They are never silently connected.
At most 64 sensors, 8192 ray/collider tests per tick and eight general controllers are admitted. Sampling and
inference remain within their measured engine phases; these bounds do not certify
real-time performance on every admissible assembly.

Every channel is either a finite value with `ok`, or an explicit `no-power`,
`no-return`, `initializing`, `unavailable` or `disconnected` status without a value.
No return and initial derivative history are healthy missing measurements. Required
hardware/binding faults disable automatic drive and require explicit rearm after
repair. Controllers consume the same immutable t−1 snapshot and only their wired
channels; sampled tick and internal range history are not implicit policy features.
Linear-point checkpoint validation permits 1e-12 relative scalar reconstruction
roundoff while retaining the original sample bytes for exact continuation.

A Logic Controller's simple rules compare a measured value or explicitly test ready, no-return or initializing status. Hardware faults still disable the source before execution. Rules generate the displayed TypeScript. There is one
execution path: restricted TypeScript AST → admitted numeric IR → WASM. The parser
is the only scripting external dependency, loaded for authoring; simulation never
imports scripting. Core injects executors. Supported programs use one `tick`,
numeric state, arithmetic, if/else, declared input/status reads and bounded output
writes. Logical operands are evaluated once; emitted code grows linearly with admitted syntax. Source is at most 16384 UTF-8 bytes, with 2048 admitted syntax nodes, 32 authored state/
local slots plus one transient compiler scratch local, bounded nesting and 4096 execution fuel. No loops, recursive functions,
imports, host evaluation or world access are available. Runtime errors roll back
numeric state and disable that source. Numeric conditions and logical operators follow TypeScript truthiness: both zero and NaN are false, while infinities are true. Installation is atomic and Build-only; failed
compilation preserves the installed program. A missing referenced input cannot arm
control, even if custom code tries to branch around the hardware fault.

Editing code switches the draft to Code mode and disables rule mutation. Viewing or
copying code does not. The last 50 draft Undo entries persist with the draft. Restore rules offers cancellation and saves custom code before replacement. Storage failure retains current edits in memory with explicit export
and closing guidance. Rule and threshold-value highlights are generated with the displayed source;
custom or unapplied code cannot display a stale live rule mapping. WASM branch
markers are diagnostic output, not a second rules interpreter.

Oversized controller text remains an invalid browser draft, separate from admitted
machine programs. It survives draft reload when storage succeeds and remains
exportable when storage fails. Rules and Apply are disabled until the text is shortened
or Undo restores the preceding draft; Apply never substitutes an older source.

Learning Controllers are first-class command producers beside regular programs,
using the same sensors and receiver arbiter. Training is an application-owned bounded
operation; installed models are frozen. Keys take Manual ownership immediately;
Automatic/legacy Learned selection is explicit, and pause/focus loss latches drive
Off. Models never write forces, pose, power or receiver ownership directly.

Legacy paired-target centre distance/radial speed and version-1 model weights remain
distinct. Version-2 models bind up to 16 input channels and 8 outputs. Each input has
four fixed features: measured value, ready, no-return and initializing. Missing value
zero is only a tagged feature encoding, never a sensor reading. Kind/channel/unit/
frame/scale/version and source wiring participate in compatibility. Mixed modern
and paired-target inputs use one explicit version-2 definition; old weights cannot
be relabelled. The browser's version-1 learning records remain byte-for-byte intact
when the separate version-2 store is written, and the original is exportable.

Teaching records only explicit manual intervals. Capture retains every sixth tick
plus touch/load/status/command transitions, preserving brief events with elapsed-tick
weights within equal-weight intervals. Capture headers retain build, blueprint,
controller and endpoint/measurement identities; missing legacy provenance is not
invented. The workspace retains bounded history and freezes an incomplete attempt
on overflow or unavailable observations. Capture retains the first valid completed observation before periodic sampling so initial touch, load, status and command transitions have a baseline. A terminal sensor-fault record is retained separately from valid training samples, including attempts that fail before any valid sample; those empty attempts never enter training. Failed-attempt scrubbing does not mutate the
live machine. Delivery evaluation is an explicitly selected, independent measurement
module; generic learning does not infer a task from blueprint or part names. Saved
outcomes are checked against their stored completed physical measurement; cumulative
contact evidence remains recorded evidence, not a reconstructed or certified trace.

Completed controller decisions are also available independently of teaching. The
application drains the existing completed observation cursor into bounded recent
history for both regular and learned controllers. It retains four runs with 600
recent decisions per run and the first fault for up to 32 controllers. This is
temporary diagnostic history, not an executable checkpoint or a training dataset.
Requested inspection shows the sampled input, branch, requested program duty and
applied receiver ownership. Historical selection never alters simulation; export
preserves a selected record, and repair returns through ordinary Build admission.
The selected source is retained with each regular-program record, so a later rule
edit cannot relabel an old decision.

## Powered camera photographs

A camera is an M3b ordinary solid 60 × 40 × 40 mm aluminium part (0.2592 kg
at the default material density), with the canonical material-derived inertia.
Its 100 ohm supply consumes terminal heat through the existing shared circuit and
requires 1 V. This idealized load is 0.36 W at 6 V before droop; it is not a
manufacturer model. Trigger wiring supplies no power. At most eight cameras are
admitted, within the existing sensor limit; the ninth rejects atomically.

The version-1 pinhole profile is fixed: 320 × 240, 60 degrees horizontal field of
view, near 10 micrometres, far 100 m, lens origin (0, 0, 0.020001) m in the body
frame, forward +Z, up +Y, screen right −X. Canonical solids, exposed shafts, floor
and environment obstacles are opaque, two-sided optical geometry. Rope spans use the
same completed physical node centres and authored diameter as workshop rendering,
without selection highlighting; their visual surface adds no collision authority. Only the owning
camera housing is excluded. Wires, labels, editor decorations and exploded poses
are not optical geometry. These are visibility choices, not additional colliders.
The catalog's local X reflection symmetry preserves the lens direction when mirrored.

The simulation camera owner records power, owner/low-before-high latch, accepted
manual request ID, pending request, busy count and completed result. Every twelfth
completed tick is an exposure boundary. Manual requests are Run-only and epoch-bound;
monotonic IDs deduplicate before changing history. One pending request per camera
is admitted. Positive receiver duty following a powered low sample requests one
photo; held-high duty does not repeat. Power or receiver ownership changes require
low rearm. A competing rising edge increments an explicit busy count without replacing
the reserved request. Power at exposure determines ok/no-power. Checkpoints retain
this versioned state, including pending continuation, and reject malformed history.
A pending manual request must equal the newest accepted manual ID and must be newer
than the last completed manual result; rejected restoration leaves live state intact.
No RGB channel is offered to numeric sensors, programs or learning models. Existing
prior-completed numeric sensor semantics and the one-integration fixed step are unchanged.

Application capture consumes the identified completed frame and rasterizes/copies its
pixels synchronously before asynchronous PNG encoding. Later display poses cannot
change those bytes. A lost WebGL context rejects rendering and encoding instead of
advancing the displayed sample timestamp; recovery requires a fresh render. Photo
metadata carries the served build ID plus source HEAD and working-tree digest.
One live selected view and one encoder reservation are shared
across all cameras; overlapping encodes report busy. At 5 seconds, a late encode is
invalidated but retains its reservation until settlement, preventing replacement work
from accumulating. Epoch changes, clear and disposal invalidate pending publication.
Restored history and missing observation windows never recapture historical requests.
Paused capture explicitly keeps the original displayed sample and its original tick.
Entering camera view on a paused exposure boundary labels that completed image paused,
not live.

The session gallery retains at most 100 PNGs and 32 MiB of encoded bytes; full or
failed captures preserve existing photos. One decoded preview is displayed. Object
URLs are released on clear/disposal. Photos survive machine edits/retries in this
page, but are absent from blueprint saves and executable checkpoints. Only an explicit
player action downloads a PNG or its JSON metadata. Replay never downloads, uploads,
or reconstructs photos. Endpoint transport, streaming and image inference are separate
future contracts, not capabilities of this camera profile.
