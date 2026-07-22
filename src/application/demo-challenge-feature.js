import { BlueprintAcquisition } from "../model/blueprint-acquisition.js";
import { ChallengeRun } from "../model/challenge-lab.js";
import { builtInDemo } from "../model/demo-blueprints.js";
import { resolveReferenceInitialControls } from "../model/challenge-reference-controls.js";
import { recordChallengeResult } from "./challenge-state-adapter.js";
import {
  componentDefinition,
  componentHasControlContract,
  componentIsPayload,
} from "../model/component-contracts.js";
/**
 * @typedef {{
 *   id:string, name:string, demo:string, startModes:string[],
 *   payload?:{massKg?:number}, objective?:Record<string,unknown>,
 * }} ChallengeDefinition
 * @typedef {{id:number,type:string,config:Record<string,unknown>}} ChallengePart
 * @typedef {{id:string,label:string,channel:string,type:string,value:number,active?:boolean}} ChallengeControl
 * @typedef {{
 *   activeChallenge:string|null, challengeStartMode:string|null,
 *   challengeStatus:string, challengeProgress:number, challengeHold:number,
 *   challengeScore:number, simulationPaused:boolean, running:boolean,
 *   demo:string|null, remoteProfile:string,
 *   remoteProfiles:Record<string,{controls:ChallengeControl[]}>,
 *   remoteControls:Record<string,ChallengeControl[]>,
 *   directSurfaces:Record<string,boolean>,
 *   controllerLayouts:Record<string,unknown>, parts:ChallengePart[],
 *   challengeRecords:object[], challengeBest:Record<string,number>,
 * }} ChallengeStorePort
 * @typedef {{ parts:object[], connections:object[] }} ChallengeMachine
 * @typedef {{
 *   challenges:ChallengeDefinition[],
 *   demoSources:Parameters<typeof builtInDemo>[1],
 *   controlTemplates:Record<string,unknown>, beginRun:()=>ChallengeRun,
 *   machineView:()=>ChallengeMachine,
 * }} ChallengeDefinitionPort
 * @typedef {{
 *   suspended:boolean, record:(label:string)=>void, refresh:()=>void,
 *   capture:()=>unknown, restore:(snapshot:unknown)=>void,
 * }} ChallengeHistoryPort
 * @typedef {{
 *   loadBlueprint:(blueprint:object,options:{acquisition:string})=>void,
 *   selectPart:(id:number)=>void, clearMachine:()=>void,
 *   enterBuildMode:()=>void,
 *   addPart:(type:string,pos:[number,number,number],config?:Record<string,unknown>)=>ChallengePart,
 *   syncAssembly:()=>void,
 * }} ChallengeBuilderPort
 * @typedef {{ stop:(message:string)=>void, ensureControls:(kind:string)=>void,
 *   resetDriveInput:()=>void, bind:(part:ChallengePart,open:boolean)=>void,
 *   compile:()=>void,
 * }} ChallengeControllerPort
 * @typedef {{ stop:()=>void }} ChallengeSimulationPort
 * @typedef {{
 *   setMission:(title:string,description:string)=>void, render:()=>void,
 *   renderRemote:()=>void, updateDriveHud:()=>void, notify:(message:string)=>void,
 *   renderChallengeHud:()=>void, closeRemote:()=>void,
 *   closeChallengeBrowser:()=>void, openRemote:()=>void, dismissNotice:()=>void,
 * }} ChallengeViewPort
 * @typedef {{
 *   storage:import("./browser-storage.js").BrowserStorage,
 *   keys:{challengeRecords:string,challengeBest:string},
 * }} ChallengePersistencePort
 * @typedef {{
 *   assetFingerprint?:string|null, complete?:boolean, challengeVersion?:number,
 *   environment?:object|null, controllerPrograms?:object[],
 * }} ChallengeProofContext
 */

/**
 * Owns built-in blueprint selection and open-ended challenge run state. Demos
 * load through the same blueprint port as user designs and this module never
 * chooses a physics implementation.
 *
 * @param {{
 *   store:ChallengeStorePort, definitions:ChallengeDefinitionPort,
 *   history:ChallengeHistoryPort, builder:ChallengeBuilderPort,
 *   controllers:ChallengeControllerPort, simulation:ChallengeSimulationPort,
 *   view:ChallengeViewPort, persistence:ChallengePersistencePort,
 * }} options
 */
