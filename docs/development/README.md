# Developer guide

Read [AGENTS.md](../../AGENTS.md), the [architecture map](architecture.md) and the
[recipe for your change](recipes.md) before choosing an owner. Use Node 24.18.x and
`npm ci`. `npm run dev` serves the workshop; `npm run build` and `npm run preview`
serve a stable build. The page displays its build identity.

## Find owners and checks

```sh
node scripts/navigate.mjs availablePartName
node scripts/navigate.mjs src/model/assembly.mjs
node scripts/test-affected.mjs --files src/model/assembly.mjs --explain
node scripts/explain-invariant.mjs --list
node scripts/explain-invariant.mjs rejected-edit-atomicity
```

Navigation is generated on demand from the existing module graph and parsed source
declarations. It includes imports, direct reverse consumers and transitively reachable
tests. Repeating it on unchanged source produces identical JSON; there is no checked-in
module inventory. Search by path or declaration substring. Graph errors and opaque
inputs are shown explicitly. Reachable tests help discovery; use conservative focused
selection for deciding what to run.

Invariant explanations resolve manifest-owned implementation and positive/negative
control pointers, registered checks and qualification bars. Registration is not an
execution result. An umbrella runtime rule does not prove every semantic guarantee.
Future bars stay deferred; current human bars require participant evidence.

`node scripts/test-affected.mjs --files src/model/assembly.mjs` runs tests selected
from explicit changed paths. Add `--explain` to print dependency paths and conservative
fallback reasons without running tests. Unknown changes select all tests.

## Verify a change

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
