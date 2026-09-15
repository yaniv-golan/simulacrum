# Developer guide

<!-- doc-review {"version":1,"fingerprint":"c232f20c027eba025ab177ff571cefccddab016c648c750cc84a6f89e3fdc194","dependencies":"docs/development/.reviews/README/developer-guide.json","dependencyDigest":"29e7e6025a62d440158a5e112abcd1cbdb255605c0a30431d5e13778462987ad","disposition":"still accurate","rationale":"AGENTS.md changed only in the experimental release policy paragraph, which now says an authorized release may cite a byte-identical passed merge candidate's workshop browser receipts as described in release operations (the release evidence-reuse change: prepare-release.mjs accepts --after <merge attempt report>, admits the parent through its attestation and signed resume descriptor, requires a byte-identical tree, installed-dependency digest and relevant environment, runs the tier with a resume ledger (caches redirected, the identity record's installed digest re-checked after the tier), copies every cited receipt's evidence into the frozen tree and names each in the envelope; package-verification.mjs assertReusedEvidence admits a 'passed with reused receipts' package only to a bypass-expensive release, refuses it for qualified, CI, rollback-of-qualified and recovery paths; release.mjs passes --after for prepare only and lists reused receipts in the exception record and deploy summary; verification-resume.mjs exports verifyLeafRow/readLeafRow used by the ledger loader; verification-environment.mjs adds the fixture knobs PARENT_ATTEMPT, PARENT_REPORT and PURGED to the test-owned exemption group; the manifest guarantee for release-verification-single-pass names the citation and registers both new tests as positive and negative controls); the guide's entry points, commands and structure are unchanged."} -->

