import { fingerprintComponentInspectionAssembly } from "../model/component-inspection-fingerprint.js";
import { controllerBindingManifest } from "../model/controller-bindings.js";
import { DomainValidationError, immutableClone } from "../model/primitives.js";

/** Provides revision-bound stopped-workspace route evidence. */
export function createAuthoredRouteEvidenceAccessor({
  model,
  networks,
  catalog,
}) {
  let chooserRevision = -1,
    chooserCache = new Map();

  async function authoredRouteIdentity(kind) {
    if (!["power", "signal"].includes(kind))
      throw new DomainValidationError(
        "INVALID_ROUTE_EVIDENCE_QUERY",
        "Stopped route evidence supports power and signal only",
      );
    const network = networks()[kind === "power" ? "power" : "signals"],
      index = network.evidenceIndex(),
      snapshot = model.snapshot();
    return immutableClone({
      phase: "authored",
      assemblyRevision: model.revision,
      assemblyFingerprint:
        await fingerprintComponentInspectionAssembly(snapshot),
      networkResultDigest: index?.networkResultDigest ?? null,
    });
  }

  async function routeEvidence(query, expectedAuthoredIdentity) {
    if (!query || !["power", "signal"].includes(query.kind))
      return immutableClone({
        version: 1,
        medium: query?.kind?.startsWith?.("resource")
          ? "resource"
          : query?.kind || "power",
        identity: null,
        evidenceToken: null,
        status: "unsupported",
        source: query?.source || null,
        target: query?.target || null,
        resourceKey: query?.resourceKey || null,
        allocation: null,
        controllerPortSelection: null,
        hops: [],
        alternativeWitnessCount: 0,
        cycleConnectionIds: [],
        blockingConnectionIds: [],
        blockerEvidence: "unknown",
        totalHopCount: null,
        truncated: {
          hops: false,
          alternatives: false,
          cycles: false,
          blockers: false,
        },
      });
    if (
      !expectedAuthoredIdentity ||
      expectedAuthoredIdentity.phase !== "authored"
    )
      throw new DomainValidationError(
        "INVALID_ROUTE_EVIDENCE_IDENTITY",
        "Stopped route evidence requires an authored expected identity",
      );
    const identity = await authoredRouteIdentity(query.kind),
      network = networks()[query.kind === "power" ? "power" : "signals"],
      witness = network.routeWitness(
        query,
        expectedAuthoredIdentity.networkResultDigest,
      ),
      matches =
        expectedAuthoredIdentity.assemblyRevision ===
          identity.assemblyRevision &&
        expectedAuthoredIdentity.assemblyFingerprint ===
          identity.assemblyFingerprint &&
        expectedAuthoredIdentity.networkResultDigest ===
          identity.networkResultDigest;
    const { kind: _kind, ...response } = witness;
    return immutableClone({
      ...response,
      identity,
      evidenceToken: null,
      status: matches ? witness.status : "stale",
      ...(matches ? {} : { hops: [], totalHopCount: null }),
    });
  }

  function configuredControlChainOptions(partId) {
    const snapshot = model.snapshot(),
      selected = snapshot.parts.find((part) => part.id === partId),
      index = networks().signals.evidenceIndex();
    if (!selected || !index || index.status !== "available")
      return immutableClone({
        status: index?.status || "unsupported",
        totalCount: 0,
        options: [],
      });
    const controllerSensors = new Map(
        (index.resultFacts?.controllerSensors || []).map((record) => [
          record.controllerId,
          new Set(record.sensorIds),
        ]),
      ),
      controllersByTarget = new Map(
        (index.resultFacts?.routes || []).map((record) => [
          record.targetId,
          new Set(record.controllerIds),
        ]),
      ),
      options = [];
    let totalCount = 0;
    for (const controller of snapshot.parts.filter(
      (part) => part.type === "computer",
    )) {
      let manifest;
      try {
        manifest = controllerBindingManifest(
          controller,
          snapshot.parts,
          snapshot.connections,
          catalog,
        );
      } catch (error) {
        if (error instanceof DomainValidationError) continue;
        throw error;
      }
      const inputs = manifest.filter(
          (binding) => binding.direction === "input",
        ),
        outputs = manifest.filter((binding) => binding.direction === "output");
      for (const inputBinding of inputs)
        for (const outputBinding of outputs) {
          const selectedIsController = selected.id === controller.id,
            selectedIsInput = inputBinding.endpointPartId === selected.id,
            selectedIsOutput = outputBinding.endpointPartId === selected.id;
          if (!selectedIsController && !selectedIsInput && !selectedIsOutput)
            continue;
          totalCount++;
          if (options.length >= 512) continue;
          const inputPart = snapshot.parts.find(
              (part) => part.id === inputBinding.endpointPartId,
            ),
            outputPart = snapshot.parts.find(
              (part) => part.id === outputBinding.endpointPartId,
            ),
            partLabel = (part) =>
              `${catalog[part?.type]?.name || part?.type || "Missing component"} #${part?.id ?? "?"}`;
          options.push({
            id: `${String(controller.id)}:${inputBinding.id}:${outputBinding.id}`,
            controllerPartId: controller.id,
            controllerName: partLabel(controller),
            inputBinding,
            inputName: partLabel(inputPart),
            outputBinding,
            outputName: partLabel(outputPart),
            ownerSummary: {
              inputAvailable: Boolean(
                controllerSensors
                  .get(controller.id)
                  ?.has(inputBinding.endpointPartId),
              ),
              outputAvailable: Boolean(
                controllersByTarget
                  .get(outputBinding.endpointPartId)
                  ?.has(controller.id),
              ),
            },
            selectedRole: selectedIsController
              ? "controller"
              : selectedIsInput
                ? "input"
                : "output",
          });
        }
    }
    return immutableClone({
      status: totalCount > 512 ? "over-limit" : "available",
      totalCount,
      options: totalCount > 512 ? [] : options,
    });
  }

  function routeTargetOptions({ partId, portId, kind, direction }) {
    if (
      !Number.isSafeInteger(partId) ||
      !portId ||
      !["power", "signal"].includes(kind)
    )
      return immutableClone({
        status: "unsupported",
        totalCount: 0,
        options: [],
      });
    if (chooserRevision !== model.revision) {
      chooserRevision = model.revision;
      chooserCache = new Map();
    }
    const cacheKey = `${kind}:${partId}:${portId}:${direction || ""}`;
    if (chooserCache.has(cacheKey)) return chooserCache.get(cacheKey);
    const snapshot = model.snapshot(),
      network = networks()[kind === "power" ? "power" : "signals"],
      index = network.evidenceIndex();
    if (!index || index.status !== "available") {
      const unavailable = immutableClone({
        status: index?.status || "unsupported",
        totalCount: 0,
        options: [],
      });
      chooserCache.set(cacheKey, unavailable);
      return unavailable;
    }
    const sourcePartIds = new Set(index.sourcePartIds || []),
      targetPartIds = new Set(index.targetPartIds || []),
      selectedCanSource =
        direction === "source" ||
        (direction === "bidirectional" && sourcePartIds.has(partId)),
      selectedCanSink =
        direction === "sink" ||
        (direction === "bidirectional" && targetPartIds.has(partId)),
      candidateByKey = new Map(),
      addCandidate = (endpoint, sourceSelected) => {
        if (endpoint.partId === partId && endpoint.portId === portId) return;
        const query = sourceSelected
            ? {
                version: 1,
                kind,
                source: { partId, portId },
                target: endpoint,
              }
            : {
                version: 1,
                kind,
                source: endpoint,
                target: { partId, portId },
              },
          key = `${sourceSelected ? "out" : "in"}:${endpoint.partId}:${endpoint.portId}`;
        if (!candidateByKey.has(key)) candidateByKey.set(key, { key, query });
      };
    for (const edge of index.edges || []) {
      if (selectedCanSource && targetPartIds.has(edge.to.partId))
        addCandidate(edge.to, true);
      if (selectedCanSink && sourcePartIds.has(edge.from.partId))
        addCandidate(edge.from, false);
    }
    const candidates = [...candidateByKey.values()].sort((left, right) =>
      left.key === right.key ? 0 : left.key < right.key ? -1 : 1,
    );
    if (candidates.length > 512) {
      const overLimit = immutableClone({
        status: "over-limit",
        totalCount: candidates.length,
        options: [],
      });
      chooserCache.set(cacheKey, overLimit);
      return overLimit;
    }
    const partById = new Map(snapshot.parts.map((part) => [part.id, part])),
      options = candidates.flatMap(({ key, query }) => {
        const witness = network.routeWitness(query, index.networkResultDigest);
        if (witness.status !== "resolved") return [];
        const endpoint =
            query.source.partId === partId ? query.target : query.source,
          part = partById.get(endpoint.partId);
        return [
          {
            id: key,
            partId: endpoint.partId,
            portId: endpoint.portId,
            name: `${catalog[part?.type]?.name || part?.type || "Missing component"} #${endpoint.partId}`,
            query,
          },
        ];
      }),
      result = immutableClone({
        status: "available",
        totalCount: options.length,
        options,
      });
    chooserCache.set(cacheKey, result);
    return result;
  }

  return Object.freeze({
    authoredRouteIdentity,
    configuredControlChainOptions,
    routeTargetOptions,
    routeEvidence,
  });
}
