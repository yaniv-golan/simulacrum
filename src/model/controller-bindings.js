import { ACTUATOR_CHANNELS, actuatorChannel } from "./actuator-contracts.js";
import { TYPES } from "./component-catalog.js";
import {
  componentControlContract,
  componentHasControlContract,
  componentReadings,
} from "./component-contracts.js";
import { portDefinition, portIds, portsCompatible } from "./ports.js";
import { DomainValidationError, stableStringify } from "./primitives.js";

export const CONTROLLER_BINDING_DIRECTIONS = Object.freeze(["input", "output"]);

const compareId = (left, right) =>
  String(left.id).localeCompare(String(right.id), "en");

function bindingError(code, message, controllerId, binding, details = {}) {
  throw new DomainValidationError(code, message, {
    path: ["parts", controllerId, "controllerBindings", binding?.id || null],
    details: { controllerId, bindingId: binding?.id || null, ...details },
  });
}

function directedSignalEdges(parts, connections, catalog) {
  const byId = new Map(parts.map((part) => [part.id, part])),
    outgoing = new Map(parts.map((part) => [part.id, []]));
  for (const connection of connections) {
    if (connection.kind !== "signal" || connection.failed) continue;
    const left = byId.get(connection.a),
      right = byId.get(connection.b);
    if (
      !left ||
      !right ||
      !portIds(left, catalog).includes(connection.portA) ||
      !portIds(right, catalog).includes(connection.portB) ||
      !portsCompatible(left, connection.portA, right, connection.portB, catalog)
    )
      continue;
    const leftPort = portDefinition(left, connection.portA, catalog),
      rightPort = portDefinition(right, connection.portB, catalog);
    if (
      ["source", "bidirectional"].includes(leftPort.direction) &&
      ["sink", "bidirectional"].includes(rightPort.direction)
    )
      outgoing.get(left.id).push({
        fromPartId: left.id,
        fromPortId: connection.portA,
        toPartId: right.id,
        toPortId: connection.portB,
      });
    if (
      ["source", "bidirectional"].includes(rightPort.direction) &&
      ["sink", "bidirectional"].includes(leftPort.direction)
    )
      outgoing.get(right.id).push({
        fromPartId: right.id,
        fromPortId: connection.portB,
        toPartId: left.id,
        toPortId: connection.portA,
      });
  }
  return outgoing;
}

