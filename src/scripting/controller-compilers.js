import {
  compileControlIRToWat,
  pointContactWrenchSpecsFromControlIR,
} from "./control-ir-wat.js";
import { validateControlIR } from "../model/control-program-ir.js";
import { compileTypeScriptToControlIR } from "./typescript-control-compiler.js";
import { compileWatController } from "./wat-control-compiler.js";

export async function prepareWasmController(source, bindingManifest) {
  return compileWatController(source, { language: "wat", bindingManifest });
}

async function prepareTypeScriptControllerWithHost(
  source,
  bindingManifest,
  pointContactWrenchHost,
) {
  const ir = await compileTypeScriptToControlIR(source, bindingManifest),
    wat = compileControlIRToWat(ir),
    pointContactWrenchSpecs = pointContactWrenchSpecsFromControlIR(ir);
  return compileWatController(wat, {
    language: "typescript",
    enforceSourceLimit: false,
    bindingManifest: ir.bindingManifest,
    pointContactWrenchSpecs,
    pointContactWrenchHost,
    programIdentitySource: pointContactWrenchSpecs.length ? source : null,
  });
}

async function prepareControlIRControllerWithHost(
  ir,
  { language = "visual", pointContactWrenchHost = null } = {},
) {
  const validated = validateControlIR(ir),
    pointContactWrenchSpecs = pointContactWrenchSpecsFromControlIR(validated);
  return compileWatController(compileControlIRToWat(ir), {
    language,
    enforceSourceLimit: false,
    bindingManifest: validated.bindingManifest,
    pointContactWrenchSpecs,
    pointContactWrenchHost,
    programIdentitySource: pointContactWrenchSpecs.length
      ? JSON.stringify(validated)
      : null,
  });
}

export function prepareTypeScriptController(source, bindingManifest) {
  return prepareTypeScriptControllerWithHost(source, bindingManifest, null);
}

export function prepareControlIRController(ir, { language = "visual" } = {}) {
  return prepareControlIRControllerWithHost(ir, { language });
}

// Application composition only. These are deliberately absent from Core's
// public exports so callers cannot substitute physical authority.
export function prepareHostedTypeScriptController(
  source,
  bindingManifest,
  pointContactWrenchHost,
) {
  return prepareTypeScriptControllerWithHost(
    source,
    bindingManifest,
    pointContactWrenchHost,
  );
}

/**
 * @param {any} ir
 * @param {{language?:string,pointContactWrenchHost?:{identity:string,allocate:(input:string)=>object}}} [options]
 */
export function prepareHostedControlIRController(
  ir,
  { language = "visual", pointContactWrenchHost } = {},
) {
  return prepareControlIRControllerWithHost(ir, {
    language,
    pointContactWrenchHost,
  });
}

export { compileControlIRToWat, compileTypeScriptToControlIR };
