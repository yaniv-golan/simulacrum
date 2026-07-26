/** Builds the previous-step, component-bound sensor read boundary. */
export function createControllerSensorCapture({ sampleWind, sensorBank }) {
  return function captureControllerSensorSnapshot(context, fixedDt) {
    const previous = context.previousTelemetry || {},
      run = previous.run || {},
      systems = previous.systems || {},
      controllers = sensorBank.capture({
        parts: run.parts || [],
        connections: run.connections || [],
        bodies: previous.bodies || {},
        signals: systems.signals || {},
        commandReceivers: systems.commandReceivers || {},
        pneumatics: systems.pneumatics || {},
        environmentBodies: systems.environmentBodies || null,
        compiledBodies: context.services.compiledAssembly?.bodies || [],
        fixedDt,
        time: previous.time || 0,
        sampleWind,
      });
    return {
      time: previous.time || 0,
      controllers,
      poweredControllerIds: systems.power?.poweredPartIds ?? null,
    };
  };
}
