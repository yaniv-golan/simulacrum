import * as THREE from "three";
import { presentMechanismTelemetry } from "./mechanism-pose-presenter.js";
import { selectMobilityAssembly } from "./machine-telemetry-projection.js";
import { mobilityMissionReadModel } from "./mobility-mission-read-model.js";

export { buildMachineDebugReadModel } from "./machine-debug-read-model.js";

/**
 * @typedef {{ id: number, type: string, pos: number[], mesh: THREE.Object3D, config: Record<string, number>, flightDetached?: boolean, sensorValueRpm?: number, jointAngle?: number, reactionTorque?: number, tireDeflectionM?: number, tireDeflectionRateMPerS?: number }} PresentedPart
 * @typedef {{ kind: string }} PresentedConnection
 * @typedef {{
 *   pose: { position: {x:number,y:number,z:number}, quaternion: {x:number,y:number,z:number,w:number}, visualOffsetY:number },
 *   poseMode: string, signedSpeed:number, velocity:{y:number}, detachedParts?: Array<{id:number,position:{x:number,y:number,z:number},quaternion:{x:number,y:number,z:number,w:number}}>,
 *   wheelStates:Array<{partId:number,carcassDeflectionM:number,carcassDeflectionRateMPerS:number,spinDelta:number}>,
 *   memberPartIds:number[], motorPartIds?:number[], activeLuminairePartIds?:number[], driveForce:{availableMotorPowerW?:number},
 *   weightN:number, steer:number, grounded:boolean, inWater:boolean, bottomContact:boolean,
 *   onField:boolean, edgeDistance:number, brake:boolean, submergedFraction:number,
 *   buoyancyN:number, wheelContacts:number, waterDepth:number, lights:boolean,
 * }} MobilityAssemblyTelemetry
 * @typedef {{
 *   poses:Array<{id:number,position:{x:number,y:number,z:number},quaternion:{x:number,y:number,z:number,w:number},jointAngle?:number,reactionTorque?:number}>,
 *   com:{x:number,y:number,z:number}, contacts:{left:boolean,right:boolean}, fallen:boolean,
 *   gaitPhase:string, forwardDistance:number, balanceError:number,
 * }} ArticulatedTelemetry
 * @typedef {{ pose:{position:{y:number}}, velocity:{y:number}, propulsionActive:boolean, detachedParts:number, overheated:boolean, thermalHealth:number, dynamicPressure:number, mach:number, skinTempC:number, maxAttachmentLoadN:number }} FlightTelemetry
 * @typedef {{
 *   mechanisms?: object, articulated?: ArticulatedTelemetry, mobility?:{assemblies:MobilityAssemblyTelemetry[]},
 *   aerothermal?: object, flight?: FlightTelemetry,
 *   structures?: {health:number,newlyFailed:unknown[]},
 * }} PresentedSystems
 * @typedef {{ time:number, systems?: PresentedSystems }} PresentedSnapshot
 */

/**
 * @param {{
 *   model: {
 *     parts: () => PresentedPart[], connections: () => PresentedConnection[],
 *     selectedId: () => number | null, latest: () => PresentedSnapshot,
 *     connectionValid: (connection: PresentedConnection) => boolean,
 *     mobilityTargetPartIds:()=>ReadonlyArray<number>,
 *   },
 *   scene: { world: THREE.Scene, machine: THREE.Group, wires: THREE.Group, cameraTarget: THREE.Vector3 },
 *   view: {
 *     query: (selector:string) => Element | null, renderInspector:()=>void,
 *     setLights:(on:boolean)=>void, updateDriveHud:()=>void,
 *     presentAerothermal:(telemetry:object)=>void,
 *     drawConnections:()=>void, notify:(message:string)=>void,
 *   },
 * }} ports
 */
