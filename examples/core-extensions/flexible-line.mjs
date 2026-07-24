import {
  compileAssembly,
  componentDefaults,
  TYPES,
} from "@yaniv-golan/simulacrum-core";

/** Compile one ordinary free-ended Rope without creating a rigid proxy body. */
export function flexibleLineExample() {
  const compiled = compileAssembly(
    {
      revision: 1,
      parts: [
        {
          id: 1,
          type: "rope",
          pos: [0, 3, 0],
          orientation: [0, 0, 0, 1],
          scale: [1, 1, 1],
          config: componentDefaults("rope", TYPES),
        },
      ],
      connections: [],
    },
    TYPES,
  );
  const line = compiled.flexibleLines[0];
  return {
    kind: line.kind,
    sourcePartId: line.sourcePartId,
    rigidProxyBodies: compiled.bodies.length,
    physicalEntities: line.entities.length,
    internalEdges: line.internalEdges.length,
    endpointStates: line.attachments.map(({ kind }) => kind),
    discretization: line.discretization.kind,
  };
}
