import { analyzeComponentPreflight } from "../model/component-preflight.js";
import { ComponentRelationshipIndex } from "../model/component-relationships.js";
import { immutableClone } from "../model/primitives.js";
import { portDefinition, portIds, portPresentation } from "../model/ports.js";
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
    relationshipIndex = null,
    routeEvidence = null,
    routeEvidenceRevision = 0,
    lastRouteContextKey = null;

  function read() {
    const revision = assembly.revision(),
      selectedPartIds = [...selection.selectedPartIds()].sort(
        (left, right) => left - right,
      ),
      primaryPartId = selection.primaryPartId(),
      running = runtime.running(),
      evidenceRevision = runtime.evidenceRevision(),
      commandRevision = commandCatalog.revision?.() || 0,
      isolationActive = runtime.isolationActive?.() || false,
      connectionIntent = runtime.connectionIntent?.() || "",
      routeContextKey = `${revision}|${String(primaryPartId)}|${running ? 1 : 0}|${evidenceRevision}`;
    if (
      lastRouteContextKey !== null &&
      lastRouteContextKey !== routeContextKey
    ) {
      routeEvidence = null;
      routeEvidenceRevision++;
    }
    lastRouteContextKey = routeContextKey;
    const key = `${revision}|${selectedPartIds.join(",")}|${String(primaryPartId)}|${running ? 1 : 0}|${evidenceRevision}|${commandRevision}|${isolationActive ? 1 : 0}|${connectionIntent}|${routeEvidenceRevision}`;
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
      selectedPartIdSet = new Set(selectedPartIds),
      externalConnectionIds = new Set(),
      externalControllerBindingIds = new Set(),
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
    for (const selectedPartId of selectedPartIds) {
      const relationships = relationshipIndex.forPart(selectedPartId);
      for (const connection of relationships?.connections || [])
        if (!selectedPartIdSet.has(connection.counterpartPartId))
          externalConnectionIds.add(connection.connectionId);
      for (const binding of relationships?.controllerBindings || []) {
        const controllerSelected = selectedPartIdSet.has(
            binding.controllerPartId,
          ),
          endpointSelected = selectedPartIdSet.has(binding.endpointPartId);
        if (controllerSelected !== endpointSelected)
          externalControllerBindingIds.add(
            `${String(binding.controllerPartId)}:${binding.bindingId}`,
          );
      }
    }
    const selectionImpact = {
      externalConnectionCount: externalConnectionIds.size,
      externalControllerBindingCount: externalControllerBindingIds.size,
    };
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
            name: `${catalog[primary.type]?.name || primary.type} #${primary.id}`,
            subtitle: `${selectedPartIds.length} COMPONENT${selectedPartIds.length === 1 ? "" : "S"} SELECTED`,
            type: primary.type,
            partId: primary.id,
            primaryLabel: `Primary component: ${catalog[primary.type]?.name || primary.type} #${primary.id}`,
            options: selectedParts.map((part) => ({
              partId: part.id,
              type: part.type,
              label: `${catalog[part.type]?.name || part.type} #${part.id}`,
            })),
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
            const allCounterparts = directRelationships.filter(
                (relationship) => relationship.portId === portId,
              ),
              counterparts = allCounterparts.slice(0, 512),
              counterpart = counterparts[0] || null,
              definition = portDefinition(primary, portId, catalog),
              projectCounterpart = (relationship) => {
                const counterpartPart = partById.get(
                  relationship.counterpartPartId,
                );
                return {
                  partId: relationship.counterpartPartId,
                  portId: relationship.counterpartPortId,
                  connectionId: relationship.connectionId,
                  name: counterpartPart
                    ? `${catalog[counterpartPart.type]?.name || counterpartPart.type} #${counterpartPart.id}`
                    : `Missing component #${relationship.counterpartPartId}`,
                };
              };
            return {
              portId,
              kind: definition.kind,
              direction: definition.direction,
              behavior: definition.behavior,
              ...portPresentation(primary, portId, catalog),
              status: counterpart
                ? counterpart.observation?.failed
                  ? "failed"
                  : counterpart.validity === "invalid"
                    ? "invalid"
                    : "connected"
                : "available",
              counterpart: counterpart ? projectCounterpart(counterpart) : null,
              counterparts: counterparts.map(projectCounterpart),
              counterpartCount: allCounterparts.length,
              counterpartChooserStatus:
                allCounterparts.length > 512 ? "over-limit" : "available",
              routeTargets: assembly.routeTargetOptions?.({
                partId: primary.id,
                portId,
                kind: definition.kind,
                direction: definition.direction,
              }) || {
                status: "unsupported",
                totalCount: 0,
                options: [],
              },
            };
          })
        : [],
      connectionTargetAssessment: primary
        ? runtime.connectionAssessment?.(primary.id) || []
        : [],
      configuredControlChains: primary
        ? assembly.configuredControlChainOptions?.(primary.id) || {
            status: "unsupported",
            totalCount: 0,
            options: [],
          }
        : { status: "unsupported", totalCount: 0, options: [] },
      routeEvidence,
      preflight,
      observation,
      commands: commandCatalog.describe({
        selectedPartIds,
        running,
        impact: selectionImpact,
        isolationActive,
      }),
    };
    cacheKey = key;
    cached = immutableClone(value);
    return cached;
  }

  return Object.freeze({
    read,
    setRouteEvidence(value) {
      routeEvidence = value ? immutableClone(value) : null;
      routeEvidenceRevision++;
      cacheKey = null;
    },
    clearRouteEvidence() {
      if (routeEvidence === null) return;
      routeEvidence = null;
      routeEvidenceRevision++;
      cacheKey = null;
    },
  });
}
