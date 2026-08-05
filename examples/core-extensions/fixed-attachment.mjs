import {
  TYPES,
  compileAssembly,
  componentDefaults,
} from "@yaniv-golan/simulacrum-core";

export function fixedAttachmentExample() {
  const connectionId = "fixed-joint",
    compiled = compileAssembly(
      {
        revision: 1,
        parts: [
          {
            id: 1,
            type: "beam",
            pos: [0, 0, 0],
            orientation: [0, 0, 0, 1],
            config: componentDefaults("beam"),
          },
          {
            id: 2,
            type: "beam",
            pos: [2.4, 0, 0],
            orientation: [0, 0, 0, 1],
            config: componentDefaults("beam"),
          },
        ],
        connections: [
          {
            id: connectionId,
            a: 1,
            b: 2,
            kind: "mechanical",
            portA: "B",
            portB: "A",
            capacity: {
              ultimateForceN: 24_000,
              ultimateTorqueNm: 6_000,
            },
          },
        ],
      },
      TYPES,
    ),
    constraint = compiled.constraints.find(
      (candidate) => candidate.kind === "fixed",
    );
  if (!constraint || compiled.stats.errorCount)
    throw new Error("fixed attachment example did not compile");
  return {
    attachmentFrames: [
      constraint.attachmentFrameA,
      constraint.attachmentFrameB,
    ],
    failureOwners: constraint.failureAttachments,
  };
}
