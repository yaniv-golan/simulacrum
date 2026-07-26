import {
  PowerNetwork,
  RunAssemblyGraph,
  TYPES,
} from "@yaniv-golan/simulacrum-core";

const part = (id, type, config = {}, extra = {}) => ({
    id,
    type,
    config,
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    ...extra,
  }),
  snapshot = {
    revision: 1,
    parts: [
      part(1, "battery", { capacityWh: 2 }, { storedEnergyWh: 2 }),
      part(2, "motor", { power: 0.1 }),
    ],
    connections: [
      {
        id: "power-link",
        a: 1,
        b: 2,
        kind: "power",
        portA: "POWER",
        portB: "POWER",
      },
    ],
  };

export function routeEvidenceExample() {
  const network = new PowerNetwork(TYPES).resolve(
      new RunAssemblyGraph(snapshot),
    ),
    identity = network.evidenceIndex();
  return network.routeWitness(
    {
      version: 1,
      kind: "power",
      source: { partId: 1, portId: "POWER" },
      target: { partId: 2, portId: "POWER" },
    },
    identity.networkResultDigest,
  );
}
