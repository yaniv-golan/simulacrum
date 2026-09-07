<!-- generated: development-reference -->
# Generated developer reference

Generated from package scripts and manifest ownership. Run `npm run docs:generate` to refresh.
These are registered commands and checks, not evidence that they passed.

## Commands

| Command | Implementation |
| --- | --- |
| npm run assess | node scripts/assess.mjs |
| npm run bar:D1 | node scripts/bars.mjs D1 |
| npm run bar:F1 | node scripts/bars.mjs F1 |
| npm run bar:F2 | node scripts/bars.mjs F2 |
| npm run bar:F3 | node scripts/bars.mjs F3 |
| npm run bar:F4 | node scripts/bars.mjs F4 |
| npm run bar:F5 | node scripts/bars.mjs F5 |
| npm run bar:L0 | node scripts/bars.mjs L0 |
| npm run bar:L1a | node scripts/bars.mjs L1a |
| npm run bar:L1b | node scripts/bars.mjs L1b |
| npm run bar:L1c | node scripts/bars.mjs L1c |
| npm run bar:L1d | node scripts/bars.mjs L1d |
| npm run bar:L2 | node scripts/bars.mjs L2 |
| npm run bar:P1 | node scripts/bars.mjs P1 |
| npm run bar:S1 | node scripts/bars.mjs S1 |
| npm run bars | node scripts/bars.mjs |
| npm run build | node scripts/check-breadth-cli.mjs && vite build |
| npm run build-fingerprint | node scripts/build-fingerprint.mjs |
| npm run ci | node scripts/ci.mjs |
| npm run dev | vite --host 127.0.0.1 |
| npm run docs:check | node scripts/docs.mjs check |
| npm run docs:generate | node scripts/docs.mjs generate |
| npm run docs:impact | node scripts/docs.mjs impact |
| npm run docs:navigate | node scripts/navigate.mjs |
| npm run docs:review | node scripts/docs.mjs review |
| npm run format | prettier --write src scripts test |
| npm run format:check | prettier --check src scripts test |
| npm run gate | node scripts/gate.mjs |
| npm run gate:M0 | node scripts/gate.mjs M0 |
| npm run gate:structural | node scripts/gate-structural.mjs |
| npm run inspect:change | node scripts/inspect-change.mjs |
| npm run preview | vite preview --host 127.0.0.1 |
| npm run replay | node scripts/replay.mjs |
| npm run rules | node scripts/rules.mjs |
| npm run rules:explain | node scripts/explain-invariant.mjs |
| npm run test:all | node scripts/test-affected.mjs --all |
| npm run test:browser | node scripts/verify-browser-suite.mjs all |
| npm run test:browser:smoke | node scripts/verify-browser-suite.mjs smoke |
| npm run test:determinism | node scripts/verify-m1.mjs |
| npm run test:performance | node scripts/verify-browser-suite.mjs performance |
| npm run test:unit | node scripts/test-affected.mjs |
| npm run typecheck | node scripts/check-boundary-types.mjs |
| npm run verify:final | node scripts/verify-final.mjs |

## Structural checks

| Check | Rule or bar | Due | Implementation |
| --- | --- | --- | --- |
| layers | layers | M0 | [scripts/module-graph.mjs](../../scripts/module-graph.mjs) |
| tick-order | tick-order | M1 | [scripts/check-tick.mjs](../../scripts/check-tick.mjs) |
| identity | identity | M2 | [scripts/check-identity.mjs](../../scripts/check-identity.mjs) |
| invariant-controls | runtime-contract | M3b | [scripts/check-invariant-controls.mjs](../../scripts/check-invariant-controls.mjs) |
| boundary-types | runtime-contract | M3b | [scripts/check-boundary-types.mjs](../../scripts/check-boundary-types.mjs) |
| developer-documentation | gate-integrity | M3b | [scripts/check-documentation.mjs](../../scripts/check-documentation.mjs) |

## Invariant owners

| Invariant | Production owners | Registered checks |
| --- | --- | --- |
| rejected-edit-atomicity | [createWorkshop](../../src/core/workshop.mjs) | invariant-controls |
| preview-isolation | [proposeMirroredAssembly](../../src/model/mirror-assembly.mjs), [createAssemblyMirror](../../src/presentation/assembly-mirror.mjs), [createPlacementLifecycle](../../src/presentation/placement-lifecycle.mjs) | invariant-controls, verify-mirror-browser |
| input-cancellation | [createVehicleControls](../../src/presentation/vehicle-controls.mjs), [createPlacementLifecycle](../../src/presentation/placement-lifecycle.mjs) | invariant-controls, verify-ui-lifecycle-browser |
| geometry-agreement | [partPrimitives](../../src/model/geometry.mjs), [compileAssembly](../../src/model/assembly.mjs) | invariant-controls, verify-property-focus, verify-surface-browser |
| identity-material-admission | [compileAssembly](../../src/model/assembly.mjs), [MATERIALS](../../src/model/catalog.mjs) | identity |
| checkpoint-next-step | [createSession](../../src/simulation/session.mjs) | invariant-controls |
| copied-graph-integrity | [proposeMirroredAssembly](../../src/model/mirror-assembly.mjs) | invariant-controls |
| connection-display-isolation | [connectionRenderSpecs](../../src/presentation/connection-render.mjs), [pickableObjects](../../src/presentation/connection-view.mjs) | invariant-controls, verify-connection-test-browser |
