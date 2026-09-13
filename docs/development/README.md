# Developer guide

<!-- doc-review {"version":1,"fingerprint":"529c6637e813fa2def4d75d272efd444b07df41cf299ce7a522e177344bb0160","dependencies":"docs/development/.reviews/README/developer-guide.json","dependencyDigest":"3a2dd0f827e6a9db678906d55907946e81d653abe3a0d3cb8bb23de73a4a4e59","disposition":"still accurate","rationale":"The entrypoint still requires canonical owner discovery and public commands. Expanded release tests introduce no new production owner, layer or reset policy; Node setup and recipe selection remain unchanged. Gap closure changes tests only: restored traces and recorded replay, explicit articulated/external contacts, density-volume material response, and Try again through the existing Build/Run orchestration. Production source is byte-identical to the preceding candidate."} -->

Read [AGENTS.md](../../AGENTS.md), the [architecture map](architecture.md#overview) and the
[recipe for your change](recipes.md#choose-a-recipe) before choosing an owner. Use Node 24.18.x and
`nvm install && nvm use && npm ci` (with nvm installed). The checked `.nvmrc` pins a version inside the package-owned range. `npm run dev` serves the workshop; `npm run build` and `npm run preview`
serve a stable build. The page displays its build identity.

## Working loop

<!-- doc-review {"version":1,"fingerprint":"364e2ae29312e97672580ca12471edcd7dce06abbbeb940e42265f8c4cb50a64","dependencies":"docs/development/.reviews/README/working-loop.json","dependencyDigest":"ada749125e632d8ece4fdd979daab565086e6bd09d7c36081a86094b2ad69da3","disposition":"still accurate","rationale":"The complete loop still matches current navigation, inspection, red-before-green and candidate owners. This integration adds a registered coupled physical regression and preserves the same completion tiers; source preparation and semantic review precede capture, and merged source requires its own merge candidate. No workflow command or human-evidence boundary changed. Revalidated after final thumbnail scheduling and spring witness closure: the new timer/DOM/cache owner and browser-only induction do not alter this section’s previously reviewed ownership, verification or evidence requirements."} -->

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
   Choose one completion command: `verify:candidate -- local` for local closure,
   `verify:candidate -- merge --base <commit>` for routine merge readiness,
   or `verify:candidate -- final` for release/milestone qualification. All capture an isolated source and run the existing tier, which already runs CI.
   For a release candidate, `release:prepare` owns complete verification in its frozen copy;
   do not run a completion tier first solely as preparation. Read the gate result:
   automated success cannot supply a missing human assessment.

## Find owners and checks

<!-- doc-review {"version":1,"fingerprint":"dc550ea544f8b4dc30290e6c32a67337e1582e8e534f805abc7d0690d4f5634b","dependencies":"docs/development/.reviews/README/find-owners-and-checks.json","dependencyDigest":"c6275df393eb8b04ad047ae48f7f56667f094d7dce4c67f59f6d2766bed45c13","disposition":"still accurate","rationale":"Current navigate and inspect-change owners are unchanged from the current main source. The new joint-reactions owner and coupled regression enter the existing parsed import graph and manifest invariant pointers; path queries and conservative selection still execute no checks. Registration remains separate from observed red/green and candidate reports; no second inventory or special-case selection was added. Revalidated after final thumbnail scheduling and spring witness closure: the new timer/DOM/cache owner and browser-only induction do not alter this section’s previously reviewed ownership, verification or evidence requirements."} -->

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

<!-- doc-review {"version":1,"fingerprint":"ac1f09ddabc483e1c37aaba17d3a8a4653837264c06be657540d00d6f0928bdf","dependencies":"docs/development/.reviews/README/verify-a-change.json","dependencyDigest":"0c33b7c3f85b808fc1621b760325c8f67b2148d32c6233ad65627880e0f7455d","disposition":"updated","rationale":"The merge adds three manifest browser journeys and Load Cell unit/physical checks, and pins spring.10 in package/lock; it changes no npm command or Node engine range. Current local/merge/final tier owners still execute CI before required browser coverage, distinguish automation from human qualification, and reject changed source/runtime inputs. The new journeys use the same served-build evidence helper and ordinary UI operations; native reaction proofs are separate development/qualification evidence, not permission to omit a completion tier. Package identity changes require fresh verification under the documented same-source rule. Revalidated after final thumbnail scheduling and spring witness closure: the same registered spring browser journey and existing invariant owners retain all required checks; no completion tier is relaxed. The newly merged progress-reporting guidance accurately separates implemented behavior, source-bound automation, protocol-based human acceptance and milestone qualification. Detailed candidate outcomes and current source identity are required; historical originStillMatches cannot certify later source. Existing local/merge/final command semantics are unchanged."} -->

- `npm run test:unit` selects affected tests conservatively; `npm run test:all` runs all unit/property tests.
- `npm run typecheck` checks production boundaries, generated types and deliberately invalid type fixtures.
- `npm run verify:local` runs CI and conservatively affected browser checks, with `artifacts/verification-local.json` recording the base, exact paths, selection reasons and source. Default base is HEAD; `--base <commit>` includes committed changes since that commit. Untracked files are included and clean source selects all checks. Exit 0 means local automation passed; qualification and human acceptance are explicitly NOT_EVALUATED.
- `npm run verify:merge -- --base <commit>` runs CI, audited affected browser checks and the three registered merge smoke checks. It never runs the milestone gate or evaluates human acceptance.
- `npm run verify:final` runs CI, all browser checks and the current gate with invocation-local shared check receipts; human acceptance remains a separate requirement. All completion tiers stop after a failed prerequisite, including stale documentation, before starting browser work. The [verification outcome](../../scripts/verification-outcome.mjs#implementation) separates automation, human acceptance and overall qualification: exit 0 means qualified, exit 1 means automation failed or was incomplete, and exit 2 means automation passed but human acceptance blocks qualification. Failed or invalid human evidence is distinguished from missing evidence; none authorizes qualification.
- `npm run ci` runs structural and unit checks within the development budget.
- `npm run gate` evaluates the current cumulative milestone, including human requirements.
- `npm run test:browser:affected -- --files <paths>` selects, explains in its report, builds once and executes conservative browser coverage. Add `--summary` for source-bound discovery without building or opening sockets.
- `npm run test:browser -- --checks verify-part-help-window verify-part-help-browser` runs explicit development probes with one build and combined `artifacts/browser-suite/selected.json` evidence. This does not claim local completion or qualification. Unknown IDs/options fail rather than silently narrowing scope.
- `npm run test:browser` builds and runs all registered browser checks; `npm run test:browser:smoke` runs construction smoke checks.
- `npm run test:performance` runs the isolated performance checks.
- `npm run format` applies the pinned formatter; generated validators are excluded.
- `node scripts/generate-schema.mjs` refreshes generated validation after schema edits.
- `npm run replay -- <bundle.json>` checks a failure bundle against the current implementation and runtime.

When reporting progress, separate four outcomes: implemented capability, automation
on identified source bytes, human acceptance under the versioned protocol, and milestone
qualification. Local and merge readiness do not evaluate the latter two. An explicitly
authorized experimental publication may defer only the checks allowed by the
[release exception policy](playtesting.md#release-operations); it never advances a milestone.
Inspect the report's detailed automation, humanAcceptance and qualification outcomes,
not a top-level status alone. A historical report or an originStillMatches value describes
the source checked at that invocation, not later edits or today's checkout. Compare its
source/build identity with the candidate being claimed. Registration of a check is not
an executed pass, and a feature assigned to the current milestone is not qualification.

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

<!-- doc-review {"version":1,"fingerprint":"3e4490cc596b8113c795c5bfbe1dc425f23efb8e3e96d4d6f16a1c57a1428d46","dependencies":"docs/development/.reviews/README/keep-explanations-current.json","dependencyDigest":"cd5997a905addd9846b08f9a31053365047228d850f74c3d8a773d4d860381e3","disposition":"still accurate","rationale":"The regenerated reference adds mechanicalSound and its registered invariant/browser check. Source-writing preparation, section review and structural validation commands are unchanged; this reference update supplies no test or human acceptance receipt."} -->

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
   [
     {
       "file": "docs/development/architecture.md",
       "id": "trace-an-edit",
       "disposition": "still accurate",
       "rationale": "The new view toggle does not change command admission or history ownership."
     }
   ]
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
Implicit external-package coverage retains package configuration and lockfile bytes,
but excludes npm scripts when no install lifecycle hook is present: a command-only
change does not change an imported library. Lifecycle hooks retain all scripts because
they can invoke other package commands and alter installed dependencies.
Explicit package/command references and literal file reads still bind those scripts.
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
review scope smaller. There is no accept-all command; batch submission preserves individual decisions.
The batch shares two inspections across the union of reviewed documents, prepares
same-document edits together and checks source inventory before and after publication.
Each file is replaced atomically; the batch is not a multi-file transaction. Failed
publication retains a recovery journal whose path is printed. Do not overwrite newer
work during recovery. Use a single writer for reviewed documents/sidecars: drift
checks detect observed changes, but cannot prevent an arbitrary editor racing a rename. Uncertain source scope expands coverage.
These gates establish current references and an explicit review record. They cannot
prove that prose is true or that an agent understood it; behavioral tests and source
review remain necessary.

Routine merge readiness uses `npm run verify:candidate -- merge --base <commit>`.
It runs CI and the conservatively affected browser journeys plus the manifest's
three merge smoke checks. Only existing audited local contracts or non-runtime
classifications may narrow selection. Shared runtime, unknown inputs, build/configuration,
verification infrastructure and verification-policy changes retain the full browser suite.
A source-compared review-marker-only update may remain narrow for an explicit-base
comparison; changed policy prose and malformed markers still require full coverage.
Fingerprint-only manifest updates are also distinguished by comparing every byte except
the two validated audit-hash fields; all other manifest edits retain full coverage.
Branch-pair comparisons conservatively retain full coverage for touched policy Markdown
and manifest metadata.
This tier does not run the milestone gate or evaluate human acceptance.

For two-branch work add `--incoming <commit> --destination <commit>` and use their
common ancestor as `--base`. The report pins both tips and includes destination-only
changes and final candidate edits. Plain `--base` is explicitly a base-to-candidate
comparison, not evidence that two branches were integrated. Neither command installs
changes. For already frozen CI copies, `npm run verify:merge -- --base <commit>` is
the direct equivalent. Selected and omitted browser checks include reasons.

Full browser coverage remains scheduled and required for releases and qualification.
CI preserves separate unit and browser jobs: pull requests use the pinned event tips
and actual merge checkout, while missing push history selects full coverage. Scheduled
full runs compare last-commit merge selection only when matching complete evidence is
available; incomplete or mismatched comparisons are `NOT_EVALUATED`. This does not
establish safety for every omitted check or replace the full run.

## Browser execution and scope

<!-- doc-review {"version":1,"fingerprint":"0556068694e98bb03441d0105c6c996c29b9e645f0a4ac8e1d23264a82ad92d0","dependencies":"docs/development/.reviews/README/browser-execution-and-scope.json","dependencyDigest":"c5b0a50e3b0a727cb2c2784ab7183d7b863bfd543bc10af160f7200a33812fe0","disposition":"still accurate","rationale":"Current main already documents command-reader readiness. Sound adds a registered exclusive browser verifier and read-only audio timing to the probe. Fresh-receipt semantics, input classifications, coverage declarations and the documented default scope-witness workflow remain unchanged."} -->

The [browser selector](../../scripts/browser-selection.mjs#implementation) includes the
served workshop/probe HTML roots as well as verifier imports. Self-hosted checks and
opaque file/subprocess inputs conservatively expand selection. In the current application,
shared runtime and identity dependencies often select the full browser suite.
`browserLocalScopes` in the manifest is an explicit local-only behavioral contract: a named
entrypoint, its frozen direct dependency shape, and required feature/integration checks.
All local scopes also bind the transitive reverse-consumer set and browser-root inventory.
New consumers and roots restore broad coverage; outgoing imports alone are insufficient.
Part-help presentation edits select the registered help and lifecycle checks; its standalone verifier retains its audited scope.
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

The [proposal owner](../../scripts/browser-scope-proposal.mjs#implementation),
[application owner](../../scripts/browser-scope-apply.mjs#implementation),
[witness runner](../../scripts/browser-scope-witnesses.mjs#implementation) and
[receipt admission](../../scripts/browser-scope-witness-contract.mjs#implementation)
own this maintenance flow.
Use `npm run browser:scopes -- prepare --out artifacts/scope-proposal.json` to compare
recorded boundaries with the current graph. This is read-only for source: the proposal
contains old/proposed rows, changed fields, required witnesses and exact source identity.
Review hashes alongside the source; a hash cannot explain the old implementation.
New opaque reads remain blocked until explicitly classified. Optional
`--declarations artifacts/scope-declarations.json` accepts an array of
`{kind: "metadata", entrypoint, reads, checks}` (or `kind: "local"` without reads).
Each read supplies `expression`, `purpose` and `excludedInputs`; computed hashes are
not accepted as declarations. Existing classifications carry forward visibly.

Write a review JSON with `proposalDigest` and separate `decisions` containing each
changed `key`, `accept: true` and a specific `rationale`. Then run
`npm run browser:scopes -- apply artifacts/scope-proposal.json --review artifacts/scope-review.json`.
Apply captures an isolated candidate, installs dependencies and runs the union of old
and proposed witnesses under the shared verification window. Metadata invariant controls
execute their actual tests; imported pass reports cannot authorize application. Exact
request, successful receipts and candidate identity must agree. Only then is the manifest
replaced; source/index drift rejects. Run one writer on this worktree: observed drift
checks do not provide filesystem compare-and-swap or automatic rollback of concurrent edits.
Evidence and the previous manifest are retained under `artifacts/browser-scopes/`.
Repeating an already applied proposal reports `already-current` and witnesses
`NOT_EVALUATED`, not a new pass. Prepare again after source changes. This command
maintains scope metadata; it does not replace local/final completion or install a feature
candidate into another checkout.

Mixed changes compose these classifications with existing local scopes. Reports retain
excluded paths and the causes of conservative expansion. Shared formatter coverage
includes mirror, assembly, mounting, connection, workshop and spring journeys; it is
not restricted to the feature that motivated the edit.
Changed shared modules, consumers, unknown files, or new imports expand coverage. These
contracts do not apply to full qualification and do not claim that imports prove behavior.
When extending a boundary, review its integration checks as well as dependency changes.
A shorter
explicit probe remains useful during development, but is not evidence of complete coverage.
There is no cross-candidate receipt cache. Only explicitly audited pure unit leaves
may resume within the same frozen candidate; see isolated candidate completion.

The [browser runner](../../scripts/verify-browser-suite.mjs#implementation) supports
`--workers 1` and `--workers 2` for completion. Explicit `--checks` development probes
also accept three or four workers for measured comparisons; they cannot override completion
concurrency. The default remains two; use one for serial comparisons. Bounded serial/parallel probes
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
Every check records its planned schedule index, dispatch time, active browser peers and
host load averages. These describe admission conditions; they do not establish stable
warmup, causal contention or comparable performance distributions across reordered runs.
Shared sensing remains exclusive. Its contact journey stops wall-clock progression
while arming both receivers, then observes every fixed step within the existing physical horizon.
Starter also remains exclusive because it checks
bounded tick gaps in live observations. The actuator journey retains its exclusive focus
profile after two headless parallel trials failed its repaired-extension assertion.
It releases drive before pausing a backdrivable load, making the observed state sensitive
to delays between those actions. Native focus assertions are not the only reason to
retain exclusive execution.
Headless UI classification alone does not prove
that a time-sensitive scenario is safe to overlap.
The UI-lifecycle, assembly-library and surface process watchdogs allow headroom over
observed two-worker execution. Their idle-frame, physical and interaction assertions
remain unchanged; process deadlines are not performance acceptance thresholds.

With two workers, undersized parallel runs may be grouped across exclusive checks.
Existing runs are never split, runs of four or more remain in place, and new combined
groups contain at most four checks. The explicit priority prefix and relative exclusive
order are preserved. The report records the resulting schedule separately; this does
not admit additional checks to parallel execution. Successful historical durations order
longer checks first within each admitted parallel run, after the priority prefix. This
never moves work across an exclusive barrier; serial runs keep their original order.
`--priority-files <repository-paths...>` on local/final/candidate completion uses
positive static dependencies to order likely integration checks earlier. Required
coverage stays unchanged; unknown associations retain ordinary ordering. Candidate
reports retain the supplied paths and provenance; browser reports record execution
order separately from canonical result order. For example:
`npm run verify:candidate -- final --priority-files scripts/verify-recording-browser.mjs`.
Without explicit priority paths, local/merge browser execution uses its captured changed
files as ordering hints. Exclusive checks still drain other work before starting.

Explicit development probes accept `--checks <ids...> --fail-fast`. The first failure
stops new dispatches, drains started peers and marks remaining checks not evaluated.
Completion contexts and broad suite selectors reject this option; their checks remain
exhaustive. Failed IDs are ordering hints only and join touched checks at the front of
the schedule. The [history helper](../../scripts/browser-history.mjs#implementation)
retains outcomes and successful durations in `artifacts/browser-suite/scheduling-history.json`.
The candidate wrapper copies hints from the originating checkout into the fresh clone
and returns only observations produced during that attempt; inherited and reused outcomes
are not republished. Attempt report identities and completion times keep delayed older results
from replacing newer hints. Unstarted checks retain their prior hints, and a newer
successful execution clears a failure hint. Hints live in one atomically replaced snapshot.
Updates reject older observations already present when read; simultaneous publishers use
last-write-wins and may lose hints. This accepted loss changes ordering only. No journal,
writer lock, PID inspection or background cleanup is required. An interrupted write can
leave an ignored temporary file, which does not block reading or publishing the snapshot.
Source capture and receipt admission remain independent. Missing or
malformed history never changes coverage; failure to save hints is reported as a warning.
History supplies no passing receipt and never authorizes omission or resumption.

The module graph retains a bounded, private JavaScript syntax cache keyed by exact
source text. It still reads each input and resolves filesystem dependencies on every
walk. Parsed comments are replayed for type imports; dependency graphs, file metadata
and identity receipts are not cached. `cacheParsedSources: false` supports fresh-parser
comparisons. This reduces repeated parsing without removing byte-based drift checks.

CI completes structural prerequisites, then admits invariant-control and remaining unit
files through one four-worker pool. The standalone structural gate still runs its invariant
unit controls. The 180-second CI obligation is unchanged.

The unit runner stops admitting queued tests when the iteration budget expires and
reports their paths as `unexecuted`; they are not failed test executions. A started child
whose watchdog was shortened by the shared deadline is reported as `iteration-budget`,
with its process diagnostics retained. An ordinary per-check watchdog remains a timeout. Receipt
elapsed time includes admission identity validation. Process failures retain their
code, signal, failure kind and subprocess elapsed time separately from receipt time.
`processDiagnostics` retains relative monotonic event times for spawn, exit, close,
watchdog, signal outcomes and settlement, with a wall-clock origin for correlation.
Timeout enumeration includes at most 64 owned process states; event lists are capped
at 256 with a dropped-event count. Callback timestamps do not prove OS exit time.
`EPERM` remains an error; diagnostics do not change cleanup or timeout outcomes.

Browser results publish after each transition and completed check, before the suite
finishes. Each attempt owns a retained report, per-check logs and artifact directories;
completion lines print the log path. `last-run.json` and suite-name reports are latest
aliases, not permanent evidence paths. The [artifact path owner](../../scripts/browser-artifacts.mjs#source)
routes registered child writers into the injected attempt directory; standalone paths
remain unchanged. Same-invocation receipt reuse points explicitly to the original
run, report, log and evidence directory; it does not create a second execution or
advertise empty replacement evidence. A failed publication rejects the run and attempts to retire any
already published success. Persistent storage failure can prevent that repair and
must be resolved before trusting the affected files. Missing prerequisite-dependent
phases are reported as not evaluated rather than invented structural failures.
Local exit 0 means automation passed with qualification not evaluated; final exit 2
means automation passed but human acceptance still blocks qualification.
Each attempt replaces its report with a non-green running record before build/server startup;
CLI admission, startup and cleanup failures produce failed reports, also available as `last-run.json`.
Summary-only discovery does not replace execution evidence. [Local completion](../../scripts/verify-local.mjs#implementation) and
[final verification](../../scripts/verify-final.mjs#implementation) also record
a fresh failed outcome when runtime, arguments or base-revision admission fails.
Use the [browser evidence helpers](../../scripts/browser-evidence.mjs#source) for repeated interactions:
`loadAndWait(page, file, { ok })` waits for a callable workshop command probe within
the page’s existing wait bound before reading state or uploading through the file input.
It explicitly accepts the full-workshop replacement prompt when needed, then returns a fresh matching command receipt, including rejected loads. Served build
metadata alone does not establish workshop initialization or image readiness. The [application-owned receipt sequence](../../src/application/workshop-app.mjs#source) advances
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

<!-- doc-review {"version":1,"fingerprint":"a9320f97cbd8fb1646e9641ee0697c3e3d6264594a4e5cb273a5c7b5ee0a890c","dependencies":"docs/development/.reviews/README/shared-verification-window.json","dependencyDigest":"29e67b15f7e515f4d320d6a92655ce1d1e73a6946ce1bced76fc90f54f65a113","disposition":"still accurate","rationale":"verification-window still uses private temporary metadata plus same-directory rename, inherited owner tokens, strict non-age-based recovery and distinct 30-minute completion/native-qualification versus five-minute focused waits. The Load Cell native qualification uses that existing completion classification; three new exclusive browser journeys use ordinary focused/browser admission. The package pin and reaction implementation do not change queue policy, owner identity, process cleanup, measured execution budgets or the distinction between coordination and atomic source installation. Current main's wait/status and recovery behavior are preserved. Revalidated after final thumbnail scheduling and spring witness closure: the new timer/DOM/cache owner and browser-only induction do not alter this section’s previously reviewed ownership, verification or evidence requirements."} -->

The [verification window](../../scripts/verification-window.mjs#implementation) coordinates
supported npm build, CI, completion, focused unit and browser commands across worktrees
on this host. Nested commands inherit the owning window. Completion/browser admission marks its
canonical report non-green before runtime checks or lock waiting; failed admission
replaces an older pass even when no child starts. Local, merge, final and native-qualification completion
CLI runs wait up to thirty minutes. Focused unit/browser probes, builds and standalone
CI wait up to five minutes; they retain the same serialization. The CLI prints the
owner PID and elapsed/maximum wait on contention and every thirty seconds thereafter.
Queue time is separate from each check's execution budget. The completion wait covers the
measured completion duration; it is not a FIFO queue and does not guarantee admission
under an unbounded stream of contenders. Queued work records
competing owner identity and queue/run durations in `artifacts/verification-windows/`;
host load averages provide context, not proof of a timing failure's cause. Read-only
summary/explanation commands do not wait for the window. Raw direct script invocations
and unrelated applications do not participate: this is cooperative scheduling, not
CPU/GPU reservation or permission to relax performance thresholds. Preserve failed runs;
there is no automatic retry-to-green policy.

Owner metadata is written to a private temporary file and published by same-directory
rename. Contenders wait while publication is incomplete; malformed published metadata
remains an error rather than evidence of a free window.

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

## Isolated candidate completion

<!-- doc-review {"version":1,"fingerprint":"ada640086afe0b47fda1772a668fdf92a24de4ee9cde50d73c0cfbbeda870132","dependencies":"docs/development/.reviews/README/isolated-candidate-completion.json","dependencyDigest":"398b338ac1d73d839d97d38967c9954c889df03dc72e4ec2bdba98a5ea6f67a0","disposition":"still accurate","rationale":"Mechanical audio adds a registered browser check and invariant controls. Candidate capture, fresh installation, source identity, resumption and local/merge/final tier ownership are unchanged; source-bound audio evidence must still come from the selected candidate."} -->

Concurrent implementations use separate Git worktrees. Start one with
`git worktree add -b codex/my-change /tmp/simulacrum-my-change HEAD`, install its
pinned dependencies, and edit there. Do not include another task's dirty work.

After `docs:prepare` and semantic review, run `npm run verify:candidate -- local`
(or `-- local --base <commit>`). For routine merge readiness use `-- merge --base <commit>`; for release/milestone qualification use `-- final`. All accept optional
`--priority-files <repository-paths...>`; the wrapper validates and records these
scheduling hints before capture and forwards them into the frozen tier. They never
replace local base selection or final required coverage. Candidate browser runs also read
and update scheduling hints in the originating checkout’s ignored artifacts directory.
Those hints carry failed IDs and durations across fresh captures, never reusable receipts.
Returning hints compares the browser report identity with its pre-attempt pointer, including
on resume, and preserves newer observations present when its snapshot is read; concurrent publishers may lose hints. Older frozen runners
without per-check times use their suite start as a conservative freshness bound.
The [candidate capture](../../scripts/candidate.mjs#implementation) retains the exact
index, existing tracked/nonignored untracked bytes, modes and deletion state in a
fresh clone with its own dependencies. Unmerged indexes, symlinks, secret-like names
and detected source drift reject capture. Before/after inventories detect observed
drift; they are not an atomic filesystem snapshot. Tracked ignored files remain inputs.

The [candidate command](../../scripts/verify-candidate.mjs#implementation) retains
its clone and reports on failure. `artifacts/verification-candidate.json` identifies
the retained candidate; after tier completion and candidate stability validation it reports
whether the origin still matches. Work may continue in the origin
after capture; that does not invalidate candidate evidence or qualify changed origin
bytes. Inspect candidate results before manually integrating. No commit or merge is
automatic. Direct tiers remain for already frozen CI/release sources.

Use `scripts/with-node.sh npm run verify:prepare` to select the already installed
`.nvmrc` runtime and prepare closure. It never installs a runtime or changes shell
configuration. Preparation writes generated references and explicitly reviewed scope
metadata. It stops at unresolved scope decisions, then returns the stale explanation
list after generation. Supply `--scope-review <file>` using the browser-scope review
format, and `--documentation-review <file>` with `{source, decisions}` from that
preparation report and separate semantic decisions. `--check` is read-only.
Candidate admission repeats readiness before installation; edits require new review.

For an interrupted retained candidate, use `npm run verify:candidate -- resume
<prior-attempt-report.json>`. This uses the same frozen source, installed dependency
bytes, runtime, environment and check configuration. Only the manifest's explicitly
audited pure unit leaves can resume. Their bounded signed result values include the
process output; aggregate, browser, performance, hosted and human checks execute fresh.
The local key detects altered receipts, not a hostile process with access to that key.
Missing or invalidated leaves execute again; corrupt evidence rejects resume. Each
attempt retains its own report and parent link. Reused checks retain original execution
duration and report lookup duration separately; resumed CI does not qualify a fresh
full-CI duration. A candidate ownership lock refuses concurrent attempts and is never
expired automatically: establish the prior process tree has stopped before recovery.

Candidate timing reports separate capture, installation, dependency validation and the
tier's execution/window interval; linked window reports identify queue delay. Nested
intervals overlap and must not be summed as wall time. Tier results are published as
phases finish, and candidate reports link the actual browser suite attempts. Tick
cost attribution separates frame construction from publication and native physics;
unexplained measurement variation stays unresolved and absolute limits remain binding.

`npm run verify:merge:shadow -- --base <common-commit> --incoming <commit>
--destination <commit>` reports a proposal using both branch deltas and candidate
changes. It never changes required merge checks or executes qualification. Shared
runtime and unknown inputs retain full coverage; any proposed omissions remain
unvalidated until regression replay and held-out review support explicit policy approval.
An optional `--historical <browser-report.json>` estimates check work, not wall time.

The two assembly UX entrypoints share [one scenario owner](../../scripts/assembly-ux-cases.mjs#implementation).
Each uses its manifest-owned 90-second process watchdog and existing action deadlines; independent
artifact directories report setup, actions and cleanup separately. Watchdog exhaustion
is a harness deadline failure, not a product frame-time measurement. Browser reports
retain check kind and failure kind without inferring that host load caused a failure.

Private `docs/internal` files are absent from discovery roots and graph.files. Resolved
public imports/reads into them reject; unresolved dynamic inputs still require conservative
coverage. This does not exclude tracked private files from source fingerprints.
