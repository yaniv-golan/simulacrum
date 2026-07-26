import { immutableClone, stableStringify } from "../model/primitives.js";
import { ROUTE_EVIDENCE_LIMITS } from "../simulation/route-evidence-index.js";

const byteLength = (value) =>
  new TextEncoder().encode(stableStringify(value)).byteLength;

/**
 * Joins two independently proven configured signal segments without claiming
 * that the controller program read one and caused the other.
 */
export function composeConfiguredControlChainExplanation({
  inputBinding,
  outputBinding,
  inputWitness,
  outputWitness,
} = {}) {
  const inputAvailable = inputWitness?.status === "resolved",
    outputAvailable = outputWitness?.status === "resolved",
    samePhase =
      inputWitness?.identity?.phase &&
      inputWitness.identity.phase === outputWitness?.identity?.phase,
    identityMatches =
      samePhase &&
      stableStringify(inputWitness.identity) ===
        stableStringify(outputWitness.identity),
    explanation = {
      version: 1,
      kind: "configured-control-chain-explanation-v1",
      claim: "configured-routes-not-program-causality",
      input: {
        binding: inputBinding || null,
        availability: inputAvailable
          ? "available"
          : inputWitness?.status || "unsupported",
        witness: inputWitness || null,
      },
      controllerBoundary: {
        kind: "authored-binding-pair",
        programCausality: "not-evaluated",
      },
      output: {
        binding: outputBinding || null,
        availability: outputAvailable
          ? "available"
          : outputWitness?.status || "unsupported",
        witness: outputWitness || null,
      },
      continuousOverlay: false,
      status:
        inputAvailable && outputAvailable && identityMatches
          ? "resolved"
          : identityMatches
            ? "partial"
            : "stale",
    };
  if (byteLength(explanation) > ROUTE_EVIDENCE_LIMITS.maximumCompositeBytes)
    return immutableClone({
      ...explanation,
      status: "over-limit",
      input: { ...explanation.input, witness: null },
      output: { ...explanation.output, witness: null },
    });
  return immutableClone(explanation);
}
