# Developer guide

<!-- doc-review {"version":1,"fingerprint":"b75d6565c86fbf3808892c575bdab4f42b3634732832f7ede82f376014ae145d","dependencies":"docs/development/.reviews/README/developer-guide.json","dependencyDigest":"9d69b0b47004a228cdd22e62961e9417d19a8c97e5cb872c871ed13804cb1ad4","disposition":"still accurate","rationale":"The revised map and recipe retain owner discovery, fail-first checks, Node 24 and final source-bound verification; they now describe assembly interface editing and shared surface previews."} -->

Read [AGENTS.md](../../AGENTS.md), the [architecture map](architecture.md) and the
[recipe for your change](recipes.md) before choosing an owner. Use Node 24.18.x and
`npm ci`. `npm run dev` serves the workshop; `npm run build` and `npm run preview`
serve a stable build. The page displays its build identity.

## Working loop

1. Read the architecture map and matching recipe; locate the production owner with
   `docs:navigate` before adding a helper. Run `inspect:change -- --files <paths>`
   to see owners, invariants, selected tests, registered browser checks and affected
   explanations together. Use `rules:explain` for an individual invariant. A search result is a route to the source, not a second contract.
2. Use explicit changed paths with `test:unit -- --files <paths> --summary` to inspect
   the proposed checks. This is a dry run. Remove `--summary` to execute them.
3. Demonstrate a new test failing for the intended reason, make the smallest owner-level
   change, and run those checks. Update real consumers and boundary fixtures together.
4. Rerun discovery after structural edits or integrating another agent’s work. Run
   `docs:impact` to identify affected explanations. Update their text during development;
   record formal dispositions once source changes have settled, before final verification.
5. Run `typecheck` and `ci`; inspect browser behavior when presentation or input changes.
   Use `verify:final` for final closure on one source identity. Read the gate result:
   automated success cannot supply a missing human assessment.

## Find owners and checks

```sh
node scripts/navigate.mjs availablePartName
node scripts/navigate.mjs src/model/assembly.mjs
node scripts/inspect-change.mjs --files src/model/assembly.mjs
node scripts/test-affected.mjs --files src/model/assembly.mjs --explain
node scripts/explain-invariant.mjs --list
node scripts/explain-invariant.mjs rejected-edit-atomicity
```

Navigation is generated on demand from the existing module graph and parsed source
declarations. Path queries show exports and other module-level owners, suppressing
loop and local variable noise. Search a nested function by name to see its enclosing
scope; add `--all-symbols` to include local declarations. Results retain imports,
direct reverse consumers and transitively reachable tests. Repeating the command on
unchanged source produces identical JSON; there is no checked-in module inventory.
`parseErrors` reports unreadable or malformed source explicitly, and the command
fails rather than treating it as a successful empty symbol scan. Graph errors also fail discovery; opaque inputs remain visible. Reachable tests help discovery; use conservative
focused selection for deciding what to run.

`inspect:change -- --files <paths>` composes these existing authorities in one
source-bound report. The default is a concise human-readable summary; add `--json`
for full dependency paths, conservative reasons and analysis metadata. Both formats
use exactly the same analysis and failure status. Tests are grouped by causal and conservative inclusion; browser
checks show known dependency paths or invariant registration associations. All registered
browser checks remain visible because lack of an inferred association is not proof of
irrelevance. It executes nothing. Documentation errors remain unresolved and make the
command fail. Use this report to start work, then run the selected checks through the
existing commands; there is no additional approval or receipt for change inspection.

Invariant explanations resolve manifest-owned implementation and positive/negative
control pointers, registered checks and qualification bars. Registration is not an
execution result. An umbrella runtime rule does not prove every semantic guarantee.
Future bars stay deferred; current human bars require participant evidence.

