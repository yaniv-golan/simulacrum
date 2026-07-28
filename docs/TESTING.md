# Testing and verification

Simulacrum separates fast edit feedback from completion and release
qualification. Focused testing makes iteration cheaper; it does not weaken the
definition of done.

Use Node.js 24.18 and the npm version declared by `packageManager` in
`package.json` when comparing timings. Timing results from another toolchain are
diagnostic only.

## Edit loop

For a known pure Node verifier, direct execution is the fastest path because it
does not start the browser test server:

```bash
node scripts/verify-flexible-line-runtime.mjs
```

For browser verification or an exact mixed group, use positional suite names:

```bash
npm run test:focused -- verify-rope-authoring-browser
npm run test:focused -- verify-flexible-line-runtime verify-rope-authoring-browser
```

`test:focused` requires at least one exact registered suite. It rejects unknown
or comma-packed names, an inherited `TEST_FILTER`, and either `TEST_SHARD_*`
variable. These checks prevent an apparently focused command from running the
whole registry or silently omitting a requested suite.

The focused runner skips only the unconditional root `pretest` Core build and
the test server's `predev` hook. It retains the same registry order, isolated
Vite marker, per-suite process, timeout, forced cleanup, logs, browser error
capture, and assertions as `npm test`. A selected suite still performs any
build that its own contract requires: `verify-core-pack` builds the Core
package and `verify-bundle-budget` builds the application.

The older `TEST_FILTER=... npm test` interface remains supported for CI and
existing automation. It deliberately retains normal npm lifecycle hooks; use
`test:focused` for local iteration.

## Failure-evidence debugging workflow

Use this workflow for a stall, invalid tire contact, numerical anomaly, or
structural failure. The artifact observes the normal 1/120-second production
path; it is not permission to add a demo-specific reproducer or alternate
failure decision.

1. Reproduce the symptom without changing physics. In the running application,
   open **Failure report** and choose **Export diagnostic bundle** after the
   recorder captures a trigger. Preserve the original JSON unchanged.
2. Strict-decode and replay that exact artifact under the supported Node
   runtime:

   ```bash
   node scripts/verify-failure-evidence-replay.mjs path/to/bundle.json
   ```

3. Exercise the recorder, wire artifact, and clean production replay contracts:

   ```bash
   npm run test:focused -- verify-failure-evidence-runtime verify-failure-evidence-artifacts verify-failure-evidence-replay-runtime
   ```

4. For rover stalls or wheel failures, run the production-order scenario matrix.
   It covers slow and fast ramp egress, constant-forward grass and asphalt, and
   a 40-second repeated forward/reverse run without dispatching physics from
   demo identity. The verifier requires sustained progress, no structural
   failure, no loaded inadmissible tire row, no false stall trigger, and no
   overloaded authored connection; any evidence trigger is a failure of this
   healthy-terrain regression rather than an alternate passing outcome:

   ```bash
   npm run test:focused -- verify-rover-failure-evidence-diagnostic
   ```

5. When changing the visible report, export action, or replay controls, also run:

   ```bash
   npm run test:focused -- verify-failure-analysis
   ```

Read the evidence in causal order: trigger and accepted external input;
available actuator power and resolved commands; contact and terrain identity;
solved row contribution; authored connection load versus capacity; then the
same-tick pre/post topology. Keep contact, structural, and later cascade events
distinct.

A rolling-actuator stall is evaluated per accepted, powered, operational
driven shaft. It requires a grounded, unbraked assembly and insufficient shaft
progress for the policy dwell; zero delivered mechanical power does not excuse
a stopped powered shaft, while a rotating wheel with no vehicle translation is
not a mechanical actuator stall. An out-of-tolerance tire candidate triggers
only when its solved normal load reaches the policy floor. Pooled Cannon rows
must be free of prior-tick evidence annotations whenever capture is inactive.

