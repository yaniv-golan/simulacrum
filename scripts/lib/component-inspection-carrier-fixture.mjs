import { builtInDemo } from "../../src/model/demo-blueprints.js";

/** One strict fixture spanning every currently portable optional field family. */
export function createComponentInspectionCarrierBlueprint() {
  const blueprint = structuredClone(builtInDemo("gearbox").blueprint),
    plate = blueprint.parts.find(({ type }) => type === "plate"),
    axle = blueprint.parts.find(({ type }) => type === "axle"),
    battery = blueprint.parts.find(({ type }) => type === "battery"),
    computer = blueprint.parts.find(({ type }) => type === "computer"),
    connection = blueprint.connections.find(
      ({ kind }) => kind === "mechanical",
    );
  blueprint.name = "Inspection authored-field carrier";
  for (const part of blueprint.parts) part.pos[0] += 5;
  plate.customColor = 0x336699;
  plate.extensions = { "example.part": { labels: ["frame", "carrier"] } };
  axle.rigRole = "carrierAxle";
  axle.rigVisualRotation = [0.1, -0.2, 0.3];
  axle.extensions = { "example.mechanism": { revision: 1 } };
  battery.extensions = { "example.energy": { reserve: "nominal" } };
  computer.controllerBindings = [
    {
      id: "inspection.motor",
      direction: "output",
      endpointPartId: 2,
      endpointPortId: "CONTROL",
      channel: "throttle",
    },
    {
      id: "inspection.sensor",
      direction: "input",
      endpointPartId: 7,
      endpointPortId: "SIGNAL",
      reading: "rotation_rpm",
    },
  ];
  computer.extensions = { "example.controller": { mode: "inspection" } };
  connection.anchorB = [0, 0, 0];
  connection.extensions = {
    "example.connection": { label: "carrier attachment", tags: [1, 2] },
  };
  return blueprint;
}
