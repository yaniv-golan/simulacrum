import { controllerBindingManifest } from "./controller-bindings.js";
import { TYPES } from "./component-catalog.js";
import { ComponentRelationshipIndex } from "./component-relationships.js";
import { immutableClone } from "./primitives.js";

export const COMPONENT_PREFLIGHT_VERSION = 1;
const compareCodeUnits = (left, right) =>
  left === right ? 0 : left < right ? -1 : 1;

/**
 * Authored-only readiness checks. Runtime outcome is deliberately not inferred.
 * @param {any} snapshot
 * @param {{selectedPartIds?:number[], catalog?:Record<string,any>, relationshipIndex?:ComponentRelationshipIndex|null}} [options]
 */
export function analyzeComponentPreflight(
  snapshot,
  { selectedPartIds = [], catalog = TYPES, relationshipIndex = null } = {},
) {
  const selected = new Set(selectedPartIds),
    relationships =
      relationshipIndex || new ComponentRelationshipIndex(snapshot),
    diagnostics = [];
  for (const partId of selected)
    if (!snapshot.parts.some((part) => part.id === partId))
      diagnostics.push({
        code: "UNKNOWN_SELECTED_COMPONENT",
        severity: "blocked",
        partId,
        message: `Selected component ${partId} does not exist.`,
      });
  for (const part of snapshot.parts.filter((candidate) =>
    selected.has(candidate.id),
  )) {
    relationships.forPart(part.id);
    if (part.type === "computer")
      try {
        controllerBindingManifest(
          part,
          snapshot.parts,
          snapshot.connections,
          catalog,
        );
      } catch (error) {
        const failure = /** @type {Error & {code?: string}} */ (error);
        diagnostics.push({
          code: failure.code || "INVALID_CONTROLLER_BINDING",
          severity: "blocked",
          partId: part.id,
          message: failure.message,
        });
      }
  }
  diagnostics.sort(
    (left, right) =>
      compareCodeUnits(String(left.severity), String(right.severity)) ||
      compareCodeUnits(String(left.code), String(right.code)) ||
      Number(left.partId || 0) - Number(right.partId || 0),
  );
  return immutableClone({
    version: COMPONENT_PREFLIGHT_VERSION,
    status: selected.size
      ? diagnostics.some((entry) => entry.severity === "blocked")
        ? "blocked"
        : "passed"
      : "not-checked",
    scope: [...selected].sort((left, right) => left - right),
    diagnostics,
    checks: [
      {
        id: "authored-component-contracts",
        status: diagnostics.length
          ? "failed"
          : selected.size
            ? "passed"
            : "not-checked",
      },
      {
        id: "runtime-outcome",
        status: "not-checked",
        reason: "Simulation has not established a physical outcome.",
      },
    ],
  });
}