`node scripts/test-affected.mjs --files src/model/assembly.mjs` runs tests selected
from explicit changed paths. Add `--summary` for a concise dry run with counts and
shortest known paths, grouped by causal dependencies, conservative opaque inputs or
full-suite fallback. Use `--explain` instead for the existing full selection JSON.
Both explanation modes leave tests unexecuted; unknown changes select all tests.
A literal file read relative to `import.meta.url` follows that file's data edge;
dynamic file reads and subprocesses remain conservative. Do not omit these tests
because the changed feature appears unrelated.

## Verify a change

<!-- doc-review {"version":1,"fingerprint":"cb57e847db46255a9abdaa0e630342c6b5f366a5a0063a97a8bba66d28b2646a","dependencies":"docs/development/.reviews/README/verify-a-change.json","dependencyDigest":"f356ad224715372d36ed2b6f8cc9234cc284adc1f7074672048e38c79bce7ae4","disposition":"updated","rationale":"The verification commands now reject unsupported Node versions and CI/browser builds probe loopback access; the projected-center helper still sends real pointer input and requires a resulting-selection assertion."} -->

- `npm run test:unit` selects affected tests conservatively; `npm run test:all` runs all unit/property tests.
- `npm run typecheck` checks production boundaries, generated types and deliberately invalid type fixtures.
- `npm run verify:final` runs CI, all browser checks and the current gate with invocation-local shared check receipts; human acceptance remains a separate requirement.
- `npm run ci` runs structural and unit checks within the development budget.
- `npm run gate` evaluates the current cumulative milestone, including human requirements.
- `npm run test:browser` builds and runs all registered browser checks; `npm run test:browser:smoke` runs construction smoke checks.
- `npm run test:performance` runs the isolated performance checks.
- `npm run format` applies the pinned formatter; generated validators are excluded.
- `node scripts/generate-schema.mjs` refreshes generated validation after schema edits.
- `npm run replay -- <bundle.json>` checks a failure bundle against the current implementation and runtime.

Install browser dependencies once with `npx playwright install chromium chrome`.
Linux tab capture needs Xvfb. Follow [playtesting](playtesting.md) for recordings and
human evidence. Run final checks on the same final source; do not reuse an old green
report after changing source or environment.

