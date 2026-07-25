import { AssemblyModel } from "../model/assembly-model.js";
import { canonicalizeQuaternion } from "../model/primitives.js";
import {
  projectPortableAuthoredConnection,
  projectPortableAuthoredPart,
} from "../model/authored-assembly-content.js";
import { PowerNetwork } from "../simulation/power-network.js";
import { RunAssemblyGraph } from "../simulation/run-assembly-graph.js";
import { SignalNetwork } from "../simulation/signal-network.js";
import { routedControllerIdsForPart } from "./controller-route-read-model.js";
import { readRemoteControlBinding } from "./remote-control-read-model.js";

/**
 * Bridges mutable editor objects to the persistent AssemblyModel and immutable
 * run telemetry. Network previews and capability consumers share its revision
 * cache rather than creating parallel notions of the current assembly.
 */
export function createAssemblyWorkspace({
  model,
  catalog,
  editor,
  simulation,
  presentation,
  capabilities,
}) {
  let networkRevision = -1;
  let networkAnalysis = null;
  let reducedShadows = false;

  function editorSnapshot() {
    return editor.parts().map((part) =>
      projectPortableAuthoredPart({
        ...part,
        pos: [...(part.pos || [0, 0, 0])],
        orientation: canonicalizeQuaternion(
          part.mesh
            ? [
                part.mesh.quaternion.x,
                part.mesh.quaternion.y,
                part.mesh.quaternion.z,
                part.mesh.quaternion.w,
              ]
            : part.orientation,
        ),
        scale: part.mesh
          ? {
              x: part.mesh.scale.x,
              y: part.mesh.scale.y,
              z: part.mesh.scale.z,
            }
          : structuredClone(part.scale || { x: 1, y: 1, z: 1 }),
      }),
    );
  }

  function sync() {
    const parts = editor.parts(),
      shouldReduce = parts.length > 128,
      desiredRatio = shouldReduce
        ? Math.min(
            presentation.normalPixelRatio,
            parts.length > 256 ? 0.3 : 0.6,
          )
        : presentation.normalPixelRatio;
    if (presentation.pixelRatio() !== desiredRatio)
      presentation.setPixelRatio(desiredRatio);
    if (shouldReduce !== reducedShadows) {
      reducedShadows = shouldReduce;
      for (const part of parts)
        part.mesh?.traverse((object) => {
          if (object.isMesh) object.castShadow = !shouldReduce;
        });
    } else if (shouldReduce)
      parts.at(-1)?.mesh?.traverse((object) => {
        if (object.isMesh) object.castShadow = false;
      });
    presentation.setPerformanceMode(shouldReduce);
    presentation.setEnvironmentVisible(!shouldReduce);
    presentation.syncBatch(parts, !simulation.running());
    model.replace(
      AssemblyModel.fromRuntime(
        editorSnapshot(),
        editor.connections().map(projectPortableAuthoredConnection),
      ).snapshot(),
    );
    return model;
  }

  function networks() {
    if (networkAnalysis && networkRevision === model.revision)
      return networkAnalysis;
    const graph = new RunAssemblyGraph(model.snapshot()),
      power = new PowerNetwork(catalog).resolve(graph, 1 / 120),
      signals = new SignalNetwork(catalog).resolve(graph, power);
    networkRevision = model.revision;
    networkAnalysis = { power, signals };
    return networkAnalysis;
  }

  function powered(part) {
    if (!part) return false;
    const telemetry = simulation.telemetry();
    if (simulation.running() && telemetry.systems?.power?.poweredPartIds)
      return telemetry.systems.power.poweredPartIds.includes(part.id);
    return networks().power.isPowered(part.id);
  }

  function routedControllers(part) {
    if (!part) return [];
    const liveSignals = simulation.running()
      ? simulation.telemetry().systems?.signals
      : null;
    return routedControllerIdsForPart({
      part,
      liveSignals,
      signalNetwork: liveSignals ? null : networks().signals,
      catalog,
    });
  }

  function resolveControlTarget(control) {
    const binding = controlBinding(control);
    return binding.online ? binding.target : null;
  }

  function controlBinding(control) {
    return readRemoteControlBinding({
      control,
      parts: editor.parts(),
      isPowered: powered,
      routedControllerIds: routedControllers,
      commandChannels: (part) => capabilities.commandChannels(part.id),
    });
  }

  function currentCollection(key) {
    const live = simulation.running()
      ? simulation.telemetry()?.run?.[key]
      : null;
    return live?.length ? live : editor[key]();
  }

  return Object.freeze({
    model,
    editorSnapshot,
    sync,
    networks,
    powered,
    routedControllers,
    controlBinding,
    resolveControlTarget,
    isControlOnline(control) {
      return controlBinding(control).online;
    },
    currentParts: () => currentCollection("parts"),
    currentConnections: () => currentCollection("connections"),
    currentPart(id) {
      return currentCollection("parts").find((part) => part.id === id) || null;
    },
    reducedShadows: () => reducedShadows,
  });
}
