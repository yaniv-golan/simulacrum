# Contributing to Simulacrum

Thank you for improving Simulacrum. Behavior must emerge from components, connections, environment, and physical laws—not demo identity.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for ownership rules and use the
[documentation map](docs/README.md) to find the contract owned by the area you
are changing.

Install Node.js 24.18 LTS, run `npm ci`, then use `npm run dev`. Before opening a pull request, run `npm run security:audit`, `npm run check`, `npm test`, and `npm run build`.

GitHub Actions deliberately separates feedback speed from deep qualification:

- **CI** runs on pull requests and pushes to `main`. Its required Node 24.18
  lane executes the static, architecture, contract, coverage, package, and
  audit gates plus a representative browser/simulation smoke set. A separate
  non-blocking Node 26 compatibility lane runs the same technical gates except
  the duplicated dependency audit. That lane is diagnostic while Node 26 is a
  Current release: its success does not expand the supported engine range, and
  its failure does not waive the Node 24.18 release gates. Tags do not repeat
  these runs.
- **Deep verification** runs weekly or on demand. Four deterministic shards
  execute all verification suites in parallel, followed by production builds
  and live performance baselines. Its optional mutation matrix runs the nine
  hosted decision domains independently on the weekly schedule and should be
  requested before a release when critical schema, network, controller,
  challenge, or failure decisions changed. Test-site and course changes use the
  dedicated local `npm run mutation:test-site` gate; it is part of the
  aggregate `npm run mutation` command but not the hosted matrix. Canonical
  component geometry changes use `npm run mutation:component-geometry`, which
  combines the broad geometry score with a 100% critical-decision slice.
- **Release soak** remains manual because its 30-minute lifecycle exercise is
  useful before releases and high-risk resource changes, not on ordinary pull
  requests.

Run the focused suites related to a change while iterating; the local
definition of done remains stricter than the automatic smoke workflow.

For local iteration, pass one or more exact registered suite names to the
cross-platform focused command:

```bash
npm run test:focused -- verify-rover-runtime
npm run test:focused -- verify-five-demos verify-hybrid-assembly
npm run test:focused -- verify-test-site-contract verify-course-evaluators verify-testing-playground-user-loop
```

Known pure Node verifiers may be run directly for the shortest edit loop. The
focused command skips unconditional harness setup, but it does not suppress a
build owned by a selected suite and it does not replace the full completion
gates. See [Testing and verification](docs/TESTING.md) for timing reports,
guardrails, component-visual evidence qualification, legacy `TEST_FILTER`
automation, and harness maintenance.

Keep model and simulation modules free of DOM, CSS, cameras, and meshes. Put reusable domain behavior behind `src/core/index.js`. Add deterministic contract tests for physics/model changes and browser assertions for visible behavior. Blueprint input is strict v1: reject missing, unsupported, future, or guessed fields instead of adding compatibility branches. Update architecture, wire schemas, generated validators, and API documentation together when a contract changes.
