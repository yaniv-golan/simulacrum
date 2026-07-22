import { compileTypeScriptToControlIR } from "@yaniv-golan/simulacrum-core";

export async function controllerProgramExample() {
  const bindings = [
    {
      index: 1,
      id: "navigation.altitude",
      direction: "input",
      endpointPartId: 12,
      endpointPortId: "SIGNAL",
      reading: "altitude",
    },
    {
      index: 0,
      id: "engine.throttle",
      direction: "output",
      endpointPartId: 20,
      endpointPortId: "CONTROL",
      channel: "throttle",
    },
  ];
  return compileTypeScriptToControlIR(
    `
interface ControlAPI {
  read(binding: 'navigation.altitude'): number;
  write(binding: 'engine.throttle', value: number): void;
}

function tick(api: ControlAPI, dt: number): void {
  const error = 10 - api.read('navigation.altitude');
  api.write('engine.throttle', Math.max(0, Math.min(1, error * 0.1)));
  void dt;
}`,
    bindings,
  );
}
