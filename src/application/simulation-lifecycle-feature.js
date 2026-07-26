import { startMultibodyRuntime } from "../simulation/multibody-runtime.js";
import { FlexibleLineRuntime } from "../simulation/flexible-line-runtime.js";
import { fingerprintAsset } from "../model/portable-asset-identity.js";
import { createPhysicalFlightServices } from "../simulation/physical-flight-services.js";
import { PhysicalAssemblyIndex } from "../simulation/physical-assembly-index.js";
import { TerrainCollisionStream } from "../simulation/environment/terrain-collision-stream.js";
import { WATER_DENSITY } from "../simulation/environment/earth.js";
import { createRunEvidenceLifecycle } from "./run-evidence-lifecycle.js";
import { startProductionSimulationSession } from "./production-simulation-session.js";

export { installWorkshopRuntimeLoop } from "./workshop-runtime-loop.js";

/**
 * @typedef {[number,number,number]} Vector3Tuple
 * @typedef {{ x:number,y:number,z:number }} VectorReading
 * @typedef {{
 *   id:number, type:string, pos:Vector3Tuple, rot:number,
 *   mesh:import("three").Object3D, config:Record<string,unknown>,
 *   rigRole?:string|null, programTrust?:{digest?:string}|null,
 *   startPos?:Vector3Tuple, phase?:number, lastMeasuredPhase?:number,
 *   measuredRpm?:number, sensorValueRpm?:number,
 *   runStartOrientation?:[number,number,number,number],
 *   flightInitialScale?:import("three").Vector3, flightDetached?:unknown,
 *   flightThermal?:unknown,
 * }} SimulationPart
 * @typedef {{
 *   parts:SimulationPart[], activeChallenge:string|null,
 *   challengeStatus:string, challengeProgress:number, challengeHold:number,
 *   challengeScore:number, exploded:boolean, explodeAmount:number,
 *   running:boolean, simulationPaused:boolean, timeScale:number,
 *   elapsed:number,
 *   timeOfDay:number, windEnabled:boolean,
 * }} SimulationRunPort
 * @typedef {{
 *   baseline:unknown, session:import("../simulation/simulation-session.js").SimulationSession|null,
 *   telemetry:ReturnType<typeof import("../simulation/telemetry.js").createTelemetrySnapshot>,
 *   physicalFlightModel:object|null,
 *   aerodynamicForceOwner:object|null,
 *   aerothermalAblationOwner:object|null,
 *   physicalFlightTelemetry:object|null,
 *   physicalAssemblyIndex:PhysicalAssemblyIndex|null,
 *   multibodyRuntime:ReturnType<typeof startMultibodyRuntime>|null,
 *   flexibleLineRuntime:FlexibleLineRuntime|null,
 *   terrainCollisionStream:TerrainCollisionStream|null, workspaceFocusBefore:boolean, checkpointCoordinator:object|null,
 *   prepareCheckpointCoordinator:(()=>Promise<object>)|null, inputTraceRecorder:object|null, runIdentity:object|null, runBlueprint:object|null,
 * }} SimulationRuntimePort
 * @typedef {{
 *   captureBuild:()=>unknown, restoreBuild:(snapshot:unknown)=>void,
 *   sync:()=>unknown,
 *   snapshot:()=>ReturnType<import("../model/assembly-model.js").AssemblyModel["snapshot"]>,
 *   serialize:(name:string)=>object,
 *   missionDesign:()=>{noseAligned:boolean,alignedFins:number,centerlineError:number,stability:number},
 *   connectionValid:(connection:object)=>boolean,
 * }} SimulationAssemblyPort
 * @typedef {{
 *   world:import("cannon-es").World,
 *   worldAdapter:import("../simulation/cannon-world-adapter.js").CannonWorldAdapter,
 *   catalog:typeof import("../model/component-catalog.js").TYPES,
 *   debrisMaterial:import("cannon-es").Material,
 *   groundMaterial:import("cannon-es").Material,
 *   groundBody:import("cannon-es").Body, fieldBody:import("cannon-es").Body,
 *   surfaceHeightAt:(x:number,z:number)=>number,
 *   surfaceSampleAt:(x:number,z:number)=>object,
 *   terrainHeightAt:(x:number,z:number)=>number,
 *   pondAt:(x:number,z:number,margin?:number)=>object|null,
 *   testSite:object, testingPlaygroundDeployment:()=>object|null,
 *   testCourseSelection:()=>{routeId:string,targetPartId?:number}|null,
 *   terrainSize:number, environmentBodyRegistry:object,
 *   environmentOrigin:()=>VectorReading, karmanLineM:number,
 *   latitude:number, longitude:number,
 *   windAt:(position:VectorReading,time:number)=>VectorReading,
 *   materialForPart:(part:SimulationPart)=>import("cannon-es").Material,
 *   materialForKey:(materialKey:string)=>import("cannon-es").Material,
 * }} SimulationPhysicsPort
 * @typedef {{
 *   isPowered:(part:SimulationPart)=>boolean, resetSensors:()=>void,
 *   captureSensors:(context:object)=>object, tick:(dt:number,sensors:object)=>void,
 *   readCommandCandidates:(context:object)=>object[], telemetry:()=>object,
 *   compile:(part:SimulationPart)=>Promise<void>, stopAll:(message?:string)=>void,
 *   sensorBank:{exportState:()=>object,importState:(state:object)=>void},
 *   runtimeManager:{exportState:()=>object,importState:(state:object)=>void},
 * }} SimulationControllerPort
 * @typedef {{
 *   buildBaseline:unknown,
 *   proofContext:{assetFingerprint?:string,challengeVersion?:number,partIds?:number[],environment?:object,controllerPrograms?:object[],complete?:boolean}|null,
 *   begin:()=>unknown, abort:()=>void, resolveBinding:(telemetry:unknown)=>object|null,
 * }} SimulationChallengePort
 * @typedef {{
 *   aerothermal:{dispose:()=>void,prepare:()=>void},
 *   failure:{beginRun:()=>void,endRun:()=>void}, notify:(message:string)=>void,
 *   render:()=>void, tutorialEvent:(event:string)=>unknown,
 *   setExploded:(enabled:boolean,immediate?:boolean)=>void,
 *   setEditorTestMode:()=>void, workspaceFocused:()=>boolean,
 *   focusWorkspace:(focused:boolean)=>void, hasWheels:()=>boolean,
 *   hasArticulation:()=>boolean, hasPoweredFlight:()=>boolean,
 *   setWiresVisible:(visible:boolean)=>void,
 *   setMission:(name:string,description:string)=>void, clearSelection:()=>void,
 *   resetDriveInput:()=>void, resetMachineFrame:()=>void,
 *   attachPartToMachine:(part:SimulationPart)=>void,
 *   syncLargeAssembly:(parts:SimulationPart[])=>void, drawWires:()=>void,
 *   resetCameraTarget:()=>void,
 *   clearTestSiteEffects:()=>void,
 *   beginTestCourseAttempt:()=>void, finishTestCourseAttempt:()=>void,
 * }} SimulationPresentationPort
 */