Read [AGENTS.md](../../AGENTS.md), the [architecture map](architecture.md#overview) and the
[recipe for your change](recipes.md#choose-a-recipe) before choosing an owner. Use Node 24.18.x and
`nvm install && nvm use && npm ci` (with nvm installed). The checked `.nvmrc` pins a version inside the package-owned range. `npm run dev` serves the workshop; `npm run build` and `npm run preview`
serve a stable build. The page displays its build identity.

## Milestone status
<!-- doc-review {"version":1,"fingerprint":"ad663a3be9c185769e06b72e026a87eb19274b5a3579ec40a4f7a8c97f1425cc","dependencies":"docs/development/.reviews/README/milestone-status.json","dependencyDigest":"ad6f98ba0a830d92e71ad55665ee7878a5d8523d68814c308a8168a10cea9461","disposition":"still accurate","rationale":"The manifest changed only in the release-verification-single-pass guarantee text and its two new controls (the release-path tooling change: verification-tiers.mjs exports FINAL_PHASES (the qualification's phase ids, which verify-final builds its table from) and a launch wait budget read from SIMULACRUM_LAUNCH_ADMISSION_WAIT_MS within 60–600 s, recorded as budgetMs on the admission row, malformed values failing the attempt by name, and prints a refused launch with its busiest foreign processes; host-profile's childEnvironment strips that budget from leaves; prepare-release sets 300 s for the release final, fails a refused launch with a named message, exposes releaseEnvelope and dryCheckRelease (release:prepare --dry-check: prerequisites and a packaging rehearsal on the tier's own phase list, creating nothing); verify-host.mjs is the read-only readiness probe (npm run verify:host) using the admission's own code and the exported describeOwner; the manifest guarantee and controls of release-verification-single-pass name the two new tests); milestone allocation, bars and gates are unchanged."} -->

The current construction loop includes motors, cells, keyboard receivers, surface
mounts, wheel hubs, powered steering hinges, mirroring, Undo/Redo and machine saves.
Player-authored rules and a restricted TypeScript subset execute through bounded WASM
programs. Shared sensing, gears, springs, rope, reusable assemblies, powered cameras
and lamps extend the construction loop.

Implementation is distinct from qualification. Focused automated checks cover these
capabilities, but only source-bound completion evidence establishes verification for
a particular build. The manifest currently declares M3b; designated-player F1 acceptance
remains pending. The broader hostile-program S1 qualification, physical feasibility
probe, rover Course and legged Course qualification remain incomplete. The
[manifest](../../scripts/manifest.json) owns current allocation and registered checks;
`npm run gate` evaluates it rather than inferring progress from available features.
[AGENTS.md](../../AGENTS.md), the [runtime contract](../contracts/runtime-v1.md),
[Course contract](../contracts/course-v1.md) and the manifest own architecture and
qualification. A green smoke test is not Course or human acceptance. The `main` branch
contains the v2 workshop; the previous implementation is retained at the
[`v1-final-2026-09-11` tag](https://github.com/yaniv-golan/simulacrum/tree/v1-final-2026-09-11)
and `archive/v1` branch for reference, and legacy v1 machine files are not a supported
import format for v2 (keep their originals and use v1 to open them). Published
[releases](https://github.com/yaniv-golan/simulacrum/releases) are experimental until the
milestones above are met; each v2 release's notes name its deferred checks.

## Working loop

<!-- doc-review {"version":1,"fingerprint":"96ec854d7c9bb7de55f5f2ce367f006708b8225ac90b05ac19e816e94e3ac04c","dependencies":"docs/development/.reviews/README/working-loop.json","dependencyDigest":"100fe5c738cf156112b1a06eae8025f10351baf676498a05c1dc9498b51f7b95","disposition":"still accurate","rationale":"Only the linked ui-ux before-changing-player-facing-ui section re-fingerprinted (its placement paragraph gained the anchoring rule); the loop's steps are unchanged."} -->

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

<!-- doc-review {"version":1,"fingerprint":"d53a85e3c39f62136abc20df1ac284ac19caa23859c5ee2007993bf8b81ffd94","dependencies":"docs/development/.reviews/README/verify-a-change.json","dependencyDigest":"cb2e744d414c2c5a6ede402a607a4e5ac1bfe2edbafebcbb4dafb0a2f542c530","disposition":"still accurate","rationale":"playtesting.md#release-operations gained the dry-check and launch-wait paragraph and package.json the verify:host script (the release-path tooling change: verification-tiers.mjs exports FINAL_PHASES (the qualification's phase ids, which verify-final builds its table from) and a launch wait budget read from SIMULACRUM_LAUNCH_ADMISSION_WAIT_MS within 60–600 s, recorded as budgetMs on the admission row, malformed values failing the attempt by name, and prints a refused launch with its busiest foreign processes; host-profile's childEnvironment strips that budget from leaves; prepare-release sets 300 s for the release final, fails a refused launch with a named message, exposes releaseEnvelope and dryCheckRelease (release:prepare --dry-check: prerequisites and a packaging rehearsal on the tier's own phase list, creating nothing); verify-host.mjs is the read-only readiness probe (npm run verify:host) using the admission's own code and the exported describeOwner; the manifest guarantee and controls of release-verification-single-pass name the two new tests); both are development probes under the existing table; the tiers, commands, exit codes and evidence rules this section describes are unchanged."} -->

- `npm run test:unit` selects affected tests conservatively; `npm run test:all` runs all unit/property tests.
- `npm run typecheck` checks production boundaries, generated types and deliberately invalid type fixtures.
- `npm run verify:local` runs CI and conservatively affected browser checks, with `artifacts/verification-local.json` recording the base, exact paths, selection reasons and source. Default base is HEAD; `--base <commit>` includes committed changes since that commit. Untracked files are included and clean source selects all checks. Exit 0 means local automation passed; qualification and human acceptance are explicitly NOT_EVALUATED.
- `npm run verify:merge -- --base <commit>` runs CI, audited affected browser checks and the three registered merge smoke checks. It never runs the milestone gate or evaluates human acceptance.
- `npm run verify:final` runs CI, all browser checks and the current gate with invocation-local shared check receipts; human acceptance remains a separate requirement. All completion tiers stop after a failed prerequisite, including stale documentation, before starting browser work. The [verification outcome](../../scripts/verification-outcome.mjs#implementation) separates automation, human acceptance and overall qualification: exit 0 means qualified, exit 1 means automation failed or was incomplete, and exit 2 means automation passed but human acceptance blocks qualification. Failed or invalid human evidence is distinguished from missing evidence; none authorizes qualification. An `incomplete` human session (one that ended before any criterion could be judged) is recorded but supplies no verdict: the latest complete session governs, a bar with only incomplete sessions is pending, and a later incomplete session is named beside the governing verdict.
- `npm run ci` runs structural and unit checks within the development budget.
- `npm run gate` evaluates the current cumulative milestone, including human requirements.
- `npm run test:browser:affected -- --files <paths>` selects, explains in its report, builds once and executes conservative browser coverage. Add `--summary` for source-bound discovery without building or opening sockets.
- A waived tier must still record its affected browser selection by check id: `npm run test:browser:affected -- --files <paths> --summary` prints the selection JSON and `npm run inspect:change -- --files <paths>` lists the ids grouped by selection reason; both run without executing checks or entering the verification window. Waiver applies to execution, never to enumeration.
- `npm run test:browser -- --checks verify-part-help-window verify-part-help-browser` runs explicit development probes with one build and combined `artifacts/browser-suite/selected.json` evidence. This does not claim local completion or qualification. Unknown IDs/options fail rather than silently narrowing scope.
- `npm run test:browser` builds and runs all registered browser checks; `npm run test:browser:smoke` runs construction smoke checks.
- `npm run test:performance` runs the isolated performance checks.
- `npm run format` applies the pinned formatter; generated validators and the machine-written `scripts/manifest.json` are excluded — the manifest keeps the scope writer's `JSON.stringify(…, null, 2)` layout, enforced by `validateManifest` (repair: `node scripts/validate-manifest.mjs --canonical-layout`).
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

Stacked integrations: when another candidate is already verifying against the same
destination, merge that integration branch instead of `main` and pass its branch name as
`--destination` with the same `--base`; the later candidate then lands unchanged once the
earlier one fast-forwards. A branch-pair merge candidate records the supplied name as
`priority.destinationName` and, at completion, `destinationStillMatches`: true, false (the
destination moved, so the evidence no longer applies to that integration), UNRESOLVED (the
name no longer resolves — normal after a stacked branch is deleted once it fast-forwarded;
confirm `git rev-parse main` equals `priority.destination` instead) or NOT_EVALUATED (a
bare commit was supplied). If the earlier integration is revised after being stacked on,
re-merge its head and re-verify. A candidate that waited on another window owner retains
that owner's declared intent (tier, branch, destination, origin worktree) under
`windowReports[].value.contenders[].intent`.

Install browser dependencies once with `npx playwright install chromium chrome`.
Linux tab capture needs Xvfb. Follow [playtesting](playtesting.md#remote-setup) for recordings and
human evidence. Run the required tier on the same final source; do not reuse an old green
report after changing source or environment. An experimental release may cite a byte-identical
merge candidate's receipts only through the named release admission.

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

<!-- doc-review {"version":1,"fingerprint":"f6aa8ea345ceb976a08f9c9627d16fe44c2aed355ad6ded717f667f0a79a2f33","dependencies":"docs/development/.reviews/README/keep-explanations-current.json","dependencyDigest":"995277ead727937e3d8607deedf2d4132dc15642dc82b68cf713c1eca540873a","disposition":"still accurate","rationale":"reference.md regenerated for the new verify-host module and the extended release guarantee (the release-path tooling change: verification-tiers.mjs exports FINAL_PHASES (the qualification's phase ids, which verify-final builds its table from) and a launch wait budget read from SIMULACRUM_LAUNCH_ADMISSION_WAIT_MS within 60–600 s, recorded as budgetMs on the admission row, malformed values failing the attempt by name, and prints a refused launch with its busiest foreign processes; host-profile's childEnvironment strips that budget from leaves; prepare-release sets 300 s for the release final, fails a refused launch with a named message, exposes releaseEnvelope and dryCheckRelease (release:prepare --dry-check: prerequisites and a packaging rehearsal on the tier's own phase list, creating nothing); verify-host.mjs is the read-only readiness probe (npm run verify:host) using the admission's own code and the exported describeOwner; the manifest guarantee and controls of release-verification-single-pass name the two new tests); the documentation workflow, review sidecars and dispositions described here are unchanged."} -->

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

Full browser coverage remains scheduled and required for releases and qualification. The scheduled hosted run executes under a registered host profile: deadlines are the profile's registered values (never shorter than the local ones), performance-tier checks and every timing-sensitive check (there is no quiet-host admission without a tier context) are reported `NOT_EVALUATED` with the platform reason rather than executed and the coverage comparison lists them apart, a profile in measurement mode labels every report `measurement` and is never evidence, and completion tiers refuse to run under any profile. Measurement mode is bounded by hand: after each hosted measurement run, record its workflow run id in `hostProfiles.<id>.measurementRuns` (the validator refuses a fourth while `measurement` is true); after three, register `hostedTimeoutMs` on every evaluated browser check from the observed p95 durations, set `measurement: false` and remove the provisional `browserTimeoutMs` rule, or the manifest is rejected. In-script page deadlines are not scaled by the profile, so a check failing there with exit 1 on the runner is expected and is not registrable away. A dispatched `release-package` job runs unprofiled and stays red on the hosted runner until a hosted release policy exists.
CI preserves separate unit and browser jobs: pull requests use the pinned event tips
and actual merge checkout, while missing push history selects full coverage. Scheduled
full runs compare last-commit merge selection only when matching complete evidence is
available; incomplete or mismatched comparisons are `NOT_EVALUATED`. This does not
establish safety for every omitted check or replace the full run.

## Browser execution and scope

<!-- doc-review {"version":1,"fingerprint":"8f1fc52cc772545242a4dce0027bd1302ee56c2968dbc889498291a655e653b4","dependencies":"docs/development/.reviews/README/browser-execution-and-scope.json","dependencyDigest":"6229bc24e09643073660ca46f9ac1baec1f9b551b8e1e0c235a6dd70f69e601c","disposition":"updated","rationale":"Amended the launch-admission sentence: 60 s by default, a release final up to five minutes via the bounded budget variable, the budget recorded on the row and a refusal printed with its offenders (the release-path tooling change: verification-tiers.mjs exports FINAL_PHASES (the qualification's phase ids, which verify-final builds its table from) and a launch wait budget read from SIMULACRUM_LAUNCH_ADMISSION_WAIT_MS within 60–600 s, recorded as budgetMs on the admission row, malformed values failing the attempt by name, and prints a refused launch with its busiest foreign processes; host-profile's childEnvironment strips that budget from leaves; prepare-release sets 300 s for the release final, fails a refused launch with a named message, exposes releaseEnvelope and dryCheckRelease (release:prepare --dry-check: prerequisites and a packaging rehearsal on the tier's own phase list, creating nothing); verify-host.mjs is the read-only readiness probe (npm run verify:host) using the admission's own code and the exported describeOwner; the manifest guarantee and controls of release-verification-single-pass name the two new tests); pool sizing, phases, selection and admission policy are otherwise unchanged."} -->

The [browser selector](../../scripts/browser-selection.mjs#implementation) includes the
served workshop/probe HTML roots as well as verifier imports. Self-hosted checks and
opaque file/subprocess inputs conservatively expand selection. In the current application,
shared runtime and identity dependencies often select the full browser suite.
`browserLocalScopes` in the manifest is an explicit local-only behavioral contract: a named
entrypoint, its frozen direct dependency shape, and required feature/integration checks.
All local scopes also bind the transitive reverse-consumer set and the reaching checks: the
browser checks whose script or served page reaches the entrypoint through the import graph.
New consumers and new reaching checks restore broad coverage until reviewed; outgoing imports
alone are insufficient, and a check that does not reach the entrypoint never affects its row.
Self-environment checks serve their own pages and may load any application module, so every
self check counts as reaching every entrypoint.
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
Optional `--base <commit>` (also on `verify:prepare`) names the candidate delta; the
proposal, its summary and the apply report then carry `affectedNotWitnessed` — the
checks that delta would select which no witness of this proposal executes. It is
enumeration only (NOT_EXECUTED), never blocks or changes application, and reads
"not computed" without a base; a waived or partial run is accountable to that list. The
review digest binds the basis, so `verify:prepare -- --scope-review` must repeat the same
`--base`.

Write a review JSON with `proposalDigest` and separate `decisions` containing each
changed `key`, `accept: true` and a specific `rationale`. Then run
`npm run browser:scopes -- apply artifacts/scope-proposal.json --review artifacts/scope-review.json`.
Apply captures an isolated candidate, installs dependencies and runs the union of old
and proposed witnesses under the shared verification window. A row that gains reaching checks not
in its declared checks lists them as `reachingNotDeclared`; its review row must carry
`undeclared: "acknowledged"` or, for local rows, `declare: [ids]`, and declared ids join the
row's checks and its witnesses before anything is trusted. Rows whose only change is added
reaching checks or the membership format apply on that review alone and record witnesses
`NOT_REQUIRED`; removals, a legacy digest recorded against a different inventory, and every
other field change execute witnesses as before. Metadata invariant controls
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

The [browser runner](../../scripts/verify-browser-suite.mjs#implementation) schedules a
run in three phases: the headless pool (checks declared `execution: parallel`), the
serialized lane (exclusive checks that are not timing-sensitive), then timing-sensitive
checks last. A completion tier derives its pool workers from the host at start — one per
two idle cores (a GPU-backed headless check is about two runnable threads), at most four,
recorded as `workersBasis` with the launch niceness; a tier that derives workers refuses a
niced launch (zsh nices every `&` job unless `bgnice` is unset; `nice`; an already-niced
parent), because a niced tier loses to every other process regardless of idle cores. It
admits the timing phase only on a
quiet host: one bounded wait that tracks the one-minute load average's decay (up to 180 s,
`SIMULACRUM_TIMING_WAIT_MS` for nightly; refusing early when the load is not falling) and
samples what load1 cannot see — host CPU idle over one second and the busiest processes outside
the tier's own tree, recorded in `timingAdmission.pressure`, holding the wait and refusing by
process name (idle below 80 % or a foreign process at 40 %+ of a core; bounds read from a
resting desktop's own records; `SIMULACRUM_TIMING_PRESSURE=observe` records without
refusing) — then the
remaining timing rows are recorded `not evaluated`
and the run fails; nothing is retried. Every tier also runs that admission once at launch,
inside the window and before the CI phase (60 s by default; a release final waits up to five
minutes, `SIMULACRUM_LAUNCH_ADMISSION_WAIT_MS` within 60–600 s, the budget recorded on the row and a
refusal printed with its busiest foreign processes), because the structural gates hold 5 s
deadlines that an updater burst at t = 0 fails before anything was measured; a refused launch
is a failed attempt whose only row is `launch-admission`, not evaluated. The launch applies the
foreign-process bound only to a tier whose resolved selection reaches a timing row (`reach:
timing`, recorded on the tier and on the row's `policy`); a tier that will measure nothing
launches on load and idle alone (`reach: structural` — a window server at 55 % of one core does
not starve a 5 s gate), and its selection phase refuses if the reach moved after launch, so no
timing phase ever follows a lax launch. `WindowServer` in a refusal means someone's windows
are drawing (an editor, a chat app); the cure is hiding or quitting them, never a laxer bound
and never a dark display — the `focus` lane checks are headed and stall once macOS marks their
window invisible, which is why the tier holds `caffeinate -d`. A leaf the host slept
through (a wall-clock gap of more than a minute between the runner's heartbeats) is recorded
`host slept … not evaluated`, never as a timeout, and the tier's summary names it. In a merge
tier a timing-budget check runs only when the delta can reach what it measures (its manifest
`measures` class — `physics` for the two node-only engine budgets, `render` for the six that
drive the app — or its own import closure); the omitted rows carry the reason; `final` and a local all-checks run execute every row (the
hosted nightly reports timing rows NOT_EVALUATED under its profile). The hosted merge route
uses the same selection, so it omits them too. A run without a tier context (the hosted CI route,
scope witnesses) keeps two workers and unconditional timing execution. Explicit `--workers 1..4`
remain for development probes and for `test:browser:serial`; an explicit count skips host
admission and records that it did. Missing metadata, performance checks, headed (focus) and recording profiles,
probe environments and self-hosted checks that do not prove isolation run exclusively;
`timingSensitive: true` rows (declared, and required by a source guard whenever a script
asserts a p95/quantile/CPU budget) always run last. A self-hosted row may join the pool only
when its source binds servers to port 0, keeps every artifact path under the per-check root
and starts no Vite dev server. Each admitted check owns its browser process, contexts and
artifact directory; probe servers are local to the check and always closed.
Source changes stop new dispatches and drain already-started work.
The [shared browser launch boundary](../../scripts/browser-session.mjs#implementation) checks the resolved profile and headless option against
the child process execution policy, so passing a profile through a variable cannot bypass
exclusive execution. This is an engineering guard, not a sandbox for hostile verifier code.
Every context it opens is marked a returning device (an init script stores the
`simulacrum-first-run-v1` answer) so the workshop's one-time first-run choice never opens
inside an unrelated journey; a check that is about the first visit passes
`firstRun: true` to `newPage`/`newContext` and gets a clean device.
Reports preserve manifest order, all failures, worker configuration and source identity.
Every check records its planned schedule index, dispatch time, active browser peers and
host load averages. These describe admission conditions; they do not establish stable
warmup, causal contention or comparable performance distributions across reordered runs.
A failed row additionally carries `processSnapshot` from the
[process runner](../../scripts/run-check.mjs#implementation): at a watchdog timeout, the
same bounded process enumeration that terminates the owned tree also retains load
averages at that moment, the top eight processes by CPU and by RSS, Gatekeeper and
Spotlight daemons regardless of rank, the check's own tree (executable names only,
never arguments or environment), and on macOS whether the stalled executable still
carried quarantine or provenance attributes; a non-zero exit retains a post-hoc snapshot
without a tree. `enumerationMs` is the `ps` cost, `snapshotMs` the ranking cost and `hintMs` the attribute lookup. macOS
`%cpu` is a recent estimate and Linux `%cpu` a lifetime average, so `time` and `etime`
accompany it. The snapshot is context for a person, never attribution, and a failure to
take it is recorded without changing the outcome. Failed browser rows also carry
`appStatus` — the visible `role="status"` and polite or assertive live-region texts the
application was announcing when the failure was captured, echoed on the `FAIL` line, so a
timeout on a disabled control names the application's own reason — and `msSinceInstall`,
the age of the candidate's installed dependencies at the failure. Performance gates
should name the trial and the measured values in their assertion message so a failure
row is readable without the evidence files.
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

Inside the pool, priority checks queue first and the rest run longest recorded duration
first; the priority prefix never splits the pool. The order is deterministic in its inputs;
`SIMULACRUM_BROWSER_SCHEDULE_SEED` set to anything but the default orders the pool by the
seed alone (ignoring durations), which is the control a nightly run uses together with
`test:browser:serial` so neither order nor contention can be the reason a check passes.
The report records the phases, the schedule, each row's phase and the host load it started
under; this admits no additional check to the pool.
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
unit controls. The structural prerequisites include the `format` gate — the same
`prettier --check` over `src`, `scripts` and `test` that the hosted `format:check` job runs,
cached under `artifacts/format-gate` (never under `node_modules`, whose bytes the candidate
digests) — so a layout defect cannot reach `main` through a local tier. The 180-second CI obligation is unchanged.

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

<!-- doc-review {"version":1,"fingerprint":"edbc0806dc6f26780104836f712ec41a04a7696930d3398f0616f4c4d8473ddc","dependencies":"docs/development/.reviews/README/shared-verification-window.json","dependencyDigest":"dc2ff44afbf24ffab9fde7d58d2dc46f31a38fc4af39492a95f09b2e791edd51","disposition":"updated","rationale":"Added the verify:host sentence: a read-only readiness probe evaluating one pressure sample through the launch admission's own code for both reaches plus the window owner, exit 0 only when admitted and free, never holding the window (the release-path tooling change: verification-tiers.mjs exports FINAL_PHASES (the qualification's phase ids, which verify-final builds its table from) and a launch wait budget read from SIMULACRUM_LAUNCH_ADMISSION_WAIT_MS within 60–600 s, recorded as budgetMs on the admission row, malformed values failing the attempt by name, and prints a refused launch with its busiest foreign processes; host-profile's childEnvironment strips that budget from leaves; prepare-release sets 300 s for the release final, fails a refused launch with a named message, exposes releaseEnvelope and dryCheckRelease (release:prepare --dry-check: prerequisites and a packaging rehearsal on the tier's own phase list, creating nothing); verify-host.mjs is the read-only readiness probe (npm run verify:host) using the admission's own code and the exported describeOwner; the manifest guarantee and controls of release-verification-single-pass name the two new tests); window acquisition, waits and recovery are unchanged."} -->

The [verification window](../../scripts/verification-window.mjs#implementation) coordinates
supported npm build, CI, completion, focused unit and browser commands across worktrees
on this host. Nested commands inherit the owning window. Completion/browser admission marks its
canonical report non-green before runtime checks or lock waiting; failed admission
replaces an older pass even when no child starts. Local, merge, final and native-qualification completion
CLI runs wait up to thirty minutes. Focused unit/browser probes, builds and standalone
CI wait up to five minutes; they retain the same serialization. `npm run verify:host` is the
read-only readiness probe: one pressure sample evaluated through the launch admission's own
code for both reaches, plus the window owner, exit 0 only when a launch of the requested reach
(`--reach`, default `timing`) would be admitted now and the window is free; it never holds the
window and is advisory, the tier's own admission decides. The CLI prints the
owner PID, its declared intent (script or completion tier, integration destination and
origin worktree when a candidate declared them) and elapsed/maximum wait on contention
and every thirty seconds thereafter. A candidate that waited on an owner retains that
owner's intent in its report under `windowReports[].value.contenders[].intent`. When
the owner is a merge candidate for the same destination, stack on that integration
branch instead of racing it (see [stacked integrations](#verify-a-change)).
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

<!-- doc-review {"version":1,"fingerprint":"29569752f0a55b4ddefbd7647eccd20a737c3c1aeb2d821b1919a9f0f678a944","dependencies":"docs/development/.reviews/README/isolated-candidate-completion.json","dependencyDigest":"b8653168e2e8f42465c1238dcf62312fb047af430c0bc59bb7302ada90145ce5","disposition":"still accurate","rationale":"The launch wait budget, its exemption and the leaf-environment strip changed how long a launch may wait, never what a candidate captures, compares or reuses (the release-path tooling change: verification-tiers.mjs exports FINAL_PHASES (the qualification's phase ids, which verify-final builds its table from) and a launch wait budget read from SIMULACRUM_LAUNCH_ADMISSION_WAIT_MS within 60–600 s, recorded as budgetMs on the admission row, malformed values failing the attempt by name, and prints a refused launch with its busiest foreign processes; host-profile's childEnvironment strips that budget from leaves; prepare-release sets 300 s for the release final, fails a refused launch with a named message, exposes releaseEnvelope and dryCheckRelease (release:prepare --dry-check: prerequisites and a packaging rehearsal on the tier's own phase list, creating nothing); verify-host.mjs is the read-only readiness probe (npm run verify:host) using the admission's own code and the exported describeOwner; the manifest guarantee and controls of release-verification-single-pass name the two new tests); candidate identity, capture, completion tiers and the release citation are unchanged."} -->

Concurrent implementations use separate Git worktrees. Start one with
`git worktree add -b codex/my-change /tmp/simulacrum-my-change HEAD`, install its
pinned dependencies, and edit there. Do not include another task's dirty work.
Every candidate copy (and the frozen release snapshot) carries a `.metadata_never_index`
marker at its root so Spotlight does not index the fresh tree while the tier runs; the
marker sits above `source` and never enters the candidate's identity.

After `docs:prepare` and semantic review, run `npm run verify:candidate -- local`
(or `-- local --base <commit>`). Launch it at ordinary priority: zsh nices every backgrounded
job by default (`unsetopt bgnice` first, e.g. `zsh -c "unsetopt bgnice; nohup caffeinate -dis npm
run verify:candidate -- local &"`), and the command refuses a niced launch. For routine merge readiness use `-- merge --base <commit>`; for release/milestone qualification use `-- final`. All accept optional
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

A diagnosed retry of a failed attempt uses `npm run verify:candidate -- <tier> [tier options]
--after <attempt-report.json> --cause <checkId>=<diagnosed cause>` for `local` and `merge`
only; `final` refuses `--after` because qualification evidence is always a fresh full run (the
one named admission is an experimental release's `release:prepare -- … --after`, see
[release operations](playtesting.md#release-operations)). The
parent must be a `failed` report that completed its tier; an attempt that failed around the tier
(window, drift, dependency change) needs `--cause candidate=<reason>` as well, and a parent with
no tier receipts needs a fresh candidate. Every failed or unexecuted leaf of the parent needs
its own cause; optionally one cause on the aggregate that listed unexecuted files (for example
`ci:budget`) covers exactly those files, and alongside failed leaves a cause on an aborted phase
(`ci`, `browser`) may record that the leaves beneath it never ran. Rows a phase refused before
they ran (timing rows under a refused admission) leave no receipt and the phase row names them
(`notEvaluated`); rows a sleeping host skipped carry a receipt marked not evaluated. Both count as
unexecuted leaves beneath their phase rather than as failures, so a cause on the phase covers
them (a cause per row is also accepted) and the retry must observe each one executed and
passing. A plain `resume` of a retry
report is refused (retry it with `--after` so the chain is kept). The retry must repeat the
parent's scope as the commits its refs name now — a moved `--base` or `--destination` is refused
rather than re-pinned — and the parent's bytes, identity and installed dependencies are read
from its signed candidate descriptor, never from the report; the report itself, whose receipts
and coverage the retry classifies, is admitted only under the attestation the candidate wrote
with its resume key (every candidate report carries one), so an edited report is refused. On identical source bytes, installed dependencies
and relevant identity (runtime, platform and the declared relevant environment — `NODE_ENV`
defaulting to `production` as the tier does, `NODE_OPTIONS`, `POWER_BASELINE_SOURCE`,
`FEEDBACK_*`, `LOAD_CELL_MATRIX_*`, `PLAYWRIGHT_*` including `PLAYWRIGHT_BROWSERS_PATH`,
`PLAYTEST_*`, `SIMULACRUM_BROWSER_*`, `SIMULACRUM_HOST_PROFILE`; every other variable the project's own code reads under
`scripts`, `src`, `test` and the root configuration is listed with its reason in
`ENVIRONMENT_EXEMPTIONS` and recorded forensically, not bound — variables consumed only by
libraries, such as `CI`, `TZ`, `DEBUG` or `NODE_TLS_*`, are forensic too — which also lets a
plain `resume` accept a different terminal) the retry reuses the parent directory and the parent's
passing unit and browser leaves through the signed ledger, each naming its origin attempt and
bounded to three chained attempts. Installed dependencies pin only the bundled Playwright
browsers; checks registered `browserChannel: "chrome"` launch the system browser, directly or
through a module they load, and its version is bound into that check's configuration so a
browser update refuses those receipts alone.
Non-pass leaves, the registered controls of their invariants, the checks of invariants a failed
control guards (together the `required` set), checks registered `timingSensitive` or
`mergeSmoke` in the manifest, structural gates, builds and aggregates always execute; the
required browser checks are added to whatever the tier selects, a widening the tier reads from
the attempt's private ledger configuration. When bytes, dependencies or identity differ, the
retry captures a fresh candidate and loads no receipt. If only source bytes differ
(`deltaSelection: source-only`), the byte delta between the two candidates reaches the tier
through the same ledger configuration — never as a command-line flag; `--changed-files` is
refused everywhere — together with the browser checks the parent chain already passed
(`covered`). The tier still applies its own policy to the candidate's base diff and runs
everything that selects, except a covered check the byte delta does not reach (classified by
the same policy; risky paths and unknown inputs still select everything): those are recorded as
`skippedByDelta`, reasoning rather than evidence, and validation refuses a skipped check that
is not covered or that ran. A parent whose browser phase never ran covers nothing, so its retry
runs the full fresh selection. If the runtime, platform, relevant
environment or installed dependencies changed (`deltaSelection: fresh-policy`), every parent
browser pass is stale and the tier runs its ordinary selection with nothing skipped. A retry
that reused a receipt or skipped a leaf by delta reports `passed after failure`, never plain
`passed`; a retry that re-executed everything reports `passed` with the same `after` block, and
a resumed receipt without an origin attempt fails the report. Either way every required leaf
must appear in the child as an executed passing receipt, and nothing re-executed may also be
skipped, or the retry fails. Tampered or oversized receipts fail closed. The `after` block
carries the causes, the chain (recorded before capture, three attempts at most), reused
origins with their attempt and depth, the covered and skipped checks, the required and
re-executed leaves, the controls they pulled in and the always-fresh leaves. This is the
diagnosed retry the norm above requires, not a retry-to-green.

The same `--after <attempt-report.json>` with a **passed** parent (status `passed` or
`passed with reused receipts`; no `--cause`) is receipt reuse across candidates: an author's
`local` attempt lending its workshop browser receipts to the reviewer's `merge` (or `local`)
candidate on identical bytes. The child is its own candidate with its own capture, install,
descriptor and key; it admits the parent only after its attestation verifies, it is a finished
attempt (no `active-attempt` lock, a terminal tier report) on a `local` or `merge` tier, and it
is not a hosted-profile or measurement report; `final` refuses reuse on either side. Reuse
happens only when the child's frozen source, its installed dependencies and its relevant
identity equal the parent's signed descriptor; otherwise the child runs plainly with nothing
reused and no delta narrowing. The offered set is derived from manifest facts, never a list:
browser rows of tier `browser` and environment `workshop` that are neither `mergeSmoke` nor
`timingSensitive`, and only receipts the parent executed itself (depth 0 — a receipt is never
cited twice). The child selects its own checks; CI, unit leaves, smoke, timing-sensitive,
hosted and probe checks always execute. The ledger names the parent's leaves and key
(`previous`, `previousKey`, `reuse`), and a browser receipt is offered only while the
evidence it points at is intact: its value records the evidence directory, every file and the
log with digests and sizes, an absent path executes the check again, altered bytes fail
closed. A child that reused anything reports `passed with reused receipts` with an `after`
block naming the offered, reused (with origin attempt and depth) and executed leaves;
validation refuses a resumed receipt the parent did not offer or that is not depth 1 from
that parent. Nothing here changes what a landing needs: candidate evidence still applies only
to its recorded bytes.

A release's `final` on byte-identical code is that commit's merge evidence when recorded as a
citation: `npm run verify:candidate -- merge --base <commit> --incoming <commit> --destination
<ref> --satisfied-by <release directory>` reads the release's own record first (`source.json`,
which `release:prepare` writes after `npm ci` and before `verify:final`; a release without it
is refused, so a citation exists only during or after the release's final, never before), then
captures, installs and digests the candidate exactly as a merge candidate and validates the
integration scope, and — in place of the tier — compares the candidate's head, every tracked
and non-ignored path's bytes and mode and its installed dependency digest with that record
(the git index and the process identity are not compared). Identical bytes, a final whose
report is terminal and passed, and a packaged `release.json` whose verification envelope
binds the same source record `mergeReadiness` (`satisfiedBy` names the release, its
`source.json`, final report and package by sha256, the head and the installed digest) and the
report passes; a differing path, digest or head, a final on another head, or a package that
does not bind are refused by name with no merge readiness recorded, and a red final is refused
with the failure recorded (`mergeReadiness.failed`). The final's report exists from its first
phase (`status: running`), so a release whose final has not ended, or whose green final is not
yet packaged, is `pending final` (exit 3, `mergeReadiness.pendingOn: final | package`) — and
only with `--pending`: without it the command refuses before any capture, because no capture
runs beside a final unless the slot owner asks (a pending citation records the window owner it
was captured beside). `npm run verify:candidate -- cite-final <attempt report>` resolves it
once the release is complete, against the same release bytes (a re-prepared release is
refused), recording `landed` (whether `main` is the cited head where it runs). A citation
carries no receipts, is never reusable, and can be neither resumed nor retried. The landing
message says whether the final is pending; while it is, nothing names `main` or the landing's
branch as a destination.

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