export function createSimulationTelemetryPresenter({ model, scene, view }) {
  /** @returns {HTMLElement} */
  const required = (selector) => {
    const element = view.query(selector);
    if (!element) throw new Error(`Missing telemetry UI element ${selector}`);
    return /** @type {HTMLElement} */ (element);
  };

  function presentMechanisms(telemetry) {
    presentMechanismTelemetry({
      telemetry,
      parts: model.parts(),
      missionName: required("#mission-name"),
      missionDescription: required("#mission-desc"),
      missionProgress: required(".mission-progress i"),
      elapsed: model.latest().time,
      hasValidMesh: model
        .connections()
        .some(
          (connection) =>
            connection.kind === "mesh" && model.connectionValid(connection),
        ),
    });
  }

  function presentMobility(telemetry) {
    const assemblies = telemetry?.assemblies || [];
    if (!assemblies.length) return;
    const followed = selectMobilityAssembly(
      assemblies,
      model.mobilityTargetPartIds(),
    );
    for (const assembly of assemblies) presentMobilityWheels(assembly);
    view.setLights(
      assemblies.flatMap((assembly) => assembly.activeLuminairePartIds || []),
    );
    if (followed) presentMobilityCamera(followed);
    view.updateDriveHud();
    if (followed) presentMobilityMission(followed);
  }

  function presentMobilityWheels(telemetry) {
    if (!telemetry) return;
    if (telemetry.poseMode !== "per-part") {
      scene.machine.position.set(
        telemetry.pose.position.x,
        telemetry.pose.position.y - telemetry.pose.visualOffsetY,
        telemetry.pose.position.z,
      );
      scene.machine.quaternion.set(
        telemetry.pose.quaternion.x,
        telemetry.pose.quaternion.y,
        telemetry.pose.quaternion.z,
        telemetry.pose.quaternion.w,
      );
      scene.wires.position.copy(scene.machine.position);
      scene.wires.quaternion.copy(scene.machine.quaternion);
    }
    for (const detached of telemetry.detachedParts || []) {
      const part = model
        .parts()
        .find((candidate) => candidate.id === detached.id);
      if (!part) continue;
      if (part.mesh.parent === scene.machine) scene.world.attach(part.mesh);
      part.flightDetached = true;
      part.mesh.position.set(
        detached.position.x,
        detached.position.y,
        detached.position.z,
      );
      part.mesh.quaternion.set(
        detached.quaternion.x,
        detached.quaternion.y,
        detached.quaternion.z,
        detached.quaternion.w,
      );
    }
    for (const wheelState of telemetry.wheelStates) {
      const wheel = model.parts().find((part) => part.id === wheelState.partId);
      if (!wheel || wheel.flightDetached) continue;
      wheel.tireDeflectionM = wheelState.carcassDeflectionM;
      wheel.tireDeflectionRateMPerS = wheelState.carcassDeflectionRateMPerS;
      if (telemetry.poseMode === "per-part") continue;
      wheel.mesh.rotation.x += wheelState.spinDelta;
    }
  }

  function presentMobilityCamera(telemetry) {
    scene.cameraTarget.x = THREE.MathUtils.lerp(
      scene.cameraTarget.x,
      telemetry.pose.position.x,
      0.08,
    );
    scene.cameraTarget.y = THREE.MathUtils.lerp(
      scene.cameraTarget.y,
      Math.max(-4, telemetry.pose.position.y + 0.7),
      0.08,
    );
    scene.cameraTarget.z = THREE.MathUtils.lerp(
      scene.cameraTarget.z,
      telemetry.pose.position.z,
      0.08,
    );
  }

  function presentMobilityMission(telemetry) {
    const status = mobilityMissionReadModel(telemetry);
    required("#mission-name").textContent = status.name;
    required("#mission-desc").textContent = status.description;
    if (status.progressPercent != null)
      required(".mission-progress i").style.width =
        `${status.progressPercent}%`;
  }

  function presentArticulated(telemetry) {
    if (!telemetry) return;
    for (const pose of telemetry.poses) {
      // Axial mechanism presentation records intentionally own only a center
      // and scale. Their mesh is handled by the mechanism presenter; only
      // physical body poses carry an authoritative orientation here.
      if (!pose.quaternion) continue;
      const part = model.parts().find((candidate) => candidate.id === pose.id);
      if (!part?.mesh) continue;
      part.mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
      part.mesh.quaternion.set(
        pose.quaternion.x,
        pose.quaternion.y,
        pose.quaternion.z,
        pose.quaternion.w,
      );
      if (Number.isFinite(pose.jointAngle)) part.jointAngle = pose.jointAngle;
      if (Number.isFinite(pose.reactionTorque))
        part.reactionTorque = pose.reactionTorque;
    }
    scene.cameraTarget.set(telemetry.com.x, telemetry.com.y, telemetry.com.z);
    const feet =
      `${telemetry.contacts.left ? "L" : ""}${telemetry.contacts.right ? "R" : ""}` ||
      "air";
    required("#mission-name").textContent = telemetry.fallen
      ? "BALANCE LOST"
      : telemetry.gaitPhase;
    required("#mission-desc").textContent =
      `Forward ${telemetry.forwardDistance.toFixed(2)} m · COM ${telemetry.balanceError.toFixed(2)} m · support ${feet}`;
  }

  function presentFlight(telemetry) {
    if (!telemetry) return;
    view.presentAerothermal(telemetry);
    required("#mission-name").textContent =
      telemetry.detachedParts > 0
        ? "AIRFRAME BREAKUP"
        : telemetry.overheated
          ? "THERMAL FAILURE"
          : telemetry.airDensity < 1e-7
            ? "SPACEFLIGHT"
            : telemetry.thermalHealth < 0.45
              ? "THERMAL WARNING"
              : telemetry.dynamicPressure > 34_000
                ? "MAX-Q"
                : telemetry.propulsionActive
                  ? "POWERED FLIGHT"
                  : "FLIGHT SYSTEMS READY";
    required("#mission-desc").textContent =
      `Mach ${telemetry.mach.toFixed(2)} · q ${(telemetry.dynamicPressure / 1000).toFixed(1)} kPa · hottest ${telemetry.skinTempC.toFixed(0)}°C · load ${(telemetry.maxAttachmentLoadN / 1000).toFixed(1)} kN`;
    scene.wires.position.copy(scene.machine.position);
    scene.wires.quaternion.copy(scene.machine.quaternion);
  }

  function presentSensorReadout() {
    const sensor = model
      .parts()
      .find((part) => part.id === model.selectedId() && part.type === "sensor");
    const readout = view.query("#sensor-live-rpm");
    if (sensor && readout)
      readout.textContent = `MEASURED SHAFT SPEED · ${(sensor.sensorValueRpm || 0).toFixed(1)} RPM`;
  }

  function present(snapshot = model.latest()) {
    const systems = snapshot.systems || {};
    presentMechanisms(systems.mechanisms);
    presentArticulated(systems.articulated);
    presentMobility(systems.mobility);
    if (systems.aerothermal) view.presentAerothermal(systems.aerothermal);
    presentFlight(systems.flight);
    const structures = systems.structures;
    if (!structures) return;
    required("#health-readout").textContent = `${structures.health}%`;
    required(".engineering-health u").style.width = `${structures.health}%`;
    required(".engineering-health").classList.toggle(
      "warning",
      structures.health < 50,
    );
    if (structures.newlyFailed.length) {
      view.notify(
        "STRUCTURAL FAILURE — a fatigued mechanical connection broke",
      );
      view.drawConnections();
    }
  }

  return Object.freeze({ present, presentSensorReadout });
}
