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
  "42cd27e75c2545df989906d06714448122fd96526f35a45469bdcb996dc80b4d",
  "b1e001eb079e0e58048f26f64590a80cfa7df0ab22f4cbfb13713fc6c0ee514f",
  "b7c3e6d1f57ae91e2e9096373dec72eba128071350834157206d646ae228e22a",
  "cc6446b1a5a460d2b6f1ad9f45ddfa3bccb5a2f41189027fb985b5a10fe3995f",
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
