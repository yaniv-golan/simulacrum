import {
  BlueprintAcquisition,
  normalizeBlueprintAcquisition,
} from "../model/blueprint-acquisition.js";
import {
  executableDescriptor,
  executableDigest,
} from "../model/executable-program.js";

// Audited sources shipped by this checkout. A source or policy edit changes its
// digest and therefore fails closed until this list is reviewed and updated.
export const AUDITED_BUILT_IN_DIGESTS = Object.freeze([
  "32708f394b310c688935a96e6eacbfaa65035fbe87a40727379745298e144e50",
  "b9fa2d33f2ba41f72f7f7dd89577dc27f7bdc4ce68d9154f24669d511c13e3b4",
  "f6b2e0c6db7e07bd71cdca5b6349c9a7af91da43702e09829550c42bfd03cfc5",
  "ef4fd5b60c9d5950f17534607b5f3fba79bf7c2294c7d876acaeda497fbaa448",
]);

export function descriptorForController(controller) {
  const language = controller?.scriptLanguage || "typescript";
  return executableDescriptor({
    language,
    source: controller?.scriptSources?.[language] ?? "",
    bindingManifest: controller?.controllerBindings || [],
  });
}

export async function assessControllerTrust({
  controller,
  repository,
  builtInDigests = AUDITED_BUILT_IN_DIGESTS,
}) {
  const acquisition = normalizeBlueprintAcquisition(
    controller?.programAcquisition,
  );
  let digest;
  try {
    digest = await executableDigest(descriptorForController(controller));
  } catch (error) {
    return {
      acquisition,
      digest: null,
      allowed: false,
      requiresReview: true,
      status: "PROGRAM DISABLED — DIGEST UNAVAILABLE",
      error,
    };
  }

  if (acquisition === BlueprintAcquisition.LOCAL_AUTHORING)
    return {
      acquisition,
      digest,
      allowed: true,
      requiresReview: false,
      status: "LOCAL PROGRAM",
    };
  if (acquisition === BlueprintAcquisition.BUILT_IN) {
    const audited = builtInDigests.includes(digest);
    if (audited)
      return {
        acquisition,
        digest,
        allowed: true,
        requiresReview: false,
        status: "AUDITED BUILT-IN PROGRAM",
      };
    const result = repository.has(digest);
    const allowed = result.ok && result.trusted;
    return {
      acquisition,
      digest,
      allowed,
      requiresReview: true,
      status: allowed
        ? "REVIEWED MODIFIED BUILT-IN PROGRAM"
        : result.ok
          ? "PROGRAM DISABLED — BUILT-IN DIGEST MISMATCH"
          : "PROGRAM DISABLED — TRUST STORAGE UNAVAILABLE",
      error: result.error,
    };
  }
  const result = repository.has(digest);
  return {
    acquisition,
    digest,
    allowed: result.ok && result.trusted,
    requiresReview: true,
    status:
      result.ok && result.trusted
        ? "REVIEWED PROGRAM — LOCAL TRUST"
        : result.ok
          ? "PROGRAM DISABLED — REVIEW SOURCE"
          : "PROGRAM DISABLED — TRUST STORAGE UNAVAILABLE",
    error: result.error,
  };
}

export async function grantControllerTrust({ controller, repository }) {
  const acquisition = normalizeBlueprintAcquisition(
    controller?.programAcquisition,
  );
  const current = await assessControllerTrust({
    controller,
    repository,
  });
  if (current.allowed || acquisition === BlueprintAcquisition.LOCAL_AUTHORING)
    return current;
  try {
    const digest = await executableDigest(descriptorForController(controller));
    const result = repository.grant(digest);
    return result.ok
      ? assessControllerTrust({ controller, repository })
      : {
          acquisition,
          digest,
          allowed: false,
          requiresReview: true,
          status: "PROGRAM DISABLED — TRUST NOT SAVED",
          error: result.error,
        };
  } catch (error) {
    return {
      acquisition,
      digest: null,
      allowed: false,
      requiresReview: true,
      status: "PROGRAM DISABLED — TRUST NOT SAVED",
      error,
    };
  }
}
