# Working on Simulacrum

## The prime rule

Behavior must emerge from components, configuration, transforms, connections, controller
commands, the environment, and physical laws. **Never dispatch simulation behavior from demo
identity, and never add demo-only physics.** Built-in demos are ordinary blueprints.

**Corollary — ask what a layer may *know*, not only what it may corrupt.** Most guards defend
against unauthorized writes. The defect that cost the previous attempt its central milestone was
an unauthorized *read*. Pass the least information that suffices.

## Layers and allowed import edges

| layer | owns | may import |
|---|---|---|
| `model/` | pure data, catalog, ports, blueprints, schema, analysis | — |
| `simulation/` | fixed-step physics, networks, constraints, environment, failure, telemetry | `model/` |
| `simulation/physics/` | **the only importer of the physics library** | `model/` |
| `simulation/physics/law/` | contact, friction, motor, drag laws | **nothing** — numbers in, numbers out |
| `scripting/` | restricted compilation, isolated controller execution | `model/` |
| `presentation/` | Three.js, camera, input, panels | `model/` + the telemetry **type**; the telemetry value is injected |
| `application/` | use cases, composition, lifecycle | all of the above |
| `core/` | stable **DOM-free** public facade | `model/`, `simulation/`, `scripting/` — **never `presentation/` or `application/`** |

No cycles. `presentation/` and `simulation/` never import each other; `simulation/` never imports
`scripting/`. Telemetry is produced by `simulation/` and **injected** into presentation; controller
programs are **injected** into phase 2. Both couplings are runtime, never import edges.
Enforced: `gate:structural`.

## The tick order — frozen, nine phases, reordering is a build failure

1 sensor snapshot · 2 controller commands · 3 power/signals · 4 actuators/constraints ·
5 environment/forces · 6 integration and contacts · 7 structure/failure · 8 thermal/ablation ·
9 telemetry. Enforced: `gate:structural`.

## Invariants

- One integration per tick. One place advances the clock.
- Single owner per piece of state. Every mutable value has exactly one writing system.
- Controllers read the **previous completed** sensor snapshot — sampled at tick `t`, consumed at
  `t+1`, exactly one tick of latency. Never live state.
- One fixed 1/120 s session path for real-time and deterministic advancement. No second stepper.
- Telemetry is the single read model. Never a second UI-only truth.
- SI units in `model/` and `simulation/`.
- **One strict *runtime* schema. Never infer a missing field.** Player saves carry a version and
  are migrated into that shape **at load**, by a named, tested migration per version step — a
  bounded listed set, not open-ended compatibility branching. Declare the supported range: below
  the floor, refuse with an explicit message; **above the current version, refuse — never guess
  forward.** Migration lives outside the runtime boundary; inside it there is exactly one shape.
- **No live physics-library object crosses the `simulation/physics/` boundary.** Export values or
  immutable views. This is what makes the abort contract sound.
- Debug read models are generic. No demo-named surface.

## Identity blindness

Physical laws receive **numeric handles and numbers** — never entities, names, roles, ids or
`userData`. One boundary converts identity into physics, and it asserts:

```js
// Per SHAPE — materials are per geometry primitive, not per part.
assert(shape.materialHandle === handleFor(
         part.authoredMaterial?.[primitive.id]     // player choice: serialized, Inspector-visible
         ?? geometryDefinition[part.type][primitive.id].materialKey));
```

Physical properties are a function of the geometry definition or a player-authored,
Inspector-visible choice — **and nothing else.** Not role, not rig position, not blueprint, not
name. Two conditions, asserted separately: **`authoredMaterial` may be copied, never derived** —
loading a blueprint or instantiating a saved subassembly must reproduce the stored selection
exactly, but nothing may *compute* a material from `rigRole`, part name, blueprint id or rig
position — and every material row is player-selectable. Back it with a property test: perturb role, blueprint id, name and rig
position; assert every handle is unchanged. The same rule governs mass, inertia, rated torque,
rated capacity and drag. Enforced: `gate:structural`.

> **Never write `npm run a b c`.** npm runs only the first script and passes the rest as
> *arguments*. Verified: with three scripts exiting 0, 17 and 23, `npm run gate:layers
> gate:tick-order gate:identity` exits **0**. Use one aggregate script, or `&&` between separate
> `npm run` invocations.

