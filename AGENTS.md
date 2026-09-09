# Working on Simulacrum

Build a browser mechanical workshop for a smart 14–17-year-old who has outgrown
magic-part builders. Connect a motor to a cell and it spins. Keys drive by default;
programming and detailed tuning are optional depth. Failure teaches through an
explanation and fast restart. Never require code to make a wheel turn.

## Authority

Behavior emerges from ordinary player-authorable components, configuration,
transforms, connections, controller commands, environment and physical laws.
Never dispatch physics from demo, role, name or blueprint identity. Demos are ordinary
blueprints. No hidden support forces, pose writes or engine-owned gait coordination.
Ask what a layer may know, not only what it may corrupt: pass the least information
that suffices. Controller decomposition is an engineering choice, not an authority grant.

## Contracts and ownership

[Runtime v1](docs/contracts/runtime-v1.md) owns cursors, save format, checkpoints,
replay, clock and state ownership. [Course v1](docs/contracts/course-v1.md) owns
locomotion predicates and qualification. `scripts/manifest.json` owns milestone
allocation, bars and rule/check ownership. `npm run rules` reports enforcement;
UNENFORCED means exactly that. `npm run gate` prints the current milestone.

| layer                  | may import                                  |
| ---------------------- | ------------------------------------------- |
| model                  | no other layer                              |
| simulation             | model; physics only through its narrow door |
| simulation/physics     | model; sole physics-library importer        |
| simulation/physics/law | nothing; numeric inputs and outputs only    |
| scripting              | model                                       |
| presentation           | model; telemetry values injected at runtime |
| application            | all layers                                  |
| core                   | model, simulation, scripting; DOM-free      |

No cycles or presentation/simulation import edge. Simulation never imports scripting.
Programs are injected into controller phase execution. No live physics-library object
crosses the physics door. Readers see immutable completed snapshots.

Each mutable quantity has one writing owner. Every tick uses the same 1/120 s path
and exactly one integration: sensor snapshot → controller commands → power/signals →
actuators/constraints → environment/forces → integration/contacts → structure/failure →
thermal/ablation → telemetry. Sensors sampled at t are consumed at t+1. SI units in
model and simulation. Telemetry is the sole read model for rendering and diagnostics.

Per-shape material admission must equal the player's stored selection or the canonical
geometry primitive's material. Loading and subassembly instantiation copy selections;
they never derive them from role, name, blueprint or rig position. Every material row
is player-selectable. The same authority rule applies to mass, inertia, ratings and drag.
Property tests perturb identity while preserving the physical authored choices.

## Developer entrypoint

Before choosing an implementation owner, use the [developer guide](docs/development/README.md),
[architecture map](docs/development/architecture.md) and matching [change recipe](docs/development/recipes.md).
`npm run docs:navigate -- <symbol-or-path>` finds current owners/consumers;
`npm run inspect:change -- --files <paths>` combines owners, invariants, conservative
test selection, registered browser checks and affected explanations without executing them
(use `--json` for full detail);
`npm run test:unit -- --files <paths> --summary` explains checks without running them.
Remove `--summary` to execute. Reuse the existing boundary and invariant test contracts;
register new guarantees in the manifest rather than another hand-maintained inventory.

For player-facing changes, read the [UI and content policy](docs/development/ui-ux.md)
before choosing placement or copy. State the player's task, owning region, visibility
lifecycle and displaced UI. Preserve consequential state and unique actions; examples
and explanations do not earn permanent canvas space by being new. Verify the affected
journey and rendered layout, and report automation separately from player evidence.

