import { analyzeComponentPreflight } from "../model/component-preflight.js";
import { ComponentRelationshipIndex } from "../model/component-relationships.js";
import { immutableClone } from "../model/primitives.js";
import { portIds, portPresentation } from "../model/ports.js";
import { createSelectedContextCommandCatalog } from "./component-action-catalog.js";
import {
  projectCurrentComponentObservation,
  projectCurrentConnectionObservation,
} from "./component-inspection-observation-adapters.js";

export const COMPONENT_INSPECTION_VIEW_VERSION = 1;

/**
 * Builds the immutable selected-component read model. The feature composes
 * authored state and explicit owner-provided evidence; it does not infer
 * simulation reachability or physical success.
 */
export function createComponentInspectionFeature({
  assembly,
  selection,
  runtime,
  catalog,
  commandCatalog = createSelectedContextCommandCatalog(),
}) {
  let cacheKey = null,
    cached = null,
    authoredRevision = null,
    authoredSnapshot = null,
    relationshipIndex = null;

  function read() {
    const revision = assembly.revision(),
      selectedPartIds = [...selection.selectedPartIds()].sort(
        (left, right) => left - right,
      ),
      primaryPartId = selection.primaryPartId(),
      running = runtime.running(),
      evidenceRevision = runtime.evidenceRevision(),
      key = `${revision}|${selectedPartIds.join(",")}|${String(primaryPartId)}|${running ? 1 : 0}|${evidenceRevision}`;
    if (cacheKey === key && cached) return cached;
    if (authoredRevision !== revision || !relationshipIndex) {
      authoredRevision = revision;
      authoredSnapshot = assembly.snapshot();
      relationshipIndex = new ComponentRelationshipIndex(authoredSnapshot);
    }
    const snapshot = authoredSnapshot;
    const partById = new Map(snapshot.parts.map((part) => [part.id, part])),
      primary = partById.get(primaryPartId) || null,
      authoredRelationships = primary
        ? relationshipIndex.forPart(primary.id)
        : null,
      preflight = analyzeComponentPreflight(snapshot, {
        selectedPartIds,
        catalog,
        relationshipIndex,
      }),
      selectedParts = selectedPartIds
        .map((partId) => partById.get(partId))
        .filter(Boolean),
      directRelationships = (authoredRelationships?.connections || []).map(
        (relationship) =>
          projectCurrentConnectionObservation({
            relationship,
            connection:
              runtime.currentConnection?.(relationship.connectionId) || null,
            validity:
              runtime.connectionValidity?.(relationship.connectionId) ?? null,
            running,
          }),
      ),
      misaligned = directRelationships.some(
        (relationship) => relationship.validity === "misaligned",
      ),
      powered = primary ? runtime.powered(primary.id) : false,
      currentPart = primary ? runtime.currentPart(primary.id) || primary : null,
      observation = projectCurrentComponentObservation({
        part: primary,
        currentPart,
        running,
        powered,
        directConnections: directRelationships,
      }),
      batteryPercent = Math.round(
        Number(observation?.specialized?.stateOfCharge || 0) * 100,
      ),
      totalMassKg = selectedParts.reduce(
        (sum, part) =>
          sum +
          Number(
            part.mechanism?.massPropertySource?.massKg ??
              catalog[part.type]?.mass ??
              0,
          ),
        0,
      );
    let status = {
      kind: "none",
      label: "",
      warning: false,
      provenance: "authored",
    };
    if (primary) {
      if (selectedPartIds.length > 1)
        status = {
          kind: "selection",
          label: `● ${totalMassKg} KG GROUP`,
          warning: false,
          provenance: "authored",
        };
      else if (misaligned)
        status = {
          kind: "blocked",
          label: "● MISALIGNED",
          warning: true,
          provenance: "authored-analysis",
        };
      else if (primary.type === "motor")
        status = {
          kind: powered ? "powered" : "blocked",
          label: powered ? "● POWERED" : "● NO POWER",
          warning: !powered,
          provenance: running ? "completed-telemetry" : "network-analysis",
        };
      else if (primary.type === "battery")
        status = {
          kind: "charge",
          label: `● ${batteryPercent}% CHARGE`,
          warning: false,
          provenance: running ? "completed-telemetry" : "authored",
        };
      else
        status = {
          kind: "legacy-ready-label",
          label: "● READY",
          warning: false,
          provenance: "authored-preflight",
        };
    }
    const value = {
      version: COMPONENT_INSPECTION_VIEW_VERSION,
      source: {
        assemblyRevision: revision,
        phase: running ? "live" : "authored",
        runtimeEvidenceRevision: evidenceRevision,
      },
      selection: {
        selectedPartIds,
        primaryPartId: primary?.id ?? null,
        count: selectedPartIds.length,
      },
      header: primary
        ? {
            name:
              selectedPartIds.length > 1
                ? `${selectedPartIds.length} COMPONENTS`
                : catalog[primary.type]?.name || primary.type,
            subtitle:
              selectedPartIds.length > 1
                ? "MULTI-SELECTION · PRIMARY SHOWN"
                : "SELECTED COMPONENT",
            type: primary.type,
            partId: primary.id,
          }
        : null,
      status,
      overview: primary
        ? {
            massKg: Number(
              primary.mechanism?.massPropertySource?.massKg ??
                catalog[primary.type]?.mass ??
                0,
            ),
            totalSelectedMassKg: totalMassKg,
          }
        : null,
      relationships: primary
        ? {
            ...authoredRelationships,
            connections: directRelationships,
          }
        : null,
      ports: primary
        ? portIds(primary, catalog).map((portId) => {
            const counterpart = directRelationships.find(
              (relationship) => relationship.portId === portId,
            );
            return {
              portId,
              ...portPresentation(primary, portId, catalog),
              status: counterpart ? "connected" : "available",
              counterpart: counterpart
                ? {
                    partId: counterpart.counterpartPartId,
                    portId: counterpart.counterpartPortId,
                    connectionId: counterpart.connectionId,
                  }
                : null,
            };
          })
        : [],
      preflight,
      observation,
      commands: commandCatalog.describe({ selectedPartIds, running }),
    };
    cacheKey = key;
    cached = immutableClone(value);
    return cached;
  }

  return Object.freeze({ read });
}