## Who this is for

**A smart 14–17-year-old who has outgrown block-based builders** (Trailmakers, Besiege, Scrap
Mechanic) and hit the same ceiling every time: **the parts are magic.** Here the motor has torque,
current, copper heat and a rated capacity; power comes from cells that deplete; a misaligned hub
stops transmitting torque; controllers are real programs reading real sensors; things break and
tell you why; and walking machines are the point.

**But realism is the risk, not the product.** Stormworks already built the deep, realistic
version, and players bounce off it for exactly the reasons above: *"too complicated," "takes too
long to do anything," "having to deal with lua programming even to make a simple boat motor
working."* Trailmakers wins the same audience by being *"simple and addicting… much more
forgiving."*

> **Trailmakers-fast at minute one; Stormworks-deep at hour ten. The depth is optional and
> progressively revealed, never a toll gate.**

Build every promise twice: a forgiving default that works without understanding it, and the real
model underneath, visible when you look. Connect a motor to a cell and it spins — torque, current
and heat are *shown*, not required. Keys drive the machine by default; visual logic and TypeScript
are for when you want them. **Never require code to make a wheel turn.**

**When a rule feels costly, ask whether removing it puts a magic part back in the box. When a rule
feels rigorous, ask whether it is a toll gate.**

Three loops to protect, in players' words: *the machine you designed rumbling to life and doing
what you pictured*; **failure as the teacher** — intuition earned *"not through equations but
through hundreds of attempts in a consequence-free sandbox"*, which is why the post-mortem is a
headline feature and fast restart beats pretty graphics; and **returning to optimise** an old
design once you know more.

**The simulation is uncompromising; the interface is generous.** The strict-schema and
no-compatibility-reader rules govern *machine formats*, never the player's experience: the editor
snaps, suggests and explains; a saved machine above the supported version floor always loads; every reason code also renders
as a sentence a person can act on; failure is legible and enjoyable, not punishing.

## The bars

Each is a command. Run it; it is red until it is green. **F1, F3 and F4 are judged by watching a real target
player; F2 is instrumented.** Record a human verdict with `npm run assess -- <bar> <pass|fail> <participant> <servedBuild> "notes"`
(the servedBuild is the id the **running application** shows, not your checkout); it
is tied to the **player-facing build fingerprint** (`npm run build-fingerprint`), so committing the
evidence or editing a doc preserves it while touching `src/` invalidates it. F1 measures
first-launch experience, so each F1 record needs a **participant who has not assessed it before**;
sessions are append-only so that history cannot be erased by overwriting. Human bars are a weaker
instrument than the rest, measuring what the rest cannot.

| bar | command | asserts |
|---|---|---|
| L1a | `npm run bar:L1a` | **The Course, prefix 0.** From stable hold: stay upright while stepping — strict alternating touchdowns, then **terminal stable hold (5 s continuous)**. **Never observed passing**: the one unpreserved run held 1.325 s of the required 5 s and reported no valid settle. |
| **L1b** | `npm run bar:L1b` | **The Course, S1 (Approach). THE OPEN PROBLEM.** Walk from stable hold to the ramp entry: ≥4 strict alternating touchdowns, cross-track ≤ 0.15 m, path efficiency **≥ 0.70**, stance slip ≤ 0.02 m. Best observed efficiency: **0.449**. |
| L1c | `npm run bar:L1c` | **The Course, S2+S3 (Descent, Advance).** Down the ramp with no fall and **no forbidden support**, ≥2 touchdowns on the ramp, stance slip ≤ 0.06 m, arriving with both pads on the ground; then ≥5 further strict alternating steps, each forward projection > 0.02 m. |
| L1d | `npm run bar:L1d` | **The Course, complete and unbroken (S1–S5), then held under declared variation.** S4: heading sweep ≥ 350°, max path radius ≤ 2.0 m. S5: within 0.30 m of the S4 start, stable hold 5 s. Whole run ≤ 180 s. Variation and held-out cases per the Course spec. **The completion condition.** |
| L2 | `npm run bar:L2` | Two runs of the same inputs under **two different recorded renamings** produce an identical `deterministicProjection(frame)` after remapping references. **Distinct from D1.** |
| D1 | `npm run bar:D1` | Same blueprint, input trace **and renaming seed** ⇒ identical `deterministicProjection(frame)` hash, two processes, both clocks |
| P1 | `npm run bar:P1` | **Both** must hold on a named scene and machine: ≥ 30 fps rendered **and** 120 completed simulation ticks per wall-clock second, with a declared overload policy. A responsive renderer over a simulation accruing debt is not a pass. |
| S1 | `npm run bar:S1` | a hostile controller cannot escape, hang, or read undeclared state |
| **F1** | `npm run bar:F1` *(human)* | a target player, unassisted and untutored, builds something that moves within **15 minutes** of first launch — and wants to build a second thing |
| **F2** | `npm run bar:F2` | **instrumented.** Application response across one place → connect → run cycle on a named scene and machine — input event to reflecting frame, plus Run to first tick, **human time excluded**. p95 < **2 s**, no single stall > 500 ms. 2 s is a product requirement, not a measurement. |
| **F3** | `npm run bar:F3` *(human)* | a player who did **not** build the machine can say why it failed from the post-mortem alone. **Use failures whose cause is independently known**, and score identifying the cause — not repeating the sentence on screen. |
| **F4** | `npm run bar:F4` *(human)* | ten minutes of unassisted play yields one moment of visible delight and no moment of "I don't know what this wants from me" |
| **F5** | `npm run bar:F5` *(human)* | a player using their **own** browser agent gets an actionable answer to "why isn't this working" without leaving the game |

