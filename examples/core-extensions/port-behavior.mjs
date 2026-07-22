import {
  portDefinition,
  validatePortConnection,
} from "@yaniv-golan/simulacrum-core";

export function portBehaviorExample() {
  const generator = { id: 1, type: "solarGenerator" },
    consumer = { id: 2, type: "sciencePayload" },
    catalog = {
      solarGenerator: {
        ports: [
          {
            id: "POWER OUT",
            kind: "power",
            behavior: "electrical-network",
            direction: "source",
            multiplicity: "many",
          },
        ],
      },
      sciencePayload: {
        ports: [
          {
            id: "POWER IN",
            kind: "power",
            behavior: "electrical-network",
            direction: "sink",
            multiplicity: "one",
          },
        ],
      },
    };
  validatePortConnection(
    generator,
    "POWER OUT",
    consumer,
    "POWER IN",
    [],
    catalog,
  );
  return {
    source: portDefinition(generator, "POWER OUT", catalog),
    sink: portDefinition(consumer, "POWER IN", catalog),
  };
}
