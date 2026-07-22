# Failure analysis, exact stepping, and replay

Simulacrum treats failure investigation as an observation problem. The solver
produces immutable telemetry; analysis records what happened; presentation
explains it. Neither the report nor replay can change the result of a test.

## Player workflow

1. Start any machine and operate it normally.
2. Pause at any point and choose **▸│** (or press `.`) to advance one exact
   1/120-second physics tick.
3. When a rated connection fails, the test auto-pauses after a short aftermath
   window and opens **Failure post-mortem**.
4. Compare peak transmitted load with rated capacity, then follow the causal
   chain from initiating event to first physical failure and detachment.
5. Choose **Replay failure** to inspect the preceding telemetry. Scrub, step, or
   play the recording, then choose **Return to live**.

The report can be reopened from the simulation bar or **Tools → Failure
report**. Resetting starts a new recording.

## Contracts

`SimulationSession.stepFixed(count = 1)` advances the same phase-ordered path
used by real-time simulation. One default call always executes exactly one
fixed tick. It does not substitute a simplified solver.

`FailureRecorder.ingest(telemetry)` observes completed telemetry only. The
telemetry run graph already contains immutable assembly metadata, so analysis
does not read editor state or Three.js objects. It detects failed-connection
transitions and records immutable `FailureEvent` values containing:

- simulation time and world position;
- involved component and connection IDs;
- failure mode and solver-provided reason;
- maximum witnessed load, attachment rating, and utilization;
- fatigue and environmental state;
- detached component IDs, including consequences reported on a later solver
  phase;
- an ordered causal chain.
- source channel, unit, reference frame, completed tick, validity, and
  provenance.

`FailureRecorder.report()` keeps the first physical failure as the primary root
cause while retaining the later cascade as an immutable timeline. Unknown or
non-physical transition kinds fail closed; deliberate commanded release is
structural history, not a fabricated failure. Analysis never mutates parts,
connections, commands, or telemetry.

`ReplayBuffer` samples immutable telemetry at a fixed rate, defensively cloning
mutable or unowned inputs. Its capacity is
`seconds × sampleHz`; old frames are discarded, so memory use remains bounded.
The game uses 12 seconds at 30 frames per second and retains a short physical
aftermath after the first failure. A replay frame is a read-only presentation
snapshot, not a saved simulation state and not a deterministic re-simulation.

## Effects and sound

`FailureEffects` maps an event's physical evidence to presentation:

- impact energy and utilization affect shock, dust, and sparks;
- water contact produces spray instead of ground dust;
- aerodynamic overload produces streamed particles;
- thermal failure produces smoke and incandescent material colors;
- procedural Web Audio uses the same mode and severity.

These effects are deliberately downstream of telemetry. They contain no demo
names, do not add forces, and cannot cause or prevent a failure. Browser audio
also remains subject to the user's autoplay and volume policies.

## Reuse boundary

The DOM-free `FailureEvent`, `FailureRecorder`, and `ReplayBuffer` are exported from
`simulacrum-foundry/core`. Three.js effects and the report/replay controls stay
in `src/presentation`; live stepping coordination stays in `src/application`.
Architecture checks reject DOM, Three.js, demo dispatch, or physics advancement
inside the analysis model.