**The locomotion bars are prefixes of one contract — The Course.** There is no second ladder;
if you find velocity/stride tracking language anywhere, it is stale. The Course's own spec is the
authority for every predicate, and its free parameters must be **frozen before qualification**,
not fitted to the machine after watching it.

**D1 and L2 are different tests and neither implies the other.** D1 fixes the seed and varies
nothing; L2 varies the renaming and fixes everything else. A deterministic implementation that
branches on a material id stays perfectly deterministic under a fixed seed, so **D1 cannot catch
identity dependence** — only L2 can. Both hash `deterministicProjection(frame)`, a declared subset
of the read model in `model/` that excludes wall-clock timings, identifier mappings and other
diagnostic metadata; those ride alongside, outside the digest.

**L1a–L1c thresholds are the prior attempt's frozen acceptance *requirements* — documented
contract, NOT evidence of reachability.** No rung was ever observed passing. Change one only with
a written reason; two revisions of the brief invented replacements and were wrong both times.
**The acceptance evaluator is specified: THE COURSE.**

> From stable hold on the build plate, walk to the plate edge; walk down the ramp without falling;
> advance five further steps; then walk a tight closed circle back to where the circle began, and
> settle into stable hold.

Five segments, one unbroken run, ≤ 180 s. No fall, no damage, no non-finite state, **no forbidden
support** (it may not slide, sit or brace — including on the ramp), no saturation failure. The
ladder's rungs are prefixes of it: **L1a** upright stepping, **L1b** the straight approach *(the
known open problem — efficiency 0.449 against a 0.70 requirement)*, **L1c** the ramp and five
steps, **L1d** the turn, the return, and robustness under declared variation.

Measurement definitions — unload, clearance, touchdown, step, strict alternation, stance slip,
fall, stable hold, forbidden support — are inherited verbatim from the prior attempt. **The legacy
qualification apparatus is excluded**: no 441-state matrix, no 21×21 grid, no 1,680-edge sweep, no
400 command pairs, no emergency-stop or crouch or balance-toggle suites. One scenario; passing it
is the bar.

**Assumed reading, confirm it:** the circle closes where the circle began, at the bottom of the
ramp. Returning to the *plate* would require climbing back up, which is a materially different
capability and should be a deliberate choice.

**Set the course dimensions from what you build** — plate height, ramp slope, approach distance,
circle radius bound, return tolerance — and **record them in the repo. A course whose dimensions
are not written down is not a bar.**

