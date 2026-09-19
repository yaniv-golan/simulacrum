import { compileController } from './controller-program.mjs';
import {
  generateRules,
  admitControllerAuthoring,
  CONTROLLER_INPUT_PORTS,
  CONTROLLER_OUTPUT_PORTS,
} from '../model/controller-authoring.mjs';
const CONTROLLER_BINDINGS = Object.freeze({
  inputs: CONTROLLER_INPUT_PORTS.map((port) => ({ port })),
  outputs: CONTROLLER_OUTPUT_PORTS.map((port) => ({ port })),
});
/** Compile one admitted program. Callers outside simulation use this before session. */
export async function compileControllerAuthoring(authoring) {
  try {
    admitControllerAuthoring(authoring);
  } catch (error) {
    throw Object.assign(error, {
      reasonCode: error.reasonCode ?? 'INVALID_CONTROLLER_PROGRAM',
      path: 'controllerProgram',
    });
  }
  if (authoring.mode === 'rules' && authoring.source !== generateRules(authoring.rules))
    throw Object.assign(Error('Rules and displayed code do not match.'), {
      reasonCode: 'INVALID_CONTROLLER_PROGRAM',
      path: 'controllerProgram',
    });
  try {
    return await compileController(authoring.source, CONTROLLER_BINDINGS);
  } catch (error) {
    throw Object.assign(error, {
      reasonCode: error.reasonCode ?? 'INVALID_CONTROLLER_PROGRAM',
      path: 'controllerProgram: ' + error.message,
    });
  }
}
/** Application/core injection point. Simulation never imports the compiler. */
export async function createProgramExecutors(power) {
  const programs = [];
  for (const controller of power.controllers.filter((c) => c.program)) {
    const { authoring, inputs, outputs } = controller.program;
    const compiled = await compileControllerAuthoring(authoring);
    const required = new Set();
    const collect = (value) => {
      if (!Array.isArray(value)) return;
      if (value[0] === 'input') required.add(CONTROLLER_INPUT_PORTS[value[2]]);
      for (const child of value) collect(child);
    };
    collect(compiled.ir.body);
    let inspection = { markers: [], requested: [], error: null };
    programs.push({
      inspect: () => inspection,
      node: controller.node,
      snapshot: compiled.snapshot,
      restore: compiled.restore,
      run(view) {
        const readings = new Map(view.inputs.map((i) => [i.node, i]));
        try {
          for (const port of required) {
            const binding = inputs.find((i) => i.port === port),
              status = binding
                ? readings.get(binding.node)?.channels[binding.channel]?.status
                : 'disconnected';
            if (!['ok', 'no-return', 'initializing', 'unavailable'].includes(status))
              throw Error(
                `Required ${port}: ${status ?? 'disconnected'}. Repair sensing and explicitly rearm.`,
              );
          }
          const values = compiled.run(
            CONTROLLER_INPUT_PORTS.map((port) => {
              const i = inputs.find((i) => i.port === port);
              return i
                ? (readings.get(i.node)?.channels[i.channel] ?? { status: 'disconnected' })
                : { status: 'disconnected' };
            }),
          );
          inspection = { markers: compiled.inspect(), requested: values, error: null };
          return outputs.map((o) => {
            const value = values[CONTROLLER_OUTPUT_PORTS.indexOf(o.port)];
            return {
              node: o.node,
              duty: value ?? 0,
              valid: true,
            };
          });
        } catch (error) {
          inspection = { markers: [], requested: [], error: error.message };
          return outputs.map((o) => ({ node: o.node, duty: 0, valid: false }));
        }
      },
    });
  }
  return programs;
}
