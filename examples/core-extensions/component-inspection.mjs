import {
  analyzeComponentPreflight,
  ComponentRelationshipIndex,
  componentDefaults,
  decodeAuthoredAssemblyContentOrThrow,
  fingerprintComponentInspectionAssembly,
} from "@yaniv-golan/simulacrum-core";

export async function componentInspectionExample() {
  const snapshot = {
      revision: 4,
      parts: [
        {
          id: 1,
          type: "battery",
          pos: [0, 1, 0],
          orientation: [0, 0, 0, 1],
          scale: { x: 1, y: 1, z: 1 },
          config: componentDefaults("battery"),
          storedEnergyWh: 100,
        },
        {
          id: 2,
          type: "motor",
          pos: [1, 1, 0],
          orientation: [0, 0, 0, 1],
          scale: { x: 1, y: 1, z: 1 },
          config: componentDefaults("motor"),
        },
      ],
      connections: [
        {
          id: "power:1-2",
          a: 1,
          b: 2,
          kind: "power",
          portA: "POWER",
          portB: "POWER",
        },
      ],
    },
    authored = decodeAuthoredAssemblyContentOrThrow(snapshot),
    relationships = new ComponentRelationshipIndex(authored),
    preflight = analyzeComponentPreflight(authored, {
      selectedPartIds: [2],
    });
  return {
    fingerprint: await fingerprintComponentInspectionAssembly(snapshot),
    motor: relationships.forPart(2),
    preflight,
  };
}
