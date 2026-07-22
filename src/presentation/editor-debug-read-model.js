import { challengeReliability } from "../model/challenge-lab.js";

/**
 * @typedef {{ x:number,y:number,z:number }} EditorDebugVector
 * @typedef {{
 *   distance:number, renderedDistance:number, yaw:number, pitch:number,
 *   followSelection:boolean, target:EditorDebugVector, trackingError:number,
 *   tracking:{active:boolean,subjects:number,boundsRadius:number,fitDistance:number,safeFrame:object},
 * }} CameraDebugSnapshot
 * @typedef {{
 *   mode:string, tool:string, cameraTool:string|null,
 *   directManipulation:object|null, pendingPlacement:object|null, lastPlacement:object|null, lastTransformOperation:object|null, marqueeSelection:object|null,
 *   exploded:{active:boolean,amount:number,centerLift:number,displayedParts?:object[]},
 *   running:boolean, simulationPaused:boolean, timeScale:number,
 *   simulationTime:number, architecture:{assemblyRevision:number,fixedStepHz:number,session:unknown},
 *   engineering:unknown, exchange:unknown, failureAnalysis:unknown, mechanismLab:unknown,
 *   challenge:null|{id:string,status:string,progress:number,holdSeconds:number,score:number,best:number,startMode:string|null,contract:unknown,records:object[]},
 *   learning:{centerOpen:boolean,topic:string,category:string,coachOpen:boolean,coachStep:number,topicsAvailable:number},
 *   tutorialStep:number, selectedPart:number|null, selectedParts:number[], selectedEntity:object|null,
 *   cameraTarget:EditorDebugVector, camera:CameraDebugSnapshot,
 * }} EditorDebugInput
 */

/** @param {EditorDebugInput} input */
export function buildEditorDebugReadModel(input) {
  return {
    mode: input.mode,
    tool: input.tool,
    cameraTool: input.cameraTool,
    directManipulation: input.directManipulation,
    pendingPlacement: structuredClone(input.pendingPlacement),
    lastPlacement: structuredClone(input.lastPlacement),
    lastTransformOperation: structuredClone(input.lastTransformOperation),
    marqueeSelection: input.marqueeSelection,
    explodedView: {
      active: input.exploded.active,
      amount: +input.exploded.amount.toFixed(3),
      centerLift: +input.exploded.centerLift.toFixed(3),
      displayedParts: input.exploded.displayedParts,
    },
    running: input.running,
    simulationPaused: input.simulationPaused,
    timeScale: input.timeScale,
    simulationTime: +input.simulationTime.toFixed(3),
    architecture: input.architecture,
    engineering: input.engineering,
    exchange: input.exchange,
    failureAnalysis: input.failureAnalysis,
    mechanismLab: input.mechanismLab,
    challenge: input.challenge
      ? {
          id: input.challenge.id,
          status: input.challenge.status,
          progress: +input.challenge.progress.toFixed(3),
          holdSeconds: +input.challenge.holdSeconds.toFixed(3),
          score: input.challenge.score,
          best: input.challenge.best,
          startMode: input.challenge.startMode,
          contract: input.challenge.contract,
          reliability: challengeReliability(
            input.challenge.records,
            input.challenge.id,
          ),
        }
      : null,
    learning: structuredClone(input.learning),
    tutorialStep: input.tutorialStep,
    selectedPart: input.selectedPart,
    selectedParts: [...input.selectedParts],
    selectedEntity: structuredClone(input.selectedEntity),
    camera: {
      target: {
        x: +input.cameraTarget.x.toFixed(1),
        y: +input.cameraTarget.y.toFixed(1),
        z: +input.cameraTarget.z.toFixed(1),
      },
      distance: +input.camera.distance.toFixed(1),
      renderedDistance: +input.camera.renderedDistance.toFixed(2),
      yaw: +input.camera.yaw.toFixed(2),
      pitch: +input.camera.pitch.toFixed(2),
      followSelection: input.camera.followSelection,
      smoothedTarget: {
        x: +input.camera.target.x.toFixed(1),
        y: +input.camera.target.y.toFixed(1),
        z: +input.camera.target.z.toFixed(1),
      },
      trackingError: +input.camera.trackingError.toFixed(2),
      tracking: input.camera.tracking.active
        ? {
            subjectCount: input.camera.tracking.subjects,
            boundsRadius: +input.camera.tracking.boundsRadius.toFixed(2),
            fitDistance: +input.camera.tracking.fitDistance.toFixed(2),
            safeFrame: structuredClone(input.camera.tracking.safeFrame),
          }
        : null,
    },
  };
}
