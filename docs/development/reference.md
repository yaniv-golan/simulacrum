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
| npm run bar:O1 | node scripts/bars.mjs O1 |
| npm run bar:O2 | node scripts/bars.mjs O2 |
| npm run bar:P1 | node scripts/bars.mjs P1 |
| npm run bar:S1 | node scripts/bars.mjs S1 |
| npm run bar:V1 | node scripts/bars.mjs V1 |
| npm run bar:V2 | node scripts/bars.mjs V2 |
| npm run bars | node scripts/bars.mjs |
| npm run browser:scopes | node scripts/browser-scopes.mjs |
| npm run build | node scripts/verification-window.mjs scripts/build-app.mjs |
| npm run build-fingerprint | node scripts/build-fingerprint.mjs |
| npm run ci | node scripts/verification-window.mjs scripts/ci.mjs |
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
| npm run land | node scripts/land.mjs |
| npm run native:qualify | node scripts/verification-window.mjs scripts/native-qualification.mjs |
| npm run playtest:download | node scripts/playtest/download.mjs |
| npm run playtest:local | wrangler dev --port 8787 |
| npm run preview | vite preview --host 127.0.0.1 |
| npm run release:deploy | node scripts/playtest/release.mjs deploy |
| npm run release:prepare | node scripts/playtest/release.mjs prepare |
| npm run replay | node scripts/replay.mjs |
| npm run rules | node scripts/rules.mjs |
| npm run rules:explain | node scripts/explain-invariant.mjs |
| npm run test:all | node scripts/verification-window.mjs scripts/test-affected.mjs --all |
| npm run test:browser | node scripts/verification-window.mjs scripts/verify-browser-suite.mjs |
| npm run test:browser:affected | node scripts/verification-window.mjs scripts/verify-browser-suite.mjs |
| npm run test:browser:serial | node scripts/verification-window.mjs scripts/verify-browser-suite.mjs all --workers 1 |
| npm run test:browser:smoke | node scripts/verification-window.mjs scripts/verify-browser-suite.mjs smoke |
| npm run test:determinism | node scripts/verification-window.mjs scripts/verify-m1.mjs |
| npm run test:performance | node scripts/verification-window.mjs scripts/verify-browser-suite.mjs performance |
| npm run test:unit | node scripts/verification-window.mjs scripts/test-affected.mjs |
| npm run typecheck | node scripts/check-boundary-types.mjs |
| npm run verify:candidate | node scripts/verify-candidate.mjs |
| npm run verify:final | node scripts/verification-window.mjs scripts/verify-final.mjs |
| npm run verify:host | node scripts/verify-host.mjs |
| npm run verify:local | node scripts/verification-window.mjs scripts/verify-local.mjs |
| npm run verify:merge | node scripts/verify-merge.mjs |
| npm run verify:merge:shadow | node scripts/verify-merge-shadow.mjs |
| npm run verify:prepare | node scripts/verify-prepare.mjs |

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
| format | gate-integrity | M0 | [scripts/check-format.mjs](../../scripts/check-format.mjs) |
| verification-workflow | gate-integrity | M3b | [scripts/verification-tiers.mjs](../../scripts/verification-tiers.mjs) |
| release-notes | gate-integrity | M3b | [scripts/check-release-notes.mjs](../../scripts/check-release-notes.mjs) |
| verification-scope-configuration | gate-integrity | M3b | [scripts/verification-window.mjs](../../scripts/verification-window.mjs) |

## Invariant owners

