import crypto from "node:crypto";
import { componentDefaults } from "../../src/model/component-resolver.js";
import { stableStringify } from "../../src/model/primitives.js";
import { DEFAULT_VISUAL_PROGRAM } from "../../src/model/visual-logic.js";

export const COMPONENT_INSPECTION_S0_SCENARIOS = Object.freeze([
  "no-selection",
  "ordinary-beam",
  "powered-motor",
  "unpowered-motor",
  "misaligned-mechanical-connection",
  "valid-controller-bindings",
  "invalid-controller-bindings",
  "two-part-multi-selection",
  "six-part-multi-selection",
  "dense-outliner-navigation",
  "solid-interference",
  "loaded-connection-near-rating",
  "loaded-connection-over-rating",
  "rope-free-connected-loaded-failed-unsupported",
  "invalid-authored-mechanism",
]);

export const COMPONENT_INSPECTION_S0_TASKS = Object.freeze([
  "identify",
  "diagnose",
  "connect",
  "disconnect",
  "configure",
  "transform",
  "duplicate",
  "delete-undo",
  "isolate-substitute",
  "simulation-observation",
]);

export function createRawRelationshipStressFixture() {
  const parts = Array.from({ length: 300 }, (_, index) => ({
      id: index + 1,
      type: "relationship-node",
      pos: [index % 20, Math.floor(index / 20), 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1, y: 1, z: 1 },
      config: {},
    })),
    connections = [];
  outer: for (let left = 1; left <= parts.length; left++)
    for (let right = left + 1; right <= parts.length; right++) {
      const kind = connections.length % 2 ? "signal" : "power",
        port = kind === "signal" ? "SIGNAL BUS" : "POWER BUS";
      connections.push({
        id: `stress:${String(connections.length).padStart(4, "0")}`,
        a: left,
        b: right,
        kind,
        portA: port,
        portB: port,
      });
      if (connections.length === 3_000) break outer;
    }
  return {
    catalog: {
      "relationship-node": {
        name: "Relationship stress node",
        mass: 1,
        size: [1, 1, 1],
        ports: [
          {
            id: "SIGNAL BUS",
            kind: "signal",
            behavior: "signal-network",
            direction: "bidirectional",
            multiplicity: "many",
          },
          {
            id: "POWER BUS",
            kind: "power",
            behavior: "power-network",
            direction: "bidirectional",
            multiplicity: "many",
          },
        ],
      },
    },
    snapshot: { revision: 0, parts, connections },
  };
}

export function createMaximumShippingInspectionFixture() {
  const parts = Array.from({ length: 300 }, (_, index) => {
      const type = index < 200 ? "sensor" : "computer";
      return {
        id: index + 1,
        type,
        pos: [(index % 20) * 2, 0.5, Math.floor(index / 20) * 2],
        orientation: [0, 0, 0, 1],
        scale: { x: 1, y: 1, z: 1 },
        config: componentDefaults(type),
        ...(type === "computer"
          ? {
              scriptLanguage: "visual",
              scriptSources: {
                visual: structuredClone(DEFAULT_VISUAL_PROGRAM),
                typescript: "",
                wat: "",
              },
              controllerBindings: [],
            }
          : {}),
      };
    }),
    connections = [];
  outer: for (let left = 1; left <= 200; left++)
    for (let right = 201; right <= 300; right++) {
      connections.push({
        id: `dense:${String(connections.length).padStart(4, "0")}`,
        a: left,
        b: right,
        kind: "signal",
        portA: "SIGNAL",
        portB: "IN A",
      });
      if (connections.length === 3_000) break outer;
    }
  return {
    format: "simulacrum-blueprint",
    version: 1,
    name: "Maximum shipping inspection fixture",
    parts,
    connections,
    remoteProfiles: {},
    defaultRemoteProfile: null,
  };
}

export function fixtureDigest(value) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(value))
    .digest("hex");
}
