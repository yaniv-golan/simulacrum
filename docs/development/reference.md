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
| npm run docs:prepare | node scripts/docs.mjs prepare |
| npm run docs:review | node scripts/docs.mjs review |
| npm run format | prettier --write src scripts test |
| npm run format:check | prettier --check src scripts test |
| npm run gate | node scripts/gate.mjs |
| npm run gate:M0 | node scripts/gate.mjs M0 |
| npm run gate:structural | node scripts/gate-structural.mjs |
| npm run inspect:change | node scripts/inspect-change.mjs |
| npm run playtest:download | node scripts/playtest/download.mjs |
| npm run playtest:local | wrangler dev --port 8787 |
| npm run preview | vite preview --host 127.0.0.1 |
| npm run release:deploy | node scripts/playtest/release.mjs deploy |
| npm run release:prepare | node scripts/playtest/release.mjs prepare |
| npm run replay | node scripts/replay.mjs |
| npm run rules | node scripts/rules.mjs |
| npm run rules:explain | node scripts/explain-invariant.mjs |
| npm run test:all | node scripts/test-affected.mjs --all |
| npm run test:browser | node scripts/verify-browser-suite.mjs |
| npm run test:browser:affected | node scripts/verify-browser-suite.mjs |
| npm run test:browser:smoke | node scripts/verify-browser-suite.mjs smoke |
| npm run test:determinism | node scripts/verify-m1.mjs |
| npm run test:performance | node scripts/verify-browser-suite.mjs performance |
| npm run test:unit | node scripts/test-affected.mjs |
| npm run typecheck | node scripts/check-boundary-types.mjs |
| npm run verify:final | node scripts/verify-final.mjs |
| npm run verify:local | node scripts/verify-local.mjs |

## Structural checks

| Check | Rule or bar | Due | Implementation |
| --- | --- | --- | --- |
| layers | layers | M0 | [scripts/module-graph.mjs](../../scripts/module-graph.mjs) |
| tick-order | tick-order | M1 | [scripts/check-tick.mjs](../../scripts/check-tick.mjs) |
| identity | identity | M2 | [scripts/check-identity.mjs](../../scripts/check-identity.mjs) |
| invariant-controls | runtime-contract | M3b | [scripts/check-invariant-controls.mjs](../../scripts/check-invariant-controls.mjs) |
| boundary-types | runtime-contract | M3b | [scripts/check-boundary-types.mjs](../../scripts/check-boundary-types.mjs) |
| developer-documentation | gate-integrity | M3b | [scripts/check-documentation.mjs](../../scripts/check-documentation.mjs) |
| verification-runtime | gate-integrity | M3b | [scripts/runtime-preflight.mjs](../../scripts/runtime-preflight.mjs) |
| verification-workflow | gate-integrity | M3b | [scripts/verification-tiers.mjs](../../scripts/verification-tiers.mjs) |

## Invariant owners

| Invariant | Production owners | Registered checks |
| --- | --- | --- |
| rejected-edit-atomicity | [createWorkshop](../../src/core/workshop.mjs) | invariant-controls |
| preview-isolation | [proposeMirroredAssembly](../../src/model/mirror-assembly.mjs), [createAssemblyMirror](../../src/presentation/assembly-mirror.mjs), [createPlacementLifecycle](../../src/presentation/placement-lifecycle.mjs) | invariant-controls, verify-mirror-browser |
| input-cancellation | [createVehicleControls](../../src/presentation/vehicle-controls.mjs), [createPlacementLifecycle](../../src/presentation/placement-lifecycle.mjs) | invariant-controls, verify-ui-lifecycle-browser, verify-part-help-browser, verify-part-help-window |
| geometry-agreement | [partPrimitives](../../src/model/geometry.mjs), [compileAssembly](../../src/model/assembly.mjs) | invariant-controls, verify-property-focus, verify-surface-browser |
| identity-material-admission | [compileAssembly](../../src/model/assembly.mjs), [MATERIALS](../../src/model/catalog.mjs) | identity |
| checkpoint-next-step | [createSession](../../src/simulation/session.mjs) | invariant-controls |
| copied-graph-integrity | [proposeMirroredAssembly](../../src/model/mirror-assembly.mjs), [insertAssembly](../../src/model/reusable-assemblies.mjs) | invariant-controls, verify-assemblies-browser, verify-assembly-ux-browser |
| connection-display-isolation | [connectionRenderSpecs](../../src/presentation/connection-render.mjs), [pickableObjects](../../src/presentation/connection-view.mjs) | invariant-controls, verify-connection-test-browser, verify-exploded-browser |
| capture-write-admission | [createPlaytestServer](../../scripts/playtest-server.mjs) | invariant-controls |
| capture-cloud-integrity | [CaptureStore](../../scripts/playtest/cloud-store.mjs) | invariant-controls |
| capture-receipt-ownership | [openCaptureOutbox](../../src/application/capture-outbox.mjs) | invariant-controls |
| release-publisher-ownership | [ReleaseCoordinator](../../scripts/playtest/release-control.mjs) | invariant-controls |
| capture-synthetic-cleanup | [CaptureStore](../../scripts/playtest/cloud-store.mjs) | invariant-controls |
| release-effective-isolation | [verifyCredentialIsolation](../../scripts/playtest/credential-isolation.mjs) | invariant-controls |
| release-load-delivery | [retryUpload](../../scripts/playtest/load.mjs) | invariant-controls |
| release-verification-single-pass | [prepareRelease](../../scripts/playtest/prepare-release.mjs), [assertPackageVerification](../../scripts/playtest/package-verification.mjs) | invariant-controls |
| release-experiment-exceptions | [selectExperiments](../../scripts/playtest/experiments.mjs), [recordExperimentPasses](../../scripts/playtest/release.mjs), [retrieveEvidence](../../scripts/playtest/experiment-transport.mjs) | invariant-controls |
| release-experiment-inputs | [deriveExperimentInputs](../../scripts/playtest/experiment-inputs.mjs) | invariant-controls |
| release-characterization-ownership | [withCalibrationOwner](../../scripts/playtest/calibrate.mjs), [readCalibrationEvidence](../../scripts/playtest/calibration-evidence.mjs), [readCorpus](../../scripts/playtest/corpus.mjs), [assertCalibrationObservations](../../scripts/playtest/calibration-evidence.mjs), [retrieveCalibrationBundle](../../scripts/playtest/calibration-bundle.mjs), [admitGitHubCalibration](../../scripts/playtest/ci-release.mjs), [writeCorpus](../../scripts/playtest/corpus.mjs) | invariant-controls |
| guided-spring-passivity | [createPhysicsWorld](../../src/simulation/physics/world.mjs), [springImpulse](../../src/simulation/physics/law/spring.mjs), [coupledSpringImpulses](../../src/simulation/physics/law/spring.mjs), [createSession](../../src/simulation/session.mjs) | invariant-controls, verify-spring-browser, verify-spring-performance |
| workbench-content-lifecycle | [createWorkshopView](../../src/presentation/workshop-view.mjs), [movementScope](../../src/presentation/workbench-content.mjs), [.edit-toolbar](../../src/presentation/workshop.css), [createMotionReadout](../../src/presentation/motion-readout.mjs) | verify-workbench-content |