export function createDemoChallengeFeature({
  store,
  definitions,
  history,
  builder,
  controllers,
  simulation,
  view,
  persistence,
}) {
  /** @type {ChallengeRun|null} */
  let run = null;
  /** @type {unknown} */
  let buildBaseline = null;
  /** @type {ChallengeProofContext|null} */
  let proofContext = null;

  function resetRunState() {
    run = null;
    buildBaseline = null;
    proofContext = null;
  }

  function begin() {
    run = definitions.beginRun();
    return run;
  }

  function abort() {
    if (run) finish(run.abort());
  }

  function loadDemo(kind) {
    const wasSuspended = history.suspended;
    if (!wasSuspended) history.record(`load ${kind} demo`);
    history.suspended = true;
    controllers.stop("IDLE");
    simulation.stop();
    try {
      const { blueprint, meta } = builtInDemo(kind, definitions.demoSources);
      builder.loadBlueprint(blueprint, {
        acquisition: BlueprintAcquisition.BUILT_IN,
      });
      store.demo = kind;
      store.remoteProfile = definitions.controlTemplates[kind] ? kind : "cart";
      if (definitions.controlTemplates[kind]) controllers.ensureControls(kind);
      const selectedDefinition = componentDefinition({
          type: meta.selectedType,
        }),
        selected = store.parts.find(
          (part) => componentDefinition(part) === selectedDefinition,
        ),
        autorunController = store.parts.find((part) =>
          componentHasControlContract(part, "controller-target-v1"),
        );
      if (selected) builder.selectPart(selected.id);
      view.setMission(meta.title, meta.description);
      if (kind === "cart") controllers.resetDriveInput();
      if (meta.autorunScript && autorunController) {
        controllers.bind(autorunController, false);
        controllers.compile();
      }
      view.render();
      view.renderRemote();
      view.updateDriveHud();
      view.notify(
        kind === "cart"
          ? "ROVER loaded — use W/S/A/D, Space and L"
          : `${kind.toUpperCase()} demo loaded — open Remote to command it`,
      );
    } finally {
      history.suspended = wasSuspended;
      history.refresh();
    }
  }

  function activate(challenge, startMode) {
    store.activeChallenge = challenge.id;
    store.challengeStartMode = startMode;
    store.challengeStatus = "ready";
    store.challengeProgress = 0;
    store.challengeHold = 0;
    store.challengeScore = 0;
    run = new ChallengeRun(challenge, definitions.machineView());
    view.setMission(
      challenge.name.toUpperCase(),
      startMode === "reference"
        ? "Calibration machine loaded. Tune it or rebuild it before testing."
        : "Open contract active. Build any physically valid solution around the payload.",
    );
    view.renderChallengeHud();
  }

  function prepareOpen(challenge, startMode) {
    if (store.running) simulation.stop();
    const wasSuspended = history.suspended;
    if (startMode === "empty") {
      history.record(`start ${challenge.name} from empty`);
      history.suspended = true;
      builder.clearMachine();
    } else if (!store.parts.length) history.suspended = true;
    try {
      store.demo = null;
      builder.enterBuildMode();
      if (
        challenge.payload &&
        !store.parts.some((part) => componentIsPayload(part))
      ) {
        builder.addPart(
          "cargo",
          startMode === "empty" ? [0, 1.1, 0] : [0, 3.2, 0],
          {
            mass: challenge.payload.massKg || 80,
            payload: true,
          },
        );
        builder.syncAssembly();
      }
    } finally {
      history.suspended = wasSuspended;
    }
    activate(challenge, startMode);
    view.closeRemote();
    buildBaseline = history.capture();
    history.refresh();
  }

  function startChallenge(id, startMode = null) {
    const challenge = definitions.challenges.find((entry) => entry.id === id);
    if (!challenge) return;
    store.activeChallenge = null;
    const mode = startMode || challenge.startModes[0];
    if (mode === "reference") {
      loadDemo(challenge.demo);
      activate(challenge, mode);
      buildBaseline = history.capture();
    } else prepareOpen(challenge, mode);
    const referenceControls = resolveReferenceInitialControls(
      challenge,
      store.remoteProfiles,
    );
    for (const controls of Object.values(store.remoteControls))
      for (const control of controls) control.active = false;
    for (const initial of referenceControls) {
      const control = store.remoteControls[initial.profileId].find(
        (candidate) => candidate.id === initial.controlId,
      );
      control.value = initial.value;
      control.active = initial.active;
    }
    view.closeChallengeBrowser();
    if (mode === "reference") view.openRemote();
    view.renderRemote();
    view.renderChallengeHud();
    view.notify(
      mode === "empty"
        ? `${challenge.name} opened on a clean plate · secure the payload, then invent a solution`
        : mode === "current"
          ? `${challenge.name} applied to your build · secure the payload before testing`
          : `${challenge.name} calibration loaded · tune, rebuild, or test`,
    );
  }

  function retry() {
    const challenge = definitions.challenges.find(
      (entry) => entry.id === store.activeChallenge,
    );
    if (!challenge || !buildBaseline) return;
    if (store.running) simulation.stop();
    history.restore(structuredClone(buildBaseline));
    activate(challenge, store.challengeStartMode);
    view.notify(`${challenge.name} restored to the exact pre-test build`);
  }

  function finish(result) {
    if (!["running", "ready"].includes(store.challengeStatus)) return;
    const success = recordChallengeResult({
      state: store,
      result,
      storage: persistence.storage,
      keys: persistence.keys,
      assetFingerprint: proofContext?.assetFingerprint || null,
      proofContext,
    });
    store.simulationPaused = true;
    view.renderChallengeHud();
    view.render();
    if (success) view.dismissNotice();
    else
      view.notify("Challenge failed · inspect the physical criteria and retry");
  }

  function update(dt, telemetry) {
    const challenge = definitions.challenges.find(
      (entry) => entry.id === store.activeChallenge,
    );
    if (
      !challenge ||
      !store.running ||
      ["complete", "failed"].includes(store.challengeStatus)
    )
      return;
    run ||= new ChallengeRun(challenge, definitions.machineView());
    const result = run.step(telemetry, dt);
    store.challengeStatus = result.status;
    store.challengeProgress = result.progress;
    store.challengeHold = result.holdS;
    store.challengeScore = result.status === "failed" ? 0 : result.score;
    if (["complete", "failed"].includes(result.status)) {
      store.challengeStatus = "running";
      finish(result);
    }
    view.renderChallengeHud();
  }

  return {
    abort,
    begin,
    finish,
    loadDemo,
    resetRunState,
    retry,
    resolveBinding: (telemetry) => run?.resolveBinding(telemetry) || null,
    snapshot: () => run?.snapshot() || null,
    startChallenge,
    update,
    get buildBaseline() {
      return buildBaseline;
    },
    set buildBaseline(value) {
      buildBaseline = value;
    },
    get proofContext() {
      return proofContext;
    },
    set proofContext(value) {
      proofContext = value;
    },
  };
}
