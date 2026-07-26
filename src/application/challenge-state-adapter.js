import { canonicalizeQuaternion } from "../model/primitives.js";
import { componentDefinition } from "../model/component-contracts.js";

/** Converts live application objects into the DOM-free challenge read model. */
export function createChallengeMachineView(
  parts,
  connections,
  catalog,
  remoteProfiles = {},
) {
  return {
    parts: parts.map((part) => ({
      id: part.id,
      type: part.type,
      pos: Array.isArray(part.pos) ? [...part.pos] : [0, 0, 0],
      orientation: canonicalizeQuaternion(part.orientation),
      scale: Array.isArray(part.scale)
        ? [...part.scale]
        : [part.scale?.x ?? 1, part.scale?.y ?? 1, part.scale?.z ?? 1],
      rigRole: part.rigRole || null,
      mass:
        part.mechanism?.massPropertySource?.massKg ??
        part.config?.mass ??
        componentDefinition(part, catalog)?.mass ??
        0,
      energyJ: part.energyJ,
      storedEnergyWh: part.storedEnergyWh ?? part.energyWh,
      config: structuredClone(part.config || {}),
      mechanism: part.mechanism ? structuredClone(part.mechanism) : undefined,
    })),
    connections: connections.map((connection) =>
      structuredClone({
        id: connection.id,
        a: connection.a,
        b: connection.b,
        portA: connection.portA,
        portB: connection.portB,
        anchorA: connection.anchorA,
        anchorB: connection.anchorB,
        kind: connection.kind,
        capacity: connection.capacity,
        config: connection.config,
        failed: Boolean(connection.failed),
      }),
    ),
    remoteProfiles: structuredClone(remoteProfiles),
  };
}

export function createChallengePanelView(state, result) {
  return {
    activeChallenge: state.activeChallenge,
    status: state.challengeStatus,
    progress: state.challengeProgress,
    score: state.challengeScore,
    best: state.challengeBest,
    records: state.challengeRecords,
    startMode: state.challengeStartMode,
    running: state.running,
    paused: state.simulationPaused,
    result,
  };
}

export function beginChallengeRun(state, challenges, machine) {
  const challenge = challenges.find(
    (entry) => entry.id === state.activeChallenge,
  );
  if (!challenge) return null;
  state.challengeStatus = "ready";
  state.challengeProgress = 0;
  state.challengeHold = 0;
  state.challengeScore = 0;
  return new ChallengeRun(challenge, machine);
}

/** Persists one terminal run without coupling the evaluator to browser state. */
export function recordChallengeResult({
  state,
  result,
  storage,
  keys,
  assetFingerprint = null,
  proofContext = /** @type {{ complete?: boolean, challengeVersion?: number, partIds?: number[], environment?: object | null, controllerPrograms?: object[] }} */ ({}),
}) {
  const success = result.status === "complete";
  state.challengeStatus = result.status;
  state.challengeProgress = success ? 1 : result.progress;
  state.challengeScore = success ? result.score : 0;
  const binding = structuredClone(result.metrics.proofBinding || null),
    partIds = new Set(proofContext.partIds || []),
    boundIds = binding
      ? binding.kind === "mechanism"
        ? [binding.inputPartId, binding.outputPartId]
        : binding.kind === "payload"
          ? [binding.rootPartId, binding.payloadPartId]
          : [binding.rootPartId]
      : [],
    initialComponentPartIds =
      binding && binding.kind !== "mechanism"
        ? String(binding.initialComponentId || "")
            .replace(/^component:/, "")
            .split("|")
            .map(Number)
            .filter(Number.isSafeInteger)
        : [],
    initialComponentValid =
      !binding ||
      binding.kind === "mechanism" ||
      (initialComponentPartIds.length > 0 &&
        initialComponentPartIds.every((id) => partIds.has(id)) &&
        initialComponentPartIds.includes(binding.rootPartId) &&
        (binding.kind !== "payload" ||
          initialComponentPartIds.includes(binding.payloadPartId))),
    proofReady =
      /^sim-sha256-[0-9a-f]{64}$/.test(assetFingerprint || "") &&
      proofContext.complete !== false &&
      binding !== null &&
      boundIds.every((id) => partIds.has(id)) &&
      initialComponentValid;
  state.challengeRecords.push({
    proofVersion: 1,
    challengeVersion: Math.max(
      1,
      Math.round(Number(proofContext.challengeVersion) || 1),
    ),
    id: state.activeChallenge,
    success,
    score: state.challengeScore,
    solution: result.solution,
    timeS: result.elapsedS,
    massKg: result.metrics.massKg,
    energyUsed: result.metrics.energyUsed,
    damage: result.metrics.damage,
    recordedAt: new Date().toISOString(),
    assetFingerprint,
    verificationEligible:
      success && result.verificationEligible === true && proofReady,
    environment: structuredClone(proofContext.environment || null),
    controllerPrograms: structuredClone(proofContext.controllerPrograms || []),
    binding,
    terminal: {
      criteria: (result.criteria || []).map((entry) => ({
        id: entry.id,
        met: Boolean(entry.met),
        current: String(entry.current || ""),
        target: String(entry.target || ""),
      })),
      metrics: {
        massKg: Math.max(0, Number(result.metrics.massKg) || 0),
        partCount: Math.max(
          0,
          Math.round(Number(result.metrics.partCount) || 0),
        ),
        energyUsed: Math.max(0, Number(result.metrics.energyUsed) || 0),
        damage: Math.max(0, Math.round(Number(result.metrics.damage) || 0)),
        worstFatigue: Math.max(0, Number(result.metrics.worstFatigue) || 0),
        apexM: Math.max(0, Number(result.metrics.apexM) || 0),
        touchedWater: Boolean(result.metrics.touchedWater),
        payloadSecured: Boolean(result.metrics.payloadSecured),
      },
    },
  });
  state.challengeRecords = state.challengeRecords.slice(-100);
  storage.writeJson(keys.challengeRecords, state.challengeRecords);
  if (success) {
    state.challengeBest[state.activeChallenge] = Math.max(
      state.challengeBest[state.activeChallenge] || 0,
      state.challengeScore,
    );
    storage.writeJson(keys.challengeBest, state.challengeBest);
  }
  return success;
}
import { ChallengeRun } from "../model/challenge-lab.js";