For features that add or change teaching, examples, experiments or challenges, apply
the [learning content admission rules](docs/development/ui-ux.md#learning-content-policy)
before adding an entry. Record **no entry / extend / replace / add**, the player need,
the closest existing content and why it suffices or does not. A new feature does not
automatically earn a lesson. The linked policy owns the full rules.

## Work and milestones

Run the actual current gate before advancing. M1 decides the physics library and
proves deterministic stepping and minimal replay. M2 introduces strict schemas,
compiler and command surface. M3 connects real power, sensors and actuators. M3b
requires the playable build loop and real F1 plus instrumented F2. M4 attacks the
sandbox. M4b demonstrates standing, weight transfer, clearance, alternating contact
and stopping after repairs; listing blockers does not authorize M5. M5 qualifies
the rover on the frozen Course before legged qualification. M7 requires L1a/L1b/L1c.
M8 adds product completion, M8b WebMCP, M9 the full robust legged circuit.

Parts and UI features declare a milestone. Do not introduce future breadth to escape
a physical blocker. Initial contract reconciliation may implement acceptance predicates
and their counterexamples before the corresponding physical fixtures exist; these are
not qualification evidence or permission to ship future features.

Keep plant, controller, fixture, evaluator, power and engine hypotheses separate.
A green invariant battery means no checked defect fired. A rover pass is an apparatus
smoke test, not proof of the walker's engine behavior. Check ascent torque, charge,
clearance and contact evidence before assigning a cause. After two failed control
iterations, re-derive the decomposition from measurements instead of tuning blindly.

After structural changes or integrating another agent's edits, rerun navigation and
focused-test discovery. Before verification closure, run `npm run docs:prepare` (regenerate first, then inspect), repair
broken references, and review each stale explanation with `npm run docs:review`.
Record dispositions after source closure; `--batch <decisions.json>` submits separate
section decisions together, never accepts all stale explanations automatically.
Update the explanation when behavior or ownership changed; otherwise record a specific
reason it remains accurate. `npm run docs:check` is a required structural gate in CI
and both verification tiers. It automatically regenerates source-bound discovery and rejects
stale review evidence; a previous report cannot narrow required checks. See the
[documentation workflow](docs/development/README.md#keep-explanations-current).

## Verification

Use analytical solutions, conservation accounting and symmetry for physical claims;
two processes and both production clock drivers for deterministic projection hashes;
rendered/simulated transform agreement then text state then pixels for UI claims;
per-phase timing inside the engine for performance. Validate passive mirrored fixtures
before interpreting a controlled mirror failure. D1 fixes the renaming seed; L2 changes it.

Run focused tests during development, derived from import and data dependency graphs;
unknown changes select all tests. Structural checks target <5 s, unit/property <30 s,
short physics <60 s. The every-commit command must stay below 180 s and report wall time.
Long contact tests run at merge/nightly until measured. Scenarios run merge/nightly,
all browser checks at merge/release, critical-module mutation weekly.
Use `npm run verify:local` for local completion (CI plus conservatively affected browser checks;
`--base <commit>` includes committed changes). Clean source defaults to all checks.
Use `npm run verify:final` for merge/release or milestone qualification; local success never
advances a milestone or supplies human evidence. Explicit browser check IDs are development
probes, not a substitute for either completion tier. Do not delete an assertion
or skip a required tier to recover speed. Never combine multiple script names in one npm-run invocation: use separate
invocations or an aggregate that propagates every failure.

Every new test must be seen failing. Include positive controls and plausible wrong
traces. Gate entries must name a ruleId or barId; unknown checks fail. No second
hand-maintained list of facts derivable from the manifest or module graph.

Human bars F1/F3/F4/F5 require real eligible participants and the served build id.
Never fabricate observations. Follow the versioned protocols in assessments/protocol.
F1 requires acceptance by the designated target player; returning sessions are eligible. Qualifying evidence records full
source/build and experiment identity. Run final checks on the same final source.

## Collaboration

Keep changes reviewable. Do not stage, commit, push, merge, rename branches, publish
or deploy without explicit authorization. Keep internal plans, review history, private
paths and coordination outside public tracked files. Reference implementations are
read-only. Optional background rationale is supplied separately by the maintainer.
