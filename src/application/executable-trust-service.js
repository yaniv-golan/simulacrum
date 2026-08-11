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
  "52131eab0885a4f0e316492dd02f0f64f2345d2c9ad4227cfe1dae71e6036f6f",
  "64a5a94c759f366099e3e13576d95ccfae7e60e97fdbdd028fd3f89ccfc4b59b",
  "c555990a71a6a0b7890008d97e1e8c1af7623d3a39edc420f90d352f311748ba",
  "f54424f10c1ba8433742cd583f106bd2e3c43b324d92061dc0a4a71b563f2c49",
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
