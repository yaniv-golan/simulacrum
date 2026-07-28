import { deepFreeze } from "../model/primitives.js";
import { createFailureEvidenceArtifact } from "./failure-evidence-export.js";

const MAX_PRIOR_EPISODES = 31;

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function reasonCode(error) {
  const code = String(error?.code || "FAILURE_EVIDENCE_FINALIZATION_FAILED");
  return /^[A-Z0-9_]+$/.test(code)
    ? code
    : "FAILURE_EVIDENCE_FINALIZATION_FAILED";
}

/**
 * Owns proactive composition, strict validation, episode retention, and the
 * immutable status projected into simulation telemetry.
 */
export function createFailureEvidenceCaptureCoordinator({ runtime }) {
  let cachedArtifact = null,
    priorEpisodeBoundaries = [],
    status = immutable({
      state: "collecting",
      reasonCode: null,
      episodeIndex: 0,
    });

  function finalize(snapshot) {
    const trigger = snapshot?.trigger;
    if (!trigger)
      throw new Error("Cannot finalize failure evidence without a trigger");
    try {
      const artifact = createFailureEvidenceArtifact({ runtime, snapshot });
      cachedArtifact = artifact;
      status = immutable({
        state: "ready",
        reasonCode: null,
        episodeIndex: priorEpisodeBoundaries.length,
        trigger: artifact.trigger,
      });
      if (trigger.kind === "structural-failure")
        return immutable({ rearm: false, priorEpisodeBoundaries, status });
      if (priorEpisodeBoundaries.length >= MAX_PRIOR_EPISODES)
        return immutable({ rearm: false, priorEpisodeBoundaries, status });
      priorEpisodeBoundaries = immutable([
        ...priorEpisodeBoundaries,
        {
          episodeIndex: priorEpisodeBoundaries.length,
          trigger: artifact.trigger,
          policyFingerprint: artifact.policyFingerprint,
        },
      ]);
      return immutable({ rearm: true, priorEpisodeBoundaries, status });
    } catch (error) {
      status = immutable({
        state: "unavailable",
        reasonCode: reasonCode(error),
        episodeIndex: priorEpisodeBoundaries.length,
      });
      return immutable({ rearm: false, priorEpisodeBoundaries, status });
    }
  }

  return Object.freeze({
    finalize,
    status: () => status,
    artifact: () => cachedArtifact,
    reset() {
      cachedArtifact = null;
      priorEpisodeBoundaries = [];
      status = immutable({
        state: "collecting",
        reasonCode: null,
        episodeIndex: 0,
      });
    },
  });
}