| Invariant | Production owners | Registered checks |
| --- | --- | --- |
| rejected-edit-atomicity | [createWorkshop](../../src/core/workshop.mjs) | invariant-controls, verify-authorable-scenes |
| preview-isolation | [proposeMirroredAssembly](../../src/model/mirror-assembly.mjs), [createAssemblyMirror](../../src/presentation/assembly-mirror.mjs), [createPlacementLifecycle](../../src/presentation/placement-lifecycle.mjs), [createDocumentProposal](../../src/presentation/document-proposal.mjs) | invariant-controls, verify-mirror-browser, verify-authorable-scenes |
| input-cancellation | [createVehicleControls](../../src/presentation/vehicle-controls.mjs), [createPlacementLifecycle](../../src/presentation/placement-lifecycle.mjs), [createReceiverArbiter](../../src/simulation/receiver-arbiter.mjs), [createPowerNetwork](../../src/simulation/power.mjs), [createSession](../../src/simulation/session.mjs) | invariant-controls, verify-ui-lifecycle-browser, verify-part-help-browser, verify-part-help-inspectors, verify-part-help-window, verify-spring-browser |
| geometry-agreement | [partPrimitives](../../src/model/geometry.mjs), [compileAssembly](../../src/model/assembly.mjs), [environmentObstacles](../../src/model/environment.mjs), [createPrimitiveGeometry](../../src/presentation/primitive-geometry.mjs) | invariant-controls, verify-property-focus, verify-surface-browser, verify-ball-browser, verify-authorable-scenes, verify-beam-length-browser |
| passive-pin-linkage | [compileAssembly](../../src/model/assembly.mjs), [surfaceMountCandidate](../../src/model/assembly.mjs), [resolveSurfaceEndpoint](../../src/model/surfaces.mjs), [validateBlueprint](../../src/model/blueprint.mjs) | invariant-controls, verify-pivot-pin-browser |
| identity-material-admission | [compileAssembly](../../src/model/assembly.mjs), [MATERIALS](../../src/model/catalog.mjs) | identity |
| checkpoint-next-step | [createSession](../../src/simulation/session.mjs) | invariant-controls, verify-authorable-scenes |
| copied-graph-integrity | [proposeMirroredAssembly](../../src/model/mirror-assembly.mjs), [insertAssembly](../../src/model/reusable-assemblies.mjs), [createAssemblyPlacement](../../src/presentation/assembly-placement.mjs), [duplicatePart](../../src/model/duplication.mjs) | invariant-controls, verify-assemblies-browser, verify-assembly-ux-browser |
| connection-display-isolation | [connectionRenderSpecs](../../src/presentation/connection-render.mjs), [pickableObjects](../../src/presentation/connection-view.mjs), [createPortHardware](../../src/presentation/part-finish.mjs), [createPartMesh](../../src/presentation/part-mesh.mjs), [createSensorDetails](../../src/presentation/part-visuals/sensors.mjs), [createElectronicsDetails](../../src/presentation/part-visuals/electronics.mjs), [createMechanicalDetails](../../src/presentation/part-visuals/mechanical.mjs), [createThumbnailQueue](../../src/presentation/thumbnail-queue.mjs) | invariant-controls, verify-connection-test-browser, verify-exploded-browser |
| capture-write-admission | [createPlaytestServer](../../scripts/playtest-server.mjs), [CaptureStore](../../scripts/playtest/cloud-store.mjs), [bodyReservation](../../scripts/playtest/protocol.mjs) | invariant-controls, verify-authorable-scenes |
| capture-cloud-integrity | [CaptureStore](../../scripts/playtest/cloud-store.mjs) | invariant-controls |
| capture-receipt-ownership | [openCaptureOutbox](../../src/application/capture-outbox.mjs), [mountRemotePlaytest](../../src/application/remote-playtest.mjs) | invariant-controls, verify-feedback-receipts |
| release-publisher-ownership | [ReleaseCoordinator](../../scripts/playtest/release-control.mjs) | invariant-controls |
| capture-synthetic-cleanup | [CaptureStore](../../scripts/playtest/cloud-store.mjs), [CloudFeedbackStore](../../scripts/playtest/feedback-cloud.mjs) | invariant-controls |
| release-effective-isolation | [verifyCredentialIsolation](../../scripts/playtest/credential-isolation.mjs) | invariant-controls |
| release-load-delivery | [retryUpload](../../scripts/playtest/load.mjs) | invariant-controls |
| release-verification-single-pass | [prepareRelease](../../scripts/playtest/prepare-release.mjs), [assertPackageVerification](../../scripts/playtest/package-verification.mjs) | invariant-controls |
| release-experiment-exceptions | [selectExperiments](../../scripts/playtest/experiments.mjs), [recordExperimentPasses](../../scripts/playtest/release.mjs), [retrieveEvidence](../../scripts/playtest/experiment-transport.mjs), [assertFeedbackQualification](../../scripts/playtest/release-policy.mjs) | invariant-controls |
| release-experiment-inputs | [deriveExperimentInputs](../../scripts/playtest/experiment-inputs.mjs) | invariant-controls |
| release-characterization-ownership | [withCalibrationOwner](../../scripts/playtest/calibrate.mjs), [readCalibrationEvidence](../../scripts/playtest/calibration-evidence.mjs), [readCorpus](../../scripts/playtest/corpus.mjs), [assertCalibrationObservations](../../scripts/playtest/calibration-evidence.mjs), [retrieveCalibrationBundle](../../scripts/playtest/calibration-bundle.mjs), [admitGitHubCalibration](../../scripts/playtest/ci-release.mjs), [writeCorpus](../../scripts/playtest/corpus.mjs) | invariant-controls |
| guided-spring-passivity | [createPhysicsWorld](../../src/simulation/physics/world.mjs), [springImpulse](../../src/simulation/physics/law/spring.mjs), [coupledSpringImpulses](../../src/simulation/physics/law/spring.mjs), [createSession](../../src/simulation/session.mjs), [evaluateSpringSimulation](../../scripts/measure-springs.mjs), [evaluateSpringBrowser](../../scripts/measure-springs.mjs), [springTopologyDomain](../../src/simulation/physics/spring-topology.mjs), [readNativeResponse](../../src/simulation/physics/native-response.mjs), [createSpringLauncher](../../src/model/fixtures/spring-launcher.mjs), [createPoweredSuspensionCart](../../src/model/fixtures/guided-suspension.mjs), [createGuidedSuspensionModule](../../src/model/fixtures/guided-suspension.mjs), [createActiveSuspensionBench](../../src/model/fixtures/articulated-suspension.mjs), [environmentObstacles](../../src/model/environment.mjs), [createPinEndedStrut](../../src/model/fixtures/articulated-suspension.mjs) | invariant-controls, verify-spring-browser, verify-spring-performance, verify-linear-actuator-browser |
| workbench-content-lifecycle | [createWorkshopView](../../src/presentation/workshop-view.mjs), [movementScope](../../src/presentation/workbench-content.mjs), [.edit-toolbar](../../src/presentation/workshop.css), [createMotionReadout](../../src/presentation/motion-readout.mjs), [springInspector](../../src/presentation/spring-controls.mjs), [createBodyMotionAccumulator](../../src/model/motion-readout.mjs), [mountWorkshopApp](../../src/application/workshop-app.mjs), [starterSteps](../../src/application/starter-guide.mjs), [setupClosed](../../src/application/remote-playtest.mjs), [markReturningDevice](../../scripts/browser-session.mjs) | verify-learning-examples, verify-workbench-content |
| adaptive-graphics | [createGraphicsQuality](../../src/presentation/graphics-quality.mjs), [createWorkshopView](../../src/presentation/workshop-view.mjs), [applyGraphicsQuality](../../src/presentation/graphics-quality.mjs), [assertPresentationOnlyOrbit](../../scripts/verify-spring-browser.mjs) | invariant-controls, verify-adaptive-graphics, verify-spring-browser |
| completed-contact-impulses | [createPhysicsWorld](../../src/simulation/physics/world.mjs), [createSession](../../src/simulation/session.mjs), [readContacts](../../src/simulation/physics/read-contacts.mjs) | invariant-controls, verify-spring-performance |
| capture-final-drain | [waitForCaptureDrain](../../scripts/playtest/release-policy.mjs), [captureBrowserTimeoutMs](../../scripts/playtest/release-policy.mjs) | invariant-controls, verify-remote-playtest, verify-cloud-playtest |
| capture-export-read-recovery | [downloadCapture](../../scripts/playtest/download.mjs) | invariant-controls, verify-remote-playtest, verify-cloud-playtest |
| capture-bounded-sampling | [sampleCapture](../../scripts/playtest/capture-samples.mjs), [readCorpus](../../scripts/playtest/corpus.mjs) | invariant-controls, verify-cloud-playtest, verify-remote-playtest |
| capture-observation-stream | [decodeCaptureEvents](../../src/application/capture-stream.mjs) | invariant-controls |
| capture-observation-review | [sceneParts](../../src/presentation/capture-review-model.mjs) | invariant-controls |
| local-browser-scope-safety | [selectAffectedBrowserChecks](../../scripts/browser-selection.mjs), [classifyRead](../../scripts/read-classification.mjs), [deriveScopeProposal](../../scripts/browser-scope-proposal.mjs), [validateManifest](../../scripts/validate-manifest.mjs) | verification-scope-configuration |
| audio-witness-coverage | [createMechanicalAudio](../../src/presentation/mechanical-audio.mjs), [AUDIO_POLICY](../../src/presentation/mechanical-audio-model.mjs), [createSoundControls](../../src/presentation/sound-controls.mjs), [createMechanicalAudioAdapter](../../src/application/mechanical-audio-adapter.mjs) | verification-scope-configuration |
| verification-resource-window | [withVerificationWindow](../../scripts/verification-window.mjs), [validateIntent](../../scripts/verification-window.mjs) | verification-scope-configuration |
| observable-test-completion | [waitUntil](../../scripts/wait-until.mjs) | verification-scope-configuration |
| candidate-source-isolation | [captureCandidate](../../scripts/candidate.mjs), [destinationStillMatches](../../scripts/candidate.mjs) | verification-scope-configuration |
| private-evidence-boundary | [private dependency forbidden](../../scripts/module-graph.mjs) | verification-scope-configuration |
| human-evidence-verdicts | [evaluateBar](../../scripts/bars.mjs), [Records a human assessment](../../scripts/assess.mjs), [formatVerificationOutcome](../../scripts/verification-outcome.mjs) | verification-scope-configuration |
| app-identity-fingerprint | [appFingerprint](../../scripts/app-fingerprint.mjs) | verification-scope-configuration |
| assembly-scenario-partition | [assemblyPartition](../../scripts/assembly-scenarios.mjs) | verification-scope-configuration |
| native-qualification-controls | [qualifyNative](../../scripts/native-qualification.mjs) | verification-scope-configuration |
| build-reset-precision | [command.type === 'build'](../../src/core/workshop.mjs) | verification-scope-configuration |
| ball-workshop-experience | [createRetry](../../src/application/retry.mjs), [contactProperties](../../src/model/contact-properties.mjs), [createImpactEvents](../../src/presentation/impact-sound.mjs) | invariant-controls, verify-ball-browser, verify-remote-playtest |
| verification-live-evidence | [withBrowserReport](../../scripts/verify-browser-suite.mjs), [withCleanup](../../scripts/verification-cleanup.mjs), [createBrowserEvidence](../../scripts/browser-evidence.mjs), [readLiveStatus](../../scripts/browser-session.mjs) | verification-workflow |
| verification-priority-coverage | [prioritizeBrowserChecks](../../scripts/browser-selection.mjs), [runCI](../../scripts/ci.mjs), [returnBrowserHistory](../../scripts/browser-history.mjs) | verification-workflow |
| documentation-batch-review | [reviewSections](../../scripts/documentation.mjs) | developer-documentation |
| browser-scope-reviewed-application | [deriveScopeProposal](../../scripts/browser-scope-proposal.mjs), [applyScopeProposal](../../scripts/browser-scope-apply.mjs), [validateScopeWitnessResult](../../scripts/browser-scope-witness-contract.mjs) | verification-scope-configuration |
| capture-packet-compression | [unpackCapturePacket](../../src/application/capture-packet.mjs) | invariant-controls, verify-remote-playtest, verify-cloud-playtest |
| supported-spur-transmission | [gearFacts](../../src/model/gear-geometry.mjs), [compileGearMeshes](../../src/model/gear-mesh.mjs), [coupledGearImpulses](../../src/simulation/physics/law/gear.mjs), [createPhysicsWorld](../../src/simulation/physics/world.mjs), [createWorkshopView](../../src/presentation/workshop-view.mjs) | invariant-controls, measure-gears |
| powered-shared-sensing | [SENSOR_DEFINITIONS](../../src/model/sensors.mjs), [sampleSensor](../../src/simulation/sensors.mjs), [createPowerNetwork](../../src/simulation/power.mjs) | invariant-controls |
| bounded-controller-programs | [compileController](../../src/scripting/controller-program.mjs), [createWorkshop](../../src/core/workshop.mjs), [createReceiverArbiter](../../src/simulation/receiver-arbiter.mjs), [controllerDecision](../../src/model/controller-decision.mjs), [createControllerHistory](../../src/application/controller-history.mjs) | invariant-controls |
| learning-feature-identity | [admitLearningModel](../../src/model/learning-model.mjs), [admitLearningBindings](../../src/model/learning-bindings.mjs) | invariant-controls |
| candidate-resume-integrity | [createLeafLedger](../../scripts/verification-resume.mjs), [reexecutionSet](../../scripts/candidate-after.mjs), [dependencyDigest](../../scripts/candidate-resume.mjs), [requireAttemptReport](../../scripts/candidate-attempt.mjs), [reusableAcrossCandidates](../../scripts/candidate-after.mjs), [acceptRetainedEvidence](../../scripts/verification-run.mjs) | verification-scope-configuration |
| landing-integrity | [assertLandable](../../scripts/land.mjs), [findLandingReports](../../scripts/land.mjs), [land](../../scripts/land.mjs) | verification-scope-configuration |
| candidate-citation-integrity | [compareIdentity](../../scripts/candidate-cite.mjs), [citeRelease](../../scripts/candidate-cite.mjs), [resolveCitation](../../scripts/candidate-cite.mjs), [packageRefusal](../../scripts/candidate-cite.mjs), [parseCiteArgs](../../scripts/candidate-cite.mjs) | verification-scope-configuration |
| ordered-verification-preparation | [prepareVerification](../../scripts/verification-preparation.mjs) | verification-scope-configuration |
| verification-timing-evidence | [createTiming](../../scripts/verification-timing.mjs) | verification-scope-configuration |
| bounded-process-ownership | [runProcess](../../scripts/run-check.mjs) | verification-scope-configuration |
| merge-shadow-no-qualification | [mergeShadowReport](../../scripts/merge-shadow.mjs) | verification-scope-configuration |
| tick-cost-attribution | [summarizeTickAttribution](../../scripts/tick-attribution.mjs) | verification-scope-configuration |
| merge-tier-coverage | [mergeSelection](../../scripts/merge-selection.mjs), [compareMergeCoverage](../../scripts/merge-comparison.mjs) | verification-scope-configuration |
| powered-release-topology | [compileAssembly](../../src/model/assembly.mjs), [createPowerNetwork](../../src/simulation/power.mjs), [createPhysicsWorld](../../src/simulation/physics/world.mjs), [releasedAttachment](../../src/presentation/release-state.mjs) | invariant-controls, verify-release-coupler |
| parts-catalog-discovery | [placementPresentation](../../src/presentation/placement-lifecycle.mjs), [searchParts](../../src/presentation/part-search.mjs), [createPartsBrowser](../../src/presentation/parts-browser.mjs), [createPartPlacement](../../src/presentation/part-placement.mjs), [paletteKeyOpens](../../src/presentation/workbench-content.mjs) | verify-parts-catalog, verify-part-help-browser |
| distributed-rope | [compileRopes](../../src/model/rope.mjs), [ropeVectorImpulses](../../src/simulation/physics/law/rope.mjs), [createPhysicsWorld](../../src/simulation/physics/world.mjs), [createSession](../../src/simulation/session.mjs), [ropeInspector](../../src/presentation/rope-controls.mjs), [createRopeView](../../src/presentation/rope-view.mjs) | invariant-controls, verify-rope-browser |
| independent-feedback-receipts | [captureFeedbackContext](../../src/application/feedback-context.mjs), [validateFeedbackEnvelope](../../src/application/feedback-protocol.mjs), [openFeedbackStore](../../src/application/feedback-store.mjs), [mountFeedbackClient](../../src/application/feedback-client.mjs) | invariant-controls, verify-feedback-flow, verify-feedback-receipts, verify-feedback-lifecycle, verify-feedback-recovery |
| feedback-sync-read-only | [syncFeedback](../../scripts/playtest/sync-feedback.mjs) | invariant-controls |
| feedback-capture-privacy | [createFeedbackCaptureGate](../../src/application/feedback-capture-gate.mjs), [measureRecordedDuration](../../src/application/capture-media-duration.mjs) | invariant-controls, verify-feedback-receipts, verify-feedback-lifecycle |
| feedback-server-publication | [NodeFeedbackStore](../../scripts/playtest/feedback-node.mjs), [CloudFeedbackStore](../../scripts/playtest/feedback-cloud.mjs) | invariant-controls |
| camera-completed-exposure | [createCameraState](../../src/simulation/camera-state.mjs), [createWorkshop](../../src/core/workshop.mjs) | invariant-controls, verify-camera-browser, measure-cameras |
| camera-photo-ownership | [createCameraGallery](../../src/application/camera-gallery.mjs), [createCameraSession](../../src/application/camera-session.mjs), [createCameraControls](../../src/presentation/camera-controls.mjs), [captureWorkshopScreenshot](../../src/presentation/workshop-screenshot.mjs) | invariant-controls, verify-camera-browser |
| camera-authored-optics | [opticalFrame](../../src/model/camera.mjs), [proposeMirroredAssembly](../../src/model/mirror-assembly.mjs), [createCameraRenderer](../../src/presentation/camera-renderer.mjs), [createCameraFrustum](../../src/presentation/camera-frustum.mjs), [createRopeView](../../src/presentation/rope-view.mjs) | invariant-controls, verify-camera-browser |
| powered-lamp-output | [createPowerNetwork](../../src/simulation/power.mjs), [LAMP_LIMIT](../../src/model/lamps.mjs), [createLampView](../../src/presentation/lamp-view.mjs) | invariant-controls, verify-lamp-browser, verify-lamp-performance |
| completed-state-reuse | [createPhysicsWorld](../../src/simulation/physics/world.mjs), [readNativeResponse](../../src/simulation/physics/native-response.mjs), [createPowerNetwork](../../src/simulation/power.mjs), [immutableCopy](../../src/model/observation.mjs), [immutableBodySample](../../src/model/observation.mjs) | invariant-controls |
| completed-draw-order | [createClock](../../src/application/clock.mjs), [mountWorkshopApp](../../src/application/workshop-app.mjs), [createWorkshopView](../../src/presentation/workshop-view.mjs), [createRenderSubmissionTracker](../../src/application/render-submission.mjs) | verify-attachment-status, verify-spring-performance, verify-render-lifecycle |
| attachment-force-sensing | [createJointReactions](../../src/simulation/physics/joint-reactions.mjs), [readNativeResponse](../../src/simulation/physics/native-response.mjs), [sampleSensor](../../src/simulation/sensors.mjs), [createSession](../../src/simulation/session.mjs) | invariant-controls, verify-load-cell-browser, verify-load-cell-force-browser, verify-load-cell-copy-browser |
| mechanical-audio-truth | [createMechanicalAudioAdapter](../../src/application/mechanical-audio-adapter.mjs), [createMechanicalEvents](../../src/presentation/mechanical-audio-model.mjs), [createMechanicalAudio](../../src/presentation/mechanical-audio.mjs) | invariant-controls, verify-mechanical-audio |
| dialog-close-consistency | [createDialogClose](../../src/presentation/dialog-close.mjs), [.dialog-header](../../src/presentation/workshop.css), [createDialogClose('Close feedback'](../../src/application/feedback-client.mjs), [createDialogClose('Close recording setup'](../../src/application/remote-playtest.mjs), [createDialogClose('Close parts'](../../src/presentation/parts-browser.mjs) | invariant-controls, verify-feedback-flow, verify-motion-diagnostics, verify-assemblies-browser, verify-camera-browser, verify-authorable-scenes, verify-learning-controller |
| build-readiness-honesty | [readinessLine](../../src/model/motion-diagnostics.mjs), [function refreshHealth](../../src/presentation/workshop-view.mjs) | invariant-controls, verify-motion-diagnostics, verify-assembly-ux-browser |