**Formerly a blocker; superseded.** For reference, the unresolved version read: Before M7 someone must supply one scoped artifact containing: the physical predicates,
the measurement definitions (what counts as a touchdown, an unload, a clearance, a settle), the
scenario and command domain actually selected, the required part bindings, and **an explicit list
of what is excluded from the legacy qualification apparatus** (the prior attempt's version carried
441 command pairs, named pad bindings, a frozen site fingerprint and legacy checkpoint/proof
requirements — most of which the rebuild will not inherit). *"Implement it in full"* without that
scope means either importing the whole legacy apparatus or quietly picking convenient fragments. Without it a machine can brace on its torso,
count contact chatter as steps, or score over a convenient interval, and still print green. **P1's budget and scene
are yours**: measure first, then record the machine and scene in the repo. Never inherit a
performance number.

## Milestones

| | deliverable | stop rule |
|---|---|---|
| M0 | skeleton, manifest, layer/tick/identity gates, runner, CI < 3 min, all eight bars red-and-named | structural gate green; a layer violation turns it red |
| M1 | fixed-step session, 9 phases, one integrator, telemetry, `step(n)`, **minimal failure bundle** | **D1** |
| M2 | physics door + library ADR, component/port model, schema + generated validators, assembly compiler, **G2 decided**, **command surface** | schema rejects every malformed fixture; one library importer; no live library object escapes |
| M3 | power/signal networks, actuators, sensors, command bus; a powered wheel turns *(host-side test double for the controller — sandbox is M4)* | controllers cannot read live state |
| M3b | **first playable loop** — place, connect, power, run, watch it move and fail. Minimum editor: no panels, no camera polish, no catalog breadth | **F1 and F2, run with a real target player.** A red F1 here costs far less than a red F1 at M8 |
| M4 | WASM sandbox: fuel, digest gate, host-import boundary | **S1**, under a real attack |
| M4b | **locomotion feasibility probe.** Ships its own prerequisites: **flat-ground contact and friction**, the **Hinge Joint**, and the **6-Axis IMU / Balance Gyro** — these move here from M5/M7. Excludes tires, uneven terrain, the site and the full contact-material law. Stages: loaded standing → weight transfer → swing clearance → alternating contact → stopping | **Exit requires every stage demonstrated.** A named blocker is a completed experiment; a recorded decision is not a completed repair. Where a stage fails, carry out the chosen repair — plant, decomposition, or physics library — and **rerun the probe**. A decision authorises work on that repair, never progress to M5. Listing blockers and moving on to breadth is the substitution this whole document exists to prevent |
| M5 | terrain, contacts, friction, **contact-material law**, tire law; rover drives repeatably | rover bar green (set distance/repeats from your own measurement); **P1** |
| M6 | terrain fixture set — named friction lanes, fingerprinted site, run matrix; full failure recorder; challenge evaluation in the telemetry tail | an induced stall replays to the same failure on a named lane |
| M7 | **locomotion** — legged machine, ordinary player-authored controller programs. The five-regulator decomposition is the leading **candidate**, not a requirement; the prime rule constrains *authority* (no engine gait owner, no pose write, no hidden support force, no role-selected traction), not program count | **L1b**. After two failures stop and re-derive the decomposition from measurement rather than iterating |
| M8 | editor, panels, camera, catalog breadth, demos as blueprints | **L2**, and **F3/F4** |
| M8b | **WebMCP: a player's own browser agent helping them play.** A thin adapter over the M2 command surface. Diagnostic tools first — `explain_failure`, `diagnose_power`, `diagnose_connection`, `describe_machine`, `find_part`, `read_telemetry`; build verbs supported but never the fast path, because **building is the game** | **F5**, plus: F1 still passes with the tools **unregistered**; no player content in any tool description; tools registered statically; no capability the player's UI lacks |
| M9 | **L1c then L1d** — tracking, then the robustness contract | **L1d. This is the completion condition, not L2.** |

**Current: M0. Gate: `npm run gate:M0` — it EXECUTES the checks due at or before M0 and exits
nonzero if any is not green.** Checks carry a `dueAt` milestone in the manifest; a gate never runs
or waits on a check above its own row. A gate that prints an instruction and exits zero is a false
green — see the `npm run a b c` note above; the same trap has now appeared three times in this
project.
The eight bars are deliberately red until their milestone; a gate never waits on a bar above its
own row. Do not proceed past a
refusing gate. Parts and UI features carry a `milestone` field; the build **rejects** anything
above the current milestone. The manifest owns the current milestone; this line is printed by
`npm run gate`, not hand-edited.

