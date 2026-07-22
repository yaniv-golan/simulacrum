import { compileControlIRToWat } from "./control-ir-wat.js";
import { validateControlIR } from "../model/control-program-ir.js";
import { compileTypeScriptToControlIR } from "./typescript-control-compiler.js";
import { compileWatController } from "./wat-control-compiler.js";

export async function prepareWasmController(source, bindingManifest) {
  return compileWatController(source, { language: "wat", bindingManifest });
}

export async function prepareTypeScriptController(source, bindingManifest) {
  const ir = await compileTypeScriptToControlIR(source, bindingManifest),
    wat = compileControlIRToWat(ir);
  return compileWatController(wat, {
    language: "typescript",
    enforceSourceLimit: false,
    bindingManifest: ir.bindingManifest,
  });
}

export async function prepareControlIRController(
  ir,
  { language = "visual" } = {},
) {
  const validated = validateControlIR(ir);
  return compileWatController(compileControlIRToWat(ir), {
    language,
    enforceSourceLimit: false,
    bindingManifest: validated.bindingManifest,
  });
}

export { compileControlIRToWat, compileTypeScriptToControlIR };
