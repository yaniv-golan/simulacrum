export { buildHumanoidDebugReadModel } from "./humanoid-debug-read-model.js";
export { buildAssemblyDebugReadModel } from "./assembly-debug-read-model.js";
export { buildControllerDebugReadModel } from "./controller-debug-read-model.js";
export { buildEditorDebugReadModel } from "./editor-debug-read-model.js";

/** Installs the automation/debug read model without exposing mutable runtime state. */
export function installJsonTextReadModel(
  name,
  readSnapshot,
  target = globalThis,
) {
  target[name] = () => {
    const snapshot = readSnapshot();
    return typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot);
  };
  return () => delete target[name];
}