/**
 * Owns the complete start/stop/reset transaction for one simulation run.
 * Runtime references are kept in one explicit mutable port because playback,
 * presentation, and text telemetry read the same completed session.
 *
 * @param {{
 *   run:SimulationRunPort, runtime:SimulationRuntimePort,
 *   assembly:SimulationAssemblyPort, physics:SimulationPhysicsPort,
 *   controllers:SimulationControllerPort, challenges:SimulationChallengePort,
 *   presentation:SimulationPresentationPort,
 * }} options
 */
export function createSimulationLifecycleFeature({
  run,
  runtime,
  assembly,
  physics,
  controllers,
  challenges,
  presentation,
}) {
  let runEvidence = null;

  function destroyFlightPhysics() {
    runtime.physicalFlightModel?.dispose();
    runtime.physicalFlightModel = null;
    runtime.aerodynamicForceOwner = null;
    runtime.aerothermalAblationOwner = null;
    runtime.physicalFlightTelemetry = null;
    runtime.physicalAssemblyIndex = null;
    presentation.aerothermal.dispose();
  }

  function createFlightPhysics() {
    destroyFlightPhysics();
    for (const part of run.parts) {
      part.flightInitialScale = part.mesh.scale.clone();
      part.flightDetached = null;
      part.flightThermal = null;
    }
    runtime.physicalAssemblyIndex = new PhysicalAssemblyIndex(
      runtime.multibodyRuntime.compiled,
    );
    Object.assign(
      runtime,
      createPhysicalFlightServices({
        multibodyRuntime: runtime.multibodyRuntime,
        physicalAssemblyIndex: runtime.physicalAssemblyIndex,
        terrainCollisionStream: runtime.terrainCollisionStream,
        windAt: physics.windAt,
      }),
    );
    presentation.aerothermal.prepare();
  }

  async function start(preserveBaseline = false) {
    if (!preserveBaseline) runtime.baseline = assembly.captureBuild();
    if (!run.parts.length) return presentation.notify("Add a component first");
    if (run.activeChallenge) {
      if (!preserveBaseline) {
        challenges.buildBaseline = structuredClone(runtime.baseline);
        const startingBlueprint = assembly.serialize("Challenge proof"),
          controllerPrograms = run.parts
            .filter(
              (part) => part.type === "computer" && controllers.isPowered(part),
            )
            .map((part) => ({
              partId: part.id,
              digest: part.programTrust?.digest || "",
            }))
            .sort((left, right) => left.partId - right.partId);
        challenges.proofContext = {
          assetFingerprint: await fingerprintAsset(
            "blueprint",
            startingBlueprint,
          ),
          challengeVersion: 1,
          partIds: startingBlueprint.parts.map((part) => part.id),
          environment: {
            seed: "earth-coordinate-terrain-v1",
            latitude: physics.latitude,
            longitude: physics.longitude,
            timeOfDay: run.timeOfDay,
            windEnabled: run.windEnabled,
          },
          controllerPrograms,
          complete: controllerPrograms.every((program) =>
            /^[0-9a-f]{64}$/.test(program.digest),
          ),
        };
      }
      challenges.begin();
    }
    for (const controller of run.parts.filter(
      (part) => part.type === "computer" && controllers.isPowered(part),
    ))
      await controllers.compile(controller);
    if (run.exploded || run.explodeAmount > 0.001)
      presentation.setExploded(false, true);
    presentation.beginTestCourseAttempt();
    run.running = true;
    run.simulationPaused = false;
    run.timeScale = 1;
    presentation.setEditorTestMode();
    runtime.workspaceFocusBefore = presentation.workspaceFocused();
    if (!runtime.workspaceFocusBefore) presentation.focusWorkspace(true);
    run.elapsed = 0;
    presentation.clearTestSiteEffects();
    presentation.failure.beginRun();
    for (const part of run.parts) {
      part.startPos = [...part.pos];
      part.runStartOrientation = [
        part.mesh.quaternion.x,
        part.mesh.quaternion.y,
        part.mesh.quaternion.z,
        part.mesh.quaternion.w,
      ];
      part.phase = 0;
      part.lastMeasuredPhase = 0;
      part.measuredRpm = 0;
      if (part.type === "sensor") part.sensorValueRpm = 0;
    }
    const wheelCapability = presentation.hasWheels(),
      articulationCapability = presentation.hasArticulation();
    if (articulationCapability) presentation.setWiresVisible(false);
    if (wheelCapability) {
      presentation.setWiresVisible(false);
      presentation.setMission(
        "DRIVER READY",
        "Dynamic chassis active · drive carefully near the platform edge",
      );
    }
    if (presentation.hasPoweredFlight()) {
      presentation.setWiresVisible(false);
      const design = assembly.missionDesign();
      presentation.setMission(
        "FLIGHT COMPUTER READY",
        `${design.noseAligned ? "Aerodynamic nose aligned" : "Blunt / misaligned nose"} · ${design.alignedFins}/4 stabilizing fins · arm and launch`,
      );
    }
    assembly.sync();
    runtime.flexibleLineRuntime?.dispose();
    runtime.flexibleLineRuntime = null;
    runtime.multibodyRuntime?.dispose();
    runtime.multibodyRuntime = startMultibodyRuntime(assembly.snapshot(), {
      world: physics.world,
      worldAdapter: physics.worldAdapter,
      material: physics.debrisMaterial,
      catalog: physics.catalog,
      surfaceHeightAt: physics.surfaceHeightAt,
      terrainHeightAt: physics.terrainHeightAt,
      pondAt: physics.pondAt,
      waterDensity: WATER_DENSITY,
      groundBody: physics.groundBody,
      fieldBody: physics.fieldBody,
      materialForPart: physics.materialForPart,
    });
    runtime.flexibleLineRuntime = new FlexibleLineRuntime({
      world: physics.world,
      materialForKey: physics.materialForKey,
      multibodyRuntime: runtime.multibodyRuntime,
    }).start(runtime.multibodyRuntime.compiled);
    if (runtime.multibodyRuntime) {
      presentation.setWiresVisible(false);
      runtime.terrainCollisionStream?.dispose();
      runtime.terrainCollisionStream = new TerrainCollisionStream({
        world: physics.world,
        heightAt: physics.terrainHeightAt,
        material: physics.groundMaterial,
        tileSize: physics.terrainSize,
        segments: 32,
        centralTile: { x: 0, z: 0 },
        neighborhood: 1,
      });
      createFlightPhysics();
    }
    controllers.resetSensors();
    runEvidence = createRunEvidenceLifecycle({
      runtime,
      assembly,
      physics,
      controllers,
      run,
    });
    runEvidence.prepare(runtime.multibodyRuntime.compiled);
    try {
      runtime.session = startProductionSimulationSession({
        compiled: runtime.multibodyRuntime.compiled,
        snapshot: assembly.snapshot(),
        runtime,
        physics,
        controllers,
        challenges,
        assembly,
        run,
        runEvidence,
      });
      runtime.telemetry = runtime.session.telemetry();
    } catch (error) {
      runtime.session = null;
      runEvidence = null;
      throw error;
    }
    presentation.clearSelection();
    presentation.render();
    presentation.notify(
      runtime.multibodyRuntime?.hasArticulation?.()
        ? "Component-resolved articulated physics active"
        : runtime.multibodyRuntime?.hasWheels?.()
          ? "Rolling-contact rigid-body physics active — the edge is real"
          : "Simulation running — mechanisms and command channels are live",
    );
    presentation.tutorialEvent("simulate");
  }

  function stop() {
    if (run.challengeStatus === "running") challenges.abort();
    if (run.exploded || run.explodeAmount > 0.001)
      presentation.setExploded(false, true);
    if (runtime.telemetry.systems?.mobility) presentation.resetDriveInput();
    run.running = false;
    presentation.focusWorkspace(runtime.workspaceFocusBefore);
    run.simulationPaused = false;
    presentation.failure.endRun();
    presentation.clearTestSiteEffects();
    presentation.finishTestCourseAttempt();
    controllers.stopAll("SIMULATION STOPPED");
    runtime.session?.dispose();
    runtime.session = null;
    runEvidence?.dispose();
    runEvidence = null;
    destroyFlightPhysics();
    runtime.terrainCollisionStream?.dispose();
    runtime.terrainCollisionStream = null;
    runtime.flexibleLineRuntime?.dispose();
    runtime.flexibleLineRuntime = null;
    runtime.multibodyRuntime?.dispose();
    runtime.multibodyRuntime = null;
    presentation.setWiresVisible(true);
    presentation.resetMachineFrame();
    for (const part of run.parts) {
      presentation.attachPartToMachine(part);
      part.mesh.visible = true;
      if (part.flightInitialScale)
        part.mesh.scale.copy(part.flightInitialScale);
      part.flightDetached = null;
      part.flightThermal = null;
      part.mesh.position.set(...part.pos);
      if (part.runStartOrientation)
        part.mesh.quaternion.set(...part.runStartOrientation);
      part.runStartOrientation = undefined;
    }
    presentation.syncLargeAssembly(run.parts);
    presentation.drawWires();
    presentation.resetCameraTarget();
    presentation.render();
  }

  function reset() {
    if (!run.running || !runtime.baseline) return;
    const baseline = structuredClone(runtime.baseline);
    stop();
    assembly.restoreBuild(baseline);
    runtime.baseline = baseline;
    run.challengeStatus = run.activeChallenge ? "ready" : "idle";
    run.challengeProgress = 0;
    run.challengeHold = 0;
    run.challengeScore = 0;
    challenges.begin();
    start(true);
    presentation.notify("Test reset to its exact starting state");
  }

  return { createFlightPhysics, destroyFlightPhysics, reset, start, stop };
}
