import {
  prepareHostedControlIRController,
  prepareHostedTypeScriptController,
} from "../scripting/controller-compilers.js";
import { POINT_CONTACT_WRENCH_HOST_ABI_VERSION } from "../model/point-contact-wrench-controller-contract.js";
import { allocatePointContactWrench } from "../simulation/point-contact-wrench-allocator.js";

const pointContactWrenchHost = Object.freeze({
  identity: POINT_CONTACT_WRENCH_HOST_ABI_VERSION,
  allocate: allocatePointContactWrench,
});

/** Composes the restricted TypeScript compiler with physical host primitives. */
export function preparePhysicsTypeScriptController(source, bindingManifest) {
  return prepareHostedTypeScriptController(
    source,
    bindingManifest,
    pointContactWrenchHost,
  );
}

/** Composes the restricted Control IR compiler with physical host primitives. */
export function preparePhysicsControlIRController(
  ir,
  { language = "visual" } = {},
) {
  return prepareHostedControlIRController(ir, {
    language,
    pointContactWrenchHost,
  });
}