## Verification — match the oracle to the claim

| claim | right oracle |
|---|---|
| the physics is right | analytical closed form, conservation drift, or symmetry — never a recorded number |
| it is deterministic | two clocks, two processes, hashed per-tick traces |
| it renders truthfully | rendered transform == simulated transform; then the text mirror; pixels last |
| it is fast enough | per-phase timing recorded **inside** the engine |

| tier | command | budget |
|---|---|---|
| structural gates | `npm run gate:structural` (ONE aggregate script; `npm run gate` runs it too and **propagates its failure**) | < 5 s, every commit |
| unit + property | `npm run test:unit` | < 30 s, every commit — **affected set only**, derived from the module graph, never named by hand |
| analytical + conservation + short-horizon contact | `npm run test:physics` | < 60 s, every commit |
| long-horizon contact stability (10⁴ steps) | `npm run test:physics:long` | merge + nightly **until measured** — its wall clock is unknown, and applying another scene's ratio to it is a cross-scene transfer, not a measurement |
| symmetry + identity invariance | `npm run test:invariance` | every commit |
| determinism | `npm run test:determinism` | every commit |
| per-phase timing | `npm run perf` | every commit, trend stored |
| scenarios / bars | `npm run test:scenario` | merge + nightly |
| browser + visual | `npm run test:browser` | merge |
| mutation, critical modules only | `npm run mutation` | weekly |

**The every-commit tier stays under a few minutes, measured, and the gate reports its own wall
clock.** When it cannot, move a test to a slower tier or make the simulation faster — **never**
delete the assertion or stop running the tier.

**Simulation speed is the multiplier on this entire loop.** Stubbing one mechanism took the
previous attempt's gate from 12,705.5 ms to 3,330.9 ms — **3.8×, measured** — and it had silently
multiplied the cost of every scenario, determinism and invariance run for months. Treat a
simulation-speed regression as a process emergency: that is what the per-phase timings are for.
*(Do not quote a cross-tree ratio as a cause; only stub-and-remeasure isolates one, and even that
is a ceiling.)*

## Debugging

| need | command |
|---|---|
| capture a failure | bundle is automatic; it must be diagnosable by someone who was not there |
| replay it | `npm run replay <bundle>` |
| **why does this run differ from that one** | `npm run diff <runA> <runB>` — reports the first divergent tick and quantity |
| step one tick | `.` in the client, or `step(1)` |
| sweep a parameter | `npm run sweep <param> <range>` |

Before tuning a control law, the failure bundle must report the engine-invariant battery green.
**Green means no known defect fired — it does not prove the engine is sound.**
If mirrored behavior is asymmetric or renaming changes physics, **the bug is in the engine.**

## Runtime surface

One command surface; the UI is a client of it. An agent is a player: it gets the player's surface
with the player's constraints, and nothing more.

`observe(scope, detail, sinceTick)` · `act(command) -> {ok, reasonCode}` · `step(n)` ·
`runUntil(predicate, maxTicks)` · `checkpoint()` / `restore(h)`

`step(n)` is the primitive at **tick** granularity. Rejections carry a reason code from a **closed enum in `model/`** plus the
offending path — never prose. Every actuator and law reports why it did not do what it was asked.

## Definition of done for a commit

- Small enough to review line by line.
- Every new test has been **seen failing**.
- No gate entry without a `ruleId` or `barId` it enforces — unowned entries are rejected.
- No second hand-maintained list of facts the build already knows.
- Nothing above the current milestone.

## Rules and their enforcement

`npm run rules` prints `ruleId | rule | enforcedBy` from the manifest. The manifest is the only
authored copy; this file does not restate it. A rule with no check prints **UNENFORCED** — that is
honest; pretending is not.

## Pointers

- Rationale, evidence, milestone detail, gotchas: `2026-09-04-simulacrum-rewrite-brief.md`
  (~1,500 lines — read it when **designing**, not when editing)
- The rebuild brief and its four companion analyses are **held outside this repository** and are
  not in any clone. Ask the maintainer for them.
  **Never write a local filesystem path, internal document name, or workstream label into this
  file — it is public.** That rule is why those documents live outside the repo in the first place.
