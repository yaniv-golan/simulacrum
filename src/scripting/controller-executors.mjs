import { compileController } from './controller-program.mjs';
import {
  generateRules,
  CONTROLLER_INPUT_PORTS,
  CONTROLLER_OUTPUT_PORTS,
} from '../model/controller-authoring.mjs';
/** Application/core injection point. Simulation never imports the compiler. */
export async function createProgramExecutors(power) {
  const programs = [];
  for (const controller of power.controllers.filter((c) => c.program)) {
    const { authoring, inputs, outputs } = controller.program;
    if (authoring.mode === 'rules' && authoring.source !== generateRules(authoring.rules))
      throw Error('Rules and displayed code do not match.');
    let compiled;
    try {
      compiled = await compileController(authoring.source, {
        inputs: CONTROLLER_INPUT_PORTS.map((port) => ({ port })),
        outputs: CONTROLLER_OUTPUT_PORTS.map((port) => ({ port })),
      });
    } catch (error) {
      throw Object.assign(error, { path: 'controllerProgram: ' + error.message });
    }
    const required = new Set(inputs.map((i) => i.port));
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
            if (!['ok', 'no-return', 'initializing'].includes(status))
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
            return { node: o.node, duty: value ?? 0, valid: value !== null };
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