The [verification preflight](../../scripts/runtime-preflight.mjs#implementation) reads
`engines.node` from package.json. CI, the milestone gate, final verification, focused
tests and type checking reject unsupported Node versions before running checks.
Switch Node and confirm `node --version` before retrying. CI and browser builds also
probe an ephemeral loopback port: permission denial is an environment blocker, not
product failure or permission to skip server/browser tests. Grant loopback access in
the execution environment and rerun. The probe cannot guarantee later server startup.

For canvas interactions use `browserEvidence.clickPart(page, partId)` from the
[browser evidence helper](../../scripts/browser-evidence.mjs#implementation). It sends
a real pointer click at the current projected center; it never selects through an
application API. Assert the resulting selected part. If geometry occludes the center,
rotate the view or use a visible part surface; the projection alone does not prove visibility.

## Keep explanations current

<!-- doc-review {"version":1,"fingerprint":"8e08c4853ff07939933e2358936f6a2ef983429e8f7d25921b418570e96e59a6","dependencies":"docs/development/.reviews/README/keep-explanations-current.json","dependencyDigest":"9c774beaa24cd00e8668131c00ca9fbc8e4a62571d7c1038d74d9baa8e67ec8a","disposition":"still accurate","rationale":"The generated reference includes the newly registered assembly UX browser check. The existing regeneration and per-section disposition process still applies."} -->

Navigation and test-selection explanations are snapshots with a content identity,
format version, query/options and completeness information. Rerun them after changes
that affect owners, imports or test dependencies, including work from another agent.
Different content at the start and end of analysis rejects the result. These
checks are not an atomic filesystem snapshot: a transient edit that is restored
during analysis can escape detection. Finish concurrent edits before final verification. Execution computes selection again;
old reports never authorize skipping checks.

The [documentation checker](../../scripts/check-documentation.mjs#implementation) runs automatically
as the manifest’s [developer-documentation check](../../scripts/manifest.json#check=developer-documentation)
in CI and final verification. It refreshes navigation, validates local Markdown links,
heading and symbol references, command names and generated facts, and rejects stale
reviews. Its report is `artifacts/developer-documentation.json`; it is an output, not
an input required by a fresh clone. See the [generated reference](reference.md) for
current commands and manifest-owned check/owner pointers.

Record formal reviews after source closure, not after each tuning edit. A later source
change still invalidates affected reviews and must be reviewed before final verification.

1. Run `npm run docs:impact`. It lists affected sections and changed dependencies;
   it does not acknowledge them. Repair invalid links or symbols first.
2. For each stale section, inspect the named source and explanation. Update the text
   if behavior, ownership, invariants or the working procedure changed. If the text
   still holds, identify the concrete change and explain why its claims still hold.
3. Record that one section’s disposition, for example:

   ```sh
   npm run docs:review -- docs/development/architecture.md trace-an-edit updated "The command admission owner moved; the flow now names its new entry point."
   npm run docs:review -- docs/development/architecture.md trace-an-edit "still accurate" "The admission helper now rejects an additional malformed field; candidate compilation and atomic history ownership remain unchanged."
   ```

   To submit several separately reviewed decisions in one invocation, put an array
   in a temporary JSON file and run `npm run docs:review -- --batch <decisions.json>`:

   ```json
   [{"file":"docs/development/architecture.md","id":"trace-an-edit","disposition":"still accurate","rationale":"The new view toggle does not change command admission or history ownership."}]
   ```

   Every row requires its own file, section ID, disposition and technical rationale.
   Invalid or duplicate rows are rejected before writing. This is not accept-all:
   source is rechecked for each write; if a concurrent edit interrupts the batch,
   earlier individual receipts remain and the gate reports what still needs review.

4. Run `npm run docs:generate` if generated command/check facts changed, then
   `npm run docs:check`, focused tests and final verification on the final source.

A section’s current `doc-review` comment records its content fingerprint, format
version, disposition and technical rationale. Derived dependency hashes live in an
adjacent `.reviews/<document>/<section>.json` file, bound by the comment’s digest.
These current technical records belong in version control; missing or modified
metadata fails the gate. Remove its adjacent metadata when removing a section;
orphaned records also fail. They contain no review history or private coordination. Source function bodies count,
not only signatures. Module references conservatively cover the module and its
local dependencies; symbol references use `file.mjs#symbol=name` to narrow coverage.
Use ordinary Markdown links for module-wide claims. References such as
`package.json#script=ci` and `scripts/manifest.json#rule=gate-integrity` make specific
configuration claims checkable. Explanatory sections in this directory that reference
implementation are covered; generated facts are checked by regeneration instead.

For implementation and ownership explanations, `file.mjs#implementation` covers the
entire module and statically resolved transitive dependencies, including declared data,
types and runtime services. Reports explicitly exclude unresolved runtime payload contents.
For example, changing an uploaded recording or an arbitrary served asset does not change
the server admission algorithm. If a section asserts a configuration value or a payload
contract, also link that configuration or contract explicitly. Do not use implementation
scope to claim complete behavior for arbitrary runtime inputs. Ordinary module and symbol
links retain conservative opaque-input coverage. The checker’s implementation link above
covers the checking algorithm, not the contents of every document it can inspect.

An unrelated edit, timestamp change or same-content commit cannot refresh a stale
review. Dynamic inputs can force broad conservative coverage; the impact report
explains that fallback. Narrow, statically resolvable owner links keep routine
review scope smaller. There is no accept-all command; batch submission preserves individual decisions. Uncertain source scope expands coverage.
These gates establish current references and an explicit review record. They cannot
prove that prose is true or that an agent understood it; behavioral tests and source
review remain necessary.