function hasDirectedEndpointRoute(
  outgoing,
  sourcePartId,
  targetPartId,
  { sourcePortId = null, targetPortId = null } = {},
  terminalPartIds = new Set(),
) {
  const queue = [{ partId: sourcePartId, first: true }],
    visited = new Set();
  while (queue.length) {
    const current = queue.shift(),
      visitKey = `${current.partId}:${current.first ? "first" : "next"}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    if (!current.first && terminalPartIds.has(current.partId)) continue;
    for (const edge of outgoing.get(current.partId) || []) {
      if (current.first && sourcePortId && edge.fromPortId !== sourcePortId)
        continue;
      if (
        edge.toPartId === targetPartId &&
        (!targetPortId || edge.toPortId === targetPortId)
      )
        return true;
      queue.push({ partId: edge.toPartId, first: false });
    }
  }
  return false;
}

export function canonicalControllerBindings(bindings) {
  if (!Array.isArray(bindings))
    throw new TypeError("controllerBindings must be an array");
  return Object.freeze(
    bindings
      .map((binding) => Object.freeze(structuredClone(binding)))
      .sort(compareId),
  );
}

/**
 * Resolves the controller's authored binding declarations into its stable,
 * route-validated runtime ABI.
 *
 * @param {any} controller
 * @param {any[]} parts
 * @param {any[]} connections
 * @param {Record<string, any>} [catalog]
 */
export function controllerBindingManifest(
  controller,
  parts,
  connections,
  catalog = TYPES,
) {
  if (!controller || controller.type !== "computer")
    throw new TypeError("binding manifests require a Logic Controller");
  const bindings = canonicalControllerBindings(controller.controllerBindings),
    aliases = new Set(),
    partsById = new Map(parts.map((part) => [part.id, part])),
    outgoing = directedSignalEdges(parts, connections, catalog),
    controllerIds = new Set(
      parts
        .filter((part) =>
          componentHasControlContract(part, "controller-target-v1", catalog),
        )
        .map((part) => part.id),
    ),
    manifest = [];
  for (const [index, binding] of bindings.entries()) {
    if (aliases.has(binding.id))
      bindingError(
        "DUPLICATE_CONTROLLER_BINDING",
        `Duplicate controller binding ${binding.id}.`,
        controller.id,
        binding,
      );
    aliases.add(binding.id);
    const endpoint = partsById.get(binding.endpointPartId);
    if (!endpoint)
      bindingError(
        "MISSING_CONTROLLER_ENDPOINT",
        `Binding ${binding.id} references a missing component.`,
        controller.id,
        binding,
        { endpointPartId: binding.endpointPartId },
      );
    if (!portIds(endpoint, catalog).includes(binding.endpointPortId))
      bindingError(
        "MISSING_CONTROLLER_ENDPOINT_PORT",
        `Binding ${binding.id} references a missing endpoint port.`,
        controller.id,
        binding,
        {
          endpointPartId: binding.endpointPartId,
          endpointPortId: binding.endpointPortId,
        },
      );
    if (binding.direction === "input") {
      if (!componentReadings(endpoint, catalog).includes(binding.reading))
        bindingError(
          "UNSUPPORTED_CONTROLLER_READING",
          `Component ${binding.endpointPartId} does not expose ${binding.reading}.`,
          controller.id,
          binding,
        );
      if (
        !hasDirectedEndpointRoute(
          outgoing,
          endpoint.id,
          controller.id,
          { sourcePortId: binding.endpointPortId },
          controllerIds,
        )
      )
        bindingError(
          "OFFLINE_CONTROLLER_INPUT_ROUTE",
          `Binding ${binding.id} has no directed signal route to its controller.`,
          controller.id,
          binding,
        );
    } else if (binding.direction === "output") {
      if (!actuatorChannel(endpoint, binding.channel, catalog))
        bindingError(
          "UNSUPPORTED_CONTROLLER_CHANNEL",
          `Component ${binding.endpointPartId} does not accept ${binding.channel}.`,
          controller.id,
          binding,
        );
      if (
        !hasDirectedEndpointRoute(
          outgoing,
          controller.id,
          endpoint.id,
          { targetPortId: binding.endpointPortId },
          controllerIds,
        )
      )
        bindingError(
          "OFFLINE_CONTROLLER_OUTPUT_ROUTE",
          `Binding ${binding.id} has no directed signal route from its controller.`,
          controller.id,
          binding,
        );
    } else
      bindingError(
        "INVALID_CONTROLLER_BINDING_DIRECTION",
        `Binding ${binding.id} has an invalid direction.`,
        controller.id,
        binding,
      );
    manifest.push(
      Object.freeze({
        index,
        id: binding.id,
        direction: binding.direction,
        endpointPartId: binding.endpointPartId,
        endpointPortId: binding.endpointPortId,
        ...(binding.direction === "input"
          ? { reading: binding.reading }
          : { channel: binding.channel }),
      }),
    );
  }
  return Object.freeze(manifest);
}

/**
 * Returns only endpoints with a valid directed authored route.
 *
 * @param {any} controller
 * @param {any[]} parts
 * @param {any[]} connections
 * @param {Record<string, any>} [catalog]
 */
export function controllerBindingOptions(
  controller,
  parts,
  connections,
  catalog = TYPES,
) {
  if (!controller || controller.type !== "computer") return Object.freeze([]);
  const outgoing = directedSignalEdges(parts, connections, catalog),
    controllerIds = new Set(
      parts
        .filter((part) =>
          componentHasControlContract(part, "controller-target-v1", catalog),
        )
        .map((part) => part.id),
    ),
    options = [];
  for (const endpoint of parts) {
    if (endpoint.id === controller.id || endpoint.detached) continue;
    for (const endpointPortId of portIds(endpoint, catalog)) {
      const endpointPort = portDefinition(endpoint, endpointPortId, catalog);
      if (
        endpointPort.kind === "signal" &&
        ["source", "bidirectional"].includes(endpointPort.direction) &&
        hasDirectedEndpointRoute(
          outgoing,
          endpoint.id,
          controller.id,
          {
            sourcePortId: endpointPortId,
          },
          controllerIds,
        )
      )
        for (const reading of componentReadings(endpoint, catalog))
          options.push({
            direction: "input",
            endpointPartId: endpoint.id,
            endpointPortId,
            reading,
          });
      if (
        endpointPort.kind === "signal" &&
        ["sink", "bidirectional"].includes(endpointPort.direction) &&
        hasDirectedEndpointRoute(
          outgoing,
          controller.id,
          endpoint.id,
          {
            targetPortId: endpointPortId,
          },
          controllerIds,
        )
      ) {
        const contract = componentControlContract(endpoint, catalog);
        for (const channel of Object.keys(ACTUATOR_CHANNELS[contract] || {}))
          options.push({
            direction: "output",
            endpointPartId: endpoint.id,
            endpointPortId,
            channel,
          });
      }
    }
  }
  return Object.freeze(
    options.sort((left, right) =>
      stableStringify(left).localeCompare(stableStringify(right), "en"),
    ),
  );
}

export function controllerBindingManifestIdentity(manifest) {
  return stableStringify(canonicalControllerBindings(manifest));
}

export function validateControllerBindingManifest(input) {
  const manifest = canonicalControllerBindings(input),
    aliases = new Set();
  for (const [index, binding] of manifest.entries()) {
    if (binding.index !== index)
      throw new Error(`binding ${binding.id} has an unstable ABI index`);
    if (aliases.has(binding.id))
      throw new Error(`duplicate controller binding ${binding.id}`);
    aliases.add(binding.id);
    if (!CONTROLLER_BINDING_DIRECTIONS.includes(binding.direction))
      throw new Error(`binding ${binding.id} has an invalid direction`);
    if (binding.direction === "input" ? !binding.reading : !binding.channel)
      throw new Error(`binding ${binding.id} is incomplete`);
  }
  return manifest;
}

export function controllerBindingIndex(manifest, id, direction) {
  const binding = validateControllerBindingManifest(manifest).find(
    (candidate) => candidate.id === String(id),
  );
  if (!binding || binding.direction !== direction)
    throw new Error(`unknown ${direction} binding ${String(id)}`);
  return binding.index;
}

export function remapControllerBindings(bindings, partIdMap) {
  return canonicalControllerBindings(bindings).map((binding) =>
    Object.freeze({
      ...structuredClone(binding),
      endpointPartId:
        partIdMap instanceof Map
          ? (partIdMap.get(binding.endpointPartId) ?? binding.endpointPartId)
          : (partIdMap?.[binding.endpointPartId] ?? binding.endpointPartId),
    }),
  );
}
