/**
 * @typedef {{
 *   simulate:(dt:number)=>void,
 *   simulateFrames?:(count:number,dt?:number)=>void,
 *   updateFailure:(dt:number)=>void,
 *   elapsed:()=>number,
 * }} RuntimeSimulationPort
 * @typedef {{
 *   streamEarth:(maximum?:number)=>void, updateExploded:(dt:number)=>void,
 *   updateEnvironment:()=>void, updateWater:(time:number)=>void,
 *   updateCamera:(dt:number)=>void, updateDetail:()=>void,
 *   updateBatch:()=>void, updateConnections?:()=>void, render:()=>void,
 *   resourceSnapshot?:()=>{scene:{liveGeometries:number},
 *     earth:{activeChunks:number,ownedGeometries:number}},
 * }} RuntimePresentationPort
 */

/**
 * Owns real-time and deterministic advancement through the same ordered
 * presentation path. Browser diagnostics are installed as read-only globals.
 *
 * @param {{
 *   target:Window, simulation:RuntimeSimulationPort,
 *   presentation:RuntimePresentationPort, diagnostics:()=>object,
 *   environmentCapture?:(presetId:string)=>object,
 *   now?:()=>number,
 * }} ports
 */
export function installWorkshopRuntimeLoop({
  target,
  simulation,
  presentation,
  diagnostics,
  environmentCapture,
  now = () => performance.now(),
}) {
  let previous = now(),
    presentedInitialFrame = false,
    frameId = 0,
    disposed = false;

  /** @param {number} timestamp */
  function frame(timestamp) {
    if (disposed) return;
    const dt = Math.min(0.033, (timestamp - previous) / 1000);
    previous = timestamp;
    if (presentedInitialFrame) presentation.streamEarth();
    simulation.simulate(dt);
    simulation.updateFailure(dt);
    presentation.updateExploded(dt);
    presentation.updateEnvironment();
    presentation.updateWater(timestamp / 1000);
    presentation.updateCamera(dt);
    presentation.updateDetail();
    presentation.updateBatch();
    presentation.updateConnections?.();
    presentation.render();
    presentedInitialFrame = true;
    frameId = target.requestAnimationFrame(frame);
  }

  /** @param {number} milliseconds */
  function advanceTime(milliseconds) {
    presentation.streamEarth(Infinity);
    const steps = Math.max(1, Math.round(milliseconds / 16.667));
    if (simulation.simulateFrames) simulation.simulateFrames(steps, 1 / 60);
    else
      for (let index = 0; index < steps; index += 1)
        simulation.simulate(1 / 60);
    for (let index = 0; index < steps; index += 1) {
      simulation.updateFailure(1 / 60);
      presentation.updateExploded(1 / 60);
    }
    presentation.updateEnvironment();
    presentation.updateWater(simulation.elapsed());
    presentation.updateCamera(Math.min(1, milliseconds / 1000));
    presentation.updateDetail();
    presentation.updateBatch();
    presentation.updateConnections?.();
    presentation.render();
  }

  Object.defineProperties(target, {
    simulacrum_performance: {
      configurable: true,
      value: diagnostics,
    },
    advanceTime: {
      configurable: true,
      value: advanceTime,
    },
  });
  if (environmentCapture)
    Object.defineProperty(target, "simulacrum_environment_capture", {
      configurable: true,
      value: environmentCapture,
    });
  frameId = target.requestAnimationFrame(frame);

  return Object.freeze({
    advanceTime,
    dispose() {
      disposed = true;
      target.cancelAnimationFrame(frameId);
      delete (
        /** @type {Window & {simulacrum_performance?:()=>object}} */ (target)
          .simulacrum_performance
      );
      delete (
        /** @type {Window & {simulacrum_environment_capture?:(presetId:string)=>object}} */ (
          target
        ).simulacrum_environment_capture
      );
      delete (
        /** @type {Window & {advanceTime?:(milliseconds:number)=>void}} */ (
          target
        ).advanceTime
      );
    },
  });
}
