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
