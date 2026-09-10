# Developer guide

<!-- doc-review {"version":1,"fingerprint":"b88d3031dcdb5795fd47cc947926416fcfceda419d9f3c5333fe502067749727","dependencies":"docs/development/.reviews/README/developer-guide.json","dependencyDigest":"c9fe3b6650e6ce9bf466a04e220a2aa6b65c93f30dafeb1798a94bf190d0a64d","disposition":"still accurate","rationale":"The build command now acquires a cooperative host window before the same breadth admission and Vite build; Node setup, dev and preview instructions remain valid."} -->

Read [AGENTS.md](../../AGENTS.md), the [architecture map](architecture.md#overview) and the
[recipe for your change](recipes.md#choose-a-recipe) before choosing an owner. Use Node 24.18.x and
`nvm install && nvm use && npm ci` (with nvm installed). The checked `.nvmrc` pins a version inside the package-owned range. `npm run dev` serves the workshop; `npm run build` and `npm run preview`
serve a stable build. The page displays its build identity.

## Working loop
<!-- doc-review {"version":1,"fingerprint":"f937c11e443f01425571b939eb2eba81bf4788c112b8a17824c0c53194f971c0","dependencies":"docs/development/.reviews/README/working-loop.json","dependencyDigest":"ada749125e632d8ece4fdd979daab565086e6bd09d7c36081a86094b2ad69da3","disposition":"updated","rationale":"Added the canonical UI policy entrypoint while retaining manifest-owned checks and existing discovery and completion commands."} -->

Player-facing changes also follow the [UI and content policy](ui-ux.md#before-changing-player-facing-ui).
It owns placement, teaching lifecycle and qualitative review; the manifest owns its
executable guarantees. Use the existing discovery and completion commands below.

1. Read the architecture map and matching recipe; locate the production owner with
   `docs:navigate` before adding a helper. Run `inspect:change -- --files <paths>`
   to see owners, invariants, selected tests, registered browser checks and affected
   explanations together. Use `rules:explain` for an individual invariant. A search result is a route to the source, not a second contract.
2. Use explicit changed paths with `test:unit -- --files <paths> --summary` to inspect
   the proposed checks. This is a dry run. Remove `--summary` to execute them.
3. Demonstrate a new test failing for the intended reason, make the smallest owner-level
   change, and run those checks. Update real consumers and boundary fixtures together.
4. Rerun discovery after structural edits or integrating another agent’s work. Run
   `docs:prepare` to regenerate references first and identify affected explanations. Update their text during development;
   record formal dispositions once source changes have settled, before final verification.
5. Inspect browser behavior when presentation or input changes. Focused tests,
   `typecheck` and `ci` are optional development probes, not prerequisites to repeat.
   Choose one completion command: `verify:local` for local closure on one source identity,
   or `verify:final` for merge/milestone qualification. Both already run CI.
   For a release candidate, `release:prepare` owns complete verification in its frozen copy;
   do not run a completion tier first solely as preparation. Read the gate result:
   automated success cannot supply a missing human assessment.

## Find owners and checks
<!-- doc-review {"version":1,"fingerprint":"fadc458dbb1c8b6b2f1dbb858a5c2b13a18c1f6f79c8074497aa85949ad3a268","dependencies":"docs/development/.reviews/README/find-owners-and-checks.json","dependencyDigest":"c6275df393eb8b04ad047ae48f7f56667f094d7dce4c67f59f6d2766bed45c13","disposition":"updated","rationale":"Added rules --failures as a manifest-derived view; explicit controls and check IDs are shown without claiming execution or inferring coverage from names."} -->

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
irrelevance. The executable conservative selection is also shown; it includes served HTML
roots and expands on opaque or unknown inputs unless a manifest local behavioral contract applies. Associations alone never authorize omission. It executes nothing. Documentation errors remain unresolved and make the
command fail. Use this report to start work, then run the selected checks through the
existing commands; there is no additional approval or receipt for change inspection.

Invariant explanations resolve manifest-owned implementation and positive/negative
control pointers, registered checks and qualification bars. Registration is not an
execution result. An umbrella runtime rule does not prove every semantic guarantee.
Future bars stay deferred; current human bars require participant evidence.
`npm run rules -- --failures` projects each invariant's explicit negative-control
pointers and registered check IDs. Coverage without pointers/checks is UNKNOWN;
execution is NOT_EVALUATED. The view cannot infer uncovered scenarios from test names
or turn registration into a passing receipt. Inspect current verification reports
separately for actual executions; add missing scenarios to the manifest-owned controls.

`node scripts/test-affected.mjs --files src/model/assembly.mjs` runs tests selected
from explicit changed paths. Add `--summary` for a concise dry run with counts and
shortest known paths, grouped by causal dependencies, conservative opaque inputs or
full-suite fallback. Use `--explain` instead for the existing full selection JSON.
Both explanation modes leave tests unexecuted; unknown changes select all tests.
A literal file read relative to `import.meta.url` follows that file's data edge;
dynamic file reads and subprocesses remain conservative. Do not omit these tests
because the changed feature appears unrelated.

## Verify a change

<!-- doc-review {"version":1,"fingerprint":"b1c929154c22cbbf4dfedf1fb396060b29a53374f4b86971d29cc290a0e40de5","dependencies":"docs/development/.reviews/README/verify-a-change.json","dependencyDigest":"9baf7daabb6ff01e6fe92123d49f43de7d25c9a8d502a4abac9d2474a965fcc9","disposition":"still accurate","rationale":"The dependency update changes only the pinned native physics package; Node admission, verification commands, completion tiers, conservative browser selection and human evidence requirements are unchanged."} -->

- `npm run test:unit` selects affected tests conservatively; `npm run test:all` runs all unit/property tests.
- `npm run typecheck` checks production boundaries, generated types and deliberately invalid type fixtures.
- `npm run verify:local` runs CI and conservatively affected browser checks, with `artifacts/verification-local.json` recording the base, exact paths, selection reasons and source. Default base is HEAD; `--base <commit>` includes committed changes since that commit. Untracked files are included and clean source selects all checks. Exit 0 means local automation passed; qualification and human acceptance are explicitly NOT_EVALUATED.
- `npm run verify:final` runs CI, all browser checks and the current gate with invocation-local shared check receipts; human acceptance remains a separate requirement. Both tiers stop after a failed prerequisite, including stale documentation, before starting browser work. The [verification outcome](../../scripts/verification-outcome.mjs#implementation) separates automation, human acceptance and overall qualification: exit 0 means qualified, exit 1 means automation failed or was incomplete, and exit 2 means automation passed but human acceptance blocks qualification. Failed or invalid human evidence is distinguished from missing evidence; none authorizes qualification.
- `npm run ci` runs structural and unit checks within the development budget.
- `npm run gate` evaluates the current cumulative milestone, including human requirements.
- `npm run test:browser:affected -- --files <paths>` selects, explains in its report, builds once and executes conservative browser coverage. Add `--summary` for source-bound discovery without building or opening sockets.
- `npm run test:browser -- --checks verify-part-help-window verify-part-help-browser` runs explicit development probes with one build and combined `artifacts/browser-suite/selected.json` evidence. This does not claim local completion or qualification. Unknown IDs/options fail rather than silently narrowing scope.
- `npm run test:browser` builds and runs all registered browser checks; `npm run test:browser:smoke` runs construction smoke checks.
- `npm run test:performance` runs the isolated performance checks.
- `npm run format` applies the pinned formatter; generated validators are excluded.
- `node scripts/generate-schema.mjs` refreshes generated validation after schema edits.
- `npm run replay -- <bundle.json>` checks a failure bundle against the current implementation and runtime.

Install browser dependencies once with `npx playwright install chromium chrome`.
Linux tab capture needs Xvfb. Follow [playtesting](playtesting.md#remote-setup) for recordings and
human evidence. Run the required tier on the same final source; do not reuse an old green
report after changing source or environment.

The [verification preflight](../../scripts/runtime-preflight.mjs#implementation) reads
`engines.node` from package.json. CI, the milestone gate, final verification, focused
tests and type checking reject unsupported Node versions before running checks.
Focused tests probe loopback only when selected dependency paths contain known server
listen calls. Dry-run discovery never opens sockets. The discovery is conservative
and cannot identify every dynamically loaded server; later environment failures remain possible.
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

<!-- doc-review {"version":1,"fingerprint":"031766323198550477f20f62ce4db21af88c19e8e66edd51c74b04d7866be459","dependencies":"docs/development/.reviews/README/keep-explanations-current.json","dependencyDigest":"f15afb164e63844dfd764eab71244511f4ee8d50e490926aa0b1f903ceffc032","disposition":"still accurate","rationale":"The native package identity invalidates dependent reviews through the existing content graph. Regeneration, section-specific review and final-source documentation closure still apply without a policy change."} -->

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

Record formal reviews after source closure, not after each tuning edit. Navigation-only links should target
a stable overview heading; implementation explanations must keep their source/body dependencies. A later source
change still invalidates affected reviews and must be reviewed before final verification.

Use `workshop.css#source` for layout claims: it binds the stylesheet's bytes so a CSS-only
edit makes the explanation stale. It does not claim imported styles are covered or
that hashing a stylesheet validates its layout; browser review remains required.

1. Run `npm run docs:prepare`. It regenerates derived command/check references before listing
   affected sections and changed dependencies. It may update the generated reference, but
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

4. Run `npm run docs:check`, focused tests and the required verification tier on the final source.
   If new commands/checks or other source changed during review, rerun `docs:prepare` before
   recording the remaining decisions. `docs:impact` remains available for read-only inspection;
   `docs:generate` regenerates facts only. Neither command can approve explanations.

A section’s current `doc-review` comment records its content fingerprint, format
version, disposition and technical rationale. Derived dependency hashes live in an
adjacent `.reviews/<document>/<section>.json` file, bound by the comment’s digest.
These current technical records belong in version control; missing or modified
metadata fails the gate. Remove its adjacent metadata when removing a section;
orphaned records also fail. They contain no review history or private coordination. Source function bodies count,
not only signatures. JavaScript review hashes ignore whitespace between tokens only when
parsing confirms identical syntax structure and exact tokens/comments. This catches
newline-sensitive behavior; changed literals, comments, syntax or unparseable fragments
remain source changes. Other file formats remain byte-sensitive. This equivalence applies
only to explanation review, never build identities or verification receipts.
Module references conservatively cover the module and its
local dependencies; symbol references use `file.mjs#symbol=name` to narrow coverage.
Use ordinary Markdown links for module-wide claims. References such as
`package.json#script=ci` and `scripts/manifest.json#rule=gate-integrity` make specific
configuration claims checkable. Explanatory sections in this directory that reference
implementation are covered; generated facts are checked by regeneration instead.

For direct module claims, `file.mjs#source` binds that module’s entire source, including imports, bodies and side effects, without importing the behavior of its dependencies. Use it for composition or a panel’s own state transitions; explicitly link any helper/configuration whose behavior the explanation asserts. The impact report labels this boundary. It is not suitable for claims about complete transitive behavior.

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

## Browser execution and scope
<!-- doc-review {"version":1,"fingerprint":"368c91077de36d3b9430b080f6f63f6262a16a99541611354306b9ee1eb6b7ac","dependencies":"docs/development/.reviews/README/browser-execution-and-scope.json","dependencyDigest":"ab5f07db155b001e1a2673d0081adc48b5a1ca79c2e2032326e0416f397efc21","disposition":"still accurate","rationale":"Four audited reverse-consumer hashes changed after the workshop qualification assertion was corrected. All read expressions, source boundaries, dependencies, consumers, roots and scheduling rules remain unchanged."} -->

The [browser selector](../../scripts/browser-selection.mjs#implementation) includes the
served workshop/probe HTML roots as well as verifier imports. Self-hosted checks and
opaque file/subprocess inputs conservatively expand selection. In the current application,
shared runtime and identity dependencies often select the full browser suite.
`browserLocalScopes` in the manifest is an explicit local-only behavioral contract: a named
entrypoint, its frozen direct dependency shape, and required feature/integration checks.
Source scopes also bind the transitive reverse-consumer set and browser-root inventory.
New consumers and roots restore broad coverage; outgoing imports alone are insufficient.
Part-help presentation edits select four checks; its standalone verifier selects two.
Mirror presentation edits select mirror, assembly UX and manipulation checks; its standalone verifier selects the mirror check. The remote recording client selects both backend adapters, durable feedback receipts, workshop lifecycle and construction checks; new service/import edges or opaque inputs restore conservative coverage.
Known documentation and unit-test files can be excluded from browser execution only
when absent from reachable runtime data/module edges and every reachable opaque reader
has a current audited boundary. `browserReviewMetadataScopes` binds each individual
opaque expression, its purpose (identity, fixture, runtime or source analysis), exclusions,
exact owner source/import shape, reverse consumers, consumer dependency-closure digest and browser roots.
The closure starts at callers reachable from the registered browser and served roots,
and includes their modules/data producing read arguments. Unreachable unit-test
consumers do not bind runtime payload domains; new reachable consumers/roots still
invalidate the audit. Only the audit digest fields
themselves are excluded from manifest hashing to avoid self-reference; read-domain
configuration stays bound. A failed rich audit has no weaker exemption fallback.
A fixture read is never treated as an identity read: unknown fixture/data files still
expand coverage. The exclusion covers documentation and standalone unit-test changes
only, not arbitrary JSON. Runtime-imported tests/documents are runtime inputs. CI still
runs their required tests and documentation checks. Changed readers or callers, new
opaque reads, new consumers, graph errors and feedback source overrides fail closed.
These are reviewed behavioral contracts, not an automatic proof about dynamic code.
Never refresh their hashes without inspecting the affected reads and consumers.
Mixed changes compose these classifications with existing local scopes. Reports retain
excluded paths and the causes of conservative expansion. Shared formatter coverage
includes mirror, assembly, mounting, connection, workshop and spring journeys; it is
not restricted to the feature that motivated the edit.
Changed shared modules, consumers, unknown files, or new imports expand coverage. These
contracts do not apply to full qualification and do not claim that imports prove behavior.
When extending a boundary, review its integration checks as well as dependency changes.
A shorter
explicit probe remains useful during development, but is not evidence of complete coverage.
There is no persistent cross-run receipt cache.

The [browser runner](../../scripts/verify-browser-suite.mjs#implementation) supports
`--workers 1` and `--workers 2`. The default is two; use one for serial comparisons. Bounded serial/parallel probes
and the full required suite validate changes to this scheduling policy.
Only checks declared `execution: parallel` in the manifest may overlap. Missing metadata,
performance checks, recording, focus-sensitive checks and self-hosted environments run
exclusively. Each admitted check owns its browser process, contexts and artifact directory;
probe servers are local to the check and always closed. Exclusive checks drain the previous
work before starting. Available workers immediately take the next admitted check.
Source changes stop new dispatches and drain already-started work.
The [shared browser launch boundary](../../scripts/browser-session.mjs#implementation) checks the resolved profile and headless option against
the child process execution policy, so passing a profile through a variable cannot bypass
exclusive execution. This is an engineering guard, not a sandbox for hostile verifier code.
Reports preserve manifest order, all failures, worker configuration and source identity.
Each attempt replaces its report with a non-green running record before build/server startup;
CLI admission, startup and cleanup failures produce failed reports, also available as `last-run.json`.
Summary-only discovery does not replace execution evidence. [Local completion](../../scripts/verify-local.mjs#implementation) and
[final verification](../../scripts/verify-final.mjs#implementation) also record
a fresh failed outcome when runtime, arguments or base-revision admission fails.
Use the [browser evidence helpers](../../scripts/browser-evidence.mjs#source) for repeated interactions:
`loadAndWait(page, file, { ok })` uploads through the file input and returns a fresh matching
command receipt, including rejected loads. The [application-owned receipt sequence](../../src/application/workshop-app.mjs#source) advances
on completed attempts even when the simulation cursor does not change.
`assertRejectedEdit({ snapshot, action })` compares the caller's consequential state projection
before and after a rejected receipt; include history and cursor where those are part of the claim.
`dragFrom(page, locator, destination)` scrolls before resolving coordinates and sends ordinary
mouse events, releasing the button on failure. Keep outcome assertions in the check, and use
explicit pointer steps when inspecting an in-progress drag. Helpers do not replace UI assertions.

A browser check owns its probe setup, execution and cleanup inside one receipt; success
is recorded only after cleanup. Saved errors retain both execution and cleanup causes.
[CI](../../scripts/ci.mjs#implementation) stops on the first failed structural prerequisite before starting unit work.
The [tier coordinator](../../scripts/verification-tiers.mjs#implementation) keeps prerequisite
ordering and local outcome reporting separate from the qualification gate.

## Shared verification window
<!-- doc-review {"version":1,"fingerprint":"334ec4e8c934c26cd3f2210d38b1e2dca7a32575512f8ecc0b2ea1cd95ab952a","dependencies":"docs/development/.reviews/README/shared-verification-window.json","dependencyDigest":"7fcc48572820fee3a466a5963bf1991ba2dbb58528c4b0120f9b9497f838ca01","disposition":"still accurate","rationale":"Native factor reuse changes simulation cost inside a check. It does not change cooperative scheduling, leases, runner concurrency, timeouts or admission."} -->

The [verification window](../../scripts/verification-window.mjs#implementation) coordinates
supported npm build, CI, completion, focused unit and browser commands across worktrees
on this host. Nested commands inherit the owning window. Completion/browser admission marks its
canonical report non-green before runtime checks or lock waiting; failed admission
replaces an older pass even when no child starts. Waiting is bounded to five
minutes, separately from each check's unchanged execution budget. Queued work records
competing owner identity and queue/run durations in `artifacts/verification-windows/`;
host load averages provide context, not proof of a timing failure's cause. Read-only
summary/explanation commands do not wait for the window. Raw direct script invocations
and unrelated applications do not participate: this is cooperative scheduling, not
CPU/GPU reservation or permission to relax performance thresholds. Preserve failed runs;
there is no automatic retry-to-green policy.

A crashed owner is never evicted by age. Inspect its process tree and establish that
all descendants stopped, then use `node scripts/verification-window.mjs recover <owner-token>
--process-tree-stopped`. Recovery refuses a live PID, including a potentially reused PID,
or mismatched token. An unpublished/corrupt owner record needs manual inspection and
cleanup after quiescence; do not remove a window because it looks old. The flag is an
operator attestation, not proof supplied by the tool. Normal cleanup verifies ownership
and fences removal before another owner can enter.

For asynchronous tests, use [waitUntil](../../scripts/wait-until.mjs#source) with an observable
completion predicate and a named deadline. It propagates observation errors; it does not
interrupt synchronous blocking code. Keep deliberate sampling/quiet windows where the
assertion concerns a duration. The recording tests use completion predicates for stop,
storage closure and final media persistence; fixture turn pumps do not establish success.

Isolated integration remains separate from these changes. Verify in a worktree; applying
work must check destination index, tracked and untracked content, not merely HEAD. This
window does not make source installation atomic or authorize a merge.