Call a root cause **verified** only when the artifact strict-decodes,
`summary.causalState` is `complete`, replay returns `reproduced: true`, and the
cited links in the causal chain are not `unavailable`. Label `derived` evidence
as derived. If capture or replay says `incomplete`, `unsupported`,
`unavailable`, or reports an identity/digest mismatch, report the limitation and
keep the proposed cause unverified; never fill a missing contact, solver row,
terrain feature, or connection by inference. See
[Failure analysis](FAILURE_ANALYSIS.md) for artifact contents, replay semantics,
and ownership boundaries.

For a version-2 bundle with `priorEpisodeBoundaries`, replay must reproduce the
complete ordered boundary list before comparing the target episode. A report
is export-ready only when shared telemetry exposes
`failureEvidence.captureStatus.state === "ready"`; an export-button click must
not compose or validate a new artifact.

## Timing reports

Harness runs write unique JSON timing reports plus
`artifacts/test-harness/timing-latest.json`. Reports include:

- requested and selected suites;
- server startup and cleanup time;
- each completed, failed, timed-out, or aborted suite;
- total elapsed time and the slowest completed suites;
- Node, npm, operating-system, architecture, and CPU identity;
- starting and ending Git/workspace fingerprints and whether the workspace
  changed during the run.

Reports are written atomically for handled startup, suite, aggregate-timeout,
and cleanup outcomes. Machine termination, `SIGKILL` of the harness itself, or
filesystem failure can still prevent a report. A timing report measures
latency; it is not evidence that omitted suites passed.

When comparing before and after timings, use the same supported toolchain and
recorded workspace inputs. Do not establish performance policy from a dirty
tree that changed during the run.

### Component-inspection foundation profile

The S1 inspection foundation has a separate portable scale suite and a named
release-baseline profile. The ordinary cross-platform suite validates the
300-part/3,000-connection inputs, projector and cache behavior, and the active
16 ms relationship/preflight and 4 ms selection-projection limits:

```bash
npm run test:focused -- verify-component-inspection-foundation-scale
```

During development, a dirty-tree capture is diagnostic only:

```bash
node scripts/verify-component-inspection-performance-live.mjs --profile=foundation --allow-dirty
```

The authoritative gate is verify-only: run it from a clean registered worktree
whose `HEAD` is the exact candidate. The caller creates and later removes any
temporary worktree; the command never prepares or cleans one:

```bash
npm run baseline:component-inspection:foundation:verify -- --candidate=<40-hex-commit>
```

It rejects a dirty tree, a mismatched candidate, an unregistered path, mutated
capture identity, a Node runtime outside `>=24.18 <25`, and every
non-authoritative artifact in release mode. S0
comparison screenshots/text state can be refreshed separately with
`node scripts/capture-component-inspection-s0.mjs` under the focused test
server; they are labeled `existing-ui-baseline` and are not future release
budgets.

## Completion and release gates

Focused success is not completion. Before completing a substantial change, run
the repository gates in `AGENTS.md` and `CONTRIBUTING.md`, including the full
registered suite. Mutation, live baseline, and release-soak requirements remain
proportional and unchanged. The 30-minute soak is not an edit-loop command.

## Maintaining the harness

- Register every `scripts/verify-*.mjs` file in `scripts/test-registry.mjs` as a
  suite or intentional non-suite.
- Preserve exact-name rejection and registry-order execution.
- Never allow focused runs to inherit shard selection.
- Keep aggregate and suite termination bounded. A process that ignores
  `SIGTERM` must receive `SIGKILL` after the grace period.
- Keep test-server lifecycle suppression scoped to `test:focused`; normal test,
  performance, preview, and release paths retain their existing setup.
- Extend `verify-test-harness.mjs` and `coverage:test-harness` with every harness
  contract change.
- Keep Rope release qualification, hosted-CI policy, concurrency, browser
  pooling, and full-gate deduplication as separate decisions backed by their own
  measurements and review.
